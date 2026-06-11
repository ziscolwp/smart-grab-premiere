// panel/js/metadata.js
// Title/duration/thumbnail + playlist expansion via yt-dlp (per-URL invocations for clean mapping).
var childProcess = require('child_process');
var binaries = require('./binaries.js');
var L = require('./engineLogic.js');
var tiktok = require('./tiktok.js');

var INFO_TEMPLATE = '%(title)s\t%(duration)s\t%(thumbnail)s\t%(extractor_key)s\t%(uploader)s';

function firstErrLine(err) {
  var lines = String(err).split(/\r?\n/).filter(function (l) { return l.indexOf('ERROR') !== -1; });
  return lines.length ? lines[lines.length - 1].replace(/^ERROR:\s*/, '') : '';
}

// Thin wrapper so metadata calls share the engine's cookie precedence rules.
function cookieArgs(cookiesBrowser, cookiesFile) {
  return L.cookieArgs(cookiesBrowser, cookiesFile);
}

// Pure: parse one INFO_TEMPLATE line into the info object (exported for tests).
function parseInfoLine(line, url) {
  var parts = String(line || '').split('\t');
  function val(i) { return (parts[i] && parts[i] !== 'NA') ? parts[i] : null; }
  var draw = parts[1];
  return {
    title: val(0) || url,
    durationSec: (draw && draw !== 'NA' && !isNaN(parseFloat(draw))) ? Math.round(parseFloat(draw)) : null,
    thumbnail: /^https?:/.test(val(2) || '') ? parts[2] : null,
    extractor: val(3),
    uploader: val(4)
  };
}

// opts: { extRoot, cookiesBrowser, cookiesFile, proxyUrl }.
// cb(err, { title, durationSec, thumbnail, extractor, uploader })
function fetchInfo(url, opts, cb) {
  opts = opts || {};
  var bin = binaries.resolveBinary('yt-dlp', { extRoot: opts.extRoot });
  if (!bin) return cb(new Error('yt-dlp not found'));
  var args = ['--no-playlist', '--no-warnings', '--print', INFO_TEMPLATE]
    .concat(cookieArgs(opts.cookiesBrowser, opts.cookiesFile))
    .concat(L.proxyArgs(opts.proxyUrl));
  args.push(url);
  var p = childProcess.spawn(bin, args, { env: binaries.augmentedEnv(process.env) });
  var out = '', err = '';
  p.stdout.on('data', function (d) { out += d.toString(); });
  p.stderr.on('data', function (d) { err += d.toString(); });
  p.on('error', cb);
  p.on('close', function (code) {
    if (code !== 0) {
      // Same ISP block as the download path: if yt-dlp can't reach a TikTok
      // URL, pull title/duration/thumbnail from the resolver so the queue row
      // still shows real info instead of the bare URL.
      if (tiktok.isTikTokUrl(url)) {
        return tiktok.resolve(url, function (rerr, info) {
          if (rerr || !info) return cb(new Error(firstErrLine(err) || ('yt-dlp exit ' + code)));
          cb(null, {
            title: info.title || url, durationSec: info.durationSec,
            thumbnail: info.thumbnail || null, extractor: 'TikTok', uploader: info.uploader || null
          });
        });
      }
      return cb(new Error(firstErrLine(err) || ('yt-dlp exit ' + code)));
    }
    cb(null, parseInfoLine(out.split(/\r?\n/)[0] || '', url));
  });
}

// opts: { extRoot, cookiesBrowser, cookiesFile, proxyUrl }. cb(err, [{ id, title, url }])
function expandPlaylist(url, opts, cb) {
  opts = opts || {};
  var bin = binaries.resolveBinary('yt-dlp', { extRoot: opts.extRoot });
  if (!bin) return cb(new Error('yt-dlp not found'));
  var args = ['--flat-playlist', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(url)s']
    .concat(cookieArgs(opts.cookiesBrowser, opts.cookiesFile))
    .concat(L.proxyArgs(opts.proxyUrl));
  args.push(url);
  var p = childProcess.spawn(bin, args, { env: binaries.augmentedEnv(process.env) });
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

// One-click cookies.txt creation: have yt-dlp read the browser's cookies once
// and write them to destPath. yt-dlp's exit code is unreliable here (the dummy
// extraction "fails" by design), so success = the file exists and is non-empty.
// opts: { extRoot, browser, destPath }. cb(err, destPath)
function exportCookies(opts, cb) {
  var fs = require('fs');
  var path = require('path');
  var bin = binaries.resolveBinary('yt-dlp', { extRoot: opts.extRoot });
  if (!bin) return cb(new Error('yt-dlp not found'));
  try {
    var dir = path.dirname(opts.destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(opts.destPath)) fs.rmSync(opts.destPath);
  } catch (e) { return cb(e); }
  var p = childProcess.spawn(bin, L.cookieExportArgs(opts.browser, opts.destPath),
    { env: binaries.augmentedEnv(process.env) });
  var err = '';
  p.stderr.on('data', function (d) { err += d.toString(); });
  p.on('error', cb);
  p.on('close', function () {
    var ok = false;
    try { ok = fs.existsSync(opts.destPath) && fs.statSync(opts.destPath).size > 0; } catch (e) {}
    if (ok) return cb(null, opts.destPath);
    var msg = firstErrLine(err) || 'No cookies could be read from ' + opts.browser + '.';
    // macOS blocks Safari's cookie store behind Full Disk Access — no tool can
    // read it without that grant, so steer users to a browser that works.
    if (/operation not permitted/i.test(msg)) {
      msg = 'macOS privacy protection blocks reading ' + opts.browser + ' cookies. Pick Chrome, Brave, or Firefox instead.';
    }
    cb(new Error(msg));
  });
}

module.exports = {
  fetchInfo: fetchInfo,
  expandPlaylist: expandPlaylist,
  exportCookies: exportCookies,
  parseInfoLine: parseInfoLine,
  cookieArgs: cookieArgs
};
