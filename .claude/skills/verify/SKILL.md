---
name: verify
description: How to run and verify the Track Finder app (search, playback, MP3/WAV download from Audius full tracks + iTunes 30s previews) in a sandboxed/CI environment.
---

# Verifying Track Finder

## Run

```bash
node server.js          # http://localhost:3000, zero deps
PORT=3100 node server.js
```

## Gotcha: sandboxed egress blocks the upstreams

Remote/CI sandboxes typically block `itunes.apple.com`, `*.mzstatic.com`,
`api.audius.co`, and the Audius discovery nodes (the agent proxy answers
CONNECT with 403). This is environmental, not an app bug. To verify anyway,
run the server under a harness that monkey-patches `globalThis.fetch` for
those hosts only:

- iTunes search → canned JSON; Apple preview URLs → generated PCM WAV served
  as `audio/mp4` (`decodeAudioData` sniffs bytes, container doesn't matter).
- `api.audius.co` → `{data:['https://stub-discovery.audius.test']}`; that stub
  host's `/v1/tracks/search` → canned tracks (mix `is_downloadable` true/false
  and one `is_streamable:false` to test filtering); `/v1/tracks/{id}/stream` →
  a real MP3 fixture, ~45s so "full track, not 30s" is provable. Generate the
  fixture with the vendored `public/vendor/lame.min.js` loaded via `vm` in
  Node (the npm lamejs CommonJS entry is broken: "MPEGMode is not defined").

Everything else (routing, id/URL validation, static serving, streaming, the
whole browser flow) is real code.

Note: Playwright's Chromium lacks AAC codecs, so real m4a previews wouldn't
decode there anyway; real browsers (Chrome/Edge/Safari/Firefox) all decode AAC.

## Drive (headless Chromium via playwright-core)

Launch with `executablePath: '/opt/pw-browsers/chromium'` and
`--autoplay-policy=no-user-gesture-required`. Flows worth driving:

1. Search → cards render (`.card`); iTunes tracks without `previewUrl` and
   Audius `is_streamable:false` tracks are filtered.
2. Source toggle: Audius is the default radio; `input[value="itunes"]` needs
   `click({force:true})` (the styled span covers the hidden input).
3. Click `.play-btn` → glyph flips to `❚❚`, `.progress-fill` width grows,
   `.time` ticks (m:ss). Click again → pauses. Play another card → first resets.
4. Downloads → `page.waitForEvent('download')`, save, check magics: MP3 starts
   `ff fb`; WAV starts `RIFF....WAVE`, check channels/rate/bits at offsets
   22/24/34 and duration = dataSize(offset 40) / (rate·ch·2) ≈ fixture length.
   Audius MP3 is a passthrough — assert byte-identical to the fixture.
   Non-downloadable Audius card → no `.dl-btn`, shows `.no-dl` note.

## API probes

```bash
curl 'localhost:3100/api/search?q=daft+punk'                # 200 JSON
curl 'localhost:3100/api/search?q='                         # 400
curl 'localhost:3100/api/preview?url=https%3A%2F%2Fevil.example.com%2Fx'  # 400 (SSRF guard)
curl 'localhost:3100/api/preview?url=http%3A%2F%2Faudio-ssl.itunes.apple.com%2Fa'  # 400 (https only)
curl --path-as-is 'localhost:3100/../server.js'             # 404 (traversal)
curl -X POST 'localhost:3100/api/search?q=x'                # 405
curl 'localhost:3100/api/search?q=indie&source=audius'      # 200 JSON
curl 'localhost:3100/api/audius/stream?id=..%2Fetc%2Fpasswd' # 400 (id regex)
curl -D- -o/dev/null 'localhost:3100/api/audius/stream?id=Abc123&download=1&name=x.mp3'  # Content-Disposition
```
