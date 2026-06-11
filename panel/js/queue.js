// panel/js/queue.js
// Orchestrates a download queue: a title-fetch pool feeds a single sequential downloader.
// All I/O (fetchInfo/download/importFile/resolveOutputDir) is injected via deps so this is
// fully unit-testable with fakes. Holds the live item list; notifies the UI via deps.onChange.
var qs = require('./queueState.js');

function createQueue(deps) {
  var items = [];
  var fetching = 0;
  var CONC = deps.titleConcurrency || 4;
  var procs = {};   // id -> child process (kept out of item objects)

  function notify() { deps.onChange(items); }
  function setStatus(id, status, fields) { items = qs.setStatus(items, id, status, fields); notify(); }
  function update(id, fields) { items = qs.update(items, id, fields); notify(); }

  function addUrls(list) {
    var added = list.map(function (x) { return qs.makeItem(deps.makeId(), x.url, x.opts || {}); });
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
          if (err) { items = qs.setStatus(items, id, 'queued', { title: url, statusMsg: 'title unavailable' }); }
          else {
            items = qs.setStatus(items, id, 'queued', {
              title: info.title, durationSec: info.durationSec,
              thumbnail: info.thumbnail || null, uploader: info.uploader || null
            });
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
    items = qs.setStatus(items, id, 'downloading', { progress: 0, statusMsg: 'Starting…' }); notify();

    deps.resolveOutputDir(next.opts, function (derr, outputDir) {
      if (derr) { setStatus(id, 'error', { statusMsg: derr.message }); pumpDownloads(); return; }
      var dlOpts = Object.assign({}, next.opts, { url: next.url, outputDir: outputDir, extRoot: deps.extRoot });
      deps.download(dlOpts, {
        onProgress: function (pct, msg) {
          var fields = { statusMsg: msg || '' };
          if (pct !== null && pct !== undefined) fields.progress = pct;
          update(id, fields);
        },
        onProc: function (p) { procs[id] = p; }
      }, function (err, res) {
        delete procs[id];
        if (err) {
          setStatus(id, 'error', { statusMsg: err.message, errorHint: err.hint || null });
          pumpDownloads();
          return;
        }
        update(id, { statusMsg: 'Importing…', progress: 100 });
        deps.importFile(res.path, function (impErr) {
          setStatus(id, 'done', {
            outputPath: res.path,
            statusMsg: impErr ? ('Downloaded (import failed): ' + impErr.message) : (res.size || 'Done')
          });
          pumpDownloads();
        });
      });
    });
  }

  function cancel(id) {
    if (procs[id]) { try { procs[id].kill(); } catch (e) {} delete procs[id]; }
    items = qs.setStatus(items, id, 'canceled', { statusMsg: 'Canceled' }); notify();
    pumpDownloads();
  }

  function cancelAll() {
    for (var k in procs) { if (procs.hasOwnProperty(k)) { try { procs[k].kill(); } catch (e) {} } }
    procs = {};
    items = items.map(function (it) {
      var active = it.status === 'pending' || it.status === 'fetching-info' || it.status === 'queued' || it.status === 'downloading';
      return active ? Object.assign({}, it, { status: 'canceled', statusMsg: 'Canceled' }) : it;
    });
    notify();
  }

  function remove(id) {
    var active = qs.firstWithStatus(items, 'downloading');
    if (active && active.id === id) return; // can't remove the active download; cancel it first
    items = qs.remove(items, id); notify();
  }

  function retry(id) {
    var it = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) it = items[i];
    if (!it || (it.status !== 'error' && it.status !== 'canceled')) return;
    items = qs.setStatus(items, id, 'queued', { statusMsg: '', errorHint: null, progress: 0 });
    notify();
    pumpDownloads();
  }

  function clearDone() { items = qs.clearDone(items); notify(); }
  function getItems() { return items; }

  return {
    addUrls: addUrls, cancel: cancel, cancelAll: cancelAll, retry: retry,
    remove: remove, clearDone: clearDone, getItems: getItems
  };
}

module.exports = { createQueue: createQueue };
