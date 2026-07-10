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
// Thresholds measured on a real Veo 720p clip over a busy background:
// watermarked probe scored presence 0.25, an already-clean probe 0.006.
// 0.15 sits well inside that 40x separation on the strict side of both.
const MIN_PRESENCE = 0.15;   // template must correlate with the probe this well
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

// ---- flat-background residual smoothing -----------------------------------
// Reverse alpha inverts the blend exactly, but the vendored map's soft edges
// differ subtly from Veo's, leaving a faint sparkle ghost. On busy content
// it's invisible; on flat backgrounds it shows. There a local average IS the
// ground truth, so blend watermark pixels toward the mean of nearby clean
// pixels — gated per frame on measured flatness (GWR's "flat fill" idea).
const SMOOTH_MASK_ALPHA = 0.03;   // template magnitude that marks a ghost pixel
const SMOOTH_FLAT_STD = 6;        // luma stddev of clean pixels that counts as flat

function buildSmooth(tpl, x, y, size) {
  const masked = [];    // { idx, w, neighbors: [frameIdx, ...] }
  const clean = [];     // frame indexes of unmasked pixels (flatness sample + donors)
  const isMasked = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const mag = Math.abs(tpl[r * size + c]);
      if (mag > SMOOTH_MASK_ALPHA) isMasked[r * size + c] = 1;
      else clean.push(((y + r) * W + (x + c)) * 4);
    }
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isMasked[r * size + c]) continue;
      const neighbors = [];
      // grow the donor ring until enough clean pixels are in reach
      for (let rad = 3; rad <= size && neighbors.length < 6; rad += 2) {
        neighbors.length = 0;
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
            if (isMasked[rr * size + cc]) continue;
            neighbors.push(((y + rr) * W + (x + cc)) * 4);
          }
        }
      }
      if (!neighbors.length) continue;
      const mag = Math.abs(tpl[r * size + c]);
      masked.push({
        idx: ((y + r) * W + (x + c)) * 4,
        w: Math.min(1, mag * 3),
        neighbors
      });
    }
  }
  return { masked, clean };
}

function smoothResidual(sm, frame) {
  if (!sm.masked.length || sm.clean.length < 16) return;
  // flatness gate: are the untouched pixels around the sparkle flat?
  let mean = 0;
  for (const i of sm.clean) mean += 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
  mean /= sm.clean.length;
  let varsum = 0;
  for (const i of sm.clean) {
    const l = 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
    varsum += (l - mean) * (l - mean);
  }
  if (Math.sqrt(varsum / sm.clean.length) >= SMOOTH_FLAT_STD) return;
  for (const px of sm.masked) {
    let r = 0, g = 0, b = 0;
    for (const ni of px.neighbors) { r += frame[ni]; g += frame[ni + 1]; b += frame[ni + 2]; }
    const n = px.neighbors.length, w = px.w, ow = 1 - w;
    frame[px.idx] = Math.round(frame[px.idx] * ow + (r / n) * w);
    frame[px.idx + 1] = Math.round(frame[px.idx + 1] * ow + (g / n) * w);
    frame[px.idx + 2] = Math.round(frame[px.idx + 2] * ow + (b / n) * w);
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
  if (!best || best.presence < MIN_PRESENCE) return fail('not-found', { presence: best ? +best.presence.toFixed(4) : 0 });

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
  if (bestGain.residual > MAX_RESIDUAL) return fail('residual', { residual: +bestGain.residual.toFixed(4) });

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
  const tpl = templateFor(+args.size);
  const ops = buildOps(tpl, +args.x, +args.y, +args.size, +args.gain);
  const sm = buildSmooth(tpl, +args.x, +args.y, +args.size);
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
        smoothResidual(sm, frame);
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
