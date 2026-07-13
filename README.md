# Track Finder 🎵

Search for a song, listen to it, and download it as **MP3** or **WAV** — all in your browser, from two sources:

- **Audius** (default) — full-length tracks that artists publish for free streaming on [Audius](https://audius.co). Download buttons appear on tracks whose artist has enabled downloads. Open API, no key needed.
- **iTunes** — the official 30-second preview clips Apple serves for every mainstream track, via the free [iTunes Search API](https://performance-partners.apple.com/search-api). Great for checking out chart music (full mainstream tracks aren't legally free-downloadable, so those stay previews).

## How it works

- A **zero-dependency Node server** (`server.js`) serves the frontend and proxies both APIs (neither sends CORS headers, so the browser can't call them directly). The Audius proxy resolves a live discovery node from `api.audius.co` and fails over across hosts.
- The browser plays tracks with an `<audio>` element and shows live progress.
- Downloads:
  - **Audius MP3** — straight passthrough of the original MP3 stream with a `Content-Disposition` header. No re-encode, instant.
  - **Audius WAV / iTunes MP3+WAV** — converted **entirely in the browser**: audio is decoded with the Web Audio API, then encoded to 16-bit PCM WAV in plain JavaScript, or to 192 kbps MP3 with the vendored [lamejs](https://github.com/zhuker/lamejs) library (`public/vendor/lame.min.js`, LGPL).

No ffmpeg, no build step, no npm packages to install.

## Run it

```bash
node server.js
```

Then open <http://localhost:3000>, pick a source, search, hit play, and use the **Download MP3** / **Download WAV** buttons.

To use a different port: `PORT=8080 node server.js`

## Project layout

```
server.js            Static server + /api/search + /api/preview + /api/audius/stream
public/
  index.html         Page shell + source toggle
  styles.css         Dark, music-app styling
  app.js             Search, playback, and MP3/WAV encoding logic
  vendor/
    lame.min.js      lamejs MP3 encoder (vendored, LGPL — see LAMEJS-LICENSE.txt)
```

## Notes

- Audius artists choose whether their tracks are downloadable; the app respects that flag and shows "streaming only" otherwise.
- The `/api/preview` proxy only accepts URLs on Apple's CDN (`*.apple.com` / `*.mzstatic.com`), and `/api/audius/stream` only accepts alphanumeric Audius track IDs — no arbitrary-URL proxying.
- WAV files converted from a lossy source (AAC/MP3) are lossless *copies of the lossy audio* — bigger files, not better sound.
