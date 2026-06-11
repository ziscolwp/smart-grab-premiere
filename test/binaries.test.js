const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const B = require('../panel/js/binaries.js');

test('resolveBinary returns first dir where predicate is true', () => {
  const dirs = ['/a/bin', '/b/bin', '/opt/homebrew/bin'];
  const isExec = (p) => p === path.join('/b/bin', 'yt-dlp');
  assert.strictEqual(B.resolveBinary('yt-dlp', { dirs: dirs, isExec: isExec }), path.join('/b/bin', 'yt-dlp'));
});

test('resolveBinary returns null when not found anywhere', () => {
  assert.strictEqual(
    B.resolveBinary('ffmpeg', { dirs: ['/a', '/b'], isExec: () => false }),
    null
  );
});

test('resolveBinary checks dirs in order (bundled wins over homebrew)', () => {
  const dirs = ['/ext/bin', '/opt/homebrew/bin'];
  const isExec = () => true; // both exist -> first wins
  assert.strictEqual(B.resolveBinary('ffmpeg', { dirs: dirs, isExec: isExec }), path.join('/ext/bin', 'ffmpeg'));
});

test('defaultDirs includes bundled, app-support, and homebrew paths in priority order', () => {
  const dirs = B.defaultDirs('/EXT');
  assert.strictEqual(dirs[0], path.join('/EXT', 'bin'));
  assert.ok(dirs.some((d) => d.indexOf('Application Support') !== -1 && d.indexOf('SmartGrab') !== -1));
  assert.ok(dirs.indexOf('/opt/homebrew/bin') !== -1);
  assert.ok(dirs.indexOf('/usr/local/bin') !== -1);
});

test('augmentedEnv prepends homebrew to PATH', () => {
  const env = B.augmentedEnv({ PATH: '/usr/bin:/bin' }, 'darwin');
  assert.ok(env.PATH.indexOf('/opt/homebrew/bin') === 0);
  assert.ok(env.PATH.indexOf('/usr/bin:/bin') !== -1);
});

// ---- Windows behavior (platform passed explicitly so these run anywhere) ----

test('candidateNames adds .exe on Windows, keeps plain name on mac', () => {
  assert.deepStrictEqual(B.candidateNames('yt-dlp', 'win32'), ['yt-dlp.exe', 'yt-dlp']);
  assert.deepStrictEqual(B.candidateNames('yt-dlp.exe', 'win32'), ['yt-dlp.exe']);
  assert.deepStrictEqual(B.candidateNames('yt-dlp', 'darwin'), ['yt-dlp']);
});

test('resolveBinary finds .exe variant on Windows', () => {
  const dirs = ['C:\\ext\\bin'];
  const isExec = (p) => p === path.join('C:\\ext\\bin', 'ffmpeg.exe');
  assert.strictEqual(
    B.resolveBinary('ffmpeg', { dirs: dirs, isExec: isExec, platform: 'win32' }),
    path.join('C:\\ext\\bin', 'ffmpeg.exe')
  );
});

test('defaultDirs on Windows skips homebrew and uses AppData', () => {
  const dirs = B.defaultDirs('X:\\EXT', 'win32');
  assert.strictEqual(dirs[0], path.join('X:\\EXT', 'bin'));
  assert.ok(dirs[1].indexOf('SmartGrab') !== -1);
  assert.strictEqual(dirs.indexOf('/opt/homebrew/bin'), -1);
});

test('augmentedEnv on Windows prepends the app-support bin with ; separator', () => {
  const env = B.augmentedEnv({ PATH: 'C:\\Windows\\System32' }, 'win32');
  assert.ok(env.PATH.indexOf('SmartGrab') !== -1);
  assert.ok(env.PATH.indexOf(';C:\\Windows\\System32') !== -1);
});

test('ytDlpDownloadUrl picks the right release asset per platform', () => {
  assert.ok(B.ytDlpDownloadUrl('win32').indexOf('yt-dlp.exe') !== -1);
  assert.ok(B.ytDlpDownloadUrl('darwin').indexOf('yt-dlp_macos') !== -1);
});
