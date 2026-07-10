# Flow watermark removal — design

**Date:** 2026-07-10
**Status:** Approved
**Scope:** One feature PR (v3.6.0 candidate)

## Problem

Google Flow (Veo) videos carry a baked-in semi-transparent sparkle watermark in
the bottom-right corner — even on the paid tier. The user wants Smart Grab to
remove it automatically: paste a Flow share link → the **clean** clip lands in
the Premiere bin. The with-watermark version should never be what gets imported.

## Validated findings (spike, 2026-07-10)

Run against a real Veo 720p clip pair (watermarked + cleaned by the
[gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover)
web tool, MIT):

- **The math is exact, not ML.** Removal is reverse alpha blending:
  `original = (watermarked − α·logo) / (1 − α)`, logo = white (255).
  GWR's core (`blendModes.js`) is ~40 lines.
- **Alpha maps are embedded base64 float32 arrays** in GWR
  (`embeddedAlphaMaps.js`: 48×48, 96×96, 36-v2 variants) — vendorable as text
  constants, no binary-in-git (avoids the NUL-byte git trap).
- **Position comes from a small catalog** (`videoWatermarkCatalog.js`):
  1080p reference = 72px sparkle at margin 108 (standard) or 144 (inset),
  scaled proportionally to other sizes, with exact 720p overrides
  (48px, margin 96 inset / 72 standard).
- **Measured on the real pair:** template 48 matches at (1136, 576) — the
  *inset* candidate — with correlation 0.87 and **gain 0.60** (the video
  watermark is applied at 60% of the image-watermark strength; GWR ships this
  exact preset as `gemini-weak-alpha-202606`).
- **Bundled binaries suffice.** ffmpeg decode → Deno (bundled) applies the
  formula on the corner region → ffmpeg encode. Output at gain 0.6 is visually
  equivalent to GWR's own output (both leave the same faint smudge, invisible
  at 1×). No Playwright/Chromium (GWR's video mode needs headless Chrome), no
  ONNX, no npm deps.
- **We control the encode.** GWR's browser encoder produced 12 Mbps (6× bloat);
  our x264 CRF-based encode keeps ~original size and copies audio untouched.

## Rejected approaches

- **Run GWR as-is:** video mode requires Playwright + headless Chromium
  (~300MB) inside a CEP extension; bloated fixed-bitrate output. Same core
  math we can run natively.
- **Pure ffmpeg `removelogo`:** interpolates the region instead of
  reconstructing it — visibly worse on detailed content.

## Design

Pipeline: Flow link → download (unchanged) → **"Removing watermark…" stage**
→ clean file continues through the existing post-process/move/import path.
Non-Flow links are completely untouched.

### 1. `panel/deno/veoClean.mjs` (new — modern JS, runs under bundled Deno only)

Two modes:

- **Calibrate:** given one probe frame (raw RGBA on stdin) + candidate
  positions, score position candidates by normalized cross-correlation of the
  template alpha against a highpass of the watermarked region; then score gain
  candidates `[0.45, 0.55, 0.6, 0.7, 0.85, 1.0, 1.15, 1.3]` by the
  sparkle-shaped residual left after removal. Emits JSON
  `{x, y, size, gain, confidence}`. Low confidence (no candidate beats the
  residual threshold) → non-zero exit → caller falls back to importing the
  original with a warning.
- **Filter:** stream raw RGBA frames stdin→stdout, applying reverse alpha
  blending (GWR's exact formula, including the noise floor, threshold, and
  dark-polarity handling) at the calibrated position/gain. Only the corner
  region is touched; the rest of each frame passes through.

Embedded 48 and 96 alpha maps vendored from GWR as base64 constants with MIT
attribution in the header comment.

### 2. `panel/js/veoWatermark.js` (new — ES5, pure, unit-tested)

- Position-candidate catalog ported from GWR (reference scaling + exact-size
  overrides), `candidatesFor(width, height)`.
- Arg builders: ffprobe probe args, decode-ffmpeg args (`-f rawvideo
  -pix_fmt rgba`, BT.709-consistent conversion), Deno args, encode-ffmpeg args
  (`libx264 -crf 18 -preset veryfast`, `-pix_fmt yuv420p`, fps from probe,
  audio `-c:a copy` with optional mapping for silent clips,
  `-movflags +faststart`).
- `shouldClean(opts)` decision: Flow share id present (reuses `flow.shareId`)
  AND setting enabled AND not audio-only.
- Calibration JSON parsing/validation.

### 3. `downloadEngine.js` — one new stage

In `processOne`, before the existing `choosePostProcess`, when
`shouldClean`: probe W/H/fps → extract middle probe frame → calibrate →
run decode | veoClean | encode chain into a `.clean.mp4` in tmp → swap the
source file (original stem preserved so the dest name is unchanged). Progress:
`Removing watermark…`.

**Failure = never block footage.** Any error (calibration low-confidence,
unexpected pix_fmt, Deno missing, non-zero exit, empty/corrupt output) → keep
the original file, complete the item, attach
`warning: 'Watermark not removed — imported original.'` The queue row renders
the warning; download/import still succeeds.

Normal Flow case costs exactly **one** encode (Flow sources are H.264/AAC mp4
→ existing post-process is `move`). If a local trim is also requested the clip
is cleaned then trimmed (two encodes at CRF 18 — acceptable, rare).
Server-side-trimmed downloads are cleaned post-trim (fewer frames — faster).

### 4. Settings

`Remove Flow watermark` toggle in Settings, default **ON**, stored alongside
existing settings. Read at download time, passed into `downloadEngine` opts.

### 5. Queue warning surface

Completed-with-warning items show a small `⚠` note (reuses the existing
status/hint rendering pattern in `queueRender.js`).

## Edge cases

- **Audio-only grabs:** skipped.
- **Silent clips:** audio mapping optional (`-map 1:a?`).
- **Other resolutions** (1080p paid tier, vertical): catalog scaling +
  calibration handle position/size; gain is calibrated per video.
- **Multi-file results:** each video file cleaned independently.
- **Non-8-bit / unexpected pix_fmt:** skip + warn (rgba pipe assumes 8-bit).
- **Google changes the watermark:** calibration absorbs strength/position
  drift; a full redesign trips the confidence gate → original imported with
  warning, footage never lost.

## Testing

- Unit (offline, `npm test`): catalog math across resolutions, `shouldClean`
  decisions, arg builders, calibration JSON parsing, warning propagation.
- Deno script round-trip: synthesize a frame, blend a synthetic watermark in,
  clean it, assert near-identical recovery. Skips gracefully when the Deno
  binary is absent (CI machines).
- Manual before merge: real Flow share link end-to-end on the dev Mac —
  download → auto-clean → Premiere import; corner visually clean; file size
  sane; audio intact.

## Out of scope

Veo small-text watermark (user's clips don't carry it), Gemini images,
cleaning arbitrary local files, ONNX residual denoise, corner-crop pipe
optimization (full-frame piping is fast enough: ~700MB/8s clip through local
pipes).

## Files

`panel/deno/veoClean.mjs` (new), `panel/js/veoWatermark.js` (new),
`panel/js/downloadEngine.js`, `panel/js/settings.js`,
`panel/js/settingsView.js`, `panel/js/main.js` (plumb setting → opts),
`panel/js/queueRender.js`, `test/veoWatermark.test.js` (new),
`test/veoClean.test.js` (new), `README.md`, `CHANGELOG.md`.
