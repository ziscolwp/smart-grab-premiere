// panel/js/engineLogic.js
// Pure logic ported from DownloadEngine.swift. No I/O — fully unit-testable.

var QUALITY_FORMAT = {
  best: 'bv*+ba/best',
  uhd: 'bv*[height<=2160]+ba/best',
  fhd: 'bv*[height<=1080]+ba/best',
  hd: 'bv*[height<=720]+ba/best',
  sd: 'bv*[height<=480]+ba/best',
  audioOnly: 'ba/best'
};

var VIDEO_FORMAT = {
  mp4Premiere: { ext: 'mp4', needsReencode: true },
  mov: { ext: 'mov', needsReencode: true },
  mkv: { ext: 'mkv', needsReencode: false },
  mp4Raw: { ext: 'mp4', needsReencode: false }
};

function qualityToFormat(quality) {
  return QUALITY_FORMAT[quality] || QUALITY_FORMAT.best;
}

function videoFormatInfo(videoFormat) {
  return VIDEO_FORMAT[videoFormat] || VIDEO_FORMAT.mp4Premiere;
}

function buildYtDlpArgs(opts, tmpDir, ffmpegDir, url) {
  var args = [
    '-P', tmpDir,
    '-f', qualityToFormat(opts.quality),
    '--force-ipv4',
    '--newline',
    '--no-warnings',
    '--ffmpeg-location', ffmpegDir,
    '--extractor-retries', '3',
    '--retry-sleep', 'extractor:5'
  ];
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

// p: { audioOnly, clipEnabled, startTime, endTime, needsReencode, srcExt, tgtExt, vcodec, acodec }
function choosePostProcess(p, src, dest) {
  if (p.audioOnly) return { action: 'move' };

  if (p.clipEnabled && p.endTime) {
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
    return { action: 'ffmpeg', args: ['-y', '-i', src, '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', dest] };
  }

  if (p.srcExt === p.tgtExt) return { action: 'move' };
  return { action: 'ffmpeg', args: ['-y', '-i', src, '-c', 'copy', dest] };
}

function parseProgress(line) {
  var trimmed = String(line).replace(/^\s+|\s+$/g, '');
  if (trimmed.indexOf('%') === -1) {
    if (trimmed.indexOf('Merging') !== -1) return { percent: null, status: 'Merging streams...' };
    return null;
  }
  var tokens = trimmed.split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.charAt(t.length - 1) === '%') {
      var val = parseFloat(t.substring(0, t.length - 1));
      if (!isNaN(val)) {
        var display = trimmed.replace('[download]', '').replace(/^\s+|\s+$/g, '');
        return { percent: val, status: display };
      }
    }
  }
  return null;
}

module.exports = {
  qualityToFormat: qualityToFormat,
  videoFormatInfo: videoFormatInfo,
  buildYtDlpArgs: buildYtDlpArgs,
  targetExt: targetExt,
  outputFileName: outputFileName,
  choosePostProcess: choosePostProcess,
  parseProgress: parseProgress
};
