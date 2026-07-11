// panel/js/downloadEngine.js
// TODO: split by concern (watermark cleaning stage is a natural cut)
// Orchestrates the download pipeline: yt-dlp -> validate -> post-process -> move.
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var L = require('./engineLogic.js');
var binaries = require('./binaries.js');
var errorHints = require('./errorHints.js');
var tiktok = require('./tiktok.js');
var flow = require('./flow.js');
var veo = require('./veoWatermark.js');

function uuidish() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

// One JIT watermark-tool install attempt per panel session — a ~40MB deno
// download must not re-fire for every queued Flow clip once it has failed.
var triedToolInstall = false;

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

  var tmp = path.join(os.tmpdir(), 'smartgrab-' + uuidish());
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(opts.outputDir, { recursive: true });
  } catch (e) { return cb(e); }

  function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  var audioOnly = opts.quality === 'audioOnly';
  var vinfo = L.videoFormatInfo(opts.videoFormat);

  // The URL yt-dlp actually fetches. Normally opts.url; if TikTok's native
  // extraction is blocked on this network (see below) it becomes a direct CDN
  // URL from the resolver, which we then download like any plain file.
  var effectiveUrl = opts.url;
  var triedResolver = false;
  var resolvedTemplate = null;   // clean yt-dlp -o for the resolved CDN URL
  // Flow share links download via the generic extractor untouched; this just
  // renames the file from a bare UUID to "Flow clip [id]" (null for any other URL).
  var presetTemplate = flow.outputTemplate(opts.url);
  // Flow (Veo) clips carry a baked-in sparkle watermark; when enabled, each
  // downloaded video gets a de-watermark pass before import. Failures fall
  // back to the original file with a warning — never block footage.
  var wantClean = veo.shouldClean(opts);
  var cleanWarning = null;
  // Is the SOURCE a TikTok page (vs. the resolved CDN URL we may set below)?
  // Drives the fail-fast-then-mirror path on networks that block TikTok.
  var tiktokNative = tiktok.isTikTokUrl(opts.url);

  // First try the fast path (server-side --download-sections for clips).
  // If that yt-dlp run fails and sections were in play, retry once with a
  // full download + local trim — some sites/formats don't support sections.
  function attemptDownload(sectionsAllowed, attemptCb) {
    var attemptOpts = sectionsAllowed ? opts : Object.assign({}, opts, { trimMode: 'precise' });
    var template = resolvedTemplate || presetTemplate;
    if (template) attemptOpts = Object.assign({}, attemptOpts, { outputTemplate: template });
    // Native TikTok page on a maybe-blocked network: fail in ~5s, not ~27s, so
    // the mirror can take over. Once resolved, effectiveUrl is a plain CDN URL
    // (triedResolver true) and gets the normal patient profile.
    if (tiktokNative && !triedResolver) attemptOpts = Object.assign({}, attemptOpts, { fastFail: true });
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
    triedResolver = true;
    onProgress(0, 'TikTok blocked on this network — trying mirror…');
    tiktok.resolve(opts.url, function (rerr, info) {
      if (rerr || !info || !info.videoUrl) { cleanup(); return cb(originalErr); }
      // The mirror worked where native couldn't — remember this network blocks
      // TikTok so later grabs skip straight to the mirror.
      tiktok.markBlocked();
      effectiveUrl = info.videoUrl;
      resolvedTemplate = tiktok.outputTemplate(info, opts.url);
      freshTmp();
      startAttempt(false);
    });
  }

  function startAttempt(sectionsAllowed) {
    onProgress(0, 'Downloading...');
    attemptDownload(sectionsAllowed, function (err, sectionsUsed) {
      if (err) {
        // TikTok block: a second native attempt won't fare better, so skip the
        // sections->full retry and reach for the mirror resolver right away.
        if (!triedResolver && tiktokNative) return tryTikTokResolver(err);
        if (sectionsUsed) {
          // Clean the tmp dir and retry with a full download + local trim.
          freshTmp();
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

  function failUnmergeable(entries) {
    cleanup();
    var err = new Error('yt-dlp left ' + entries.length + ' files that could not be combined into one video.');
    err.hint = 'Retry the item; if it keeps happening, copy the error and report it.';
    err.raw = entries.map(function (e) {
      return e.name + ' (video: ' + (e.vcodec || 'none') + ', audio: ' + (e.acodec || 'none') + ')';
    }).join('\n');
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
    var files;
    try {
      files = fs.readdirSync(tmp).filter(function (f) {
        return f.indexOf('.part') === -1 && f.indexOf('.ytdl') === -1;
      });
    } catch (e) { cleanup(); return cb(e); }

    if (files.length === 0) { cleanup(); return cb(new Error('Download failed — no output file.')); }
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
          if (merr) { cleanup(); return cb(merr); }
          try {
            fs.rmSync(path.join(tmp, pair.video.name));
            fs.rmSync(path.join(tmp, pair.audio.name));
          } catch (e) { cleanup(); return cb(e); }
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

  // Collect a process's stdout as a string (stderr kept for error messages).
  function execCollect(exe, cmdArgs, cb) {
    var p = childProcess.spawn(exe, cmdArgs, { env: env });
    var out = '', errOut = '';
    p.stdout.on('data', function (d) { out += d.toString(); });
    p.stderr.on('data', function (d) { errOut += d.toString(); });
    p.on('error', function (e) { cb(e, '', ''); });
    p.on('close', function (code) {
      cb(code === 0 ? null : new Error(path.basename(exe) + ' exited ' + code + ': ' + errOut.slice(-400)), out, errOut);
    });
  }

  // A cleaning error that knows WHY it failed — veo.warningFor(cleanCause)
  // turns the code into the per-cause row warning; the message goes to the log.
  function causeErr(cause, msg) {
    var e = new Error(msg);
    e.cleanCause = cause;
    return e;
  }

  // Fail-soft must not mean fly-blind: keep the detail (calibration score,
  // exit codes) in a small support log next to the managed binaries, and echo
  // it to the CEP console. Never let logging itself break a download.
  function logCleanFailure(err) {
    var line = new Date().toISOString() + ' [' + (err.cleanCause || 'unknown') + '] '
      + err.message + ' :: ' + opts.url + '\n';
    try {
      var dir = path.dirname(binaries.appSupportBin());
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      var file = path.join(dir, 'veo-clean.log');
      try { if (fs.statSync(file).size > 262144) fs.rmSync(file, { force: true }); } catch (e) {}
      fs.appendFileSync(file, line);
    } catch (e) {}
    try { console.error('[veo-clean] ' + line); } catch (e) {}
  }

  // Remove the Veo sparkle: probe -> extract probe frames -> calibrate ->
  // ffmpeg decode | deno filter | ffmpeg encode. cb(err, cleanedPath); err
  // carries .cleanCause for the row warning + support log. If deno is missing
  // (its setup download is tolerated failing), fetch it now — once per session.
  function cleanFlowWatermark(src, cb) {
    var script = path.join(opts.extRoot || '', 'deno', 'veoClean.mjs');
    if (!fs.existsSync(script)) return cb(causeErr('tools', 'veoClean.mjs missing at ' + script));
    var deno = binaries.resolveBinary('deno', { extRoot: opts.extRoot });
    if (deno) return runClean(deno);
    if (triedToolInstall) return cb(causeErr('tools', 'deno not installed (install already attempted this session)'));
    triedToolInstall = true;
    onProgress(null, 'Installing watermark tools…');
    binaries.ensureAll(opts.extRoot, function (p) {
      onProgress(null, 'Installing watermark tools… ' + Math.round(p.percent || 0) + '%');
    }, function (ierr) {
      var installed = binaries.resolveBinary('deno', { extRoot: opts.extRoot });
      if (!installed) return cb(causeErr('install-failed', 'deno download failed' + (ierr ? ': ' + ierr.message : '')));
      onProgress(null, 'Removing watermark…');
      runClean(installed);
    });

    function runClean(deno) {
    execCollect(ffprobe, veo.probeDimsArgs(src), function (perr, out) {
      var meta = perr ? null : veo.parseVideoProbe(out);
      if (!meta) return cb(causeErr('pipeline', 'probe failed: ' + (perr ? perr.message : 'no dimensions in output')));
      if (!veo.supportedPixFmt(meta.pixFmt)) return cb(causeErr('format', 'unsupported pixel format "' + meta.pixFmt + '" (need 8-bit 4:2:0)'));
      var candidates = veo.candidatesFor(meta.width, meta.height);
      if (!candidates.length) return cb(causeErr('format', 'no watermark candidates for ' + meta.width + 'x' + meta.height));
      var probeRaw = path.join(tmp, 'veo-probe.raw');
      var frames = veo.probeFrameIndexes(meta);
      run(ffmpeg, veo.extractProbeArgs(src, frames, probeRaw), env, null, onProc, function (eerr) {
        if (eerr || !fs.existsSync(probeRaw)) return cb(causeErr('pipeline', 'probe extraction failed' + (eerr ? ': ' + eerr.message : '')));
        execCollect(deno, veo.calibrateArgs(script, probeRaw, meta, candidates), function (calErr, calOut) {
          var cal = veo.parseCalibration(calOut);
          if (!cal) {
            var calFail = veo.parseCalibrationFailure(calOut);
            if (calFail) return cb(causeErr('not-recognized', 'calibration: ' + calFail.reason + (calFail.presence !== null ? ' (best presence ' + calFail.presence + ')' : '')));
            return cb(causeErr('pipeline', 'calibrate crashed: ' + (calErr ? calErr.message : 'unparseable output')));
          }
          var outPath = src.replace(/(\.[^.]+)$/, '.veoclean$1');
          var dec = childProcess.spawn(ffmpeg, veo.decodeArgs(src), { env: env });
          var flt = childProcess.spawn(deno, veo.filterArgs(script, meta, cal), { env: env });
          var enc = childProcess.spawn(ffmpeg, veo.encodeArgs(src, meta, outPath), { env: env });
          onProc(dec); onProc(flt); onProc(enc);
          dec.stdout.pipe(flt.stdin);
          flt.stdout.pipe(enc.stdin);
          // A dying downstream process EPIPEs the upstream stdin — swallow it
          // (failOnce below reports the real cause from the exit codes).
          flt.stdin.on('error', function () {});
          enc.stdin.on('error', function () {});
          var failed = null;
          function failOnce(e) { if (!failed) { failed = e; try { dec.kill(); flt.kill(); enc.kill(); } catch (x) {} } }
          dec.on('error', failOnce); flt.on('error', failOnce); enc.on('error', failOnce);
          dec.on('close', function (code) { if (code !== 0) failOnce(new Error('decode exited ' + code)); });
          flt.on('close', function (code) { if (code !== 0) failOnce(new Error('filter exited ' + code)); });
          enc.on('close', function (code) {
            if (failed || code !== 0) {
              var base = failed || new Error('encode exited ' + code);
              return cb(base.cleanCause ? base : causeErr('pipeline', base.message));
            }
            var ok = false;
            try { ok = fs.statSync(outPath).size > 0; } catch (e) {}
            if (!ok) return cb(causeErr('pipeline', 'empty output'));
            cb(null, outPath);
          });
        });
      });
    });
    }
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
          size: sizeStr,
          warning: cleanWarning
        });
      }
      if (names.length > 1) onProgress(null, 'Processing ' + (i + 1) + '/' + names.length + '...');
      processOne(names[i], sectionsUsed, function (err, r) {
        if (err) { cleanup(); return cb(err); }
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
    var dest = path.join(opts.outputDir, L.outputFileName(stem, opts));

    try { if (fs.existsSync(dest)) fs.rmSync(dest); } catch (e) {}

    function finish() {
      var bytes = 0;
      try { bytes = fs.statSync(dest).size; } catch (e) {}
      done(null, { path: dest, bytes: bytes });
    }

    function applyAction(act) {
      if (act.action === 'move') {
        try { fs.renameSync(src, dest); return finish(); }
        catch (e) {
          // cross-device fallback
          try { fs.copyFileSync(src, dest); fs.rmSync(src); return finish(); }
          catch (e2) { return done(e2); }
        }
      }
      // ffmpeg action
      onProgress(null, act.note || 'Processing...');
      run(ffmpeg, act.args, env, null, onProc, function (ferr) {
        if (ferr) return done(ferr);
        finish();
      });
    }

    var base = {
      audioOnly: audioOnly, clipEnabled: opts.clipEnabled, startTime: opts.startTime,
      endTime: opts.endTime, needsReencode: vinfo.needsReencode,
      srcExt: srcExt, tgtExt: tgtExt, sectionDownloaded: sectionsUsed
    };
    var localClip = opts.clipEnabled && opts.endTime && !sectionsUsed;

    function continuePost() {
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

    if (wantClean) {
      onProgress(null, 'Removing watermark…');
      cleanFlowWatermark(src, function (cerr, cleanedPath) {
        if (cerr) {
          cleanWarning = veo.warningFor(cerr.cleanCause);
          logCleanFailure(cerr);
          return continuePost();
        }
        // Swap in the cleaned file under the original name so naming,
        // post-process and import all see the file they expect. POSIX rename
        // overwrites atomically; Windows needs the rm-first fallback.
        try {
          try { fs.renameSync(cleanedPath, src); }
          catch (e1) { fs.rmSync(src); fs.renameSync(cleanedPath, src); }
        } catch (e) {
          cleanWarning = veo.WARNING;
          logCleanFailure(causeErr('pipeline', 'cleaned-file swap failed: ' + e.message));
        }
        continuePost();
      });
      return;
    }
    continuePost();
  }

  if (tiktokNative && tiktok.isBlocked()) {
    // This network already blocked TikTok this session — skip the doomed native
    // attempt and resolve straight away.
    tryTikTokResolver(new Error('TikTok is blocked on this network and the mirror could not be reached. Retry in a moment.'));
  } else {
    startAttempt(true);
  }
}

module.exports = { download: download };
