// panel/js/downloadEngine.js
// Orchestrates the download pipeline: yt-dlp -> validate -> post-process -> move.
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var L = require('./engineLogic.js');
var fileOps = require('./fileOps.js');
var binaries = require('./binaries.js');
var errorHints = require('./errorHints.js');
var tiktok = require('./tiktok.js');

function uuidish() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

// Run a process, stream stdout/stderr lines, keep a ring buffer for error reporting.
function run(exe, args, env, onLine, onProc, done) {
  var proc = childProcess.spawn(exe, args, { env: env });
  if (onProc) onProc(proc);
  var recent = [];
  var stdout = L.createLineEmitter(push);
  var stderr = L.createLineEmitter(push);
  var finished = false;
  function push(line) {
    recent.push(line);
    if (recent.length > 30) recent.shift();
    if (onLine) onLine(line);
  }
  function finish(err) {
    if (finished) return;
    finished = true;
    done(err);
  }
  proc.stdout.on('data', function (buf) { stdout.feed(buf); });
  proc.stderr.on('data', function (buf) { stderr.feed(buf); });
  proc.on('error', function (e) { finish(e); });
  proc.on('close', function (code) {
    stdout.flush();
    stderr.flush();
    if (code === 0) return finish(null);
    var meaningful = recent.filter(function (l) {
      return l.indexOf('[download]') === -1 && l.indexOf('Downloading') === -1;
    });
    var raw = (meaningful.length ? meaningful : recent).slice(-6).join('\n');
    var hit = errorHints.friendly(raw);
    var err = new Error(hit ? hit.message : (path.basename(exe) + ' failed:\n' + (raw || 'unknown error')));
    err.hint = hit ? hit.hint : null;
    err.category = hit ? hit.category : null;
    err.retryable = hit ? hit.retryable : null;
    err.action = hit ? hit.action : null;
    err.raw = raw;
    finish(err);
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
//         endTime, trimMode, cookiesBrowser, cookiesFile, proxyUrl, noPlaylist, extRoot }
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

  var tmp = opts.workDir || path.join(os.tmpdir(), 'smartgrab-' + uuidish());
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(opts.outputDir, { recursive: true });
  } catch (e) { return cb(e); }

  function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  function workDirHasArtifacts() {
    try {
      return fs.readdirSync(tmp).some(function (f) {
        return f.indexOf('.smartgrab-part') === -1;
      });
    } catch (e) { return false; }
  }
  function cleanupAfterFailure(err) {
    if (err && opts.preserveWorkDir && err.retryable !== false && workDirHasArtifacts()) {
      err.hasPartials = true;
      return;
    }
    cleanup();
  }
  function isCanceled() {
    return !!(opts.isCanceled && opts.isCanceled());
  }
  function canceledError() {
    var err = new Error('Canceled');
    err.canceled = true;
    err.retryable = true;
    return err;
  }

  var audioOnly = opts.quality === 'audioOnly';
  var vinfo = L.videoFormatInfo(opts.videoFormat);

  // The URL yt-dlp actually fetches. Normally opts.url; if TikTok's native
  // extraction is blocked on this network (see below) it becomes a direct CDN
  // URL from the resolver, which we then download like any plain file.
  var effectiveUrl = opts.url;
  var triedResolver = false;
  var resolvedTemplate = null;   // clean yt-dlp -o for the resolved CDN URL

  // First try the fast path (server-side --download-sections for clips).
  // If that yt-dlp run fails and sections were in play, retry once with a
  // full download + local trim — some sites/formats don't support sections.
  function attemptDownload(sectionsAllowed, attemptCb) {
    var attemptOpts = sectionsAllowed ? opts : Object.assign({}, opts, { trimMode: 'precise' });
    if (resolvedTemplate) attemptOpts = Object.assign({}, attemptOpts, { outputTemplate: resolvedTemplate });
    var sectionsUsed = L.useSections(attemptOpts);
    // Full binary path (not its directory) — leaves yt-dlp no room to
    // mis-resolve ffmpeg and silently skip merging.
    var args = L.buildYtDlpArgs(attemptOpts, tmp, ffmpeg, effectiveUrl);
    run(ytdlp, args, env, function (line) {
      var p = L.parseProgress(line);
      if (p) onProgress(p.percent, p.status);
    }, onProc, function (err) {
      attemptCb(err, sectionsUsed);
    });
  }

  function freshTmp() {
    try { fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); } catch (e) {}
  }

  // yt-dlp couldn't fetch this TikTok directly (ISP block). Ask the resolver
  // for a CDN URL on a non-blocked host and download THAT instead — as a plain
  // file, so we go straight to the precise path (no server-side sections on a
  // generic URL; clips are trimmed locally). Keeps the original error if the
  // resolver can't help either.
  function tryTikTokResolver(originalErr) {
    if (isCanceled()) { cleanupAfterFailure(canceledError()); return cb(canceledError()); }
    triedResolver = true;
    onProgress(0, 'TikTok blocked on this network — trying mirror…');
    tiktok.resolve(opts.url, function (rerr, info) {
      if (isCanceled()) { cleanupAfterFailure(canceledError()); return cb(canceledError()); }
      if (rerr || !info || !info.videoUrl) { cleanupAfterFailure(originalErr); return cb(originalErr); }
      effectiveUrl = info.videoUrl;
      resolvedTemplate = tiktok.outputTemplate(info, opts.url);
      freshTmp();
      startAttempt(false);
    });
  }

  function startAttempt(sectionsAllowed) {
    if (isCanceled()) { cleanupAfterFailure(canceledError()); return cb(canceledError()); }
    onProgress(0, 'Downloading...');
    attemptDownload(sectionsAllowed, function (err, sectionsUsed) {
      if (err) {
        if (isCanceled()) { cleanupAfterFailure(canceledError()); return cb(canceledError()); }
        if (sectionsUsed) {
          // Clean the tmp dir and retry with a full download + local trim.
          freshTmp();
          onProgress(0, 'Fast trim unavailable — downloading full video...');
          return startAttempt(false);
        }
        if (!triedResolver && tiktok.isTikTokUrl(opts.url)) return tryTikTokResolver(err);
        cleanupAfterFailure(err);
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

  function failUnmergeable(entries) {
    var err = new Error('yt-dlp left ' + entries.length + ' files that could not be combined into one video.');
    err.hint = 'Retry the item; if it keeps happening, copy the error and report it.';
    err.category = 'merge';
    err.retryable = true;
    err.action = 'copy-diagnostics';
    err.raw = entries.map(function (e) {
      return e.name + ' (video: ' + (e.vcodec || 'none') + ', audio: ' + (e.acodec || 'none') + ')';
    }).join('\n');
    cleanupAfterFailure(err);
    cb(err);
  }

  function probeAllFiles(files, done) {
    var entries = [];
    (function next(i) {
      if (i >= files.length) return done(entries);
      probeStreams(files[i], function (e) { entries.push(e); next(i + 1); });
    })(0);
  }

  function postProcess(sectionsUsed) {
    if (isCanceled()) { cleanupAfterFailure(canceledError()); return cb(canceledError()); }
    var files;
    try {
      files = fs.readdirSync(tmp).filter(function (f) {
        return f.indexOf('.part') === -1 && f.indexOf('.ytdl') === -1;
      });
    } catch (e) { cleanupAfterFailure(e); return cb(e); }

    if (files.length === 0) {
      var noOutput = new Error('Download failed — no output file.');
      noOutput.category = 'output';
      noOutput.retryable = true;
      cleanupAfterFailure(noOutput);
      return cb(noOutput);
    }
    if (files.length === 1) return processMany(files, sectionsUsed);

    // More than one file. Probe to find out what they are:
    //  - one video-only + one audio-only => yt-dlp's merge silently skipped
    //    (it decided ffmpeg wasn't usable) => merge them ourselves.
    //  - several self-contained videos => a multi-media post (e.g. a tweet
    //    with 2-4 videos) => keep them ALL; each gets imported.
    probeAllFiles(files, function (entries) {
      var pair = audioOnly ? null : L.pairLeftoverStreams(entries);
      if (pair) {
        onProgress(null, 'Merging streams...');
        var container = opts.videoFormat === 'mkv' ? 'mkv' : 'mp4';
        var vStem = path.basename(pair.video.name, path.extname(pair.video.name));
        var outName = L.stripFormatSuffix(vStem) + '.' + container;
        if (outName === pair.video.name || outName === pair.audio.name) outName = 'merged-' + outName;
        var margs = L.selfMergeArgs(
          path.join(tmp, pair.video.name), path.join(tmp, pair.audio.name),
          pair.audio.acodec, container, path.join(tmp, outName)
        );
        run(ffmpeg, margs, env, null, onProc, function (merr) {
          if (merr) { cleanupAfterFailure(merr); return cb(merr); }
          try {
            fs.rmSync(path.join(tmp, pair.video.name));
            fs.rmSync(path.join(tmp, pair.audio.name));
          } catch (e) { cleanupAfterFailure(e); return cb(e); }
          processMany([outName], sectionsUsed);
        });
        return;
      }
      var allSelfContained = entries.every(function (e) {
        return audioOnly ? (e.acodec && !e.vcodec) : !!e.vcodec;
      });
      if (allSelfContained) return processMany(files, sectionsUsed);
      failUnmergeable(entries);
    });
  }

  // Post-process each file in turn, then report all of them at once.
  function processMany(names, sectionsUsed) {
    var results = [];
    (function next(i) {
      if (i >= names.length) {
        var bytes = 0;
        for (var j = 0; j < results.length; j++) bytes += results[j].bytes;
        var sizeStr = (bytes ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : '');
        if (results.length > 1) sizeStr = results.length + ' videos · ' + sizeStr;
        cleanup();
        onProgress(100, 'Done!');
        return cb(null, {
          path: results[0].path,
          paths: results.map(function (r) { return r.path; }),
          size: sizeStr
        });
      }
      if (names.length > 1) onProgress(null, 'Processing ' + (i + 1) + '/' + names.length + '...');
      processOne(names[i], sectionsUsed, function (err, r) {
        if (err) { cleanupAfterFailure(err); return cb(err); }
        results.push(r);
        next(i + 1);
      });
    })(0);
  }

  function processOne(name, sectionsUsed, done) {
    var src = path.join(tmp, name);
    var stem = L.stripFormatSuffix(path.basename(name, path.extname(name)));
    var srcExt = path.extname(name).replace('.', '').toLowerCase();
    var tgtExt = L.targetExt(opts);
    var dest = L.uniquePath(path.join(opts.outputDir, L.outputFileName(stem, opts)), fs.existsSync);
    var partialDest = L.partialOutputPath(dest);

    try { if (fs.existsSync(partialDest)) fs.rmSync(partialDest); } catch (e) {}

    function finish() {
      var bytes = 0;
      try { bytes = fs.statSync(dest).size; } catch (e) {}
      done(null, { path: dest, bytes: bytes });
    }
    function moveFile(from, to) {
      try { fs.renameSync(from, to); return; }
      catch (e) {
        fs.copyFileSync(from, to);
        fs.rmSync(from);
      }
    }
    function promotePartial() {
      try { dest = fileOps.promoteNoOverwrite(partialDest, dest); return finish(); }
      catch (e) { return done(e); }
    }

    function applyAction(act) {
      if (act.action === 'move') {
        try { moveFile(src, partialDest); return promotePartial(); }
        catch (e) { return done(e); }
      }
      // ffmpeg action
      onProgress(null, act.note || 'Processing...');
      run(ffmpeg, act.args, env, null, onProc, function (ferr) {
        if (ferr) { try { fs.rmSync(partialDest); } catch (e) {} return done(ferr); }
        promotePartial();
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
          applyAction(L.choosePostProcess(Object.assign({}, base, { vcodec: vc, acodec: ac }), src, partialDest));
        });
      });
    } else {
      applyAction(L.choosePostProcess(base, src, partialDest));
    }
  }

  startAttempt(true);
}

module.exports = { download: download };
