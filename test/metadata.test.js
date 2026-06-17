const test = require('node:test');
const assert = require('node:assert');
const M = require('../panel/js/metadata.js');

test('parseInfoLine parses a full tab-separated info line', () => {
  const r = M.parseInfoLine('My Title\t123.4\thttps://i.ytimg.com/t.jpg\tYoutube\tSome Channel', 'https://u');
  assert.deepStrictEqual(r, {
    title: 'My Title',
    durationSec: 123,
    thumbnail: 'https://i.ytimg.com/t.jpg',
    extractor: 'Youtube',
    uploader: 'Some Channel'
  });
});

test('parseInfoLine tolerates NA fields (live/images/unknown)', () => {
  const r = M.parseInfoLine('NA\tNA\tNA\tNA\tNA', 'https://u');
  assert.strictEqual(r.title, 'https://u');
  assert.strictEqual(r.durationSec, null);
  assert.strictEqual(r.thumbnail, null);
  assert.strictEqual(r.uploader, null);
});

test('parseInfoLine rejects non-http thumbnail values', () => {
  const r = M.parseInfoLine('T\t10\tnot-a-url\tX\tU', 'https://u');
  assert.strictEqual(r.thumbnail, null);
});

test('cookieArgs maps browser choice to yt-dlp flag', () => {
  assert.deepStrictEqual(M.cookieArgs('chrome'), ['--cookies-from-browser', 'chrome']);
  assert.deepStrictEqual(M.cookieArgs('none'), []);
  assert.deepStrictEqual(M.cookieArgs(null), []);
});

test('cookieArgs: a cookies file overrides the browser choice', () => {
  assert.deepStrictEqual(M.cookieArgs('chrome', '/path/cookies.txt'), ['--cookies', '/path/cookies.txt']);
  assert.deepStrictEqual(M.cookieArgs('none', '/path/cookies.txt'), ['--cookies', '/path/cookies.txt']);
});

test('cacheKey: same url+auth => same key; different cookies/proxy => different key', () => {
  const a = M.cacheKey('https://u', { cookiesBrowser: 'chrome' });
  const b = M.cacheKey('https://u', { cookiesBrowser: 'chrome' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, M.cacheKey('https://u', { cookiesBrowser: 'firefox' }));
  assert.notStrictEqual(a, M.cacheKey('https://u', { cookiesBrowser: 'chrome', proxyUrl: 'socks5://x' }));
  assert.notStrictEqual(a, M.cacheKey('https://other', { cookiesBrowser: 'chrome' }));
});

test('cache: put then get returns the info within TTL, null after it expires', () => {
  M.clearInfoCache();
  const key = M.cacheKey('https://u', {});
  const info = { title: 'T', durationSec: 42 };
  M.cachePut(key, info, 1000);
  assert.deepStrictEqual(M.cacheGet(key, 1000 + M.INFO_TTL_MS - 1), info); // still fresh
  assert.strictEqual(M.cacheGet(key, 1000 + M.INFO_TTL_MS + 1), null);     // expired
});

test('cache: miss returns null; clearInfoCache empties it', () => {
  M.clearInfoCache();
  const key = M.cacheKey('https://gone', {});
  assert.strictEqual(M.cacheGet(key), null);
  M.cachePut(key, { title: 'X' }, 0);
  assert.ok(M.cacheGet(key, 0));
  M.clearInfoCache();
  assert.strictEqual(M.cacheGet(key, 0), null);
});
