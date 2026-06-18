// panel/js/browserDetection.js
// Detect locally installed browsers that yt-dlp can read cookies from.
var fs = require('fs');
var os = require('os');
var path = require('path');

var SUPPORTED_BROWSERS = [
  { value: 'firefox', label: 'Firefox', paths: firefoxPaths },
  { value: 'chrome', label: 'Chrome', paths: chromePaths },
  { value: 'edge', label: 'Edge', paths: edgePaths },
  { value: 'brave', label: 'Brave', paths: bravePaths },
  { value: 'chromium', label: 'Chromium', paths: chromiumPaths },
  { value: 'opera', label: 'Opera', paths: operaPaths },
  { value: 'vivaldi', label: 'Vivaldi', paths: vivaldiPaths },
  { value: 'safari', label: 'Safari', paths: safariPaths }
];

function compact(items) {
  var out = [];
  for (var i = 0; i < items.length; i++) if (items[i]) out.push(items[i]);
  return out;
}

function winEnv(ctx, key, fallback) {
  return (ctx.env && ctx.env[key]) || fallback || '';
}

function appData(ctx) {
  return winEnv(ctx, 'APPDATA', ctx.win.join(ctx.homeDir, 'AppData', 'Roaming'));
}

function localAppData(ctx) {
  return winEnv(ctx, 'LOCALAPPDATA', ctx.win.join(ctx.homeDir, 'AppData', 'Local'));
}

function programFiles(ctx) {
  return winEnv(ctx, 'ProgramFiles', 'C:\\Program Files');
}

function programFilesX86(ctx) {
  return winEnv(ctx, 'ProgramFiles(x86)', 'C:\\Program Files (x86)');
}

function macApp(ctx, name) {
  return [
    ctx.posix.join('/Applications', name + '.app'),
    ctx.posix.join(ctx.homeDir, 'Applications', name + '.app')
  ];
}

function firefoxPaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(programFiles(ctx), 'Mozilla Firefox', 'firefox.exe'),
    ctx.win.join(programFilesX86(ctx), 'Mozilla Firefox', 'firefox.exe'),
    ctx.win.join(appData(ctx), 'Mozilla', 'Firefox', 'Profiles')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Firefox').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'Firefox', 'Profiles')
  ]);
  return [
    '/usr/bin/firefox',
    '/snap/bin/firefox',
    ctx.posix.join(ctx.homeDir, '.mozilla', 'firefox')
  ];
}

function chromePaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(localAppData(ctx), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ctx.win.join(programFiles(ctx), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ctx.win.join(programFilesX86(ctx), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ctx.win.join(localAppData(ctx), 'Google', 'Chrome', 'User Data')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Google Chrome').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'Google', 'Chrome')
  ]);
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    ctx.posix.join(ctx.homeDir, '.config', 'google-chrome')
  ];
}

function edgePaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(programFiles(ctx), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ctx.win.join(programFilesX86(ctx), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ctx.win.join(localAppData(ctx), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ctx.win.join(localAppData(ctx), 'Microsoft', 'Edge', 'User Data')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Microsoft Edge').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'Microsoft Edge')
  ]);
  return [
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    ctx.posix.join(ctx.homeDir, '.config', 'microsoft-edge')
  ];
}

function bravePaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(localAppData(ctx), 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ctx.win.join(programFiles(ctx), 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ctx.win.join(programFilesX86(ctx), 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ctx.win.join(localAppData(ctx), 'BraveSoftware', 'Brave-Browser', 'User Data')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Brave Browser').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
  ]);
  return [
    '/usr/bin/brave-browser',
    '/snap/bin/brave',
    ctx.posix.join(ctx.homeDir, '.config', 'BraveSoftware', 'Brave-Browser')
  ];
}

function chromiumPaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(localAppData(ctx), 'Chromium', 'Application', 'chrome.exe'),
    ctx.win.join(localAppData(ctx), 'Chromium', 'User Data')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Chromium').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'Chromium')
  ]);
  return [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    ctx.posix.join(ctx.homeDir, '.config', 'chromium')
  ];
}

function operaPaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(localAppData(ctx), 'Programs', 'Opera', 'opera.exe'),
    ctx.win.join(programFiles(ctx), 'Opera', 'launcher.exe'),
    ctx.win.join(programFilesX86(ctx), 'Opera', 'launcher.exe'),
    ctx.win.join(appData(ctx), 'Opera Software', 'Opera Stable')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Opera').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'com.operasoftware.Opera')
  ]);
  return [
    '/usr/bin/opera',
    '/usr/bin/opera-stable',
    ctx.posix.join(ctx.homeDir, '.config', 'opera')
  ];
}

function vivaldiPaths(ctx) {
  if (ctx.platform === 'win32') return compact([
    ctx.win.join(localAppData(ctx), 'Vivaldi', 'Application', 'vivaldi.exe'),
    ctx.win.join(programFiles(ctx), 'Vivaldi', 'Application', 'vivaldi.exe'),
    ctx.win.join(programFilesX86(ctx), 'Vivaldi', 'Application', 'vivaldi.exe'),
    ctx.win.join(localAppData(ctx), 'Vivaldi', 'User Data')
  ]);
  if (ctx.platform === 'darwin') return macApp(ctx, 'Vivaldi').concat([
    ctx.posix.join(ctx.homeDir, 'Library', 'Application Support', 'Vivaldi')
  ]);
  return [
    '/usr/bin/vivaldi',
    '/usr/bin/vivaldi-stable',
    ctx.posix.join(ctx.homeDir, '.config', 'vivaldi')
  ];
}

function safariPaths(ctx) {
  if (ctx.platform !== 'darwin') return [];
  return [
    '/Applications/Safari.app',
    '/System/Applications/Safari.app',
    ctx.posix.join(ctx.homeDir, 'Library', 'Safari')
  ];
}

function safeExists(existsSync, candidate) {
  try {
    return existsSync(candidate);
  } catch (e) {
    return false;
  }
}

// The no-arg production call stats ~30 browser paths; browsers don't appear or
// vanish mid-session, so memoize it (Settings can be opened repeatedly). Any
// injected opts (tests) bypass the cache so they stay deterministic.
var detectCache = null;
function clearBrowserCache() { detectCache = null; }

function detectInstalledBrowsers(opts) {
  var memoizable = !opts;
  if (memoizable && detectCache) return detectCache;
  opts = opts || {};
  var ctx = {
    platform: opts.platform || process.platform,
    env: opts.env || process.env,
    homeDir: opts.homeDir || os.homedir(),
    win: path.win32,
    posix: path.posix
  };
  var existsSync = opts.existsSync || fs.existsSync;
  var detected = [];
  for (var i = 0; i < SUPPORTED_BROWSERS.length; i++) {
    var browser = SUPPORTED_BROWSERS[i];
    var candidates = browser.paths(ctx);
    for (var j = 0; j < candidates.length; j++) {
      if (safeExists(existsSync, candidates[j])) {
        detected.push({ value: browser.value, label: browser.label });
        break;
      }
    }
  }
  if (memoizable) detectCache = detected;
  return detected;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function browserOptionsHtml(browsers, selected) {
  if (!browsers || browsers.length === 0) {
    return '<option value="" disabled selected>No supported browsers found</option>';
  }
  var selectedValue = selected;
  var hasSelected = false;
  for (var i = 0; i < browsers.length; i++) if (browsers[i].value === selected) hasSelected = true;
  if (!hasSelected) selectedValue = browsers[0].value;

  var html = [];
  for (var j = 0; j < browsers.length; j++) {
    var browser = browsers[j];
    html.push('<option value="' + escapeHtml(browser.value) + '"' +
      (browser.value === selectedValue ? ' selected' : '') + '>' +
      escapeHtml(browser.label) + '</option>');
  }
  return html.join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUPPORTED_BROWSERS: SUPPORTED_BROWSERS,
    detectInstalledBrowsers: detectInstalledBrowsers,
    clearBrowserCache: clearBrowserCache,
    browserOptionsHtml: browserOptionsHtml
  };
}
