// panel/js/clipboard.js
// System clipboard access for CEP. The web Clipboard API (navigator.clipboard)
// is unreliable in CEP (file:// is not a secure context), so we shell out via Node.
var defaultChildProcess = require('child_process');

function createClipboard(deps) {
  deps = deps || {};
  var childProcess = deps.childProcess || defaultChildProcess;
  var platform = deps.platform || process.platform;

  function read() {
    try {
      if (platform === 'darwin') {
        return childProcess.execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' });
      }
      if (platform === 'win32') {
        return childProcess.execFileSync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Clipboard -Raw'
        ], { encoding: 'utf8', windowsHide: true });
      }
    } catch (e) {
      return '';
    }
    return '';
  }

  function write(text) {
    var input = String(text == null ? '' : text);
    try {
      if (platform === 'darwin') {
        return childProcess.spawnSync('/usr/bin/pbcopy', { input: input }).status === 0;
      }
      if (platform === 'win32') {
        return childProcess.spawnSync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Set-Clipboard -Value ([Console]::In.ReadToEnd())'
        ], { input: input, windowsHide: true }).status === 0;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  return { read: read, write: write };
}

var clipboard = createClipboard();
module.exports = { read: clipboard.read, write: clipboard.write, createClipboard: createClipboard };
