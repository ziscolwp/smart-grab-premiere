#!/bin/bash
# Smart Grab for Premiere — macOS installer (copy + fetch binaries + enable CEP).
# Tolerant: a failed binary download is a warning, not fatal (runtime falls back to Homebrew).

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_SRC="$SELF_DIR/panel"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SmartGrabPanel"
BIN="$PANEL_SRC/bin"
ARCH="$(uname -m)"

# Browser-downloaded zips quarantine everything inside. The user got past
# Gatekeeper once (right-click ▸ Open) to run this — clear the rest so any
# re-run is a plain double-click.
xattr -dr com.apple.quarantine "$SELF_DIR" 2>/dev/null

echo "Installing Smart Grab for Premiere (macOS $ARCH)…"
mkdir -p "$BIN"

fetch() { # url dest
  echo "  • $(basename "$2")"
  curl -L --fail --silent --show-error -o "$2" "$1" || echo "    (skipped — will fall back to a system binary)"
}

fetch_zip() { # url marker-file
  local tmp="$BIN/_dl.zip"
  fetch "$1" "$tmp"
  [ -f "$tmp" ] && unzip -o -q "$tmp" -d "$BIN" && rm -f "$tmp"
}

# yt-dlp — nightly channel (extractor fixes land here first; universal2 binary).
[ -f "$BIN/yt-dlp" ] || fetch "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos" "$BIN/yt-dlp"

# ffmpeg/ffprobe — static builds per architecture.
if [ "$ARCH" = "arm64" ]; then
  [ -f "$BIN/ffmpeg" ]  || fetch_zip "https://www.osxexperts.net/ffmpeg81arm.zip" ffmpeg
  [ -f "$BIN/ffprobe" ] || fetch_zip "https://www.osxexperts.net/ffprobe81arm.zip" ffprobe
else
  [ -f "$BIN/ffmpeg" ]  || fetch_zip "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip" ffmpeg
  [ -f "$BIN/ffprobe" ] || fetch_zip "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip" ffprobe
fi

# deno — JS runtime yt-dlp uses for YouTube's player challenges (optional but
# recommended for full YouTube support).
if [ ! -f "$BIN/deno" ]; then
  if [ "$ARCH" = "arm64" ]; then
    fetch_zip "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip" deno
  else
    fetch_zip "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip" deno
  fi
fi

chmod +x "$BIN"/yt-dlp "$BIN"/ffmpeg "$BIN"/ffprobe "$BIN"/deno 2>/dev/null

echo "Copying panel…"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$PANEL_SRC/" "$DEST/"

echo "Clearing quarantine + signing binaries…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
for b in yt-dlp ffmpeg ffprobe deno; do
  [ -f "$DEST/bin/$b" ] && codesign --force --sign - "$DEST/bin/$b" 2>/dev/null
done

echo "Enabling CEP debug mode (PPro 2021–2025+)…"
for v in 10 11 12 13; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
killall -u "$(whoami)" cfprefsd 2>/dev/null

echo ""
echo "✓ Installed. Restart Premiere Pro, then: Window ▸ Extensions ▸ Smart Grab"
