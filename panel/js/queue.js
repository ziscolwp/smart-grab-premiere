// panel/js/queue.js
// Orchestrates a download queue: a title-fetch pool feeds a single sequential downloader.
// All I/O (fetchInfo/download/importFile/resolveOutputDir) is injected via deps so this is
// fully unit-testable with fakes. Holds the live item list; notifies the UI via deps.onChange.
var qs = require('./queueState.js');

function createQueue(deps) {
  var items = [];
  var fetching = 0;
  var CONC = deps.titleConcurrency || 4;
  // Downloads are network-bound (mostly waiting on the server), so running a
  // few at once near-linearly cuts wall-clock time for a multi-URL batch.
  var DL_CONC = deps.downloadConcurrency || 3;
  var procs = {};       // id -> child process (kept out of item objects)
  var importing = {};   // id -> true while the file is on disk and being imported
  var importJobs = [];  // FIFO of { id, res } awaiting a host import
  var importBusy = false;

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

  // Title/thumbnail fetch — runs in parallel with downloading, never gates it.
  // Writes via update() (title/durationSec/thumbnail/uploader/infoState) so it
  // never clobbers the item's live download `status` or progress message: a
  // title can land while the row is already downloading or even done.
  function pumpTitles() {
    while (fetching < CONC) {
      var pend = qs.firstWithInfoState(items, 'pending');
      if (!pend) break;
      items = qs.update(items, pend.id, { infoState: 'fetching' }); notify();
      fetching++;
      (function (id, url) {
        deps.fetchInfo(url, function (err, info) {
          fetching--;
          if (err) {
            items = qs.update(items, id, { infoState: 'done', title: url });
          } else {
            items = qs.update(items, id, {
              infoState: 'done', title: info.title, durationSec: info.durationSec,
              thumbnail: info.thumbnail || null, uploader: info.uploader || null
            });
          }
          notify();
          pumpTitles();
        });
      })(pend.id, pend.url);
    }
  }

  // A download slot is occupied only while bytes are actually transferring — an
  // item whose file is already on disk and is now being imported (still shown as
  // 'downloading' with an 'Importing…' message) has freed its bandwidth, so it
  // no longer counts against the cap.
  function countDownloading() {
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].status === 'downloading' && !importing[items[i].id]) n++;
    }
    return n;
  }

  // Fill every free download slot. Each item flips to 'downloading' synchronously
  // before the next is picked, so the same item is never started twice; a slot
  // frees when a download finishes/errors, which re-calls this to top up.
  function pumpDownloads() {
    while (countDownloading() < DL_CONC) {
      var next = qs.nextQueued(items);
      if (!next) break;
      items = qs.setStatus(items, next.id, 'downloading', { progress: 0, statusMsg: 'Starting…' }); notify();
      startDownload(next.id, next.url, next.opts);
    }
  }

  function startDownload(id, url, opts) {
    deps.resolveOutputDir(opts, function (derr, outputDir) {
      if (derr) { setStatus(id, 'error', { statusMsg: derr.message }); pumpDownloads(); return; }
      var dlOpts = Object.assign({}, opts, { url: url, outputDir: outputDir, extRoot: deps.extRoot });
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
        // The file is on disk. Hand the import to the FIFO, then free the download
        // slot so the next grab starts immediately — the import (single-threaded,
        // and slow when Premiere is busy) runs concurrently instead of stalling
        // otherwise-idle download bandwidth.
        importing[id] = true;
        update(id, { statusMsg: 'Importing…', progress: 100 });
        enqueueImport(id, res);
        pumpDownloads();
      });
    });
  }

  // Imports are serialized through this FIFO: Premiere's host is single-threaded,
  // so concurrent importFiles calls would race the find-or-create-bin logic and
  // could spawn duplicate bins. Each item's media files (a post can yield several,
  // e.g. a multi-video tweet) are handed over in a single importFile call.
  function enqueueImport(id, res) {
    importJobs.push({ id: id, res: res });
    drainImports();
  }
  function itemById(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function drainImports() {
    if (importBusy) return;
    var job = importJobs.shift();
    if (!job) return;
    // The user may have canceled/removed this item while it waited in the queue —
    // don't import a file they no longer want.
    var pending = itemById(job.id);
    if (!pending || pending.status === 'canceled') { delete importing[job.id]; return drainImports(); }
    importBusy = true;
    var paths = job.res.paths || [job.res.path];
    deps.importFile(paths, function (impErr) {
      importBusy = false;
      delete importing[job.id];
      var it = itemById(job.id);
      if (it && it.status !== 'canceled') {
        setStatus(job.id, 'done', {
          outputPath: job.res.path,
          statusMsg: impErr ? ('Downloaded (import failed): ' + impErr.message) : (job.res.size || 'Done')
        });
      } else {
        notify();   // canceled/removed mid-import — clean up without resurrecting it
      }
      drainImports();
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
      var active = it.status === 'queued' || it.status === 'downloading';
      return active ? Object.assign({}, it, { status: 'canceled', statusMsg: 'Canceled' }) : it;
    });
    notify();
  }

  function remove(id) {
    // With parallel downloads any item can be in flight — block removing one
    // that's downloading (cancel it first) so its row can't vanish mid-download.
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id && items[i].status === 'downloading') return;
    }
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
