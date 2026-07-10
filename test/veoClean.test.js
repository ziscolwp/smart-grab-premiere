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
    const base = 60 + (((x / W) * 80) | 0);
    buf[i * 4] = Math.min(255, base + rnd() * 60);
    buf[i * 4 + 1] = Math.min(255, base + 20 + rnd() * 60);
    buf[i * 4 + 2] = Math.min(255, (((y / H) * 90) | 0) + rnd() * 60);
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

test('veoClean filter: flat background + gain mismatch still comes out clean (residual smoothing)', { skip: !hasDeno && 'bundled deno not installed' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veoclean-'));
  // flat cream background — the worst case for ghost visibility
  const bg = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { bg[i * 4] = 235; bg[i * 4 + 1] = 225; bg[i * 4 + 2] = 205; bg[i * 4 + 3] = 255; }
  const bgFile = path.join(tmp, 'bg.raw');
  const wmFile = path.join(tmp, 'wm.raw');
  fs.writeFileSync(bgFile, bg);
  // stamp at 0.6 but remove at 0.55 — an 8% residual the smoother must absorb
  const st = runDeno(['run', '--quiet', '--allow-read', '--allow-write', SCRIPT,
    `--mode=stamp`, `--width=${W}`, `--height=${H}`,
    `--x=${X}`, `--y=${Y}`, `--size=${SIZE}`, `--gain=0.6`,
    `--frame=${bgFile}`, `--out=${wmFile}`]);
  assert.strictEqual(st.status, 0, String(st.stderr));
  const wm = fs.readFileSync(wmFile);
  const cleaned = await new Promise((resolve, reject) => {
    const p = spawn(DENO, ['run', '--quiet', SCRIPT,
      `--mode=filter`, `--width=${W}`, `--height=${H}`,
      `--x=${X}`, `--y=${Y}`, `--size=${SIZE}`, `--gain=0.55`]);
    const chunks = [];
    p.stdout.on('data', c => chunks.push(c));
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('filter exit ' + code)));
    p.stdin.write(wm);
    p.stdin.end();
  });
  let maxDiff = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const i = ((Y + r) * W + (X + c)) * 4;
      for (let ch = 0; ch < 3; ch++) maxDiff = Math.max(maxDiff, Math.abs(cleaned[i + ch] - bg[i + ch]));
    }
  }
  assert.ok(maxDiff <= 2, `flat-background ghost must be gone (maxDiff ${maxDiff})`);
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
