// panel/js/main.js
var cs = new CSInterface();
var extRoot = cs.getSystemPath(SystemPath.EXTENSION);
var engine = require(extRoot + '/js/downloadEngine.js');
var settingsMod = require(extRoot + '/js/settings.js');
var binaries = require(extRoot + '/js/binaries.js');
var clipboard = require(extRoot + '/js/clipboard.js');
var editKeys = require(extRoot + '/js/editKeys.js');
var timecode = require(extRoot + '/js/timecode.js');
var urls = require(extRoot + '/js/urls.js');
var metadata = require(extRoot + '/js/metadata.js');
var rangeSlider = require(extRoot + '/js/rangeSlider.js');
var queueMod = require(extRoot + '/js/queue.js');

var $ = function (id) { return document.getElementById(id); };
var state = { settings: settingsMod.load() };
var idCounter = 0;
var clip = { slider: null, durationSec: null, startSec: 0, endSec: 0 };

function evalJSX(fnCall, cb) { cs.evalScript(fnCall, cb); }
function jsStr(s) { return JSON.stringify(String(s)); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------- The queue ----------
function resolveOutputDir(opts, cb) {
  var s = state.settings;
  if (s.destinationMode === 'custom') {
    if (!s.customFolder) return cb(new Error('No custom folder set. Open Settings and choose one.'));
    return cb(null, s.customFolder);
  }
  evalJSX('sg_getProjectDir()', function (res) {
    if (!res || res.indexOf('ERROR:') === 0) return cb(new Error(res ? res.substring(6) : 'Could not read project.'));
    var sep = res.indexOf('\\') !== -1 ? '\\' : '/';
    cb(null, res + sep + s.binName);
  });
}
function importFile(path, cb) {
  evalJSX('sg_importToBin(' + jsStr(path) + ', ' + jsStr(state.settings.binName) + ')', function (r) {
    cb(r === 'OK' ? null : new Error(r || 'import failed'));
  });
}
var queue = queueMod.createQueue({
  extRoot: extRoot,
  makeId: function () { return 'q' + (++idCounter); },
  onChange: renderQueue,
  fetchInfo: function (url, cb) { metadata.fetchInfo(url, extRoot, cb); },
  resolveOutputDir: resolveOutputDir,
  importFile: importFile,
  download: engine.download,
  titleConcurrency: 4
});

function badge(it) {
  switch (it.status) {
    case 'pending': return 'Waiting…';
    case 'fetching-info': return 'Getting title…';
    case 'queued': return 'Queued';
    case 'downloading': return it.statusMsg || 'Downloading…';
    case 'done': return '✓ ' + (it.statusMsg || 'Done');
    case 'error': return '⚠ ' + (it.statusMsg || 'Failed');
    case 'canceled': return 'Canceled';
    default: return it.status;
  }
}
function renderQueue(items) {
  var el = $('queueList');
  if (!items.length) { el.innerHTML = '<div class="empty">Nothing queued yet.</div>'; return; }
  el.innerHTML = '';
  items.forEach(function (it) {
    var row = document.createElement('div');
    row.className = 'qitem' + (it.status === 'downloading' ? ' active' : '');
    var dur = it.durationSec != null ? timecode.secondsToHMS(it.durationSec) : '';
    var statusClass = it.status === 'error' ? ' error' : (it.status === 'done' ? ' done' : '');
    var showProgress = it.status === 'downloading';
    var btn = it.status === 'downloading'
      ? '<button class="qbtn" data-cancel="' + it.id + '" title="Cancel">✕</button>'
      : '<button class="qbtn" data-remove="' + it.id + '" title="Remove">🗑</button>';
    row.innerHTML =
      '<div class="qtop"><span class="qtitle">' + escHtml(it.title || it.url) + '</span>' +
      '<span class="qdur">' + dur + '</span></div>' +
      (showProgress ? '<div class="progress-track"><div class="progress-bar" style="width:' + (it.progress || 0) + '%"></div></div>' : '') +
      '<div class="qmeta"><span class="qstatus' + statusClass + '">' + escHtml(badge(it)) + '</span>' + btn + '</div>';
    el.appendChild(row);
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-cancel]'), function (b) {
    b.addEventListener('click', function () { queue.cancel(b.getAttribute('data-cancel')); });
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-remove]'), function (b) {
    b.addEventListener('click', function () { queue.remove(b.getAttribute('data-remove')); });
  });
}

// ---------- View switching ----------
$('settingsBtn').addEventListener('click', showSettings);
$('backBtn').addEventListener('click', function () { $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden'); });

// ---------- Quality => format toggle ----------
$('quality').addEventListener('change', function () {
  var audio = this.value === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
});

// ---------- Clip toggle => set up slider for the single URL ----------
$('clipEnabled').addEventListener('change', function () {
  $('clipRow').classList.toggle('hidden', !this.checked);
  if (this.checked) setupClip();
});
function singleUrlOrNull() {
  var list = urls.parse($('url').value);
  return list.length === 1 ? list[0] : null;
}
function setupClip() {
  $('clipSlider').innerHTML = '';
  $('clipManual').classList.add('hidden');
  clip.slider = null; clip.durationSec = null;
  var one = singleUrlOrNull();
  if (!one) { $('clipSlider').innerHTML = '<div class="empty">Add a single URL to trim it.</div>'; return; }
  $('clipSlider').innerHTML = '<div class="empty">Reading video length…</div>';
  metadata.fetchInfo(one, extRoot, function (err, info) {
    if (err || !info.durationSec) {
      $('clipSlider').innerHTML = '<div class="empty">Couldn\'t read length — enter manually:</div>';
      $('clipManual').classList.remove('hidden');
      return;
    }
    clip.durationSec = info.durationSec;
    clip.startSec = 0; clip.endSec = info.durationSec;
    clip.slider = rangeSlider.create(document, $('clipSlider'), info.durationSec, function (s, e) {
      clip.startSec = s; clip.endSec = e;
    });
  });
}

// ---------- Paste button + keyboard shortcuts ----------
$('pasteBtn').addEventListener('click', function () {
  var t = clipboard.read();
  if (t) $('url').value = t.replace(/^\s+|\s+$/g, '');
});
document.addEventListener('keydown', function (e) {
  var action = editKeys.editAction(e);
  if (!action) return;
  var el = document.activeElement;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
  var start = el.selectionStart == null ? el.value.length : el.selectionStart;
  var end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
  if (action === 'selectAll') { e.preventDefault(); el.select(); return; }
  if (action === 'copy') { e.preventDefault(); clipboard.write(el.value.slice(start, end)); return; }
  if (el.readOnly) return;
  if (action === 'paste') {
    e.preventDefault();
    var raw = clipboard.read();
    var clipText = el.tagName === 'INPUT' ? raw.replace(/[\r\n]+/g, '') : raw; // keep newlines in the URL textarea
    if (clipText) {
      var r = editKeys.applyPaste(el.value, start, end, clipText);
      el.value = r.value; el.setSelectionRange(r.caret, r.caret);
    }
  } else if (action === 'cut') {
    e.preventDefault();
    var c = editKeys.applyCut(el.value, start, end);
    clipboard.write(c.removed); el.value = c.value; el.setSelectionRange(c.caret, c.caret);
  }
});

// ---------- Settings ----------
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
function showSettings() {
  var s = state.settings;
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === s.destinationMode);
  $('customFolder').value = s.customFolder || '';
  $('binName').value = s.binName;
  $('customRow').classList.toggle('hidden', s.destinationMode !== 'custom');
  $('updateStatus').textContent = '';
  $('mainView').classList.add('hidden'); $('settingsView').classList.remove('hidden');
}
(function wireSettings() {
  var radios = document.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () { $('customRow').classList.toggle('hidden', this.value !== 'custom'); });
  }
  $('chooseFolderBtn').addEventListener('click', function () {
    evalJSX('sg_pickFolder()', function (res) {
      if (res && res.indexOf('ERROR:') !== 0 && res !== 'CANCEL') $('customFolder').value = res;
    });
  });
  $('updateYtdlpBtn').addEventListener('click', function () {
    $('updateStatus').textContent = 'Updating yt-dlp…'; $('updateYtdlpBtn').disabled = true;
    binaries.updateYtDlp(function (err, dest) {
      $('updateYtdlpBtn').disabled = false;
      $('updateStatus').textContent = err ? ('Update failed: ' + err.message) : ('Updated: ' + dest);
    });
  });
  $('saveSettingsBtn').addEventListener('click', function () {
    var mode = 'sync', radios2 = document.getElementsByName('mode');
    for (var j = 0; j < radios2.length; j++) if (radios2[j].checked) mode = radios2[j].value;
    state.settings.destinationMode = mode;
    state.settings.customFolder = $('customFolder').value;
    state.settings.binName = $('binName').value || 'Downloaded Video';
    settingsMod.save(state.settings);
    applySettingsToUI();
    $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden');
  });
})();

// ---------- Build per-item options snapshot ----------
function currentOpts(allowClip) {
  var o = {
    quality: $('quality').value,
    videoFormat: $('videoFormat').value,
    audioFormat: $('audioFormat').value,
    clipEnabled: false
  };
  if (allowClip && $('clipEnabled').checked) {
    var startSec, endSec;
    if (clip.slider) { var r = clip.slider.getRange(); startSec = r.start; endSec = r.end; }
    else { startSec = timecode.parseFlexible($('startTime').value); endSec = timecode.parseFlexible($('endTime').value); }
    if (startSec != null && endSec != null && endSec > startSec) {
      o.clipEnabled = true;
      o.startTime = timecode.secondsToHMS(startSec);
      o.endTime = timecode.secondsToHMS(endSec);
    }
  }
  return o;
}
function persistLastOptions(o) {
  state.settings.lastQuality = o.quality;
  state.settings.lastVideoFormat = o.videoFormat;
  state.settings.lastAudioFormat = o.audioFormat;
  settingsMod.save(state.settings);
}

// ---------- Add to queue ----------
$('addBtn').addEventListener('click', function () {
  var list = urls.parse($('url').value);
  if (!list.length) { $('topStatus').textContent = 'Paste at least one video URL.'; return; }
  var single = list.length === 1;
  var opts = currentOpts(single);
  persistLastOptions(opts);

  var toAdd = [];
  var pending = list.length;
  $('topStatus').textContent = 'Adding…';

  function done() {
    pending--;
    if (pending === 0) {
      queue.addUrls(toAdd);
      $('topStatus').textContent = '';
      $('url').value = '';
      $('clipEnabled').checked = false; $('clipRow').classList.add('hidden');
    }
  }

  list.forEach(function (u) {
    var kind = urls.classify(u);
    if (kind === 'playlist' || kind === 'channel') {
      $('topStatus').textContent = 'Expanding playlist…';
      metadata.expandPlaylist(u, extRoot, function (err, entries) {
        if (err || !entries.length) { $('topStatus').textContent = 'Playlist error: ' + (err ? err.message : 'empty'); done(); return; }
        if (entries.length >= 50 && !window.confirm('This playlist has ' + entries.length + ' videos. Add all of them?')) { done(); return; }
        entries.forEach(function (en) {
          toAdd.push({ url: en.url, opts: { quality: opts.quality, videoFormat: opts.videoFormat, audioFormat: opts.audioFormat, clipEnabled: false } });
        });
        done();
      });
    } else {
      toAdd.push({ url: u, opts: opts });
      done();
    }
  });
});
$('cancelAllBtn').addEventListener('click', function () { queue.cancelAll(); });
$('clearDoneBtn').addEventListener('click', function () { queue.clearDone(); });

// ---------- Init ----------
applySettingsToUI();
renderQueue(queue.getItems());
