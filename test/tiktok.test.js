const test = require('node:test');
const assert = require('node:assert');
const T = require('../panel/js/tiktok.js');

// Trimmed from a real tikwm.com response for
// https://www.tiktok.com/@startupspark85/video/7588059384693984525
const FIXTURE = JSON.stringify({
  code: 0, msg: 'success',
  data: {
    id: '7588059384693984525',
    title: 'Glass Bottles Recycling Business Idea',
    duration: 35,
    cover: 'https://p16-common-sign.tiktokcdn-us.com/cover.jpg',
    origin_cover: 'https://p16-common-sign.tiktokcdn-us.com/origin.jpg',
    play: 'https://v16m.tiktokcdn-us.com/play.mp4',
    wmplay: 'https://v16m.tiktokcdn-us.com/wm.mp4',
    hdplay: 'https://v16m-default.tiktokcdn-us.com/hd.mp4',
    author: { unique_id: 'startupspark85', nickname: 'StartupSpark' }
  }
});

test('isTikTokUrl: matches every TikTok host form, rejects others', () => {
  assert.strictEqual(T.isTikTokUrl('https://www.tiktok.com/@u/video/123'), true);
  assert.strictEqual(T.isTikTokUrl('https://vm.tiktok.com/ZGdabc/'), true);
  assert.strictEqual(T.isTikTokUrl('https://vt.tiktok.com/ZSabc/'), true);
  assert.strictEqual(T.isTikTokUrl('https://m.tiktok.com/v/123.html'), true);
  assert.strictEqual(T.isTikTokUrl('https://www.youtube.com/watch?v=x'), false);
  assert.strictEqual(T.isTikTokUrl('https://tiktokcdn-us.com/x.mp4'), false); // a CDN host, not a page
  assert.strictEqual(T.isTikTokUrl(''), false);
  assert.strictEqual(T.isTikTokUrl(null), false);
});

test('blocked flag: false by default, markBlocked sets it, resetBlocked clears it', () => {
  T.resetBlocked();
  assert.strictEqual(T.isBlocked(), false);
  T.markBlocked();
  assert.strictEqual(T.isBlocked(), true);
  T.resetBlocked(); // leave the shared module flag clean for other tests
  assert.strictEqual(T.isBlocked(), false);
});

test('tikwmUrl: hd=1 and the source URL is percent-encoded (raw query not leaked)', () => {
  const src = 'https://www.tiktok.com/@u/video/123?is_from_webapp=1';
  const u = T.tikwmUrl(src);
  assert.ok(u.indexOf('hd=1') !== -1);
  assert.ok(u.indexOf(encodeURIComponent(src)) !== -1);
  assert.ok(u.indexOf('?is_from_webapp=1') === -1); // the raw, unencoded query must not appear
});

test('parseTikwm: pulls HD url + metadata from a success response', () => {
  const r = T.parseTikwm(FIXTURE);
  assert.strictEqual(r.videoUrl, 'https://v16m-default.tiktokcdn-us.com/hd.mp4');
  assert.strictEqual(r.title, 'Glass Bottles Recycling Business Idea');
  assert.strictEqual(r.durationSec, 35);
  assert.strictEqual(r.thumbnail, 'https://p16-common-sign.tiktokcdn-us.com/origin.jpg');
  assert.strictEqual(r.uploader, 'StartupSpark');
  assert.strictEqual(r.id, '7588059384693984525');
});

test('outputTemplate: clean "title [id].%(ext)s" from resolver info', () => {
  const tpl = T.outputTemplate({ title: 'Glass Bottles Recycling', id: '7588059384693984525' }, 'https://www.tiktok.com/@u/video/7588059384693984525');
  assert.strictEqual(tpl, 'Glass Bottles Recycling [7588059384693984525].%(ext)s');
});

test('outputTemplate: id falls back to the URL when resolver omits it', () => {
  const tpl = T.outputTemplate({ title: 'Clip' }, 'https://www.tiktok.com/@u/video/7588059384693984525?is_from_webapp=1');
  assert.strictEqual(tpl, 'Clip [7588059384693984525].%(ext)s');
});

test('outputTemplate: strips %-sequences and slashes that would break yt-dlp -o', () => {
  const tpl = T.outputTemplate({ title: 'a/b\\c %100 \n done', id: '99' }, 'x');
  assert.ok(tpl.indexOf('%(ext)s') === tpl.length - '%(ext)s'.length);
  assert.ok(tpl.indexOf('%100') === -1);          // literal % removed
  assert.ok(tpl.indexOf('/') === -1 && tpl.indexOf('\\') === -1);
});

test('outputTemplate: empty title degrades to a safe stem, never empty', () => {
  const tpl = T.outputTemplate({ title: '', id: '42' }, 'x');
  assert.ok(/^\S.*\[42\]\.%\(ext\)s$/.test(tpl));
});

test('parseTikwm: falls back to no-watermark play url when hdplay is absent', () => {
  const j = JSON.parse(FIXTURE); delete j.data.hdplay;
  const r = T.parseTikwm(JSON.stringify(j));
  assert.strictEqual(r.videoUrl, 'https://v16m.tiktokcdn-us.com/play.mp4');
});

test('parseTikwm: returns null on resolver error / junk / no playable url', () => {
  assert.strictEqual(T.parseTikwm(JSON.stringify({ code: -1, msg: 'Url parsing is failed!' })), null);
  assert.strictEqual(T.parseTikwm('<html>429 too many requests</html>'), null);
  assert.strictEqual(T.parseTikwm(JSON.stringify({ code: 0, data: { title: 'x' } })), null);
  assert.strictEqual(T.parseTikwm(''), null);
  assert.strictEqual(T.parseTikwm(null), null);
});
