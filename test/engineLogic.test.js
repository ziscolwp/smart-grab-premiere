const test = require('node:test');
const assert = require('node:assert');
const L = require('../panel/js/engineLogic.js');

test('qualityToFormat maps every quality to the Smart Grab format string', () => {
  assert.strictEqual(L.qualityToFormat('best'), 'bv*+ba/best');
  assert.strictEqual(L.qualityToFormat('uhd'), 'bv*[height<=2160]+ba/best');
  assert.strictEqual(L.qualityToFormat('fhd'), 'bv*[height<=1080]+ba/best');
  assert.strictEqual(L.qualityToFormat('hd'), 'bv*[height<=720]+ba/best');
  assert.strictEqual(L.qualityToFormat('sd'), 'bv*[height<=480]+ba/best');
  assert.strictEqual(L.qualityToFormat('audioOnly'), 'ba/best');
});

test('videoFormatInfo returns ext + needsReencode for each format', () => {
  assert.deepStrictEqual(L.videoFormatInfo('mp4Premiere'), { ext: 'mp4', needsReencode: true });
  assert.deepStrictEqual(L.videoFormatInfo('mov'), { ext: 'mov', needsReencode: true });
  assert.deepStrictEqual(L.videoFormatInfo('mkv'), { ext: 'mkv', needsReencode: false });
  assert.deepStrictEqual(L.videoFormatInfo('mp4Raw'), { ext: 'mp4', needsReencode: false });
});

test('buildYtDlpArgs builds video args with merge format', () => {
  const args = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere' },
    '/tmp/work', '/opt/homebrew/bin', 'https://x/y'
  );
  assert.deepStrictEqual(args, [
    '-P', '/tmp/work', '-f', 'bv*[height<=1080]+ba/best',
    '--force-ipv4', '--newline', '--no-warnings',
    '--ffmpeg-location', '/opt/homebrew/bin',
    '--extractor-retries', '3', '--retry-sleep', 'extractor:5',
    '--merge-output-format', 'mp4', 'https://x/y'
  ]);
});

test('buildYtDlpArgs builds MKV merge format', () => {
  const args = L.buildYtDlpArgs({ quality: 'best', videoFormat: 'mkv' }, '/t', '/f', 'URL');
  assert.ok(args.indexOf('--merge-output-format') !== -1);
  assert.strictEqual(args[args.indexOf('--merge-output-format') + 1], 'mkv');
});

test('buildYtDlpArgs builds audio-only extraction args', () => {
  const args = L.buildYtDlpArgs({ quality: 'audioOnly', audioFormat: 'mp3' }, '/t', '/f', 'URL');
  assert.ok(args.indexOf('-x') !== -1);
  assert.strictEqual(args[args.indexOf('--audio-format') + 1], 'mp3');
  assert.strictEqual(args.indexOf('--merge-output-format'), -1);
  assert.strictEqual(args[args.length - 1], 'URL');
});

test('outputFileName: plain video', () => {
  assert.strictEqual(
    L.outputFileName('My Video', { quality: 'fhd', videoFormat: 'mp4Premiere' }),
    'My Video.mp4'
  );
});

test('outputFileName: audio only uses audio ext', () => {
  assert.strictEqual(
    L.outputFileName('Song', { quality: 'audioOnly', audioFormat: 'wav' }),
    'Song.wav'
  );
});

test('outputFileName: clip range encodes start/end with dashes', () => {
  assert.strictEqual(
    L.outputFileName('Clip', { quality: 'fhd', videoFormat: 'mov', clipEnabled: true, startTime: '00:00:05', endTime: '00:01:30' }),
    'Clip_clip_00-00-05_to_00-01-30.mov'
  );
});

test('choosePostProcess: audio-only => move', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ audioOnly: true }, '/s.m4a', '/d.wav'),
    { action: 'move' }
  );
});

test('choosePostProcess: clip with reencode format', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '00:00:01', endTime: '00:00:09', needsReencode: true },
    '/s.mkv', '/d.mp4'
  );
  assert.deepStrictEqual(r, {
    action: 'ffmpeg',
    args: ['-y', '-ss', '00:00:01', '-to', '00:00:09', '-i', '/s.mkv',
           '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']
  });
});

test('choosePostProcess: clip without reencode copies streams', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '0', endTime: '5', needsReencode: false },
    '/s.mkv', '/d.mkv'
  );
  assert.deepStrictEqual(r.args.slice(-3), ['-c', 'copy', '/d.mkv']);
});

test('choosePostProcess: already h264+aac+mp4 => move (fast path)', () => {
  assert.deepStrictEqual(
    L.choosePostProcess(
      { needsReencode: true, srcExt: 'mp4', tgtExt: 'mp4', vcodec: 'h264', acodec: 'aac' },
      '/s.mp4', '/d.mp4'
    ),
    { action: 'move' }
  );
});

test('choosePostProcess: reencode when codecs differ', () => {
  const r = L.choosePostProcess(
    { needsReencode: true, srcExt: 'webm', tgtExt: 'mp4', vcodec: 'vp9', acodec: 'opus' },
    '/s.webm', '/d.mp4'
  );
  assert.deepStrictEqual(r, {
    action: 'ffmpeg',
    args: ['-y', '-i', '/s.webm', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']
  });
});

test('choosePostProcess: same ext, no reencode => move', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ needsReencode: false, srcExt: 'mkv', tgtExt: 'mkv' }, '/s.mkv', '/d.mkv'),
    { action: 'move' }
  );
});

test('choosePostProcess: different ext, no reencode => remux copy', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ needsReencode: false, srcExt: 'webm', tgtExt: 'mp4' }, '/s.webm', '/d.mp4'),
    { action: 'ffmpeg', args: ['-y', '-i', '/s.webm', '-c', 'copy', '/d.mp4'] }
  );
});

test('parseProgress extracts percent and strips [download] prefix', () => {
  const r = L.parseProgress('[download]  42.5% of 10MiB at 1MiB/s');
  assert.strictEqual(Math.round(r.percent * 10) / 10, 42.5);
  assert.ok(r.status.indexOf('[download]') === -1);
});

test('parseProgress returns merging status for merge lines', () => {
  const r = L.parseProgress('[Merger] Merging formats into "x.mp4"');
  assert.strictEqual(r.status, 'Merging streams...');
  assert.strictEqual(r.percent, null);
});

test('parseProgress returns null for unrelated lines', () => {
  assert.strictEqual(L.parseProgress('[info] something'), null);
});
