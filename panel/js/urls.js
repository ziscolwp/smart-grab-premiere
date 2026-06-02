// panel/js/urls.js
function parse(text) {
  if (!text) return [];
  var out = [];
  var tokens = String(text).split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i].trim();
    if (/^https?:\/\//i.test(t)) out.push(t);
  }
  return out;
}

function classify(url) {
  if (!/^https?:\/\//i.test(url)) return 'invalid';
  var u = url.toLowerCase();
  var isYouTube = /(?:youtube\.com|youtu\.be)/.test(u);
  if (isYouTube) {
    if (/[?&]v=/.test(u) || /youtu\.be\//.test(u)) return 'video';   // watch?v=...&list=... stays single
    if (/\/playlist/.test(u) || /[?&]list=/.test(u)) return 'playlist';
    if (/\/@/.test(u) || /\/channel\//.test(u) || /\/c\//.test(u) || /\/user\//.test(u)) return 'channel';
    return 'video';
  }
  return 'video';
}

module.exports = { parse: parse, classify: classify };
