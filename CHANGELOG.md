# Changelog

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
