const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const binaries = require('../panel/js/binaries.js');

function freshEngineWithMocks(mocks) {
  const enginePath = require.resolve('../panel/js/downloadEngine.js');
  delete require.cache[enginePath];
  const originalSpawn = childProcess.spawn;
  const originalResolve = binaries.resolveBinary;
  const originalEnv = binaries.augmentedEnv;
  childProcess.spawn = mocks.spawn;
  binaries.resolveBinary = mocks.resolveBinary;
  binaries.augmentedEnv = mocks.augmentedEnv || (() => ({ PATH: '' }));
  return {
    engine: require('../panel/js/downloadEngine.js'),
    restore: () => {
      childProcess.spawn = originalSpawn;
      binaries.resolveBinary = originalResolve;
      binaries.augmentedEnv = originalEnv;
      delete require.cache[enginePath];
    }
  };
}

test('download stops retry/fallback work after cancellation', async () => {
  let canceled = false;
  let ytdlpStarts = 0;
  const { engine, restore } = freshEngineWithMocks({
    resolveBinary: (name) => '/tools/' + name,
    spawn: (exe) => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {
        process.nextTick(() => {
          proc.stderr.emit('data', Buffer.from('ERROR: this format cannot be partially downloaded\n'));
          proc.emit('close', 1);
        });
      };
      if (path.basename(exe) === 'yt-dlp') {
        ytdlpStarts += 1;
        if (ytdlpStarts > 1) process.nextTick(() => proc.emit('close', 0));
      }
      return proc;
    }
  });

  try {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-engine-cancel-'));
    await new Promise((resolve) => {
      engine.download({
        url: 'https://x.test/v',
        outputDir,
        quality: 'fhd',
        videoFormat: 'mp4Premiere',
        clipEnabled: true,
        startTime: '0',
        endTime: '5',
        isCanceled: () => canceled
      }, {
        onProc: (proc) => {
          if (!canceled) {
            canceled = true;
            proc.kill();
          }
        }
      }, () => resolve());
    });
    assert.strictEqual(ytdlpStarts, 1);
  } finally {
    restore();
  }
});
