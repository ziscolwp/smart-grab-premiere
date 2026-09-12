// panel/js/flow.js
// Resolver + helpers for Google Flow share links.
//
// Flow is Google's AI video tool. Its public "Share" links —
//   flow.google.com/shared/video/<uuid>            (current host)
//   labs.google/fx/tools/flow/shared/video/<uuid>  (old host, 301s to the new one)
// used to expose the clip as an og:video MP4, so yt-dlp's generic extractor
// could grab them untouched. Since the flow.google.com move the share page is
// client-rendered: the HTML carries no video at all, and yt-dlp fails with
// "Unsupported URL". The page's own JS fetches the clip from Flow's public
// getSharedMedia API (no login, no cookies — just the web API key that every
// share page embeds), which returns a signed MP4 URL on flow-content.google.
// This module does the same two GETs and hands that URL to the normal yt-dlp
// pipeline, which downloads it like any plain file. Clips come down as
// edit-ready H.264/AAC, audio intact.
//
// The API key is read from the share page at run time, never baked in: it is
// Google's public browser key and rotates with their deploys.
//
// Only the *share* link carries a video — the editor/project URL does not — so
// every helper returns ''/null/false for anything else, leaving yt-dlp's
// behaviour alone. The pure helpers are unit-tested; resolve() is network I/O
// (curl, like tiktok.resolve) and verified manually.
var childProcess = require('child_process');
var binaries = require('./binaries.js');

var SHARE_RE = /^https?:\/\/(?:flow\.google\.com|labs\.google\/fx\/tools\/flow)\/shared\/[^/?#]+\/([0-9a-fA-F-]{8,})/i;

// The share id (UUID) from a Flow share link, or '' for any other URL.
// e.g. .../shared/video/be83e530-... -> "be83e530-..."
function shareId(url) {
  var m = String(url || '').match(SHARE_RE);
  return m ? m[1] : '';
}

function isShareUrl(url) {
  return !!shareId(url);
}

// Canonical share page on the current host (old links redirect here anyway).
function pageUrl(url) {
  var id = shareId(url);
  return id ? 'https://flow.google.com/shared/video/' + id : null;
}

// The public web API key the share page embeds in its bootstrap data. Prefer
// the named slot the Flow frontend uses; fall back to any Google web key in
// the page. '' when the page has none (layout change — resolve() reports it).
function apiKeyFromHtml(html) {
  var s = String(html || '');
  var m = s.match(/"K21R3e"\s*:\s*"(AIza[0-9A-Za-z_-]{20,})"/) || s.match(/(AIza[0-9A-Za-z_-]{20,})/);
  return m ? m[1] : '';
}

// getSharedMedia endpoint for the share link, or null for any other URL.
function apiUrl(url, key) {
  var id = shareId(url);
  if (!id) return null;
  return 'https://aisandbox-pa.googleapis.com/v1/flowMedia/' + id + ':getSharedMedia?key=' + encodeURIComponent(String(key || ''));
}

// First line of the prompt, capped so the queue card stays readable.
function shortTitle(s) {
  if (typeof s !== 'string') return null;
  var line = s.split(/\r?\n/)[0].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (!line) return null;
  if (line.length <= 80) return line;
  var cut = line.slice(0, 80);
  var sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut) + '…';
}

// Parse the getSharedMedia JSON into the fields the pipeline needs, or null
// when the response is an API error, junk (HTML rate-limit page), an image
// share, or has no playable URL.
function parseSharedMedia(jsonText) {
  var j;
  try { j = JSON.parse(String(jsonText || '')); } catch (e) { return null; }
  if (!j || typeof j !== 'object' || j.error || !j.primaryMedia) return null;
  var pm = j.primaryMedia;
  var gv = pm.video && pm.video.generatedVideo;
  var videoUrl = gv && gv.fifeUrl;
  if (typeof videoUrl !== 'string' || !/^https?:/.test(videoUrl)) return null;
  var meta = pm.mediaMetadata || {};
  var len = pm.video.dimensions && pm.video.dimensions.length;   // "8s"
  var secs = typeof len === 'string' ? parseFloat(len) : NaN;
  function httpStr(v) { return (typeof v === 'string' && /^https?:/.test(v)) ? v : null; }
  return {
    videoUrl: videoUrl,
    id: (typeof j.mediaShareId === 'string' && j.mediaShareId) || null,
    title: shortTitle(meta.mediaTitle),
    durationSec: (secs > 0) ? secs : null,
    thumbnail: httpStr(meta.thumbnailUrl),
    uploader: (typeof j.modelDisplayName === 'string' && j.modelDisplayName) || null
  };
}

// A clean yt-dlp -o template for a Flow share link, or null for any other URL.
// The short id is the first 8 hex chars of the UUID — plenty to disambiguate a
// personal queue. (Without this the signed CDN URL would name the file after
// its query string.)
function outputTemplate(url) {
  var id = shareId(url);
  if (!id) return null;
  var short = id.replace(/-/g, '').slice(0, 8) || id;
  return 'Flow clip [' + short + '].%(ext)s';
}

// GET a URL with curl — the same tool the rest of the panel uses (CEP's
// bundled Node networking is unreliable; curl ships on macOS and Windows 10+).
// cb(err, bodyText).
function curlGet(url, cb) {
  var args = ['-fsSL', '--connect-timeout', '20', '--max-time', '40',
              '-A', 'Mozilla/5.0', url];
  var curl = childProcess.spawn(binaries.systemTool('curl'), args);
  var out = '', err = '', finished = false;
  // A failed spawn (ENOENT) emits 'error' AND 'close' — report exactly once,
  // or the caller would start two downloads for one queue row.
  function once(e, body) { if (finished) return; finished = true; cb(e, body); }
  curl.stdout.on('data', function (d) { out += d.toString(); if (out.length > 4e6) curl.kill(); });
  curl.stderr.on('data', function (d) { err += d.toString(); });
  curl.on('error', once);
  curl.on('close', function (code) {
    if (code !== 0) {
      var tail = err.split(/\r|\n/).filter(function (l) { return l; }).slice(-1)[0] || '';
      return once(new Error('curl ' + code + (tail ? ': ' + tail : '')));
    }
    once(null, out);
  });
}

// resolve(shareUrl, cb): share page -> API key -> getSharedMedia -> signed MP4.
// cb(err, info) where info is parseSharedMedia's. Errors say which step
// failed so the queue card can tell "unshared clip" from "page changed".
function resolve(shareUrl, cb) {
  var page = pageUrl(shareUrl);
  if (!page) return cb(new Error('Not a Flow share link.'));
  curlGet(page, function (perr, html) {
    if (perr) return cb(new Error('Flow share page unreachable (' + perr.message + ')'));
    var key = apiKeyFromHtml(html);
    if (!key) return cb(new Error('Flow share page changed — no API key found.'));
    curlGet(apiUrl(shareUrl, key), function (aerr, body) {
      // curl -f turns the API's 404 (unshared/deleted clip) into exit 22.
      if (aerr) return cb(new Error('Flow has no shared clip at this link (' + aerr.message + ')'));
      var info = parseSharedMedia(body);
      if (!info) return cb(new Error('Flow returned no downloadable video for this link.'));
      cb(null, info);
    });
  });
}

module.exports = {
  shareId: shareId,
  isShareUrl: isShareUrl,
  pageUrl: pageUrl,
  apiKeyFromHtml: apiKeyFromHtml,
  apiUrl: apiUrl,
  parseSharedMedia: parseSharedMedia,
  outputTemplate: outputTemplate,
  resolve: resolve
};
