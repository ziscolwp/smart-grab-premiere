var os = require('os');
var path = require('path');

function escRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redact(text, opts) {
  opts = opts || {};
  var out = String(text == null ? '' : text);
  var home = opts.homeDir || os.homedir();
  if (home) out = out.replace(new RegExp(escRegExp(home), 'g'), '~');
  out = out.replace(/https?:\/\/[^\s'"<>]+/ig, function (raw) {
    try {
      var u = new URL(raw);
      return u.protocol + '//' + u.host + '?<redacted>';
    } catch (e) {
      return raw.replace(/(https?:\/\/[^\/\s?#]+)[^\s]*/i, '$1?<redacted>');
    }
  });
  out = out.replace(/\bCookie:\s*(?:(?!\s+[A-Za-z-]+:).)+/ig, 'Cookie: <redacted>');
  out = out.replace(/\bAuthorization:\s*(?:Bearer\s+)?[^\s]+/ig, 'Authorization: <redacted>');
  out = out.replace(/\b(token|access_token|auth|session|password|secret)=([^\s&]+)/ig, '$1=<redacted>');
  return out;
}

function safeHost(url) {
  try { return new URL(String(url || '')).host || 'unknown'; }
  catch (e) { return 'unknown'; }
}

function safeBasename(filePath) {
  return filePath ? path.basename(String(filePath)) : '';
}

function toolLine(name, tool) {
  tool = tool || {};
  return name + ': ' + (tool.ok ? ('ok ' + (tool.version || 'unknown')) : 'missing/broken');
}

function buildItemDiagnostics(data, opts) {
  data = data || {};
  opts = opts || {};
  var item = data.item || {};
  var tools = data.tools || {};
  var lines = data.lines || [];
  var out = [
    'Smart Grab: ' + (data.appVersion || 'unknown'),
    'OS: ' + (data.os || (os.platform() + ' ' + os.arch())),
    'Item: ' + (item.id || 'unknown'),
    'Host: ' + safeHost(item.url),
    'Status: ' + (item.status || 'unknown'),
    'Category: ' + (item.errorCategory || 'unknown'),
    'Retryable: ' + (!!item.retryable),
    'Attempts: ' + (item.attemptCount || 0),
    'Quality: ' + ((item.opts && item.opts.quality) || 'unknown'),
    'Output: ' + safeBasename(item.outputPath),
    toolLine('yt-dlp', tools.ytdlp),
    toolLine('ffmpeg', tools.ffmpeg),
    toolLine('ffprobe', tools.ffprobe),
    toolLine('deno', tools.deno),
    'Recent lines:',
    redact(lines.join('\n'), opts)
  ];
  return out.join('\n');
}

module.exports = {
  redact: redact,
  safeHost: safeHost,
  safeBasename: safeBasename,
  buildItemDiagnostics: buildItemDiagnostics
};
