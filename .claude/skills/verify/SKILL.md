---
name: verify
description: How to run and verify the Preview Finder app (search, 30s preview playback, MP3/WAV download) in a sandboxed/CI environment.
---

# Verifying Preview Finder

## Run

```bash
node server.js          # http://localhost:3000, zero deps
PORT=3100 node server.js
```

## Gotcha: sandboxed egress blocks Apple

Remote/CI sandboxes typically block `itunes.apple.com` and `*.mzstatic.com`
(the agent proxy answers CONNECT with 403). This is environmental, not an app
bug. To verify anyway, run the server under a harness that monkey-patches
`globalThis.fetch` for Apple hosts only: return canned iTunes search JSON and
a generated PCM WAV (served as `audio/mp4`) for preview URLs. The client
pipeline doesn't care about the container — `decodeAudioData` sniffs bytes.
Everything else (routing, URL validation, static serving, streaming, the whole
browser flow) is real code.

Note: Playwright's Chromium lacks AAC codecs, so real m4a previews wouldn't
decode there anyway; real browsers (Chrome/Edge/Safari/Firefox) all decode AAC.

## Drive (headless Chromium via playwright-core)

Launch with `executablePath: '/opt/pw-browsers/chromium'` and
`--autoplay-policy=no-user-gesture-required`. Flows worth driving:

1. Search → cards render (`.card`); tracks without `previewUrl` are filtered.
2. Click `.play-btn` → glyph flips to `❚❚`, `.progress-fill` width grows,
   `.time` ticks. Click again → pauses. Play another card → first one resets.
3. Click "Download MP3" / "Download WAV" → `page.waitForEvent('download')`,
   save, check magics: MP3 starts `ff fb`; WAV starts `RIFF....WAVE`, check
   channels/rate/bits at offsets 22/24/34.

## API probes

```bash
curl 'localhost:3100/api/search?q=daft+punk'                # 200 JSON
curl 'localhost:3100/api/search?q='                         # 400
curl 'localhost:3100/api/preview?url=https%3A%2F%2Fevil.example.com%2Fx'  # 400 (SSRF guard)
curl 'localhost:3100/api/preview?url=http%3A%2F%2Faudio-ssl.itunes.apple.com%2Fa'  # 400 (https only)
curl --path-as-is 'localhost:3100/../server.js'             # 404 (traversal)
curl -X POST 'localhost:3100/api/search?q=x'                # 405
```
