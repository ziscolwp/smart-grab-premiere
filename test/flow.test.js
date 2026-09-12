const test = require('node:test');
const assert = require('node:assert');
const F = require('../panel/js/flow.js');

// Real Google Flow share links. Flow moved from labs.google to flow.google.com
// in 2026; old links 301 to the new host, and both must keep working.
const SHARE = 'https://flow.google.com/shared/video/c2c6c14b-da90-4356-a83a-37413b4eb6ee';
const OLD_SHARE = 'https://labs.google/fx/tools/flow/shared/video/be83e530-cac3-43ed-90e4-77dfe9efe1ec';

// Trimmed from a real getSharedMedia response for SHARE (Sept 2026).
const API_FIXTURE = JSON.stringify({
  mediaShareId: 'c2c6c14b-da90-4356-a83a-37413b4eb6ee',
  primaryMedia: {
    name: '94a8f8a4-38fc-43c8-a821-7d0f17d2a1b5',
    mediaMetadata: {
      createTime: '2026-09-12T04:22:39.808148Z',
      mediaTitle: 'A locked static shot of the woman in the photo holding her double bicep pose. She does not move.\nHer pose stays the same.',
      thumbnailUrl: 'https://flow-content.google/image/94a8f8a4?Expires=1789209509&KeyName=labs-flow-prod-cdn-key&Signature=b-1W',
      mediaBlobSize: '5502511'
    },
    video: {
      generatedVideo: {
        seed: 279890,
        fifeUrl: 'https://flow-content.google/video/94a8f8a4?Expires=1789209509&KeyName=labs-flow-prod-cdn-key&Signature=Amrd',
        model: 'abra_r2v_8s',
        aspectRatio: 'VIDEO_ASPECT_RATIO_PORTRAIT'
      },
      dimensions: { length: '8s' }
    }
  },
  modelDisplayName: 'Omni 1.1 Flash'
});

test('shareId: extracts the UUID from new and old share links', () => {
  assert.strictEqual(F.shareId(SHARE), 'c2c6c14b-da90-4356-a83a-37413b4eb6ee');
  assert.strictEqual(F.shareId(OLD_SHARE), 'be83e530-cac3-43ed-90e4-77dfe9efe1ec');
});

test('shareId: empty for non-share Flow URLs, other sites, and junk', () => {
  assert.strictEqual(F.shareId('https://labs.google/fx/tools/flow/project/abc123'), '');
  assert.strictEqual(F.shareId('https://flow.google.com/project/abc123'), '');
  assert.strictEqual(F.shareId('https://www.youtube.com/watch?v=x'), '');
  assert.strictEqual(F.shareId(''), '');
  assert.strictEqual(F.shareId(null), '');
});

test('isShareUrl: true only for Flow share links on either host', () => {
  assert.strictEqual(F.isShareUrl(SHARE), true);
  assert.strictEqual(F.isShareUrl(OLD_SHARE), true);
  assert.strictEqual(F.isShareUrl('https://flow.google.com/project/abc123'), false);
  assert.strictEqual(F.isShareUrl('https://flow-content.google/video/x?Expires=1'), false); // the CDN, not a page
  assert.strictEqual(F.isShareUrl('https://example.com/shared/video/c2c6c14b-da90-4356-a83a-37413b4eb6ee'), false);
  assert.strictEqual(F.isShareUrl(''), false);
  assert.strictEqual(F.isShareUrl(null), false);
});

test('outputTemplate: clean "Flow clip [short].%(ext)s" from a share link', () => {
  assert.strictEqual(F.outputTemplate(SHARE), 'Flow clip [c2c6c14b].%(ext)s');
  assert.strictEqual(F.outputTemplate(OLD_SHARE), 'Flow clip [be83e530].%(ext)s');
});

test('outputTemplate: short id is the first 8 hex chars, hyphens removed', () => {
  const tpl = F.outputTemplate('https://flow.google.com/shared/video/12345678-aaaa-bbbb-cccc-ddddeeeeffff');
  assert.strictEqual(tpl, 'Flow clip [12345678].%(ext)s');
});

test('outputTemplate: null for non-share URLs so yt-dlp keeps its default naming', () => {
  // The editor/project URL has no shareable video — must not get a Flow name.
  assert.strictEqual(F.outputTemplate('https://labs.google/fx/tools/flow/project/abc123'), null);
  assert.strictEqual(F.outputTemplate('https://vimeo.com/123'), null);
  assert.strictEqual(F.outputTemplate(''), null);
  assert.strictEqual(F.outputTemplate(null), null);
});

test('pageUrl: canonical flow.google.com page for a share id (old links 301 there anyway)', () => {
  assert.strictEqual(F.pageUrl(OLD_SHARE), 'https://flow.google.com/shared/video/be83e530-cac3-43ed-90e4-77dfe9efe1ec');
  assert.strictEqual(F.pageUrl(SHARE), SHARE);
});

test('apiKeyFromHtml: pulls the public web key the share page embeds', () => {
  const html = '<script>AF_initDataCallback({"Im6cmf":"/_/AiSandboxAngularFrontend","K21R3e":"AIzaSyEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAM","LoQv7e":false});</script>';
  assert.strictEqual(F.apiKeyFromHtml(html), 'AIzaSyEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAM');
});

test('apiKeyFromHtml: falls back to any Google web key, empty when none', () => {
  assert.strictEqual(F.apiKeyFromHtml('x "apiKey":"AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" y'), 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.strictEqual(F.apiKeyFromHtml('<html>no key here</html>'), '');
  assert.strictEqual(F.apiKeyFromHtml(''), '');
  assert.strictEqual(F.apiKeyFromHtml(null), '');
});

test('apiUrl: getSharedMedia endpoint for the share id, key URL-encoded', () => {
  assert.strictEqual(
    F.apiUrl(SHARE, 'AIzaKEY'),
    'https://aisandbox-pa.googleapis.com/v1/flowMedia/c2c6c14b-da90-4356-a83a-37413b4eb6ee:getSharedMedia?key=AIzaKEY'
  );
  assert.strictEqual(F.apiUrl('https://vimeo.com/1', 'k'), null);
});

test('parseSharedMedia: signed MP4 URL, duration, thumbnail, and a short title', () => {
  const info = F.parseSharedMedia(API_FIXTURE);
  assert.ok(info);
  assert.strictEqual(info.videoUrl, 'https://flow-content.google/video/94a8f8a4?Expires=1789209509&KeyName=labs-flow-prod-cdn-key&Signature=Amrd');
  assert.strictEqual(info.durationSec, 8);
  assert.strictEqual(info.thumbnail, 'https://flow-content.google/image/94a8f8a4?Expires=1789209509&KeyName=labs-flow-prod-cdn-key&Signature=b-1W');
  assert.strictEqual(info.id, 'c2c6c14b-da90-4356-a83a-37413b4eb6ee');
  assert.strictEqual(info.uploader, 'Omni 1.1 Flash');
  // Title is the first line of the prompt, capped so the queue card stays readable.
  assert.strictEqual(info.title, 'A locked static shot of the woman in the photo holding her double bicep pose.…');
});

test('parseSharedMedia: null for API errors, junk, and responses with no video', () => {
  assert.strictEqual(F.parseSharedMedia('{"error":{"code":404,"status":"NOT_FOUND"}}'), null);
  assert.strictEqual(F.parseSharedMedia('<html>rate limited</html>'), null);
  assert.strictEqual(F.parseSharedMedia(''), null);
  assert.strictEqual(F.parseSharedMedia(null), null);
  // An image share (no video block) is not something we can download.
  assert.strictEqual(F.parseSharedMedia(JSON.stringify({ primaryMedia: { image: { fifeUrl: 'https://x/y' } } })), null);
  // A video block whose URL is not http(s) must be rejected.
  assert.strictEqual(F.parseSharedMedia(JSON.stringify({ primaryMedia: { video: { generatedVideo: { fifeUrl: 'javascript:1' } } } })), null);
});

test('parseSharedMedia: tolerates missing optional fields', () => {
  const info = F.parseSharedMedia(JSON.stringify({ primaryMedia: { video: { generatedVideo: { fifeUrl: 'https://flow-content.google/video/a' } } } }));
  assert.ok(info);
  assert.strictEqual(info.videoUrl, 'https://flow-content.google/video/a');
  assert.strictEqual(info.durationSec, null);
  assert.strictEqual(info.thumbnail, null);
  assert.strictEqual(info.title, null);
  assert.strictEqual(info.uploader, null);
});
