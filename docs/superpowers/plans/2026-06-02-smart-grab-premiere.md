# Smart Grab for Premiere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Adobe Premiere Pro CEP panel that downloads online video via `yt-dlp`/`ffmpeg` (full Smart Grab option parity) and auto-imports the result into the current project's panel inside a "Downloaded Video" bin.

**Architecture:** A CEP panel (HTML/JS UI) whose Node.js layer spawns `yt-dlp`/`ffmpeg` (the download engine, a faithful port of Smart Grab's Swift pipeline), then calls ExtendScript (`hostscript.jsx`) to import the file into a bin. Pure pipeline logic is isolated in `engineLogic.js` for unit testing; I/O orchestration lives in `downloadEngine.js`. Two destination modes (sync-to-project / custom folder) are selectable in a Settings view and persisted to JSON. Binaries are resolved bundled-first with a Homebrew/PATH fallback.

**Tech Stack:** CEP 11/12 (CSXS), Node.js (CommonJS, bundled with CEP), ExtendScript (ES3), `yt-dlp` + static `ffmpeg`/`ffprobe`, Node built-in test runner (`node --test`).

**Working directory:** `~/Ziscol Media Projects/smart-grab-premiere`

**Reference sources on this machine (read these, don't reinvent):**
- Smart Grab pipeline to port: `~/bin/smart-grab-gui/Sources/DownloadEngine.swift`
- CEP pattern to mirror: `~/Library/Application Support/Adobe/CEP/extensions/AudioExtractor/{main.js,jsx/hostscript.jsx,CSXS/manifest.xml,CSInterface.js}`

---

## File Structure

```
smart-grab-premiere/
├── package.json                     # test script only (node --test)
├── panel/
│   ├── CSXS/manifest.xml            # extension manifest
│   ├── .debug                       # ExtendScript remote-debug ports
│   ├── index.html                   # panel markup (main view + settings view)
│   ├── css/style.css                # panel styling (dark, Premiere-like)
│   ├── js/CSInterface.js            # Adobe library (vendored from AudioExtractor)
│   ├── js/engineLogic.js            # PURE pipeline logic (unit-tested)
│   ├── js/binaries.js               # binary resolution + yt-dlp updater
│   ├── js/settings.js               # load/save settings JSON
│   ├── js/downloadEngine.js         # orchestration: spawn yt-dlp/ffmpeg
│   └── js/main.js                   # UI wiring
│   └── jsx/hostscript.jsx           # ExtendScript: project dir, import, folder pick
├── test/
│   ├── engineLogic.test.js
│   ├── binaries.test.js
│   └── settings.test.js
├── install.command                  # copy install (default) + fetch binaries
├── dev-link.command                 # symlink install (live development)
└── README.md
```

**Responsibility split:** `engineLogic.js` is pure functions only (no `child_process`, no live FS) so it is fully unit-testable. `downloadEngine.js` wires those functions to real `spawn`/`fs` calls. `binaries.resolveBinary` takes injectable dirs/predicate so it is testable; `binaries.updateYtDlp` does real I/O (manually tested).

---

## Task 1: Project scaffolding, manifest, CEP skeleton

**Files:**
- Create: `package.json`
- Create: `panel/CSXS/manifest.xml`
- Create: `panel/.debug`
- Create: `panel/js/CSInterface.js` (copied)
- Create: `panel/index.html` (minimal placeholder, replaced in Task 7)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "smart-grab-premiere",
  "version": "1.0.0",
  "description": "Premiere Pro panel: download video via yt-dlp/ffmpeg and import into the project panel.",
  "scripts": {
    "test": "node --test test/*.test.js"
  },
  "license": "UNLICENSED",
  "private": true
}
```

- [ ] **Step 2: Create `panel/CSXS/manifest.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest Version="7.0" ExtensionBundleId="com.ziscol.smartgrab" ExtensionBundleVersion="1.0.0" ExtensionBundleName="SmartGrab" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <ExtensionList>
        <Extension Id="com.ziscol.smartgrab.panel" Version="1.0.0" />
    </ExtensionList>
    <ExecutionEnvironment>
        <HostList>
            <Host Name="PPRO" Version="[22.0,99.9]" />
        </HostList>
        <LocaleList>
            <Locale Code="All" />
        </LocaleList>
        <RequiredRuntimeList>
            <RequiredRuntime Name="CSXS" Version="9.0" />
        </RequiredRuntimeList>
    </ExecutionEnvironment>
    <DispatchInfoList>
        <Extension Id="com.ziscol.smartgrab.panel">
            <DispatchInfo>
                <Resources>
                    <MainPath>./index.html</MainPath>
                    <ScriptPath>./jsx/hostscript.jsx</ScriptPath>
                    <CEFCommandLine>
                        <Parameter>--allow-file-access-from-files</Parameter>
                        <Parameter>--enable-nodejs</Parameter>
                        <Parameter>--mixed-context</Parameter>
                    </CEFCommandLine>
                </Resources>
                <Lifecycle>
                    <AutoVisible>true</AutoVisible>
                </Lifecycle>
                <UI>
                    <Type>Panel</Type>
                    <Menu>Smart Grab</Menu>
                    <Geometry>
                        <Size><Height>520</Height><Width>320</Width></Size>
                        <MinSize><Height>360</Height><Width>280</Width></MinSize>
                        <MaxSize><Height>900</Height><Width>500</Width></MaxSize>
                    </Geometry>
                    <Icons />
                </UI>
            </DispatchInfo>
        </Extension>
    </DispatchInfoList>
</ExtensionManifest>
```

- [ ] **Step 3: Create `panel/.debug`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList>
    <Extension Id="com.ziscol.smartgrab.panel">
        <HostList>
            <Host Name="PPRO" Port="8088"/>
        </HostList>
    </Extension>
</ExtensionList>
```

- [ ] **Step 4: Vendor CSInterface.js from the working AudioExtractor panel**

Run:
```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
cp "$HOME/Library/Application Support/Adobe/CEP/extensions/AudioExtractor/CSInterface.js" panel/js/CSInterface.js
test -s panel/js/CSInterface.js && echo "OK CSInterface vendored ($(wc -l < panel/js/CSInterface.js) lines)"
```
Expected: `OK CSInterface vendored (NNN lines)` with NNN in the hundreds.

- [ ] **Step 5: Create minimal `panel/index.html` (placeholder, replaced in Task 7)**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Smart Grab</title></head>
<body>
  <div>Smart Grab — loading…</div>
  <script src="./js/CSInterface.js"></script>
</body>
</html>
```

- [ ] **Step 6: Commit**

```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
git add -A
git commit -m "chore: scaffold CEP panel skeleton and manifest"
```

---

## Task 2: settings.js (load/save JSON) — TDD

**Files:**
- Create: `panel/js/settings.js`
- Test: `test/settings.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/settings.test.js
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const settings = require('../panel/js/settings.js');

function tmpFile() {
  return path.join(os.tmpdir(), 'sg_settings_' + process.pid + '_' + Math.floor(Math.random() * 1e9) + '.json');
}

test('load() returns defaults when file is missing', () => {
  const s = settings.load(tmpFile());
  assert.strictEqual(s.destinationMode, 'sync');
  assert.strictEqual(s.binName, 'Downloaded Video');
  assert.strictEqual(s.lastQuality, 'fhd');
});

test('save() then load() round-trips and merges over defaults', () => {
  const f = tmpFile();
  const ok = settings.save({ destinationMode: 'custom', customFolder: '/tmp/grabs', lastQuality: 'uhd' }, f);
  assert.strictEqual(ok, true);
  const s = settings.load(f);
  assert.strictEqual(s.destinationMode, 'custom');
  assert.strictEqual(s.customFolder, '/tmp/grabs');
  assert.strictEqual(s.lastQuality, 'uhd');
  assert.strictEqual(s.binName, 'Downloaded Video'); // default preserved
  fs.unlinkSync(f);
});

test('load() returns defaults on corrupt JSON', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ not json');
  const s = settings.load(f);
  assert.strictEqual(s.destinationMode, 'sync');
  fs.unlinkSync(f);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$HOME/Ziscol Media Projects/smart-grab-premiere" && node --test test/settings.test.js`
Expected: FAIL — `Cannot find module '../panel/js/settings.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// panel/js/settings.js
var fs = require('fs');
var path = require('path');
var os = require('os');

var DIR = path.join(os.homedir(), 'Library', 'Application Support', 'SmartGrab');
var FILE = path.join(DIR, 'settings.json');

var DEFAULTS = {
  destinationMode: 'sync',                                   // 'sync' | 'custom'
  customFolder: path.join(os.homedir(), 'Downloads', 'yt-grabs'),
  binName: 'Downloaded Video',
  lastQuality: 'fhd',
  lastVideoFormat: 'mp4Premiere',
  lastAudioFormat: 'mp3'
};

function merge(base, over) {
  var out = {};
  var k;
  for (k in base) { if (base.hasOwnProperty(k)) out[k] = base[k]; }
  if (over) { for (k in over) { if (over.hasOwnProperty(k)) out[k] = over[k]; } }
  return out;
}

function load(file) {
  file = file || FILE;
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return merge(DEFAULTS, null);
  }
}

function save(obj, file) {
  file = file || FILE;
  try {
    var dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merge(DEFAULTS, obj), null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { load: load, save: save, DEFAULTS: DEFAULTS, FILE: FILE, DIR: DIR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/settings.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/settings.js test/settings.test.js
git commit -m "feat(settings): add JSON settings load/save with defaults"
```

---

## Task 3: engineLogic.js (pure pipeline logic) — TDD

This is the faithful port of the decision logic in `DownloadEngine.swift`. Pure functions only.

**Files:**
- Create: `panel/js/engineLogic.js`
- Test: `test/engineLogic.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/engineLogic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../panel/js/engineLogic.js');

test('qualityToFormat maps every quality to the Smart Grab format string', () => {
  assert.strictEqual(L.qualityToFormat('best'), 'bv*+ba/best');
  assert.strictEqual(L.qualityToFormat('uhd'), 'bv*[height<=2160]+ba/best');
  assert.strictEqual(L.qualityToFormat('fhd'), 'bv*[height<=1080]+ba/best');
  assert.strictEqual(L.qualityToFormat('hd'), 'bv*[height<=720]+ba/best');
  assert.strictEqual(L.qualityToFormat('sd'), 'bv*[height<=480]+ba/best');
  assert.strictEqual(L.qualityToFormat('audioOnly'), 'ba/best');
});

test('videoFormatInfo returns ext + needsReencode for each format', () => {
  assert.deepStrictEqual(L.videoFormatInfo('mp4Premiere'), { ext: 'mp4', needsReencode: true });
  assert.deepStrictEqual(L.videoFormatInfo('mov'), { ext: 'mov', needsReencode: true });
  assert.deepStrictEqual(L.videoFormatInfo('mkv'), { ext: 'mkv', needsReencode: false });
  assert.deepStrictEqual(L.videoFormatInfo('mp4Raw'), { ext: 'mp4', needsReencode: false });
});

test('buildYtDlpArgs builds video args with merge format', () => {
  const args = L.buildYtDlpArgs(
    { quality: 'fhd', videoFormat: 'mp4Premiere' },
    '/tmp/work', '/opt/homebrew/bin', 'https://x/y'
  );
  assert.deepStrictEqual(args, [
    '-P', '/tmp/work', '-f', 'bv*[height<=1080]+ba/best',
    '--force-ipv4', '--newline', '--no-warnings',
    '--ffmpeg-location', '/opt/homebrew/bin',
    '--extractor-retries', '3', '--retry-sleep', 'extractor:5',
    '--merge-output-format', 'mp4', 'https://x/y'
  ]);
});

test('buildYtDlpArgs builds MKV merge format', () => {
  const args = L.buildYtDlpArgs({ quality: 'best', videoFormat: 'mkv' }, '/t', '/f', 'URL');
  assert.ok(args.indexOf('--merge-output-format') !== -1);
  assert.strictEqual(args[args.indexOf('--merge-output-format') + 1], 'mkv');
});

test('buildYtDlpArgs builds audio-only extraction args', () => {
  const args = L.buildYtDlpArgs({ quality: 'audioOnly', audioFormat: 'mp3' }, '/t', '/f', 'URL');
  assert.ok(args.indexOf('-x') !== -1);
  assert.strictEqual(args[args.indexOf('--audio-format') + 1], 'mp3');
  assert.strictEqual(args.indexOf('--merge-output-format'), -1);
  assert.strictEqual(args[args.length - 1], 'URL');
});

test('outputFileName: plain video', () => {
  assert.strictEqual(
    L.outputFileName('My Video', { quality: 'fhd', videoFormat: 'mp4Premiere' }),
    'My Video.mp4'
  );
});

test('outputFileName: audio only uses audio ext', () => {
  assert.strictEqual(
    L.outputFileName('Song', { quality: 'audioOnly', audioFormat: 'wav' }),
    'Song.wav'
  );
});

test('outputFileName: clip range encodes start/end with dashes', () => {
  assert.strictEqual(
    L.outputFileName('Clip', { quality: 'fhd', videoFormat: 'mov', clipEnabled: true, startTime: '00:00:05', endTime: '00:01:30' }),
    'Clip_clip_00-00-05_to_00-01-30.mov'
  );
});

test('choosePostProcess: audio-only => move', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ audioOnly: true }, '/s.m4a', '/d.wav'),
    { action: 'move' }
  );
});

test('choosePostProcess: clip with reencode format', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '00:00:01', endTime: '00:00:09', needsReencode: true },
    '/s.mkv', '/d.mp4'
  );
  assert.deepStrictEqual(r, {
    action: 'ffmpeg',
    args: ['-y', '-ss', '00:00:01', '-to', '00:00:09', '-i', '/s.mkv',
           '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']
  });
});

test('choosePostProcess: clip without reencode copies streams', () => {
  const r = L.choosePostProcess(
    { clipEnabled: true, startTime: '0', endTime: '5', needsReencode: false },
    '/s.mkv', '/d.mkv'
  );
  assert.deepStrictEqual(r.args.slice(-3), ['-c', 'copy', '/d.mkv']);
});

test('choosePostProcess: already h264+aac+mp4 => move (fast path)', () => {
  assert.deepStrictEqual(
    L.choosePostProcess(
      { needsReencode: true, srcExt: 'mp4', tgtExt: 'mp4', vcodec: 'h264', acodec: 'aac' },
      '/s.mp4', '/d.mp4'
    ),
    { action: 'move' }
  );
});

test('choosePostProcess: reencode when codecs differ', () => {
  const r = L.choosePostProcess(
    { needsReencode: true, srcExt: 'webm', tgtExt: 'mp4', vcodec: 'vp9', acodec: 'opus' },
    '/s.webm', '/d.mp4'
  );
  assert.deepStrictEqual(r, {
    action: 'ffmpeg',
    args: ['-y', '-i', '/s.webm', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '/d.mp4']
  });
});

test('choosePostProcess: same ext, no reencode => move', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ needsReencode: false, srcExt: 'mkv', tgtExt: 'mkv' }, '/s.mkv', '/d.mkv'),
    { action: 'move' }
  );
});

test('choosePostProcess: different ext, no reencode => remux copy', () => {
  assert.deepStrictEqual(
    L.choosePostProcess({ needsReencode: false, srcExt: 'webm', tgtExt: 'mp4' }, '/s.webm', '/d.mp4'),
    { action: 'ffmpeg', args: ['-y', '-i', '/s.webm', '-c', 'copy', '/d.mp4'] }
  );
});

test('parseProgress extracts percent and strips [download] prefix', () => {
  const r = L.parseProgress('[download]  42.5% of 10MiB at 1MiB/s');
  assert.strictEqual(Math.round(r.percent * 10) / 10, 42.5);
  assert.ok(r.status.indexOf('[download]') === -1);
});

test('parseProgress returns merging status for merge lines', () => {
  const r = L.parseProgress('[Merger] Merging formats into "x.mp4"');
  assert.strictEqual(r.status, 'Merging streams...');
  assert.strictEqual(r.percent, null);
});

test('parseProgress returns null for unrelated lines', () => {
  assert.strictEqual(L.parseProgress('[info] something'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engineLogic.test.js`
Expected: FAIL — `Cannot find module '../panel/js/engineLogic.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// panel/js/engineLogic.js
// Pure logic ported from DownloadEngine.swift. No I/O — fully unit-testable.

var QUALITY_FORMAT = {
  best: 'bv*+ba/best',
  uhd: 'bv*[height<=2160]+ba/best',
  fhd: 'bv*[height<=1080]+ba/best',
  hd: 'bv*[height<=720]+ba/best',
  sd: 'bv*[height<=480]+ba/best',
  audioOnly: 'ba/best'
};

var VIDEO_FORMAT = {
  mp4Premiere: { ext: 'mp4', needsReencode: true },
  mov: { ext: 'mov', needsReencode: true },
  mkv: { ext: 'mkv', needsReencode: false },
  mp4Raw: { ext: 'mp4', needsReencode: false }
};

function qualityToFormat(quality) {
  return QUALITY_FORMAT[quality] || QUALITY_FORMAT.best;
}

function videoFormatInfo(videoFormat) {
  return VIDEO_FORMAT[videoFormat] || VIDEO_FORMAT.mp4Premiere;
}

function buildYtDlpArgs(opts, tmpDir, ffmpegDir, url) {
  var args = [
    '-P', tmpDir,
    '-f', qualityToFormat(opts.quality),
    '--force-ipv4',
    '--newline',
    '--no-warnings',
    '--ffmpeg-location', ffmpegDir,
    '--extractor-retries', '3',
    '--retry-sleep', 'extractor:5'
  ];
  if (opts.quality === 'audioOnly') {
    args.push('-x', '--audio-format', opts.audioFormat || 'mp3');
  } else {
    args.push('--merge-output-format', opts.videoFormat === 'mkv' ? 'mkv' : 'mp4');
  }
  args.push(url);
  return args;
}

function targetExt(opts) {
  return opts.quality === 'audioOnly'
    ? (opts.audioFormat || 'mp3')
    : videoFormatInfo(opts.videoFormat).ext;
}

function outputFileName(stem, opts) {
  var ext = targetExt(opts);
  if (opts.clipEnabled && opts.endTime) {
    var s = String(opts.startTime || '').split(':').join('-');
    var e = String(opts.endTime).split(':').join('-');
    return stem + '_clip_' + s + '_to_' + e + '.' + ext;
  }
  return stem + '.' + ext;
}

// p: { audioOnly, clipEnabled, startTime, endTime, needsReencode, srcExt, tgtExt, vcodec, acodec }
function choosePostProcess(p, src, dest) {
  if (p.audioOnly) return { action: 'move' };

  if (p.clipEnabled && p.endTime) {
    var ff = ['-y', '-ss', p.startTime, '-to', p.endTime, '-i', src];
    if (p.needsReencode) {
      ff = ff.concat(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart']);
    } else {
      ff = ff.concat(['-c', 'copy']);
    }
    ff.push(dest);
    return { action: 'ffmpeg', args: ff };
  }

  if (p.needsReencode) {
    if (p.vcodec === 'h264' && p.acodec === 'aac' && p.tgtExt === 'mp4' && p.srcExt === 'mp4') {
      return { action: 'move' };
    }
    return { action: 'ffmpeg', args: ['-y', '-i', src, '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', dest] };
  }

  if (p.srcExt === p.tgtExt) return { action: 'move' };
  return { action: 'ffmpeg', args: ['-y', '-i', src, '-c', 'copy', dest] };
}

function parseProgress(line) {
  var trimmed = String(line).replace(/^\s+|\s+$/g, '');
  if (trimmed.indexOf('%') === -1) {
    if (trimmed.indexOf('Merging') !== -1) return { percent: null, status: 'Merging streams...' };
    return null;
  }
  var tokens = trimmed.split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.charAt(t.length - 1) === '%') {
      var val = parseFloat(t.substring(0, t.length - 1));
      if (!isNaN(val)) {
        var display = trimmed.replace('[download]', '').replace(/^\s+|\s+$/g, '');
        return { percent: val, status: display };
      }
    }
  }
  return null;
}

module.exports = {
  qualityToFormat: qualityToFormat,
  videoFormatInfo: videoFormatInfo,
  buildYtDlpArgs: buildYtDlpArgs,
  targetExt: targetExt,
  outputFileName: outputFileName,
  choosePostProcess: choosePostProcess,
  parseProgress: parseProgress
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engineLogic.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/engineLogic.js test/engineLogic.test.js
git commit -m "feat(engine): add pure pipeline logic ported from Smart Grab"
```

---

## Task 4: binaries.js (resolution + updater) — TDD for resolution

**Files:**
- Create: `panel/js/binaries.js`
- Test: `test/binaries.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/binaries.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const B = require('../panel/js/binaries.js');

test('resolveBinary returns first dir where predicate is true', () => {
  const dirs = ['/a/bin', '/b/bin', '/opt/homebrew/bin'];
  const isExec = (p) => p === path.join('/b/bin', 'yt-dlp');
  assert.strictEqual(B.resolveBinary('yt-dlp', { dirs: dirs, isExec: isExec }), path.join('/b/bin', 'yt-dlp'));
});

test('resolveBinary returns null when not found anywhere', () => {
  assert.strictEqual(
    B.resolveBinary('ffmpeg', { dirs: ['/a', '/b'], isExec: () => false }),
    null
  );
});

test('resolveBinary checks dirs in order (bundled wins over homebrew)', () => {
  const dirs = ['/ext/bin', '/opt/homebrew/bin'];
  const isExec = () => true; // both exist -> first wins
  assert.strictEqual(B.resolveBinary('ffmpeg', { dirs: dirs, isExec: isExec }), path.join('/ext/bin', 'ffmpeg'));
});

test('defaultDirs includes bundled, app-support, and homebrew paths in priority order', () => {
  const dirs = B.defaultDirs('/EXT');
  assert.strictEqual(dirs[0], path.join('/EXT', 'bin'));
  assert.ok(dirs.some((d) => d.indexOf('Application Support') !== -1 && d.indexOf('SmartGrab') !== -1));
  assert.ok(dirs.indexOf('/opt/homebrew/bin') !== -1);
  assert.ok(dirs.indexOf('/usr/local/bin') !== -1);
});

test('augmentedEnv prepends homebrew to PATH', () => {
  const env = B.augmentedEnv({ PATH: '/usr/bin:/bin' });
  assert.ok(env.PATH.indexOf('/opt/homebrew/bin') === 0);
  assert.ok(env.PATH.indexOf('/usr/bin:/bin') !== -1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/binaries.test.js`
Expected: FAIL — `Cannot find module '../panel/js/binaries.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// panel/js/binaries.js
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');

var APP_SUPPORT_BIN = path.join(os.homedir(), 'Library', 'Application Support', 'SmartGrab', 'bin');

function defaultIsExec(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

function defaultDirs(extRoot) {
  var dirs = [];
  if (extRoot) dirs.push(path.join(extRoot, 'bin'));
  dirs.push(APP_SUPPORT_BIN);
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  var envPath = (process.env.PATH || '');
  var parts = envPath.split(':');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] && dirs.indexOf(parts[i]) === -1) dirs.push(parts[i]);
  }
  return dirs;
}

function resolveBinary(name, opts) {
  opts = opts || {};
  var dirs = opts.dirs || defaultDirs(opts.extRoot);
  var isExec = opts.isExec || defaultIsExec;
  for (var i = 0; i < dirs.length; i++) {
    var candidate = path.join(dirs[i], name);
    if (isExec(candidate)) return candidate;
  }
  return null;
}

function augmentedEnv(baseEnv) {
  var env = {};
  baseEnv = baseEnv || process.env;
  for (var k in baseEnv) { if (baseEnv.hasOwnProperty(k)) env[k] = baseEnv[k]; }
  var existing = env.PATH || '/usr/bin:/bin';
  env.PATH = '/opt/homebrew/bin:/usr/local/bin:' + existing;
  return env;
}

// Real I/O — download latest yt-dlp into the user-writable app-support bin.
// Manually tested (network + signing). cb(err, destPath).
function updateYtDlp(cb) {
  var dest = path.join(APP_SUPPORT_BIN, 'yt-dlp');
  var url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  try {
    if (!fs.existsSync(APP_SUPPORT_BIN)) fs.mkdirSync(APP_SUPPORT_BIN, { recursive: true });
  } catch (e) { return cb(e); }

  var curl = childProcess.spawn('/usr/bin/curl', ['-L', '--fail', '-o', dest, url]);
  var errOut = '';
  curl.stderr.on('data', function (d) { errOut += d.toString(); });
  curl.on('error', cb);
  curl.on('close', function (code) {
    if (code !== 0) return cb(new Error('Download failed (curl ' + code + '): ' + errOut));
    try {
      fs.chmodSync(dest, 0o755);
      try { childProcess.spawnSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest]); } catch (e) {}
      try { childProcess.spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', dest]); } catch (e) {}
      cb(null, dest);
    } catch (e) { cb(e); }
  });
}

module.exports = {
  resolveBinary: resolveBinary,
  defaultDirs: defaultDirs,
  augmentedEnv: augmentedEnv,
  updateYtDlp: updateYtDlp,
  APP_SUPPORT_BIN: APP_SUPPORT_BIN
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/binaries.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/js/binaries.js test/binaries.test.js
git commit -m "feat(binaries): add binary resolution, env augmentation, yt-dlp updater"
```

---

## Task 5: downloadEngine.js (orchestration)

Wires engineLogic + binaries to real `spawn`/`fs`. Verified manually (spawns processes).

**Files:**
- Create: `panel/js/downloadEngine.js`

- [ ] **Step 1: Write the implementation**

```javascript
// panel/js/downloadEngine.js
// Orchestrates the download pipeline: yt-dlp -> validate -> post-process -> move.
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var L = require('./engineLogic.js');
var binaries = require('./binaries.js');

function uuidish() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

// Run a process, stream stdout/stderr lines, keep a ring buffer for error reporting.
function run(exe, args, env, onLine, onProc, done) {
  var proc = childProcess.spawn(exe, args, { env: env });
  if (onProc) onProc(proc);
  var recent = [];
  function push(line) {
    recent.push(line);
    if (recent.length > 8) recent.shift();
    if (onLine) onLine(line);
  }
  function feed(buf) {
    var lines = buf.toString().split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) if (lines[i]) push(lines[i]);
  }
  proc.stdout.on('data', feed);
  proc.stderr.on('data', feed);
  proc.on('error', function (e) { done(e); });
  proc.on('close', function (code) {
    if (code === 0) return done(null);
    var meaningful = recent.filter(function (l) {
      return l.indexOf('[download]') === -1 && l.indexOf('Downloading') === -1;
    });
    var detail = (meaningful.length ? meaningful : recent).slice(-4).join('\n');
    done(new Error(path.basename(exe) + ' failed:\n' + (detail || 'unknown error')));
  });
}

function probeCodec(ffprobe, file, stream, env, cb) {
  var args = ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=codec_name', '-of', 'default=nk=1:nw=1', file];
  var p = childProcess.spawn(ffprobe, args, { env: env });
  var out = '';
  p.stdout.on('data', function (d) { out += d.toString(); });
  p.on('error', function () { cb(''); });
  p.on('close', function () { cb(out.replace(/^\s+|\s+$/g, '')); });
}

// opts: { url, outputDir, quality, videoFormat, audioFormat, clipEnabled, startTime, endTime, extRoot }
// callbacks: { onProgress(percent,status), onProc(proc) }
// cb(err, finalPath)
function download(opts, callbacks, cb) {
  callbacks = callbacks || {};
  var onProgress = callbacks.onProgress || function () {};
  var onProc = callbacks.onProc || function () {};

  var ytdlp = binaries.resolveBinary('yt-dlp', { extRoot: opts.extRoot });
  var ffmpeg = binaries.resolveBinary('ffmpeg', { extRoot: opts.extRoot });
  if (!ytdlp) return cb(new Error('yt-dlp not found. Click "Update yt-dlp" or install it.'));
  if (!ffmpeg) return cb(new Error('ffmpeg not found. Re-run the installer or `brew install ffmpeg`.'));
  var ffprobe = binaries.resolveBinary('ffprobe', { extRoot: opts.extRoot }) || ffmpeg;
  var ffmpegDir = path.dirname(ffmpeg);
  var env = binaries.augmentedEnv(process.env);

  var tmp = path.join(os.tmpdir(), 'smartgrab-' + uuidish());
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(opts.outputDir, { recursive: true });
  } catch (e) { return cb(e); }

  function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  var audioOnly = opts.quality === 'audioOnly';
  var vinfo = L.videoFormatInfo(opts.videoFormat);
  var args = L.buildYtDlpArgs(opts, tmp, ffmpegDir, opts.url);

  onProgress(0, 'Downloading...');
  run(ytdlp, args, env, function (line) {
    var p = L.parseProgress(line);
    if (p) onProgress(p.percent, p.status);
  }, onProc, function (err) {
    if (err) { cleanup(); return cb(err); }

    var files;
    try {
      files = fs.readdirSync(tmp).filter(function (f) {
        return f.indexOf('.part') === -1 && f.indexOf('.ytdl') === -1;
      });
    } catch (e) { cleanup(); return cb(e); }

    if (files.length === 0) { cleanup(); return cb(new Error('Download failed — no output file.')); }
    if (files.length > 1) {
      cleanup();
      return cb(new Error('Merge failed — yt-dlp left ' + files.length + ' separate streams. ffmpeg may not be reachable.'));
    }

    var name = files[0];
    var src = path.join(tmp, name);
    var stem = path.basename(name, path.extname(name));
    var srcExt = path.extname(name).replace('.', '').toLowerCase();
    var tgtExt = L.targetExt(opts);
    var dest = path.join(opts.outputDir, L.outputFileName(stem, opts));

    try { if (fs.existsSync(dest)) fs.rmSync(dest); } catch (e) {}

    function finish() {
      var sizeStr = '';
      try {
        var bytes = fs.statSync(dest).size;
        sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      } catch (e) {}
      cleanup();
      onProgress(100, 'Done!');
      cb(null, { path: dest, size: sizeStr });
    }

    function applyAction(act) {
      if (act.action === 'move') {
        try { fs.renameSync(src, dest); return finish(); }
        catch (e) {
          // cross-device fallback
          try { fs.copyFileSync(src, dest); fs.rmSync(src); return finish(); }
          catch (e2) { cleanup(); return cb(e2); }
        }
      }
      // ffmpeg action
      onProgress(null, 'Processing...');
      run(ffmpeg, act.args, env, null, onProc, function (ferr) {
        if (ferr) { cleanup(); return cb(ferr); }
        finish();
      });
    }

    // Build the post-process descriptor. For reencode formats we need codecs first.
    if (!audioOnly && vinfo.needsReencode && !(opts.clipEnabled && opts.endTime)) {
      probeCodec(ffprobe, src, 'v:0', env, function (vc) {
        probeCodec(ffprobe, src, 'a:0', env, function (ac) {
          applyAction(L.choosePostProcess({
            audioOnly: audioOnly, clipEnabled: opts.clipEnabled, startTime: opts.startTime, endTime: opts.endTime,
            needsReencode: vinfo.needsReencode, srcExt: srcExt, tgtExt: tgtExt, vcodec: vc, acodec: ac
          }, src, dest));
        });
      });
    } else {
      applyAction(L.choosePostProcess({
        audioOnly: audioOnly, clipEnabled: opts.clipEnabled, startTime: opts.startTime, endTime: opts.endTime,
        needsReencode: vinfo.needsReencode, srcExt: srcExt, tgtExt: tgtExt
      }, src, dest));
    }
  });
}

module.exports = { download: download };
```

- [ ] **Step 2: Smoke-test the module loads without error**

Run:
```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
node -e "const e=require('./panel/js/downloadEngine.js'); console.log(typeof e.download==='function' ? 'OK module loads' : 'BAD')"
```
Expected: `OK module loads`.

- [ ] **Step 3: Live smoke test (requires yt-dlp+ffmpeg on PATH, network)**

Run (downloads a short clip to /tmp):
```bash
node -e "
const e=require('./panel/js/downloadEngine.js');
e.download(
  { url:'https://www.youtube.com/watch?v=aqz-KE-bpKQ', outputDir:'/tmp/sg-test', quality:'sd', videoFormat:'mp4Premiere', clipEnabled:true, startTime:'00:00:00', endTime:'00:00:03' },
  { onProgress:(p,s)=>process.stdout.write('\r'+(p||'')+' '+s+'          ') },
  (err,res)=> err ? (console.error('\nERR',err.message),process.exit(1)) : console.log('\nOK',res)
);"
```
Expected: progress output, then `OK { path: '/tmp/sg-test/....mp4', size: '... MB' }`, and the file exists.
(If yt-dlp/ffmpeg aren't installed, this step is expected to print a clear "not found" error — that is also a valid pass for the error path. Proceed; full verification happens in Task 10 inside Premiere.)

- [ ] **Step 4: Commit**

```bash
git add panel/js/downloadEngine.js
git commit -m "feat(engine): add download orchestration (yt-dlp/ffmpeg spawn + post-process)"
```

---

## Task 6: hostscript.jsx (ExtendScript host)

ES3 — no modern JS. Returns strings; errors are `ERROR:`-prefixed (matches AudioExtractor convention).

**Files:**
- Create: `panel/jsx/hostscript.jsx`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * Smart Grab for Premiere — ExtendScript host (ES3).
 * Returns plain strings. Errors are prefixed with "ERROR:".
 */

function sg_getProjectDir() {
    try {
        if (!app.project) return "ERROR:No project open.";
        var p = app.project.path;
        if (!p || p === "") return "ERROR:Save the project first.";
        var f = new File(p);
        return f.parent.fsName;
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

function sg_findOrCreateBin(binName) {
    function deepSearch(folder) {
        if (folder && folder.name === binName && folder.type === 2) return folder;
        var kids = folder ? folder.children : null;
        if (kids) {
            for (var i = 0; i < kids.numItems; i++) {
                if (kids[i] && kids[i].type === 2) {
                    var found = deepSearch(kids[i]);
                    if (found) return found;
                }
            }
        }
        return null;
    }
    var bin = deepSearch(app.project.rootItem);
    if (!bin) {
        app.project.rootItem.createBin(binName);
        bin = deepSearch(app.project.rootItem);
    }
    return bin;
}

function sg_importToBin(filePath, binName) {
    try {
        if (!app.project) return "ERROR:No project open.";
        var bin = sg_findOrCreateBin(binName);
        if (!bin) return "ERROR:Could not create bin '" + binName + "'.";
        var ok = app.project.importFiles([filePath], true, bin, false);
        return ok ? "OK" : "ERROR:Import returned false.";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

function sg_pickFolder() {
    try {
        var f = Folder.selectDialog("Choose a download folder");
        if (!f) return "CANCEL";
        return f.fsName;
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}
```

- [ ] **Step 2: Verify it parses as ExtendScript (basic syntax check via Node)**

ExtendScript is ES3-ish; a rough syntax sanity check with Node catches gross errors:
```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
node --check panel/jsx/hostscript.jsx && echo "OK parses"
```
Expected: `OK parses`. (Full behavior is verified inside Premiere in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add panel/jsx/hostscript.jsx
git commit -m "feat(host): add ExtendScript for project dir, bin import, folder pick"
```

---

## Task 7: index.html + css/style.css (UI)

**Files:**
- Modify (replace): `panel/index.html`
- Create: `panel/css/style.css`

- [ ] **Step 1: Replace `panel/index.html` with the full panel markup**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Smart Grab</title>
  <link rel="stylesheet" href="./css/style.css">
</head>
<body>
  <!-- ===== MAIN VIEW ===== -->
  <div id="mainView">
    <div class="header">
      <span class="title">Smart Grab</span>
      <button id="settingsBtn" class="icon-btn" title="Settings">⚙</button>
    </div>

    <label class="field-label">Video URL</label>
    <div class="row">
      <input id="url" type="text" placeholder="https://youtube.com/watch?v=...">
      <button id="pasteBtn" class="icon-btn" title="Paste">⎘</button>
    </div>

    <div class="row two-col">
      <div>
        <label class="field-label">Quality</label>
        <select id="quality">
          <option value="best">Best available</option>
          <option value="uhd">4K (2160p)</option>
          <option value="fhd">1080p</option>
          <option value="hd">720p</option>
          <option value="sd">480p</option>
          <option value="audioOnly">Audio only</option>
        </select>
      </div>
      <div>
        <label class="field-label">Format</label>
        <select id="videoFormat">
          <option value="mp4Premiere">MP4 (Premiere)</option>
          <option value="mov">MOV</option>
          <option value="mkv">MKV (original)</option>
          <option value="mp4Raw">MP4 (no re-encode)</option>
        </select>
        <select id="audioFormat" class="hidden">
          <option value="mp3">MP3</option>
          <option value="m4a">M4A</option>
          <option value="wav">WAV</option>
          <option value="flac">FLAC</option>
        </select>
      </div>
    </div>

    <label class="checkbox">
      <input id="clipEnabled" type="checkbox"> Clip time range
    </label>
    <div id="clipRow" class="row two-col hidden">
      <div>
        <label class="field-label">Start</label>
        <input id="startTime" type="text" value="00:00:00">
      </div>
      <div>
        <label class="field-label">End</label>
        <input id="endTime" type="text" placeholder="00:01:30">
      </div>
    </div>

    <div class="dest-hint" id="destHint">Saving to: project folder</div>

    <div class="row">
      <button id="downloadBtn" class="primary">Download &amp; Import</button>
      <button id="cancelBtn" class="hidden">Cancel</button>
    </div>

    <div id="progressWrap" class="hidden">
      <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
      <div id="statusMsg" class="status"></div>
    </div>

    <div id="errorBox" class="error-box hidden">
      <div class="error-head">
        <span>Download Failed</span>
        <button id="copyErrBtn" class="icon-btn" title="Copy">⧉</button>
      </div>
      <pre id="errorDetail"></pre>
    </div>

    <div id="successBox" class="success-box hidden">
      <div id="successText"></div>
    </div>
  </div>

  <!-- ===== SETTINGS VIEW ===== -->
  <div id="settingsView" class="hidden">
    <div class="header">
      <span class="title">Settings</span>
      <button id="backBtn" class="icon-btn" title="Back">←</button>
    </div>

    <label class="field-label">Where to save downloads</label>
    <label class="radio"><input type="radio" name="mode" value="sync"> Sync to current project
      <span class="radio-sub">creates a "Downloaded Video" folder next to the .prproj</span>
    </label>
    <label class="radio"><input type="radio" name="mode" value="custom"> Custom folder
      <span class="radio-sub">always save to a fixed folder</span>
    </label>

    <div id="customRow" class="row hidden">
      <input id="customFolder" type="text" readonly placeholder="No folder chosen">
      <button id="chooseFolderBtn">Browse…</button>
    </div>

    <label class="field-label">Project bin name</label>
    <input id="binName" type="text" value="Downloaded Video">

    <hr>
    <button id="updateYtdlpBtn">Update yt-dlp</button>
    <div id="updateStatus" class="status"></div>

    <div class="row settings-actions">
      <button id="saveSettingsBtn" class="primary">Save</button>
    </div>
  </div>

  <script src="./js/CSInterface.js"></script>
  <script src="./js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `panel/css/style.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #1e1e1e; --surface: #2d2d2d; --border: #3d3d3d;
  --text: #e0e0e0; --text2: #8a8a8a; --accent: #8a5cf6; --accent2: #7a4ce6;
  --green: #4ec9b0; --red: #f44747;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg); color: var(--text);
  font-size: 12px; user-select: none; padding: 12px;
}
.hidden { display: none !important; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.title { font-size: 14px; font-weight: 600; }
.field-label { display: block; color: var(--text2); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin: 10px 0 4px; }
.row { display: flex; gap: 8px; align-items: flex-end; }
.row.two-col > div { flex: 1; }
input[type=text], select {
  width: 100%; background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; padding: 7px 8px; font-size: 12px;
}
input[readonly] { color: var(--text2); }
button {
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 12px; font-size: 12px; cursor: pointer;
}
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; flex: 1; }
button.primary:hover { background: var(--accent2); }
button:disabled { opacity: .4; cursor: not-allowed; }
.icon-btn { padding: 6px 9px; }
.checkbox, .radio { display: block; margin: 12px 0 4px; cursor: pointer; }
.radio { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.radio-sub { display: block; color: var(--text2); font-size: 10px; margin-top: 2px; margin-left: 18px; }
.dest-hint { color: var(--text2); font-size: 10px; margin: 10px 0; font-style: italic; }
.progress-track { width: 100%; height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; margin: 12px 0 6px; }
.progress-bar { height: 100%; width: 0; background: var(--accent); transition: width .15s; }
.status { color: var(--text2); font-size: 11px; min-height: 14px; word-break: break-all; }
.error-box { background: rgba(244,71,71,.08); border-radius: 8px; padding: 10px; margin-top: 12px; }
.error-head { display: flex; justify-content: space-between; color: var(--red); font-weight: 600; margin-bottom: 6px; }
.error-box pre { white-space: pre-wrap; word-break: break-all; font-family: monospace; font-size: 10px; color: var(--text2); max-height: 120px; overflow: auto; }
.success-box { background: rgba(78,201,176,.1); border-radius: 8px; padding: 10px; margin-top: 12px; color: var(--green); font-size: 11px; word-break: break-all; }
hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.settings-actions { margin-top: 16px; }
```

- [ ] **Step 3: Commit**

```bash
git add panel/index.html panel/css/style.css
git commit -m "feat(ui): add panel markup and styling (main + settings views)"
```

---

## Task 8: main.js (UI wiring)

**Files:**
- Create: `panel/js/main.js`

- [ ] **Step 1: Write the implementation**

```javascript
// panel/js/main.js
var cs = new CSInterface();
var extRoot = cs.getSystemPath(SystemPath.EXTENSION);
var engine = require(extRoot + '/js/downloadEngine.js');
var settingsMod = require(extRoot + '/js/settings.js');
var binaries = require(extRoot + '/js/binaries.js');

var $ = function (id) { return document.getElementById(id); };
var state = { settings: settingsMod.load(), proc: null };

// ---------- ExtendScript helpers ----------
function evalJSX(fnCall, cb) { cs.evalScript(fnCall, cb); }
function jsStr(s) { return JSON.stringify(String(s)); }

// ---------- View switching ----------
$('settingsBtn').addEventListener('click', function () { showSettings(); });
$('backBtn').addEventListener('click', function () { $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden'); });

// ---------- Quality => toggle audio/video format ----------
$('quality').addEventListener('change', function () {
  var audio = this.value === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
});

// ---------- Clip toggle ----------
$('clipEnabled').addEventListener('change', function () {
  $('clipRow').classList.toggle('hidden', !this.checked);
});

// ---------- Paste ----------
$('pasteBtn').addEventListener('click', function () {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function (t) { if (t) $('url').value = t.trim(); });
  }
});

// ---------- Restore last-used options ----------
function applySettingsToUI() {
  var s = state.settings;
  $('quality').value = s.lastQuality;
  $('videoFormat').value = s.lastVideoFormat;
  $('audioFormat').value = s.lastAudioFormat;
  var audio = s.lastQuality === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
  $('destHint').textContent = s.destinationMode === 'sync'
    ? 'Saving to: "' + s.binName + '" folder next to the project'
    : 'Saving to: ' + s.customFolder;
}

// ---------- Settings view ----------
function showSettings() {
  var s = state.settings;
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === s.destinationMode);
  $('customFolder').value = s.customFolder || '';
  $('binName').value = s.binName;
  $('customRow').classList.toggle('hidden', s.destinationMode !== 'custom');
  $('updateStatus').textContent = '';
  $('mainView').classList.add('hidden');
  $('settingsView').classList.remove('hidden');
}

(function wireSettings() {
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () {
      $('customRow').classList.toggle('hidden', this.value !== 'custom');
    });
  }
  $('chooseFolderBtn').addEventListener('click', function () {
    evalJSX('sg_pickFolder()', function (res) {
      if (res && res.indexOf('ERROR:') !== 0 && res !== 'CANCEL') $('customFolder').value = res;
    });
  });
  $('updateYtdlpBtn').addEventListener('click', function () {
    $('updateStatus').textContent = 'Updating yt-dlp…';
    $('updateYtdlpBtn').disabled = true;
    binaries.updateYtDlp(function (err, dest) {
      $('updateYtdlpBtn').disabled = false;
      $('updateStatus').textContent = err ? ('Update failed: ' + err.message) : ('Updated: ' + dest);
    });
  });
  $('saveSettingsBtn').addEventListener('click', function () {
    var mode = 'sync';
    var radios2 = document.getElementsByName('mode');
    for (var j = 0; j < radios2.length; j++) if (radios2[j].checked) mode = radios2[j].value;
    state.settings.destinationMode = mode;
    state.settings.customFolder = $('customFolder').value;
    state.settings.binName = $('binName').value || 'Downloaded Video';
    settingsMod.save(state.settings);
    applySettingsToUI();
    $('settingsView').classList.add('hidden');
    $('mainView').classList.remove('hidden');
  });
})();

// ---------- Download flow ----------
function setBusy(busy) {
  $('downloadBtn').disabled = busy;
  $('cancelBtn').classList.toggle('hidden', !busy);
}
function showError(msg) {
  $('errorDetail').textContent = msg;
  $('errorBox').classList.remove('hidden');
}
function clearOutputs() {
  $('errorBox').classList.add('hidden');
  $('successBox').classList.add('hidden');
  $('progressWrap').classList.remove('hidden');
}

$('copyErrBtn').addEventListener('click', function () {
  if (navigator.clipboard) navigator.clipboard.writeText($('errorDetail').textContent);
});
$('cancelBtn').addEventListener('click', function () {
  if (state.proc) { try { state.proc.kill(); } catch (e) {} }
  setBusy(false);
  $('statusMsg').textContent = 'Cancelled';
});

function resolveOutputDir(cb) {
  var s = state.settings;
  if (s.destinationMode === 'custom') {
    if (!s.customFolder) return cb(new Error('No custom folder set. Open Settings and choose one.'));
    return cb(null, s.customFolder);
  }
  // sync mode: project dir + bin-named subfolder
  evalJSX('sg_getProjectDir()', function (res) {
    if (!res || res.indexOf('ERROR:') === 0) return cb(new Error(res ? res.substring(6) : 'Could not read project.'));
    var sep = res.indexOf('\\') !== -1 ? '\\' : '/';
    cb(null, res + sep + s.binName);
  });
}

function persistLastOptions(opts) {
  state.settings.lastQuality = opts.quality;
  state.settings.lastVideoFormat = opts.videoFormat;
  state.settings.lastAudioFormat = opts.audioFormat;
  settingsMod.save(state.settings);
}

$('downloadBtn').addEventListener('click', function () {
  var url = $('url').value.replace(/^\s+|\s+$/g, '');
  if (!url) { showError('Enter a video URL first.'); return; }

  clearOutputs();
  setBusy(true);
  $('progressBar').style.width = '0%';
  $('statusMsg').textContent = 'Preparing…';

  resolveOutputDir(function (derr, outputDir) {
    if (derr) { setBusy(false); $('progressWrap').classList.add('hidden'); showError(derr.message); return; }

    var opts = {
      url: url, outputDir: outputDir, extRoot: extRoot,
      quality: $('quality').value,
      videoFormat: $('videoFormat').value,
      audioFormat: $('audioFormat').value,
      clipEnabled: $('clipEnabled').checked,
      startTime: $('startTime').value,
      endTime: $('endTime').value
    };
    persistLastOptions(opts);

    engine.download(opts, {
      onProgress: function (pct, status) {
        if (pct !== null && pct !== undefined) $('progressBar').style.width = pct + '%';
        if (status) $('statusMsg').textContent = status;
      },
      onProc: function (p) { state.proc = p; }
    }, function (err, res) {
      state.proc = null;
      setBusy(false);
      if (err) { $('progressWrap').classList.add('hidden'); showError(err.message); return; }

      $('statusMsg').textContent = 'Importing into project…';
      evalJSX('sg_importToBin(' + jsStr(res.path) + ', ' + jsStr(state.settings.binName) + ')', function (importRes) {
        $('progressWrap').classList.add('hidden');
        if (importRes === 'OK') {
          $('successText').textContent = 'Imported into "' + state.settings.binName + '" — ' + res.size;
          $('successBox').classList.remove('hidden');
        } else {
          showError('Downloaded to:\n' + res.path + '\n\nbut import failed:\n' + (importRes || 'unknown') + '\n\nDrag it in manually.');
        }
      });
    });
  });
});

// ---------- Init ----------
applySettingsToUI();
```

- [ ] **Step 2: Smoke-check braces/quoting with Node syntax check**

(main.js references browser/CEP globals, so it won't *run* in Node, but `--check` validates syntax.)
```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
node --check panel/js/main.js && echo "OK syntax"
```
Expected: `OK syntax`.

- [ ] **Step 3: Commit**

```bash
git add panel/js/main.js
git commit -m "feat(ui): wire panel to engine, import, settings, and yt-dlp updater"
```

---

## Task 9: install.command + dev-link.command

**Files:**
- Create: `install.command`
- Create: `dev-link.command`

- [ ] **Step 1: Create `install.command`**

```bash
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
```

- [ ] **Step 2: Create `dev-link.command` (symlink for live development)**

```bash
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
```

- [ ] **Step 3: Make both executable and verify they are valid bash**

```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
chmod +x install.command dev-link.command
bash -n install.command && bash -n dev-link.command && echo "OK both scripts parse"
```
Expected: `OK both scripts parse`.

- [ ] **Step 4: Commit**

```bash
git add install.command dev-link.command
git commit -m "feat(install): add copy installer (with binary fetch) and dev symlink script"
```

---

## Task 10: README + full integration verification in Premiere

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full Node test suite**

```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
npm test
```
Expected: all tests across `settings`, `engineLogic`, `binaries` PASS.

- [ ] **Step 2: Create `README.md`**

```markdown
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
```

- [ ] **Step 3: Install into Premiere and verify end-to-end (manual)**

```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
./install.command
```
Then in Premiere Pro:
1. Restart Premiere. Open/create a project and **save it**.
2. **Window ▸ Extensions ▸ Smart Grab** — panel appears.
3. Paste a short public URL, Quality = 480p, Format = MP4 (Premiere), enable Clip 00:00:00–00:00:05, **Download & Import**.
4. Verify: progress bar advances → success message → a "Downloaded Video" bin contains the clip → the file exists in `<projectDir>/Downloaded Video/`.
5. Switch Settings to **Custom folder**, pick a folder, download again → file lands there and still imports into the bin.
6. Edge cases: unsaved project in sync mode → "Save the project first."; invalid URL → clean copyable error; Cancel mid-download stops it.

Expected: all six pass. Record any failures and fix via `superpowers:systematic-debugging` before marking complete.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README and finalize v1"
```

---

## Self-Review

**1. Spec coverage**
- §2 Platform (CEP) → Task 1 manifest (`--enable-nodejs --mixed-context`). ✓
- §3 Architecture / module split → Tasks 2–8 (settings, engineLogic, binaries, downloadEngine, hostscript, ui, main). ✓
- §4 Download engine (format strings, formats, clip, decision tree, progress, cancel, error extraction) → Task 3 (logic) + Task 5 (orchestration incl. cancel via `onProc`/`kill`, ring-buffer error extraction). ✓
- §5 Destination modes + import (sync/custom, unsaved guard, find-or-create bin, importFiles signature) → Task 6 (jsx) + Task 8 (`resolveOutputDir`). ✓
- §6 Binaries (resolution order, installer fetch, ad-hoc sign + de-quarantine, updater) → Task 4 + Task 9. ✓
- §7 Settings (persisted JSON, fields, memory) → Task 2 + Task 8. ✓
- §8 Install (copy default, CSXS 11+12, quarantine, cfprefsd) → Task 9. ✓
- §9 Error handling (binary missing, non-zero exit, multi-file merge, unsaved, import false, retries) → Tasks 5/8 + retry flags in Task 3. ✓
- §10 Testing (unit on logic/resolution/settings; manual in Premiere) → Tasks 2/3/4 + Task 10. ✓
- §11 Out of scope respected (no Windows, no playlist, no notarization, no cookies, no timeline placement). ✓
- §12 File layout → matches Task file paths (note: spec's single `downloadEngine.js` is split into `engineLogic.js` + `downloadEngine.js` for testability — documented in this plan's File Structure). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step contains complete code; every command has expected output. ✓

**3. Type/name consistency:** ExtendScript fns `sg_getProjectDir` / `sg_importToBin` / `sg_pickFolder` used identically in `main.js`. Settings keys (`destinationMode`, `customFolder`, `binName`, `lastQuality`, `lastVideoFormat`, `lastAudioFormat`) consistent across `settings.js`, `main.js`. Engine option keys (`quality`, `videoFormat`, `audioFormat`, `clipEnabled`, `startTime`, `endTime`, `url`, `outputDir`, `extRoot`) consistent across `engineLogic.js`, `downloadEngine.js`, `main.js`. `choosePostProcess` descriptor `{ action, args }` consistent between Task 3 and Task 5. ✓
