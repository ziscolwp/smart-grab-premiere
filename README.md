# Smart Grab for Premiere

A Premiere Pro panel that downloads online video with `yt-dlp` + `ffmpeg` and
auto-imports it into your current project, inside a "Downloaded Video" bin.

Works with YouTube, Instagram, X/Twitter, TikTok, Reddit, Loom, Vimeo, Twitch,
Facebook and [over a thousand other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

## Install

### macOS (Intel & Apple Silicon)
1. Download/clone this repo.
2. Double-click **install.command** (fetches binaries, copies the panel, enables CEP).
   If macOS blocks it: right-click ▸ Open the first time.
3. Restart Premiere Pro → **Window ▸ Extensions ▸ Smart Grab**.

### Windows (10/11, 64-bit)
1. Download/clone this repo.
2. Double-click **install.bat** (fetches `yt-dlp.exe` + `ffmpeg`, copies the panel, enables CEP).
3. Restart Premiere Pro → **Window ▸ Extensions ▸ Smart Grab**.

Requires Premiere Pro 2021 (15.0) or newer.

## Use
1. Paste one or more video links (one per line) — or a whole playlist/channel URL.
2. Pick quality and format. **MP4 · edit-ready** guarantees H.264/AAC that Premiere
   loves; it grabs an H.264 source when the site offers one, so most downloads
   need no re-encoding at all.
3. For a single link, flip **Trim to a clip** and drag the range (or type exact
   times). In *Fast* trim mode only the selected section is downloaded.
4. **Add to Queue** — items download one at a time and import straight into your
   project bin, with thumbnails, speed/ETA and per-item retry.

## Settings (⚙)
- **Where to save** — next to your `.prproj` (synced per project) or a fixed folder.
- **Sign-in cookies** — needed for Instagram, X, and private/age-gated videos.
  - *From a cookies.txt file* — **recommended.** Click **Create from browser**:
    the panel reads your browser's cookies once and saves them to a file — no
    terminal, no extension, nothing technical. (Close the browser first. On
    macOS, Chrome/Brave ask for a one-time keychain permission; Safari is blocked
    by macOS privacy protection — use another browser. On Windows, use Firefox.)
    Power users can instead export with the "Get cookies.txt LOCALLY" extension
    and Browse to it — best for YouTube, where a private-window export lasts longest.
  - *From a browser (live)* — reads cookies on every download; quicker to set up
    but more fragile. Same browser caveats as above.
- **Trim mode** — *Fast* downloads only the clip (cuts on keyframes, may start a
  moment early); *Precise* downloads everything and trims exactly. Fast falls back
  automatically when a site doesn't support it.
- **Update yt-dlp** — one click, pulls the latest nightly. Run it whenever a site
  stops working; fixes usually ship within a day.

## When a download fails
The panel translates common failures into plain English with a fix hint
(sign-in walls, rate limits, geo blocks, site breakage…). The two universal fixes:

1. **Update yt-dlp** (Settings) — sites change constantly; the nightly build keeps up.
2. **Set sign-in cookies** (Settings) — for anything that needs a login.

**What can't be grabbed:** sites that hide the video behind their own JavaScript
player or a one-time token (many movie/streaming aggregators) serve a page with
no real video in it — there's nothing for any downloader to find, and cookies
don't help. Copy the link to the *actual* video where possible.

## Development
- `dev-link.command` symlinks the panel for live editing (macOS).
- `npm test` runs the Node logic tests (96 tests, no network needed).
- All yt-dlp/ffmpeg decisions are pure functions in `panel/js/engineLogic.js`.
- Research notes on yt-dlp flags: `docs/yt-dlp-notes.md`.
- Spec: `docs/superpowers/specs/`. Plan: `docs/superpowers/plans/`.

## Disclaimer
Download only content you have the right to use. Respect each platform's terms
of service and copyright law.
