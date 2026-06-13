// panel/js/errorHints.js
// Maps raw yt-dlp/ffmpeg stderr to a short human message + a "what to do" hint.
// Pure string matching — no I/O.

var RULES = [
  { re: /sign in to confirm|confirm you.?re not a bot/i,
    category: 'auth', retryable: true, action: 'set-cookies',
    message: 'YouTube is asking for sign-in verification.',
    hint: 'In Settings, set "Browser cookies" to a browser where you are logged in, then retry.' },
  { re: /content isn.?t available, try again later/i,
    category: 'rate-limit', retryable: true, action: 'wait',
    message: 'YouTube rate limit reached (~300 videos/hour as guest).',
    hint: 'Wait a while before queueing more, or set browser cookies in Settings to raise the limit.' },
  { re: /attempting impersonation, but no impersonate target/i,
    category: 'tool', retryable: true, action: 'update-ytdlp',
    message: 'This site needs browser impersonation, which this yt-dlp build lacks.',
    hint: 'Click "Update yt-dlp" in Settings to get the official build (includes impersonation).' },
  { re: /requested format is not available/i,
    category: 'format', retryable: true, action: 'copy-diagnostics',
    message: 'No downloadable format matched.',
    hint: 'Try quality "Best available", or "Update yt-dlp" in Settings.' },
  { re: /this format cannot be partially downloaded/i,
    category: 'trim', retryable: true, action: 'change-trim-mode',
    message: 'This site does not support fast clip download.',
    hint: 'Set Trim mode to "Precise" in Settings (downloads the full video, then trims).' },
  { re: /login required|log in to|requested content is not available|rate-?limit reached|empty media response/i,
    category: 'auth', retryable: true, action: 'set-cookies',
    message: 'This post needs a logged-in account.',
    hint: 'In Settings, set "Browser cookies" to a browser where you are logged in, then retry.' },
  { re: /nsfw (tweet|post)|age.?restricted|age.?gate|confirm your age/i,
    category: 'auth', retryable: true, action: 'set-cookies',
    message: 'Age-restricted content.',
    hint: 'Set "Browser cookies" in Settings to a logged-in browser, then retry.' },
  { re: /private video|this video is private|protected tweet|private account/i,
    category: 'private', retryable: false, action: 'set-cookies',
    message: 'The video is private.',
    hint: 'You need an account with access — set "Browser cookies" in Settings.' },
  { re: /available in your country|geo.?(restricted|blocked)|unavailable in your region/i,
    category: 'geo', retryable: true, action: 'set-proxy',
    message: 'Geo-restricted in your region.',
    hint: 'This video is blocked for your country.' },
  { re: /video unavailable|content isn.?t available|has been removed/i,
    category: 'not-found', retryable: false, action: 'none',
    message: 'Video unavailable (removed, deleted, or region-locked).',
    hint: 'Double-check the link in a browser.' },
  { re: /unsupported url/i,
    category: 'unsupported', retryable: false, action: 'copy-diagnostics',
    message: 'No video found on this page.',
    hint: 'Open the video itself and copy that link (not a search/menu page). Sites that hide the stream behind their own player or a login often can\'t be grabbed — try "Update yt-dlp", and set sign-in cookies in Settings if it needs an account.' },
  { re: /http error 403/i,
    category: 'auth', retryable: true, action: 'set-cookies',
    message: 'Access denied (HTTP 403).',
    hint: 'Try "Update yt-dlp" in Settings; if it persists, set browser cookies.' },
  { re: /http error 429|too many requests/i,
    category: 'rate-limit', retryable: true, action: 'wait',
    message: 'Rate-limited by the site (HTTP 429).',
    hint: 'Wait a few minutes and retry, or set browser cookies in Settings.' },
  { re: /unable to extract|nsig extraction failed|signature extraction|player = /i,
    category: 'extractor', retryable: true, action: 'update-ytdlp',
    message: 'The site changed and broke the extractor.',
    hint: 'Click "Update yt-dlp" in Settings — this usually fixes it within a day of a site change.' },
  { re: /is not a valid url/i,
    category: 'unsupported', retryable: false, action: 'none',
    message: 'Not a valid URL.',
    hint: 'Paste a full link starting with https://.' },
  { re: /unable to download webpage.*(timed out|timeout|connection|getaddrinfo|network)/i,
    category: 'network', retryable: true, action: 'set-proxy',
    message: 'Network problem while contacting the site.',
    hint: 'Check your internet connection. If other links work, this site is probably blocked by your ISP or country (e.g. TikTok in India). Browser VPN extensions don\'t cover the panel — use a system-wide VPN app, or set a Proxy URL in Settings.' },
  { re: /no space left/i,
    category: 'disk', retryable: true, action: 'free-disk',
    message: 'Your disk is full.',
    hint: 'Free up space and retry.' },
  { re: /live event|premieres in|this live stream/i,
    category: 'unsupported', retryable: true, action: 'wait',
    message: 'This is a live/upcoming stream.',
    hint: 'Wait until the stream has finished, then grab the VOD.' },
  { re: /could not copy chrome cookie|could not find .* cookies|cookies.*(locked|denied|decrypt)/i,
    category: 'auth', retryable: true, action: 'set-cookies',
    message: 'Could not read browser cookies.',
    hint: 'Fully quit the browser and retry, or pick a different browser in Settings.' },
  { re: /requested merging of multiple formats but ffmpeg|ffmpeg (is )?not installed|ffmpeg not found/i,
    category: 'tool', retryable: true, action: 'repair-tools',
    message: 'ffmpeg was not usable, so video and audio could not be merged.',
    hint: 'Re-run the installer to refresh ffmpeg, then retry this item.' }
];

// friendly(rawText) -> { message, hint } | null
function friendly(rawText) {
  var s = String(rawText || '');
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i].re.test(s)) {
      return {
        category: RULES[i].category || 'unknown',
        retryable: !!RULES[i].retryable,
        action: RULES[i].action || 'copy-diagnostics',
        message: RULES[i].message,
        hint: RULES[i].hint
      };
    }
  }
  return null;
}

module.exports = { friendly: friendly };
