const test = require('node:test');
const assert = require('node:assert');
const E = require('../panel/js/errorHints.js');

test('YouTube bot-check maps to a cookies hint', () => {
  const r = E.friendly("ERROR: [youtube] abc: Sign in to confirm you're not a bot.");
  assert.ok(r.message.indexOf('sign-in verification') !== -1);
  assert.ok(r.hint.indexOf('Browser cookies') !== -1);
});

test('YouTube rate limit maps to a wait hint', () => {
  const r = E.friendly("ERROR: This content isn't available, try again later");
  assert.ok(r.message.indexOf('rate limit') !== -1);
});

test('Instagram login-wall maps to cookies hint', () => {
  const r = E.friendly('ERROR: [Instagram] Requested content is not available, rate-limit reached or login required');
  assert.ok(r.hint.indexOf('Browser cookies') !== -1);
});

test('missing impersonation target maps to update hint', () => {
  const r = E.friendly('ERROR: The extractor is attempting impersonation, but no impersonate target is available');
  assert.ok(r.hint.indexOf('Update yt-dlp') !== -1);
});

test('unsupported partial download maps to trim-mode hint', () => {
  const r = E.friendly('ERROR: This format cannot be partially downloaded');
  assert.ok(r.hint.indexOf('Precise') !== -1);
});

test('extractor breakage maps to update hint', () => {
  const r = E.friendly('ERROR: Unable to extract player version');
  assert.ok(r.hint.indexOf('Update yt-dlp') !== -1);
});

test('geo restriction is explained', () => {
  const r = E.friendly('ERROR: The uploader has not made this video available in your country');
  assert.ok(r.message.indexOf('Geo-restricted') !== -1);
});

test('connection timeout (ISP-blocked site, e.g. TikTok in India) hints at VPN/proxy', () => {
  // Real stderr from an Indian ISP that DNS-poisons tiktok.com — the
  // connection to the block server just times out.
  const r = E.friendly('ERROR: [TikTok] 7106594312292453675: Unable to download webpage: Failed to perform, curl: (28) Connection timed out after 10002 milliseconds.');
  assert.ok(r.message.indexOf('Network') !== -1 || r.message.indexOf('reach') !== -1);
  assert.ok(r.hint.indexOf('VPN') !== -1);
  assert.ok(r.hint.indexOf('Proxy') !== -1);
});

test('DNS failure (getaddrinfo) maps to the same network hint', () => {
  const r = E.friendly('ERROR: Unable to download webpage: <urlopen error [Errno 8] getaddrinfo failed>');
  assert.ok(r.hint.indexOf('VPN') !== -1);
});

test('unknown errors return null (caller keeps raw text)', () => {
  assert.strictEqual(E.friendly('something completely novel'), null);
  assert.strictEqual(E.friendly(''), null);
  assert.strictEqual(E.friendly(null), null);
});

test('friendly returns structured category, retryable flag, and action', () => {
  const r = E.friendly('ERROR: HTTP Error 429: Too Many Requests');
  assert.strictEqual(r.category, 'rate-limit');
  assert.strictEqual(r.retryable, true);
  assert.strictEqual(r.action, 'wait');
  assert.ok(r.message);
  assert.ok(r.hint);
});

test('friendly classifies missing ffmpeg as a tool repair action', () => {
  const r = E.friendly('ERROR: ffmpeg not found');
  assert.strictEqual(r.category, 'tool');
  assert.strictEqual(r.action, 'repair-tools');
});
