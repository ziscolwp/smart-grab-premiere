const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../panel/js/queueStore.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg_queue_'));
}

test('load returns an empty v1 snapshot when the file is missing', () => {
  const file = path.join(tmpDir(), 'queue.json');
  assert.deepStrictEqual(store.load(file), { version: 1, items: [] });
});

test('save then load round-trips queue items', () => {
  const file = path.join(tmpDir(), 'queue.json');
  assert.strictEqual(store.save({ version: 1, items: [{ id: 'q1', url: 'https://x.test' }] }, file), true);
  assert.strictEqual(store.load(file).items[0].id, 'q1');
});

test('load backs up corrupt JSON and returns an empty queue', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'queue.json');
  fs.writeFileSync(file, '{ bad', 'utf8');
  assert.deepStrictEqual(store.load(file), { version: 1, items: [] });
  assert.ok(fs.readdirSync(dir).some((name) => /^queue\.json\.bad-/.test(name)));
});

test('clear removes the queue file', () => {
  const file = path.join(tmpDir(), 'queue.json');
  store.save({ version: 1, items: [] }, file);
  assert.strictEqual(store.clear(file), true);
  assert.strictEqual(fs.existsSync(file), false);
});
