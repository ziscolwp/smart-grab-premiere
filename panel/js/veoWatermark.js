// panel/js/veoWatermark.js
// Pure logic for the Flow (Veo) watermark-removal stage: candidate geometry,
// decisions, probe parsing, and argv builders for the ffmpeg|deno|ffmpeg chain.
// Geometry catalog ported from gemini-watermark-remover (MIT,
// https://github.com/GargantuaX/gemini-watermark-remover) videoWatermarkCatalog.js.
// No I/O — fully unit-testable.
var flow = require('./flow.js');

var WARNING = 'Watermark not removed — imported original.';

// Per-cause row warnings: same fail-soft outcome, but the user (and remote
// support) can tell WHY. Codes are set by downloadEngine on the error object.
var WARNINGS_BY_CAUSE = {
  'tools': 'Watermark not removed (tools missing — run Settings ▸ Repair downloads) — imported original.',
  'install-failed': 'Watermark not removed (tools download failed — retry via Settings ▸ Repair downloads) — imported original.',
  'format': 'Watermark not removed (unsupported video format) — imported original.',
  'not-recognized': 'Watermark not removed (no watermark detected in this clip) — imported original.',
  'pipeline': 'Watermark not removed (processing failed) — imported original.'
};

function warningFor(cause) {
  return WARNINGS_BY_CAUSE.hasOwnProperty(cause) ? WARNINGS_BY_CAUSE[cause] : WARNING;
}

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

// The calibrate step prints {ok:false, reason, presence?} before exiting 3 —
// extract it so the failure log can say how close the best candidate scored.
function parseCalibrationFailure(text) {
  var o;
  try { o = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!o || o.ok !== false || typeof o.reason !== 'string') return null;
  var presence = (typeof o.presence === 'number' && isFinite(o.presence)) ? o.presence : null;
  return { reason: o.reason, presence: presence };
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
  parseCalibrationFailure: parseCalibrationFailure,
  warningFor: warningFor,
  probeDimsArgs: probeDimsArgs,
  extractProbeArgs: extractProbeArgs,
  decodeArgs: decodeArgs,
  encodeArgs: encodeArgs,
  calibrateArgs: calibrateArgs,
  filterArgs: filterArgs,
  WARNING: WARNING
};
