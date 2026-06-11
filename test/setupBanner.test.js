const test = require('node:test');
const assert = require('node:assert');
const setupLogic = require('../panel/js/setupLogic.js');
const { createSetupBanner } = require('../panel/js/setupBanner.js');

// Minimal stand-ins for the DOM elements the banner touches.
function fakeEl() {
  const classes = new Set(['hidden']);
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    style: {},
    textContent: '',
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; }
  };
}

function fakeDeps(overrides) {
  const el = {
    banner: fakeEl(), text: fakeEl(), progress: fakeEl(),
    fill: fakeEl(), retryBtn: fakeEl()
  };
  const saved = [];
  const deps = {
    el,
    setupLogic,
    state: { settings: { ytDlpLastUpdate: 0 } },
    settingsMod: { save: (s) => saved.push(Object.assign({}, s)) },
    extRoot: '/EXT',
    now: () => 1750000000000,
    binaries: {
      resolveBinary: () => '/somewhere/bin', // nothing missing by default
      ensureAll: (root, onProgress, cb) => cb(null, { installed: [], failed: [] }),
      updateYtDlp: (cb) => cb(null, '/dest')
    }
  };
  Object.assign(deps.binaries, (overrides && overrides.binaries) || {});
  return { deps, el, saved };
}

test('init with nothing missing hides the banner', () => {
  const { deps, el } = fakeDeps();
  deps.state.settings.ytDlpLastUpdate = deps.now(); // fresh — no background update
  createSetupBanner(deps).init();
  assert.ok(el.banner.classList.contains('hidden'));
});

test('init with missing binaries auto-runs setup, shows progress, hides on success', () => {
  const calls = [];
  const { deps, el, saved } = fakeDeps({
    binaries: {
      resolveBinary: (name) => (name === 'yt-dlp' ? null : '/bin/' + name),
      ensureAll: (root, onProgress, cb) => {
        calls.push('ensureAll');
        onProgress({ label: 'yt-dlp', index: 1, total: 1, percent: 50 });
        assert.ok(!el.banner.classList.contains('hidden'));
        assert.ok(el.text.textContent.indexOf('yt-dlp') !== -1);
        assert.strictEqual(el.fill.style.width, '50%');
        cb(null, { installed: ['yt-dlp'], failed: [] });
      }
    }
  });
  createSetupBanner(deps).init();
  assert.deepStrictEqual(calls, ['ensureAll']);
  assert.ok(el.banner.classList.contains('hidden'));
  // installing yt-dlp stamps the staleness clock
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].ytDlpLastUpdate, deps.now());
});

test('failure shows the friendly message and a Retry button; retry re-runs setup', () => {
  let attempts = 0;
  const { deps, el } = fakeDeps({
    binaries: {
      resolveBinary: () => null,
      ensureAll: (root, onProgress, cb) => {
        attempts++;
        if (attempts === 1) cb(new Error('Couldn’t download yt-dlp — hit Retry.'), { installed: [], failed: ['yt-dlp'] });
        else cb(null, { installed: ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno'], failed: [] });
      }
    }
  });
  createSetupBanner(deps).init();
  assert.ok(!el.banner.classList.contains('hidden'));
  assert.ok(!el.retryBtn.classList.contains('hidden'));
  assert.ok(/retry/i.test(el.text.textContent));
  el.retryBtn.listeners.click();
  assert.strictEqual(attempts, 2);
  assert.ok(el.banner.classList.contains('hidden'));
});

test('stale yt-dlp triggers a silent background refresh and stamps the clock', () => {
  let updated = 0;
  const { deps, el, saved } = fakeDeps({
    binaries: { updateYtDlp: (cb) => { updated++; cb(null, '/dest'); } }
  });
  deps.state.settings.ytDlpLastUpdate = deps.now() - 15 * 24 * 60 * 60 * 1000;
  createSetupBanner(deps).init();
  assert.strictEqual(updated, 1);
  assert.ok(el.banner.classList.contains('hidden')); // silent — no UI
  assert.strictEqual(saved[0].ytDlpLastUpdate, deps.now());
});

test('fresh yt-dlp does not trigger a background refresh', () => {
  let updated = 0;
  const { deps } = fakeDeps({
    binaries: { updateYtDlp: (cb) => { updated++; cb(null); } }
  });
  deps.state.settings.ytDlpLastUpdate = deps.now() - 1000;
  createSetupBanner(deps).init();
  assert.strictEqual(updated, 0);
});

test('failed background refresh stays silent and does not stamp the clock', () => {
  const { deps, el, saved } = fakeDeps({
    binaries: { updateYtDlp: (cb) => cb(new Error('offline')) }
  });
  deps.state.settings.ytDlpLastUpdate = 1; // ancient
  createSetupBanner(deps).init();
  assert.ok(el.banner.classList.contains('hidden'));
  assert.strictEqual(saved.length, 0);
});
