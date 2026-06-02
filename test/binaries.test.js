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
  const env = B.augmentedEnv({ PATH: '/usr/bin:/bin' });
  assert.ok(env.PATH.indexOf('/opt/homebrew/bin') === 0);
  assert.ok(env.PATH.indexOf('/usr/bin:/bin') !== -1);
});
