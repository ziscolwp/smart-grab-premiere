# Smart Grab Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable queue recovery, resumable work state, safer output finalization, structured errors, health checks, and privacy-safe diagnostics.

**Architecture:** Keep new logic in focused modules. `queueStore.js` persists snapshots, `queueState.js` owns pure item transforms, `diagnostics.js` owns redaction/copy payloads, `binaries.js` owns health checks, and `downloadEngine.js` gets stable work dirs plus safer final output. `main.js` remains DOM wiring.

**Tech Stack:** CEP panel JavaScript, Node `fs/path/os/child_process`, `node:test`, existing `yt-dlp`/`ffmpeg` orchestration.

---

### Task 1: Queue Store + Rehydration

**Files:**
- Create: `panel/js/queueStore.js`
- Modify: `panel/js/queueState.js`
- Test: `test/queueStore.test.js`
- Test: `test/queueState.test.js`

- [ ] **Step 1: Write failing queue store tests**

Add `test/queueStore.test.js` with tests for missing file, round trip, corrupt JSON backup, and clear:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../panel/js/queueStore.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sg_queue_')); }

test('load returns an empty v1 snapshot when the file is missing', () => {
  const file = path.join(tmpDir(), 'queue.json');
  assert.deepStrictEqual(store.load(file), { version: 1, items: [] });
});

test('save then load round-trips queue items', () => {
  const file = path.join(tmpDir(), 'queue.json');
  assert.strictEqual(store.save({ version: 1, items: [{ id: 'q1', url: 'https://x.test' }] }, file), true);
  assert.strictEqual(store.load(file).items[0].id, 'q1');
});

test('load backs up corrupt JSON and returns an empty queue', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'queue.json');
  fs.writeFileSync(file, '{ bad', 'utf8');
  assert.deepStrictEqual(store.load(file), { version: 1, items: [] });
  assert.ok(fs.readdirSync(dir).some((name) => /^queue\.json\.bad-/.test(name)));
});

test('clear removes the queue file', () => {
  const file = path.join(tmpDir(), 'queue.json');
  store.save({ version: 1, items: [] }, file);
  assert.strictEqual(store.clear(file), true);
  assert.strictEqual(fs.existsSync(file), false);
});
```

Run: `node --test test/queueStore.test.js`
Expected: FAIL because `panel/js/queueStore.js` does not exist.

- [ ] **Step 2: Implement queueStore**

Create `panel/js/queueStore.js` with `DEFAULT_FILE`, `load(file)`, `save(snapshot,file)`, and `clear(file)`. Use `settings.DIR` for the default directory. Save atomically through `<file>.tmp`.

- [ ] **Step 3: Verify queue store**

Run: `node --test test/queueStore.test.js`

- [ ] **Step 4: Write failing rehydration tests**

Add tests to `test/queueState.test.js`:

```js
test('rehydrate resets live statuses to safe states', () => {
  const items = qs.rehydrate([
    { id: 'a', status: 'fetching-info', url: 'u' },
    { id: 'b', status: 'downloading', url: 'u', workDir: '/w' },
    { id: 'c', status: 'importing', url: 'u', outputPath: '/done.mp4' }
  ], { existsSync: (p) => p === '/done.mp4', now: () => 1000 });
  assert.strictEqual(items[0].status, 'pending');
  assert.strictEqual(items[1].status, 'canceled');
  assert.strictEqual(items[1].retryable, true);
  assert.strictEqual(items[2].status, 'done');
});

test('makeItem includes persistence fields', () => {
  const it = qs.makeItem('q1', 'https://x.test', {}, { now: () => 123, workDir: '/work/q1' });
  assert.strictEqual(it.attemptCount, 0);
  assert.strictEqual(it.workDir, '/work/q1');
  assert.deepStrictEqual(it.outputPaths, []);
});
```

Run: `node --test test/queueState.test.js`
Expected: FAIL because `rehydrate` and new fields are missing.

- [ ] **Step 5: Implement queue state transforms**

Update `makeItem(id,url,opts,extra)` to include `errorHint`, `errorCategory`, `retryable`, `attemptCount`, `workDir`, `outputPaths`, `createdAt`, and `updatedAt`. Add `isTerminalStatus`, `isActiveStatus`, `itemById`, and `rehydrate(items,deps)`.

- [ ] **Step 6: Verify task 1**

Run: `node --test test/queueStore.test.js test/queueState.test.js`

---

### Task 2: Structured Errors + Diagnostics

**Files:**
- Modify: `panel/js/errorHints.js`
- Create: `panel/js/diagnostics.js`
- Test: `test/errorHints.test.js`
- Test: `test/diagnostics.test.js`

- [ ] **Step 1: Write failing structured error tests**

Extend `test/errorHints.test.js`:

```js
test('friendly returns structured category, retryable flag, and action', () => {
  const r = E.friendly('ERROR: HTTP Error 429: Too Many Requests');
  assert.strictEqual(r.category, 'rate-limit');
  assert.strictEqual(r.retryable, true);
  assert.strictEqual(r.action, 'wait');
  assert.ok(r.message);
  assert.ok(r.hint);
});

test('friendly classifies missing ffmpeg as a tool repair action', () => {
  const r = E.friendly('ERROR: ffmpeg not found');
  assert.strictEqual(r.category, 'tool');
  assert.strictEqual(r.action, 'repair-tools');
});
```

Run: `node --test test/errorHints.test.js`
Expected: FAIL because the fields are not returned yet.

- [ ] **Step 2: Implement structured rules**

Add `category`, `retryable`, and `action` to every rule in `errorHints.js`. Keep `friendly(raw)` returning `null` for unknown errors and preserving existing `message`/`hint`.

- [ ] **Step 3: Verify structured errors**

Run: `node --test test/errorHints.test.js`

- [ ] **Step 4: Write failing diagnostics tests**

Add `test/diagnostics.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const diagnostics = require('../panel/js/diagnostics.js');

test('redact removes query strings, cookies, auth headers, and home paths', () => {
  const out = diagnostics.redact('https://x.test/v?id=secret Cookie: abc Authorization: Bearer tok /Users/editor/file.mp4', {
    homeDir: '/Users/editor'
  });
  assert.ok(out.indexOf('?<redacted>') !== -1);
  assert.ok(out.indexOf('Cookie: <redacted>') !== -1);
  assert.ok(out.indexOf('Authorization: <redacted>') !== -1);
  assert.ok(out.indexOf('~/file.mp4') !== -1);
});

test('buildItemDiagnostics emits safe item and tool context', () => {
  const text = diagnostics.buildItemDiagnostics({
    appVersion: '3.2.1',
    os: 'darwin arm64',
    item: { id: 'q1', url: 'https://x.test/watch?v=secret', status: 'error', attemptCount: 2, errorCategory: 'network', retryable: true, opts: { quality: 'fhd' }, outputPath: '/Users/editor/out/Clip.mp4' },
    tools: { ytdlp: { ok: true, version: '2026.06.12' } },
    lines: ['ERROR: token=secret Cookie: abc']
  }, { homeDir: '/Users/editor' });
  assert.ok(text.indexOf('Smart Grab: 3.2.1') !== -1);
  assert.ok(text.indexOf('Host: x.test') !== -1);
  assert.strictEqual(text.indexOf('v=secret'), -1);
  assert.strictEqual(text.indexOf('Cookie: abc'), -1);
});
```

Run: `node --test test/diagnostics.test.js`
Expected: FAIL because `diagnostics.js` does not exist.

- [ ] **Step 5: Implement diagnostics**

Create `diagnostics.js` with `redact(text, opts)`, `safeHost(url)`, `safeBasename(path)`, and `buildItemDiagnostics(data, opts)`.

- [ ] **Step 6: Verify task 2**

Run: `node --test test/errorHints.test.js test/diagnostics.test.js`

---

### Task 3: Binary Health Checks

**Files:**
- Modify: `panel/js/binaries.js`
- Test: `test/binaries.test.js`

- [ ] **Step 1: Write failing health tests**

Add tests using fake `resolveBinary` and fake `spawnSync`:

```js
test('checkHealth reports versions for runnable required tools and warning for missing deno', () => {
  const result = binaries.checkHealth({
    resolveBinary: (name) => name === 'deno' ? null : '/bin/' + name,
    spawnSync: (exe) => ({ status: 0, stdout: exe.indexOf('yt-dlp') !== -1 ? '2026.06.12\n' : 'ffmpeg version 8.1\n' })
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.tools.ytdlp.version, '2026.06.12');
  assert.strictEqual(result.tools.deno.ok, false);
  assert.strictEqual(result.tools.deno.optional, true);
});

test('checkHealth blocks when ffmpeg is missing', () => {
  const result = binaries.checkHealth({
    resolveBinary: (name) => name === 'ffmpeg' ? null : '/bin/' + name,
    spawnSync: () => ({ status: 0, stdout: 'ok\n' })
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.action, 'repair-tools');
});
```

Run: `node --test test/binaries.test.js`
Expected: FAIL because `checkHealth` is missing.

- [ ] **Step 2: Implement health check**

Add `checkHealth(opts)` to `binaries.js`. Use `resolveBinary`, `childProcess.spawnSync`, and per-tool version args. Required tools: `yt-dlp`, `ffmpeg`, `ffprobe`; optional: `deno`.

- [ ] **Step 3: Verify task 3**

Run: `node --test test/binaries.test.js`

---

### Task 4: Queue Persistence, Retry, And UI Actions

**Files:**
- Modify: `panel/js/queue.js`
- Modify: `panel/js/queueRender.js`
- Modify: `panel/js/main.js`
- Test: `test/queue.test.js`
- Test: `test/queueRender.test.js` if needed, otherwise extend existing render tests.

- [ ] **Step 1: Write failing queue persistence and cancel-guard tests**

Extend `test/queue.test.js`:

```js
test('createQueue rehydrates initial items and persists state changes', () => {
  const saved = [];
  const q = createQueue(baseDeps({
    initialItems: [{ id: 'old', url: 'a', status: 'queued', opts: {}, attemptCount: 1 }],
    persist: (items) => saved.push(items.map((it) => it.status).join(','))
  }));
  assert.strictEqual(q.getItems()[0].id, 'old');
  q.clearDone();
  assert.ok(saved.length > 0);
});

test('cancel before metadata returns prevents callback from requeueing the item', () => {
  let metadataCb;
  const q = createQueue(baseDeps({ fetchInfo: (url, cb) => { metadataCb = cb; } }));
  q.addUrls([{ url: 'a', opts: {} }]);
  const id = q.getItems()[0].id;
  q.cancel(id);
  metadataCb(null, { title: 'Late title' });
  assert.strictEqual(q.getItems()[0].status, 'canceled');
});

test('retry increments attempt count and clears structured error fields', () => {
  const q = createQueue(baseDeps({ download: (opts, cbs, done) => done(Object.assign(new Error('nope'), { category: 'network', retryable: true })) }));
  q.addUrls([{ url: 'a', opts: {} }]);
  const id = q.getItems()[0].id;
  q.retry(id);
  assert.ok(q.getItems()[0].attemptCount >= 1);
});
```

Run: `node --test test/queue.test.js`
Expected: FAIL because the new options/guards are missing.

- [ ] **Step 2: Implement queue persistence hooks**

Update `createQueue(deps)` to accept `initialItems`, `persist(items)`, `makeWorkDir(id)`, and `now()`. Persist after state changes. Guard callbacks by current item status. Store `errorCategory`/`retryable` from download errors. Keep download concurrency at one.

- [ ] **Step 3: Verify queue behavior**

Run: `node --test test/queue.test.js`

- [ ] **Step 4: Write failing render test for diagnostics/resume**

Extend queue render tests or add a small test:

```js
test('itemHtml shows Copy diagnostics for failed items and Resume for retryable partials', () => {
  const html = queueRender.itemHtml({ id: 'q1', status: 'error', url: 'https://x.test', title: 'X', retryable: true, workDirHasPartials: true, errorHint: 'try again' });
  assert.ok(html.indexOf('data-act="retry"') !== -1);
  assert.ok(html.indexOf('title="Resume"') !== -1);
  assert.ok(html.indexOf('data-act="diagnostics"') !== -1);
});
```

Run the queue render test file.
Expected: FAIL until render actions exist.

- [ ] **Step 5: Implement row actions and main wiring**

Add diagnostics button rendering. In `main.js`, load queue snapshot with `queueStore.load()`, pass `initialItems`, save with `queueStore.save()`, assign `workDir` via `queueStore.workDirFor(id)` or a local helper, and handle `diagnostics(id)` by writing `diagnostics.buildItemDiagnostics(...)` to the clipboard.

- [ ] **Step 6: Verify task 4**

Run: `node --test test/queue.test.js test/queueRender.test.js`

---

### Task 5: Download Engine Work Dirs, Line Buffering, And Safe Output

**Files:**
- Modify: `panel/js/downloadEngine.js`
- Modify: `panel/js/engineLogic.js`
- Test: `test/engineLogic.test.js`

- [ ] **Step 1: Write failing pure helper tests**

Add tests to `test/engineLogic.test.js`:

```js
test('createLineEmitter buffers partial lines across chunks', () => {
  const lines = [];
  const emit = L.createLineEmitter((line) => lines.push(line));
  emit.feed(Buffer.from('SG|  1'));
  emit.feed(Buffer.from('0.0%|a|b\nnext'));
  emit.close();
  assert.deepStrictEqual(lines, ['SG|  10.0%|a|b', 'next']);
});

test('uniquePath appends numeric suffix before extension', () => {
  const taken = new Set(['/out/Clip.mp4', '/out/Clip 2.mp4']);
  const p = L.uniquePath('/out/Clip.mp4', (x) => taken.has(x));
  assert.strictEqual(p, '/out/Clip 3.mp4');
});

test('partialOutputPath appends smartgrab part suffix', () => {
  assert.strictEqual(L.partialOutputPath('/out/Clip.mp4'), '/out/Clip.mp4.smartgrab-part');
});
```

Run: `node --test test/engineLogic.test.js`
Expected: FAIL because helpers do not exist.

- [ ] **Step 2: Implement pure helpers**

Add `createLineEmitter(onLine)`, `uniquePath(targetPath, existsSync)`, and `partialOutputPath(targetPath)` to `engineLogic.js`.

- [ ] **Step 3: Verify helpers**

Run: `node --test test/engineLogic.test.js`

- [ ] **Step 4: Integrate helpers in downloadEngine**

Use `opts.workDir || os.tmpdir()` stable directory selection, use line emitter in `run()`, set error `category` and `retryable` from `errorHints.friendly`, write ffmpeg outputs to `.smartgrab-part`, unique final destination before move/remux/reencode, and preserve work dir on retryable/canceled failures when `opts.preserveWorkDir` is true.

- [ ] **Step 5: Verify task 5**

Run: `npm test`

---

### Task 6: Review And Final Verification

- [ ] **Step 1: Run full automated verification**

Run: `npm test`

- [ ] **Step 2: Run diff checks**

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 3: Code review pass**

Run a review-focused pass over the implementation. Prioritize cancellation races, queue persistence corruption, secrets in diagnostics, destructive output moves, and Windows/macOS path behavior.

- [ ] **Step 4: Commit implementation**

Run: `git add panel/js test docs/superpowers/plans/2026-06-13-smart-grab-robustness.md && git commit -m "feat: harden downloader queue and diagnostics"`
