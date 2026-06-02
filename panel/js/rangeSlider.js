// panel/js/rangeSlider.js
// Dual-handle range slider for clip start/end (in seconds). DOM-coupled but isolated;
// `doc` is passed in so it has no hard global dependency.
var timecode = require('./timecode.js');

// create(doc, container, durationSec, onChange) -> { getRange: () => {start,end} }
function create(doc, container, durationSec, onChange) {
  container.innerHTML = '';
  durationSec = Math.max(1, Math.floor(durationSec || 1));

  var wrap = doc.createElement('div'); wrap.className = 'rs-wrap';
  var track = doc.createElement('div'); track.className = 'rs-track';
  var sel = doc.createElement('div'); sel.className = 'rs-sel';
  track.appendChild(sel);
  var startInput = doc.createElement('input');
  var endInput = doc.createElement('input');
  [startInput, endInput].forEach(function (inp) {
    inp.type = 'range'; inp.min = 0; inp.max = durationSec; inp.step = 1; inp.className = 'rs-input';
  });
  startInput.value = 0; endInput.value = durationSec;
  var labels = doc.createElement('div'); labels.className = 'rs-labels';
  var startLbl = doc.createElement('span'), lenLbl = doc.createElement('span'), endLbl = doc.createElement('span');
  labels.appendChild(startLbl); labels.appendChild(lenLbl); labels.appendChild(endLbl);

  wrap.appendChild(track); wrap.appendChild(startInput); wrap.appendChild(endInput); wrap.appendChild(labels);
  container.appendChild(wrap);

  function current() {
    return timecode.clampRange(parseInt(startInput.value, 10), parseInt(endInput.value, 10), durationSec);
  }

  function paint() {
    var s = parseInt(startInput.value, 10), e = parseInt(endInput.value, 10);
    if (s > e) {
      if (doc.activeElement === startInput) { e = s; endInput.value = e; }
      else { s = e; startInput.value = s; }
    }
    var leftPct = (s / durationSec) * 100, rightPct = (e / durationSec) * 100;
    sel.style.left = leftPct + '%';
    sel.style.width = (rightPct - leftPct) + '%';
    startLbl.textContent = 'Start ' + timecode.secondsToHMS(s);
    endLbl.textContent = 'End ' + timecode.secondsToHMS(e);
    lenLbl.textContent = 'Length ' + timecode.secondsToHMS(e - s);
    if (onChange) onChange(s, e);
  }

  startInput.addEventListener('input', paint);
  endInput.addEventListener('input', paint);
  paint();

  return { getRange: current };
}

module.exports = { create: create };
