# Changelog

## 3.6.2 — 2026-07-11

### Fixed
- **Flow watermark removal was broken on Windows.** Probe-frame extraction
  used ffmpeg's long-deprecated `-vsync` option, which current builds have
  removed — and Windows installs get yt-dlp's `master-latest` ffmpeg, so every
  clean attempt died with `Unrecognized option 'vsync'` and imported the
  original. Timestamps are now normalized in the filter chain instead
  (`setpts=N/FRAME_RATE/TB`): byte-identical output, works on every ffmpeg
  version, no version-gated flags. First field bug pinpointed by 3.6.1's
  `veo-clean.log`.

## 3.6.1 — 2026-07-11

### Fixed
- **Watermark-removal failures now say why.** The generic ⚠ note is replaced by
  per-cause messages: tools missing (points at Settings ▸ Repair downloads),
  tools download failed, unsupported video format, no watermark detected in the
  clip, or processing failed. Full detail (including the calibration score) is
  appended to `veo-clean.log` next to the panel's managed binaries —
  `~/Library/Application Support/SmartGrab/` on macOS, `%APPDATA%\SmartGrab\`
  on Windows — so remote debugging no longer needs a screen share.
- **Missing deno self-heals during the download.** Flow cleaning needs the
  bundled deno runtime, but its setup download was allowed to fail silently.
  If deno is absent when a Flow clip needs cleaning, the panel now downloads it
  on the spot (once per session) instead of failing every clip.
- **Honest setup copy.** When the optional deno download fails, the setup
  banner no longer claims "everything still works" — it now says full YouTube
  support and Flow watermark removal need it.

## 3.6.0 — 2026-07-10

### Added
- **Google Flow watermark removal.** Flow (Veo) clips now lose their baked-in
  sparkle watermark automatically before import — exact mathematical
  reconstruction of the original pixels (reverse alpha blending), not blurring.
  Audio is copied untouched and file size stays normal. Position and strength
  are auto-calibrated per clip — and re-tracked every frame, since Veo's
  sparkle strength drifts mid-clip — with texture-adaptive residual smoothing
  that fully cleans flat and gradient backgrounds. On by default; toggle in Settings ▸ "Remove Flow watermark".
  If removal ever fails, the original imports with a ⚠ note — footage is never
  blocked. Alpha maps vendored from
  [gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) (MIT).

## 3.5.0 — 2026-06-18

### Changed
- **Downloads start instantly.** A grab now begins the moment you add it instead
  of waiting for the title and thumbnail to load first — those still appear, just
  in parallel. On YouTube that shaves the second or two each video used to spend
  fetching its info twice.
- **Smooth, flicker-free queue.** The download list now updates only the rows that
  changed instead of rebuilding the whole list on every progress tick, so
  thumbnails no longer flash and the panel stays responsive even with several
  downloads running at once.
- **Imports no longer hold up downloads.** As soon as a file finishes downloading
  it hands off to Premiere and the next grab starts right away, instead of the
  queue pausing while each clip is imported. A post with several videos imports in
  one step, and the bin is never duplicated.
- **Snappier panel.** Faster repeated lookups of yt-dlp/ffmpeg and browser
  detection, and a lighter startup.

### Added
- **Auto-paste.** Copy a video link, click into the panel, and it fills the box for
  you (only when it's empty — it never overwrites what you've typed).
- The clipboard read can no longer momentarily freeze the panel on Windows.

## 3.4.0 — 2026-06-17

### Changed
- **Faster downloads.** The panel now prefers direct (DASH/https) video streams
  over fragmented HLS when a site offers both — same resolution and codec, but
  roughly half the bytes and far fewer round-trips (on YouTube it picks the
  direct 1080p stream instead of the chunked one). Most grabs finish noticeably
  quicker with no change in quality.
- **Faster blocked-region TikTok.** On networks that block TikTok (e.g. India),
  the panel no longer burns ~27–54s on doomed direct attempts before reaching
  the mirror: the first attempt now gives up in ~5s, and once a block is
  detected it routes straight to the mirror for the rest of the session.
  Title/length for TikTok links also come from the mirror first, so queue rows
  fill in ~1s instead of stalling. Unblocked networks still use the native path
  first, so quality is unchanged for everyone else.
- **Snappier "reading video length."** Title and duration are cached for a few
  minutes, so toggling *Trim to a clip* and then adding the same link no longer
  re-fetches the same info over the network.

### Added
- **Parallel downloads.** The queue downloads up to 3 links at once instead of
  strictly one-at-a-time, so a batch of clips finishes in roughly a third of the
  time. Each row still shows its own progress; an in-flight item must be canceled
  before it can be removed.

## 3.3.0 — 2026-06-15

### Added
- **Google Flow support.** Paste a Flow **Share link** (in Flow: hover a clip
  ▸ More ▸ Share ▸ Copy link) and it downloads straight into your project bin
  like any other source — edit-ready H.264/AAC, no re-encode, audio intact, no
  manual download and no API key. Clips import with a clean
  `Flow clip [id].mp4` name and a "Flow" queue badge. A wrong or unshared link
  gets a clear "use the Share link" hint instead of a generic error.
  Note: only the **Share link** exposes the video — the editor/project URL in
  your browser address bar won't work.

### Fixed
- **Windows paste shortcuts now work in the panel.** Ctrl+V/C/X/A use the
  Windows system clipboard instead of the macOS-only clipboard command.
- **Cookie browser choices now match the user's device.** The Settings panel
  detects installed supported browsers and shows only those choices for live
  cookies and one-click cookies.txt creation.

## 3.2.0 — 2026-06-12

### Added
- **TikTok works where it's blocked — automatically, no VPN.** When yt-dlp
  can't reach TikTok directly (banned/ISP-blocked regions like India poison
  its DNS and filter its traffic), the panel resolves the video through a
  public mirror and downloads it from an unblocked CDN. Transparent: paste
  the link, see *"TikTok blocked on this network — trying mirror…"*, done.
  Resolved downloads get a clean `Title [id].mp4` filename, and the queue
  shows the real title/thumbnail even when the direct fetch is blocked.
  Clipping, format conversion, and import all work unchanged.

## 3.1.0 — 2026-06-12

### Added
- **Proxy URL setting.** Settings ▸ Proxy URL routes every download
  (and title fetch) through an http/https/socks5 proxy via yt-dlp's
  `--proxy`. This is the way through ISP/country blocks — e.g. TikTok in
  India, where ISPs DNS-poison the site and browser VPN extensions don't
  cover the panel's downloads.

### Changed
- The "Network problem" error hint now explains ISP/region blocks and
  points at system-wide VPNs and the new Proxy URL setting, instead of
  only saying "check your internet connection".

## 3.0.0 — 2026-06-12

Smart Grab becomes a product: install it with two clicks, and it looks
after itself from then on.

### Added
- **Self-healing panel.** On first open the panel downloads everything it
  needs (yt-dlp, ffmpeg, ffprobe, deno) by itself, with a progress bar.
  Delete or break a binary and the panel repairs it — no reinstall, no
  terminal, ever.
- **Automatic yt-dlp updates.** If yt-dlp is older than 14 days, the panel
  refreshes it silently in the background on open, so site fixes arrive
  without anyone thinking about it.
- **Repair downloads** button in Settings — force re-downloads every
  component in one click.
- **Release zips.** `SmartGrab-mac.zip` / `SmartGrab-win.zip` on GitHub
  Releases: download, double-click the installer, restart Premiere. No git.
- MIT license, changelog.

### Changed
- The panel-managed binaries folder (app support) now takes priority over
  installer-bundled binaries, so panel updates always take effect.
- Installers are belt-and-braces now — the panel no longer depends on them
  for binaries.

## 2.x — 2026-06

- Download queue with thumbnails, speed/ETA, retry; playlist expansion.
- Clip trimming: fast (`--download-sections`) with automatic fallback, or
  precise local trim; visual range slider.
- H.264/AAC-preferring format selection — most downloads import with zero
  re-encode; per-stream conversion when one stream is off.
- Multi-video posts (e.g. tweets with 2–4 videos) import every video.
- Cookies: live-browser mode and one-click cookies.txt export from the
  panel; friendly guidance around macOS/Windows browser-cookie walls.
- Friendly error translations for sign-in walls, rate limits, geo blocks.
- Cross-platform core (macOS + Windows paths) with platform-override units.

## 1.0.0 — 2026-06

- First release: paste a link, pick quality, auto-import into a Premiere
  project bin. macOS installer, yt-dlp nightly + static ffmpeg.
