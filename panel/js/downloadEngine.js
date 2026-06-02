// panel/js/downloadEngine.js
// Orchestrates the download pipeline: yt-dlp -> validate -> post-process -> move.
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var L = require('./engineLogic.js');
var binaries = require('./binaries.js');

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
    if (recent.length > 8) recent.shift();
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
    var detail = (meaningful.length ? meaningful : recent).slice(-4).join('\n');
    done(new Error(path.basename(exe) + ' failed:\n' + (detail || 'unknown error')));
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

// opts: { url, outputDir, quality, videoFormat, audioFormat, clipEnabled, startTime, endTime, extRoot }
// callbacks: { onProgress(percent,status), onProc(proc) }
// cb(err, { path, size })
function download(opts, callbacks, cb) {
  callbacks = callbacks || {};
  var onProgress = callbacks.onProgress || function () {};
  var onProc = callbacks.onProc || function () {};

  var ytdlp = binaries.resolveBinary('yt-dlp', { extRoot: opts.extRoot });
  var ffmpeg = binaries.resolveBinary('ffmpeg', { extRoot: opts.extRoot });
  if (!ytdlp) return cb(new Error('yt-dlp not found. Click "Update yt-dlp" or install it.'));
  if (!ffmpeg) return cb(new Error('ffmpeg not found. Re-run the installer or `brew install ffmpeg`.'));
  var ffprobe = binaries.resolveBinary('ffprobe', { extRoot: opts.extRoot }) || ffmpeg;
  var ffmpegDir = path.dirname(ffmpeg);
  var env = binaries.augmentedEnv(process.env);

  var tmp = path.join(os.tmpdir(), 'smartgrab-' + uuidish());
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(opts.outputDir, { recursive: true });
  } catch (e) { return cb(e); }

  function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  var audioOnly = opts.quality === 'audioOnly';
  var vinfo = L.videoFormatInfo(opts.videoFormat);
  var args = L.buildYtDlpArgs(opts, tmp, ffmpegDir, opts.url);

  onProgress(0, 'Downloading...');
  run(ytdlp, args, env, function (line) {
    var p = L.parseProgress(line);
    if (p) onProgress(p.percent, p.status);
  }, onProc, function (err) {
    if (err) { cleanup(); return cb(err); }

    var files;
    try {
      files = fs.readdirSync(tmp).filter(function (f) {
        return f.indexOf('.part') === -1 && f.indexOf('.ytdl') === -1;
      });
    } catch (e) { cleanup(); return cb(e); }

    if (files.length === 0) { cleanup(); return cb(new Error('Download failed — no output file.')); }
    if (files.length > 1) {
      cleanup();
      return cb(new Error('Merge failed — yt-dlp left ' + files.length + ' separate streams. ffmpeg may not be reachable.'));
    }

    var name = files[0];
    var src = path.join(tmp, name);
    var stem = path.basename(name, path.extname(name));
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
      onProgress(null, 'Processing...');
      run(ffmpeg, act.args, env, null, onProc, function (ferr) {
        if (ferr) { cleanup(); return cb(ferr); }
        finish();
      });
    }

    // Build the post-process descriptor. For reencode formats we need codecs first.
    if (!audioOnly && vinfo.needsReencode && !(opts.clipEnabled && opts.endTime)) {
      probeCodec(ffprobe, src, 'v:0', env, function (vc) {
        probeCodec(ffprobe, src, 'a:0', env, function (ac) {
          applyAction(L.choosePostProcess({
            audioOnly: audioOnly, clipEnabled: opts.clipEnabled, startTime: opts.startTime, endTime: opts.endTime,
            needsReencode: vinfo.needsReencode, srcExt: srcExt, tgtExt: tgtExt, vcodec: vc, acodec: ac
          }, src, dest));
        });
      });
    } else {
      applyAction(L.choosePostProcess({
        audioOnly: audioOnly, clipEnabled: opts.clipEnabled, startTime: opts.startTime, endTime: opts.endTime,
        needsReencode: vinfo.needsReencode, srcExt: srcExt, tgtExt: tgtExt
      }, src, dest));
    }
  });
}

module.exports = { download: download };
