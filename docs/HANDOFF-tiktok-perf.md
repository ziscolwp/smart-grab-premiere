# HANDOFF — Smart Grab: make blocked-region TikTok downloads fast

> **STATUS: OPEN.** v3.2.0 makes TikTok *work* on ISP-blocked networks (e.g.
> India) via an automatic mirror fallback. It is correct but **slow**: a short
> clip can take ~50–60s, almost all of it spent waiting for doomed direct
> attempts before the mirror kicks in. This doc hands off the *performance &
> robustness* refinement. The feature itself works — do not regress it.

> **For the next session / model.** Read this whole file before touching code.
> Then read `panel/js/tiktok.js`, the resolver wiring in
> `panel/js/downloadEngine.js`, and `panel/js/metadata.js`. Reproduce the
> timing yourself before proposing anything (see "Measure first").

---

## What this tool is

A Premiere Pro CEP panel that downloads online video via yt-dlp + ffmpeg and
auto-imports it into the current project bin. Repo:
https://github.com/ziscolwp/smart-grab-premiere (public, account `ziscolwp`).

Hard constraints that bound any solution:
- **Panel JS is ES5** (old CEP Chromium). No `let`/`const`/arrow/template
  literals/spread/optional chaining in `panel/js/*`.
- **HTTP goes through `curl`** via `binaries.systemTool('curl')`, never Node
  `http`/`https` (CEP's bundled Node networking is unreliable). curl ships on
  macOS and Windows 10+; on Windows it's found by absolute System32 path.
- **Pure logic lives in testable modules** with `node:test` unit tests
  (`test/*.test.js`, run with `npm test`). Keep that pattern.
- Don't regress YouTube, Instagram, Reddit, X — the platforms the owner uses
  most.

## The problem we already solved (context)

On many ISPs (verified on Airtel/India, 2026-06-12) TikTok is blocked three
ways at once, so yt-dlp's native extractor cannot reach it at any quality:
1. **DNS poisoning** — `tiktok.com` → `restricted.rpz.airtelspam.com`.
2. **SNI filtering** — TLS to `*.tiktokv.com` (API/CDN hosts) is RST'd.
3. **Geo-refusal** — TikTok's servers bounce Indian IPs to `/in/about`.

**v3.2.0 fix:** when a yt-dlp attempt fails on a TikTok URL,
`downloadEngine` calls `tiktok.resolve()` → the public **tikwm.com** API
(via curl) → a direct video URL on `tiktokcdn-us.com` (an unblocked host) →
re-downloads that through the existing pipeline with a clean `Title [id].mp4`
output template. `metadata.fetchInfo` falls back the same way so queue rows
show real titles. No VPN. Verified end-to-end (full download, clip, title).

## The problem to solve now: latency

The mirror download itself is fast (~3s for a 3.5 MB clip at 1–2 MiB/s). The
slowness is **everything before it** — the panel exhausts the doomed direct
path first.

### Measure first (reproduce before changing anything)

A single failing native attempt with the panel's real reliability args
(`--socket-timeout 20 --extractor-retries 3 --retry-sleep extractor:5
--retries 10`) takes **~27 seconds** to give up on a blocked network:

```bash
cd ~/Library/Application\ Support/SmartGrab/bin
time ./yt-dlp --simulate -f "bv*+ba/b" --socket-timeout 20 \
  --extractor-retries 3 --retry-sleep extractor:5 --retries 10 \
  --no-playlist "https://www.tiktok.com/@startupspark85/video/7588059384693984525"
```

### Why a clip is ~2× worse

For a clip, `downloadEngine.startAttempt` runs the **sections** attempt first;
on failure (blocked) it retries **precise** (full download); only after *that*
second failure does the `!triedResolver && tiktok.isTikTokUrl` branch fire. So
a blocked clip pays **~27s × 2 ≈ 54s** of dead waiting, then ~3s to download.
A non-clip pays one ~27s wait. (Flagged in the v3.2.0 code review as a known
inefficiency; left in for control-flow simplicity.)

### Net
~90% of wall-clock for a blocked-region TikTok is waiting for attempts that
*cannot* succeed on this network. That's the target.

## Directions for a more robust solution (not prescriptions)

Evaluate and improve on these — the next model is expected to find something
better, not just implement the cheapest of these.

1. **Short-circuit the doomed wait.**
   - Remember per-session that "this network blocks TikTok": after the first
     fallback, route subsequent TikTok URLs straight to the resolver. Cheap,
     big win, but stale if the network changes mid-session (handle gracefully).
   - Or **race** the native attempt and the resolver in parallel and take
     whichever returns a usable result first; cancel the loser. Costs one
     extra cheap API call on healthy networks; near-instant on blocked ones.
   - Or a **fast reachability probe** for TikTok (short-timeout HEAD to a
     TikTok host) to decide native-vs-mirror before committing 27s.

2. **Don't double-fail on clips.** Resolve first (or on the *first* failure,
   not the second) and trim locally — skip the sections→precise native dance
   for TikTok specifically.

3. **Tune the first TikTok native attempt** to fail fast (low socket-timeout,
   0 extractor-retries) and only use the patient retry profile once we know the
   site is reachable.

4. **Reduce dependence on one third-party mirror** (reliability/longevity):
   multiple resolver backends with racing/fallback; or replicate TikTok's
   mobile API directly; or a tiny self-hosted resolver the owner controls.
   Whatever is chosen must stay curl-based and ES5-wireable in the panel.

5. **Quality/size:** confirm the chosen rendition is the best available
   (tikwm `hdplay` vs source); make sure we're not silently downgrading vs the
   native path on *unblocked* networks (those should still use native first).

## Acceptance criteria for "refined"

- A blocked-region TikTok (clip or full) starts downloading in **≤ ~5s**, not
  ~30–60s. State the measured before/after numbers.
- Healthy networks keep using yt-dlp's native path first — **no regression** in
  quality or speed for users who aren't blocked, and no behavior change for
  YouTube/IG/Reddit/X.
- All logic stays ES5, curl-based, and covered by `node:test` units. Pure
  decision logic (e.g. "should we skip native?") must be unit-tested.
- Verified end-to-end on a real blocked network (or a faithful simulation),
  with timings, before tagging a release.

## Where things live

- `panel/js/tiktok.js` — resolver (`isTikTokUrl`, `tikwmUrl`, `parseTikwm`,
  `outputTemplate`, `resolve`). Pure helpers are unit-tested in
  `test/tiktok.test.js`.
- `panel/js/downloadEngine.js` — `tryTikTokResolver`, `effectiveUrl`,
  `triedResolver`, `resolvedTemplate`, and the `startAttempt` retry ladder.
- `panel/js/engineLogic.js` — `buildYtDlpArgs` (the `outputTemplate` override),
  the reliability flags to tune.
- `panel/js/metadata.js` — `fetchInfo` resolver fallback for queue titles.
- `docs/yt-dlp-notes.md` — rationale for the current flag choices.

## Release process (when done)

1. Bump `package.json` + `panel/CSXS/manifest.xml` (both version fields).
2. Add a `CHANGELOG.md` entry.
3. `npm test` (must be green), then `npm run package` (self-verifying zips).
4. `gh release create vX.Y.Z dist/SmartGrab-mac.zip dist/SmartGrab-win.zip ...`
5. The owner's Mac is **dev-symlinked** to `panel/` — never run the installer
   there; he reloads by reopening the panel. Real Windows is still untested
   hardware (`docs/windows-test-checklist.md`).
