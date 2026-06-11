// panel/js/binaries.js
// Locates yt-dlp/ffmpeg/ffprobe and keeps yt-dlp updatable. Cross-platform:
// every function takes an optional platform override so Windows behavior is
// testable from macOS (and vice versa).
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');

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

function defaultDirs(extRoot, platform) {
  var win = isWin(platform);
  var dirs = [];
  if (extRoot) dirs.push(path.join(extRoot, 'bin'));
  dirs.push(appSupportBin(platform));
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

function resolveBinary(name, opts) {
  opts = opts || {};
  var dirs = opts.dirs || defaultDirs(opts.extRoot, opts.platform);
  var isExec = opts.isExec || defaultIsExec;
  var names = candidateNames(name, opts.platform);
  for (var i = 0; i < dirs.length; i++) {
    for (var j = 0; j < names.length; j++) {
      var candidate = path.join(dirs[i], names[j]);
      if (isExec(candidate)) return candidate;
    }
  }
  return null;
}

function augmentedEnv(baseEnv, platform) {
  var env = {};
  baseEnv = baseEnv || process.env;
  for (var k in baseEnv) { if (baseEnv.hasOwnProperty(k)) env[k] = baseEnv[k]; }
  if (isWin(platform)) {
    env.PATH = appSupportBin(platform) + ';' + (env.PATH || '');
  } else {
    var existing = env.PATH || '/usr/bin:/bin';
    env.PATH = '/opt/homebrew/bin:/usr/local/bin:' + existing;
  }
  return env;
}

// Nightly channel: the README recommends it for regular users — extractor
// fixes for site breakage land there weeks before stable.
function ytDlpDownloadUrl(platform) {
  var base = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/';
  return base + (isWin(platform) ? 'yt-dlp.exe' : 'yt-dlp_macos');
}

// Real I/O — download latest yt-dlp into the user-writable app-support bin.
// Manually tested (network + signing). cb(err, destPath).
function updateYtDlp(cb) {
  var win = isWin();
  var binDir = appSupportBin();
  var dest = path.join(binDir, win ? 'yt-dlp.exe' : 'yt-dlp');
  try {
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  } catch (e) { return cb(e); }

  var curlBin = win ? 'curl.exe' : '/usr/bin/curl';
  var curl = childProcess.spawn(curlBin, ['-L', '--fail', '-o', dest, ytDlpDownloadUrl()]);
  var errOut = '';
  curl.stderr.on('data', function (d) { errOut += d.toString(); });
  curl.on('error', cb);
  curl.on('close', function (code) {
    if (code !== 0) return cb(new Error('Download failed (curl ' + code + '): ' + errOut));
    try {
      if (!win) {
        fs.chmodSync(dest, 0o755);
        // Gatekeeper would block an unsigned, quarantined binary.
        try { childProcess.spawnSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest]); } catch (e) {}
        try { childProcess.spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', dest]); } catch (e) {}
      }
      cb(null, dest);
    } catch (e) { cb(e); }
  });
}

module.exports = {
  resolveBinary: resolveBinary,
  defaultDirs: defaultDirs,
  candidateNames: candidateNames,
  augmentedEnv: augmentedEnv,
  appSupportBin: appSupportBin,
  ytDlpDownloadUrl: ytDlpDownloadUrl,
  updateYtDlp: updateYtDlp,
  APP_SUPPORT_BIN: APP_SUPPORT_BIN
};
