# Smart Grab Robustness — Design Spec

**Date:** 2026-06-13
**Status:** Approved direction, pending implementation plan
**Builds on:** `2026-06-02-smart-grab-premiere-design.md`, `2026-06-02-smart-grab-v2-queue-trim-design.md`
**Research input:** Video DownloadHelper v10 behavior, yt-dlp/ffmpeg docs, Premiere CEP/ExtendScript constraints

---

## 1. Purpose

Make Smart Grab feel as dependable as a mature browser downloader while preserving its Premiere-native advantage:
download with `yt-dlp`/`ffmpeg`, produce edit-ready media, and import completed files into the current project.

The first robustness slice focuses on customer trust:

1. The queue survives panel/Premiere restarts.
2. Failed or canceled network jobs can preserve resumable partial work.
3. Output files are never overwritten or imported while still temporary.
4. Broken/missing tools are detected with explicit health checks.
5. Failed jobs expose privacy-safe diagnostics that support can use.
6. Error states drive the right next action.

### Success Criteria

- Closing/reopening the panel restores queued, failed, canceled, and completed job history.
- Jobs that were `fetching-info` or `downloading` during shutdown rehydrate into a safe non-live state and can be resumed or retried.
- Retrying a retryable failed/canceled job reuses its stable work directory when partial download files are available.
- Final media is written through a safe temporary/finalization path and existing destination files are preserved with unique names.
- Settings can show a health status for `yt-dlp`, `ffmpeg`, `ffprobe`, and `deno`, including executable version checks.
- Each failed item has a `Copy diagnostics` action with redacted URLs, headers, local paths, usernames, cookies, and tokens.
- Existing queue/download/metadata behavior remains compatible with the current UI and test suite.

---

## 2. Product Lessons From Video DownloadHelper

Video DownloadHelper's transferable strength is not only extraction. It gives users strong operational feedback:
detected media entries, visible queue state, configurable concurrency, completion notification, support logs, and
copyable bug details.

- Keep the main download flow simple: paste links, queue, download, import.
- Make every item state legible: queued, reading info, downloading, importing, done, failed, canceled, recoverable.
- Offer actions at the row level: retry/resume, reveal file, remove, copy diagnostics.
- Treat unsupported content honestly: DRM/encrypted media, unavailable videos, login/session problems, geo blocks,
  network blocks, and extractor breakage should show distinct explanations.
- Keep download concurrency at one for this slice. Premiere imports, CPU-heavy transcodes, disk writes, and site
  rate limits make multiple simultaneous downloads risky until persistence and diagnostics are already solid.

Browser-style media detection is useful, but it is not part of this first slice. The later bridge can pass a
detected media candidate into the same queue model defined here.

---

## 3. Architecture

The current architecture is already well-suited to incremental hardening:

| Area | Current file | Change |
|---|---|---|
| Queue orchestration | `panel/js/queue.js` | Add persistence hooks, lifecycle guards, attempt counts, retry/resume states |
| Queue state transforms | `panel/js/queueState.js` | Add serializable item schema and rehydration transforms |
| Queue rendering | `panel/js/queueRender.js` | Add resume/copy-diagnostics buttons and structured status display |
| Download orchestration | `panel/js/downloadEngine.js` | Add stable work directories, line buffering, safer final output, optional preserved partials |
| Download pure logic | `panel/js/engineLogic.js` | Add header args, retry policy args, final-name helpers, structured progress parsing where pure |
| Settings | `panel/js/settings.js`, `panel/js/settingsView.js` | Add health check surface and persistence paths |
| Error hints | `panel/js/errorHints.js` | Return structured categories/actions while preserving current message/hint strings |
| Tool management | `panel/js/binaries.js`, `panel/js/setupLogic.js` | Add executable health/version checks |
| Diagnostics | new `panel/js/diagnostics.js` | Redaction and copy payload assembly |
| Queue storage | new `panel/js/queueStore.js` | Atomic JSON save/load in SmartGrab app-support |

### Boundary Rule

Keep `main.js` as DOM wiring. New persistence, diagnostics, health, and output safety logic should live in focused
modules so the panel hub does not grow into the product's brain.

---

## 4. Durable Queue State

Store queue snapshots in the same app-support tree as settings:

```text
macOS:   ~/Library/Application Support/SmartGrab/queue.json
Windows: %APPDATA%\SmartGrab\queue.json
```

`queueStore.js` owns all file I/O:

- `load(file?) -> { version, items }`
- `save(snapshot, file?) -> boolean`
- `clear(file?) -> boolean`
- Atomic save: write `queue.json.tmp`, then rename to `queue.json`.
- On corrupt JSON: preserve `queue.json.bad-<timestamp>` when possible, then return an empty queue.

### Snapshot Schema

```js
{
  version: 1,
  savedAt: 1781320000000,
  items: [
    {
      id: "q1",
      url: "https://example.com/watch/123",
      title: "Example Video",
      durationSec: 123,
      thumbnail: "https://...",
      uploader: "Uploader",
      status: "queued",
      progress: 0,
      statusMsg: "",
      errorHint: null,
      errorCategory: null,
      retryable: false,
      attemptCount: 0,
      workDir: "/Users/name/Library/Application Support/SmartGrab/work/q1",
      outputPath: null,
      outputPaths: [],
      opts: {
        quality: "fhd",
        videoFormat: "mp4Premiere",
        audioFormat: "mp3",
        cookiesBrowser: "none",
        cookiesFile: "",
        proxyUrl: "",
        trimMode: "fast",
        clipEnabled: false
      },
      createdAt: 1781320000000,
      updatedAt: 1781320000000
    }
  ]
}
```

### Rehydration Rules

Rehydration must never pretend an old process is still alive:

| Saved status | Restored status | Reason |
|---|---|---|
| `pending` | `pending` | Metadata fetch can restart |
| `fetching-info` | `pending` | Old metadata process is gone |
| `queued` | `queued` | Safe to continue |
| `downloading` | `canceled` with `retryable: true` | Old child process is gone; partials may exist |
| `importing` | `done` if output file exists, else `error` | Import result is unknown, but media may be durable |
| `done` | `done` | Preserve history |
| `error` | `error` | Preserve failure and diagnostics |
| `canceled` | `canceled` | Preserve user intent |

The queue should save after every meaningful state change. To avoid excessive disk churn, the store can debounce saves
by a short interval, but terminal transitions should flush immediately.

---

## 5. Resumable Work Directories

Current downloads use random temp directories under the OS temp folder. That is safe for cleanup but prevents retrying
with partial files. This slice introduces stable per-item work directories:

```text
~/Library/Application Support/SmartGrab/work/<item-id>/
```

`downloadEngine.download()` accepts optional `workDir` and `preserveWorkDir` values:

- `workDir`: use this directory instead of a random OS temp directory.
- `preserveWorkDir`: keep the directory on retryable error or cancel.
- Success: remove the work directory after final media is safely moved.
- Permanent failure: keep or remove based on the error category. Network/fragment/rate-limit failures keep partials;
  invalid URL/private/DRM-style failures can clean up.

`yt-dlp` already resumes partial downloads by default when compatible `.part` files remain. Smart Grab should not pass
`--no-continue`.

The UI can use one button label with clear status:

- If `retryable` and `workDir` contains partial files: button title `Resume`.
- Otherwise: button title `Retry`.

The queue API can keep a single `retry(id)` method initially; it decides whether to preserve or clear work based on
item fields.

---

## 6. Safe Final Output

The downloader must stop deleting existing destination files. Instead:

1. Choose a final destination name from the media title and selected output format.
2. If that path exists, generate a unique suffix:
   - `Title.mp4`
   - `Title 2.mp4`
   - `Title 3.mp4`
3. Write post-processing output to a temporary sibling path:
   - `Title.mp4.smartgrab-part`
4. After `ffmpeg` exits and the file is closed, atomically rename to `Title.mp4`.
5. Only import the final path, never a work-dir path or `.smartgrab-part` path.

This mirrors the safety pattern already used for binary downloads in `binaries.js`.

Multi-file posts keep the same rule per output path. The result object should include:

```js
{
  path: "/final/first.mp4",
  paths: ["/final/first.mp4", "/final/second.mp4"],
  size: "2 videos · 34.2 MB"
}
```

---

## 7. Process Output And Cancellation Hardening

`downloadEngine.run()` currently splits each chunk by newline independently. If a progress or error line arrives split
across chunks, parsing can lose information. Replace it with a carry-over line buffer:

- Append chunk text to `pending`.
- Split on newline.
- Emit all complete lines.
- Keep the last partial line in `pending`.
- On process close, emit the remaining partial line if non-empty.

Async callbacks should not revive canceled items. `queue.js` should guard metadata and download callbacks:

- Before applying a callback result, read the current item by id.
- If the item is missing or terminal in a way that should not be overwritten, ignore the callback.
- Canceling a metadata-pending item should prevent a later metadata callback from setting it back to `queued`.
- Canceling a download should mark it canceled and preserve retryable state before the child process close callback runs.

---

## 8. Structured Errors

`errorHints.friendly(raw)` should evolve from message-only matching into structured results:

```js
{
  category: "auth" | "rate-limit" | "network" | "geo" | "private" | "not-found" |
            "unsupported" | "extractor" | "format" | "trim" | "disk" | "tool" |
            "import" | "unknown",
  retryable: true,
  action: "set-cookies" | "wait" | "set-proxy" | "update-ytdlp" | "repair-tools" |
          "change-trim-mode" | "free-disk" | "copy-diagnostics" | "none",
  message: "This post needs a logged-in account.",
  hint: "In Settings, create a cookies file from a browser where you are logged in, then retry."
}
```

Existing callers that expect `message` and `hint` must continue to work. Structured categories power:

- Retry/resume decisions.
- More specific buttons in queue rows.
- Safer diagnostics summaries.
- Later browser-candidate fallback decisions.

---

## 9. Health Checks

`resolveBinary()` only proves that a file exists and is executable. Add a health module or extend `binaries.js` with
explicit checks:

- `yt-dlp --version`
- `ffmpeg -version`
- `ffprobe -version`
- `deno --version`

Health result:

```js
{
  ok: true,
  tools: {
    ytdlp: { ok: true, path: "/...", version: "2026.06.12.232946" },
    ffmpeg: { ok: true, path: "/...", version: "8.1" },
    ffprobe: { ok: true, path: "/...", version: "8.1" },
    deno: { ok: true, path: "/...", version: "2.3.6", optional: true }
  },
  action: null
}
```

Rules:

- Missing or non-runnable `yt-dlp`, `ffmpeg`, or `ffprobe` is blocking.
- Missing/non-runnable `deno` is warning-level because it helps YouTube JS challenges but is not required for every site.
- Settings should surface a short status and map failures to `Repair downloads`.
- Diagnostics should include tool versions and paths redacted to basename/location class where possible.

---

## 10. Privacy-Safe Diagnostics

Add a per-row `Copy diagnostics` action for failures and import warnings.

Payload:

- Smart Grab version.
- OS and architecture.
- Premiere host/version if available through CEP/ExtendScript.
- Tool health summary and versions.
- Queue item id, source type, status, attempt count, error category, retryable flag.
- Selected quality/format/trim mode.
- Sanitized URL host only, not full path/query by default.
- Last sanitized process lines from `yt-dlp`/`ffmpeg`.
- Output file basename and extension, not full user path.

Redaction:

- Remove cookies and authorization headers.
- Replace query strings with `?<redacted>`.
- Replace local home directory with `~`.
- Replace obvious tokens/passwords/session ids with `<redacted>`.
- Do not include raw clipboard content.
- Do not auto-send diagnostics anywhere; copying is user-initiated.

---

## 11. Future Browser Candidate Bridge

This design leaves room for a later browser helper without requiring it now.

```js
{
  url: "https://cdn.example.com/master.m3u8",
  pageUrl: "https://example.com/watch/123",
  tabTitle: "Example video",
  kind: "hls",
  mime: "application/vnd.apple.mpegurl",
  contentLength: 12345,
  headers: {
    "User-Agent": "...",
    "Referer": "https://example.com/watch/123"
  },
  source: "webRequest",
  confidence: 0.95
}
```

The current slice only needs one small forward-compatible choice: `engineLogic.buildYtDlpArgs()` can accept an
allowlisted `headers` object later and turn safe headers into repeated `--add-headers` flags.

Hard boundary: encrypted DRM/EME content remains unsupported. A `blob:` URL is not itself useful to `yt-dlp`; a later
browser helper should correlate it to HLS/DASH network manifests or report it as unsupported.

---

## 12. Testing Strategy

Use the existing `node:test` style and keep logic testable through injected dependencies.

- `queueStore`: load missing file, save/load round trip, corrupt JSON backup behavior, atomic write failure behavior.
- `queueState`: rehydrate statuses, attempt counts, retryable fields, output path preservation.
- `queue`: cancellation guards for metadata/download callbacks, retry/resume state, save hooks on transitions.
- `downloadEngine` pure helpers: line buffering, unique final filename, temporary sibling path, preserve/cleanup policy.
- `errorHints`: structured categories/actions for existing known strings.
- `diagnostics`: redacts URLs, cookies, auth headers, home paths, tokens, and local usernames.
- `binaries` or health module: spawn fakes for working, missing, non-executable, and optional-deno cases.

Use fake `yt-dlp`/`ffmpeg` scripts for:

- Split progress lines across chunks.
- Network failure that leaves a `.part`.
- Retry that resumes from the same work directory.
- Existing destination file requiring unique suffix.
- Import failure after successful download.

Manual Premiere checks:

- Queue several items, close/reopen panel, confirm state recovery.
- Cancel a real download and resume/retry.
- Download into a folder that already has the same filename.
- Break or rename `ffmpeg`, confirm health check and repair messaging.
- Confirm copied diagnostics contain no cookie/query token/full home path.

---

## 13. Out Of Scope For This Slice

- Building a Chrome extension or native browser bridge.
- Increasing inter-item download concurrency beyond one.
- Timeline insertion or sequence editing.
- Cloud telemetry or automatic log upload.
- License/account gating.
- Replacing CEP with UXP.
- Bypassing DRM, login rules, paywalls, or platform access controls.
