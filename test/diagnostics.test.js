const test = require('node:test');
const assert = require('node:assert');
const diagnostics = require('../panel/js/diagnostics.js');

test('redact removes query strings, cookies, auth headers, and home paths', () => {
  const out = diagnostics.redact('https://x.test/v?id=secret Cookie: abc Authorization: Bearer tok /Users/editor/file.mp4', {
    homeDir: '/Users/editor'
  });
  assert.ok(out.indexOf('?<redacted>') !== -1);
  assert.ok(out.indexOf('Cookie: <redacted>') !== -1);
  assert.ok(out.indexOf('Authorization: <redacted>') !== -1);
  assert.ok(out.indexOf('~/file.mp4') !== -1);
});

test('buildItemDiagnostics emits safe item and tool context', () => {
  const text = diagnostics.buildItemDiagnostics({
    appVersion: '3.2.1',
    os: 'darwin arm64',
    item: {
      id: 'q1',
      url: 'https://x.test/watch?v=secret',
      status: 'error',
      attemptCount: 2,
      errorCategory: 'network',
      retryable: true,
      opts: { quality: 'fhd' },
      outputPath: '/Users/editor/out/Clip.mp4'
    },
    tools: { ytdlp: { ok: true, version: '2026.06.12' } },
    lines: ['ERROR: token=secret Cookie: abc']
  }, { homeDir: '/Users/editor' });
  assert.ok(text.indexOf('Smart Grab: 3.2.1') !== -1);
  assert.ok(text.indexOf('Host: x.test') !== -1);
  assert.strictEqual(text.indexOf('v=secret'), -1);
  assert.strictEqual(text.indexOf('Cookie: abc'), -1);
});
