const test = require('node:test');
const assert = require('node:assert');
const { createQueue } = require('../panel/js/queue.js');

function baseDeps(over) {
  let idc = 0;
  return Object.assign({
    extRoot: '/ext',
    makeId: () => 'q' + (++idc),
    onChange: () => {},
    fetchInfo: (url, cb) => cb(null, { title: 'T:' + url, durationSec: 100 }),
    resolveOutputDir: (opts, cb) => cb(null, '/out'),
    importFile: (path, cb) => cb(null),
    download: (opts, cbs, done) => { cbs.onProgress(50, 'half'); done(null, { path: '/out/f.mp4', size: '1 MB' }); },
    titleConcurrency: 2
  }, over || {});
}

test('synchronous fakes: all items reach done', () => {
  const q = createQueue(baseDeps());
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const items = q.getItems();
  assert.strictEqual(items.length, 2);
  assert.ok(items.every(i => i.status === 'done'));
  assert.strictEqual(items[0].title, 'T:a');
});

test('downloads run one at a time (sequential)', () => {
  const finishers = [];
  const q = createQueue(baseDeps({ download: (opts, cbs, done) => { finishers.push(done); } }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  let items = q.getItems();
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 1);
  assert.strictEqual(items.filter(i => i.status === 'queued').length, 1);
  finishers[0](null, { path: '/out/a.mp4', size: '1 MB' });
  items = q.getItems();
  assert.strictEqual(items.filter(i => i.status === 'done').length, 1);
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 1);
});

test('download error marks item error and advances to the next', () => {
  let n = 0;
  const q = createQueue(baseDeps({
    download: (opts, cbs, done) => { n++; n === 1 ? done(new Error('boom')) : done(null, { path: '/x', size: '1 MB' }); }
  }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const items = q.getItems();
  assert.strictEqual(items[0].status, 'error');
  assert.ok(items[0].statusMsg.indexOf('boom') !== -1);
  assert.strictEqual(items[1].status, 'done');
});

test('title fetch failure still queues the item (title falls back to URL)', () => {
  const q = createQueue(baseDeps({ fetchInfo: (url, cb) => cb(new Error('private')) }));
  q.addUrls([{ url: 'a', opts: {} }]);
  const it = q.getItems()[0];
  assert.strictEqual(it.status, 'done');
  assert.strictEqual(it.title, 'a');
});

test('cancel kills the active process and advances', () => {
  let killed = false;
  const finishers = [];
  const q = createQueue(baseDeps({
    download: (opts, cbs, done) => { cbs.onProc({ kill: () => { killed = true; } }); finishers.push(done); }
  }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const firstId = q.getItems()[0].id;
  q.cancel(firstId);
  assert.strictEqual(killed, true);
  const items = q.getItems();
  assert.strictEqual(items[0].status, 'canceled');
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 1);
});

test('remove drops a non-active item; clearDone strips terminals', () => {
  const q = createQueue(baseDeps());
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  q.clearDone();
  assert.strictEqual(q.getItems().length, 0);
});
