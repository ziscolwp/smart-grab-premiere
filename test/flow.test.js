const test = require('node:test');
const assert = require('node:assert');
const F = require('../panel/js/flow.js');

// A real Google Flow share link (labs.google ▸ hover clip ▸ More ▸ Share ▸ Copy link).
const SHARE = 'https://labs.google/fx/tools/flow/shared/video/be83e530-cac3-43ed-90e4-77dfe9efe1ec';

test('shareId: extracts the UUID from a share link', () => {
  assert.strictEqual(F.shareId(SHARE), 'be83e530-cac3-43ed-90e4-77dfe9efe1ec');
});

test('shareId: empty for non-share Flow URLs, other sites, and junk', () => {
  assert.strictEqual(F.shareId('https://labs.google/fx/tools/flow/project/abc123'), '');
  assert.strictEqual(F.shareId('https://www.youtube.com/watch?v=x'), '');
  assert.strictEqual(F.shareId(''), '');
  assert.strictEqual(F.shareId(null), '');
});

test('outputTemplate: clean "Flow clip [short].%(ext)s" from a share link', () => {
  assert.strictEqual(F.outputTemplate(SHARE), 'Flow clip [be83e530].%(ext)s');
});

test('outputTemplate: short id is the first 8 hex chars, hyphens removed', () => {
  const tpl = F.outputTemplate('https://labs.google/fx/tools/flow/shared/video/12345678-aaaa-bbbb-cccc-ddddeeeeffff');
  assert.strictEqual(tpl, 'Flow clip [12345678].%(ext)s');
});

test('outputTemplate: null for non-share URLs so yt-dlp keeps its default naming', () => {
  // The editor/project URL has no shareable video — must not get a Flow name.
  assert.strictEqual(F.outputTemplate('https://labs.google/fx/tools/flow/project/abc123'), null);
  assert.strictEqual(F.outputTemplate('https://vimeo.com/123'), null);
  assert.strictEqual(F.outputTemplate(''), null);
  assert.strictEqual(F.outputTemplate(null), null);
});
