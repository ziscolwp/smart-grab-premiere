# Google Flow source support — design

**Date:** 2026-06-15
**Status:** Implemented
**Scope:** Light polish (one self-contained PR)

## Problem

The user generates clips in Google Flow (labs.google, Veo image-to-video) and
wants them in Premiere without the manual *download to a folder → File > Import*
round-trip. Desired workflow: **paste a link → clip lands in the project bin**,
matching how Smart Grab already handles every other source.

## Key finding: the core already works

Flow has a native public share link (in Flow: hover a clip ▸ **More ▸ Share ▸
Copy link**). That share page —
`labs.google/fx/tools/flow/shared/video/<uuid>` — exposes the clip via an
`og:video` meta tag pointing at `labs.google/fx/api/og-video/shared/<uuid>`
(`video/mp4`). yt-dlp's **generic extractor follows og:video automatically**, so
the bundled yt-dlp downloads the clip with **zero new download code**.

Verified end-to-end with the bundled binaries: downloads a 4.46 MB MP4,
**H.264 + AAC, audio present**, 1280×720, 8.0s. The panel's existing format
selector (`bv*+ba/b` — the `/b` fallback already handles single-muxed sources
like X/Instagram) and post-process path (H.264+AAC+mp4→mp4 ⇒ `move`, no
re-encode) handle it unchanged.

So this is **polish, not plumbing**. Three gaps, each mirroring an existing
pattern.

## Design

### 1. Clean filenames — `panel/js/flow.js` (new, pure)
The generic extractor names Flow files after the bare UUID. New module mirrors
`tiktok.js`'s `outputTemplate`:
- `shareId(url)` → UUID from `/shared/<type>/<uuid>`, else `''`.
- `outputTemplate(url)` → `Flow clip [<first-8-hex>].%(ext)s` for a share link,
  else `null` (so non-share URLs keep yt-dlp's default naming).

`downloadEngine.js` applies it exactly like the existing TikTok
`resolvedTemplate`: `var template = resolvedTemplate || presetTemplate;`. No URL
swap (unlike TikTok) — yt-dlp fetches the og:video itself.

### 2. Source badge — `panel/js/urls.js`
One row added to `SOURCES`:
`{ key:'flow', label:'Flow', re:/labs\.google\/fx\/tools\/flow/ }`. Queue shows
"Flow" instead of "Web".

### 3. Error hint — `panel/js/errorHints.js`
`labs.google` appears only in Flow failures, so a rule keyed on it (placed
first, ahead of the generic 403/unsupported/extractor rules it would otherwise
hit) returns: *"Couldn't fetch this Google Flow video. Paste the Share link —
hover the clip ▸ More ▸ Share ▸ Copy link — and make sure the clip is still
shared. The editor/project URL won't work."* Confirmed real failure shape: an
unshared/deleted link 500s on the og-video endpoint with `labs.google` in the
surrounding extractor lines.

## Edge cases
- **Non-share Flow URL** (editor/project page): no `outputTemplate`; the generic
  extractor scrapes the marketing page and may grab demo clips — documented as
  "only the Share link works" in README + the error hint. A hard pre-download
  block is deferred to "deeper integration".
- **Unshared / deleted link:** caught by the error hint.
- **Filename collision:** existing `uniquePath` de-dupes.
- **Silent clips:** if the source has no audio, the file has no audio — not
  ours to fix (this clip had audio).

## Testing
- `test/flow.test.js` (new) — `shareId`, `outputTemplate` (happy path,
  short-id derivation, null for non-share/other URLs).
- `test/urls.test.js` — Flow share link → `flow` badge.
- `test/errorHints.test.js` — real unshared-link stderr → `flow` category +
  "Share" hint.
All offline (`npm test`). 162 pass on this branch.

## Out of scope (deeper integration, not built)
Prompt-as-filename (prompt lives in page JSON only when "Include inputs" is on),
multi-clip "Export Full Project" shares, a dedicated paste affordance, and
cookies for private/unshared links.

## Files
`panel/js/flow.js` (new), `panel/js/urls.js`, `panel/js/downloadEngine.js`,
`panel/js/errorHints.js`, `test/flow.test.js` (new), `test/urls.test.js`,
`test/errorHints.test.js`, `README.md`, `CHANGELOG.md`, `package.json`,
`panel/CSXS/manifest.xml` (3.2.1 → 3.3.0).
