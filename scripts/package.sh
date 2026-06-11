#!/bin/bash
# scripts/package.sh — build the two-click release zips.
# Produces dist/SmartGrab-mac.zip and dist/SmartGrab-win.zip: panel + installer
# + plain-English INSTALL.txt. Binaries are NOT bundled — the panel fetches its
# own on first open (the installers also fetch, as belt-and-braces).
# Self-verifies: unzips each artifact and checks the exec bit + contents.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$(mktemp -d /tmp/smartgrab-package.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/package.json")"
echo "Packaging Smart Grab v$VERSION"
mkdir -p "$DIST"
rm -f "$DIST/SmartGrab-mac.zip" "$DIST/SmartGrab-win.zip"

# Panel copy without dev/installer leftovers (binaries are license-bound and
# big; .debug is only for CEP remote debugging).
copy_panel() { # dest
  mkdir -p "$1"
  rsync -a \
    --exclude 'bin/' \
    --exclude '.debug' \
    --exclude '.DS_Store' \
    "$ROOT/panel/" "$1/panel/"
}

crlf() { # file… — Notepad/cmd-friendly line endings
  for f in "$@"; do
    awk '{ sub(/\r$/, ""); printf "%s\r\n", $0 }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
}

# ---------------- macOS zip ----------------
MAC="$STAGE/mac/SmartGrab"
copy_panel "$MAC"
cp "$ROOT/install.command" "$MAC/install.command"
chmod +x "$MAC/install.command"
cat > "$MAC/INSTALL.txt" <<'EOF'
SMART GRAB FOR PREMIERE PRO — macOS INSTALL

1.  Right-click (or Control-click) "install.command" and choose Open.
    A warning appears because the installer isn't from the App Store —
    click "Open" to continue.
    (On macOS 15 Sequoia or newer: if there is no Open button, go to
    System Settings > Privacy & Security, scroll down, and click
    "Open Anyway" next to install.command.)

2.  Wait for the window to say "Installed", then close it.

3.  Restart Premiere Pro.

4.  In Premiere:  Window > Extensions > Smart Grab

That's it. The panel downloads everything else it needs the first time
it opens (takes a minute — watch the progress bar).

Need Premiere Pro 2021 (15.0) or newer.
Questions or problems:
https://github.com/ziscolwp/smart-grab-premiere/issues
EOF
(cd "$STAGE/mac" && zip -r -q "$DIST/SmartGrab-mac.zip" SmartGrab)

# ---------------- Windows zip ----------------
WIN="$STAGE/win/SmartGrab"
copy_panel "$WIN"
cp "$ROOT/install.ps1" "$WIN/install.ps1"
cp "$ROOT/install.bat" "$WIN/install.bat"
cat > "$WIN/INSTALL.txt" <<'EOF'
SMART GRAB FOR PREMIERE PRO — WINDOWS INSTALL

1.  Unzip this folder if you haven't already (right-click the zip >
    Extract All). Don't run the installer from inside the zip preview.

2.  Double-click "install.bat".
    If Windows shows "Windows protected your PC", click "More info",
    then "Run anyway". (The warning appears for any new download.)

3.  Wait for the window to say "Installed", then press Enter to close.

4.  Restart Premiere Pro.

5.  In Premiere:  Window > Extensions > Smart Grab

That's it. The panel downloads everything else it needs the first time
it opens (takes a minute — watch the progress bar).

Tip: for private/age-gated videos the panel can use your browser
sign-in. On Windows, use Firefox for that — Windows blocks reading
Chrome's cookies.

Need Premiere Pro 2021 (15.0) or newer, Windows 10/11 64-bit.
Questions or problems:
https://github.com/ziscolwp/smart-grab-premiere/issues
EOF
crlf "$WIN/install.ps1" "$WIN/install.bat" "$WIN/INSTALL.txt"
(cd "$STAGE/win" && zip -r -q "$DIST/SmartGrab-win.zip" SmartGrab)

# ---------------- verify ----------------
echo "Verifying artifacts…"
CHECK="$STAGE/check"
mkdir -p "$CHECK/mac" "$CHECK/win"
unzip -q "$DIST/SmartGrab-mac.zip" -d "$CHECK/mac"
unzip -q "$DIST/SmartGrab-win.zip" -d "$CHECK/win"

fail() { echo "✗ $1" >&2; exit 1; }
[ -x "$CHECK/mac/SmartGrab/install.command" ] || fail "exec bit lost on install.command"
[ -f "$CHECK/mac/SmartGrab/INSTALL.txt" ] || fail "mac INSTALL.txt missing"
[ -f "$CHECK/mac/SmartGrab/panel/index.html" ] || fail "mac panel missing"
[ -f "$CHECK/win/SmartGrab/install.bat" ] || fail "win install.bat missing"
[ -f "$CHECK/win/SmartGrab/panel/index.html" ] || fail "win panel missing"
[ ! -d "$CHECK/mac/SmartGrab/panel/bin" ] || fail "binaries leaked into mac zip"
[ ! -d "$CHECK/win/SmartGrab/panel/bin" ] || fail "binaries leaked into win zip"
[ ! -f "$CHECK/mac/SmartGrab/panel/.debug" ] || fail ".debug leaked into mac zip"
grep -q $'\r' "$CHECK/win/SmartGrab/install.bat" || fail "install.bat is not CRLF"
grep -q "ExtensionBundleVersion=\"$VERSION\"" "$CHECK/mac/SmartGrab/panel/CSXS/manifest.xml" \
  || fail "manifest version != package.json version"

echo "✓ dist/SmartGrab-mac.zip ($(du -h "$DIST/SmartGrab-mac.zip" | cut -f1 | tr -d ' '))"
echo "✓ dist/SmartGrab-win.zip ($(du -h "$DIST/SmartGrab-win.zip" | cut -f1 | tr -d ' '))"
