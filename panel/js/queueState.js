// panel/js/queueState.js
function makeItem(id, url, opts, extra) {
  extra = extra || {};
  var now = extra.now ? extra.now() : Date.now();
  return {
    id: id, url: url, title: null, durationSec: null,
    status: 'pending', progress: 0, statusMsg: '',
    opts: opts || {}, outputPath: null, outputPaths: [],
    errorHint: null, errorCategory: null, retryable: false,
    attemptCount: 0, workDir: extra.workDir || null, workDirHasPartials: false,
    createdAt: now, updatedAt: now
  };
}

function add(list, items) { return list.concat(items); }

function update(list, id, fields) {
  return list.map(function (it) {
    return it.id === id ? Object.assign({}, it, fields) : it;
  });
}

function setStatus(list, id, status, fields) {
  return update(list, id, Object.assign({}, fields || {}, { status: status }));
}

function firstWithStatus(list, status) {
  for (var i = 0; i < list.length; i++) { if (list[i].status === status) return list[i]; }
  return null;
}

function itemById(list, id) {
  for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
  return null;
}

function isTerminalStatus(status) {
  return status === 'done' || status === 'error' || status === 'canceled';
}

function isActiveStatus(status) {
  return status === 'pending' || status === 'fetching-info' || status === 'queued' || status === 'downloading' || status === 'importing';
}

function normalizeItem(raw, deps) {
  deps = deps || {};
  var now = deps.now ? deps.now() : Date.now();
  var base = makeItem(raw.id, raw.url, raw.opts || {}, { now: function () { return raw.createdAt || now; }, workDir: raw.workDir || null });
  var item = Object.assign({}, base, raw);
  if (!Array.isArray(item.outputPaths)) item.outputPaths = item.outputPath ? [item.outputPath] : [];
  if (item.attemptCount == null) item.attemptCount = 0;
  if (item.retryable == null) item.retryable = false;
  if (item.workDirHasPartials == null) item.workDirHasPartials = false;
  item.updatedAt = now;

  if (item.status === 'fetching-info') {
    item.status = 'pending';
    item.progress = 0;
    item.statusMsg = '';
  } else if (item.status === 'downloading') {
    item.status = 'canceled';
    item.retryable = true;
    item.workDirHasPartials = true;
    item.statusMsg = 'Interrupted when the panel closed';
  } else if (item.status === 'importing') {
    var exists = deps.existsSync || function () { return false; };
    if (item.outputPath && exists(item.outputPath)) {
      item.status = 'done';
      item.statusMsg = item.statusMsg || 'Downloaded';
      item.progress = 100;
    } else {
      item.status = 'error';
      item.errorCategory = item.errorCategory || 'import';
      item.statusMsg = 'Import was interrupted and the output file could not be found.';
    }
  }
  return item;
}

function rehydrate(items, deps) {
  if (!Array.isArray(items)) return [];
  return items.map(function (it) { return normalizeItem(it, deps); });
}

function nextQueued(list) { return firstWithStatus(list, 'queued'); }
function anyDownloading(list) { return !!firstWithStatus(list, 'downloading'); }
function remove(list, id) { return list.filter(function (it) { return it.id !== id; }); }
function clearDone(list) {
  return list.filter(function (it) {
    return it.status !== 'done' && it.status !== 'error' && it.status !== 'canceled';
  });
}

module.exports = {
  makeItem: makeItem, add: add, update: update, setStatus: setStatus,
  firstWithStatus: firstWithStatus, nextQueued: nextQueued,
  anyDownloading: anyDownloading, remove: remove, clearDone: clearDone,
  itemById: itemById, isTerminalStatus: isTerminalStatus,
  isActiveStatus: isActiveStatus, rehydrate: rehydrate
};
