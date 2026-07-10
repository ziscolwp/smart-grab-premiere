// panel/js/settingsView.js
// The Settings screen: populate from saved settings, wire every control
// (destination, cookies, trim, update/repair, version footer), save back.
// deps: { doc, $, state, settingsMod, binaries, metadata, extRoot, cs,
//         evalJSX, onSaved }  — onSaved() runs after a successful Save so
// main.js can refresh the main view.
var browserDetection = require('./browserDetection.js');

function createSettingsView(deps) {
  var $ = deps.$;
  var doc = deps.doc;
  var state = deps.state;
  var settingsMod = deps.settingsMod;
  var binaries = deps.binaries;
  var browserDetector = deps.browserDetection || browserDetection;
  var detectedBrowsers = [];
  var versionShown = false;

  function panelVersion() {
    try {
      var xml = require('fs').readFileSync(deps.extRoot + '/CSXS/manifest.xml', 'utf8');
      var m = xml.match(/ExtensionBundleVersion="([^"]+)"/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  function syncCookiesRows() {
    var mode = $('cookiesMode').value;
    $('cookiesBrowserRow').classList.toggle('hidden', mode !== 'browser');
    $('cookiesFileRow').classList.toggle('hidden', mode !== 'file');
  }

  function refreshBrowserOptions(selected) {
    try {
      detectedBrowsers = browserDetector.detectInstalledBrowsers();
    } catch (e) {
      detectedBrowsers = [];
    }
    $('cookiesBrowser').innerHTML = browserDetector.browserOptionsHtml(detectedBrowsers, selected);
    $('exportBrowser').innerHTML = browserDetector.browserOptionsHtml(detectedBrowsers, selected);
    $('cookiesBrowser').disabled = detectedBrowsers.length === 0;
    $('exportBrowser').disabled = detectedBrowsers.length === 0;
    $('exportCookiesBtn').disabled = detectedBrowsers.length === 0;
  }

  function show() {
    var s = state.settings;
    var selectedBrowser = (s.cookiesBrowser && s.cookiesBrowser !== 'none') ? s.cookiesBrowser : '';
    var radios = doc.getElementsByName('mode');
    for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === s.destinationMode);
    $('customFolder').value = s.customFolder || '';
    $('binName').value = s.binName;
    $('cookiesMode').value = s.cookiesFile ? 'file' : (s.cookiesBrowser && s.cookiesBrowser !== 'none' ? 'browser' : 'none');
    refreshBrowserOptions(selectedBrowser);
    $('cookiesFile').value = s.cookiesFile || '';
    syncCookiesRows();
    $('proxyUrl').value = s.proxyUrl || '';
    $('trimMode').value = s.trimMode || 'fast';
    $('flowDewatermark').checked = s.flowDewatermark !== false;
    $('customRow').classList.toggle('hidden', s.destinationMode !== 'custom');
    $('updateStatus').textContent = '';
    $('cookiesFileStatus').textContent = '';
    if (!versionShown) {
      var v = panelVersion();   // deferred off startup — only read when Settings opens
      $('panelVersion').textContent = 'Smart Grab' + (v ? ' v' + v : '');
      versionShown = true;
    }
    $('mainView').classList.add('hidden'); $('settingsView').classList.remove('hidden');
  }

  function close() {
    $('settingsView').classList.add('hidden'); $('mainView').classList.remove('hidden');
  }

  function stampYtDlpUpdated() {
    state.settings.ytDlpLastUpdate = Date.now();
    settingsMod.save(state.settings);
  }

  $('reportIssueLink').addEventListener('click', function (e) {
    e.preventDefault();
    deps.cs.openURLInDefaultBrowser('https://github.com/ziscolwp/smart-grab-premiere/issues');
  });
  $('backBtn').addEventListener('click', close);

  var radios = doc.getElementsByName('mode');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () { $('customRow').classList.toggle('hidden', this.value !== 'custom'); });
  }
  $('cookiesMode').addEventListener('change', syncCookiesRows);

  $('exportCookiesBtn').addEventListener('click', function () {
    var browser = $('exportBrowser').value;
    if (!browser) {
      $('cookiesFileStatus').textContent = 'No supported browsers found on this device.';
      return;
    }
    var dest = require('path').join(settingsMod.DIR, 'cookies.txt');
    $('cookiesFileStatus').textContent = 'Reading ' + browser + ' cookies… (close the browser if this fails)';
    $('exportCookiesBtn').disabled = true;
    deps.metadata.exportCookies({ extRoot: deps.extRoot, browser: browser, destPath: dest }, function (err, path) {
      $('exportCookiesBtn').disabled = detectedBrowsers.length === 0;
      if (err) { $('cookiesFileStatus').textContent = 'Could not read cookies: ' + err.message; return; }
      $('cookiesFile').value = path;
      $('cookiesFileStatus').textContent = '✓ Cookies file created — hit Save below.';
    });
  });
  $('chooseCookiesBtn').addEventListener('click', function () {
    deps.evalJSX('sg_pickFile()', function (res) {
      if (res && res.indexOf('ERROR:') !== 0 && res !== 'CANCEL') $('cookiesFile').value = res;
    });
  });
  $('clearCookiesBtn').addEventListener('click', function () { $('cookiesFile').value = ''; $('cookiesFileStatus').textContent = ''; });
  $('chooseFolderBtn').addEventListener('click', function () {
    deps.evalJSX('sg_pickFolder()', function (res) {
      if (res && res.indexOf('ERROR:') !== 0 && res !== 'CANCEL') $('customFolder').value = res;
    });
  });

  $('updateYtdlpBtn').addEventListener('click', function () {
    $('updateStatus').textContent = 'Updating yt-dlp…'; $('updateYtdlpBtn').disabled = true;
    binaries.updateYtDlp(function (err) {
      $('updateYtdlpBtn').disabled = false;
      $('updateStatus').textContent = err ? ('Update failed: ' + err.message) : 'Updated ✓';
      if (!err) stampYtDlpUpdated();
    });
  });
  $('repairBtn').addEventListener('click', function () {
    $('repairBtn').disabled = true; $('updateYtdlpBtn').disabled = true;
    binaries.repairAll(deps.extRoot, function (p) {
      $('updateStatus').textContent = 'Downloading ' + p.label + ' (' + p.index + ' of ' + p.total + ')…';
    }, function (err, result) {
      $('repairBtn').disabled = false; $('updateYtdlpBtn').disabled = false;
      $('updateStatus').textContent = err ? err.message : 'All components reinstalled ✓';
      if (result && result.installed.indexOf('yt-dlp') !== -1) stampYtDlpUpdated();
    });
  });

  $('saveSettingsBtn').addEventListener('click', function () {
    var mode = 'sync', radios2 = doc.getElementsByName('mode');
    for (var j = 0; j < radios2.length; j++) if (radios2[j].checked) mode = radios2[j].value;
    state.settings.destinationMode = mode;
    state.settings.customFolder = $('customFolder').value;
    state.settings.binName = $('binName').value || 'Downloaded Video';
    var cmode = $('cookiesMode').value;
    state.settings.cookiesBrowser = (cmode === 'browser' && $('cookiesBrowser').value) ? $('cookiesBrowser').value : 'none';
    state.settings.cookiesFile = cmode === 'file' ? $('cookiesFile').value : '';
    state.settings.proxyUrl = $('proxyUrl').value.replace(/^\s+|\s+$/g, '');
    state.settings.trimMode = $('trimMode').value;
    state.settings.flowDewatermark = $('flowDewatermark').checked;
    settingsMod.save(state.settings);
    if (deps.onSaved) deps.onSaved();
    close();
  });

  return { show: show };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSettingsView: createSettingsView };
}
