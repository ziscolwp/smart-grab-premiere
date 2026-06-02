# Smart Grab for Premiere

A Premiere Pro panel that downloads online video (via `yt-dlp` + `ffmpeg`) and
auto-imports it into the current project, inside a "Downloaded Video" bin.

## Install
1. Double-click **install.command** (fetches binaries, copies the panel, enables CEP).
2. Restart Premiere Pro.
3. Open **Window ▸ Extensions ▸ Smart Grab**.

If macOS blocks the script: right-click ▸ Open the first time.

## Use
1. Paste a video URL.
2. Pick quality / format (and an optional clip range).
3. **Download & Import** — the file lands in the project panel.

## Settings (⚙)
- **Sync to current project** — saves into a "Downloaded Video" folder next to your `.prproj`.
- **Custom folder** — always saves to a fixed folder you choose.
- **Update yt-dlp** — refresh the downloader when a site stops working.

## Requirements
macOS (Apple Silicon), Premiere Pro 2022+. The installer bundles `yt-dlp`/`ffmpeg`;
if that fails it falls back to Homebrew copies (`brew install yt-dlp ffmpeg`).

## Development
- `dev-link.command` symlinks the panel for live editing.
- `npm test` runs the Node logic tests.
- Spec: `docs/superpowers/specs/`. Plan: `docs/superpowers/plans/`.
