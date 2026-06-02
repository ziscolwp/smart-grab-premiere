const test = require('node:test');
const assert = require('node:assert');
const E = require('../panel/js/editKeys.js');

test('editAction maps Cmd+V to paste', () => {
  assert.strictEqual(E.editAction({ metaKey: true, key: 'v' }), 'paste');
});
test('editAction maps Ctrl+V to paste (fallback)', () => {
  assert.strictEqual(E.editAction({ ctrlKey: true, key: 'V' }), 'paste');
});
test('editAction maps Cmd+C / X / A', () => {
  assert.strictEqual(E.editAction({ metaKey: true, key: 'c' }), 'copy');
  assert.strictEqual(E.editAction({ metaKey: true, key: 'x' }), 'cut');
  assert.strictEqual(E.editAction({ metaKey: true, key: 'a' }), 'selectAll');
});
test('editAction returns null without a modifier', () => {
  assert.strictEqual(E.editAction({ key: 'v' }), null);
});
test('editAction returns null for unrelated keys', () => {
  assert.strictEqual(E.editAction({ metaKey: true, key: 's' }), null);
});
test('editAction ignores Option/Alt combos', () => {
  assert.strictEqual(E.editAction({ metaKey: true, altKey: true, key: 'v' }), null);
});

test('applyPaste inserts at caret (collapsed selection)', () => {
  // value "ab|cd", paste "X" at index 2
  assert.deepStrictEqual(E.applyPaste('abcd', 2, 2, 'X'), { value: 'abXcd', caret: 3 });
});
test('applyPaste replaces a selection', () => {
  // select "bc" in "abcd", paste "XYZ"
  assert.deepStrictEqual(E.applyPaste('abcd', 1, 3, 'XYZ'), { value: 'aXYZd', caret: 4 });
});
test('applyPaste replaces whole field (select-all then paste)', () => {
  assert.deepStrictEqual(E.applyPaste('old-url', 0, 7, 'https://new'), { value: 'https://new', caret: 11 });
});

test('applyCut removes selection and reports removed text', () => {
  assert.deepStrictEqual(E.applyCut('abcd', 1, 3), { value: 'ad', caret: 1, removed: 'bc' });
});
test('applyCut with collapsed selection is a no-op removal', () => {
  assert.deepStrictEqual(E.applyCut('abcd', 2, 2), { value: 'abcd', caret: 2, removed: '' });
});
