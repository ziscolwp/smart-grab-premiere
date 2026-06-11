// panel/js/downloadEngine.js
// Orchestrates the download pipeline: yt-dlp -> validate -> post-process -> move.
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var L = require('./engineLogic.js');
var binaries = require('./binaries.js');
var errorHints = require('./errorHints.js');

function uuidish() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

// Run a process, stream stdout/stderr lines, keep a ring buffer for error reporting.
function run(exe, args, env, onLine, onProc, done) {
  var proc = childProcess.spawn(exe, args, { env: env });
  if (onProc) onProc(proc);
  var recent = [];
  function push(line) {
    recent.push(line);
    if (recent.length > 30) recent.shift();
    if (onLine) onLine(line);
  }
  function feed(buf) {
    var lines = buf.toString().split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) if (lines[i]) push(lines[i]);
  }
  proc.stdout.on('data', feed);
  proc.stderr.on('data', feed);
  proc.on('error', function (e) { done(e); });
  proc.on('close', function (code) {
    if (code === 0) return done(null);
    var meaningful = recent.filter(function (l) {
      return l.indexOf('[download]') === -1 && l.indexOf('Downloading') === -1;
    });
    var raw = (meaningful.length ? meaningful : recent).slice(-6).join('\n');
    var hit = errorHints.friendly(raw);
    var err = new Error(hit ? hit.message : (path.basename(exe) + ' failed:\n' + (raw || 'unknown error')));
    err.hint = hit ? hit.hint : null;
    err.raw = raw;
    done(err);
  });
}

function probeCodec(ffprobe, file, stream, env, cb) {
  var args = ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=codec_name', '-of', 'default=nk=1:nw=1', file];
  var p = childProcess.spawn(ffprobe, args, { env: env });
  var out = '';
  p.stdout.on('data', function (d) { out += d.toString(); });
  p.on('error', function () { cb(''); });
  p.on('close', function () { cb(out.replace(/^\s+|\s+$/g, '')); });
}

// opts: { url, outputDir, quality, videoFormat, audioFormat, clipEnabled, startTime,
//         endTime, trimMode, cookiesBrowser, noPlaylist, extRoot }
// callbacks: { onProgress(percent,status), onProc(proc) }
// cb(err, { path, size })
function download(opts, callbacks, cb) {
  callbacks = callbacks || {};
  var onProgress = callbacks.onProgress || function () {};
  var onProc = callbacks.onProc || function () {};

  var ytdlp = binaries.resolveBinary('yt-dlp', { extRoot: opts.extRoot });
  var ffmpeg = binaries.resolveBinary('ffmpeg', { extRoot: opts.extRoot });
  if (!ytdlp) return cb(new Error('yt-dlp not found. Click "Update yt-dlp" in Settings or re-run the installer.'));
  if (!ffmpeg) return cb(new Error('ffmpeg not found. Re-run the installer.'));
  var ffprobe = binaries.resolveBinary('ffprobe', { extRoot: opts.extRoot }) || ffmpeg;
  var env = binaries.augmentedEnv(process.env);
  // yt-dlp looks for helper binaries (deno for YouTube's JS challenges, ffmpeg
  // as PATH fallback) on PATH — make sure their folders are there.
  var sep = process.platform === 'win32' ? ';' : ':';
  env.PATH = path.dirname(ytdlp) + sep + path.dirname(ffmpeg) + sep + env.PATH;

  var tmp = path.join(os.tmpdir(), 'smartgrab-' + uuidish());
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(opts.outputDir, { recursive: true });
  } catch (e) { return cb(e); }

  function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  var audioOnly = opts.quality === 'audioOnly';
  var vinfo = L.videoFormatInfo(opts.videoFormat);

  // First try the fast path (server-side --download-sections for clips).
  // If that yt-dlp run fails and sections were in play, retry once with a
  // full download + local trim — some sites/formats don't support sections.
  function attemptDownload(sectionsAllowed, attemptCb) {
    var attemptOpts = sectionsAllowed ? opts : Object.assign({}, opts, { trimMode: 'precise' });
    var sectionsUsed = L.useSections(attemptOpts);
    // Full binary path (not its directory) — leaves yt-dlp no room to
    // mis-resolve ffmpeg and silently skip merging.
    var args = L.buildYtDlpArgs(attemptOpts, tmp, ffmpeg, opts.url);
    run(ytdlp, args, env, function (line) {
      var p = L.parseProgress(line);
      if (p) onProgress(p.percent, p.status);
    }, onProc, function (err) {
      attemptCb(err, sectionsUsed);
    });
  }

  function startAttempt(sectionsAllowed) {
    onProgress(0, 'Downloading...');
    attemptDownload(sectionsAllowed, function (err, sectionsUsed) {
      if (err) {
        if (sectionsUsed) {
          // Clean the tmp dir and retry with a full download + local trim.
          try { fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); } catch (e) {}
          onProgress(0, 'Fast trim unavailable — downloading full video...');
          return startAttempt(false);
        }
        cleanup();
        return cb(err);
      }
      postProcess(sectionsUsed);
    });
  }

  function probeStreams(name, done) {
    var f = path.join(tmp, name);
    probeCodec(ffprobe, f, 'v:0', env, function (vc) {
      probeCodec(ffprobe, f, 'a:0', env, function (ac) {
        done({ name: name, vcodec: vc, acodec: ac });
      });
    });
  }

  function failUnmergeable(n) {
    cleanup();
    var err = new Error('yt-dlp left ' + n + ' files that could not be combined into one video.');
    err.hint = 'Re-run the installer to refresh ffmpeg, then retry this item.';
    cb(err);
  }

  function postProcess(sectionsUsed) {
    var files;
    try {
      files = fs.readdirSync(tmp).filter(function (f) {
        return f.indexOf('.part') === -1 && f.indexOf('.ytdl') === -1;
      });
    } catch (e) { cleanup(); return cb(e); }

    if (files.length === 0) { cleanup(); return cb(new Error('Download failed — no output file.')); }
    if (files.length === 1) return proceedSingle(files[0], sectionsUsed);

    // yt-dlp exited 0 but left separate streams: its merge step was silently
    // skipped (it decided ffmpeg wasn't usable). Merge them ourselves —
    // stream copy, so this costs seconds, not a re-encode.
    if (files.length === 2 && !audioOnly) {
      onProgress(null, 'Merging streams...');
      return probeStreams(files[0], function (a) {
        probeStreams(files[1], function (b) {
          var pair = L.pairLeftoverStreams([a, b]);
          if (!pair) return failUnmergeable(2);
          var container = opts.videoFormat === 'mkv' ? 'mkv' : 'mp4';
          var vStem = path.basename(pair.video.name, path.extname(pair.video.name));
          var outName = L.stripFormatSuffix(vStem) + '.' + container;
          if (outName === pair.video.name || outName === pair.audio.name) outName = 'merged-' + outName;
          var margs = L.selfMergeArgs(
            path.join(tmp, pair.video.name), path.join(tmp, pair.audio.name),
            pair.audio.acodec, container, path.join(tmp, outName)
          );
          run(ffmpeg, margs, env, null, onProc, function (merr) {
            if (merr) { cleanup(); return cb(merr); }
            try {
              fs.rmSync(path.join(tmp, pair.video.name));
              fs.rmSync(path.join(tmp, pair.audio.name));
            } catch (e) { cleanup(); return cb(e); }
            proceedSingle(outName, sectionsUsed);
          });
        });
      });
    }
    failUnmergeable(files.length);
  }

  function proceedSingle(name, sectionsUsed) {
    var src = path.join(tmp, name);
    var stem = L.stripFormatSuffix(path.basename(name, path.extname(name)));
    var srcExt = path.extname(name).replace('.', '').toLowerCase();
    var tgtExt = L.targetExt(opts);
    var dest = path.join(opts.outputDir, L.outputFileName(stem, opts));

    try { if (fs.existsSync(dest)) fs.rmSync(dest); } catch (e) {}

    function finish() {
      var sizeStr = '';
      try {
        var bytes = fs.statSync(dest).size;
        sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      } catch (e) {}
      cleanup();
      onProgress(100, 'Done!');
      cb(null, { path: dest, size: sizeStr });
    }

    function applyAction(act) {
      if (act.action === 'move') {
        try { fs.renameSync(src, dest); return finish(); }
        catch (e) {
          // cross-device fallback
          try { fs.copyFileSync(src, dest); fs.rmSync(src); return finish(); }
          catch (e2) { cleanup(); return cb(e2); }
        }
      }
      // ffmpeg action
      onProgress(null, act.note || 'Processing...');
      run(ffmpeg, act.args, env, null, onProc, function (ferr) {
        if (ferr) { cleanup(); return cb(ferr); }
        finish();
      });
    }

    var base = {
      audioOnly: audioOnly, clipEnabled: opts.clipEnabled, startTime: opts.startTime,
      endTime: opts.endTime, needsReencode: vinfo.needsReencode,
      srcExt: srcExt, tgtExt: tgtExt, sectionDownloaded: sectionsUsed
    };
    var localClip = opts.clipEnabled && opts.endTime && !sectionsUsed;

    // For reencode targets, probe codecs first so an already-H.264/AAC file
    // can be moved or remuxed instead of re-encoded.
    if (!audioOnly && vinfo.needsReencode && !localClip) {
      probeCodec(ffprobe, src, 'v:0', env, function (vc) {
        probeCodec(ffprobe, src, 'a:0', env, function (ac) {
          applyAction(L.choosePostProcess(Object.assign({}, base, { vcodec: vc, acodec: ac }), src, dest));
        });
      });
    } else {
      applyAction(L.choosePostProcess(base, src, dest));
    }
  }

  startAttempt(true);
}

module.exports = { download: download };
