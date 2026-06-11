const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const settings = require('../panel/js/settings.js');

function tmpFile() {
  return path.join(os.tmpdir(), 'sg_settings_' + process.pid + '_' + Math.floor(Math.random() * 1e9) + '.json');
}

test('load() returns defaults when file is missing', () => {
  const s = settings.load(tmpFile());
  assert.strictEqual(s.destinationMode, 'sync');
  assert.strictEqual(s.binName, 'Downloaded Video');
  assert.strictEqual(s.lastQuality, 'fhd');
});

test('save() then load() round-trips and merges over defaults', () => {
  const f = tmpFile();
  const ok = settings.save({ destinationMode: 'custom', customFolder: '/tmp/grabs', lastQuality: 'uhd' }, f);
  assert.strictEqual(ok, true);
  const s = settings.load(f);
  assert.strictEqual(s.destinationMode, 'custom');
  assert.strictEqual(s.customFolder, '/tmp/grabs');
  assert.strictEqual(s.lastQuality, 'uhd');
  assert.strictEqual(s.binName, 'Downloaded Video'); // default preserved
  fs.unlinkSync(f);
});

test('ytDlpLastUpdate defaults to 0 (= never updated, so first open refreshes)', () => {
  const s = settings.load(tmpFile());
  assert.strictEqual(s.ytDlpLastUpdate, 0);
});

test('load() returns defaults on corrupt JSON', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ not json');
  const s = settings.load(f);
  assert.strictEqual(s.destinationMode, 'sync');
  fs.unlinkSync(f);
});
