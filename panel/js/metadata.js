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
