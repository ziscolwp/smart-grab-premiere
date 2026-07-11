// panel/js/setupLogic.js
// Pure logic for the self-healing setup: which binaries we manage, where each
// one downloads from per platform/arch, how missing ones become an ordered
// download plan, and when yt-dlp counts as stale. No I/O here — the shell
// lives in binaries.js (same pattern as engineLogic.js / downloadEngine.js).

// Download order doubles as priority: yt-dlp is the product, ffmpeg/ffprobe
// make results editable, deno is optional (YouTube JS-challenge support).
var REQUIRED = ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno'];
var OPTIONAL = ['deno'];

var STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// URLs proven in install.command / install.ps1 (verified live 2026-06-11/12).
function binaryUrl(name, platform, arch) {
  var win = platform === 'win32';
  var arm = arch === 'arm64';
  if (name === 'yt-dlp') {
    return 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/'
      + (win ? 'yt-dlp.exe' : 'yt-dlp_macos');
  }
  if (name === 'ffmpeg' || name === 'ffprobe') {
    if (win) return 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';
    if (arm) return 'https://www.osxexperts.net/' + (name === 'ffmpeg' ? 'ffmpeg81arm.zip' : 'ffprobe81arm.zip');
    return 'https://evermeet.cx/ffmpeg/getrelease/' + name + '/zip';
  }
  if (name === 'deno') {
    var triple = win ? 'x86_64-pc-windows-msvc' : (arm ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin');
    return 'https://github.com/denoland/deno/releases/latest/download/deno-' + triple + '.zip';
  }
  return null;
}

// missing -> ordered steps: { label, url, archive, provides }. On Windows
// ffmpeg and ffprobe ship in one zip, so they collapse into a single step
// that only re-extracts the binaries actually missing (never overwrite a
// working, possibly in-use exe).
function downloadPlan(missing, platform, arch) {
  var plan = [];
  for (var i = 0; i < REQUIRED.length; i++) {
    var name = REQUIRED[i];
    if (missing.indexOf(name) === -1) continue;
    var url = binaryUrl(name, platform, arch);
    if (!url) continue;
    var prev = plan.length ? plan[plan.length - 1] : null;
    if (prev && prev.url === url) {
      // Same asset as the step just planned (Windows ffmpeg+ffprobe zip):
      // fold in, and only re-extract what's actually missing — never
      // overwrite a working, possibly in-use exe.
      prev.label = prev.label + ' + ' + name;
      prev.provides.push(name);
      continue;
    }
    plan.push({ label: name, url: url, archive: /\.zip$|\/zip$/.test(url), provides: [name] });
  }
  return plan;
}

function isYtDlpStale(lastUpdateMs, nowMs) {
  if (!lastUpdateMs || typeof lastUpdateMs !== 'number' || isNaN(lastUpdateMs)) return true;
  return (nowMs - lastUpdateMs) > STALE_AFTER_MS;
}

function progressText(label, index, total) {
  return 'Setting up — downloading ' + label + ' (' + index + ' of ' + total + ')…';
}

function failureMessage(failedNames) {
  var critical = [];
  for (var i = 0; i < failedNames.length; i++) {
    if (OPTIONAL.indexOf(failedNames[i]) === -1) critical.push(failedNames[i]);
  }
  if (critical.length) {
    return 'Couldn’t download ' + critical.join(', ')
      + ' — check your internet connection and hit Retry.';
  }
  return 'Optional component (' + failedNames.join(', ') + ') didn’t download — '
    + 'full YouTube support and Flow watermark removal need it. Retry any time.';
}

module.exports = {
  REQUIRED: REQUIRED,
  STALE_AFTER_MS: STALE_AFTER_MS,
  binaryUrl: binaryUrl,
  downloadPlan: downloadPlan,
  isYtDlpStale: isYtDlpStale,
  progressText: progressText,
  failureMessage: failureMessage
};
