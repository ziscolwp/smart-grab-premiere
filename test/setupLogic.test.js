const test = require('node:test');
const assert = require('node:assert');
const S = require('../panel/js/setupLogic.js');

// ---- binaryUrl: per-platform/arch asset choice (URLs proven in the installers) ----

test('binaryUrl yt-dlp picks nightly asset per platform', () => {
  assert.ok(S.binaryUrl('yt-dlp', 'darwin', 'arm64').indexOf('yt-dlp-nightly-builds') !== -1);
  assert.ok(S.binaryUrl('yt-dlp', 'darwin', 'arm64').indexOf('yt-dlp_macos') !== -1);
  assert.ok(S.binaryUrl('yt-dlp', 'win32', 'x64').indexOf('yt-dlp.exe') !== -1);
});

test('binaryUrl ffmpeg/ffprobe: osxexperts on apple silicon, evermeet on intel mac', () => {
  assert.ok(S.binaryUrl('ffmpeg', 'darwin', 'arm64').indexOf('osxexperts.net') !== -1);
  assert.ok(S.binaryUrl('ffprobe', 'darwin', 'arm64').indexOf('osxexperts.net') !== -1);
  assert.ok(S.binaryUrl('ffmpeg', 'darwin', 'x64').indexOf('evermeet.cx') !== -1);
  assert.ok(S.binaryUrl('ffprobe', 'darwin', 'x64').indexOf('evermeet.cx') !== -1);
});

test('binaryUrl ffmpeg/ffprobe on Windows both point at the yt-dlp FFmpeg-Builds zip', () => {
  const f = S.binaryUrl('ffmpeg', 'win32', 'x64');
  assert.ok(f.indexOf('yt-dlp/FFmpeg-Builds') !== -1);
  assert.ok(f.indexOf('win64-gpl.zip') !== -1);
  assert.strictEqual(S.binaryUrl('ffprobe', 'win32', 'x64'), f);
});

test('binaryUrl deno picks the right target triple', () => {
  assert.ok(S.binaryUrl('deno', 'darwin', 'arm64').indexOf('aarch64-apple-darwin') !== -1);
  assert.ok(S.binaryUrl('deno', 'darwin', 'x64').indexOf('x86_64-apple-darwin') !== -1);
  assert.ok(S.binaryUrl('deno', 'win32', 'x64').indexOf('x86_64-pc-windows-msvc') !== -1);
});

// ---- downloadPlan: ordered steps, zip detection, Windows ffmpeg-zip dedup ----

test('downloadPlan on mac arm64 produces one step per missing binary, yt-dlp first', () => {
  const plan = S.downloadPlan(['deno', 'ffmpeg', 'yt-dlp', 'ffprobe'], 'darwin', 'arm64');
  assert.strictEqual(plan.length, 4);
  assert.strictEqual(plan[0].label, 'yt-dlp');
  assert.deepStrictEqual(plan[0].provides, ['yt-dlp']);
  assert.strictEqual(plan[0].archive, false);
  assert.strictEqual(plan[1].label, 'ffmpeg');
  assert.strictEqual(plan[1].archive, true);
  assert.strictEqual(plan[3].label, 'deno');
});

test('downloadPlan on Windows merges ffmpeg+ffprobe into a single zip step', () => {
  const plan = S.downloadPlan(['yt-dlp', 'ffmpeg', 'ffprobe', 'deno'], 'win32', 'x64');
  assert.strictEqual(plan.length, 3);
  assert.strictEqual(plan[1].label, 'ffmpeg + ffprobe');
  assert.deepStrictEqual(plan[1].provides, ['ffmpeg', 'ffprobe']);
  assert.strictEqual(plan[1].archive, true);
});

test('downloadPlan on Windows with only ffprobe missing provides only ffprobe', () => {
  const plan = S.downloadPlan(['ffprobe'], 'win32', 'x64');
  assert.strictEqual(plan.length, 1);
  assert.deepStrictEqual(plan[0].provides, ['ffprobe']);
  assert.strictEqual(plan[0].label, 'ffprobe');
});

test('downloadPlan ignores unknown names and returns [] when nothing is missing', () => {
  assert.deepStrictEqual(S.downloadPlan([], 'darwin', 'arm64'), []);
  assert.deepStrictEqual(S.downloadPlan(['nonsense'], 'darwin', 'arm64'), []);
});

// ---- staleness: the 14-day yt-dlp auto-update rule ----

test('isYtDlpStale: never-updated (0 / missing) is stale', () => {
  assert.strictEqual(S.isYtDlpStale(0, Date.now()), true);
  assert.strictEqual(S.isYtDlpStale(undefined, Date.now()), true);
  assert.strictEqual(S.isYtDlpStale(NaN, Date.now()), true);
});

test('isYtDlpStale: 13 days old is fresh, 15 days old is stale', () => {
  const now = 1750000000000;
  const day = 24 * 60 * 60 * 1000;
  assert.strictEqual(S.isYtDlpStale(now - 13 * day, now), false);
  assert.strictEqual(S.isYtDlpStale(now - 15 * day, now), true);
});

test('isYtDlpStale: clock weirdness (timestamp in the future) is not stale', () => {
  const now = 1750000000000;
  assert.strictEqual(S.isYtDlpStale(now + 1000, now), false);
});

// ---- banner copy ----

test('progressText counts steps for humans', () => {
  assert.strictEqual(S.progressText('ffmpeg', 2, 4), 'Setting up — downloading ffmpeg (2 of 4)…');
});

test('failureMessage: critical missing vs optional-only', () => {
  assert.ok(S.failureMessage(['yt-dlp']).indexOf('yt-dlp') !== -1);
  assert.ok(/retry/i.test(S.failureMessage(['yt-dlp'])));
  // deno alone: panel still works, message must not claim downloads are broken
  assert.ok(/optional/i.test(S.failureMessage(['deno'])));
});

test('REQUIRED lists the four managed binaries in download order', () => {
  assert.deepStrictEqual(S.REQUIRED, ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno']);
});

test('failureMessage: deno-only failure owns up to what breaks (Flow watermark removal)', () => {
  const msg = S.failureMessage(['deno']);
  assert.ok(/watermark/i.test(msg), 'names the Flow watermark impact');
  assert.ok(/retry/i.test(msg), 'still offers the retry path');
  assert.ok(!/everything still works/i.test(msg), 'no longer claims nothing is affected');
});
