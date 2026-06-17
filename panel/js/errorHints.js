// panel/js/errorHints.js
// Maps raw yt-dlp/ffmpeg stderr to a short human message + a "what to do" hint.
// Pure string matching — no I/O.

var RULES = [
  // Flow first: labs.google appears only in Google Flow failures, so a failed
  // fetch there means the link isn't a public Share link (unshared, deleted, or
  // an editor/project URL) — not a cookie/extractor problem the generic rules
  // below would mis-diagnose.
  { re: /labs\.google/i,
    message: "Couldn't fetch this Google Flow video.",
    hint: 'Paste the Share link — in Flow, hover the clip ▸ More ▸ Share ▸ Copy link — and make sure the clip is still shared. The editor/project URL won\'t work, only the Share link.' },
  { re: /sign in to confirm|confirm you.?re not a bot/i,
    message: 'YouTube is asking for sign-in verification.',
    hint: 'In Settings, set "Browser cookies" to a browser where you are logged in, then retry.' },
  { re: /content isn.?t available, try again later/i,
    message: 'YouTube rate limit reached (~300 videos/hour as guest).',
    hint: 'Wait a while before queueing more, or set browser cookies in Settings to raise the limit.' },
  { re: /attempting impersonation, but no impersonate target/i,
    message: 'This site needs browser impersonation, which this yt-dlp build lacks.',
    hint: 'Click "Update yt-dlp" in Settings to get the official build (includes impersonation).' },
  { re: /requested format is not available/i,
    message: 'No downloadable format matched.',
    hint: 'Try quality "Best available", or "Update yt-dlp" in Settings.' },
  { re: /this format cannot be partially downloaded/i,
    message: 'This site does not support fast clip download.',
    hint: 'Set Trim mode to "Precise" in Settings (downloads the full video, then trims).' },
  { re: /login required|log in to|requested content is not available|rate-?limit reached|empty media response/i,
    message: 'This post needs a logged-in account.',
    hint: 'In Settings, set "Browser cookies" to a browser where you are logged in, then retry.' },
  { re: /nsfw (tweet|post)|age.?restricted|age.?gate|confirm your age/i,
    message: 'Age-restricted content.',
    hint: 'Set "Browser cookies" in Settings to a logged-in browser, then retry.' },
  { re: /private video|this video is private|protected tweet|private account/i,
    message: 'The video is private.',
    hint: 'You need an account with access — set "Browser cookies" in Settings.' },
  { re: /available in your country|geo.?(restricted|blocked)|unavailable in your region/i,
    message: 'Geo-restricted in your region.',
    hint: 'This video is blocked for your country.' },
  { re: /video unavailable|content isn.?t available|has been removed/i,
    message: 'Video unavailable (removed, deleted, or region-locked).',
    hint: 'Double-check the link in a browser.' },
  { re: /unsupported url/i,
    message: 'No video found on this page.',
    hint: 'Open the video itself and copy that link (not a search/menu page). Sites that hide the stream behind their own player or a login often can\'t be grabbed — try "Update yt-dlp", and set sign-in cookies in Settings if it needs an account.' },
  { re: /http error 403/i,
    message: 'Access denied (HTTP 403).',
    hint: 'Try "Update yt-dlp" in Settings; if it persists, set browser cookies.' },
  { re: /http error 429|too many requests/i,
    message: 'Rate-limited by the site (HTTP 429).',
    hint: 'Wait a few minutes and retry, or set browser cookies in Settings.' },
  { re: /unable to extract|nsig extraction failed|signature extraction|player = /i,
    message: 'The site changed and broke the extractor.',
    hint: 'Click "Update yt-dlp" in Settings — this usually fixes it within a day of a site change.' },
  { re: /is not a valid url/i,
    message: 'Not a valid URL.',
    hint: 'Paste a full link starting with https://.' },
  { re: /unable to download webpage.*(timed out|timeout|connection|getaddrinfo|network)/i,
    message: 'Network problem while contacting the site.',
    hint: 'Check your internet connection. If other links work, this site is probably blocked by your ISP or country (e.g. TikTok in India). Browser VPN extensions don\'t cover the panel — use a system-wide VPN app, or set a Proxy URL in Settings.' },
  { re: /no space left/i,
    message: 'Your disk is full.',
    hint: 'Free up space and retry.' },
  { re: /live event|premieres in|this live stream/i,
    message: 'This is a live/upcoming stream.',
    hint: 'Wait until the stream has finished, then grab the VOD.' },
  { re: /could not copy chrome cookie|could not find .* cookies|cookies.*(locked|denied|decrypt)/i,
    message: 'Could not read browser cookies.',
    hint: 'Fully quit the browser and retry, or pick a different browser in Settings.' },
  { re: /requested merging of multiple formats but ffmpeg|ffmpeg (is )?not installed|ffmpeg not found/i,
    message: 'ffmpeg was not usable, so video and audio could not be merged.',
    hint: 'Re-run the installer to refresh ffmpeg, then retry this item.' }
];

// friendly(rawText) -> { message, hint } | null
function friendly(rawText) {
  var s = String(rawText || '');
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i].re.test(s)) return { message: RULES[i].message, hint: RULES[i].hint };
  }
  return null;
}

module.exports = { friendly: friendly };
