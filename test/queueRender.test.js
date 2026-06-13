const test = require('node:test');
const assert = require('node:assert');
const queueRender = require('../panel/js/queueRender.js');

test('itemHtml shows Copy diagnostics for failed items and Resume for retryable partials', () => {
  const html = queueRender.itemHtml({
    id: 'q1',
    status: 'error',
    url: 'https://x.test',
    title: 'X',
    retryable: true,
    workDirHasPartials: true,
    errorHint: 'try again'
  });
  assert.ok(html.indexOf('data-act="retry"') !== -1);
  assert.ok(html.indexOf('title="Resume"') !== -1);
  assert.ok(html.indexOf('data-act="diagnostics"') !== -1);
});
