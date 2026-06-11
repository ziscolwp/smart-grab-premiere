# Smart Grab for Premiere

A Premiere Pro panel that downloads online video with `yt-dlp` + `ffmpeg` and
auto-imports it into your current project, inside a "Downloaded Video" bin.

Works with YouTube, Instagram, X/Twitter, TikTok, Reddit, Loom, Vimeo, Twitch,
Facebook and [over a thousand other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

## Install — two clicks, no terminal, no git

1. Grab the zip for your system from the **[latest release](https://github.com/ziscolwp/smart-grab-premiere/releases/latest)**:
   `SmartGrab-mac.zip` (Intel & Apple Silicon) or `SmartGrab-win.zip` (Windows 10/11, 64-bit).
2. Unzip, then run the installer:
   - **macOS** — right-click **install.command** ▸ Open (the right-click matters
     the first time; macOS blocks plain double-clicks on downloads).
   - **Windows** — double-click **install.bat** (if SmartScreen objects:
     *More info* ▸ *Run anyway*).
3. Restart Premiere Pro → **Window ▸ Extensions ▸ Smart Grab**.

The panel takes care of everything else itself: it downloads its own tools
(yt-dlp, ffmpeg, ffprobe, deno) on first open with a progress bar, keeps
yt-dlp fresh automatically, and can re-download anything via **Settings ▸
Repair downloads** if a file ever goes missing or breaks.

Requires Premiere Pro 2021 (15.0) or newer.
Developers: clone the repo and see [Development](#development).

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
- **Proxy URL** — routes all downloads through an `http://`, `https://` or
  `socks5://` proxy. The fix for sites your ISP or country blocks (e.g. TikTok
  in India): downloads run outside the browser, so browser VPN extensions don't
  cover them — set a system-wide VPN, or paste your proxy address here.
- **Trim mode** — *Fast* downloads only the clip (cuts on keyframes, may start a
  moment early); *Precise* downloads everything and trims exactly. Fast falls back
  automatically when a site doesn't support it.
- **Update yt-dlp** — one click, pulls the latest nightly. Run it whenever a site
  stops working; fixes usually ship within a day. (The panel also refreshes
  yt-dlp by itself when it's more than two weeks old.)
- **Repair downloads** — re-downloads every bundled tool (yt-dlp, ffmpeg,
  ffprobe, deno). The fix for "something is broken and I don't know what".

## When a download fails
The panel translates common failures into plain English with a fix hint
(sign-in walls, rate limits, geo blocks, site breakage…). The two universal fixes:

1. **Update yt-dlp** (Settings) — sites change constantly; the nightly build keeps up.
2. **Set sign-in cookies** (Settings) — for anything that needs a login.

## FAQ

**Why do Instagram/X downloads need "sign-in cookies"?**
Those sites show most videos only to logged-in users, so the download
needs your login too. Settings ▸ Sign-in cookies ▸ *From a cookies.txt
file* ▸ **Create from browser** does it in one click (close the browser
first; on Windows use Firefox).

**TikTok (or another site) fails with a network error, but my internet is fine.**
Your ISP or country is blocking that site — TikTok is banned in India, for
example, and Indian ISPs redirect it to a block page, so the download times
out. A VPN browser extension won't help: it only covers the browser, not the
panel. Either run a **system-wide VPN app** (set to cover all apps, not split
tunnel), or set **Settings ▸ Proxy URL** to a proxy/VPN address — many VPN
apps expose a local proxy like `socks5://127.0.0.1:1080` you can paste there.

**My download came in with only audio, or only video.**
That's a site serving broken split streams. Hit **Retry** on the item —
the panel normally detects and merges them itself. If it keeps
happening, copy the error from the item and
[report it](https://github.com/ziscolwp/smart-grab-premiere/issues).

**Why does a 4K download spend minutes "Converting…" after it finishes?**
Sites serve 4K in codecs Premiere edits poorly (VP9/AV1), so **MP4 ·
edit-ready** converts them to H.264 once, up front. 1080p usually has an
H.264 source and needs no conversion. Want the untouched original
instead? Pick **MKV · original** or **MP4 · no re-encode**.

**What can't be grabbed?**
Sites that hide the video behind their own JavaScript player or a
one-time token (many movie/streaming aggregators) serve a page with no
real video in it — there's nothing for any downloader to find, and
cookies don't help. Copy the link to the *actual* video where possible.

**Do I ever need to update the panel or its tools?**
Mostly no: the panel refreshes yt-dlp by itself every two weeks, and
**Settings ▸ Update yt-dlp** forces it today if a site just broke. For
new panel versions, download the latest release zip and run the
installer again.

## Development
- `dev-link.command` symlinks the panel for live editing (macOS).
- `npm test` runs the Node logic tests (no network needed).
- `npm run package` builds the release zips into `dist/`.
- All yt-dlp/ffmpeg decisions are pure functions in `panel/js/engineLogic.js`.
- Research notes on yt-dlp flags: `docs/yt-dlp-notes.md`.
- Spec: `docs/superpowers/specs/`. Plan: `docs/superpowers/plans/`.

## Disclaimer
Download only content you have the right to use. Respect each platform's terms
of service and copyright law.
