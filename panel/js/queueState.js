// panel/js/queueState.js
function makeItem(id, url, opts) {
  return {
    id: id, url: url, title: null, durationSec: null,
    status: 'pending', progress: 0, statusMsg: '',
    opts: opts || {}, outputPath: null
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
  anyDownloading: anyDownloading, remove: remove, clearDone: clearDone
};
