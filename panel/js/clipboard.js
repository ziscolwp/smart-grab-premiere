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

  // Non-blocking read — the same commands as read() but via async execFile so a
  // slow Windows PowerShell cold-start (200-700ms) can never freeze the panel
  // (e.g. on focus auto-detect or the Paste button). cb(text) — '' on any error.
  function readAsync(cb) {
    cb = cb || function () {};
    var cmd, args;
    if (platform === 'darwin') { cmd = '/usr/bin/pbpaste'; args = []; }
    else if (platform === 'win32') {
      cmd = 'powershell.exe';
      args = ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'];
    } else { return cb(''); }
    try {
      childProcess.execFile(cmd, args, { encoding: 'utf8', windowsHide: true }, function (err, stdout) {
        cb(err ? '' : String(stdout == null ? '' : stdout));
      });
    } catch (e) { cb(''); }
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

  return { read: read, readAsync: readAsync, write: write };
}

var clipboard = createClipboard();
module.exports = {
  read: clipboard.read, readAsync: clipboard.readAsync, write: clipboard.write,
  createClipboard: createClipboard
};
