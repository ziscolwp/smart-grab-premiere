// panel/js/clipboard.js
// System clipboard via macOS pbpaste/pbcopy. The web Clipboard API (navigator.clipboard)
// is unreliable in CEP (file:// is not a secure context), so we shell out via Node —
// the same approach the AudioExtractor panel uses for pbcopy.
var childProcess = require('child_process');

function read() {
  try {
    return childProcess.execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

function write(text) {
  try {
    var r = childProcess.spawnSync('/usr/bin/pbcopy', { input: String(text == null ? '' : text) });
    return r.status === 0;
  } catch (e) {
    return false;
  }
}

module.exports = { read: read, write: write };
