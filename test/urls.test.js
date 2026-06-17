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

test('source identifies the major sites', () => {
  assert.strictEqual(U.source('https://www.youtube.com/watch?v=a').key, 'youtube');
  assert.strictEqual(U.source('https://www.instagram.com/reel/abc/').key, 'instagram');
  assert.strictEqual(U.source('https://x.com/user/status/1').key, 'twitter');
  assert.strictEqual(U.source('https://twitter.com/user/status/1').key, 'twitter');
  assert.strictEqual(U.source('https://www.reddit.com/r/videos/comments/x/').key, 'reddit');
  assert.strictEqual(U.source('https://www.tiktok.com/@u/video/1').key, 'tiktok');
  assert.strictEqual(U.source('https://www.loom.com/share/abc').key, 'loom');
  assert.strictEqual(U.source('https://vimeo.com/123').key, 'vimeo');
  assert.strictEqual(U.source('https://www.twitch.tv/videos/1').key, 'twitch');
  assert.strictEqual(U.source('https://fb.watch/abc/').key, 'facebook');
});
test('source identifies Google Flow share links', () => {
  assert.strictEqual(U.source('https://labs.google/fx/tools/flow/shared/video/be83e530-cac3-43ed-90e4-77dfe9efe1ec').key, 'flow');
});
test('source falls back to generic web', () => {
  assert.strictEqual(U.source('https://example.com/video.mp4').key, 'web');
});
test('source does not mistake xyz domains containing x for twitter', () => {
  assert.strictEqual(U.source('https://example.xyz/x.com/page').key, 'web');
});

test('usuallyNeedsCookies flags login-walled sites', () => {
  assert.strictEqual(U.usuallyNeedsCookies('instagram'), true);
  assert.strictEqual(U.usuallyNeedsCookies('twitter'), true);
  assert.strictEqual(U.usuallyNeedsCookies('youtube'), false);
  assert.strictEqual(U.usuallyNeedsCookies('loom'), false);
});
