# Flow Watermark Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flow share links automatically get the Veo sparkle watermark removed before the clip is imported into Premiere.

**Architecture:** A new post-download stage in `downloadEngine.js` for Flow items: ffprobe the file → extract 3 probe frames → a Deno script calibrates position+gain against GWR's vendored alpha maps → a 3-process pipe (ffmpeg decode | Deno reverse-alpha filter | ffmpeg encode) produces the clean file → the existing move/import path runs unchanged. Any failure imports the original with a `⚠` warning — footage is never blocked.

**Tech Stack:** ES5 CommonJS (panel), modern ESM (Deno script — runs only under the bundled `panel/bin/deno`), bundled ffmpeg/ffprobe, `node --test`.

## Global Constraints

- Panel JS is ES5 (`var`, no arrows/template literals) — CEP's old engine. Deno scripts (`panel/deno/*.mjs`) are modern ESM.
- No new npm dependencies; no new binaries.
- Alpha maps vendored from https://github.com/GargantuaX/gemini-watermark-remover (MIT) as **base64 text** — never raw binary in a .js file (NUL-byte git trap). Scan with `perl -ne 'exit 1 if /\x00/'` before committing.
- All tests offline; tests spawning the bundled Deno must skip when the binary is absent.
- New files < 400 lines (vendored `alphaMaps.mjs` data file is exempt: generated/vendored).
- Removal formula (GWR `blendModes.js`, keep constants verbatim): `ALPHA_NOISE_FLOOR = 3/255`, `ALPHA_THRESHOLD = 0.002`, `MAX_ALPHA = 0.99`, white logo `255`, negative alpha ⇒ dark logo `0`; `original = (wm − α·logo)/(1−α)`.
- Encode profile: `libx264 -preset veryfast -crf 18 -pix_fmt yuv420p`, BT.709 tags, `-c:a copy`, optional audio map (`1:a:0?`), `+faststart`.
- Warning copy (exact): `Watermark not removed — imported original.`

---

### Task 1: Pure logic module `veoWatermark.js`

**Files:**
- Create: `panel/js/veoWatermark.js`
- Test: `test/veoWatermark.test.js`

**Interfaces:**
- Consumes: `flow.shareId(url)` from `panel/js/flow.js`.
- Produces (used by Tasks 2–5):
  - `candidatesFor(width, height)` → `[{x, y, size, priority}]` sorted by priority asc, deduped, in-bounds only.
  - `shouldClean(opts)` → bool (`opts.flowDewatermark !== false` && `opts.quality !== 'audioOnly'` && Flow share URL).
  - `supportedPixFmt(s)` → bool (`yuv420p` / `yuvj420p`).
  - `parseVideoProbe(text)` → `{width, height, fps, fpsStr, pixFmt, duration}` or `null`.
  - `probeFrameIndexes(meta)` → `[n1, n2, n3]` frame numbers at 25/50/75% (fallback `[10, 20, 30]`).
  - `parseCalibration(text)` → `{x, y, size, gain}` or `null` (requires `ok === true`, finite fields, `gain` in (0, 3]).
  - `probeDimsArgs(file)`, `extractProbeArgs(file, frames, outRaw)`, `decodeArgs(file)`, `encodeArgs(file, meta, outFile)`, `calibrateArgs(script, probeRaw, meta, candidates)`, `filterArgs(script, meta, cal)` → string arrays.
  - `WARNING` → the exact warning copy above.

- [ ] **Step 1: Write the failing test**

```js
// test/veoWatermark.test.js
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
    '-vf', "select='eq(n\\,48)+eq(n\\,96)+eq(n\\,144)'",
    '-vsync', '0', '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgba', '/t/p.raw'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- 2>&1 | grep -A2 veoWatermark | head -20` (or `node --test test/veoWatermark.test.js`)
Expected: FAIL — `Cannot find module '../panel/js/veoWatermark.js'`

- [ ] **Step 3: Write the implementation**

```js
// panel/js/veoWatermark.js
// Pure logic for the Flow (Veo) watermark-removal stage: candidate geometry,
// decisions, probe parsing, and argv builders for the ffmpeg|deno|ffmpeg chain.
// Geometry catalog ported from gemini-watermark-remover (MIT,
// https://github.com/GargantuaX/gemini-watermark-remover) videoWatermarkCatalog.js.
// No I/O — fully unit-testable.
var flow = require('./flow.js');

var WARNING = 'Watermark not removed — imported original.';

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

// One candidate rectangle from a size + right/bottom margins, clamped in-bounds.
function cand(size, mr, mb, priority, w, h) {
  var s = clampInt(size, 24, Math.min(w, h));
  var marginRight = clampInt(mr, 0, w - s);
  var marginBottom = clampInt(mb, 0, h - s);
  return { x: w - marginRight - s, y: h - marginBottom - s, size: s, priority: priority };
}

function inBounds(c, w, h) {
  return c.x >= 0 && c.y >= 0 && c.x + c.size <= w && c.y + c.size <= h;
}

// Ordered candidate rectangles for the Veo sparkle at a given video size.
// Reference: 1080p sparkle is 72px at margin 108 (standard) or 144 (inset),
// scaled by min-ratio for other sizes; plus exact-size extras per catalog.
// 1280x720 prefers inset first — that's where real Veo clips measure.
function candidatesFor(w, h) {
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return [];
  var scale = Math.min(w / 1920, h / 1080);
  var is720 = (w === 1280 && h === 720);
  var out = [
    cand(72 * scale, 108 * scale, 108 * scale, is720 ? 1 : 0, w, h),   // standard
    cand(72 * scale, 144 * scale, 144 * scale, is720 ? 0 : 1, w, h)    // inset
  ];
  if (is720) out.push(cand(44, 29, 40, 2, w, h));
  if (w === 1080 && h === 1920) {
    out.push(cand(72, 108, 108, 0, w, h), cand(72, 144, 144, 1, w, h));
  }
  if (w === 720 && h === 1280) {
    out.push(cand(48, 96, 96, 0, w, h), cand(48, 72, 72, 1, w, h),
             cand(35, 102, 96, 1, w, h), cand(44, 29, 40, 3, w, h));
  }
  // in-bounds, dedupe by geometry (keep best priority), sort by priority
  var byKey = {};
  for (var i = 0; i < out.length; i++) {
    var c = out[i];
    if (!inBounds(c, w, h)) continue;
    var k = c.x + ':' + c.y + ':' + c.size;
    if (!byKey.hasOwnProperty(k) || c.priority < byKey[k].priority) byKey[k] = c;
  }
  var list = [];
  for (var k2 in byKey) { if (byKey.hasOwnProperty(k2)) list.push(byKey[k2]); }
  // ES5 sort isn't guaranteed stable on the old CEF — deterministic tiebreaks.
  list.sort(function (a, b) {
    return (a.priority - b.priority) || (b.size - a.size) || (a.x - b.x) || (a.y - b.y);
  });
  return list;
}

// Clean this download? Flow share link + setting on + an actual video.
function shouldClean(opts) {
  if (!opts || opts.flowDewatermark === false) return false;
  if (opts.quality === 'audioOnly') return false;
  return !!flow.shareId(opts.url);
}

// The raw RGBA pipe assumes 8-bit 4:2:0 in/out (Veo output is yuv420p).
function supportedPixFmt(s) {
  return /^yuvj?420p$/.test(String(s || ''));
}

// Parse `ffprobe -of default=nw=1` output (probeDimsArgs below).
function parseVideoProbe(text) {
  var m = {};
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var i = line.indexOf('=');
    if (i > 0) m[line.slice(0, i)] = line.slice(i + 1);
  });
  var width = parseInt(m.width, 10);
  var height = parseInt(m.height, 10);
  if (!width || !height) return null;
  var fps = 0;
  var fr = String(m.r_frame_rate || '');
  var parts = fr.split('/');
  if (parts.length === 2 && parseFloat(parts[1]) > 0) fps = parseFloat(parts[0]) / parseFloat(parts[1]);
  else fps = parseFloat(fr) || 0;
  return {
    width: width, height: height,
    fps: fps, fpsStr: fr || '24/1',
    pixFmt: String(m.pix_fmt || ''),
    duration: parseFloat(m.duration) || 0
  };
}

// Three probe frames at 25/50/75% — robust to fades and flat regions.
function probeFrameIndexes(meta) {
  var total = Math.floor((meta.duration || 0) * (meta.fps || 0));
  var picks = total >= 4
    ? [Math.floor(total * 0.25), Math.floor(total * 0.5), Math.floor(total * 0.75)]
    : (total >= 1 ? [0, Math.floor(total / 2), total - 1] : [10, 20, 30]);
  var seen = {}, out = [];
  for (var i = 0; i < picks.length; i++) {
    var n = Math.max(0, picks[i]);
    if (!seen[n]) { seen[n] = true; out.push(n); }
  }
  return out;
}

// Validate the calibrate JSON from veoClean.mjs.
function parseCalibration(text) {
  var o;
  try { o = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!o || o.ok !== true) return null;
  var fields = ['x', 'y', 'size', 'gain'];
  for (var i = 0; i < fields.length; i++) {
    if (typeof o[fields[i]] !== 'number' || !isFinite(o[fields[i]])) return null;
  }
  if (o.gain <= 0 || o.gain > 3) return null;
  return { x: o.x, y: o.y, size: o.size, gain: o.gain };
}

// ---- argv builders --------------------------------------------------------

function probeDimsArgs(file) {
  return ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt',
    '-show_entries', 'format=duration', '-of', 'default=nw=1', file];
}

function extractProbeArgs(file, frames, outRaw) {
  var sel = frames.map(function (n) { return 'eq(n\\,' + n + ')'; }).join('+');
  return ['-v', 'error', '-y', '-i', file,
    '-vf', "select='" + sel + "'",
    '-vsync', '0', '-frames:v', String(frames.length),
    '-f', 'rawvideo', '-pix_fmt', 'rgba', outRaw];
}

function decodeArgs(file) {
  return ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
}

function encodeArgs(file, meta, outFile) {
  return ['-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', meta.width + 'x' + meta.height,
    '-framerate', meta.fpsStr, '-i', 'pipe:0',
    '-i', file, '-map', '0:v:0', '-map', '1:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'copy', '-movflags', '+faststart', outFile];
}

function calibrateArgs(script, probeRaw, meta, candidates) {
  return ['run', '--quiet', '--allow-read=' + probeRaw, script,
    '--mode=calibrate', '--width=' + meta.width, '--height=' + meta.height,
    '--frame=' + probeRaw, '--candidates=' + JSON.stringify(candidates)];
}

function filterArgs(script, meta, cal) {
  return ['run', '--quiet', script,
    '--mode=filter', '--width=' + meta.width, '--height=' + meta.height,
    '--x=' + cal.x, '--y=' + cal.y, '--size=' + cal.size, '--gain=' + cal.gain];
}

module.exports = {
  candidatesFor: candidatesFor,
  shouldClean: shouldClean,
  supportedPixFmt: supportedPixFmt,
  parseVideoProbe: parseVideoProbe,
  probeFrameIndexes: probeFrameIndexes,
  parseCalibration: parseCalibration,
  probeDimsArgs: probeDimsArgs,
  extractProbeArgs: extractProbeArgs,
  decodeArgs: decodeArgs,
  encodeArgs: encodeArgs,
  calibrateArgs: calibrateArgs,
  filterArgs: filterArgs,
  WARNING: WARNING
};
```

Also add the settings default now (the test asserts it): in `panel/js/settings.js` DEFAULTS, after `ytDlpLastUpdate: 0` add:

```js
  ytDlpLastUpdate: 0,                                        // ms epoch of the last yt-dlp download; 0 = never (drives the 14-day auto-update)
  flowDewatermark: true                                      // auto-remove the Veo sparkle from Google Flow downloads
```

(720p compact expectation `[1207, 636, 44]` = `x: 1280−29−44, y: 720−40−44`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/veoWatermark.test.js`
Expected: all PASS

- [ ] **Step 5: Run the whole suite, then commit**

```bash
npm test
git add panel/js/veoWatermark.js panel/js/settings.js test/veoWatermark.test.js
git commit -m "feat(flow): add veoWatermark pure logic — candidate catalog, decisions, argv builders"
```

---

### Task 2: Deno frame processor `veoClean.mjs` + vendored alpha maps

**Files:**
- Create: `panel/deno/alphaMaps.mjs` (generated/vendored — exempt from size contract)
- Create: `panel/deno/veoClean.mjs`
- Test: `test/veoClean.test.js`

**Interfaces:**
- Consumes: CLI argv shapes exactly as built by Task 1's `calibrateArgs`/`filterArgs`.
- Produces:
  - `--mode=calibrate`: prints one-line JSON `{ok:true, x, y, size, gain, presence, residual}` and exits 0, or `{ok:false, reason}` and exits 3.
  - `--mode=filter`: raw RGBA frames stdin→stdout, watermark region cleaned.
  - `--mode=stamp --frame=in.raw --out=out.raw`: forward-blends the watermark (test helper).
  - `alphaMaps.mjs` exports `getAlphaMap(size)` → `Float32Array` for base sizes 48 and 96.

- [ ] **Step 1: Vendor the alpha maps**

```bash
SCRATCH=$(mktemp -d)
git clone --depth 1 https://github.com/GargantuaX/gemini-watermark-remover.git "$SCRATCH/gwr"
mkdir -p panel/deno
# Quoted heredoc — no shell expansion; the clone path arrives via Deno.args.
cat > "$SCRATCH/gen.mjs" <<'EOF'
const { getEmbeddedAlphaMap } = await import('file://' + Deno.args[0] + '/src/core/embeddedAlphaMaps.js');
function b64(map) {
  const bytes = new Uint8Array(map.buffer, map.byteOffset, map.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const lines = [
  '// panel/deno/alphaMaps.mjs',
  '// VENDORED DATA — Veo/Gemini watermark alpha maps from',
  '// https://github.com/GargantuaX/gemini-watermark-remover (MIT, GargantuaX).',
  '// Base64 of little-endian Float32Array (48*48 and 96*96). Regenerate with the',
  '// script in docs/superpowers/plans/2026-07-10-flow-watermark-removal.md Task 2.',
  'const B64 = {',
  "  48: '" + b64(getEmbeddedAlphaMap(48)) + "',",
  "  96: '" + b64(getEmbeddedAlphaMap(96)) + "'",
  '};',
  'export function getAlphaMap(size) {',
  '  const s = atob(B64[size]);',
  '  const bytes = new Uint8Array(s.length);',
  '  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);',
  '  return new Float32Array(bytes.buffer);',
  '}',
  ''
].join('\n');
await Deno.writeTextFile('panel/deno/alphaMaps.mjs', lines);
console.log('written', lines.length, 'chars');
EOF
panel/bin/deno run --allow-read --allow-write "$SCRATCH/gen.mjs" "$SCRATCH/gwr"
perl -ne 'exit 1 if /\x00/' panel/deno/alphaMaps.mjs && echo "NUL scan clean"
```

Expected: `written <n> chars` then `NUL scan clean`.

- [ ] **Step 2: Write the failing test**

```js
// test/veoClean.test.js
// Round-trips a synthetic watermark through the bundled Deno script:
// stamp -> calibrate (must find where/how strong) -> filter (must remove it).
// Offline; skips when the bundled deno binary isn't installed (CI).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const DENO = path.join(__dirname, '..', 'panel', 'bin', process.platform === 'win32' ? 'deno.exe' : 'deno');
const SCRIPT = path.join(__dirname, '..', 'panel', 'deno', 'veoClean.mjs');
const hasDeno = fs.existsSync(DENO);
const W = 1280, H = 720, X = 1136, Y = 576, SIZE = 48, GAIN = 0.6;

// Deterministic textured background (LCG noise + gradient) — no randomness.
function makeBackground() {
  const buf = Buffer.alloc(W * H * 4);
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const base = 60 + ((x / W) * 80) | 0;
    buf[i * 4] = Math.min(255, base + rnd() * 60);
    buf[i * 4 + 1] = Math.min(255, base + 20 + rnd() * 60);
    buf[i * 4 + 2] = Math.min(255, ((y / H) * 90 | 0) + rnd() * 60);
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function runDeno(args, input) {
  return spawnSync(DENO, args, { input, maxBuffer: 1 << 30 });
}

test('veoClean stamp -> calibrate -> filter round-trip', { skip: !hasDeno && 'bundled deno not installed' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veoclean-'));
  const bg = makeBackground();
  const bgFile = path.join(tmp, 'bg.raw');
  const wmFile = path.join(tmp, 'wm.raw');
  fs.writeFileSync(bgFile, bg);

  // 1. stamp a watermark at the known 720p inset position, gain 0.6
  const st = runDeno(['run', '--quiet', '--allow-read', '--allow-write', SCRIPT,
    `--mode=stamp`, `--width=${W}`, `--height=${H}`,
    `--x=${X}`, `--y=${Y}`, `--size=${SIZE}`, `--gain=${GAIN}`,
    `--frame=${bgFile}`, `--out=${wmFile}`]);
  assert.strictEqual(st.status, 0, String(st.stderr));
  const wm = fs.readFileSync(wmFile);
  assert.notDeepStrictEqual(wm, bg, 'stamp must change pixels');

  // 2. calibrate must find the right candidate and roughly the right gain
  const candidates = [
    { x: X, y: Y, size: SIZE },        // truth
    { x: 1160, y: 600, size: SIZE },   // decoy (standard position)
    { x: 1207, y: 636, size: 44 }      // decoy (compact)
  ];
  const cal = runDeno(['run', '--quiet', `--allow-read=${wmFile}`, SCRIPT,
    `--mode=calibrate`, `--width=${W}`, `--height=${H}`,
    `--frame=${wmFile}`, `--candidates=${JSON.stringify(candidates)}`]);
  assert.strictEqual(cal.status, 0, String(cal.stderr));
  const res = JSON.parse(String(cal.stdout));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.x, X);
  assert.strictEqual(res.y, Y);
  assert.strictEqual(res.size, SIZE);
  assert.ok(Math.abs(res.gain - GAIN) <= 0.11, `gain ${res.gain} should be ~${GAIN}`);

  // 3. filter (streaming stdin->stdout) must restore the background
  const cleaned = await new Promise((resolve, reject) => {
    const p = spawn(DENO, ['run', '--quiet', SCRIPT,
      `--mode=filter`, `--width=${W}`, `--height=${H}`,
      `--x=${res.x}`, `--y=${res.y}`, `--size=${res.size}`, `--gain=${res.gain}`]);
    const chunks = [];
    p.stdout.on('data', c => chunks.push(c));
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('filter exit ' + code)));
    p.stdin.write(wm);
    p.stdin.end();
  });
  assert.strictEqual(cleaned.length, bg.length);

  // outside the watermark rect: bit-exact passthrough
  const firstRowStart = (Y - 2) * W * 4;
  assert.deepStrictEqual(cleaned.subarray(0, firstRowStart), bg.subarray(0, firstRowStart));

  // inside: near-exact reconstruction (rounding leaves ±2 per channel)
  let maxDiff = 0, sumDiff = 0, n = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const i = ((Y + r) * W + (X + c)) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const d = Math.abs(cleaned[i + ch] - bg[i + ch]);
        maxDiff = Math.max(maxDiff, d); sumDiff += d; n++;
      }
    }
  }
  assert.ok(sumDiff / n < 1.5, `mean abs diff ${sumDiff / n} should be < 1.5`);
  assert.ok(maxDiff <= 30, `max abs diff ${maxDiff} (clipped highlights only)`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('veoClean calibrate: refuses a frame with no watermark', { skip: !hasDeno && 'bundled deno not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veoclean-'));
  const bgFile = path.join(tmp, 'bg.raw');
  fs.writeFileSync(bgFile, makeBackground());
  const cal = runDeno(['run', '--quiet', `--allow-read=${bgFile}`, SCRIPT,
    `--mode=calibrate`, `--width=${W}`, `--height=${H}`,
    `--frame=${bgFile}`, `--candidates=${JSON.stringify([{ x: X, y: Y, size: SIZE }])}`]);
  assert.strictEqual(cal.status, 3);
  assert.strictEqual(JSON.parse(String(cal.stdout)).ok, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/veoClean.test.js`
Expected: FAIL (script missing) — or SKIP on machines without the bundled deno.

- [ ] **Step 4: Write the implementation**

```js
// panel/deno/veoClean.mjs
// Veo/Flow sparkle watermark removal — runs ONLY under the bundled Deno
// (modern ESM; the ES5 rule for panel/js does not apply here).
//
// Reverse alpha blending after GargantuaX/gemini-watermark-remover (MIT):
//   watermarked = α·logo + (1−α)·original  =>  original = (wm − α·logo)/(1−α)
//
// Modes (argv):
//   --mode=calibrate --width --height --frame=<raw rgba, N frames> --candidates=<json>
//       Scores candidate rectangles × gain ladder on the probe frames; prints
//       {ok:true, x,y,size,gain, presence, residual} or {ok:false, reason} (exit 3).
//   --mode=filter --width --height --x --y --size --gain
//       Streams raw RGBA frames stdin→stdout, cleaning the rectangle per frame.
//   --mode=stamp --width --height --x --y --size --gain --frame=<in> --out=<file>
//       Forward-blends the watermark onto a frame (test helper).
import { getAlphaMap } from './alphaMaps.mjs';

const ALPHA_NOISE_FLOOR = 3 / 255;
const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;
const LOGO_VALUE = 255;
const GAIN_LADDER = [0.45, 0.55, 0.6, 0.7, 0.85, 1.0, 1.15, 1.3];
const MIN_PRESENCE = 0.25;   // template must correlate with the probe this well
const MAX_RESIDUAL = 0.15;   // ...and removal must push residual below this

const args = {};
for (const a of Deno.args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const W = +args.width, H = +args.height;

// Bilinear resample of a square alpha map (preserves sign for dark-polarity).
function resampleAlpha(map, src, dst) {
  if (src === dst) return map;
  const out = new Float32Array(dst * dst);
  const ratio = src / dst;
  for (let r = 0; r < dst; r++) {
    for (let c = 0; c < dst; c++) {
      const fy = Math.min(src - 1, (r + 0.5) * ratio - 0.5);
      const fx = Math.min(src - 1, (c + 0.5) * ratio - 0.5);
      const y0 = Math.max(0, Math.floor(fy)), x0 = Math.max(0, Math.floor(fx));
      const y1 = Math.min(src - 1, y0 + 1), x1 = Math.min(src - 1, x0 + 1);
      const wy = fy - y0, wx = fx - x0;
      out[r * dst + c] =
        map[y0 * src + x0] * (1 - wy) * (1 - wx) + map[y0 * src + x1] * (1 - wy) * wx +
        map[y1 * src + x0] * wy * (1 - wx) + map[y1 * src + x1] * wy * wx;
    }
  }
  return out;
}

function templateFor(size) {
  const base = size > 64 ? 96 : 48;
  return resampleAlpha(getAlphaMap(base), base, size);
}

// Precompute the active pixels for one (rect, gain): index offsets + strengths.
// The hot filter loop then touches only these pixels per frame.
function buildOps(tpl, x, y, size, gain) {
  const ops = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const raw = tpl[r * size + c];
      const mag = Math.abs(raw);
      const signal = Math.max(0, mag - ALPHA_NOISE_FLOOR) * gain;
      if (signal < ALPHA_THRESHOLD) continue;
      const a = Math.min(mag * gain, MAX_ALPHA);
      ops.push({
        idx: ((y + r) * W + (x + c)) * 4,
        a,
        logo: raw < 0 ? 0 : LOGO_VALUE
      });
    }
  }
  return ops;
}

function removeWith(ops, frame) {
  for (const op of ops) {
    const oma = 1 - op.a, al = op.a * op.logo;
    for (let ch = 0; ch < 3; ch++) {
      const v = Math.round((frame[op.idx + ch] - al) / oma);
      frame[op.idx + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

function stampWith(ops, frame) {
  for (const op of ops) {
    const oma = 1 - op.a, al = op.a * op.logo;
    for (let ch = 0; ch < 3; ch++) {
      const v = Math.round(frame[op.idx + ch] * oma + al);
      frame[op.idx + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// ---- calibration ----------------------------------------------------------

function lumaRegion(frame, x, y, size) {
  const out = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = ((y + r) * W + (x + c)) * 4;
      out[r * size + c] = 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
    }
  }
  return out;
}

// Two-pass box blur; highpass = luma − blur. Kills the background's low
// frequencies so the sparkle's shape dominates the correlation.
function highpass(region, size) {
  const radius = Math.max(2, size >> 3);
  const tmp = new Float32Array(size * size);
  const blur = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let sum = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const cc = c + k;
        if (cc >= 0 && cc < size) { sum += region[r * size + cc]; n++; }
      }
      tmp[r * size + c] = sum / n;
    }
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let sum = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const rr = r + k;
        if (rr >= 0 && rr < size) { sum += tmp[rr * size + c]; n++; }
      }
      blur[r * size + c] = sum / n;
    }
  }
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = region[i] - blur[i];
  return out;
}

// Normalized cross-correlation of a zero-mean template vs a signal.
function ncc(tpl0, sig) {
  let dot = 0, tt = 0, ss = 0, mean = 0;
  for (let i = 0; i < sig.length; i++) mean += sig[i];
  mean /= sig.length;
  for (let i = 0; i < sig.length; i++) {
    const s = sig[i] - mean;
    dot += tpl0[i] * s; tt += tpl0[i] * tpl0[i]; ss += s * s;
  }
  return tt > 0 && ss > 0 ? dot / Math.sqrt(tt * ss) : 0;
}

function zeroMeanTemplate(tpl) {
  const out = new Float32Array(tpl.length);
  let mean = 0;
  for (let i = 0; i < tpl.length; i++) mean += Math.abs(tpl[i]);
  mean /= tpl.length;
  for (let i = 0; i < tpl.length; i++) out[i] = Math.abs(tpl[i]) - mean;
  return out;
}

async function calibrate() {
  const bytes = await Deno.readFile(args.frame);
  const frameBytes = W * H * 4;
  const frameCount = Math.floor(bytes.length / frameBytes);
  if (frameCount < 1) return fail('probe-empty');
  const candidates = JSON.parse(args.candidates);
  const frames = [];
  for (let f = 0; f < frameCount; f++) frames.push(bytes.subarray(f * frameBytes, (f + 1) * frameBytes));

  // 1. position: candidate whose template best matches the highpassed probe
  let best = null;
  for (const c of candidates) {
    const tpl = templateFor(c.size);
    const tpl0 = zeroMeanTemplate(tpl);
    let presence = 0;
    for (const fr of frames) presence += ncc(tpl0, highpass(lumaRegion(fr, c.x, c.y, c.size), c.size));
    presence /= frames.length;
    if (!best || presence > best.presence) best = { c, tpl, tpl0, presence };
  }
  if (!best || best.presence < MIN_PRESENCE) return fail('not-found', { presence: best ? best.presence : 0 });

  // 2. gain: the rung that leaves the least sparkle-shaped residual
  let bestGain = null;
  for (const gain of GAIN_LADDER) {
    const ops = buildOps(best.tpl, best.c.x, best.c.y, best.c.size, gain);
    let residual = 0;
    for (const fr of frames) {
      const copy = fr.slice();
      removeWith(ops, copy);
      residual += Math.abs(ncc(best.tpl0, highpass(lumaRegion(copy, best.c.x, best.c.y, best.c.size), best.c.size)));
    }
    residual /= frames.length;
    if (!bestGain || residual < bestGain.residual) bestGain = { gain, residual };
  }
  if (bestGain.residual > MAX_RESIDUAL) return fail('residual', { residual: bestGain.residual });

  console.log(JSON.stringify({
    ok: true, x: best.c.x, y: best.c.y, size: best.c.size,
    gain: bestGain.gain, presence: +best.presence.toFixed(4), residual: +bestGain.residual.toFixed(4)
  }));
}

function fail(reason, extra) {
  console.log(JSON.stringify(Object.assign({ ok: false, reason }, extra || {})));
  Deno.exit(3);
}

// ---- streaming filter -----------------------------------------------------

async function filter() {
  const ops = buildOps(templateFor(+args.size), +args.x, +args.y, +args.size, +args.gain);
  const frameBytes = W * H * 4;
  const frame = new Uint8Array(frameBytes);
  let filled = 0;
  const writer = Deno.stdout.writable.getWriter();
  for await (const chunk of Deno.stdin.readable) {
    let off = 0;
    while (off < chunk.length) {
      const n = Math.min(chunk.length - off, frameBytes - filled);
      frame.set(chunk.subarray(off, off + n), filled);
      filled += n; off += n;
      if (filled === frameBytes) {
        removeWith(ops, frame);
        await writer.write(frame.slice());
        filled = 0;
      }
    }
  }
  if (filled > 0) await writer.write(frame.slice(0, filled)); // trailing partial: pass through
  await writer.close();
}

async function stamp() {
  const frame = await Deno.readFile(args.frame);
  const ops = buildOps(templateFor(+args.size), +args.x, +args.y, +args.size, +args.gain);
  stampWith(ops, frame);
  await Deno.writeFile(args.out, frame);
}

if (args.mode === 'calibrate') await calibrate();
else if (args.mode === 'filter') await filter();
else if (args.mode === 'stamp') await stamp();
else { console.error('unknown --mode'); Deno.exit(2); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/veoClean.test.js`
Expected: both tests PASS (calibrate finds x=1136/y=576/size=48, gain within 0.11 of 0.6; round-trip mean diff < 1.5; no-watermark frame exits 3).

If the gain assertion fails because the ladder rung 0.55 or 0.7 scores marginally better on synthetic noise, that is a real signal the residual scoring needs the exact-match rung — do NOT widen the assertion beyond ±0.11 without understanding why.

- [ ] **Step 6: Commit**

```bash
perl -ne 'exit 1 if /\x00/' panel/deno/veoClean.mjs panel/deno/alphaMaps.mjs && echo clean
git add panel/deno/ test/veoClean.test.js
git commit -m "feat(flow): add Deno watermark cleaner — calibrate/filter/stamp with vendored GWR alpha maps"
```

---

### Task 3: Engine stage in `downloadEngine.js` + queue warning

**Files:**
- Modify: `panel/js/downloadEngine.js` (require block ~line 11; `download()` opts handling ~line 96; `processOne` ~line 267; `processMany` ~line 242)
- Modify: `panel/js/queue.js:142` (statusMsg on done)
- Test: existing `npm test` must stay green (queue tests cover the no-warning path; engine has no harness — covered by Task 2's script tests + Task 5 e2e).

**Interfaces:**
- Consumes: everything Task 1 exports; `binaries.resolveBinary('deno', {extRoot})`; Task 2's script at `<extRoot>/deno/veoClean.mjs`.
- Produces: `download()`'s result object gains optional `warning: string`; `queue.js` renders it into the done statusMsg.

- [ ] **Step 1: Wire the stage into downloadEngine.js**

Add to the require block after `var flow = require('./flow.js');`:

```js
var veo = require('./veoWatermark.js');
```

In `download()`, after `var presetTemplate = flow.outputTemplate(opts.url);` add:

```js
  // Flow (Veo) clips carry a baked-in sparkle watermark; when enabled, each
  // downloaded video gets a de-watermark pass before import. Failures fall
  // back to the original file with a warning — never block footage.
  var wantClean = veo.shouldClean(opts);
  var cleanWarning = null;
```

Add these functions above `processMany` (they close over `tmp`, `env`, `onProc`, `opts`, `ffmpeg`, `ffprobe`):

```js
  // Collect a process's stdout as a string (stderr kept for error messages).
  function execCollect(exe, cmdArgs, cb) {
    var p = childProcess.spawn(exe, cmdArgs, { env: env });
    var out = '', errOut = '';
    p.stdout.on('data', function (d) { out += d.toString(); });
    p.stderr.on('data', function (d) { errOut += d.toString(); });
    p.on('error', function (e) { cb(e, '', ''); });
    p.on('close', function (code) {
      cb(code === 0 ? null : new Error(exe + ' exited ' + code + ': ' + errOut.slice(-400)), out, errOut);
    });
  }

  // Remove the Veo sparkle: probe -> extract probe frames -> calibrate ->
  // ffmpeg decode | deno filter | ffmpeg encode. cb(err, cleanedPath).
  function cleanFlowWatermark(src, cb) {
    var deno = binaries.resolveBinary('deno', { extRoot: opts.extRoot });
    var script = path.join(opts.extRoot || '', 'deno', 'veoClean.mjs');
    if (!deno || !fs.existsSync(script)) return cb(new Error('watermark tools missing'));
    execCollect(ffprobe, veo.probeDimsArgs(src), function (perr, out) {
      var meta = perr ? null : veo.parseVideoProbe(out);
      if (!meta || !veo.supportedPixFmt(meta.pixFmt)) return cb(new Error('unsupported source format'));
      var candidates = veo.candidatesFor(meta.width, meta.height);
      if (!candidates.length) return cb(new Error('no watermark candidates for this size'));
      var probeRaw = path.join(tmp, 'veo-probe.raw');
      var frames = veo.probeFrameIndexes(meta);
      run(ffmpeg, veo.extractProbeArgs(src, frames, probeRaw), env, null, onProc, function (eerr) {
        if (eerr || !fs.existsSync(probeRaw)) return cb(eerr || new Error('probe extraction failed'));
        execCollect(deno, veo.calibrateArgs(script, probeRaw, meta, candidates), function (calErr, calOut) {
          var cal = veo.parseCalibration(calOut);
          if (!cal) return cb(calErr || new Error('watermark not recognized'));
          var outPath = src.replace(/(\.[^.]+)$/, '.veoclean$1');
          var dec = childProcess.spawn(ffmpeg, veo.decodeArgs(src), { env: env });
          var flt = childProcess.spawn(deno, veo.filterArgs(script, meta, cal), { env: env });
          var enc = childProcess.spawn(ffmpeg, veo.encodeArgs(src, meta, outPath), { env: env });
          onProc(dec); onProc(flt); onProc(enc);
          dec.stdout.pipe(flt.stdin);
          flt.stdout.pipe(enc.stdin);
          // A dying downstream process EPIPEs the upstream stdin — swallow it
          // (failOnce below reports the real cause from the exit codes).
          flt.stdin.on('error', function () {});
          enc.stdin.on('error', function () {});
          var failed = null;
          function failOnce(e) { if (!failed) { failed = e; try { dec.kill(); flt.kill(); enc.kill(); } catch (x) {} } }
          dec.on('error', failOnce); flt.on('error', failOnce); enc.on('error', failOnce);
          dec.on('close', function (code) { if (code !== 0) failOnce(new Error('decode exited ' + code)); });
          flt.on('close', function (code) { if (code !== 0) failOnce(new Error('filter exited ' + code)); });
          enc.on('close', function (code) {
            if (failed || code !== 0) return cb(failed || new Error('encode exited ' + code));
            var ok = false;
            try { ok = fs.statSync(outPath).size > 0; } catch (e) {}
            if (!ok) return cb(new Error('empty output'));
            cb(null, outPath);
          });
        });
      });
    });
  }
```

- [ ] **Step 2: Run the stage from processOne**

In `processOne`, wrap the existing body: rename the current logic after the `dest`/`finish`/`applyAction` setup so the codec-probe/`applyAction` section runs from a `continuePost(actualSrc)` function taking the (possibly swapped) source path, and insert before it:

```js
    if (wantClean) {
      onProgress(null, 'Removing watermark…');
      cleanFlowWatermark(src, function (cerr, cleanedPath) {
        if (cerr) {
          cleanWarning = veo.WARNING;
          return continuePost(src);
        }
        // Swap in the cleaned file under the original name so naming,
        // post-process and import all see the file they expect.
        try {
          fs.rmSync(src);
          fs.renameSync(cleanedPath, src);
        } catch (e) {
          cleanWarning = veo.WARNING;
          return continuePost(src);
        }
        continuePost(src);
      });
      return;
    }
    continuePost(src);
```

Concretely: `processOne`'s existing tail

```js
    var base = { ... };
    var localClip = ...;
    if (!audioOnly && vinfo.needsReencode && !localClip) {
      probeCodec(...);
    } else {
      applyAction(L.choosePostProcess(base, src, dest));
    }
```

becomes the body of `function continuePost(src) { ... }` (shadowing `src` with the parameter), with the `wantClean` block above placed before the call.

- [ ] **Step 3: Report the warning**

In `processMany`'s completion (the `i >= names.length` branch), add `warning` to the result:

```js
        return cb(null, {
          path: results[0].path,
          paths: results.map(function (r) { return r.path; }),
          size: sizeStr,
          warning: cleanWarning
        });
```

In `panel/js/queue.js` line 142, surface it (only the else-branch changes):

```js
        setStatus(job.id, 'done', {
          outputPath: job.res.path,
          statusMsg: impErr
            ? ('Downloaded (import failed): ' + impErr.message)
            : ((job.res.size || 'Done') + (job.res.warning ? ' · ⚠ ' + job.res.warning : ''))
        });
```

- [ ] **Step 4: Full suite green**

Run: `npm test`
Expected: all 192+ tests PASS (new stage is inert unless `wantClean` — non-Flow paths untouched).

- [ ] **Step 5: Commit**

```bash
git add panel/js/downloadEngine.js panel/js/queue.js
git commit -m "feat(flow): de-watermark stage in the download pipeline with fail-soft warning"
```

---

### Task 4: Settings toggle UI

**Files:**
- Modify: `panel/index.html` (after the trimMode field-sub, ~line 155)
- Modify: `panel/js/settingsView.js` (`show()` ~line 58; save handler ~line 148)
- Modify: `panel/js/main.js` (`currentOpts()` ~line 330; playlist opts copy ~line 384)

**Interfaces:**
- Consumes: `flowDewatermark` default added to `settings.js` in Task 1.
- Produces: `opts.flowDewatermark` on every queued item — the bit `veo.shouldClean` reads.

- [ ] **Step 1: index.html — add the toggle after the trim-mode block**

```html
    <label class="field-label">Google Flow</label>
    <label class="radio"><input type="checkbox" id="flowDewatermark"> Remove Flow watermark
      <span class="radio-sub">strips the Veo sparkle from Flow share links before import</span></label>
```

- [ ] **Step 2: settingsView.js — populate + save**

In `show()`, after `$('trimMode').value = s.trimMode || 'fast';`:

```js
    $('flowDewatermark').checked = s.flowDewatermark !== false;
```

In the `saveSettingsBtn` handler, after `state.settings.trimMode = $('trimMode').value;`:

```js
    state.settings.flowDewatermark = $('flowDewatermark').checked;
```

- [ ] **Step 3: main.js — plumb into per-item opts**

In `currentOpts()`, after `trimMode: state.settings.trimMode,`:

```js
    flowDewatermark: state.settings.flowDewatermark !== false,
```

In the playlist-expansion branch (the manual opts copy around line 384), add the same key:

```js
            cookiesBrowser: opts.cookiesBrowser, cookiesFile: opts.cookiesFile, proxyUrl: opts.proxyUrl,
            trimMode: opts.trimMode, flowDewatermark: opts.flowDewatermark, clipEnabled: false
```

- [ ] **Step 4: Suite green + commit**

```bash
npm test
git add panel/index.html panel/js/settingsView.js panel/js/main.js
git commit -m "feat(flow): settings toggle for Flow watermark removal (default on)"
```

---

### Task 5: End-to-end verification, thresholds, docs, version

**Files:**
- Verify: real-clip pipeline in scratchpad (no repo files)
- Modify: `README.md`, `CHANGELOG.md`, `package.json`, `panel/CSXS/manifest.xml`
- Possibly tune: `MIN_PRESENCE` / `MAX_RESIDUAL` in `panel/deno/veoClean.mjs`

- [ ] **Step 1: Real-clip calibration check**

The real watermarked Veo clip pair lives at `~/Downloads/Man_at_desk_working_202607101255.mp4` (watermarked) and `..._gwr_video_mvp.mp4` (GWR-cleaned reference). Run calibrate against the real clip using the actual candidates:

```bash
BIN="panel/bin"; SRC="$HOME/Downloads/Man_at_desk_working_202607101255.mp4"; T=$(mktemp -d)
"$BIN/ffmpeg" -v error -y -i "$SRC" -vf "select='eq(n\,48)+eq(n\,96)+eq(n\,144)'" -vsync 0 -frames:v 3 -f rawvideo -pix_fmt rgba "$T/probe.raw"
"$BIN/deno" run --quiet --allow-read="$T/probe.raw" panel/deno/veoClean.mjs \
  --mode=calibrate --width=1280 --height=720 --frame="$T/probe.raw" \
  --candidates='[{"x":1136,"y":576,"size":48},{"x":1160,"y":600,"size":48},{"x":1207,"y":636,"size":44}]'
```

Expected: `{"ok":true,"x":1136,"y":576,"size":48,"gain":0.6,...}`. Record the printed `presence` and `residual`. If `presence` < 0.25 (busy background lowers highpass correlation), lower `MIN_PRESENCE` to sit ~40% below the measured value and re-run the Task 2 tests. Same logic for `MAX_RESIDUAL`.

- [ ] **Step 2: Real-clip full chain + visual check**

```bash
"$BIN/ffmpeg" -v error -i "$SRC" -f rawvideo -pix_fmt rgba pipe:1 \
  | "$BIN/deno" run --quiet panel/deno/veoClean.mjs --mode=filter --width=1280 --height=720 --x=1136 --y=576 --size=48 --gain=0.6 \
  | "$BIN/ffmpeg" -v error -y -f rawvideo -pix_fmt rgba -s 1280x720 -framerate 24/1 -i pipe:0 \
      -i "$SRC" -map 0:v:0 -map 1:a:0? -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p \
      -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a copy -movflags +faststart "$T/cleaned.mp4"
"$BIN/ffprobe" -v error -show_entries format=duration,size -show_entries stream=codec_name "$T/cleaned.mp4"
"$BIN/ffmpeg" -v error -ss 2 -i "$T/cleaned.mp4" -frames:v 1 -vf "crop=200:200:1080:520,scale=400:400:flags=neighbor" -y "$T/corner.png"
```

Verify: duration 8.0s, h264+aac streams, size 2–5 MB (not 12 MB), and `corner.png` shows no sparkle (compare with the GWR reference file). Show the corner to the user.

- [ ] **Step 3: Docs**

`README.md` — in the Google Flow bullet/section, add one line:

```markdown
Flow downloads automatically lose the Veo sparkle watermark before import
(exact reverse-alpha reconstruction — not blurring; toggle in Settings).
Credit: alpha maps from [gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) (MIT).
```

`CHANGELOG.md` — new section at top:

```markdown
## 3.6.0

- Google Flow: the Veo sparkle watermark is now removed automatically before
  import (Settings ▸ "Remove Flow watermark", on by default). Exact
  mathematical reconstruction of the original pixels — audio untouched, file
  size stays normal. If removal ever fails the original imports with a ⚠ note.
```

- [ ] **Step 4: Version bump**

- `package.json`: `"version": "3.6.0"`
- `panel/CSXS/manifest.xml`: `ExtensionBundleVersion="3.6.0"` (and the matching Extension Version attribute if present — mirror how the 3.5.0 bump commit did it: `git show c6ee5eb -- panel/CSXS/manifest.xml`).

- [ ] **Step 5: Final gate + commit + PR**

```bash
npm test
git ls-files -z -- panel/deno panel/js | xargs -0 perl -ne 'exit 1 if /\x00/' && echo "NUL scan clean"
git add README.md CHANGELOG.md package.json panel/CSXS/manifest.xml
git commit -m "docs(flow): document watermark removal; bump to 3.6.0"
git push -u origin feature/flow-watermark-removal
gh pr create --title "feat(flow): automatic Veo watermark removal for Flow links" --body "..."
```

PR body summarizes: what/why, spike findings (inset position, gain 0.6), fail-soft behavior, encode profile, test coverage, manual verification results (corner screenshots). Manual Premiere import check happens on the dev Mac before merge.
