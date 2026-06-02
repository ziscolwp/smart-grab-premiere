# Smart Grab v2 — Queue + Slider Trim — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Builds on:** `2026-06-02-smart-grab-premiere-design.md` (v1)

---

## 1. Purpose

Two additions to the working v1 panel:

1. **Download queue** — paste one or many video links; they download one-at-a-time,
   each showing its real **title + duration** and per-item progress.
2. **Slider trim** — replace the manual `HH:MM:SS` text entry with a **dual-handle range
   slider** driven by the video's actual duration. No typing required.

### Success criteria
- Paste several URLs (one per line) → Add → each shows title/duration → they download
  sequentially and import into the "Downloaded Video" bin.
- A playlist/channel link expands into one queue item per video.
- For a single URL, toggling Clip shows a range slider over the real video length;
  dragging sets start/end with a live readout; the downloaded file is trimmed to that range.
- Per-item cancel/remove; queue-level clear-done / cancel-all.

---

## 2. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Time entry | **Dual-handle range slider** over the fetched duration (not typing). Manual `HH:MM:SS` is a fallback only when duration is unknown. |
| Queue persistence | **In-memory only.** Closing the panel clears the queue. (No JSON persistence in v1.) |
| Playlist links | **Expand** a real playlist/channel link into one item per video (`--flat-playlist`), with a confirm when large (≥ 50). A `watch?v=…&list=…` link stays a single video (`--no-playlist`). |
| Processing | **Sequential** (one download at a time) — avoids CPU/bandwidth contention with Premiere and rate-limits. |
| Per-item options | Each item **snapshots** the quality/format/destination (and trim, if single) set when it was added. |

---

## 3. Unified queue flow

The URL field becomes a **multi-line textarea**. The button becomes **Add to Queue**.

1. **Add** → `urls.parse(text)` splits into individual URLs (one per line / whitespace,
   `http(s)` only). Each is classified: `video` | `playlist` | `channel` | `invalid`.
2. Playlist/channel URLs → `metadata.expandPlaylist()` (`--flat-playlist`) → many items
   (confirm if ≥ 50). Video URLs → one item each.
3. Each item starts `pending`, then `fetching-info` (`metadata.fetchInfo()` →
   title + duration, a few concurrent), then `queued`.
4. A single sequential processor takes the next `queued` item → `downloading`
   (`engine.download(item.opts, …)`), updates its progress, then on success calls
   `sg_importToBin(path, binName)` → `done`. On failure → `error` (message kept).
5. Repeat until no `queued`/`pending` items remain.

### Queue item (data model)
```js
{
  id: string,            // generated (counter + timestamp passed in; no Math.random in pure code)
  url: string,
  title: string|null,    // null until fetched
  durationSec: number|null,
  status: 'pending'|'fetching-info'|'queued'|'downloading'|'done'|'error'|'canceled',
  progress: number,      // 0–100, meaningful while downloading
  statusMsg: string,     // live yt-dlp/ffmpeg line or error text
  opts: { quality, videoFormat, audioFormat, clipEnabled, startSec, endSec },
  // destination is resolved at download time from current settings
  // (sync → current project dir, custom → folder) — not frozen at add time
  outputPath: string|null
}
```

### Queue UI (per row)
title (or URL while fetching) · duration · status pill · progress bar (when downloading)
· **✕ cancel** (current) / **🗑 remove** (pending/terminal). Queue header: **Cancel all**,
**Clear done**. The active row is highlighted.

---

## 4. Slider trim (single video)

Trimming is inherently per-video, so it applies when the textarea holds **exactly one** URL.

1. Toggle **Clip** on → panel calls `metadata.fetchInfo(url)` for the duration (brief spinner).
2. A **dual-handle range slider** spans `0 → durationSec`:
   - two overlaid `<input type=range>` (start ≤ end enforced) with a colored selected track;
   - live `timecode.secondsToHMS()` labels under each handle + the **clip length**;
   - focused handle nudges ±1 s with Arrow keys, ±10 s with Shift+Arrow (precision without typing).
3. **Add** snapshots `startSec`/`endSec` into the item; the engine receives
   `startTime`/`endTime` as `HH:MM:SS` (existing ffmpeg clip path, unchanged).
4. **Fallback:** if duration is unknown (livestream/extractor gap), show the v1 manual
   `HH:MM:SS` inputs parsed by `timecode.parseFlexible()`.
5. With **multiple** URLs in the textarea, Clip is disabled (full downloads) with a hint.

No native dual-range input exists; build a **small vanilla component** (two range inputs +
CSS track). No external libraries.

---

## 5. yt-dlp metadata (from research + on-machine test)

- **Single video title + duration** (≈3 s, no download; `--print` implies `--simulate`):
  `yt-dlp --no-playlist --print "%(title)s\t%(duration)s" <URL>`
  (raw seconds for easy JS; format to HH:MM:SS in `timecode.js`).
- **Playlist/channel expansion** (fast, streams one line per entry):
  `yt-dlp --flat-playlist --print "%(id)s\t%(title)s\t%(url)s" <URL>` (cap with `-I 1:N`).
- **Per-URL invocation** (not multiple URLs in one call) → clean 1-in/1-out mapping + per-item errors.
- Title fetch concurrency-limited (e.g. 4 at once) so a big paste populates titles quickly
  while downloads stay sequential.

---

## 6. Architecture (new modules; engine/import/settings unchanged)

| File | Responsibility | Test |
|---|---|---|
| `panel/js/timecode.js` | `secondsToHMS(s)`, `clampRange(start,end,dur)`, `parseFlexible(str)` (fallback) | unit |
| `panel/js/urls.js` | `parse(text)→[url]`, `classify(url)→type` | unit |
| `panel/js/queueState.js` | pure transforms: `add`, `setStatus`, `nextQueued`, `remove`, `clearDone`, `hasActive` | unit |
| `panel/js/metadata.js` | `fetchInfo(url, cb)`, `expandPlaylist(url, cb)` via yt-dlp (uses `binaries.resolveBinary`) | manual |
| `panel/js/queue.js` | orchestrator: title-fetch pool → sequential download → import; notifies UI via callback | manual |
| `panel/js/main.js` | wire textarea, Add, queue rendering, slider; (existing wiring kept) | syntax |
| `panel/index.html`, `css/style.css` | multi-line input, queue list, range-slider markup/styles | visual |

`engine.download()`, `jsx/hostscript.jsx`, `settings.js`, `binaries.js`, `editKeys.js`,
`clipboard.js` are **unchanged** (queue.js calls the first two).

Files stay focused and < 400 lines (per code-style). `queue.js` holds only orchestration;
all pure state logic lives in `queueState.js`.

---

## 7. Error handling

- Unfetchable title (private/unavailable/geo/age) → item still queues with the URL shown;
  `fetchInfo` returns `{error}` and the row shows a warning but can still attempt download
  (or is marked `error` if the URL is clearly invalid).
- Livestream (`duration` null/0) → no slider; clip disabled for that item.
- Download failure → item `error` with the copyable yt-dlp/ffmpeg message (v1 behavior per item).
- Import failure → item `done`-with-warning showing the path (v1 behavior).
- Big playlist (≥ 50) → confirm before enqueueing.
- Cancel current → kills the active child process (existing `onProc`/`kill`), marks `canceled`,
  processor advances to the next item.

---

## 8. Testing

- **Unit (Node):** `timecode` (formatting, clamp, flexible parse), `urls` (parse + classify
  incl. playlist vs watch?v=&list=), `queueState` (all transforms incl. sequential `nextQueued`,
  cancel/remove mid-queue, clearDone).
- **Manual/integration:** real multi-URL paste downloads sequentially in Premiere; playlist
  expansion; slider trim produces a correctly-trimmed file; cancel/remove; error row.
- Coverage floor on the branching logic (per testing-discipline).

---

## 9. Out of scope (v1 of v2)

Concurrent downloads · queue persistence across reload · drag-to-reorder · editing an item's
options after adding · Windows · retry-with-backoff UI (yt-dlp's built-in retries remain).
