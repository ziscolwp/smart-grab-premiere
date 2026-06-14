// panel/js/queueRender.js
// DOM rendering for the queue list. No app state — pure (items, handlers) -> DOM.
var timecode = require('./timecode.js');
var urls = require('./urls.js');

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var ICONS = {
  cancel: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  trash: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  retry: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
  folder: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  copy: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  film: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>'
};

function badge(it) {
  switch (it.status) {
    case 'pending': return 'Waiting…';
    case 'fetching-info': return 'Reading link…';
    case 'queued': return 'Queued';
    case 'downloading': return it.statusMsg || 'Downloading…';
    case 'done': return '✓ ' + (it.statusMsg || 'Done');
    case 'error': return it.statusMsg || 'Failed';
    case 'canceled': return 'Canceled';
    default: return it.status;
  }
}

function buttonsFor(it) {
  var b = '';
  if (it.status === 'downloading') {
    b += '<button class="qbtn danger" data-act="cancel" data-id="' + it.id + '" title="Cancel">' + ICONS.cancel + '</button>';
  } else {
    if (it.status === 'error' || it.status === 'canceled') {
      var retryTitle = it.retryable && it.workDirHasPartials ? 'Resume' : 'Retry';
      b += '<button class="qbtn" data-act="retry" data-id="' + it.id + '" title="' + retryTitle + '">' + ICONS.retry + '</button>';
    }
    if (it.status === 'error') {
      b += '<button class="qbtn" data-act="diagnostics" data-id="' + it.id + '" title="Copy diagnostics">' + ICONS.copy + '</button>';
    }
    if (it.status === 'done' && it.outputPath) {
      b += '<button class="qbtn" data-act="reveal" data-id="' + it.id + '" title="Show file">' + ICONS.folder + '</button>';
    }
    b += '<button class="qbtn danger" data-act="remove" data-id="' + it.id + '" title="Remove">' + ICONS.trash + '</button>';
  }
  return b;
}

function itemHtml(it) {
  var dur = it.durationSec != null ? timecode.secondsToHMS(it.durationSec) : '';
  var src = urls.source(it.url);
  var statusClass = it.status === 'error' ? ' error' : (it.status === 'done' ? ' done' : '');
  var thumb = it.thumbnail
    ? '<img class="qthumb" src="' + escHtml(it.thumbnail) + '" alt="">'
    : '<div class="qthumb placeholder">' + ICONS.film + '</div>';
  var html =
    '<div class="qtop">' + thumb +
      '<div class="qmain">' +
        '<div class="qtitle" title="' + escHtml(it.title || it.url) + '">' + escHtml(it.title || it.url) + '</div>' +
        '<div class="qsub"><span class="qbadge">' + escHtml(src.label) + '</span>' +
        (dur ? '<span class="qdur">' + dur + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="qbtns">' + buttonsFor(it) + '</div>' +
    '</div>';
  if (it.status === 'downloading') {
    html += '<div class="progress-track"><div class="progress-bar" style="width:' + (it.progress || 0) + '%"></div></div>';
  }
  html += '<div class="qmeta"><span class="qstatus' + statusClass + '">' + escHtml(badge(it)) + '</span></div>';
  if (it.status === 'error' && it.errorHint) {
    html += '<div class="qhint">' + escHtml(it.errorHint) + '</div>';
  }
  return html;
}

// summary("3 done · 1 failed · 2 left") for the queue header
function summary(items) {
  if (!items.length) return '';
  var done = 0, failed = 0, left = 0;
  for (var i = 0; i < items.length; i++) {
    var s = items[i].status;
    if (s === 'done') done++;
    else if (s === 'error') failed++;
    else if (s !== 'canceled') left++;
  }
  var parts = [];
  if (done) parts.push(done + ' done');
  if (failed) parts.push(failed + ' failed');
  if (left) parts.push(left + ' left');
  return parts.length ? '— ' + parts.join(' · ') : '';
}

// render(doc, container, items, handlers{cancel,remove,retry,reveal})
function render(doc, container, items, handlers) {
  if (!items.length) {
    container.innerHTML = '<div class="empty">Nothing queued yet — paste a link above to get started.</div>';
    return;
  }
  container.innerHTML = '';
  items.forEach(function (it) {
    var row = doc.createElement('div');
    row.className = 'qitem' + (it.status === 'downloading' ? ' active' : '');
    row.innerHTML = itemHtml(it);
    container.appendChild(row);
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-act]'), function (b) {
    b.addEventListener('click', function () {
      var fn = handlers[b.getAttribute('data-act')];
      if (fn) fn(b.getAttribute('data-id'));
    });
  });
}

module.exports = { render: render, summary: summary, badge: badge, itemHtml: itemHtml };
