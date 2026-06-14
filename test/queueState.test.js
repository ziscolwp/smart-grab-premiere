const test = require('node:test');
const assert = require('node:assert');
const Q = require('../panel/js/queueState.js');

test('makeItem starts pending with defaults', () => {
  const it = Q.makeItem('id1', 'https://x/1', { quality: 'fhd' });
  assert.strictEqual(it.id, 'id1');
  assert.strictEqual(it.url, 'https://x/1');
  assert.strictEqual(it.status, 'pending');
  assert.strictEqual(it.title, null);
  assert.strictEqual(it.progress, 0);
  assert.deepStrictEqual(it.opts, { quality: 'fhd' });
});

test('makeItem includes persistence fields', () => {
  const it = Q.makeItem('q1', 'https://x.test', {}, { now: () => 123, workDir: '/work/q1' });
  assert.strictEqual(it.attemptCount, 0);
  assert.strictEqual(it.workDir, '/work/q1');
  assert.deepStrictEqual(it.outputPaths, []);
  assert.strictEqual(it.createdAt, 123);
  assert.strictEqual(it.updatedAt, 123);
});

test('add appends without mutating the original list', () => {
  const a = [Q.makeItem('1', 'u1', {})];
  const b = Q.add(a, [Q.makeItem('2', 'u2', {})]);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(b.length, 2);
});

test('setStatus updates only the target item and merges fields', () => {
  let list = [Q.makeItem('1', 'u1', {}), Q.makeItem('2', 'u2', {})];
  list = Q.setStatus(list, '2', 'queued', { title: 'Hello', durationSec: 100 });
  assert.strictEqual(list[0].status, 'pending');
  assert.strictEqual(list[1].status, 'queued');
  assert.strictEqual(list[1].title, 'Hello');
  assert.strictEqual(list[1].durationSec, 100);
});

test('nextQueued returns the first queued item, anyDownloading detects active', () => {
  let list = [Q.makeItem('1', 'u1', {}), Q.makeItem('2', 'u2', {}), Q.makeItem('3', 'u3', {})];
  list = Q.setStatus(list, '1', 'done', {});
  list = Q.setStatus(list, '2', 'queued', {});
  list = Q.setStatus(list, '3', 'queued', {});
  assert.strictEqual(Q.nextQueued(list).id, '2');
  assert.strictEqual(Q.anyDownloading(list), false);
  list = Q.setStatus(list, '2', 'downloading', {});
  assert.strictEqual(Q.anyDownloading(list), true);
});

test('firstWithStatus finds by status or null', () => {
  let list = [Q.makeItem('1', 'u1', {})];
  assert.strictEqual(Q.firstWithStatus(list, 'pending').id, '1');
  assert.strictEqual(Q.firstWithStatus(list, 'done'), null);
});

test('remove deletes by id; clearDone strips terminal states', () => {
  let list = [Q.makeItem('1', 'u1', {}), Q.makeItem('2', 'u2', {}), Q.makeItem('3', 'u3', {})];
  list = Q.setStatus(list, '1', 'done', {});
  list = Q.setStatus(list, '2', 'error', {});
  list = Q.remove(list, '3');
  assert.strictEqual(list.length, 2);
  list = Q.clearDone(list);
  assert.strictEqual(list.length, 0);
});

test('rehydrate resets live statuses to safe states', () => {
  const items = Q.rehydrate([
    { id: 'a', status: 'fetching-info', url: 'u' },
    { id: 'b', status: 'downloading', url: 'u', workDir: '/w' },
    { id: 'c', status: 'importing', url: 'u', outputPath: '/done.mp4' }
  ], { existsSync: (p) => p === '/done.mp4', now: () => 1000 });
  assert.strictEqual(items[0].status, 'pending');
  assert.strictEqual(items[1].status, 'canceled');
  assert.strictEqual(items[1].retryable, true);
  assert.strictEqual(items[2].status, 'done');
});
