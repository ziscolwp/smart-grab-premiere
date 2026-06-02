const test = require('node:test');
const assert = require('node:assert');
const T = require('../panel/js/timecode.js');

test('secondsToHMS pads to HH:MM:SS', () => {
  assert.strictEqual(T.secondsToHMS(0), '00:00:00');
  assert.strictEqual(T.secondsToHMS(5), '00:00:05');
  assert.strictEqual(T.secondsToHMS(90), '00:01:30');
  assert.strictEqual(T.secondsToHMS(3661), '01:01:01');
  assert.strictEqual(T.secondsToHMS(636), '00:10:36');
});

test('secondsToHMS floors and guards negatives/NaN', () => {
  assert.strictEqual(T.secondsToHMS(90.9), '00:01:30');
  assert.strictEqual(T.secondsToHMS(-5), '00:00:00');
  assert.strictEqual(T.secondsToHMS(NaN), '00:00:00');
});

test('clampRange keeps 0 <= start <= end <= dur', () => {
  assert.deepStrictEqual(T.clampRange(10, 20, 100), { start: 10, end: 20 });
  assert.deepStrictEqual(T.clampRange(-5, 200, 100), { start: 0, end: 100 });
  assert.deepStrictEqual(T.clampRange(50, 30, 100), { start: 50, end: 50 });
});

test('parseFlexible: bare number is seconds', () => {
  assert.strictEqual(T.parseFlexible('90'), 90);
  assert.strictEqual(T.parseFlexible('5'), 5);
});
test('parseFlexible: colon / separator forms', () => {
  assert.strictEqual(T.parseFlexible('1:30'), 90);
  assert.strictEqual(T.parseFlexible('1:30:00'), 5400);
  assert.strictEqual(T.parseFlexible('1.30'), 90);
  assert.strictEqual(T.parseFlexible('0:05'), 5);
});
test('parseFlexible: natural language', () => {
  assert.strictEqual(T.parseFlexible('1m30s'), 90);
  assert.strictEqual(T.parseFlexible('2h'), 7200);
});
test('parseFlexible: invalid -> null', () => {
  assert.strictEqual(T.parseFlexible(''), null);
  assert.strictEqual(T.parseFlexible('abc'), null);
  assert.strictEqual(T.parseFlexible('1:2:3:4'), null);
});
