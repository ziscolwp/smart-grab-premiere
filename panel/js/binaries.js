// panel/js/binaries.js
// Locates yt-dlp/ffmpeg/ffprobe/deno and keeps them installed + updatable.
// Cross-platform: every pure function takes an optional platform override so
// Windows behavior is testable from macOS (and vice versa). Pure planning
// logic lives in setupLogic.js; this file is the I/O shell.
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var setupLogic = require('./setupLogic.js');

function isWin(platform) { return (platform || process.platform) === 'win32'; }

function appSupportBin(platform) {
  if (isWin(platform)) {
    var appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'SmartGrab', 'bin');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'SmartGrab', 'bin');
}

var APP_SUPPORT_BIN = appSupportBin();

function defaultIsExec(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

// Priority: the panel-managed app-support bin wins — it's the only place the
// panel can repair and auto-update, so a stale installer-bundled copy in
// panel/bin must never shadow it. Then the bundled bin, then system paths.
function defaultDirs(extRoot, platform) {
  var win = isWin(platform);
  var dirs = [appSupportBin(platform)];
  if (extRoot) dirs.push(path.join(extRoot, 'bin'));
  if (!win) dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  var envPath = (process.env.PATH || '');
  var parts = envPath.split(win ? ';' : ':');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] && dirs.indexOf(parts[i]) === -1) dirs.push(parts[i]);
  }
  return dirs;
}

// Candidate file names for a binary ("yt-dlp" -> ["yt-dlp.exe", "yt-dlp"] on Windows).
function candidateNames(name, platform) {
  if (!isWin(platform)) return [name];
  return /\.exe$/i.test(name) ? [name] : [name + '.exe', name];
}

// Session cache: resolveBinary is hit on every download and every metadata
// probe, and each call otherwise rebuilds defaultDirs (PATH split + O(n^2)
// dedupe over ~47 dirs) and stats candidates (accessSync + statSync). Keyed by
// name+extRoot+platform. Bypassed whenever dirs/isExec are injected so unit
// tests stay deterministic. Cleared on install/update/repair (paths change).
var resolveCache = {};
function clearBinaryCache() { resolveCache = {}; }

function resolveBinary(name, opts) {
  opts = opts || {};
  var cacheable = !opts.dirs && !opts.isExec;
  var key = cacheable ? JSON.stringify([name, opts.extRoot || '', opts.platform || process.platform]) : null;
  if (cacheable && resolveCache.hasOwnProperty(key)) return resolveCache[key];

  var dirs = opts.dirs || defaultDirs(opts.extRoot, opts.platform);
  var isExec = opts.isExec || defaultIsExec;
  var names = candidateNames(name, opts.platform);
  var found = null;
  for (var i = 0; i < dirs.length && !found; i++) {
    for (var j = 0; j < names.length; j++) {
      var candidate = path.join(dirs[i], names[j]);
      if (isExec(candidate)) { found = candidate; break; }
    }
  }
  if (cacheable) resolveCache[key] = found;
  return found;
}

function augmentedEnv(baseEnv, platform) {
  var env = {};
  baseEnv = baseEnv || process.env;
  for (var k in baseEnv) { if (baseEnv.hasOwnProperty(k)) env[k] = baseEnv[k]; }
  if (isWin(platform)) {
    env.PATH = appSupportBin(platform) + ';' + (env.PATH || '');
  } else {
    var existing = env.PATH || '/usr/bin:/bin';
    env.PATH = appSupportBin(platform) + ':/opt/homebrew/bin:/usr/local/bin:' + existing;
  }
  return env;
}

// Nightly channel: the README recommends it for regular users — extractor
// fixes for site breakage land there weeks before stable.
function ytDlpDownloadUrl(platform) {
  return setupLogic.binaryUrl('yt-dlp', isWin(platform) ? 'win32' : 'darwin', os.arch());
}

// ---------------------------------------------------------------------------
// Real I/O below — download/extract/install. Manually tested (network).
// ---------------------------------------------------------------------------

// curl/tar ship with macOS and Windows 10 1803+. On Windows prefer the
// System32 copy by absolute path — self-healing must survive a broken PATH.
function systemTool(name) {
  if (!isWin()) return '/usr/bin/' + name;
  var sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name + '.exe');
  try { if (fs.existsSync(sys32)) return sys32; } catch (e) {}
  return name + '.exe';
}

// Gatekeeper would block an unsigned, quarantined binary on macOS.
function blessMacBinary(p) {
  fs.chmodSync(p, 493 /* 0755 */);
  try { childProcess.spawnSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', p]); } catch (e) {}
  try { childProcess.spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', p]); } catch (e) {}
}

// curl ships with both macOS and Windows 10+. Downloads to dest.part first so
// a dropped connection can never leave a half-written "binary" shadowing a
// good one. onPercent (optional) gets 0-100 parsed from curl's progress bar.
function downloadFile(url, dest, onPercent, cb) {
  var part = dest + '.part';
  var curlBin = systemTool('curl');
  var args = ['-L', '--fail', '--retry', '2', '--connect-timeout', '20', '-#', '-o', part, url];
  var curl = childProcess.spawn(curlBin, args);
  var errOut = '';
  curl.stderr.on('data', function (d) {
    var s = d.toString();
    errOut += s;
    if (errOut.length > 4000) errOut = errOut.slice(-2000);
    var m = s.match(/(\d{1,3}(?:\.\d)?)%\s*$/);
    if (m && onPercent) onPercent(Math.min(100, parseFloat(m[1])));
  });
  curl.on('error', cb);
  curl.on('close', function (code) {
    if (code !== 0) {
      try { fs.rmSync(part, { force: true }); } catch (e) {}
      var tail = errOut.split(/\r|\n/).filter(function (l) { return l && l.indexOf('#') !== 0 && !/^\s*[\d.%\s]+$/.test(l); }).slice(-2).join(' ');
      return cb(new Error('Download failed (curl ' + code + ')' + (tail ? ': ' + tail : '')));
    }
    try { fs.renameSync(part, dest); cb(null, dest); } catch (e) { cb(e); }
  });
}

// bsdtar extracts zips and ships with macOS and Windows 10 1803+ — one code
// path for every archive we fetch.
function extractArchive(zipPath, destDir, cb) {
  var p = childProcess.spawn(systemTool('tar'), ['-xf', zipPath, '-C', destDir]);
  var errOut = '';
  p.stderr.on('data', function (d) { errOut += d.toString(); });
  p.on('error', cb);
  p.on('close', function (code) {
    if (code !== 0) return cb(new Error('Could not unpack archive (tar ' + code + '): ' + errOut.slice(0, 300)));
    cb(null);
  });
}

// Recursive search for wanted file names (the Windows ffmpeg zip nests
// binaries under ffmpeg-master-latest-win64-gpl/bin/).
function findFileIn(rootDir, fileName) {
  var stack = [rootDir];
  while (stack.length) {
    var dir = stack.pop();
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) stack.push(full);
      else if (entries[i].name.toLowerCase() === fileName.toLowerCase()) return full;
    }
  }
  return null;
}

function installedName(name) {
  return isWin() ? name + '.exe' : name;
}

// Run one plan step: download (and unpack) into binDir, then install every
// binary the step provides. cb(err).
function runStep(step, binDir, onPercent, cb) {
  if (!step.archive) {
    var dest = path.join(binDir, installedName(step.provides[0]));
    return downloadFile(step.url, dest, onPercent, function (err) {
      if (err) return cb(err);
      try { if (!isWin()) blessMacBinary(dest); } catch (e) { return cb(e); }
      cb(null);
    });
  }
  var stamp = Date.now().toString(36);
  var zipPath = path.join(binDir, '_dl-' + stamp + '.zip');
  var tmpDir = path.join(binDir, '_unpack-' + stamp);
  function cleanup() {
    try { fs.rmSync(zipPath, { force: true }); } catch (e) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
  downloadFile(step.url, zipPath, onPercent, function (err) {
    if (err) { cleanup(); return cb(err); }
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) { cleanup(); return cb(e); }
    extractArchive(zipPath, tmpDir, function (xerr) {
      if (xerr) { cleanup(); return cb(xerr); }
      try {
        for (var i = 0; i < step.provides.length; i++) {
          var wanted = installedName(step.provides[i]);
          var found = findFileIn(tmpDir, wanted);
          if (!found) throw new Error(wanted + ' was not inside the downloaded archive.');
          var target = path.join(binDir, wanted);
          try { fs.rmSync(target, { force: true }); } catch (e) {}
          fs.renameSync(found, target);
          if (!isWin()) blessMacBinary(target);
        }
        cleanup();
        cb(null);
      } catch (e) { cleanup(); cb(e); }
    });
  });
}

// The self-healing core. Checks which managed binaries are missing, downloads
// each one into the user-writable app-support bin, reports progress, and never
// rejects wholesale — partial success installs what it can and lists the rest.
// onProgress({ label, index, total, percent }); cb(err, { installed, failed })
// where err is non-null only if at least one download failed.
function ensureAll(extRoot, onProgress, cb) {
  var missing = [];
  for (var i = 0; i < setupLogic.REQUIRED.length; i++) {
    if (!resolveBinary(setupLogic.REQUIRED[i], { extRoot: extRoot })) missing.push(setupLogic.REQUIRED[i]);
  }
  installMissing(missing, onProgress, cb);
}

// Force-reinstall every managed binary (Settings "Repair" — fixes a present
// but corrupted binary that ensureAll would consider fine).
function repairAll(extRoot, onProgress, cb) {
  installMissing(setupLogic.REQUIRED.slice(), onProgress, cb);
}

function installMissing(missing, onProgress, cb) {
  onProgress = onProgress || function () {};
  var plan = setupLogic.downloadPlan(missing, process.platform, os.arch());
  var binDir = appSupportBin();
  if (!plan.length) return cb(null, { installed: [], failed: [] });
  try {
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  } catch (e) { return cb(e, { installed: [], failed: missing }); }

  var installed = [], failed = [];
  (function next(idx) {
    if (idx >= plan.length) {
      clearBinaryCache();   // freshly-installed paths must not be shadowed by a cached miss
      var err = failed.length ? new Error(setupLogic.failureMessage(failed)) : null;
      return cb(err, { installed: installed, failed: failed });
    }
    var step = plan[idx];
    onProgress({ label: step.label, index: idx + 1, total: plan.length, percent: 0 });
    runStep(step, binDir, function (pct) {
      onProgress({ label: step.label, index: idx + 1, total: plan.length, percent: pct });
    }, function (err) {
      var k;
      if (err) { for (k = 0; k < step.provides.length; k++) failed.push(step.provides[k]); }
      else { for (k = 0; k < step.provides.length; k++) installed.push(step.provides[k]); }
      next(idx + 1);
    });
  })(0);
}

// Download latest yt-dlp into the app-support bin. cb(err, destPath).
function updateYtDlp(cb) {
  var binDir = appSupportBin();
  var dest = path.join(binDir, installedName('yt-dlp'));
  try {
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  } catch (e) { return cb(e); }
  downloadFile(ytDlpDownloadUrl(), dest, null, function (err) {
    if (err) return cb(err);
    try {
      if (!isWin()) blessMacBinary(dest);
      clearBinaryCache();   // a cached 'missing' must not outlive the fresh install
      cb(null, dest);
    } catch (e) { cb(e); }
  });
}

module.exports = {
  resolveBinary: resolveBinary,
  clearBinaryCache: clearBinaryCache,
  defaultDirs: defaultDirs,
  candidateNames: candidateNames,
  augmentedEnv: augmentedEnv,
  appSupportBin: appSupportBin,
  ytDlpDownloadUrl: ytDlpDownloadUrl,
  updateYtDlp: updateYtDlp,
  ensureAll: ensureAll,
  repairAll: repairAll,
  systemTool: systemTool,
  APP_SUPPORT_BIN: APP_SUPPORT_BIN
};
