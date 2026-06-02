// panel/js/main.js
var cs = new CSInterface();
var extRoot = cs.getSystemPath(SystemPath.EXTENSION);
var engine = require(extRoot + '/js/downloadEngine.js');
var settingsMod = require(extRoot + '/js/settings.js');
var binaries = require(extRoot + '/js/binaries.js');

var $ = function (id) { return document.getElementById(id); };
var state = { settings: settingsMod.load(), proc: null };

// ---------- ExtendScript helpers ----------
function evalJSX(fnCall, cb) { cs.evalScript(fnCall, cb); }
function jsStr(s) { return JSON.stringify(String(s)); }

// ---------- View switching ----------
$('settingsBtn').addEventListener('click', function () { showSettings(); });
$('backBtn').addEventListener('click', function () { $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden'); });

// ---------- Quality => toggle audio/video format ----------
$('quality').addEventListener('change', function () {
  var audio = this.value === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
});

// ---------- Clip toggle ----------
$('clipEnabled').addEventListener('change', function () {
  $('clipRow').classList.toggle('hidden', !this.checked);
});

// ---------- Paste ----------
$('pasteBtn').addEventListener('click', function () {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function (t) { if (t) $('url').value = t.trim(); });
  }
});

// ---------- Restore last-used options ----------
function applySettingsToUI() {
  var s = state.settings;
  $('quality').value = s.lastQuality;
  $('videoFormat').value = s.lastVideoFormat;
  $('audioFormat').value = s.lastAudioFormat;
  var audio = s.lastQuality === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
  $('destHint').textContent = s.destinationMode === 'sync'
    ? 'Saving to: "' + s.binName + '" folder next to the project'
    : 'Saving to: ' + s.customFolder;
}

// ---------- Settings view ----------
function showSettings() {
  var s = state.settings;
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === s.destinationMode);
  $('customFolder').value = s.customFolder || '';
  $('binName').value = s.binName;
  $('customRow').classList.toggle('hidden', s.destinationMode !== 'custom');
  $('updateStatus').textContent = '';
  $('mainView').classList.add('hidden');
  $('settingsView').classList.remove('hidden');
}

(function wireSettings() {
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () {
      $('customRow').classList.toggle('hidden', this.value !== 'custom');
    });
  }
  $('chooseFolderBtn').addEventListener('click', function () {
    evalJSX('sg_pickFolder()', function (res) {
      if (res && res.indexOf('ERROR:') !== 0 && res !== 'CANCEL') $('customFolder').value = res;
    });
  });
  $('updateYtdlpBtn').addEventListener('click', function () {
    $('updateStatus').textContent = 'Updating yt-dlp…';
    $('updateYtdlpBtn').disabled = true;
    binaries.updateYtDlp(function (err, dest) {
      $('updateYtdlpBtn').disabled = false;
      $('updateStatus').textContent = err ? ('Update failed: ' + err.message) : ('Updated: ' + dest);
    });
  });
  $('saveSettingsBtn').addEventListener('click', function () {
    var mode = 'sync';
    var radios2 = document.getElementsByName('mode');
    for (var j = 0; j < radios2.length; j++) if (radios2[j].checked) mode = radios2[j].value;
    state.settings.destinationMode = mode;
    state.settings.customFolder = $('customFolder').value;
    state.settings.binName = $('binName').value || 'Downloaded Video';
    settingsMod.save(state.settings);
    applySettingsToUI();
    $('settingsView').classList.add('hidden');
    $('mainView').classList.remove('hidden');
  });
})();

// ---------- Download flow ----------
function setBusy(busy) {
  $('downloadBtn').disabled = busy;
  $('cancelBtn').classList.toggle('hidden', !busy);
}
function showError(msg) {
  $('errorDetail').textContent = msg;
  $('errorBox').classList.remove('hidden');
}
function clearOutputs() {
  $('errorBox').classList.add('hidden');
  $('successBox').classList.add('hidden');
  $('progressWrap').classList.remove('hidden');
}

$('copyErrBtn').addEventListener('click', function () {
  if (navigator.clipboard) navigator.clipboard.writeText($('errorDetail').textContent);
});
$('cancelBtn').addEventListener('click', function () {
  if (state.proc) { try { state.proc.kill(); } catch (e) {} }
  setBusy(false);
  $('statusMsg').textContent = 'Cancelled';
});

function resolveOutputDir(cb) {
  var s = state.settings;
  if (s.destinationMode === 'custom') {
    if (!s.customFolder) return cb(new Error('No custom folder set. Open Settings and choose one.'));
    return cb(null, s.customFolder);
  }
  // sync mode: project dir + bin-named subfolder
  evalJSX('sg_getProjectDir()', function (res) {
    if (!res || res.indexOf('ERROR:') === 0) return cb(new Error(res ? res.substring(6) : 'Could not read project.'));
    var sep = res.indexOf('\\') !== -1 ? '\\' : '/';
    cb(null, res + sep + s.binName);
  });
}

function persistLastOptions(opts) {
  state.settings.lastQuality = opts.quality;
  state.settings.lastVideoFormat = opts.videoFormat;
  state.settings.lastAudioFormat = opts.audioFormat;
  settingsMod.save(state.settings);
}

$('downloadBtn').addEventListener('click', function () {
  var url = $('url').value.replace(/^\s+|\s+$/g, '');
  if (!url) { showError('Enter a video URL first.'); return; }

  clearOutputs();
  setBusy(true);
  $('progressBar').style.width = '0%';
  $('statusMsg').textContent = 'Preparing…';

  resolveOutputDir(function (derr, outputDir) {
    if (derr) { setBusy(false); $('progressWrap').classList.add('hidden'); showError(derr.message); return; }

    var opts = {
      url: url, outputDir: outputDir, extRoot: extRoot,
      quality: $('quality').value,
      videoFormat: $('videoFormat').value,
      audioFormat: $('audioFormat').value,
      clipEnabled: $('clipEnabled').checked,
      startTime: $('startTime').value,
      endTime: $('endTime').value
    };
    persistLastOptions(opts);

    engine.download(opts, {
      onProgress: function (pct, status) {
        if (pct !== null && pct !== undefined) $('progressBar').style.width = pct + '%';
        if (status) $('statusMsg').textContent = status;
      },
      onProc: function (p) { state.proc = p; }
    }, function (err, res) {
      state.proc = null;
      setBusy(false);
      if (err) { $('progressWrap').classList.add('hidden'); showError(err.message); return; }

      $('statusMsg').textContent = 'Importing into project…';
      evalJSX('sg_importToBin(' + jsStr(res.path) + ', ' + jsStr(state.settings.binName) + ')', function (importRes) {
        $('progressWrap').classList.add('hidden');
        if (importRes === 'OK') {
          $('successText').textContent = 'Imported into "' + state.settings.binName + '" — ' + res.size;
          $('successBox').classList.remove('hidden');
        } else {
          showError('Downloaded to:\n' + res.path + '\n\nbut import failed:\n' + (importRes || 'unknown') + '\n\nDrag it in manually.');
        }
      });
    });
  });
});

// ---------- Init ----------
applySettingsToUI();
