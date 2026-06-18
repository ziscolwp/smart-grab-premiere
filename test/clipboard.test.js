const test = require('node:test');
const assert = require('node:assert');
const clipboard = require('../panel/js/clipboard.js');

test('Windows read uses PowerShell Get-Clipboard', () => {
  const calls = [];
  const c = clipboard.createClipboard({
    platform: 'win32',
    childProcess: {
      execFileSync: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return 'https://example.com/video';
      }
    }
  });

  assert.strictEqual(c.read(), 'https://example.com/video');
  assert.strictEqual(calls[0].cmd, 'powershell.exe');
  assert.ok(calls[0].args.indexOf('Get-Clipboard -Raw') !== -1);
  assert.strictEqual(calls[0].opts.encoding, 'utf8');
});

test('Windows write sends stdin to PowerShell Set-Clipboard', () => {
  const calls = [];
  const c = clipboard.createClipboard({
    platform: 'win32',
    childProcess: {
      spawnSync: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0 };
      }
    }
  });

  assert.strictEqual(c.write('hello'), true);
  assert.strictEqual(calls[0].cmd, 'powershell.exe');
  assert.ok(calls[0].args.indexOf('Set-Clipboard -Value ([Console]::In.ReadToEnd())') !== -1);
  assert.strictEqual(calls[0].opts.input, 'hello');
});

test('clipboard helpers fail quietly when the platform command errors', () => {
  const c = clipboard.createClipboard({
    platform: 'win32',
    childProcess: {
      execFileSync: () => { throw new Error('missing clipboard'); },
      spawnSync: () => { throw new Error('missing clipboard'); }
    }
  });

  assert.strictEqual(c.read(), '');
  assert.strictEqual(c.write('hello'), false);
});

test('readAsync runs the platform command without blocking and returns its text', () => {
  const calls = [];
  const c = clipboard.createClipboard({
    platform: 'win32',
    childProcess: {
      execFile: (cmd, args, opts, cb) => {
        calls.push({ cmd, args, opts });
        cb(null, 'https://example.com/clip', '');
      }
    }
  });
  let got = null;
  c.readAsync((text) => { got = text; });
  assert.strictEqual(got, 'https://example.com/clip');
  assert.strictEqual(calls[0].cmd, 'powershell.exe');
  assert.ok(calls[0].args.indexOf('Get-Clipboard -Raw') !== -1);
});

test('readAsync uses pbpaste on macOS', () => {
  const calls = [];
  const c = clipboard.createClipboard({
    platform: 'darwin',
    childProcess: { execFile: (cmd, args, opts, cb) => { calls.push(cmd); cb(null, 'mac-text', ''); } }
  });
  let got = null;
  c.readAsync((text) => { got = text; });
  assert.strictEqual(got, 'mac-text');
  assert.strictEqual(calls[0], '/usr/bin/pbpaste');
});

test('readAsync yields empty string on error instead of throwing', () => {
  const c = clipboard.createClipboard({
    platform: 'win32',
    childProcess: { execFile: (cmd, args, opts, cb) => cb(new Error('no clipboard'), '', '') }
  });
  let got = 'unset';
  c.readAsync((text) => { got = text; });
  assert.strictEqual(got, '');
});

test('readAsync on an unsupported platform yields empty string', () => {
  const c = clipboard.createClipboard({ platform: 'linux', childProcess: {} });
  let got = 'unset';
  c.readAsync((text) => { got = text; });
  assert.strictEqual(got, '');
});
