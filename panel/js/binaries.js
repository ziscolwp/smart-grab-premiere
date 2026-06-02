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
