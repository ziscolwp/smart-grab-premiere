#!/bin/bash
# Smart Grab for Premiere — installer (copy + fetch binaries + enable CEP).
# Tolerant: a failed binary download is a warning, not fatal (runtime falls back to Homebrew).

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_SRC="$SELF_DIR/panel"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SmartGrabPanel"
BIN="$PANEL_SRC/bin"

echo "Installing Smart Grab for Premiere…"
mkdir -p "$BIN"

fetch() { # url dest
  echo "  • $(basename "$2")"
  curl -L --fail --silent --show-error -o "$2" "$1" || echo "    (skipped — will fall back to a system binary)"
}

[ -f "$BIN/yt-dlp" ] || fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" "$BIN/yt-dlp"

if [ ! -f "$BIN/ffmpeg" ]; then
  fetch "https://www.osxexperts.net/ffmpeg81arm.zip" "$BIN/ffmpeg.zip"
  [ -f "$BIN/ffmpeg.zip" ] && unzip -o -q "$BIN/ffmpeg.zip" -d "$BIN" && rm -f "$BIN/ffmpeg.zip"
fi
if [ ! -f "$BIN/ffprobe" ]; then
  fetch "https://www.osxexperts.net/ffprobe81arm.zip" "$BIN/ffprobe.zip"
  [ -f "$BIN/ffprobe.zip" ] && unzip -o -q "$BIN/ffprobe.zip" -d "$BIN" && rm -f "$BIN/ffprobe.zip"
fi
chmod +x "$BIN"/yt-dlp "$BIN"/ffmpeg "$BIN"/ffprobe 2>/dev/null

echo "Copying panel…"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$PANEL_SRC/" "$DEST/"

echo "Clearing quarantine + signing binaries…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
for b in yt-dlp ffmpeg ffprobe; do
  [ -f "$DEST/bin/$b" ] && codesign --force --sign - "$DEST/bin/$b" 2>/dev/null
done

echo "Enabling CEP debug mode…"
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall -u "$(whoami)" cfprefsd 2>/dev/null

echo ""
echo "✓ Installed. Restart Premiere Pro, then: Window ▸ Extensions ▸ Smart Grab"
