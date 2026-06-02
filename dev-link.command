#!/bin/bash
# Smart Grab for Premiere — dev installer (symlink the panel for live editing).
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_SRC="$SELF_DIR/panel"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SmartGrabPanel"

echo "Linking panel for development…"
rm -rf "$DEST"
ln -s "$PANEL_SRC" "$DEST"

defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall -u "$(whoami)" cfprefsd 2>/dev/null

echo "✓ Symlinked $DEST -> $PANEL_SRC"
echo "  (Run install.command at least once to fetch the bundled binaries into panel/bin.)"
echo "  Restart Premiere Pro, then: Window ▸ Extensions ▸ Smart Grab"
