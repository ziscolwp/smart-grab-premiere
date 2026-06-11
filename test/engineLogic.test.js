const test = require('node:test');
const assert = require('node:assert');
const L = require('../panel/js/engineLogic.js');

test('qualityToFormat: permissive selector with muxed fallback', () => {
  assert.strictEqual(L.qualityToFormat('best'), 'bv*+ba/b');
  assert.strictEqual(L.qualityToFormat('fhd'), 'bv*+ba/b');
  assert.strictEqual(L.qualityToFormat('audioOnly'), 'ba/b');
});

test('formatSort: res cap first, then h264/aac preference for mp4 targets', () => {
  assert.strictEqual(L.formatSort('fhd', 'mp4Premiere'), 'res:1080,vcodec:h264,acodec:aac');
  assert.strictEqual(L.formatSort('uhd', 'mov'), 'res:2160,vcodec:h264,acodec:aac');
  assert.strictEqual(L.formatSort('sd', 'mp4Raw'), 'res:480,vcodec:h264,acodec:aac');
});
test('formatSort: best quality has uncapped res but keeps codec preference', () => {
  assert.strictEqual(L.formatSort('best', 'mp4Premiere'), 'res,vcodec:h264,acodec:aac');
});
test('formatSort: mkv (original) keeps natural codec ranking', () => {
  assert.strictEqual(L.formatSort('fhd', 'mkv'), 'res:1080');
});
test('formatSort: audio only needs no sort', () => {
  assert.strictEqual(L.formatSort('audioOnly', 'mp4Premiere'), null);
});

test('videoFormatInfo returns ext + needsReencode for each format', () => {
  assert.deepStrictEqual(L.videoFormatInfo('mp4Premiere'), { ext: 'mp4', needsReencode: true });
  assert.deepStrictEqual(L.videoFormatInfo('mov'), { ext: 'mov', needsReencode: true });
  assert.deepStrictEqual(L.videoFormatInfo('mkv'), { ext: 'mkv', needsReencode: false });
  assert.deepStrictEqual(L.videoFormatInfo('mp4Raw'), { ext: 'mp4', needsReencode: false });
});

test('useSections: only when clipping in fast mode', () => {
  assert.strictEqual(L.useSections({ clipEnabled: true, endTime: '00:01:00', trimMode: 'fast' }), true);
  assert.strictEqual(L.useSections({ clipEnabled: true, endTime: '00:01:00' }), true); // fast is the default
  assert.strictEqual(L.useSections({ clipEnabled: true, endTime: '00:01:00', trimMode: 'precise' }), false);
  assert.strictEqual(L.useSections({ clipEnabled: false, endTime: '00:01:00' }), false);
  assert.strictEqual(L.useSections({ clipEnabled: true }), false);
});

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

test('buildYtDlpArgs: video args include sort, reliability flags, merge format', () => {
  const args = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere' },
    '/tmp/work', '/opt/homebrew/bin', 'https://x/y'
  );
  assert.strictEqual(argValue(args, '-P'), '/tmp/work');
  assert.strictEqual(argValue(args, '-f'), 'bv*+ba/b');
  assert.strictEqual(argValue(args, '-S'), 'res:1080,vcodec:h264,acodec:aac');
  assert.strictEqual(argValue(args, '--ffmpeg-location'), '/opt/homebrew/bin');
  assert.strictEqual(argValue(args, '--merge-output-format'), 'mp4');
  assert.strictEqual(argValue(args, '--concurrent-fragments'), '4');
  assert.strictEqual(argValue(args, '--retries'), '10');
  assert.ok(args.indexOf('--windows-filenames') !== -1);
  assert.ok(args.indexOf('--no-playlist') !== -1);
  assert.ok(args.indexOf('--newline') !== -1);
  assert.ok(String(argValue(args, '--progress-template')).indexOf('SG|') !== -1);
  assert.ok(String(argValue(args, '-o')).indexOf('%(title).80B') === 0);
  assert.strictEqual(args[args.length - 1], 'https://x/y');
});

test('buildYtDlpArgs: MKV merge format, no codec sort', () => {
  const args = L.buildYtDlpArgs({ quality: 'best', videoFormat: 'mkv' }, '/t', '/f', 'URL');
  assert.strictEqual(argValue(args, '--merge-output-format'), 'mkv');
  assert.strictEqual(argValue(args, '-S'), 'res');
});

test('buildYtDlpArgs: audio-only extraction args', () => {
  const args = L.buildYtDlpArgs({ quality: 'audioOnly', audioFormat: 'mp3' }, '/t', '/f', 'URL');
  assert.ok(args.indexOf('-x') !== -1);
  assert.strictEqual(argValue(args, '--audio-format'), 'mp3');
  assert.strictEqual(args.indexOf('--merge-output-format'), -1);
  assert.strictEqual(args.indexOf('-S'), -1);
  assert.strictEqual(args[args.length - 1], 'URL');
});

test('buildYtDlpArgs: cookies-from-browser only when a browser is chosen', () => {
  const withC = L.buildYtDlpArgs({ quality: 'fhd', videoFormat: 'mp4Premiere', cookiesBrowser: 'firefox' }, '/t', '/f', 'U');
  assert.strictEqual(argValue(withC, '--cookies-from-browser'), 'firefox');
  const without = L.buildYtDlpArgs({ quality: 'fhd', videoFormat: 'mp4Premiere', cookiesBrowser: 'none' }, '/t', '/f', 'U');
  assert.strictEqual(without.indexOf('--cookies-from-browser'), -1);
});

test('cookieExportArgs: one-shot browser-to-file dump, never an actual download', () => {
  const args = L.cookieExportArgs('firefox', '/dest/cookies.txt');
  assert.strictEqual(args[args.indexOf('--cookies-from-browser') + 1], 'firefox');
  assert.strictEqual(args[args.indexOf('--cookies') + 1], '/dest/cookies.txt');
  assert.ok(args.indexOf('--skip-download') !== -1);
  assert.ok(args.indexOf('--ignore-errors') !== -1);
});

test('cookieArgs: file wins over browser, browser when no file, nothing otherwise', () => {
  assert.deepStrictEqual(L.cookieArgs('chrome', '/c.txt'), ['--cookies', '/c.txt']);
  assert.deepStrictEqual(L.cookieArgs('chrome', ''), ['--cookies-from-browser', 'chrome']);
  assert.deepStrictEqual(L.cookieArgs('none', ''), []);
  assert.deepStrictEqual(L.cookieArgs(undefined, undefined), []);
});

test('buildYtDlpArgs: cookies file takes precedence over browser', () => {
  const args = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere', cookiesBrowser: 'chrome', cookiesFile: '/c.txt' },
    '/t', '/f', 'U'
  );
  assert.strictEqual(argValue(args, '--cookies'), '/c.txt');
  assert.strictEqual(args.indexOf('--cookies-from-browser'), -1);
});

test('buildYtDlpArgs: referer passed through when set', () => {
  const args = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere', referer: 'https://site.example/' }, '/t', '/f', 'U'
  );
  assert.strictEqual(argValue(args, '--referer'), 'https://site.example/');
});

test('buildYtDlpArgs: fast clip adds --download-sections; precise does not', () => {
  const fast = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere', clipEnabled: true, startTime: '00:00:10', endTime: '00:01:00' },
    '/t', '/f', 'U'
  );
  assert.strictEqual(argValue(fast, '--download-sections'), '*00:00:10-00:01:00');
  const precise = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere', clipEnabled: true, startTime: '00:00:10', endTime: '00:01:00', trimMode: 'precise' },
    '/t', '/f', 'U'
  );
  assert.strictEqual(precise.indexOf('--download-sections'), -1);
});

test('buildYtDlpArgs: noPlaylist false drops the flag (playlist entries)', () => {
  const args = L.buildYtDlpArgs({ quality: 'fhd', videoFormat: 'mp4Premiere', noPlaylist: false }, '/t', '/f', 'U');
  assert.strictEqual(args.indexOf('--no-playlist'), -1);
});

test('buildYtDlpArgs: warnings are NOT suppressed (needed for diagnostics)', () => {
  const args = L.buildYtDlpArgs({ quality: 'fhd', videoFormat: 'mp4Premiere' }, '/t', '/f', 'U');
  assert.strictEqual(args.indexOf('--no-warnings'), -1);
});

test('pairLeftoverStreams: identifies video + audio pair', () => {
  const pair = L.pairLeftoverStreams([
    { name: 'a.m4a', vcodec: '', acodec: 'aac' },
    { name: 'v.mp4', vcodec: 'h264', acodec: '' }
  ]);
  assert.strictEqual(pair.video.name, 'v.mp4');
  assert.strictEqual(pair.audio.name, 'a.m4a');
});
test('pairLeftoverStreams: muxed video counts as the video side', () => {
  const pair = L.pairLeftoverStreams([
    { name: 'v.mp4', vcodec: 'h264', acodec: 'aac' },
    { name: 'a.m4a', vcodec: '', acodec: 'aac' }
  ]);
  assert.strictEqual(pair.video.name, 'v.mp4');
});
test('pairLeftoverStreams: rejects two videos, two audios, or wrong count', () => {
  assert.strictEqual(L.pairLeftoverStreams([
    { name: 'a.mp4', vcodec: 'h264', acodec: '' },
    { name: 'b.mp4', vcodec: 'h264', acodec: '' }
  ]), null);
  assert.strictEqual(L.pairLeftoverStreams([
    { name: 'a.m4a', vcodec: '', acodec: 'aac' },
    { name: 'b.m4a', vcodec: '', acodec: 'opus' }
  ]), null);
  assert.strictEqual(L.pairLeftoverStreams([{ name: 'x', vcodec: 'h264', acodec: 'aac' }]), null);
  assert.strictEqual(L.pairLeftoverStreams(null), null);
});

test('selfMergeArgs: copies both streams when audio fits the container', () => {
  assert.deepStrictEqual(
    L.selfMergeArgs('/t/v.mp4', '/t/a.m4a', 'aac', 'mp4', '/t/out.mp4'),
    ['-y', '-i', '/t/v.mp4', '-i', '/t/a.m4a', '-map', '0:v:0', '-map', '1:a:0',
     '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', '/t/out.mp4']
  );
});
test('selfMergeArgs: transcodes opus audio for mp4, copies it for mkv', () => {
  const mp4 = L.selfMergeArgs('/v', '/a', 'opus', 'mp4', '/o.mp4');
  assert.strictEqual(mp4[mp4.indexOf('-c:a') + 1], 'aac');
  const mkv = L.selfMergeArgs('/v', '/a', 'opus', 'mkv', '/o.mkv');
  assert.strictEqual(mkv[mkv.indexOf('-c:a') + 1], 'copy');
  assert.strictEqual(mkv.indexOf('-movflags'), -1);
});

test('stripFormatSuffix removes yt-dlp format-id suffixes only', () => {
  assert.strictEqual(L.stripFormatSuffix('Title [abc].f401'), 'Title [abc]');
  assert.strictEqual(L.stripFormatSuffix('Title [abc].fhls-audio-32000'), 'Title [abc]');
  assert.strictEqual(L.stripFormatSuffix('Title [abc]'), 'Title [abc]');
  assert.strictEqual(L.stripFormatSuffix('My film. final [abc]'), 'My film. final [abc]');
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

test('choosePostProcess: local clip with reencode format', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '00:00:01', endTime: '00:00:09', needsReencode: true },
    '/s.mkv', '/d.mp4'
  );
  assert.strictEqual(r.action, 'ffmpeg');
  assert.deepStrictEqual(r.args,
    ['-y', '-ss', '00:00:01', '-to', '00:00:09', '-i', '/s.mkv',
     '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']);
});

test('choosePostProcess: local clip without reencode copies streams', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '0', endTime: '5', needsReencode: false },
    '/s.mkv', '/d.mkv'
  );
  assert.deepStrictEqual(r.args.slice(-3), ['-c', 'copy', '/d.mkv']);
});

test('choosePostProcess: section-downloaded clip skips local -ss/-to', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '00:00:01', endTime: '00:00:09', needsReencode: true,
      sectionDownloaded: true, srcExt: 'mp4', tgtExt: 'mp4', vcodec: 'h264', acodec: 'aac' },
    '/s.mp4', '/d.mp4'
  );
  assert.deepStrictEqual(r, { action: 'move' });
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

test('choosePostProcess: right codecs wrong container => lossless remux', () => {
  const r = L.choosePostProcess(
    { needsReencode: true, srcExt: 'mp4', tgtExt: 'mov', vcodec: 'h264', acodec: 'aac' },
    '/s.mp4', '/d.mov'
  );
  assert.strictEqual(r.action, 'ffmpeg');
  assert.deepStrictEqual(r.args, ['-y', '-i', '/s.mp4', '-c', 'copy', '-movflags', '+faststart', '/d.mov']);
});

test('choosePostProcess: both streams wrong => full re-encode', () => {
  const r = L.choosePostProcess(
    { needsReencode: true, srcExt: 'webm', tgtExt: 'mp4', vcodec: 'vp9', acodec: 'opus' },
    '/s.webm', '/d.mp4'
  );
  assert.strictEqual(r.action, 'ffmpeg');
  assert.deepStrictEqual(r.args,
    ['-y', '-i', '/s.webm', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']);
});

test('choosePostProcess: good video + opus audio => convert audio only', () => {
  const r = L.choosePostProcess(
    { needsReencode: true, srcExt: 'mp4', tgtExt: 'mp4', vcodec: 'h264', acodec: 'opus' },
    '/s.mp4', '/d.mp4'
  );
  assert.deepStrictEqual(r.args,
    ['-y', '-i', '/s.mp4', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']);
  assert.ok(r.note.indexOf('audio only') !== -1);
});

test('choosePostProcess: AV1 video + aac audio => convert video, copy audio', () => {
  const r = L.choosePostProcess(
    { needsReencode: true, srcExt: 'mp4', tgtExt: 'mp4', vcodec: 'av1', acodec: 'aac' },
    '/s.mp4', '/d.mp4'
  );
  assert.deepStrictEqual(r.args,
    ['-y', '-i', '/s.mp4', '-c:v', 'libx264', '-c:a', 'copy', '-movflags', '+faststart', '/d.mp4']);
});

test('choosePostProcess: h264 with no audio stream => move, no pointless encode', () => {
  assert.deepStrictEqual(
    L.choosePostProcess(
      { needsReencode: true, srcExt: 'mp4', tgtExt: 'mp4', vcodec: 'h264', acodec: '' },
      '/s.mp4', '/d.mp4'
    ),
    { action: 'move' }
  );
});

test('choosePostProcess: same ext, no reencode => move', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ needsReencode: false, srcExt: 'mkv', tgtExt: 'mkv' }, '/s.mkv', '/d.mkv'),
    { action: 'move' }
  );
});

test('choosePostProcess: different ext, no reencode => remux copy', () => {
  const r = L.choosePostProcess({ needsReencode: false, srcExt: 'webm', tgtExt: 'mp4' }, '/s.webm', '/d.mp4');
  assert.strictEqual(r.action, 'ffmpeg');
  assert.deepStrictEqual(r.args, ['-y', '-i', '/s.webm', '-c', 'copy', '/d.mp4']);
});

test('parseProgress: machine template line with all fields', () => {
  const r = L.parseProgress('SG|  42.5%| 1.05MiB/s|00:45');
  assert.strictEqual(r.percent, 42.5);
  assert.strictEqual(r.speed, '1.05MiB/s');
  assert.strictEqual(r.eta, '00:45');
  assert.ok(r.status.indexOf('42.5%') !== -1);
});

test('parseProgress: machine template tolerates Unknown fields', () => {
  const r = L.parseProgress('SG| 100.0%|Unknown B/s|Unknown');
  assert.strictEqual(r.percent, 100);
  assert.strictEqual(r.speed, null);
  assert.strictEqual(r.eta, null);
});

test('parseProgress: legacy [download] line still parses', () => {
  const r = L.parseProgress('[download]  42.5% of 10MiB at 1MiB/s');
  assert.strictEqual(Math.round(r.percent * 10) / 10, 42.5);
  assert.ok(r.status.indexOf('[download]') === -1);
});

test('parseProgress: merging status for merge lines', () => {
  const r = L.parseProgress('[Merger] Merging formats into "x.mp4"');
  assert.strictEqual(r.status, 'Merging streams...');
  assert.strictEqual(r.percent, null);
});

test('parseProgress: null for unrelated lines', () => {
  assert.strictEqual(L.parseProgress('[info] something'), null);
});
