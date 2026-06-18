const test = require('node:test');
const assert = require('node:assert');
const browserDetection = require('../panel/js/browserDetection.js');

function existsFrom(paths) {
  const found = new Set(paths.map((p) => p.toLowerCase()));
  return (p) => found.has(String(p).toLowerCase());
}

test('detectInstalledBrowsers returns only browsers present on Windows', () => {
  const detected = browserDetection.detectInstalledBrowsers({
    platform: 'win32',
    homeDir: 'C:\\Users\\editor',
    env: {
      LOCALAPPDATA: 'C:\\Users\\editor\\AppData\\Local',
      APPDATA: 'C:\\Users\\editor\\AppData\\Roaming',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)'
    },
    existsSync: existsFrom([
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Users\\editor\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data'
    ])
  });

  assert.deepStrictEqual(detected.map((b) => b.value), ['firefox', 'brave']);
});

test('detectInstalledBrowsers checks app bundles and profiles on macOS', () => {
  const detected = browserDetection.detectInstalledBrowsers({
    platform: 'darwin',
    homeDir: '/Users/editor',
    env: {},
    existsSync: existsFrom([
      '/Applications/Microsoft Edge.app',
      '/Users/editor/Library/Application Support/Firefox/Profiles'
    ])
  });

  assert.deepStrictEqual(detected.map((b) => b.value), ['firefox', 'edge']);
});

test('browser select options preserve a saved detected browser and omit missing browsers', () => {
  const html = browserDetection.browserOptionsHtml([
    { value: 'firefox', label: 'Firefox' },
    { value: 'brave', label: 'Brave' }
  ], 'brave');

  assert.match(html, /value="firefox"/);
  assert.match(html, /value="brave" selected/);
  assert.doesNotMatch(html, /value="chrome"/);
});

test('browser select options show a disabled empty state when none are detected', () => {
  const html = browserDetection.browserOptionsHtml([], 'firefox');

  assert.match(html, /No supported browsers found/);
  assert.match(html, /disabled/);
});

test('the no-arg production call is memoized for the session; clearBrowserCache resets it', () => {
  const a = browserDetection.detectInstalledBrowsers();
  const b = browserDetection.detectInstalledBrowsers();
  assert.strictEqual(a, b);                 // same cached reference — not re-stated
  browserDetection.clearBrowserCache();
  const c = browserDetection.detectInstalledBrowsers();
  assert.notStrictEqual(a, c);              // recomputed after clear
});

test('injected opts bypass the memo (tests stay deterministic)', () => {
  browserDetection.detectInstalledBrowsers();   // warm the no-arg cache
  const detected = browserDetection.detectInstalledBrowsers({
    platform: 'darwin', homeDir: '/Users/x', env: {},
    existsSync: (p) => p === '/Applications/Google Chrome.app'
  });
  assert.deepStrictEqual(detected.map((b) => b.value), ['chrome']);   // not served the cached no-arg result
  browserDetection.clearBrowserCache();
});
