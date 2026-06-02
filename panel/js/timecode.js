// panel/js/timecode.js
function pad2(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }

function secondsToHMS(sec) {
  sec = Math.floor(Number(sec));
  if (isNaN(sec) || sec < 0) sec = 0;
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function clampRange(start, end, dur) {
  start = Math.max(0, Math.min(Math.round(start), dur));
  end = Math.max(0, Math.min(Math.round(end), dur));
  if (end < start) end = start;
  return { start: start, end: end };
}

function parseFlexible(str) {
  if (str == null) return null;
  var s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (/[hms]/.test(s)) {
    var nl = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!nl) return null;
    return (parseInt(nl[1] || '0', 10)) * 3600 + (parseInt(nl[2] || '0', 10)) * 60 + parseInt(nl[3] || '0', 10);
  }
  var parts = s.replace(/[.,\-_]/g, ':').split(':').filter(function (p) { return p !== ''; });
  if (parts.length === 0 || parts.length > 3) return null;
  for (var i = 0; i < parts.length; i++) { if (!/^\d+$/.test(parts[i])) return null; }
  var n = parts.map(function (p) { return parseInt(p, 10); });
  if (n.length === 1) return n[0];
  if (n.length === 2) return n[0] * 60 + n[1];
  return n[0] * 3600 + n[1] * 60 + n[2];
}

module.exports = { secondsToHMS: secondsToHMS, clampRange: clampRange, parseFlexible: parseFlexible };
