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

// Which site a URL belongs to — drives the queue badge and site-specific hints.
var SOURCES = [
  { key: 'youtube',   label: 'YouTube',   re: /(?:youtube\.com|youtu\.be)/ },
  { key: 'instagram', label: 'Instagram', re: /instagram\.com/ },
  { key: 'twitter',   label: 'X',         re: /(?:twitter\.com|\/\/x\.com|\/\/www\.x\.com)/ },
  { key: 'reddit',    label: 'Reddit',    re: /(?:reddit\.com|redd\.it)/ },
  { key: 'tiktok',    label: 'TikTok',    re: /tiktok\.com/ },
  { key: 'loom',      label: 'Loom',      re: /loom\.com/ },
  { key: 'vimeo',     label: 'Vimeo',     re: /vimeo\.com/ },
  { key: 'twitch',    label: 'Twitch',    re: /twitch\.tv/ },
  { key: 'facebook',  label: 'Facebook',  re: /(?:facebook\.com|fb\.watch)/ },
  { key: 'dailymotion', label: 'Dailymotion', re: /dailymotion\.com/ },
  { key: 'streamable', label: 'Streamable', re: /streamable\.com/ },
  { key: 'flow',      label: 'Flow',      re: /labs\.google\/fx\/tools\/flow/ }
];

function source(url) {
  var u = String(url || '').toLowerCase();
  for (var i = 0; i < SOURCES.length; i++) {
    if (SOURCES[i].re.test(u)) return SOURCES[i];
  }
  return { key: 'web', label: 'Web', re: null };
}

// Sites where private/age-gated/rate-limited content usually needs browser cookies.
function usuallyNeedsCookies(sourceKey) {
  return sourceKey === 'instagram' || sourceKey === 'twitter' || sourceKey === 'facebook';
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

module.exports = { parse: parse, classify: classify, source: source, usuallyNeedsCookies: usuallyNeedsCookies };
