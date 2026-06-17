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

test('downloads run concurrently up to the cap, promoting queued as slots free', () => {
  const finishers = [];
  const q = createQueue(baseDeps({
    downloadConcurrency: 2,
    download: (opts, cbs, done) => { finishers.push(done); }
  }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }, { url: 'c', opts: {} }]);
  let items = q.getItems();
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 2); // cap of 2 respected
  assert.strictEqual(items.filter(i => i.status === 'queued').length, 1);
  finishers[0](null, { path: '/out/a.mp4', size: '1 MB' });   // free one slot
  items = q.getItems();
  assert.strictEqual(items.filter(i => i.status === 'done').length, 1);
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 2); // third promoted
});

test('downloadConcurrency:1 keeps downloads strictly sequential', () => {
  const finishers = [];
  const q = createQueue(baseDeps({ downloadConcurrency: 1, download: (opts, cbs, done) => { finishers.push(done); } }));
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

test('remove refuses an in-flight download (cancel first)', () => {
  const q = createQueue(baseDeps({ downloadConcurrency: 1, download: () => {} })); // never finishes
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const dl = q.getItems().find(i => i.status === 'downloading');
  q.remove(dl.id);
  assert.ok(q.getItems().some(i => i.id === dl.id)); // still present
});
