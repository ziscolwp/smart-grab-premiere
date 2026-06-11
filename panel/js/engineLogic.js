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

// opts: { quality, videoFormat, audioFormat, clipEnabled, startTime, endTime,
//         trimMode, cookiesBrowser, noPlaylist, platform }
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
    '--no-warnings',
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
  if (opts.cookiesBrowser && opts.cookiesBrowser !== 'none') {
    args.push('--cookies-from-browser', opts.cookiesBrowser);
  }
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
    if (p.needsReencode) {
      ff = ff.concat(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart']);
    } else {
      ff = ff.concat(['-c', 'copy']);
    }
    ff.push(dest);
    return { action: 'ffmpeg', args: ff };
  }

  if (p.needsReencode) {
    if (p.vcodec === 'h264' && p.acodec === 'aac' && p.tgtExt === 'mp4' && p.srcExt === 'mp4') {
      return { action: 'move' };
    }
    if (p.vcodec === 'h264' && p.acodec === 'aac') {
      // Right codecs, wrong container (e.g. mp4 -> mov): lossless remux.
      return { action: 'ffmpeg', args: ['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', dest] };
    }
    return { action: 'ffmpeg', args: ['-y', '-i', src, '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', dest] };
  }

  if (p.srcExt === p.tgtExt) return { action: 'move' };
  return { action: 'ffmpeg', args: ['-y', '-i', src, '-c', 'copy', dest] };
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
  buildYtDlpArgs: buildYtDlpArgs,
  targetExt: targetExt,
  outputFileName: outputFileName,
  choosePostProcess: choosePostProcess,
  parseProgress: parseProgress
};
