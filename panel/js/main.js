// panel/js/main.js
var cs = new CSInterface();
var extRoot = cs.getSystemPath(SystemPath.EXTENSION);
var childProcess = require('child_process');
var engine = require(extRoot + '/js/downloadEngine.js');
var settingsMod = require(extRoot + '/js/settings.js');
var binaries = require(extRoot + '/js/binaries.js');
var setupLogic = require(extRoot + '/js/setupLogic.js');
var setupBannerMod = require(extRoot + '/js/setupBanner.js');
var settingsViewMod = require(extRoot + '/js/settingsView.js');
var clipboard = require(extRoot + '/js/clipboard.js');
var editKeys = require(extRoot + '/js/editKeys.js');
var timecode = require(extRoot + '/js/timecode.js');
var urls = require(extRoot + '/js/urls.js');
var metadata = require(extRoot + '/js/metadata.js');
var rangeSlider = require(extRoot + '/js/rangeSlider.js');
var queueMod = require(extRoot + '/js/queue.js');
var queueRender = require(extRoot + '/js/queueRender.js');

var $ = function (id) { return document.getElementById(id); };
var state = { settings: settingsMod.load() };
var idCounter = 0;
var clip = { slider: null, durationSec: null };

function evalJSX(fnCall, cb) { cs.evalScript(fnCall, cb); }
function jsStr(s) { return JSON.stringify(String(s)); }
function cookieOpts() {
  return { extRoot: extRoot, cookiesBrowser: state.settings.cookiesBrowser, cookiesFile: state.settings.cookiesFile, proxyUrl: state.settings.proxyUrl };
}
function cookiesActive() {
  return !!state.settings.cookiesFile || (state.settings.cookiesBrowser && state.settings.cookiesBrowser !== 'none');
}

// ---------- Premiere bridge ----------
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
// Import one or more files in a single host round-trip. paths is an array (the
// queue batches a post's media together); a bare string is tolerated. The paths
// are emitted as an ExtendScript array literal — jsStr escapes each one (incl.
// Windows backslashes), so no JSON parser is needed on the ES3 host side.
function importFile(paths, cb) {
  var arr = Array.isArray(paths) ? paths : [paths];
  var literal = '[';
  for (var i = 0; i < arr.length; i++) literal += (i ? ',' : '') + jsStr(arr[i]);
  literal += ']';
  evalJSX('sg_importToBin(' + literal + ', ' + jsStr(state.settings.binName) + ')', function (r) {
    cb(r === 'OK' ? null : new Error(r || 'import failed'));
  });
}
function revealFile(p) {
  try {
    if (process.platform === 'win32') childProcess.spawn('explorer', ['/select,' + p]);
    else childProcess.spawn('open', ['-R', p]);
  } catch (e) {}
}

// ---------- The queue ----------
var queue = queueMod.createQueue({
  extRoot: extRoot,
  makeId: function () { return 'q' + (++idCounter); },
  onChange: renderQueue,
  fetchInfo: function (url, cb) {
    metadata.fetchInfo(url, cookieOpts(), cb);
  },
  resolveOutputDir: resolveOutputDir,
  importFile: importFile,
  download: engine.download,
  titleConcurrency: 4
});

function renderQueue(items) {
  $('queueCount').textContent = queueRender.summary(items);
  queueRender.render(document, $('queueList'), items, {
    cancel: function (id) { queue.cancel(id); },
    remove: function (id) { queue.remove(id); },
    retry: function (id) { queue.retry(id); },
    reveal: function (id) {
      var its = queue.getItems();
      for (var i = 0; i < its.length; i++) {
        if (its[i].id === id && its[i].outputPath) revealFile(its[i].outputPath);
      }
    }
  });
}

// ---------- Setup health banner (self-healing — see setupBanner.js) ----------
var setupBanner = setupBannerMod.createSetupBanner({
  el: {
    banner: $('setupBanner'),
    text: $('setupBannerText'),
    progress: $('setupProgress'),
    fill: $('setupProgressFill'),
    retryBtn: $('setupFixBtn')
  },
  binaries: binaries,
  setupLogic: setupLogic,
  settingsMod: settingsMod,
  state: state,
  extRoot: extRoot
});

// ---------- View switching (settings screen lives in settingsView.js) ----------
$('settingsBtn').addEventListener('click', function () { settingsView.show(); });
$('destChange').addEventListener('click', function (e) { e.preventDefault(); settingsView.show(); });

// ---------- Quality => format toggle ----------
$('quality').addEventListener('change', function () {
  var audio = this.value === 'audioOnly';
  $('videoFormat').classList.toggle('hidden', audio);
  $('audioFormat').classList.toggle('hidden', !audio);
});

// ---------- URL field: live meta line + clip availability ----------
function updateUrlMeta() {
  var list = urls.parse($('url').value);
  var meta = $('urlMeta');
  $('addBtn').textContent = list.length > 1 ? 'Add ' + list.length + ' to Queue' : 'Add to Queue';
  if (!list.length) { meta.innerHTML = ''; updateClipAvailability(list); return; }

  var counts = {}, order = [];
  list.forEach(function (u) {
    var s = urls.source(u);
    if (!counts[s.label]) { counts[s.label] = 0; order.push(s); }
    counts[s.label]++;
  });
  var bits = order.map(function (s) {
    return s.label + (counts[s.label] > 1 ? ' ×' + counts[s.label] : '');
  });
  var html = list.length + (list.length === 1 ? ' link' : ' links') + ' — ' + bits.join(', ');
  var needsCookies = order.some(function (s) { return urls.usuallyNeedsCookies(s.key); });
  if (needsCookies && !cookiesActive()) {
    html += ' <span class="warn">· may need browser cookies (Settings)</span>';
  }
  meta.innerHTML = html;
  updateClipAvailability(list);
}
$('url').addEventListener('input', updateUrlMeta);

// ---------- Clip section ----------
function updateClipAvailability(list) {
  var single = list.length === 1;
  $('clipHint').textContent = single ? '' : '(single link only)';
  if (!single && $('clipEnabled').checked) {
    $('clipEnabled').checked = false;
    $('clipRow').classList.add('hidden');
  }
}
$('clipEnabled').addEventListener('change', function () {
  var list = urls.parse($('url').value);
  if (this.checked && list.length !== 1) {
    this.checked = false;
    $('topStatus').textContent = 'Trimming works with a single link — paste one URL.';
    return;
  }
  $('topStatus').textContent = '';
  $('clipRow').classList.toggle('hidden', !this.checked);
  if (this.checked) setupClip(list[0]);
});

function setManualTimes(s, e) {
  $('startTime').value = timecode.secondsToHMS(s);
  $('endTime').value = timecode.secondsToHMS(e);
}
function setupClip(oneUrl) {
  $('clipSlider').innerHTML = '<div class="empty">Reading video length…</div>';
  clip.slider = null; clip.durationSec = null;
  metadata.fetchInfo(oneUrl, cookieOpts(), function (err, info) {
    if (err || !info.durationSec) {
      $('clipSlider').innerHTML = '<div class="empty">Couldn\'t read the length — type the times below.</div>';
      return;
    }
    clip.durationSec = info.durationSec;
    setManualTimes(0, info.durationSec);
    clip.slider = rangeSlider.create(document, $('clipSlider'), info.durationSec, setManualTimes);
  });
}
function manualTimesChanged() {
  var s = timecode.parseFlexible($('startTime').value);
  var e = timecode.parseFlexible($('endTime').value);
  if (s == null || e == null) return;
  if (clip.slider) clip.slider.setRange(s, e); // slider re-syncs the fields, clamped
}
$('startTime').addEventListener('change', manualTimesChanged);
$('endTime').addEventListener('change', manualTimesChanged);

// ---------- Paste button + keyboard shortcuts ----------
$('pasteBtn').addEventListener('click', function () {
  var t = clipboard.read();
  if (t) { $('url').value = t.replace(/^\s+|\s+$/g, ''); updateUrlMeta(); }
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
  if (el.id === 'url') updateUrlMeta();
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
    ? 'Saving to "' + s.binName + '" next to the project'
    : 'Saving to ' + (s.customFolder || 'custom folder');
}
var settingsView = settingsViewMod.createSettingsView({
  doc: document,
  $: $,
  state: state,
  settingsMod: settingsMod,
  binaries: binaries,
  metadata: metadata,
  extRoot: extRoot,
  cs: cs,
  evalJSX: evalJSX,
  onSaved: function () { applySettingsToUI(); updateUrlMeta(); }
});

// ---------- Build per-item options snapshot ----------
function currentOpts(allowClip) {
  var o = {
    quality: $('quality').value,
    videoFormat: $('videoFormat').value,
    audioFormat: $('audioFormat').value,
    cookiesBrowser: state.settings.cookiesBrowser,
    cookiesFile: state.settings.cookiesFile,
    proxyUrl: state.settings.proxyUrl,
    trimMode: state.settings.trimMode,
    clipEnabled: false
  };
  if (allowClip && $('clipEnabled').checked) {
    var startSec = timecode.parseFlexible($('startTime').value);
    var endSec = timecode.parseFlexible($('endTime').value);
    if (clip.slider) { var r = clip.slider.getRange(); startSec = r.start; endSec = r.end; }
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
  if (!list.length) { $('topStatus').textContent = 'Paste at least one video link first.'; return; }
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
      updateUrlMeta();
    }
  }

  list.forEach(function (u) {
    var kind = urls.classify(u);
    if (kind === 'playlist' || kind === 'channel') {
      $('topStatus').textContent = 'Expanding playlist…';
      metadata.expandPlaylist(u, cookieOpts(), function (err, entries) {
        if (err || !entries.length) { $('topStatus').textContent = 'Playlist error: ' + (err ? err.message : 'empty'); done(); return; }
        if (entries.length >= 50 && !window.confirm('This playlist has ' + entries.length + ' videos. Add all of them?')) { done(); return; }
        entries.forEach(function (en) {
          toAdd.push({ url: en.url, opts: {
            quality: opts.quality, videoFormat: opts.videoFormat, audioFormat: opts.audioFormat,
            cookiesBrowser: opts.cookiesBrowser, cookiesFile: opts.cookiesFile, proxyUrl: opts.proxyUrl, trimMode: opts.trimMode, clipEnabled: false
          } });
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
updateUrlMeta();
renderQueue(queue.getItems());
setupBanner.init();
