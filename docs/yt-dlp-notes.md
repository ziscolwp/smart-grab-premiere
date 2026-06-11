# yt-dlp usage notes (researched 2026-06, against official docs)

Why Smart Grab calls yt-dlp the way it does. Sources: the official
[README](https://github.com/yt-dlp/yt-dlp/blob/master/README.md),
[FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ),
[Extractors wiki](https://github.com/yt-dlp/yt-dlp/wiki/Extractors), and source code.

## Format selection: `-f bv*+ba/b` + `-S` sort
- `-f` filters **hard-fail** when nothing matches; `-S` (`--format-sort`) is a
  soft preference that never fails — crucial for sites that only offer a single
  muxed format (X, Instagram, Reddit, Loom, TikTok). The trailing `/b` covers them.
- Default sort prefers AV1/VP9 over H.264, so for edit-ready MP4 we pass
  `-S res:<cap>,vcodec:h264,acodec:aac`: resolution wins first (no silent quality
  drop), H.264+AAC breaks ties so most files skip the local re-encode.
- `res:1080` means "largest ≤1080, else smallest above" — it can't fail either.

## Clips: `--download-sections "*START-END"`
- Forces the ffmpeg downloader, which seeks server-side — only the clip's bytes
  are transferred. Supported for HTTP(S)/HLS/DASH; unsupported protocols error
  with `This format cannot be partially downloaded` → Smart Grab auto-falls back
  to a full download + local trim.
- Cuts snap to keyframes unless `--force-keyframes-at-cuts` (which re-encodes).
  We skip it: a fraction of a second of extra head is fine for editing, and the
  Precise trim mode exists for exact cuts.

## Cookies: `--cookies-from-browser BROWSER`
- Supported: brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale.
- **Windows + Chrome ≥127 is broken** (app-bound cookie encryption,
  [#10927](https://github.com/yt-dlp/yt-dlp/issues/10927)) → recommend Firefox on Windows.
- Chromium browsers lock the cookie DB while running → close the browser first.
- YouTube rotates cookies on open tabs; heavy use from one account risks flags.

## Reliability flags we pass
| Flag | Why |
|---|---|
| `--retries 10 --fragment-retries 10` | transient CDN failures |
| `--concurrent-fragments 4` | 2-4× faster HLS/DASH; >5 risks 403s |
| `--socket-timeout 20` | don't hang forever |
| `--retry-sleep extractor:5 --extractor-retries 3` | rate-limit grace |
| `--windows-filenames` | files survive Mac→Windows project handoff |
| `-o "%(title).80B [%(id)s].%(ext)s"` | byte-safe title truncation (FAQ recipe) |
| `--progress-template "download:SG\|..."` | machine-readable progress (README says don't parse human output) |
| `--no-playlist` | a `watch?v=…&list=…` link downloads one video, not 200 |

`--no-mtime` is the default since 2024 — not passed.

## Update channel: nightly
README: nightly is "the recommended channel for regular users"; stable is
"often stale and prone to external breakage". The panel's updater and both
installers pull `yt-dlp/yt-dlp-nightly-builds`.

## YouTube JS challenges (2025+)
Full YouTube support needs the bundled `yt-dlp-ejs` plus a JS runtime — `deno`
is the recommended one and is sandboxed (no fs/network). The installers drop a
`deno` binary next to yt-dlp; without it yt-dlp falls back to the `android_vr`
client (still works, fewer formats).

## ffmpeg sources
- Windows: yt-dlp's own builds (`yt-dlp/FFmpeg-Builds`, win64-gpl zip) — built for yt-dlp.
- macOS: no official yt-dlp build → osxexperts.net (arm64) / evermeet.cx (x86_64),
  Homebrew as runtime fallback.

## Error strings we map to friendly hints (`panel/js/errorHints.js`)
- `Sign in to confirm you're not a bot` → YouTube bot check → cookies
- `This content isn't available, try again later` → YouTube rate limit (~300/h guest)
- `Requested content is not available, rate-limit reached or login required` → Instagram → cookies
- `The extractor is attempting impersonation…` → build lacks curl_cffi → update yt-dlp
- `This format cannot be partially downloaded` → no section support → precise mode
- `Unable to extract …` → extractor broke → update yt-dlp (nightly)
- HTTP 403/429, geo blocks, private/age-gated → see the table in errorHints.js
