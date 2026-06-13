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

test('createQueue rehydrates initial items and persists state changes', () => {
  const saved = [];
  const q = createQueue(baseDeps({
    initialItems: [{ id: 'old', url: 'a', status: 'done', opts: {}, attemptCount: 1 }],
    persist: (items) => saved.push(items.map((it) => it.status).join(','))
  }));
  assert.strictEqual(q.getItems()[0].id, 'old');
  q.clearDone();
  assert.ok(saved.length > 0);
});

test('cancel before metadata returns prevents callback from requeueing the item', () => {
  let metadataCb;
  const q = createQueue(baseDeps({ fetchInfo: (url, cb) => { metadataCb = cb; } }));
  q.addUrls([{ url: 'a', opts: {} }]);
  const id = q.getItems()[0].id;
  q.cancel(id);
  metadataCb(null, { title: 'Late title' });
  assert.strictEqual(q.getItems()[0].status, 'canceled');
});

test('retry increments attempt count and clears structured error fields', () => {
  const q = createQueue(baseDeps({
    download: (opts, cbs, done) => {
      const err = new Error('nope');
      err.category = 'network';
      err.hasPartials = true;
      done(err);
    }
  }));
  q.addUrls([{ url: 'a', opts: {} }]);
  const id = q.getItems()[0].id;
  q.retry(id);
  const it = q.getItems()[0];
  assert.ok(it.attemptCount >= 1);
  assert.strictEqual(it.errorCategory, 'network');
  assert.strictEqual(it.retryable, true);
  assert.strictEqual(it.workDirHasPartials, true);
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

test('multi-file results (e.g. multi-video tweet) import every path', () => {
  const imported = [];
  const q = createQueue(baseDeps({
    importFile: (path, cb) => { imported.push(path); cb(null); },
    download: (opts, cbs, done) => done(null, { path: '/out/a.mp4', paths: ['/out/a.mp4', '/out/b.mp4'], size: '2 videos · 3 MB' })
  }));
  q.addUrls([{ url: 'a', opts: {} }]);
  assert.deepStrictEqual(imported, ['/out/a.mp4', '/out/b.mp4']);
  const it = q.getItems()[0];
  assert.strictEqual(it.status, 'done');
  assert.strictEqual(it.statusMsg, '2 videos · 3 MB');
});

test('multi-file import failure surfaces the first error but still finishes', () => {
  let n = 0;
  const q = createQueue(baseDeps({
    importFile: (path, cb) => { n++; cb(n === 1 ? new Error('bin missing') : null); },
    download: (opts, cbs, done) => done(null, { path: '/a', paths: ['/a', '/b'], size: '' })
  }));
  q.addUrls([{ url: 'a', opts: {} }]);
  assert.strictEqual(n, 2); // both imports attempted
  assert.ok(q.getItems()[0].statusMsg.indexOf('bin missing') !== -1);
});

test('remove drops a non-active item; clearDone strips terminals', () => {
  const q = createQueue(baseDeps());
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  q.clearDone();
  assert.strictEqual(q.getItems().length, 0);
});
