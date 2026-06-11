// panel/js/engineLogic.js
// Pure logic for the download pipeline. No I/O — fully unit-testable.

var HEIGHT = { best: null, uhd: 2160, fhd: 1080, hd: 720, sd: 480 };

var VIDEO_FORMAT = {
  mp4Premiere: { ext: 'mp4', needsReencode: true },
  mov: { ext: 'mov', needsReencode: true },
  mkv: { ext: 'mkv', needsReencode: false },
  mp4Raw: { ext: 'mp4', needsReencode: false }
};

// The selector stays maximally permissive ("/b" keeps single-muxed-format
// sites like X, Instagram, Reddit, Loom working); quality and codec
// preferences are expressed via --format-sort, which never hard-fails.
function qualityToFormat(quality) {
  return quality === 'audioOnly' ? 'ba/b' : 'bv*+ba/b';
}

// --format-sort: resolution first (capped for fixed qualities, so "1080p"
// means "best ≤1080"), then prefer H.264+AAC so mp4 targets need no
// re-encode. mkv ("original") keeps the site's natural best codec.
function formatSort(quality, videoFormat) {
  if (quality === 'audioOnly') return null;
  var h = HEIGHT[quality];
  var parts = [h ? 'res:' + h : 'res'];
  if (videoFormat !== 'mkv') parts.push('vcodec:h264', 'acodec:aac');
  return parts.join(',');
}

function videoFormatInfo(videoFormat) {
  return VIDEO_FORMAT[videoFormat] || VIDEO_FORMAT.mp4Premiere;
}

// Should this download fetch only the requested section server-side?
function useSections(opts) {
  return !!(opts.clipEnabled && opts.endTime && opts.trimMode !== 'precise');
}

// Auth cookies for yt-dlp. A cookies.txt file is the most robust method (works
// on Windows where Chrome cookies can't be read, and avoids keychain prompts),
// so it wins over the live-browser method when both are set.
function cookieArgs(cookiesBrowser, cookiesFile) {
  if (cookiesFile) return ['--cookies', cookiesFile];
  if (cookiesBrowser && cookiesBrowser !== 'none') return ['--cookies-from-browser', cookiesBrowser];
  return [];
}

// Route yt-dlp's traffic through a proxy (http/https/socks5). This is the
// escape hatch for ISP/region-blocked sites (e.g. TikTok in India): the
// panel's downloads run outside the browser, so browser-level VPNs never
// cover them — a proxy URL does.
function proxyArgs(proxyUrl) {
  var p = String(proxyUrl || '').replace(/^\s+|\s+$/g, '');
  return p ? ['--proxy', p] : [];
}

// One-shot export: read a browser's cookies once and dump them to a Netscape
// cookies.txt (the yt-dlp FAQ method). yt-dlp needs a URL to run at all, so we
// give it a trivial page and ignore the extraction result — the cookie jar is
// written on shutdown either way; the caller verifies the file exists.
function cookieExportArgs(browser, destPath) {
  return [
    '--cookies-from-browser', browser,
    '--cookies', destPath,
    '--skip-download', '--ignore-errors', '--no-warnings',
    'https://www.youtube.com/robots.txt'
  ];
}

// opts: { quality, videoFormat, audioFormat, clipEnabled, startTime, endTime,
//         trimMode, cookiesBrowser, cookiesFile, proxyUrl, noPlaylist, platform }
var PROGRESS_TEMPLATE = 'download:SG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s';

function buildYtDlpArgs(opts, tmpDir, ffmpegDir, url) {
  var args = [
    '-P', tmpDir,
    '-o', '%(title).80B [%(id)s].%(ext)s',
    '-f', qualityToFormat(opts.quality)
  ];
  var sort = formatSort(opts.quality, opts.videoFormat);
  if (sort) args.push('-S', sort);
  args = args.concat([
    '--newline',
    '--progress-template', PROGRESS_TEMPLATE,
    // No --no-warnings here: warnings like "ffmpeg is not installed" are the
    // diagnostic when something downstream misbehaves; the run() ring buffer
    // keeps them for error reports.
    '--windows-filenames',
    '--ffmpeg-location', ffmpegDir,
    '--retries', '10',
    '--fragment-retries', '10',
    '--concurrent-fragments', '4',
    '--socket-timeout', '20',
    '--extractor-retries', '3',
    '--retry-sleep', 'extractor:5'
  ]);
  if (opts.noPlaylist !== false) args.push('--no-playlist');
  args = args.concat(cookieArgs(opts.cookiesBrowser, opts.cookiesFile));
  args = args.concat(proxyArgs(opts.proxyUrl));
  if (opts.referer) args.push('--referer', opts.referer);
  if (useSections(opts)) {
    args.push('--download-sections', '*' + (opts.startTime || '0') + '-' + opts.endTime);
  }
  if (opts.quality === 'audioOnly') {
    args.push('-x', '--audio-format', opts.audioFormat || 'mp3');
  } else {
    args.push('--merge-output-format', opts.videoFormat === 'mkv' ? 'mkv' : 'mp4');
  }
  args.push(url);
  return args;
}

function targetExt(opts) {
  return opts.quality === 'audioOnly'
    ? (opts.audioFormat || 'mp3')
    : videoFormatInfo(opts.videoFormat).ext;
}

function outputFileName(stem, opts) {
  var ext = targetExt(opts);
  if (opts.clipEnabled && opts.endTime) {
    var s = String(opts.startTime || '').split(':').join('-');
    var e = String(opts.endTime).split(':').join('-');
    return stem + '_clip_' + s + '_to_' + e + '.' + ext;
  }
  return stem + '.' + ext;
}

// p: { audioOnly, clipEnabled, startTime, endTime, needsReencode, srcExt, tgtExt,
//      vcodec, acodec, sectionDownloaded }
// sectionDownloaded: the file already contains only the clip (server-side
// --download-sections) so no local -ss/-to is needed.
function choosePostProcess(p, src, dest) {
  if (p.audioOnly) return { action: 'move' };

  if (p.clipEnabled && p.endTime && !p.sectionDownloaded) {
    var ff = ['-y', '-ss', p.startTime, '-to', p.endTime, '-i', src];
    var note;
    if (p.needsReencode) {
      ff = ff.concat(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart']);
      note = 'Trimming + converting…';
    } else {
      ff = ff.concat(['-c', 'copy']);
      note = 'Trimming clip…';
    }
    ff.push(dest);
    return { action: 'ffmpeg', note: note, args: ff };
  }

  if (p.needsReencode) {
    // Per-stream decisions: only convert what Premiere can't take. An absent
    // audio stream (acodec '') counts as fine — "-c copy" just carries video.
    var videoOk = p.vcodec === 'h264';
    var audioOk = !p.acodec || p.acodec === 'aac';
    if (videoOk && audioOk) {
      if (p.tgtExt === 'mp4' && p.srcExt === 'mp4') return { action: 'move' };
      // Right codecs, wrong container (e.g. mp4 -> mov): lossless remux.
      return { action: 'ffmpeg', note: 'Repackaging (no re-encode)…',
               args: ['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', dest] };
    }
    if (videoOk) {
      return { action: 'ffmpeg', note: 'Converting audio only (video copied)…',
               args: ['-y', '-i', src, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', dest] };
    }
    if (p.acodec === 'aac') {
      return { action: 'ffmpeg', note: 'Converting video (audio copied)…',
               args: ['-y', '-i', src, '-c:v', 'libx264', '-c:a', 'copy', '-movflags', '+faststart', dest] };
    }
    return { action: 'ffmpeg', note: 'Converting for editing…',
             args: ['-y', '-i', src, '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', dest] };
  }

  if (p.srcExt === p.tgtExt) return { action: 'move' };
  return { action: 'ffmpeg', note: 'Repackaging (no re-encode)…',
           args: ['-y', '-i', src, '-c', 'copy', dest] };
}

// When yt-dlp exits 0 but leaves separate streams (its merge silently skipped),
// identify the video/audio pair so the engine can merge them itself.
// entries: [{ name, vcodec, acodec }] (codecs '' when the stream is absent)
function pairLeftoverStreams(entries) {
  if (!entries || entries.length !== 2) return null;
  var video = null, audio = null;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.vcodec && !video) video = e;
    else if (!e.vcodec && e.acodec && !audio) audio = e;
  }
  return (video && audio) ? { video: video, audio: audio } : null;
}

// ffmpeg args for the self-merge. Streams are copied; audio is transcoded to
// AAC only when the target container can't hold it (e.g. opus -> mp4).
function selfMergeArgs(videoPath, audioPath, acodec, container, outPath) {
  var args = ['-y', '-i', videoPath, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'];
  var mp4Like = container === 'mp4' || container === 'mov';
  var audioOk = !mp4Like || acodec === 'aac' || acodec === 'mp3';
  args = args.concat(audioOk ? ['-c:a', 'copy'] : ['-c:a', 'aac']);
  if (mp4Like) args = args.concat(['-movflags', '+faststart']);
  args.push(outPath);
  return args;
}

// Unmerged stream files carry yt-dlp's format-id suffix ("Title [id].f401").
function stripFormatSuffix(stem) {
  return String(stem).replace(/\.f[a-z0-9_-]+$/i, '');
}

// Parses yt-dlp progress output. Primary path is our machine-readable
// --progress-template ("SG|  42.5%| 1.05MiB/s|00:45"); the [download] form
// is kept as a fallback for phases the template doesn't cover.
// Returns { percent, status, speed, eta } or null.
function parseProgress(line) {
  var trimmed = String(line).replace(/^\s+|\s+$/g, '');

  if (trimmed.indexOf('SG|') === 0) {
    var parts = trimmed.split('|');
    function clean(v) {
      v = String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
      return (!v || v === 'Unknown' || v === 'N/A' || v.indexOf('Unknown') === 0) ? null : v;
    }
    var pctStr = clean(parts[1]);
    var percent = pctStr ? parseFloat(pctStr) : NaN;
    if (isNaN(percent)) return null;
    var speed = clean(parts[2]);
    var eta = clean(parts[3]);
    var status = percent.toFixed(1) + '%' + (speed ? ' · ' + speed : '') + (eta ? ' · ETA ' + eta : '');
    return { percent: percent, status: status, speed: speed, eta: eta };
  }

  if (trimmed.indexOf('%') === -1) {
    if (trimmed.indexOf('Merging') !== -1) return { percent: null, status: 'Merging streams...' };
    if (trimmed.indexOf('[ExtractAudio]') !== -1) return { percent: null, status: 'Extracting audio...' };
    return null;
  }
  var tokens = trimmed.split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.charAt(t.length - 1) === '%') {
      var val = parseFloat(t.substring(0, t.length - 1));
      if (!isNaN(val)) {
        var display = trimmed.replace('[download]', '').replace(/^\s+|\s+$/g, '');
        var speedM = trimmed.match(/at\s+([\d.]+\s*[KMG]i?B\/s)/);
        var etaM = trimmed.match(/ETA\s+([\d:]+)/);
        return {
          percent: val,
          status: display,
          speed: speedM ? speedM[1] : null,
          eta: etaM ? etaM[1] : null
        };
      }
    }
  }
  return null;
}

module.exports = {
  qualityToFormat: qualityToFormat,
  formatSort: formatSort,
  videoFormatInfo: videoFormatInfo,
  useSections: useSections,
  cookieArgs: cookieArgs,
  proxyArgs: proxyArgs,
  cookieExportArgs: cookieExportArgs,
  buildYtDlpArgs: buildYtDlpArgs,
  targetExt: targetExt,
  outputFileName: outputFileName,
  choosePostProcess: choosePostProcess,
  pairLeftoverStreams: pairLeftoverStreams,
  selfMergeArgs: selfMergeArgs,
  stripFormatSuffix: stripFormatSuffix,
  parseProgress: parseProgress
};
