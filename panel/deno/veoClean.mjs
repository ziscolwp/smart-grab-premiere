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

// ---- residual cleanup: adaptive gain + graduated smoothing ----------------
// Reverse alpha inverts the blend exactly at the right strength — but Veo's
// sparkle strength drifts per frame (measured 0.45..0.66 within one clip), and
// the vendored map's soft edges differ subtly from Veo's. Both leave a faint
// ghost that shows on smooth backgrounds and vanishes on busy ones.
//
// One signal drives the cleanup: TEXTURE ENERGY — the stddev of the
// highpassed luma over non-watermark pixels. Unlike a global stddev it is
// gradient-immune (a sunset sky reads as smooth). Where texture is low the
// per-frame gain estimator is trustworthy (no noise floor) AND the ghost is
// visible, so both correctors engage there and stand down on busy content.
const SMOOTH_MASK_ALPHA = 0.015;  // template magnitude that marks a ghost pixel (incl. faint outer glow)
const EST_CORE_ALPHA = 0.05;      // template magnitude used by the gain estimator
const GAIN_CONF_LO = 2, GAIN_CONF_HI = 6;      // texture range: estimator on -> off
const SMOOTH_LO = 4, SMOOTH_HI = 12;           // texture range: smoothing full -> off
const GAIN_CLAMP = 0.08;          // max per-frame gain correction vs the base
const GAIN_EMA = 0.3;             // temporal smoothing of the adapted gain

function ramp(v, lo, hi) {        // 1 at/below lo, 0 at/above hi
  return v <= lo ? 1 : v >= hi ? 0 : (hi - v) / (hi - lo);
}

function buildSmooth(tpl, x, y, size) {
  const masked = [];    // { idx, p, w, neighbors: [frameIdx, ...] }
  const clean = [];     // frame indexes of unmasked pixels (texture sample + donors)
  const isMasked = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const mag = Math.abs(tpl[r * size + c]);
      if (mag > SMOOTH_MASK_ALPHA) isMasked[r * size + c] = 1;
    }
  }
  // Dilate the mask 2px: Veo's real sparkle edge sits a hair outside the
  // vendored template's support (sub-pixel shape mismatch), so the ghost's
  // outline lives on pixels the raw mask misses.
  const dilated = new Uint8Array(isMasked);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (dilated[r * size + c]) continue;
      outer:
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          if (isMasked[rr * size + cc]) { dilated[r * size + c] = 2; break outer; }
        }
      }
    }
  }
  for (let p = 0; p < size * size; p++) {
    if (!dilated[p]) clean.push(((y + (p / size | 0)) * W + (x + (p % size))) * 4);
  }
  isMasked.set(dilated);
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
        p: r * size + c,
        w: Math.min(1, mag * 3),
        neighbors
      });
    }
  }
  return { masked, clean, tpl, x, y, size, maskFlags: isMasked };
}

function regionLuma(sm, frame) {
  const size = sm.size, out = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = ((sm.y + r) * W + (sm.x + c)) * 4;
      out[r * size + c] = 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
    }
  }
  return out;
}

function boxblurRegion(region, size) {
  const radius = Math.max(2, size >> 3);
  const tmp = new Float32Array(size * size), out = new Float32Array(size * size);
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
      out[r * size + c] = sum / n;
    }
  }
  return out;
}

// Luma-domain trial removal (estimation only — full frames use removeWith).
function removeLumaAt(sm, L, gain) {
  const size = sm.size, out = new Float32Array(L);
  for (let p = 0; p < size * size; p++) {
    const mag = Math.abs(sm.tpl[p]);
    if (Math.max(0, mag - ALPHA_NOISE_FLOOR) * gain < ALPHA_THRESHOLD) continue;
    const a = Math.min(mag * gain, MAX_ALPHA);
    const logo = sm.tpl[p] < 0 ? 0 : LOGO_VALUE;
    out[p] = (L[p] - a * logo) / (1 - a);
  }
  return out;
}

// Analyze one frame: texture energy of the surround, and the least-squares
// gain delta the sparkle-shaped residual implies after trial removal.
function analyzeFrame(sm, frame, gain) {
  const size = sm.size;
  const L = regionLuma(sm, frame);
  const trial = removeLumaAt(sm, L, gain);
  const bg = boxblurRegion(trial, size);
  // texture energy from non-watermark pixels (they carry no residual)
  let tsum = 0, tsq = 0, tn = 0;
  for (let p = 0; p < size * size; p++) {
    if (sm.maskFlags[p]) continue;
    const hp = trial[p] - bg[p];
    tsum += hp; tsq += hp * hp; tn++;
  }
  const texture = tn > 8 ? Math.sqrt(Math.max(0, tsq / tn - (tsum / tn) * (tsum / tn))) : 99;
  // residual gain delta over watermark core pixels
  let num = 0, den = 0;
  for (let p = 0; p < size * size; p++) {
    const t = Math.abs(sm.tpl[p]);
    if (t < EST_CORE_ALPHA) continue;
    const w = t * (255 - bg[p]);
    num += (trial[p] - bg[p]) * w;
    den += w * w;
  }
  return { texture, delta: den > 0 ? num / den : 0 };
}

function smoothResidual(sm, frame, fullness) {
  if (fullness <= 0 || !sm.masked.length || sm.clean.length < 16) return;
  for (const px of sm.masked) {
    let r = 0, g = 0, b = 0;
    for (const ni of px.neighbors) { r += frame[ni]; g += frame[ni + 1]; b += frame[ni + 2]; }
    // The flatter the surround, the harder every masked pixel leans on its
    // donors — at full flatness even faint edge pixels are fully replaced
    // (a flat background's local average IS the ground truth), which kills
    // the sparkle-outline ghost that per-alpha weights used to leave.
    const n = px.neighbors.length;
    const w = Math.min(1, px.w + fullness * fullness) * fullness, ow = 1 - w;
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
  const baseGain = +args.gain;
  const sm = buildSmooth(tpl, +args.x, +args.y, +args.size);
  // ops rebuilt per adapted gain, cached on 0.005 steps
  const opsCache = new Map();
  function opsFor(gain) {
    const key = Math.round(gain * 200);
    let ops = opsCache.get(key);
    if (!ops) { ops = buildOps(tpl, +args.x, +args.y, +args.size, key / 200); opsCache.set(key, ops); }
    return ops;
  }
  let gainEma = baseGain;
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
        // Adapt the gain to THIS frame where the surround is smooth enough
        // for the estimate to be trustworthy; hold the base gain elsewhere.
        const an = analyzeFrame(sm, frame, gainEma);
        const conf = ramp(an.texture, GAIN_CONF_LO, GAIN_CONF_HI);
        const target = Math.max(baseGain - GAIN_CLAMP,
          Math.min(baseGain + GAIN_CLAMP, gainEma + conf * an.delta));
        gainEma += GAIN_EMA * (target - gainEma);
        const fullness = ramp(an.texture, SMOOTH_LO, SMOOTH_HI);
        if (args.debug) {
          console.error(JSON.stringify({
            texture: +an.texture.toFixed(2), delta: +an.delta.toFixed(4),
            gain: +gainEma.toFixed(4), fullness: +fullness.toFixed(2)
          }));
        }
        removeWith(opsFor(gainEma), frame);
        smoothResidual(sm, frame, fullness);
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
