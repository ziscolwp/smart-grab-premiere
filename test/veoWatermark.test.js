const test = require('node:test');
const assert = require('node:assert');
const V = require('../panel/js/veoWatermark.js');
const settings = require('../panel/js/settings.js');

const FLOW = 'https://labs.google/fx/tools/flow/shared/video/be83e530-cac3-43ed-90e4-77dfe9efe1ec';

test('candidatesFor 1280x720: inset first (measured on real Veo clips), then standard, then compact', () => {
  const c = V.candidatesFor(1280, 720);
  // 72px@1080p scaled by 2/3 => 48px; margins 144->96 (inset), 108->72 (standard)
  assert.deepStrictEqual(
    c.map(x => [x.x, x.y, x.size]),
    [[1136, 576, 48], [1160, 600, 48], [1207, 636, 44]]
  );
});

test('candidatesFor 1920x1080: reference geometry unscaled, standard first', () => {
  const c = V.candidatesFor(1920, 1080);
  assert.deepStrictEqual(c.map(x => [x.x, x.y, x.size]), [[1740, 900, 72], [1704, 864, 72]]);
});

test('candidatesFor portrait 720x1280: includes all four explicit geometries plus projected refs', () => {
  const c = V.candidatesFor(720, 1280);
  const geoms = c.map(x => x.x + ':' + x.y + ':' + x.size);
  // explicit portrait catalog entries (48 m96, 48 m72, 35 m102/96, 44 m29/40)
  assert.ok(geoms.includes((720 - 96 - 48) + ':' + (1280 - 96 - 48) + ':48'));
  assert.ok(geoms.includes((720 - 72 - 48) + ':' + (1280 - 72 - 48) + ':48'));
  assert.ok(geoms.includes((720 - 102 - 35) + ':' + (1280 - 96 - 35) + ':35'));
  assert.ok(geoms.includes((720 - 29 - 44) + ':' + (1280 - 40 - 44) + ':44'));
  assert.ok(c.length >= 4, 'projected reference candidates may add more');
  // priority-0 explicit relocated m96 must sort ahead of the other explicit entries
  const idxM96 = geoms.indexOf((720 - 96 - 48) + ':' + (1280 - 96 - 48) + ':48');
  const idxM72 = geoms.indexOf((720 - 72 - 48) + ':' + (1280 - 72 - 48) + ':48');
  assert.ok(idxM96 < idxM72);
});

test('candidatesFor portrait 1080x1920: includes the explicit 72px pair, m108 before m144', () => {
  const c = V.candidatesFor(1080, 1920);
  const geoms = c.map(x => x.x + ':' + x.y + ':' + x.size);
  const i108 = geoms.indexOf('900:1740:72');
  const i144 = geoms.indexOf('864:1704:72');
  assert.ok(i108 !== -1 && i144 !== -1);
  assert.ok(i108 < i144);
});

test('candidatesFor: tiny video filters out-of-bounds candidates', () => {
  const c = V.candidatesFor(100, 100);
  c.forEach(x => {
    assert.ok(x.x >= 0 && x.y >= 0 && x.x + x.size <= 100 && x.y + x.size <= 100);
  });
});

test('shouldClean: on for a Flow share link by default', () => {
  assert.strictEqual(V.shouldClean({ url: FLOW, quality: 'fhd' }), true);
  assert.strictEqual(V.shouldClean({ url: FLOW, quality: 'fhd', flowDewatermark: true }), true);
});

test('shouldClean: off when disabled, audio-only, or not a Flow share', () => {
  assert.strictEqual(V.shouldClean({ url: FLOW, quality: 'fhd', flowDewatermark: false }), false);
  assert.strictEqual(V.shouldClean({ url: FLOW, quality: 'audioOnly' }), false);
  assert.strictEqual(V.shouldClean({ url: 'https://youtube.com/watch?v=x', quality: 'fhd' }), false);
  assert.strictEqual(V.shouldClean({ url: 'https://labs.google/fx/tools/flow/project/abc', quality: 'fhd' }), false);
});

test('settings default: flowDewatermark ships ON', () => {
  assert.strictEqual(settings.DEFAULTS.flowDewatermark, true);
});

test('supportedPixFmt: 8-bit 4:2:0 only', () => {
  assert.strictEqual(V.supportedPixFmt('yuv420p'), true);
  assert.strictEqual(V.supportedPixFmt('yuvj420p'), true);
  assert.strictEqual(V.supportedPixFmt('yuv420p10le'), false);
  assert.strictEqual(V.supportedPixFmt(''), false);
});

test('parseVideoProbe: real ffprobe shape', () => {
  const out = 'width=1280\nheight=720\nr_frame_rate=24/1\npix_fmt=yuv420p\nduration=8.000000\n';
  assert.deepStrictEqual(V.parseVideoProbe(out), {
    width: 1280, height: 720, fps: 24, fpsStr: '24/1', pixFmt: 'yuv420p', duration: 8
  });
});

test('parseVideoProbe: null on missing dims', () => {
  assert.strictEqual(V.parseVideoProbe('pix_fmt=yuv420p\n'), null);
  assert.strictEqual(V.parseVideoProbe(''), null);
});

test('probeFrameIndexes: 25/50/75% of 8s@24fps', () => {
  const meta = { width: 1280, height: 720, fps: 24, fpsStr: '24/1', pixFmt: 'yuv420p', duration: 8 };
  assert.deepStrictEqual(V.probeFrameIndexes(meta), [48, 96, 144]);
});

test('probeFrameIndexes: fallback without duration, deduped', () => {
  assert.deepStrictEqual(V.probeFrameIndexes({ fps: 24, duration: 0 }), [10, 20, 30]);
  // very short video: indexes collapse and dedupe, never negative
  const short = V.probeFrameIndexes({ fps: 24, duration: 0.1 });
  assert.ok(short.length >= 1);
  short.forEach(n => assert.ok(n >= 0));
});

test('parseCalibration: accepts valid JSON, rejects junk', () => {
  assert.deepStrictEqual(
    V.parseCalibration('{"ok":true,"x":1136,"y":576,"size":48,"gain":0.6}'),
    { x: 1136, y: 576, size: 48, gain: 0.6 }
  );
  assert.strictEqual(V.parseCalibration('{"ok":false,"reason":"not-found"}'), null);
  assert.strictEqual(V.parseCalibration('not json'), null);
  assert.strictEqual(V.parseCalibration('{"ok":true,"x":1,"y":2}'), null);
  assert.strictEqual(V.parseCalibration('{"ok":true,"x":1,"y":2,"size":48,"gain":99}'), null);
});

test('arg builders: exact ffmpeg/ffprobe/deno argv arrays', () => {
  const meta = { width: 1280, height: 720, fps: 24, fpsStr: '24/1', pixFmt: 'yuv420p', duration: 8 };
  assert.deepStrictEqual(V.probeDimsArgs('/t/in.mp4'), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt',
    '-show_entries', 'format=duration', '-of', 'default=nw=1', '/t/in.mp4'
  ]);
  assert.deepStrictEqual(V.extractProbeArgs('/t/in.mp4', [48, 96, 144], '/t/p.raw'), [
    '-v', 'error', '-y', '-i', '/t/in.mp4',
    '-vf', "select='eq(n\\,48)+eq(n\\,96)+eq(n\\,144)',setpts=N/FRAME_RATE/TB",
    '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgba', '/t/p.raw'
  ]);
  assert.deepStrictEqual(V.decodeArgs('/t/in.mp4'), [
    '-v', 'error', '-i', '/t/in.mp4', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'
  ]);
  assert.deepStrictEqual(V.encodeArgs('/t/in.mp4', meta, '/t/out.mp4'), [
    '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1280x720', '-framerate', '24/1', '-i', 'pipe:0',
    '-i', '/t/in.mp4', '-map', '0:v:0', '-map', '1:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'copy', '-movflags', '+faststart', '/t/out.mp4'
  ]);
  const cands = [{ x: 1136, y: 576, size: 48 }];
  assert.deepStrictEqual(V.calibrateArgs('/ext/deno/veoClean.mjs', '/t/p.raw', meta, cands), [
    'run', '--quiet', '--allow-read=/t/p.raw', '/ext/deno/veoClean.mjs',
    '--mode=calibrate', '--width=1280', '--height=720', '--frame=/t/p.raw',
    '--candidates=' + JSON.stringify(cands)
  ]);
  assert.deepStrictEqual(V.filterArgs('/ext/deno/veoClean.mjs', meta, { x: 1136, y: 576, size: 48, gain: 0.6 }), [
    'run', '--quiet', '/ext/deno/veoClean.mjs',
    '--mode=filter', '--width=1280', '--height=720',
    '--x=1136', '--y=576', '--size=48', '--gain=0.6'
  ]);
});

test('WARNING copy is exact', () => {
  assert.strictEqual(V.WARNING, 'Watermark not removed — imported original.');
});

test('warningFor: each cause maps to a distinct, actionable warning that names the fallback', () => {
  const byCause = {
    tools: V.warningFor('tools'),
    'install-failed': V.warningFor('install-failed'),
    format: V.warningFor('format'),
    'not-recognized': V.warningFor('not-recognized'),
    pipeline: V.warningFor('pipeline')
  };
  assert.ok(/repair/i.test(byCause.tools), 'tools points at Settings Repair');
  assert.ok(/download/i.test(byCause['install-failed']), 'install-failed names the download');
  assert.ok(/format/i.test(byCause.format));
  assert.ok(/detect/i.test(byCause['not-recognized']));
  assert.ok(/processing/i.test(byCause.pipeline));
  const all = Object.keys(byCause).map(k => byCause[k]);
  all.forEach(w => assert.ok(/imported original/i.test(w), 'every warning explains the fallback'));
  assert.strictEqual(new Set(all).size, all.length, 'strings are distinct');
});

test('warningFor: unknown or missing cause falls back to the generic warning', () => {
  assert.strictEqual(V.warningFor('bogus'), V.WARNING);
  assert.strictEqual(V.warningFor(), V.WARNING);
});

test('parseCalibrationFailure: reason and presence from a calibrate ok:false payload', () => {
  assert.deepStrictEqual(
    V.parseCalibrationFailure('{"ok":false,"reason":"not-found","presence":0.0123}'),
    { reason: 'not-found', presence: 0.0123 }
  );
  // presence optional in the payload -> defaults to null
  assert.deepStrictEqual(
    V.parseCalibrationFailure('{"ok":false,"reason":"bad-args"}'),
    { reason: 'bad-args', presence: null }
  );
});

test('parseCalibrationFailure: null for success payloads, junk, and empty', () => {
  assert.strictEqual(V.parseCalibrationFailure('{"ok":true,"x":1}'), null);
  assert.strictEqual(V.parseCalibrationFailure('garbage'), null);
  assert.strictEqual(V.parseCalibrationFailure(''), null);
});

test('extractProbeArgs never uses -vsync (removed from current ffmpeg builds)', () => {
  // Field failure 2026-07-11: Windows ships yt-dlp's master-latest ffmpeg,
  // which removed the long-deprecated -vsync option — every probe extraction
  // died with "Unrecognized option 'vsync'". setpts=N/FRAME_RATE/TB in the
  // filter chain is byte-identical output and works on every ffmpeg version.
  const args = V.extractProbeArgs('/t/in.mp4', [1, 2], '/t/p.raw');
  assert.ok(args.indexOf('-vsync') === -1);
  assert.ok(args.indexOf('-fps_mode') === -1, 'fps_mode is 5.1+ only — do not reintroduce a version-gated flag');
  assert.ok(/setpts=N\/FRAME_RATE\/TB/.test(args[args.indexOf('-vf') + 1]));
});
