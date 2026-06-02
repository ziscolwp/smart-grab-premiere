# Smart Grab v2 — Queue + Slider Trim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-URL download queue (sequential, with titles + per-item progress, playlist expansion) and replace manual clip-time entry with a duration-driven dual-handle range slider.

**Architecture:** New pure modules (`timecode`, `urls`, `queueState`) are unit-tested; `metadata.js` wraps yt-dlp title/playlist fetch; `queue.js` is an injectable orchestrator (title-fetch pool → sequential download → import) unit-tested with fake workers; `rangeSlider.js` is an isolated DOM component. `main.js` wires them. The v1 download engine, ExtendScript import, settings, binaries, and clipboard modules are unchanged — the queue calls `engine.download()` then `sg_importToBin()` per item.

**Tech Stack:** CEP/Node (CommonJS), ExtendScript, yt-dlp, Node built-in test runner.

**Working dir:** `~/Ziscol Media Projects/smart-grab-premiere` (branch `feature/v2-queue-trim`).

---

## File Structure

```
panel/js/
├── timecode.js      (NEW, pure)  secondsToHMS, clampRange, parseFlexible
├── urls.js          (NEW, pure)  parse(text)->[url], classify(url)->type
├── queueState.js    (NEW, pure)  makeItem + immutable list transforms
├── metadata.js      (NEW, I/O)   fetchInfo(url,extRoot,cb), expandPlaylist(url,extRoot,cb)
├── queue.js         (NEW, orch)  createQueue(deps) — title pool + sequential downloads
├── rangeSlider.js   (NEW, DOM)   create(doc,container,duration,onChange)
├── main.js          (REWRITE)    textarea + Add + queue render + slider + paste-newline fix
├── (unchanged) engineLogic.js, downloadEngine.js, binaries.js, settings.js,
│                clipboard.js, editKeys.js, CSInterface.js
panel/index.html     (REWRITE)    multi-line URL, queue list, slider markup
panel/css/style.css  (APPEND)     queue + slider styles
test/
├── timecode.test.js   (NEW)
├── urls.test.js       (NEW)
├── queueState.test.js (NEW)
└── queue.test.js      (NEW, fake-worker orchestration tests)
```

`jsx/hostscript.jsx` is unchanged (already has `sg_importToBin`, `sg_getProjectDir`).

---

## Task 1: timecode.js — TDD

**Files:** Create `panel/js/timecode.js`; Test `test/timecode.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/timecode.test.js
const test = require('node:test');
const assert = require('node:assert');
const T = require('../panel/js/timecode.js');

test('secondsToHMS pads to HH:MM:SS', () => {
  assert.strictEqual(T.secondsToHMS(0), '00:00:00');
  assert.strictEqual(T.secondsToHMS(5), '00:00:05');
  assert.strictEqual(T.secondsToHMS(90), '00:01:30');
  assert.strictEqual(T.secondsToHMS(3661), '01:01:01');
  assert.strictEqual(T.secondsToHMS(636), '00:10:36');
});

test('secondsToHMS floors and guards negatives/NaN', () => {
  assert.strictEqual(T.secondsToHMS(90.9), '00:01:30');
  assert.strictEqual(T.secondsToHMS(-5), '00:00:00');
  assert.strictEqual(T.secondsToHMS(NaN), '00:00:00');
});

test('clampRange keeps 0 <= start <= end <= dur', () => {
  assert.deepStrictEqual(T.clampRange(10, 20, 100), { start: 10, end: 20 });
  assert.deepStrictEqual(T.clampRange(-5, 200, 100), { start: 0, end: 100 });
  assert.deepStrictEqual(T.clampRange(50, 30, 100), { start: 50, end: 50 }); // end<start -> end=start
});

test('parseFlexible: bare number is seconds', () => {
  assert.strictEqual(T.parseFlexible('90'), 90);
  assert.strictEqual(T.parseFlexible('5'), 5);
});
test('parseFlexible: colon / separator forms', () => {
  assert.strictEqual(T.parseFlexible('1:30'), 90);
  assert.strictEqual(T.parseFlexible('1:30:00'), 5400);
  assert.strictEqual(T.parseFlexible('1.30'), 90);
  assert.strictEqual(T.parseFlexible('0:05'), 5);
});
test('parseFlexible: natural language', () => {
  assert.strictEqual(T.parseFlexible('1m30s'), 90);
  assert.strictEqual(T.parseFlexible('2h'), 7200);
});
test('parseFlexible: invalid -> null', () => {
  assert.strictEqual(T.parseFlexible(''), null);
  assert.strictEqual(T.parseFlexible('abc'), null);
  assert.strictEqual(T.parseFlexible('1:2:3:4'), null);
});
```

- [ ] **Step 2: Run — expect FAIL** — `node --test test/timecode.test.js` → `Cannot find module`.

- [ ] **Step 3: Implement**

```javascript
// panel/js/timecode.js
function pad2(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }

function secondsToHMS(sec) {
  sec = Math.floor(Number(sec));
  if (isNaN(sec) || sec < 0) sec = 0;
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function clampRange(start, end, dur) {
  start = Math.max(0, Math.min(Math.round(start), dur));
  end = Math.max(0, Math.min(Math.round(end), dur));
  if (end < start) end = start;
  return { start: start, end: end };
}

function parseFlexible(str) {
  if (str == null) return null;
  var s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (/[hms]/.test(s)) {
    var nl = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!nl) return null;
    return (parseInt(nl[1] || '0', 10)) * 3600 + (parseInt(nl[2] || '0', 10)) * 60 + parseInt(nl[3] || '0', 10);
  }
  var parts = s.replace(/[.,\-_]/g, ':').split(':').filter(function (p) { return p !== ''; });
  if (parts.length === 0 || parts.length > 3) return null;
  for (var i = 0; i < parts.length; i++) { if (!/^\d+$/.test(parts[i])) return null; }
  var n = parts.map(function (p) { return parseInt(p, 10); });
  if (n.length === 1) return n[0];
  if (n.length === 2) return n[0] * 60 + n[1];
  return n[0] * 3600 + n[1] * 60 + n[2];
}

module.exports = { secondsToHMS: secondsToHMS, clampRange: clampRange, parseFlexible: parseFlexible };
```

- [ ] **Step 4: Run — expect PASS** — `node --test test/timecode.test.js`.
- [ ] **Step 5: Commit**

```bash
git add panel/js/timecode.js test/timecode.test.js
git commit -m "feat(timecode): add HH:MM:SS formatting, range clamp, flexible parse"
```

---

## Task 2: urls.js — TDD

**Files:** Create `panel/js/urls.js`; Test `test/urls.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/urls.test.js
const test = require('node:test');
const assert = require('node:assert');
const U = require('../panel/js/urls.js');

test('parse splits lines/whitespace and keeps only http(s)', () => {
  const text = 'https://a.com/1\n  https://b.com/2 \nnot a url\nhttp://c.com/3';
  assert.deepStrictEqual(U.parse(text), ['https://a.com/1', 'https://b.com/2', 'http://c.com/3']);
});
test('parse returns [] for empty', () => {
  assert.deepStrictEqual(U.parse(''), []);
  assert.deepStrictEqual(U.parse('   \n  '), []);
});

test('classify: watch / youtu.be => video', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/watch?v=abc'), 'video');
  assert.strictEqual(U.classify('https://youtu.be/abc'), 'video');
});
test('classify: watch with list still => video (single, safe default)', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/watch?v=abc&list=PL123'), 'video');
});
test('classify: pure playlist => playlist', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/playlist?list=PL123'), 'playlist');
});
test('classify: channel forms => channel', () => {
  assert.strictEqual(U.classify('https://www.youtube.com/@SomeHandle'), 'channel');
  assert.strictEqual(U.classify('https://www.youtube.com/channel/UC123'), 'channel');
});
test('classify: non-youtube http => video; non-url => invalid', () => {
  assert.strictEqual(U.classify('https://vimeo.com/123'), 'video');
  assert.strictEqual(U.classify('ftp://x'), 'invalid');
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```javascript
// panel/js/urls.js
function parse(text) {
  if (!text) return [];
  var out = [];
  var tokens = String(text).split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i].trim();
    if (/^https?:\/\//i.test(t)) out.push(t);
  }
  return out;
}

function classify(url) {
  if (!/^https?:\/\//i.test(url)) return 'invalid';
  var u = url.toLowerCase();
  var isYouTube = /(?:youtube\.com|youtu\.be)/.test(u);
  if (isYouTube) {
    if (/[?&]v=/.test(u) || /youtu\.be\//.test(u)) return 'video';   // watch?v=...&list=... stays single
    if (/\/playlist/.test(u) || /[?&]list=/.test(u)) return 'playlist';
    if (/\/@/.test(u) || /\/channel\//.test(u) || /\/c\//.test(u) || /\/user\//.test(u)) return 'channel';
    return 'video';
  }
  return 'video';
}

module.exports = { parse: parse, classify: classify };
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add panel/js/urls.js test/urls.test.js
git commit -m "feat(urls): parse pasted text into URLs and classify video/playlist/channel"
```

---

## Task 3: queueState.js — TDD

**Files:** Create `panel/js/queueState.js`; Test `test/queueState.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/queueState.test.js
const test = require('node:test');
const assert = require('node:assert');
const Q = require('../panel/js/queueState.js');

test('makeItem starts pending with defaults', () => {
  const it = Q.makeItem('id1', 'https://x/1', { quality: 'fhd' });
  assert.strictEqual(it.id, 'id1');
  assert.strictEqual(it.url, 'https://x/1');
  assert.strictEqual(it.status, 'pending');
  assert.strictEqual(it.title, null);
  assert.strictEqual(it.progress, 0);
  assert.deepStrictEqual(it.opts, { quality: 'fhd' });
});

test('add appends without mutating the original list', () => {
  const a = [Q.makeItem('1', 'u1', {})];
  const b = Q.add(a, [Q.makeItem('2', 'u2', {})]);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(b.length, 2);
});

test('setStatus updates only the target item and merges fields', () => {
  let list = [Q.makeItem('1', 'u1', {}), Q.makeItem('2', 'u2', {})];
  list = Q.setStatus(list, '2', 'queued', { title: 'Hello', durationSec: 100 });
  assert.strictEqual(list[0].status, 'pending');
  assert.strictEqual(list[1].status, 'queued');
  assert.strictEqual(list[1].title, 'Hello');
  assert.strictEqual(list[1].durationSec, 100);
});

test('nextQueued returns the first queued item, anyDownloading detects active', () => {
  let list = [Q.makeItem('1', 'u1', {}), Q.makeItem('2', 'u2', {}), Q.makeItem('3', 'u3', {})];
  list = Q.setStatus(list, '1', 'done', {});
  list = Q.setStatus(list, '2', 'queued', {});
  list = Q.setStatus(list, '3', 'queued', {});
  assert.strictEqual(Q.nextQueued(list).id, '2');
  assert.strictEqual(Q.anyDownloading(list), false);
  list = Q.setStatus(list, '2', 'downloading', {});
  assert.strictEqual(Q.anyDownloading(list), true);
});

test('firstWithStatus finds by status or null', () => {
  let list = [Q.makeItem('1', 'u1', {})];
  assert.strictEqual(Q.firstWithStatus(list, 'pending').id, '1');
  assert.strictEqual(Q.firstWithStatus(list, 'done'), null);
});

test('remove deletes by id; clearDone strips terminal states', () => {
  let list = [Q.makeItem('1', 'u1', {}), Q.makeItem('2', 'u2', {}), Q.makeItem('3', 'u3', {})];
  list = Q.setStatus(list, '1', 'done', {});
  list = Q.setStatus(list, '2', 'error', {});
  list = Q.remove(list, '3');
  assert.strictEqual(list.length, 2);
  list = Q.clearDone(list);
  assert.strictEqual(list.length, 0);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```javascript
// panel/js/queueState.js
function makeItem(id, url, opts) {
  return {
    id: id, url: url, title: null, durationSec: null,
    status: 'pending', progress: 0, statusMsg: '',
    opts: opts || {}, outputPath: null
  };
}

function add(list, items) { return list.concat(items); }

function update(list, id, fields) {
  return list.map(function (it) {
    return it.id === id ? Object.assign({}, it, fields) : it;
  });
}

function setStatus(list, id, status, fields) {
  return update(list, id, Object.assign({}, fields || {}, { status: status }));
}

function firstWithStatus(list, status) {
  for (var i = 0; i < list.length; i++) { if (list[i].status === status) return list[i]; }
  return null;
}

function nextQueued(list) { return firstWithStatus(list, 'queued'); }
function anyDownloading(list) { return !!firstWithStatus(list, 'downloading'); }
function remove(list, id) { return list.filter(function (it) { return it.id !== id; }); }
function clearDone(list) {
  return list.filter(function (it) {
    return it.status !== 'done' && it.status !== 'error' && it.status !== 'canceled';
  });
}

module.exports = {
  makeItem: makeItem, add: add, update: update, setStatus: setStatus,
  firstWithStatus: firstWithStatus, nextQueued: nextQueued,
  anyDownloading: anyDownloading, remove: remove, clearDone: clearDone
};
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add panel/js/queueState.js test/queueState.test.js
git commit -m "feat(queue): add pure immutable queue-state transforms"
```

---

## Task 4: metadata.js (yt-dlp title + playlist) — real-yt-dlp verification

**Files:** Create `panel/js/metadata.js`

- [ ] **Step 1: Implement**

```javascript
// panel/js/metadata.js
// Title/duration + playlist expansion via yt-dlp (per-URL invocations for clean mapping).
var childProcess = require('child_process');
var binaries = require('./binaries.js');

function firstErrLine(err) {
  var lines = String(err).split(/\r?\n/).filter(function (l) { return l.indexOf('ERROR') !== -1; });
  return lines.length ? lines[lines.length - 1].replace(/^ERROR:\s*/, '') : '';
}

// cb(err, { title, durationSec })
function fetchInfo(url, extRoot, cb) {
  var bin = binaries.resolveBinary('yt-dlp', { extRoot: extRoot });
  if (!bin) return cb(new Error('yt-dlp not found'));
  var p = childProcess.spawn(bin, ['--no-playlist', '--print', '%(title)s\t%(duration)s', url],
    { env: binaries.augmentedEnv(process.env) });
  var out = '', err = '';
  p.stdout.on('data', function (d) { out += d.toString(); });
  p.stderr.on('data', function (d) { err += d.toString(); });
  p.on('error', cb);
  p.on('close', function (code) {
    if (code !== 0) return cb(new Error(firstErrLine(err) || ('yt-dlp exit ' + code)));
    var line = (out.split(/\r?\n/)[0] || '');
    var parts = line.split('\t');
    var title = (parts[0] && parts[0] !== 'NA') ? parts[0] : url;
    var draw = parts[1];
    var durationSec = (draw && draw !== 'NA' && !isNaN(parseFloat(draw))) ? Math.round(parseFloat(draw)) : null;
    cb(null, { title: title, durationSec: durationSec });
  });
}

// cb(err, [{ id, title, url }])
function expandPlaylist(url, extRoot, cb) {
  var bin = binaries.resolveBinary('yt-dlp', { extRoot: extRoot });
  if (!bin) return cb(new Error('yt-dlp not found'));
  var p = childProcess.spawn(bin, ['--flat-playlist', '--print', '%(id)s\t%(title)s\t%(url)s', url],
    { env: binaries.augmentedEnv(process.env) });
  var out = '', err = '';
  p.stdout.on('data', function (d) { out += d.toString(); });
  p.stderr.on('data', function (d) { err += d.toString(); });
  p.on('error', cb);
  p.on('close', function (code) {
    var entries = out.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }).map(function (l) {
      var parts = l.split('\t');
      var id = parts[0] || '';
      var eurl = (parts[2] && /^https?:/.test(parts[2])) ? parts[2]
        : (id ? 'https://www.youtube.com/watch?v=' + id : '');
      return { id: id, title: (parts[1] && parts[1] !== 'NA') ? parts[1] : '', url: eurl };
    }).filter(function (e) { return e.url; });
    if (entries.length === 0) return cb(new Error(firstErrLine(err) || 'No videos found in playlist'));
    cb(null, entries);
  });
}

module.exports = { fetchInfo: fetchInfo, expandPlaylist: expandPlaylist };
```

- [ ] **Step 2: Verify against real yt-dlp (module loads + fetchInfo works)**

Run:
```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
node -e "
const m=require('./panel/js/metadata.js');
m.fetchInfo('https://www.youtube.com/watch?v=aqz-KE-bpKQ', '', (e,i)=>{
  if(e){console.error('ERR',e.message);process.exit(1);}
  console.log('OK', JSON.stringify(i));
});"
```
Expected: `OK {"title":"Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film","durationSec":635}` (title + numeric duration). If yt-dlp is missing it prints a clear "yt-dlp not found" — acceptable; full check happens in Premiere.

- [ ] **Step 3: Verify error path returns a clean message**

Run:
```bash
node -e "
const m=require('./panel/js/metadata.js');
m.fetchInfo('https://www.youtube.com/watch?v=zzzzzzzzzzz', '', (e,i)=> console.log(e ? ('ERR: '+e.message) : i));"
```
Expected: a line beginning `ERR:` mentioning unavailable.

- [ ] **Step 4: Commit**

```bash
git add panel/js/metadata.js
git commit -m "feat(metadata): fetch title+duration and expand playlists via yt-dlp"
```

---

## Task 5: queue.js orchestrator — TDD with fake workers

**Files:** Create `panel/js/queue.js`; Test `test/queue.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/queue.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createQueue } = require('../panel/js/queue.js');

function baseDeps(over) {
  let idc = 0;
  return Object.assign({
    extRoot: '/ext',
    makeId: () => 'q' + (++idc),
    onChange: () => {},
    fetchInfo: (url, cb) => cb(null, { title: 'T:' + url, durationSec: 100 }),
    resolveOutputDir: (opts, cb) => cb(null, '/out'),
    importFile: (path, cb) => cb(null),
    download: (opts, cbs, done) => { cbs.onProgress(50, 'half'); done(null, { path: '/out/f.mp4', size: '1 MB' }); },
    titleConcurrency: 2
  }, over || {});
}

test('synchronous fakes: all items reach done', () => {
  const q = createQueue(baseDeps());
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const items = q.getItems();
  assert.strictEqual(items.length, 2);
  assert.ok(items.every(i => i.status === 'done'));
  assert.strictEqual(items[0].title, 'T:a');
});

test('downloads run one at a time (sequential)', () => {
  const finishers = [];
  const q = createQueue(baseDeps({
    download: (opts, cbs, done) => { finishers.push(done); }   // never auto-finish
  }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  let items = q.getItems();
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 1);
  assert.strictEqual(items.filter(i => i.status === 'queued').length, 1);
  finishers[0](null, { path: '/out/a.mp4', size: '1 MB' });  // finish first
  items = q.getItems();
  assert.strictEqual(items.filter(i => i.status === 'done').length, 1);
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 1);
});

test('download error marks item error and advances to the next', () => {
  let n = 0;
  const q = createQueue(baseDeps({
    download: (opts, cbs, done) => { n++; n === 1 ? done(new Error('boom')) : done(null, { path: '/x', size: '1 MB' }); }
  }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const items = q.getItems();
  assert.strictEqual(items[0].status, 'error');
  assert.ok(items[0].statusMsg.indexOf('boom') !== -1);
  assert.strictEqual(items[1].status, 'done');
});

test('title fetch failure still queues the item (title falls back to URL)', () => {
  const q = createQueue(baseDeps({
    fetchInfo: (url, cb) => cb(new Error('private')),
  }));
  q.addUrls([{ url: 'a', opts: {} }]);
  const it = q.getItems()[0];
  assert.strictEqual(it.status, 'done');     // still downloaded
  assert.strictEqual(it.title, 'a');         // fell back to URL
});

test('cancel kills the active process and advances', () => {
  let killed = false;
  const finishers = [];
  const q = createQueue(baseDeps({
    download: (opts, cbs, done) => { cbs.onProc({ kill: () => { killed = true; } }); finishers.push(done); }
  }));
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  const firstId = q.getItems()[0].id;
  q.cancel(firstId);
  assert.strictEqual(killed, true);
  const items = q.getItems();
  assert.strictEqual(items[0].status, 'canceled');
  assert.strictEqual(items.filter(i => i.status === 'downloading').length, 1); // 'b' started
});

test('remove drops a non-active item; clearDone strips terminals', () => {
  const q = createQueue(baseDeps());        // sync -> both done
  q.addUrls([{ url: 'a', opts: {} }, { url: 'b', opts: {} }]);
  q.clearDone();
  assert.strictEqual(q.getItems().length, 0);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```javascript
// panel/js/queue.js
// Orchestrates a download queue: a title-fetch pool feeds a single sequential downloader.
// All I/O (fetchInfo/download/importFile/resolveOutputDir) is injected via deps so this is
// fully unit-testable with fakes. Holds the live item list; notifies the UI via deps.onChange.
var qs = require('./queueState.js');

function createQueue(deps) {
  var items = [];
  var fetching = 0;
  var CONC = deps.titleConcurrency || 4;
  var procs = {};   // id -> child process (kept out of item objects)

  function notify() { deps.onChange(items); }
  function setStatus(id, status, fields) { items = qs.setStatus(items, id, status, fields); notify(); }
  function update(id, fields) { items = qs.update(items, id, fields); notify(); }

  function addUrls(list) {
    var added = list.map(function (x) { return qs.makeItem(deps.makeId(), x.url, x.opts || {}); });
    items = qs.add(items, added);
    notify();
    pumpTitles();
    pumpDownloads();
  }

  function pumpTitles() {
    while (fetching < CONC) {
      var pend = qs.firstWithStatus(items, 'pending');
      if (!pend) break;
      items = qs.setStatus(items, pend.id, 'fetching-info'); notify();
      fetching++;
      (function (id, url) {
        deps.fetchInfo(url, function (err, info) {
          fetching--;
          if (err) { items = qs.setStatus(items, id, 'queued', { title: url, statusMsg: 'title unavailable' }); }
          else { items = qs.setStatus(items, id, 'queued', { title: info.title, durationSec: info.durationSec }); }
          notify();
          pumpTitles();
          pumpDownloads();
        });
      })(pend.id, pend.url);
    }
  }

  function pumpDownloads() {
    if (qs.anyDownloading(items)) return;
    var next = qs.nextQueued(items);
    if (!next) return;
    var id = next.id;
    items = qs.setStatus(items, id, 'downloading', { progress: 0, statusMsg: 'Starting…' }); notify();

    deps.resolveOutputDir(next.opts, function (derr, outputDir) {
      if (derr) { setStatus(id, 'error', { statusMsg: derr.message }); pumpDownloads(); return; }
      var dlOpts = Object.assign({}, next.opts, { url: next.url, outputDir: outputDir, extRoot: deps.extRoot });
      deps.download(dlOpts, {
        onProgress: function (pct, msg) {
          var fields = { statusMsg: msg || '' };
          if (pct !== null && pct !== undefined) fields.progress = pct;
          update(id, fields);
        },
        onProc: function (p) { procs[id] = p; }
      }, function (err, res) {
        delete procs[id];
        if (err) { setStatus(id, 'error', { statusMsg: err.message }); pumpDownloads(); return; }
        update(id, { statusMsg: 'Importing…', progress: 100 });
        deps.importFile(res.path, function (impErr) {
          setStatus(id, 'done', {
            outputPath: res.path,
            statusMsg: impErr ? ('Downloaded (import failed): ' + impErr.message) : (res.size || 'Done')
          });
          pumpDownloads();
        });
      });
    });
  }

  function cancel(id) {
    if (procs[id]) { try { procs[id].kill(); } catch (e) {} delete procs[id]; }
    items = qs.setStatus(items, id, 'canceled', { statusMsg: 'Canceled' }); notify();
    pumpDownloads();
  }

  function cancelAll() {
    for (var k in procs) { if (procs.hasOwnProperty(k)) { try { procs[k].kill(); } catch (e) {} } }
    procs = {};
    items = items.map(function (it) {
      var active = it.status === 'pending' || it.status === 'fetching-info' || it.status === 'queued' || it.status === 'downloading';
      return active ? Object.assign({}, it, { status: 'canceled', statusMsg: 'Canceled' }) : it;
    });
    notify();
  }

  function remove(id) {
    var it = qs.firstWithStatus(items, 'downloading');
    if (it && it.id === id) return; // can't remove the active download; cancel it first
    items = qs.remove(items, id); notify();
  }

  function clearDone() { items = qs.clearDone(items); notify(); }
  function getItems() { return items; }

  return {
    addUrls: addUrls, cancel: cancel, cancelAll: cancelAll,
    remove: remove, clearDone: clearDone, getItems: getItems
  };
}

module.exports = { createQueue: createQueue };
```

- [ ] **Step 4: Run — expect PASS** — `node --test test/queue.test.js`.
- [ ] **Step 5: Commit**

```bash
git add panel/js/queue.js test/queue.test.js
git commit -m "feat(queue): add injectable orchestrator (title pool + sequential downloads)"
```

---

## Task 6: rangeSlider.js (dual-handle slider component)

**Files:** Create `panel/js/rangeSlider.js`

- [ ] **Step 1: Implement**

```javascript
// panel/js/rangeSlider.js
// Dual-handle range slider for clip start/end (in seconds). DOM-coupled but isolated;
// `doc` is passed in so it has no hard global dependency.
var timecode = require('./timecode.js');

// create(doc, container, durationSec, onChange) -> { getRange: () => {start,end} }
function create(doc, container, durationSec, onChange) {
  container.innerHTML = '';
  durationSec = Math.max(1, Math.floor(durationSec || 1));

  var wrap = doc.createElement('div'); wrap.className = 'rs-wrap';
  var track = doc.createElement('div'); track.className = 'rs-track';
  var sel = doc.createElement('div'); sel.className = 'rs-sel';
  track.appendChild(sel);
  var startInput = doc.createElement('input');
  var endInput = doc.createElement('input');
  [startInput, endInput].forEach(function (inp) {
    inp.type = 'range'; inp.min = 0; inp.max = durationSec; inp.step = 1; inp.className = 'rs-input';
  });
  startInput.value = 0; endInput.value = durationSec;
  var labels = doc.createElement('div'); labels.className = 'rs-labels';
  var startLbl = doc.createElement('span'), lenLbl = doc.createElement('span'), endLbl = doc.createElement('span');
  labels.appendChild(startLbl); labels.appendChild(lenLbl); labels.appendChild(endLbl);

  wrap.appendChild(track); wrap.appendChild(startInput); wrap.appendChild(endInput); wrap.appendChild(labels);
  container.appendChild(wrap);

  function current() {
    return timecode.clampRange(parseInt(startInput.value, 10), parseInt(endInput.value, 10), durationSec);
  }

  function paint() {
    var s = parseInt(startInput.value, 10), e = parseInt(endInput.value, 10);
    if (s > e) { if (doc.activeElement === startInput) { e = s; endInput.value = e; } else { s = e; startInput.value = s; } }
    var leftPct = (s / durationSec) * 100, rightPct = (e / durationSec) * 100;
    sel.style.left = leftPct + '%';
    sel.style.width = (rightPct - leftPct) + '%';
    startLbl.textContent = 'Start ' + timecode.secondsToHMS(s);
    endLbl.textContent = 'End ' + timecode.secondsToHMS(e);
    lenLbl.textContent = 'Length ' + timecode.secondsToHMS(e - s);
    if (onChange) onChange(s, e);
  }

  startInput.addEventListener('input', paint);
  endInput.addEventListener('input', paint);
  paint();

  return { getRange: current };
}

module.exports = { create: create };
```

- [ ] **Step 2: Syntax check** — `node --check panel/js/rangeSlider.js` → `OK` (echo it).

- [ ] **Step 3: Commit**

```bash
git add panel/js/rangeSlider.js
git commit -m "feat(ui): add dual-handle range slider component for clip trim"
```

---

## Task 7: index.html + style.css (UI)

**Files:** Rewrite `panel/index.html`; Append to `panel/css/style.css`

- [ ] **Step 1: Rewrite `panel/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Smart Grab</title>
  <link rel="stylesheet" href="./css/style.css">
</head>
<body>
  <div id="mainView">
    <div class="header">
      <span class="title">Smart Grab</span>
      <button id="settingsBtn" class="icon-btn" title="Settings">⚙</button>
    </div>

    <label class="field-label">Video URL(s) — one per line</label>
    <div class="row">
      <textarea id="url" rows="3" placeholder="https://youtube.com/watch?v=...
https://youtube.com/watch?v=..."></textarea>
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

    <label class="checkbox"><input id="clipEnabled" type="checkbox"> Clip time range (single video)</label>
    <div id="clipRow" class="hidden">
      <div id="clipSlider"></div>
      <div id="clipManual" class="row two-col hidden">
        <div><label class="field-label">Start</label><input id="startTime" type="text" value="00:00:00"></div>
        <div><label class="field-label">End</label><input id="endTime" type="text" placeholder="00:01:30"></div>
      </div>
    </div>

    <div class="dest-hint" id="destHint">Saving to: project folder</div>

    <div class="row">
      <button id="addBtn" class="primary">Add to Queue</button>
    </div>
    <div id="topStatus" class="status"></div>

    <div class="queue-head">
      <span class="field-label">Queue</span>
      <span class="queue-actions">
        <button id="cancelAllBtn" class="mini">Cancel all</button>
        <button id="clearDoneBtn" class="mini">Clear done</button>
      </span>
    </div>
    <div id="queueList"><div class="empty">Nothing queued yet.</div></div>
  </div>

  <div id="settingsView" class="hidden">
    <div class="header">
      <span class="title">Settings</span>
      <button id="backBtn" class="icon-btn" title="Back">←</button>
    </div>
    <label class="field-label">Where to save downloads</label>
    <label class="radio"><input type="radio" name="mode" value="sync"> Sync to current project
      <span class="radio-sub">creates a "Downloaded Video" folder next to the .prproj</span></label>
    <label class="radio"><input type="radio" name="mode" value="custom"> Custom folder
      <span class="radio-sub">always save to a fixed folder</span></label>
    <div id="customRow" class="row hidden">
      <input id="customFolder" type="text" readonly placeholder="No folder chosen">
      <button id="chooseFolderBtn">Browse…</button>
    </div>
    <label class="field-label">Project bin name</label>
    <input id="binName" type="text" value="Downloaded Video">
    <hr>
    <button id="updateYtdlpBtn">Update yt-dlp</button>
    <div id="updateStatus" class="status"></div>
    <div class="row settings-actions"><button id="saveSettingsBtn" class="primary">Save</button></div>
  </div>

  <script src="./js/CSInterface.js"></script>
  <script src="./js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Append queue + slider styles to `panel/css/style.css`**

```css

/* ---- v2: textarea, queue, slider ---- */
textarea { width: 100%; resize: vertical; min-height: 54px; font-family: inherit;
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; padding: 7px 8px; font-size: 12px; -webkit-user-select: text; user-select: text; }
.mini { padding: 4px 8px; font-size: 10px; }
.queue-head { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 6px; }
.queue-actions { display: flex; gap: 6px; }
#queueList { display: flex; flex-direction: column; gap: 6px; }
#queueList .empty { color: var(--text2); font-style: italic; font-size: 11px; padding: 6px 0; }
.qitem { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.qitem.active { border-color: var(--accent); }
.qitem .qtop { display: flex; justify-content: space-between; gap: 8px; }
.qitem .qtitle { font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.qitem .qdur { color: var(--text2); font-size: 10px; flex-shrink: 0; }
.qitem .qmeta { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.qitem .qstatus { font-size: 10px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qitem .qstatus.error { color: var(--red); }
.qitem .qstatus.done { color: var(--green); }
.qitem .qbtn { background: none; border: none; color: var(--text2); cursor: pointer; padding: 2px 6px; font-size: 12px; }
.qitem .qbtn:hover { color: var(--red); }
.qitem .progress-track { margin: 6px 0 0; }

.rs-wrap { position: relative; padding: 4px 0 0; }
.rs-track { position: relative; height: 4px; background: var(--border); border-radius: 2px; margin: 16px 8px 0; }
.rs-sel { position: absolute; height: 100%; background: var(--accent); border-radius: 2px; }
.rs-input { position: absolute; left: 0; right: 0; top: 10px; width: 100%; margin: 0;
  background: none; pointer-events: none; -webkit-appearance: none; appearance: none; height: 16px; }
.rs-input::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; pointer-events: auto;
  width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); cursor: pointer; }
.rs-input::-webkit-slider-runnable-track { background: none; border: none; }
.rs-labels { display: flex; justify-content: space-between; font-size: 10px; color: var(--text2); margin: 8px 8px 0; }
```

- [ ] **Step 3: Commit**

```bash
git add panel/index.html panel/css/style.css
git commit -m "feat(ui): multi-line URL input, queue list, and clip slider markup"
```

---

## Task 8: main.js — wire textarea, playlist expand, slider, queue render

**Files:** Rewrite `panel/js/main.js`

- [ ] **Step 1: Rewrite `panel/js/main.js`**

```javascript
// panel/js/main.js
var cs = new CSInterface();
var extRoot = cs.getSystemPath(SystemPath.EXTENSION);
var engine = require(extRoot + '/js/downloadEngine.js');
var settingsMod = require(extRoot + '/js/settings.js');
var binaries = require(extRoot + '/js/binaries.js');
var clipboard = require(extRoot + '/js/clipboard.js');
var editKeys = require(extRoot + '/js/editKeys.js');
var timecode = require(extRoot + '/js/timecode.js');
var urls = require(extRoot + '/js/urls.js');
var metadata = require(extRoot + '/js/metadata.js');
var rangeSlider = require(extRoot + '/js/rangeSlider.js');
var queueMod = require(extRoot + '/js/queue.js');

var $ = function (id) { return document.getElementById(id); };
var state = { settings: settingsMod.load() };
var idCounter = 0;
var clip = { slider: null, durationSec: null, startSec: 0, endSec: 0 };

function evalJSX(fnCall, cb) { cs.evalScript(fnCall, cb); }
function jsStr(s) { return JSON.stringify(String(s)); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------- The queue ----------
function resolveOutputDir(opts, cb) {
  var s = state.settings;
  if (s.destinationMode === 'custom') {
    if (!s.customFolder) return cb(new Error('No custom folder set. Open Settings and choose one.'));
    return cb(null, s.customFolder);
  }
  evalJSX('sg_getProjectDir()', function (res) {
    if (!res || res.indexOf('ERROR:') === 0) return cb(new Error(res ? res.substring(6) : 'Could not read project.'));
    var sep = res.indexOf('\\') !== -1 ? '\\' : '/';
    cb(null, res + sep + s.binName);
  });
}
function importFile(path, cb) {
  evalJSX('sg_importToBin(' + jsStr(path) + ', ' + jsStr(state.settings.binName) + ')', function (r) {
    cb(r === 'OK' ? null : new Error(r || 'import failed'));
  });
}
var queue = queueMod.createQueue({
  extRoot: extRoot,
  makeId: function () { return 'q' + (++idCounter); },
  onChange: renderQueue,
  fetchInfo: function (url, cb) { metadata.fetchInfo(url, extRoot, cb); },
  resolveOutputDir: resolveOutputDir,
  importFile: importFile,
  download: engine.download,
  titleConcurrency: 4
});

function renderQueue(items) {
  var el = $('queueList');
  if (!items.length) { el.innerHTML = '<div class="empty">Nothing queued yet.</div>'; return; }
  el.innerHTML = '';
  items.forEach(function (it) {
    var row = document.createElement('div');
    row.className = 'qitem' + (it.status === 'downloading' ? ' active' : '');
    var dur = it.durationSec != null ? timecode.secondsToHMS(it.durationSec) : '';
    var statusClass = it.status === 'error' ? ' error' : (it.status === 'done' ? ' done' : '');
    var showProgress = it.status === 'downloading';
    var canRemove = it.status !== 'downloading';
    var btn = it.status === 'downloading'
      ? '<button class="qbtn" data-cancel="' + it.id + '" title="Cancel">✕</button>'
      : (canRemove ? '<button class="qbtn" data-remove="' + it.id + '" title="Remove">🗑</button>' : '');
    row.innerHTML =
      '<div class="qtop"><span class="qtitle">' + escHtml(it.title || it.url) + '</span>' +
      '<span class="qdur">' + dur + '</span></div>' +
      (showProgress ? '<div class="progress-track"><div class="progress-bar" style="width:' + (it.progress || 0) + '%"></div></div>' : '') +
      '<div class="qmeta"><span class="qstatus' + statusClass + '">' + escHtml(badge(it) ) + '</span>' + btn + '</div>';
    el.appendChild(row);
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-cancel]'), function (b) {
    b.addEventListener('click', function () { queue.cancel(b.getAttribute('data-cancel')); });
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-remove]'), function (b) {
    b.addEventListener('click', function () { queue.remove(b.getAttribute('data-remove')); });
  });
}
function badge(it) {
  switch (it.status) {
    case 'pending': return 'Waiting…';
    case 'fetching-info': return 'Getting title…';
    case 'queued': return 'Queued';
    case 'downloading': return it.statusMsg || 'Downloading…';
    case 'done': return '✓ ' + (it.statusMsg || 'Done');
    case 'error': return '⚠ ' + (it.statusMsg || 'Failed');
    case 'canceled': return 'Canceled';
    default: return it.status;
  }
}

// ---------- View switching ----------
$('settingsBtn').addEventListener('click', showSettings);
$('backBtn').addEventListener('click', function () { $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden'); });

// ---------- Quality => format toggle ----------
$('quality').addEventListener('change', function () {
  var audio = this.value === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
});

// ---------- Clip toggle => set up slider for the single URL ----------
$('clipEnabled').addEventListener('change', function () {
  $('clipRow').classList.toggle('hidden', !this.checked);
  if (this.checked) setupClip();
});
function singleUrlOrNull() {
  var list = urls.parse($('url').value);
  return list.length === 1 ? list[0] : null;
}
function setupClip() {
  $('clipSlider').innerHTML = '';
  $('clipManual').classList.add('hidden');
  clip.slider = null; clip.durationSec = null;
  var one = singleUrlOrNull();
  if (!one) { $('clipSlider').innerHTML = '<div class="empty">Add a single URL to trim it.</div>'; return; }
  $('clipSlider').innerHTML = '<div class="empty">Reading video length…</div>';
  metadata.fetchInfo(one, extRoot, function (err, info) {
    if (err || !info.durationSec) {
      $('clipSlider').innerHTML = '<div class="empty">Couldn\'t read length — enter manually:</div>';
      $('clipManual').classList.remove('hidden');
      return;
    }
    clip.durationSec = info.durationSec;
    clip.startSec = 0; clip.endSec = info.durationSec;
    clip.slider = rangeSlider.create(document, $('clipSlider'), info.durationSec, function (s, e) {
      clip.startSec = s; clip.endSec = e;
    });
  });
}

// ---------- Paste button + keyboard shortcuts ----------
$('pasteBtn').addEventListener('click', function () {
  var t = clipboard.read();
  if (t) $('url').value = t.replace(/^\s+|\s+$/g, '');
});
document.addEventListener('keydown', function (e) {
  var action = editKeys.editAction(e);
  if (!action) return;
  var el = document.activeElement;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
  var start = el.selectionStart == null ? el.value.length : el.selectionStart;
  var end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
  if (action === 'selectAll') { e.preventDefault(); el.select(); return; }
  if (action === 'copy') { e.preventDefault(); clipboard.write(el.value.slice(start, end)); return; }
  if (el.readOnly) return;
  if (action === 'paste') {
    e.preventDefault();
    var raw = clipboard.read();
    var clipText = el.tagName === 'INPUT' ? raw.replace(/[\r\n]+/g, '') : raw; // keep newlines in the URL textarea
    if (clipText) {
      var r = editKeys.applyPaste(el.value, start, end, clipText);
      el.value = r.value; el.setSelectionRange(r.caret, r.caret);
    }
  } else if (action === 'cut') {
    e.preventDefault();
    var c = editKeys.applyCut(el.value, start, end);
    clipboard.write(c.removed); el.value = c.value; el.setSelectionRange(c.caret, c.caret);
  }
});

// ---------- Settings ----------
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
function showSettings() {
  var s = state.settings;
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === s.destinationMode);
  $('customFolder').value = s.customFolder || '';
  $('binName').value = s.binName;
  $('customRow').classList.toggle('hidden', s.destinationMode !== 'custom');
  $('updateStatus').textContent = '';
  $('mainView').classList.add('hidden'); $('settingsView').classList.remove('hidden');
}
(function wireSettings() {
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () { $('customRow').classList.toggle('hidden', this.value !== 'custom'); });
  }
  $('chooseFolderBtn').addEventListener('click', function () {
    evalJSX('sg_pickFolder()', function (res) {
      if (res && res.indexOf('ERROR:') !== 0 && res !== 'CANCEL') $('customFolder').value = res;
    });
  });
  $('updateYtdlpBtn').addEventListener('click', function () {
    $('updateStatus').textContent = 'Updating yt-dlp…'; $('updateYtdlpBtn').disabled = true;
    binaries.updateYtDlp(function (err, dest) {
      $('updateYtdlpBtn').disabled = false;
      $('updateStatus').textContent = err ? ('Update failed: ' + err.message) : ('Updated: ' + dest);
    });
  });
  $('saveSettingsBtn').addEventListener('click', function () {
    var mode = 'sync', radios2 = document.getElementsByName('mode');
    for (var j = 0; j < radios2.length; j++) if (radios2[j].checked) mode = radios2[j].value;
    state.settings.destinationMode = mode;
    state.settings.customFolder = $('customFolder').value;
    state.settings.binName = $('binName').value || 'Downloaded Video';
    settingsMod.save(state.settings);
    applySettingsToUI();
    $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden');
  });
})();

// ---------- Build per-item options snapshot ----------
function currentOpts(allowClip) {
  var o = {
    quality: $('quality').value,
    videoFormat: $('videoFormat').value,
    audioFormat: $('audioFormat').value,
    clipEnabled: false
  };
  if (allowClip && $('clipEnabled').checked) {
    var startSec, endSec;
    if (clip.slider) { var r = clip.slider.getRange(); startSec = r.start; endSec = r.end; }
    else { startSec = timecode.parseFlexible($('startTime').value); endSec = timecode.parseFlexible($('endTime').value); }
    if (startSec != null && endSec != null && endSec > startSec) {
      o.clipEnabled = true;
      o.startTime = timecode.secondsToHMS(startSec);
      o.endTime = timecode.secondsToHMS(endSec);
    }
  }
  return o;
}
function persistLastOptions(o) {
  state.settings.lastQuality = o.quality;
  state.settings.lastVideoFormat = o.videoFormat;
  state.settings.lastAudioFormat = o.audioFormat;
  settingsMod.save(state.settings);
}

// ---------- Add to queue ----------
$('addBtn').addEventListener('click', function () {
  var list = urls.parse($('url').value);
  if (!list.length) { $('topStatus').textContent = 'Paste at least one video URL.'; return; }
  var single = list.length === 1;
  var opts = currentOpts(single);
  persistLastOptions(opts);

  var toAdd = [];
  var pending = list.length;
  $('topStatus').textContent = 'Adding…';

  function done() {
    pending--;
    if (pending === 0) {
      queue.addUrls(toAdd);
      $('topStatus').textContent = '';
      $('url').value = '';
      $('clipEnabled').checked = false; $('clipRow').classList.add('hidden');
    }
  }

  list.forEach(function (u) {
    var kind = urls.classify(u);
    if (kind === 'playlist' || kind === 'channel') {
      $('topStatus').textContent = 'Expanding playlist…';
      metadata.expandPlaylist(u, extRoot, function (err, entries) {
        if (err || !entries.length) { $('topStatus').textContent = 'Playlist error: ' + (err ? err.message : 'empty'); done(); return; }
        if (entries.length >= 50 && !window.confirm('This playlist has ' + entries.length + ' videos. Add all of them?')) { done(); return; }
        entries.forEach(function (en) { toAdd.push({ url: en.url, opts: { quality: opts.quality, videoFormat: opts.videoFormat, audioFormat: opts.audioFormat, clipEnabled: false } }); });
        done();
      });
    } else {
      toAdd.push({ url: u, opts: opts });
      done();
    }
  });
});
$('cancelAllBtn').addEventListener('click', function () { queue.cancelAll(); });
$('clearDoneBtn').addEventListener('click', function () { queue.clearDone(); });

// ---------- Init ----------
applySettingsToUI();
renderQueue(queue.getItems());
```

- [ ] **Step 2: Syntax check** — `node --check panel/js/main.js` → echo `OK main.js syntax`.

- [ ] **Step 3: Commit**

```bash
git add panel/js/main.js
git commit -m "feat(ui): wire multi-URL queue, playlist expand, and slider trim"
```

---

## Task 9: Full suite, browser render, Premiere verification, README

**Files:** Modify `README.md`

- [ ] **Step 1: Run the full test suite**

```bash
cd "$HOME/Ziscol Media Projects/smart-grab-premiere"
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: all pass (timecode, urls, queueState, queue, plus the v1 settings/engineLogic/binaries/editKeys suites).

- [ ] **Step 2: Browser-render the new UI (layout sanity)**

Add a temporary config to the global `~/.claude/launch.json` `configurations` array (preserve existing entries):
```json
{ "name": "smartgrab-panel", "runtimeExecutable": "python3", "runtimeArgs": ["-m", "http.server", "8099", "--directory", "/Users/ziscol/Ziscol Media Projects/smart-grab-premiere/panel"], "port": 8099 }
```
Start preview `smartgrab-panel`, screenshot the main view (textarea + Add + empty queue), toggle the clip checkbox via eval to confirm the slider area renders, then stop the server and remove the added config.

- [ ] **Step 3: Update `README.md` (Use section)**

Replace the `## Use` section of `README.md` with:
```markdown
## Use
1. Paste one or more video URLs (one per line) — or a playlist/channel link.
2. Pick quality / format. For a single video, tick **Clip** and drag the slider to trim.
3. **Add to Queue** — items show their title + length and download one at a time into the project.
```

- [ ] **Step 4: Install/refresh and verify in Premiere (manual)**

The panel is symlinked (dev-link), so the code is already live. In Premiere: close & reopen the **Smart Grab** panel (or restart Premiere), then verify:
1. Paste 2–3 URLs (one per line) → **Add** → each row shows a real **title + duration**, they download **one at a time**, progress advances, and each imports into the "Downloaded Video" bin.
2. **Clip a single video:** paste one URL, tick **Clip** → slider appears at the real length → drag start/end (labels update) → Add → the imported file is trimmed to that range.
3. Paste a **playlist** link → confirm prompt (if ≥50) → it expands into items.
4. **Cancel** an active item (stops it, moves to next); **Remove** a queued item; **Clear done**.
5. An invalid URL surfaces an error row without breaking the queue.

Record failures; fix via `superpowers:systematic-debugging` before completing.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document queue + slider trim in README"
```

---

## Self-Review

**1. Spec coverage**
- §3 Unified queue flow → Tasks 3 (state), 5 (orchestrator), 8 (Add + render). ✓
- §3 Queue item model → Task 3 `makeItem`. ✓
- §4 Slider trim (single-URL, duration-driven, manual fallback) → Tasks 1 (timecode), 6 (slider), 8 (`setupClip`, `currentOpts`). ✓
- §5 yt-dlp metadata (per-URL, title+duration, flat playlist) → Task 4. ✓
- §3 Playlist expansion + confirm ≥50 → Task 8 Add handler. ✓
- §6 Architecture/modules → Tasks 1–8; engine/import/settings untouched (queue injects `engine.download`, `importFile`). ✓
- §7 Error handling (title fail still queues, download error advances, cancel kills proc) → Task 5 tests + impl. ✓
- §8 Testing (unit on timecode/urls/queueState/queue; manual in Premiere) → Tasks 1,2,3,5,9. ✓
- §2 In-memory queue (no persistence) → queue holds list in closure, nothing written. ✓
- §2 Sequential processing → Task 5 `pumpDownloads` guards on `anyDownloading`; test "downloads run one at a time". ✓

**2. Placeholder scan:** No TBD/TODO. Every code step has complete code; the one `find` stray helper in Task 5 is explicitly called out for deletion with the exact line. Commands have expected output. ✓

**3. Type/name consistency:** `createQueue(deps)` deps keys (`extRoot, makeId, onChange, fetchInfo, resolveOutputDir, importFile, download, titleConcurrency`) match between Task 5 impl, Task 5 tests, and Task 8 wiring. Queue item fields (`id,url,title,durationSec,status,progress,statusMsg,opts,outputPath`) consistent across Tasks 3/5/8. `timecode.secondsToHMS/clampRange/parseFlexible`, `urls.parse/classify`, `metadata.fetchInfo(url,extRoot,cb)/expandPlaylist(url,extRoot,cb)`, `rangeSlider.create(doc,container,dur,onChange)→{getRange}` all used with matching signatures in `main.js`. Engine opts (`quality,videoFormat,audioFormat,clipEnabled,startTime,endTime,url,outputDir,extRoot`) unchanged from v1. ✓
