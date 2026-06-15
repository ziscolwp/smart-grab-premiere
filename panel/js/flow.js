// panel/js/flow.js
// Helpers for Google Flow (labs.google) share links.
//
// Flow is Google's AI video tool. Its public "Share" links —
// labs.google/fx/tools/flow/shared/video/<uuid> — expose the clip as an
// og:video MP4, so yt-dlp's *generic* extractor downloads them with no special
// handling: no resolver and no URL swap (unlike tiktok.js). The clips come
// down as edit-ready H.264/AAC, audio intact, and import like any other source.
//
// The only gap is cosmetic: the generic extractor names the file after the bare
// UUID. These pure helpers give Flow clips a clean "Flow clip [id].mp4" name.
// Only the *share* link carries a video — the editor/project URL does not — so
// outputTemplate returns null for anything else, leaving yt-dlp's naming alone.
// All pure, no I/O — unit-tested.

// The share id (UUID) from a Flow share link, or '' for any other URL.
// e.g. .../shared/video/be83e530-... -> "be83e530-..."
function shareId(url) {
  var m = String(url || '').match(/\/shared\/[^/]+\/([0-9a-fA-F-]{8,})/);
  return m ? m[1] : '';
}

// A clean yt-dlp -o template for a Flow share link, or null for any other URL.
// The short id is the first 8 hex chars of the UUID — plenty to disambiguate a
// personal queue, and uniquePath() de-dupes on the rare collision.
function outputTemplate(url) {
  var id = shareId(url);
  if (!id) return null;
  var short = id.replace(/-/g, '').slice(0, 8) || id;
  return 'Flow clip [' + short + '].%(ext)s';
}

module.exports = {
  shareId: shareId,
  outputTemplate: outputTemplate
};
