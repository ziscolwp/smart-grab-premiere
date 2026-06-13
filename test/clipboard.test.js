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
