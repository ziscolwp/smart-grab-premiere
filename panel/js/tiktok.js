// panel/js/tiktok.js
// Fallback resolver for TikTok.
//
// yt-dlp's native TikTok extractor talks to tiktok.com and *.tiktokv.com.
// Some ISPs — notably in India, where TikTok is banned — block those by DNS
// poisoning *and* SNI filtering, so on those networks the panel cannot reach
// TikTok directly at any quality: every attempt is a connection reset or a
// timeout. This module asks a public resolver that runs outside the blocked
// region for a direct video URL on an unrelated CDN host (tiktokcdn-us.com),
// which the ISP does not block; the normal yt-dlp pipeline then fetches that
// URL like any other file. One HTTP GET, no VPN, no extra app to install.
//
// The pure helpers (isTikTokUrl / tikwmUrl / parseTikwm) are unit-tested.
// resolve() is network I/O, verified manually like binaries.downloadFile.
var childProcess = require('child_process');
var binaries = require('./binaries.js');

function isTikTokUrl(url) {
  return /tiktok\.com/i.test(String(url || ''));
}

// Per-session memory: once a native TikTok fetch fails and the mirror resolver
// saves the grab, we know this network blocks TikTok — so subsequent TikTok
// downloads skip the doomed native attempt and go straight to the mirror,
// saving the ~5s fail-fast probe each time. Cleared only by reopening the panel.
var networkBlocksTikTok = false;
function isBlocked() { return networkBlocksTikTok; }
function markBlocked() { networkBlocksTikTok = true; }
function resetBlocked() { networkBlocksTikTok = false; }

// tikwm.com: a long-running public TikTok resolver. hd=1 asks for the HD,
// watermark-free rendition; parseTikwm falls back to the other renditions.
function tikwmUrl(videoUrl) {
  return 'https://www.tikwm.com/api/?hd=1&url=' + encodeURIComponent(String(videoUrl || ''));
}

// Parse tikwm's JSON envelope into the fields the pipeline needs, or null when
// the response is an error, junk (HTML rate-limit page), or has no playable
// URL. Prefer HD, then no-watermark, then watermarked as a last resort.
function parseTikwm(jsonText) {
  var j;
  try { j = JSON.parse(jsonText); } catch (e) { return null; }
  if (!j || j.code !== 0 || !j.data) return null;
  var d = j.data;
  var videoUrl = d.hdplay || d.play || d.wmplay || null;
  if (typeof videoUrl !== 'string' || !/^https?:/.test(videoUrl)) return null;
  function str(v) { return (typeof v === 'string' && v) ? v : null; }
  function httpStr(v) { return (typeof v === 'string' && /^https?:/.test(v)) ? v : null; }
  return {
    videoUrl: videoUrl,
    id: str(d.id),
    title: str(d.title),
    durationSec: (typeof d.duration === 'number' && d.duration > 0) ? d.duration : null,
    thumbnail: httpStr(d.origin_cover) || httpStr(d.cover),
    uploader: (d.author && str(d.author.nickname)) || null
  };
}

// The resolved CDN URL has no title/id of its own, so yt-dlp's generic
// extractor would name the file after the URL's query string. Build a clean
// yt-dlp output template ("Title [id].%(ext)s") from the resolver metadata
// instead, matching the shape the native extractor produces. Strips the
// characters that would break a yt-dlp -o template (% sequences, path
// separators, newlines) and caps the stem length.
function safeStem(s) {
  var out = String(s == null ? '' : s)
    .replace(/[%\/\\\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, 80)
    .replace(/\s+$/g, '');
  return out || 'tiktok-video';
}

function idFor(info, url) {
  if (info && info.id) return String(info.id);
  var m = String(url || '').match(/\/video\/(\d+)/) || String(url || '').match(/(\d{8,})/);
  return m ? m[1] : '';
}

function outputTemplate(info, url) {
  var id = idFor(info, url);
  return safeStem(info && info.title) + (id ? ' [' + id + ']' : '') + '.%(ext)s';
}

// resolve(videoUrl, cb): GET the resolver JSON with curl — the same tool the
// rest of the panel uses (CEP's bundled Node networking is unreliable; curl
// ships on macOS and Windows 10+, and systemTool finds it by absolute path on
// Windows even with a broken PATH). cb(err, info) where info is parseTikwm's.
function resolve(videoUrl, cb) {
  var args = ['-fsSL', '--connect-timeout', '20', '--max-time', '40',
              '-A', 'Mozilla/5.0', tikwmUrl(videoUrl)];
  var curl = childProcess.spawn(binaries.systemTool('curl'), args);
  var out = '', err = '';
  curl.stdout.on('data', function (d) { out += d.toString(); if (out.length > 4e6) curl.kill(); });
  curl.stderr.on('data', function (d) { err += d.toString(); });
  curl.on('error', cb);
  curl.on('close', function (code) {
    if (code !== 0) {
      var tail = err.split(/\r|\n/).filter(function (l) { return l; }).slice(-1)[0] || '';
      return cb(new Error('TikTok resolver unreachable (curl ' + code + ')' + (tail ? ': ' + tail : '')));
    }
    var info = parseTikwm(out);
    if (!info) return cb(new Error('TikTok resolver returned no downloadable video.'));
    cb(null, info);
  });
}

module.exports = {
  isTikTokUrl: isTikTokUrl,
  tikwmUrl: tikwmUrl,
  parseTikwm: parseTikwm,
  outputTemplate: outputTemplate,
  resolve: resolve,
  isBlocked: isBlocked,
  markBlocked: markBlocked,
  resetBlocked: resetBlocked
};
