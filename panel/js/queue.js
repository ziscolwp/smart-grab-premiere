// panel/js/queue.js
// Orchestrates a download queue: a title-fetch pool feeds a single sequential downloader.
// All I/O (fetchInfo/download/importFile/resolveOutputDir) is injected via deps so this is
// fully unit-testable with fakes. Holds the live item list; notifies the UI via deps.onChange.
var qs = require('./queueState.js');

function createQueue(deps) {
  var now = deps.now || function () { return Date.now(); };
  var items = qs.rehydrate(deps.initialItems || [], { existsSync: deps.existsSync, now: now });
  var fetching = 0;
  var CONC = deps.titleConcurrency || 4;
  var procs = {};   // id -> child process (kept out of item objects)

  function notify() {
    deps.onChange(items);
    if (deps.persist) deps.persist(items);
  }
  function stamp(fields) { return Object.assign({}, fields || {}, { updatedAt: now() }); }
  function current(id) { return qs.itemById(items, id); }
  function setStatus(id, status, fields) { items = qs.setStatus(items, id, status, stamp(fields)); notify(); }
  function update(id, fields) { items = qs.update(items, id, stamp(fields)); notify(); }
  function isCanceled(id) {
    var it = current(id);
    return !it || it.status !== 'downloading';
  }
  function cleanupItemWorkDir(it) {
    if (deps.cleanupWorkDir && it && it.workDir && qs.isTerminalStatus(it.status)) deps.cleanupWorkDir(it.workDir);
  }

  function addUrls(list) {
    var added = list.map(function (x) {
      var id = deps.makeId();
      return qs.makeItem(id, x.url, x.opts || {}, {
        now: now,
        workDir: deps.makeWorkDir ? deps.makeWorkDir(id) : null
      });
    });
    items = qs.add(items, added);
    notify();
    pumpTitles();
    pumpDownloads();
  }

  function pumpTitles() {
    while (fetching < CONC) {
      var pend = qs.firstWithStatus(items, 'pending');
      if (!pend) break;
      items = qs.setStatus(items, pend.id, 'fetching-info'); notify();
      fetching++;
      (function (id, url) {
        deps.fetchInfo(url, function (err, info) {
          fetching--;
          if (!current(id) || current(id).status !== 'fetching-info') {
            pumpTitles();
            pumpDownloads();
            return;
          }
          if (err) { items = qs.setStatus(items, id, 'queued', stamp({ title: url, statusMsg: 'title unavailable' })); }
          else {
            items = qs.setStatus(items, id, 'queued', stamp({
              title: info.title, durationSec: info.durationSec,
              thumbnail: info.thumbnail || null, uploader: info.uploader || null
            }));
          }
          notify();
          pumpTitles();
          pumpDownloads();
        });
      })(pend.id, pend.url);
    }
  }

  function pumpDownloads() {
    if (qs.anyDownloading(items)) return;
    var next = qs.nextQueued(items);
    if (!next) return;
    var id = next.id;
    items = qs.setStatus(items, id, 'downloading', stamp({
      progress: 0,
      statusMsg: 'Starting…',
      attemptCount: (next.attemptCount || 0) + 1
    })); notify();

    deps.resolveOutputDir(next.opts, function (derr, outputDir) {
      if (!current(id) || current(id).status !== 'downloading') return;
      if (derr) { setStatus(id, 'error', { statusMsg: derr.message }); pumpDownloads(); return; }
      var dlOpts = Object.assign({}, next.opts, {
        url: next.url,
        outputDir: outputDir,
        extRoot: deps.extRoot,
        isCanceled: function () { return isCanceled(id); }
      });
      if (next.workDir) {
        dlOpts.workDir = next.workDir;
        dlOpts.preserveWorkDir = true;
      }
      deps.download(dlOpts, {
        onProgress: function (pct, msg) {
          if (!current(id) || current(id).status !== 'downloading') return;
          var fields = { statusMsg: msg || '' };
          if (pct !== null && pct !== undefined) fields.progress = pct;
          update(id, fields);
        },
        onProc: function (p) { procs[id] = p; }
      }, function (err, res) {
        delete procs[id];
        if (!current(id) || current(id).status !== 'downloading') return;
        if (err) {
          var canRetry = err.retryable !== false && (!!err.retryable || !!err.hasPartials);
          setStatus(id, 'error', {
            statusMsg: err.message,
            errorHint: err.hint || null,
            errorCategory: err.category || null,
            retryable: canRetry,
            workDirHasPartials: !!err.hasPartials
          });
          pumpDownloads();
          return;
        }
        update(id, { statusMsg: 'Importing…', progress: 100 });
        // A single post can yield several media files (e.g. a tweet with
        // multiple videos) — import every one of them.
        var paths = res.paths || [res.path];
        var pi = 0, firstImpErr = null;
        (function importNext() {
          if (pi >= paths.length) {
            setStatus(id, 'done', {
              outputPath: res.path,
              outputPaths: paths,
              workDirHasPartials: false,
              statusMsg: firstImpErr ? ('Downloaded (import failed): ' + firstImpErr.message) : (res.size || 'Done')
            });
            pumpDownloads();
            return;
          }
          deps.importFile(paths[pi++], function (impErr) {
            if (impErr && !firstImpErr) firstImpErr = impErr;
            importNext();
          });
        })();
      });
    });
  }

  function cancel(id) {
    if (procs[id]) { try { procs[id].kill(); } catch (e) {} delete procs[id]; }
    var it = current(id);
    items = qs.setStatus(items, id, 'canceled', stamp({
      statusMsg: 'Canceled',
      retryable: it ? it.status === 'downloading' : false,
      workDirHasPartials: it ? it.status === 'downloading' : false
    })); notify();
    pumpDownloads();
  }

  function cancelAll() {
    for (var k in procs) { if (procs.hasOwnProperty(k)) { try { procs[k].kill(); } catch (e) {} } }
    procs = {};
    items = items.map(function (it) {
      var active = it.status === 'pending' || it.status === 'fetching-info' || it.status === 'queued' || it.status === 'downloading';
      return active ? Object.assign({}, it, stamp({
        status: 'canceled',
        statusMsg: 'Canceled',
        retryable: it.status === 'downloading',
        workDirHasPartials: it.status === 'downloading'
      })) : it;
    });
    notify();
  }

  function remove(id) {
    var active = qs.firstWithStatus(items, 'downloading');
    if (active && active.id === id) return; // can't remove the active download; cancel it first
    cleanupItemWorkDir(current(id));
    items = qs.remove(items, id); notify();
  }

  function retry(id) {
    var it = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) it = items[i];
    if (!it || (it.status !== 'error' && it.status !== 'canceled')) return;
    items = qs.setStatus(items, id, 'queued', stamp({
      statusMsg: '',
      errorHint: null,
      errorCategory: null,
      retryable: false,
      workDirHasPartials: false,
      progress: 0
    }));
    notify();
    pumpDownloads();
  }

  function clearDone() {
    for (var i = 0; i < items.length; i++) cleanupItemWorkDir(items[i]);
    items = qs.clearDone(items); notify();
  }
  function getItems() { return items; }

  function start() {
    pumpTitles();
    pumpDownloads();
  }

  return {
    addUrls: addUrls, cancel: cancel, cancelAll: cancelAll, retry: retry,
    remove: remove, clearDone: clearDone, getItems: getItems, start: start
  };
}

module.exports = { createQueue: createQueue };
