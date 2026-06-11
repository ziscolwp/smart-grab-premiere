// panel/js/setupBanner.js
// Drives the self-healing setup banner: on launch, anything missing gets
// downloaded automatically with a real progress bar; failures get a friendly
// Retry; a stale yt-dlp refreshes silently in the background. All decisions
// (URLs, plan, staleness, copy) live in setupLogic.js — this is DOM glue.
//
// deps: { el: { banner, text, progress, fill, retryBtn },
//         binaries, setupLogic, settingsMod, state, extRoot, now? }
function createSetupBanner(deps) {
  var el = deps.el;
  var binaries = deps.binaries;
  var setupLogic = deps.setupLogic;
  var now = deps.now || function () { return Date.now(); };
  var running = false;

  function missingBinaries() {
    var missing = [];
    for (var i = 0; i < setupLogic.REQUIRED.length; i++) {
      var name = setupLogic.REQUIRED[i];
      if (!binaries.resolveBinary(name, { extRoot: deps.extRoot })) missing.push(name);
    }
    return missing;
  }

  function show(text, withProgress, withRetry) {
    el.banner.classList.remove('hidden');
    el.text.textContent = text;
    el.progress.classList.toggle('hidden', !withProgress);
    el.retryBtn.classList.toggle('hidden', !withRetry);
  }

  function hide() { el.banner.classList.add('hidden'); }

  function setProgress(p) {
    var overall = ((p.index - 1) + (p.percent || 0) / 100) / p.total;
    el.fill.style.width = Math.round(overall * 100) + '%';
    el.text.textContent = setupLogic.progressText(p.label, p.index, p.total);
  }

  function stampYtDlpUpdated() {
    deps.state.settings.ytDlpLastUpdate = now();
    deps.settingsMod.save(deps.state.settings);
  }

  function runSetup() {
    if (running) return;
    running = true;
    show('Setting up…', true, false);
    el.fill.style.width = '0%';
    binaries.ensureAll(deps.extRoot, setProgress, function (err, result) {
      running = false;
      if (result && result.installed.indexOf('yt-dlp') !== -1) stampYtDlpUpdated();
      if (err) { show(err.message, false, true); return; }
      hide();
    });
  }

  // Silent background refresh — never any UI, never blocks the panel. A
  // failure just means we try again next open.
  function maybeRefreshYtDlp() {
    if (running) return;
    if (!binaries.resolveBinary('yt-dlp', { extRoot: deps.extRoot })) return;
    if (!setupLogic.isYtDlpStale(deps.state.settings.ytDlpLastUpdate, now())) return;
    binaries.updateYtDlp(function (err) {
      if (!err) stampYtDlpUpdated();
    });
  }

  function init() {
    if (missingBinaries().length) runSetup();
    else { hide(); maybeRefreshYtDlp(); }
  }

  el.retryBtn.addEventListener('click', runSetup);

  return { init: init, runSetup: runSetup, missingBinaries: missingBinaries };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSetupBanner: createSetupBanner };
}
