const test = require('node:test');
const assert = require('node:assert');
const qr = require('../panel/js/queueRender.js');

function item(over) {
  return Object.assign({
    id: 'q1', url: 'https://youtube.com/watch?v=abc', title: null, durationSec: null,
    status: 'pending', progress: 0, statusMsg: '', thumbnail: null, outputPath: null, errorHint: null
  }, over || {});
}

// ---- badge / summary (existing behavior, locked down) ----------------------
test('badge maps each status to human copy', () => {
  assert.strictEqual(qr.badge(item({ status: 'pending' })), 'Waiting…');
  assert.strictEqual(qr.badge(item({ status: 'fetching-info' })), 'Reading link…');
  assert.strictEqual(qr.badge(item({ status: 'queued' })), 'Queued');
  assert.strictEqual(qr.badge(item({ status: 'downloading', statusMsg: '42%' })), '42%');
  assert.strictEqual(qr.badge(item({ status: 'done', statusMsg: '3 MB' })), '✓ 3 MB');
  assert.strictEqual(qr.badge(item({ status: 'error', statusMsg: 'nope' })), 'nope');
});

test('summary counts done / failed / left', () => {
  assert.strictEqual(qr.summary([]), '');
  const items = [
    item({ status: 'done' }), item({ status: 'error' }),
    item({ status: 'downloading' }), item({ status: 'canceled' })
  ];
  assert.strictEqual(qr.summary(items), '— 1 done · 1 failed · 1 left');
});

// ---- rowShapeKey: when a row must be structurally rebuilt ------------------
test('rowShapeKey is stable while only progress/status text changes', () => {
  const a = item({ status: 'downloading', progress: 10, statusMsg: '10%' });
  const b = item({ status: 'downloading', progress: 90, statusMsg: '90%' });
  assert.strictEqual(qr.rowShapeKey(a), qr.rowShapeKey(b));
});

test('rowShapeKey changes when status changes (buttons / progress bar differ)', () => {
  assert.notStrictEqual(
    qr.rowShapeKey(item({ status: 'downloading' })),
    qr.rowShapeKey(item({ status: 'done', outputPath: '/x.mp4' }))
  );
});

test('rowShapeKey changes when a thumbnail, duration, error hint or output path appears', () => {
  const base = item({ status: 'queued' });
  assert.notStrictEqual(qr.rowShapeKey(base), qr.rowShapeKey(item({ status: 'queued', thumbnail: 'https://t/x.jpg' })));
  assert.notStrictEqual(qr.rowShapeKey(base), qr.rowShapeKey(item({ status: 'queued', durationSec: 30 })));
  assert.notStrictEqual(
    qr.rowShapeKey(item({ status: 'error' })),
    qr.rowShapeKey(item({ status: 'error', errorHint: 'try again' }))
  );
});

// ---- classifyChange: structural rebuild vs cheap in-place patch ------------
test('classifyChange: same list reference-equal items -> no structural, no updates', () => {
  const list = [item({ status: 'downloading', progress: 5 })];
  const c = qr.classifyChange(list, list);
  assert.strictEqual(c.structural, false);
  assert.deepStrictEqual(c.updates, []);
});

test('classifyChange: a progress tick is a non-structural in-place update', () => {
  const prev = [item({ status: 'downloading', progress: 5, statusMsg: '5%' })];
  const next = [item({ status: 'downloading', progress: 55, statusMsg: '55%' })];
  const c = qr.classifyChange(prev, next);
  assert.strictEqual(c.structural, false);
  assert.strictEqual(c.updates.length, 1);
  assert.strictEqual(c.updates[0].progress, 55);
});

test('classifyChange: a title/thumbnail arriving updates the row (thumbnail toggles structure)', () => {
  const prev = [item({ status: 'queued', title: null })];
  const next = [item({ status: 'queued', title: 'Real Title' })];
  const c = qr.classifyChange(prev, next);
  assert.strictEqual(c.structural, false);
  assert.strictEqual(c.updates.length, 1);
  // thumbnail appearing is a shape change -> structural
  assert.strictEqual(qr.classifyChange(prev, [item({ status: 'queued', thumbnail: 'https://t/x.jpg' })]).structural, true);
});

test('classifyChange: status transition is structural (buttons + bar change)', () => {
  const prev = [item({ status: 'downloading', progress: 99 })];
  const next = [item({ status: 'done', progress: 100, outputPath: '/x.mp4', statusMsg: 'Done' })];
  assert.strictEqual(qr.classifyChange(prev, next).structural, true);
});

test('classifyChange: add / remove / reorder are structural', () => {
  const a = item({ id: 'q1' }), b = item({ id: 'q2' });
  assert.strictEqual(qr.classifyChange([a], [a, b]).structural, true);       // add
  assert.strictEqual(qr.classifyChange([a, b], [a]).structural, true);       // remove
  assert.strictEqual(qr.classifyChange([a, b], [b, a]).structural, true);    // reorder
});

test('classifyChange: empty <-> non-empty is structural', () => {
  assert.strictEqual(qr.classifyChange([], [item()]).structural, true);
  assert.strictEqual(qr.classifyChange([item()], []).structural, true);
});
