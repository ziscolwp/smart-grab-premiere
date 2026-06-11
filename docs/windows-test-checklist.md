# Windows test checklist (v3.0.0)

Windows has never run on real hardware — every Windows code path is
unit-tested from macOS only. This is the script for the first real test.
Any Windows 10/11 64-bit machine with Premiere Pro 2021+ works.

**Setup:** download `SmartGrab-win.zip` from the
[latest release](https://github.com/ziscolwp/smart-grab-premiere/releases/latest).
Don't clone the repo — test exactly what a user gets.

## The 10 steps

1. **Install** — unzip, double-click `install.bat` (SmartScreen: *More
   info ▸ Run anyway*). Expect: binaries download without errors, window
   ends with "Installed", Enter closes it.
2. **Panel opens** — restart Premiere, open a project, *Window ▸
   Extensions ▸ Smart Grab*. Expect: panel renders; if anything is
   missing, the amber setup banner appears, shows a progress bar, and
   finishes by itself.
3. **YouTube 1080p** — paste any public YouTube link, quality *1080p*,
   format *MP4 · edit-ready*, Add to Queue. Expect: progress %, speed and
   ETA tick; file imports into the "Downloaded Video" bin.
4. **Instagram with cookies** — Settings ▸ Sign-in cookies ▸ *From a
   cookies.txt file* ▸ pick **Firefox** ▸ *Create from browser* (close
   Firefox first; you must be logged into Instagram in it). Save, then
   download an Instagram reel. Expect: cookie file created, reel imports.
5. **X multi-video post** — paste a tweet that contains 2+ videos.
   Expect: ALL videos import, not just the first.
6. **Clip trim** — single YouTube link, flip *Trim to a clip*, drag the
   range, download. Expect: only the selected section arrives (fast
   mode), correct content.
7. **Custom folder** — Settings ▸ *Custom folder* ▸ Browse (pick
   something deep, e.g. `Documents\Projects\Test\Grabs`), download
   anything. Expect: file lands there and still imports.
8. **Update yt-dlp** — Settings ▸ *Update yt-dlp*. Expect: "Updated ✓"
   within a minute.
9. **Reveal file** — click the magnifier/reveal icon on a finished queue
   item. Expect: Explorer opens **with the file selected** (this exact
   `explorer /select,` invocation is one of the least-verified spots).
10. **Self-heal** — close Premiere, delete
    `%APPDATA%\SmartGrab\bin\ffmpeg.exe`, reopen the panel. Expect: setup
    banner appears, re-downloads ffmpeg, hides itself; downloads work
    again. (Also try Settings ▸ *Repair downloads*.)

## If something breaks

Capture: a screenshot, the panel's error text (it includes a "copy"
affordance in the queue item), and which step number failed. File it at
<https://github.com/ziscolwp/smart-grab-premiere/issues> or send it to
the owner directly.

## Known-risk areas to watch

- `explorer /select,<path>` reveal with spaces in the path (step 9).
- Very long file paths: deep custom folder + long video title (step 7) —
  Windows' 260-character path limit may bite; expected failure mode is a
  rename error after download.
- First-ever panel open on a machine where the installer's downloads were
  blocked (corporate proxy): the setup banner must appear and retry, not
  show a dead panel.
- PowerShell 5.1 on older Win10: the installer forces TLS 1.2 — if
  downloads still fail, the panel's own self-heal is the fallback.
