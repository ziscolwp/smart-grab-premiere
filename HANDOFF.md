# HANDOFF — Smart Grab v3: make it a product

> **STATUS: EXECUTED 2026-06-12.** All four phases shipped; v3.0.0 is tagged on
> GitHub with both release zips. The one thing no session can do from this Mac
> remains open: running the 10 steps in `docs/windows-test-checklist.md` on real
> Windows hardware. Kept for reference — do not re-execute.

> **For the next Claude session.** Read this whole file before touching code.
> Mission: take Smart Grab from "works great on the developer's Mac" to a
> **product-grade tool a non-technical editor can install in two clicks** on
> macOS *or* Windows, with every dependency fetched automatically, distributed
> through GitHub Releases, and resilient enough that nobody ever needs to
> "fix" anything.

## What this tool is

A Premiere Pro CEP panel that downloads online video via yt-dlp + ffmpeg and
auto-imports it into the current project bin. Repo:
https://github.com/ziscolwp/smart-grab-premiere (public, account `ziscolwp`).

**User-confirmed working (2026-06-12):** YouTube, Instagram, Reddit, X — the
four platforms that matter most to the owner. Don't regress them.

## Current state (v2.x, all pushed to main)

- `panel/` — the CEP extension (HTML/CSS + ES5 JS modules in `panel/js/`,
  ExtendScript host in `panel/jsx/hostscript.jsx`, manifest targets PPro 15+).
- Engine highlights: H.264/AAC-preferring `--format-sort` (most downloads need
  **zero re-encode**), per-stream conversion (only the broken stream converts),
  `--download-sections` fast clips with auto-fallback, self-merge when yt-dlp
  leaves split streams, multi-video posts (tweets with 2–4 videos) all import,
  friendly error mapping (`errorHints.js`), machine-readable progress.
- Cookies: three modes — off / live browser / **cookies.txt file** with a
  one-click "Create from browser" export (yt-dlp FAQ method). File beats
  browser. Known walls (all handled with friendly messages): Safari blocked by
  macOS TCC, Chrome/Brave one-time keychain prompt on macOS, Chrome unreadable
  on Windows (steer to Firefox).
- Cross-platform core: `binaries.js` / `settings.js` are platform-aware
  (`%APPDATA%` vs `~/Library/Application Support`, `.exe` candidates, PATH
  separators) with platform-override params so Windows behavior is unit-tested
  from macOS.
- Installers: `install.command` (macOS, arch-aware: osxexperts arm64 /
  evermeet x86_64) and `install.ps1` + `install.bat` (Windows: yt-dlp.exe,
  yt-dlp/FFmpeg-Builds win64-gpl, registry PlayerDebugMode CSXS 10–12). Both
  fetch yt-dlp **nightly**, ffmpeg, ffprobe, and **deno** (yt-dlp needs a JS
  runtime for full YouTube support) into `panel/bin/`.
- Tests: `npm test` — 113 green, pure-logic modules, no network needed.
- Docs: `README.md`, `docs/yt-dlp-notes.md` (researched flag rationale).

## Non-negotiable constraints

1. **Panel JS stays ES5** (`var`, callbacks) — CEP/CEF compatibility. Do not
   modernize syntax.
2. **yt-dlp stays on the nightly channel** — official docs recommend it;
   extractor fixes land there first. Don't "fix" it back to stable.
3. **Keep all 113+ tests green**; new logic goes in pure modules with tests
   (pattern: `engineLogic.js` = pure, `downloadEngine.js` = I/O shell).
4. **Conventional commits** (`feat:`/`fix:`/`docs:`…), files < 400 lines.
5. **Never build extractors/bypasses for piracy streaming sites** (e.g. the
   1flex.org ask — declined on purpose; token-gated JS players are out of
   scope and the README says so).
6. **This Mac's install is DEV-LINKED** — `~/Library/Application
   Support/Adobe/CEP/extensions/SmartGrabPanel` is a **symlink** into this
   repo's `panel/`. Never run an installer here (it would replace the symlink
   with a stale copy). The owner reloads by reopening the panel/Premiere.
7. Owner's saved settings live at `~/Library/Application
   Support/SmartGrab/settings.json` — destinationMode must stay `sync` unless
   they say otherwise.

## ⚠️ Biggest known risk

**Windows has never run on real hardware.** All Windows code paths are
unit-tested via platform overrides only. The first Windows user is currently
the integration test. Treat any Windows work as "verify before trusting".

---

## The work, in order

### Phase 1 — Self-healing panel (the core of "never breaks")
Move dependency acquisition INTO the panel so installers become thin and a
broken/missing binary can always be repaired by the user with one click:
- Extend the existing setup banner + `binaries.updateYtDlp()` pattern into a
  full `binaries.ensureAll(extRoot, onProgress, cb)` that can download
  **yt-dlp, ffmpeg, ffprobe, deno** per-platform/arch into the user-writable
  app-support bin (NOT `panel/bin`, which may be read-only or replaced on
  update). Reuse the exact URLs already proven in the installers.
- First launch with anything missing → banner shows a real progress bar
  ("Setting up… downloading ffmpeg 2/4"), panel is usable the moment setup
  finishes. All failures → friendly retry, never a dead panel.
- yt-dlp staleness: on panel open, if the binary is >14 days old, update it
  silently in the background (it already self-reports via `--version`; store
  last-update timestamp in settings).
- Tests for the pure parts (URL choice per platform/arch, staleness logic).

### Phase 2 — Two-click distribution via GitHub Releases
Non-coders must never see git:
- Build a release script (`scripts/package.sh` or npm script) that produces
  `SmartGrab-mac.zip` and `SmartGrab-win.zip`: panel + installer + a
  plain-English `INSTALL.txt`. Binaries are NOT bundled (Phase 1 panel
  fetches them; installers also still fetch as belt-and-braces).
- Verify the zips preserve the executable bit on `install.command` (zip from
  macOS does; verify after `unzip`). Account for Gatekeeper: document
  right-click ▸ Open, or ship the installer as a `.command` inside the zip
  (zips from browsers quarantine contents — the installer already clears
  quarantine on the panel, make sure it clears itself gracefully too).
- `gh release create v3.0.0` with both zips + release notes; README install
  section rewritten to "Download the zip for your OS from Releases →
  double-click the installer". Add LICENSE (ask owner: MIT recommended) and
  CHANGELOG.md.
- Bump manifest + package.json to 3.0.0.

### Phase 3 — Windows validation & hardening
- Walk every Windows path by reading code with fresh eyes: registry writes,
  `%APPDATA%` paths, `explorer /select,`, PowerShell 5.1 compatibility (test
  `Expand-Archive`, TLS for `Invoke-WebRequest` on older Win10), long-path
  edge cases.
- If the owner or a friend has a Windows machine: give them the release zip
  and a 10-step test checklist (install → restart PPro → panel opens → YT
  1080p → IG with cookies → X multi-video → clip trim → custom folder →
  update yt-dlp → reveal file). Fix what breaks.
- Ideal: test in a Windows VM if available.

### Phase 4 — Product polish
- README: screenshots/GIF of the panel (owner can capture), supported-sites
  one-liner, 5-question FAQ (cookies, "only audio/video", 4K re-encode, what
  can't be grabbed, updating).
- In-panel niceties if time allows: "What's new" line after update; panel
  version shown in Settings footer; link to GitHub issues for bug reports.
- Optional stretch (only if everything above is solid): self-signed ZXP via
  ZXPSignCmd so PlayerDebugMode isn't needed — research first; the
  debug-mode approach is proven and fine for v3.

## Definition of done

- [ ] Fresh macOS machine (or clean CEP dir): download release zip →
      double-click installer → restart PPro → download a YouTube video —
      with NO terminal, NO git, NO manual dependency steps.
- [ ] Same on Windows (real hardware or VM), using Firefox cookies path.
- [ ] Panel recovers from a deleted/corrupted binary via its own banner.
- [ ] `npm test` green; all platforms' logic covered by pure tests.
- [ ] v3.0.0 tagged release on GitHub with both zips and notes.
- [ ] Owner's dev-linked Mac setup untouched and still working.

## Quick reference

- Run tests: `npm test` (from repo root)
- Owner's machine: Apple Silicon, Premiere w/ dev-linked panel, binaries in
  `panel/bin/` (gitignored) + `~/Library/Application Support/SmartGrab/bin`
- Binary URLs (all verified live 2026-06-11/12): see `install.command` /
  `install.ps1` — yt-dlp-nightly-builds, yt-dlp/FFmpeg-Builds (win),
  osxexperts.net (mac arm), evermeet.cx (mac intel), denoland/deno releases
- yt-dlp flag rationale + error-string table: `docs/yt-dlp-notes.md`
- Session memory: `~/.claude/projects/-Users-ziscol-Ziscol-Media-Projects-smart-grab-premiere/memory/`
