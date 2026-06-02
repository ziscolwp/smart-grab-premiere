const test = require('node:test');
const assert = require('node:assert');
const U = require('../panel/js/urls.js');

test('parse splits lines/whitespace and keeps only http(s)', () => {
  const text = 'https://a.com/1\n  https://b.com/2 \nnot a url\nhttp://c.com/3';
  assert.deepStrictEqual(U.parse(text), ['https://a.com/1', 'https://b.com/2', 'http://c.com/3']);
});
test('parse returns [] for empty', () => {
  assert.deepStrictEqual(U.parse(''), []);
  assert.deepStrictEqual(U.parse('   \n  '), []);
});

test('classify: watch / youtu.be => video', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/watch?v=abc'), 'video');
  assert.strictEqual(U.classify('https://youtu.be/abc'), 'video');
});
test('classify: watch with list still => video (single, safe default)', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/watch?v=abc&list=PL123'), 'video');
});
test('classify: pure playlist => playlist', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/playlist?list=PL123'), 'playlist');
});
test('classify: channel forms => channel', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/@SomeHandle'), 'channel');
  assert.strictEqual(U.classify('https://www.youtube.com/channel/UC123'), 'channel');
});
test('classify: non-youtube http => video; non-url => invalid', () => {
  assert.strictEqual(U.classify('https://vimeo.com/123'), 'video');
  assert.strictEqual(U.classify('ftp://x'), 'invalid');
});
