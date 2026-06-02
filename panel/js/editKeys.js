// panel/js/editKeys.js
// Pure helpers for keyboard editing in the CEP panel. No DOM, no I/O — unit-testable.
// CEP's CEF does not wire the macOS Edit accelerators (Cmd+V/C/X/A) for text inputs,
// so we detect them ourselves and apply the edits to an input's value.

function editAction(ev) {
  if (!ev || ev.altKey) return null;
  if (!(ev.metaKey || ev.ctrlKey)) return null;
  switch (String(ev.key || '').toLowerCase()) {
    case 'v': return 'paste';
    case 'c': return 'copy';
    case 'x': return 'cut';
    case 'a': return 'selectAll';
    default: return null;
  }
}

// Insert `clip` over the range [start, end) of `value`. Returns new value + caret.
function applyPaste(value, start, end, clip) {
  var next = value.slice(0, start) + clip + value.slice(end);
  return { value: next, caret: start + clip.length };
}

// Remove the range [start, end) from `value`. Returns new value, caret, and removed text.
function applyCut(value, start, end) {
  return {
    value: value.slice(0, start) + value.slice(end),
    caret: start,
    removed: value.slice(start, end)
  };
}

module.exports = { editAction: editAction, applyPaste: applyPaste, applyCut: applyCut };
