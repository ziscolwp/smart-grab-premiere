# Smart Grab — Speed & UX Refinement (v3.5)

**Date:** 2026-06-18
**Status:** Approved (design); executing in waves.
**Baseline:** v3.4.0 (169 tests green). Branch-per-wave + PR.

## Goal

Make the tool *feel* and *be* as fast as possible. Raw network download bandwidth
is **not** controllable and is out of scope. Everything around it is: redundant
network extractions, work that blocks time-to-first-byte, UI render thrash that
burns CPU and flickers, repeated ExtendScript round-trips, and startup cost.

## Constraints (must respect — do not regress)

- **ES5 only** in `panel/js/*` (no `const`/`let`/arrow/template-literals/`async`/`Map`/`Set`).
- **ES3 only** in `panel/jsx/hostscript.jsx`; no real module scope across `evalScript`
  calls (shared state must live on `$.global`).
- **Old CEP Chromium** — `requestAnimationFrame` is unreliable; use `setTimeout` +
  dirty-flag for coalescing.
- **yt-dlp is pinned to nightly** — any `--extractor-args player_client` names drift;
  must be source-gated, overridable, and re-verified on each bump.
- **`queue.js` stays synchronous** — `test/queue.test.js` calls `getItems()` right
  after mutations with synchronous fakes. All throttling lives in the UI layer (`main.js`).
- **`clipboard.read`/`write` keep their signatures** — add `readAsync`, don't change them.
- **Do not regress v3.4.0 wins:** 3× parallel downloads, `-S proto` HLS→DASH +
  h264/aac sort, 5-min metadata cache, fast-fail TikTok + per-session `markBlocked`,
  `--concurrent-fragments 4`, surgical `choosePostProcess`. `scripts/package.sh`
  version-sync stays the release gate.

## Product decisions (owner)

- **Timeline placement: OUT.** Finished clips import to the project bin only, as today.
  No `sg_appendToSequence`. (Owner declined; stays consistent with robustness spec §13.)
- **Title + thumbnail: KEEP.** Each queue row always shows title/thumbnail/duration.
- **Download fusion: SAFE path only.** Start downloads immediately instead of waiting
  for the title fetch (title/thumbnail still load in parallel and fill the row). Do
  **not** ship the `--load-info-json` reuse (needs live validation owner can do; auto-
  fallback makes it safe later but it's deferred).

## The controllable critical path (where wall-clock goes)

1. Paste/add — cheap, but clipboard read is synchronous (Windows PowerShell cold-start
   can freeze the UI 200–700ms); every keystroke re-runs `urls.parse` + innerHTML.
2. **Title probe — currently ON the first-byte path.** `pumpDownloads` only starts
   `queued` items, and an item becomes `queued` only after `fetchInfo` (a full
   `yt-dlp --print` extraction) returns. The download then re-extracts the same page.
3. Output-dir resolve — `sg_getProjectDir()` evalScript per item (constant per batch).
4. Download extraction — second full extraction, then bytes (not controllable).
5. Post-process — two sequential `ffprobe` spawns per file; usually ends in a `move`.
6. **Render thrash — concurrent with 4–7, dominates *perceived* speed.** Every progress
   line rebuilds the entire queue DOM (`innerHTML=''` + re-bind all listeners + reload
   every `<img>`), ~10–30×/sec under 3 parallel downloads.
7. Import — serial evalScript per path; each re-walks the whole project tree; the freed
   download slot only tops up after all imports finish.

## Waves

Each wave = one feature branch + PR, gated green by `npm test`. Pure logic is TDD
(red→green). DOM/ExtendScript pieces keep the old path as a fallback and ship with a
manual smoke-test checklist for the owner (Premiere can't be driven from CI).

### Wave 1 — UI responsiveness (`feature/ui-responsiveness`)

- **Keyed render.** `queueRender.render` tags each row `data-row-id` and is called only
  on *structural* change. New `patchRow(container, item)` updates one row's progress-bar
  width + status text/class + title/duration in place. New pure helpers `rowShapeKey`
  (what forces a rebuild) and `classifyChange(prev, next)` (`structural` vs list of
  progress updates) are unit-tested.
- **Coalesce in `main.js`.** Progress-only updates batch on a ~80ms trailing `setTimeout`;
  structural changes (status transitions, add/remove) flush immediately so nothing
  sticks at 99%.
- **Non-blocking clipboard.** Add `clipboard.readAsync(cb)` (async `execFile`); the Paste
  button and focus auto-detect use it. Sync `read`/`write` unchanged.
- **Focus auto-detect.** On panel focus, if `#url` is empty and the clipboard holds a new
  valid video URL, prefill it (never clobbers typed text; won't re-offer the same value).
- **Debounce** `updateUrlMeta` on `input` (~100ms); immediate on explicit paste/prefill.

### Wave 2 — Kill redundant work (`feature/kill-redundant-work`)

- Build `downloadEngine` injectable-spawn test harness + `test/downloadEngine.test.js` first.
- **Downloads start immediately** — `pumpDownloads` eligibility no longer waits on the
  title fetch; title/thumbnail stream in parallel. Keep the eager probe on the single-URL
  clip path (the slider needs duration before download).
- **Memoize binary resolution** + compute `defaultDirs` once; invalidate on update/repair.
- **One `ffprobe`** (`codec_type,codec_name` over all streams) and skip it entirely on the
  common already-h264/aac path.
- Drop O(n²) pump scans; memoize `sg_getProjectDir` per batch.

### Wave 3 — Overlap download + import (`feature/overlap-import`)

- **Batch imports** into one `importFiles([...])` call; **cache the bin ref** on
  `$.global`; harden find-or-create against the concurrent-completion duplicate-bin race.
- **Free the download slot at file-on-disk**; run imports through a serialized host FIFO.

### Wave 4 — Format/logic smarts (`feature/format-smarts`)

- **Pin YouTube `player_client`** via `--extractor-args` (source-gated, overridable).
- **Per-source "sections unsupported" memory** (mirrors `tiktok.markBlocked`).
- Startup polish: defer `manifest.xml` read out of the settings-view constructor; memoize
  detected browsers per session.

### Deferred

- `--load-info-json` probe/download fusion (needs live per-site validation).
- Timeline placement (`sg_appendToSequence`) — product call: out.

## Verification

- `npm test` green after every wave (Node's built-in runner; pure logic).
- New tests: `queueRender.test.js` (W1), `downloadEngine.test.js` (W2).
- Owner smoke-tests each wave's build in Premiere on macOS before merge (DOM/host paths).
- `npm run package` version-sync remains the pre-release gate.
