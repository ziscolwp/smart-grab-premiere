# Smart Grab for Premiere — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Author:** ziscol + Claude

---

## 1. Purpose

A standalone Adobe Premiere Pro panel that downloads online video (via `yt-dlp` + `ffmpeg`)
with the same options as the existing **Smart Grab** macOS app, and then **automatically
imports the downloaded file into the current Premiere project's panel**, organized into a bin.

The user pastes a link, picks options, hits Download. The file lands in the project panel
inside a "Downloaded Video" bin, with the file saved either next to the project (sync mode)
or in a fixed custom folder.

### Success criteria
- Paste URL → pick options → Download → file appears in the Premiere project panel, ready to edit.
- Two destination modes selectable in Settings (sync-to-project / custom folder).
- Full option parity with Smart Grab (quality, video format, audio format, clip range).
- Robust: self-contained binaries with a system fallback; resilient error reporting.
- Dead-easy install: one double-click installer, no Homebrew or Extension Manager required.

---

## 2. Platform decision (settled by research)

**CEP, not UXP.** UXP cannot spawn external CLI processes — no `child_process`, and
`shell.openPath()` cannot pass arguments or capture output
([Adobe UXP docs](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/external-process/)).
A `yt-dlp`/`ffmpeg` driver is therefore impossible in UXP without a compiled C++ hybrid addon.
CEP with `--enable-nodejs` provides full Node.js including `child_process.spawn()`, which the
user's existing **AudioExtractor** panel already uses with ffmpeg. CEP still ships in Premiere
2025/2026 (CEP 12 / CSXS 12) with no announced end-of-life. Bin creation + `importFiles` are
also not yet in the UXP DOM API; ExtendScript remains the only working path in 2026.

---

## 3. Architecture

Three layers, mirroring the proven AudioExtractor pattern:

```
┌─────────────────────────────────────────────────────────┐
│  Panel UI  (index.html + css/style.css + js/main.js)     │
│  URL field, option pickers, progress, settings, errors   │
└───────────────┬─────────────────────────────────────────┘
                │ (in-panel function calls)
┌───────────────▼─────────────────────────────────────────┐
│  Node engine  (js/downloadEngine.js, binaries.js,        │
│                settings.js)  — runs in CEP's Node.js      │
│  spawn yt-dlp → spawn ffmpeg → produce final file        │
└───────────────┬─────────────────────────────────────────┘
                │ cs.evalScript(...)
┌───────────────▼─────────────────────────────────────────┐
│  ExtendScript host  (jsx/hostscript.jsx) — runs IN Premiere│
│  get project dir · find/create bin · importFiles()        │
└─────────────────────────────────────────────────────────┘
```

### Module responsibilities (interface-first, each file focused & < 400 lines)

| File | Responsibility | Key interface |
|---|---|---|
| `js/main.js` | UI wiring: read inputs, drive engine, render progress/errors, open Settings | event handlers only |
| `js/downloadEngine.js` | Port of Smart Grab's pipeline: build yt-dlp args, download to temp, post-process (clip/re-encode/remux/move) | `download(opts, onProgress, cb)` |
| `js/binaries.js` | Resolve yt-dlp/ffmpeg/ffprobe paths; update yt-dlp | `resolve(name)`, `updateYtDlp(cb)` |
| `js/settings.js` | Load/save settings JSON in app-support | `load()`, `save(obj)` |
| `jsx/hostscript.jsx` | Premiere host ops (ES3) | `getProjectDir()`, `importToBin(path, binName)` |

---

## 4. Download engine (faithful Node port of Smart Grab)

Reimplements `DownloadEngine.swift` in JavaScript with identical behavior:

- **Quality → yt-dlp format string** (unchanged from Swift):
  - best `bv*+ba/best` · 4K `bv*[height<=2160]+ba/best` · 1080p `bv*[height<=1080]+ba/best`
    · 720p `bv*[height<=720]+ba/best` · 480p `bv*[height<=480]+ba/best` · audio-only `ba/best`
- **Video output formats:** MP4 (Premiere — h264/aac re-encode) · MOV (re-encode) ·
  MKV (original codecs) · MP4 (no re-encode).
- **Audio formats:** MP3 · M4A · WAV · FLAC (`yt-dlp -x --audio-format <ext>`).
- **Clip range:** optional start/end via `ffmpeg -ss <start> -to <end>`.
- **Pipeline:**
  1. Resolve binaries (see §6). Create temp dir + destination dir.
  2. `yt-dlp -P <tmp> -f <fmt> --force-ipv4 --newline --no-warnings --ffmpeg-location <dir>
     --merge-output-format mp4|mkv <url>` (audio-only adds `-x --audio-format`).
  3. Parse `--newline` stdout for `NN.N%` → progress; "Merging" → status.
  4. Validate: exactly one non-`.part`/`.ytdl` file (multiple = merge failed → error).
  5. Post-process (same decision tree as Swift):
     - audio-only → move; clip → ffmpeg trim (copy or re-encode by format);
     - MP4/MOV → ffprobe codecs; if already h264+aac+mp4 → move (fast path), else re-encode
       `-c:v libx264 -c:a aac -movflags +faststart`;
     - else same-ext → move; different-ext → remux `-c copy`.
  6. Move final file to destination folder. Return final path.
- **Process handling:** capture stdout+stderr, keep a small ring buffer of recent lines, on
  non-zero exit surface the last meaningful error lines (port of Swift's error extraction).
  Support cancel (kill the child process).

---

## 5. Destination modes + import

### Settings-selectable modes
- **Sync to project** — call `getProjectDir()`; create `<projectDir>/Downloaded Video/`;
  download there. If project unsaved (`app.project.path` empty) → show "Save the project first"
  (no silent fallback).
- **Custom folder** — download to a fixed path chosen via folder dialog in Settings.

### Import into the panel (both modes)
After the file exists on disk, `cs.evalScript("importToBin('<path>', 'Downloaded Video')")`:
- Deep-search `app.project.rootItem.children` for a bin (`type === 2`) named "Downloaded Video";
  if absent, `rootItem.createBin(name)` then re-search for a stable reference (per Adobe sample —
  don't trust `createBin`'s return value).
- `app.project.importFiles([absolutePath], true /*suppressUI*/, targetBin, false /*stills*/)`.
- Return success/failure to the panel. Absolute POSIX paths via `File(...).fsName`; never pass a
  folder; array always required.

---

## 6. Binaries strategy (robustness + zero external deps)

Resolution order at runtime:
1. `<extension>/bin/` (installer-provided)
2. `~/Library/Application Support/SmartGrab/bin/` (user-writable, for updates)
3. Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`)
4. `PATH`

The **installer downloads** `yt-dlp_macos` (official, universal, public-domain) and static
`ffmpeg`/`ffprobe` (Apple-Silicon) into `bin/` on install — keeping the repo small while making
the installed plugin self-contained. It strips quarantine (`xattr -dr com.apple.quarantine`) and
ad-hoc signs them (`codesign --force --sign -`) so they run on the install machine without an
Apple Developer account.

**Update path:** an in-panel "Update yt-dlp" button re-downloads the latest `yt-dlp_macos` to the
app-support `bin/` (yt-dlp breaks often as sites change; bundled `yt-dlp -U` is unreliable).

**Licensing note:** static ffmpeg builds are typically GPL; bundling is fine for personal/team use.
Public redistribution would require an LGPL build or source availability — out of scope for v1.

---

## 7. Settings (persisted)

Stored as JSON at `~/Library/Application Support/SmartGrab/settings.json` (survives reinstalls):

```json
{
  "destinationMode": "sync" | "custom",
  "customFolder": "/absolute/path",
  "binName": "Downloaded Video",
  "lastQuality": "fhd",
  "lastVideoFormat": "mp4Premiere",
  "lastAudioFormat": "mp3"
}
```

Settings UI: mode toggle, custom-folder picker (folder dialog), and the last-used option memory.

---

## 8. Install (one double-click)

`install.command`:
1. **Copy** panel folder → `~/Library/Application Support/Adobe/CEP/extensions/SmartGrabPanel/`
   (copy is the default — robust, survives moving the project). A separate `dev-link.command`
   creates a *symlink* instead for live development, matching the user's
   `com.ziscol.remotion.bridge` pattern.
2. Download + place + de-quarantine + ad-hoc-sign the binaries into `bin/`.
3. `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` **and** `com.adobe.CSXS.12 …` (covers
   Premiere 2024 + 2025).
4. `xattr -dr com.apple.quarantine` on the installed folder; `killall cfprefsd`.
5. Print "Installed — restart Premiere Pro."

Manifest: `ExtensionBundleId com.ziscol.smartgrab`, host `PPRO [22.0,99.9]`, CEFCommandLine
`--enable-nodejs --mixed-context --allow-file-access-from-files`, menu "Smart Grab".

---

## 9. Error handling

- Binary missing (all resolution paths fail) → actionable message + "Update yt-dlp" / install hint.
- yt-dlp non-zero exit → last meaningful stderr lines, copyable (port of Swift error panel).
- Merge produced multiple files → "Merge failed — ffmpeg may not be reachable."
- Project unsaved in sync mode → "Save the project first."
- Import returns false → "Downloaded to <path>, but import failed — drag it in manually."
- Network/transient → yt-dlp's built-in `--extractor-retries 3 --retry-sleep extractor:5`.

The download must never *silently* fail: every failure path sets a visible, copyable error.

---

## 10. Testing strategy

- **Engine unit tests (Node):** quality→format-string mapping; output-filename builder (incl.
  clip naming); the post-process decision tree given (srcExt, codecs, format) inputs; binary
  resolution order with a faked filesystem. Pure-logic functions extracted for testability.
- **Manual/integration in Premiere:** real download of a short public video in each mode;
  verify file on disk in the right folder + clip present in the "Downloaded Video" bin; unsaved-
  project guard; cancel mid-download; an invalid URL surfaces a clean error.
- Coverage floor applies to the engine's branching logic (per testing-discipline rule).

---

## 11. Out of scope (v1) — flagged for later

- Windows support (macOS / Apple Silicon only for v1).
- Playlist / batch / multi-URL downloads.
- Developer-ID notarization (only needed for public distribution; ad-hoc + de-quarantine
  suffices for personal/team).
- Cookies / authenticated or members-only downloads.
- Auto-placing the clip on the timeline (import-to-bin only for v1).

---

## 12. File layout

```
smart-grab-premiere/
├── docs/superpowers/specs/2026-06-02-smart-grab-premiere-design.md
├── panel/                       # the CEP extension (symlinked/copied into CEP/extensions)
│   ├── CSXS/manifest.xml
│   ├── index.html
│   ├── css/style.css
│   ├── js/CSInterface.js        # Adobe library (vendored)
│   ├── js/main.js
│   ├── js/downloadEngine.js
│   ├── js/binaries.js
│   ├── js/settings.js
│   ├── jsx/hostscript.jsx
│   ├── bin/                     # binaries placed by installer (gitignored)
│   └── .debug
├── test/                        # Node engine unit tests
├── install.command             # copy install (default, robust)
├── dev-link.command            # symlink install (live development)
└── README.md
```
