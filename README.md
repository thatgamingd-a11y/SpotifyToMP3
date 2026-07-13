# Preview Finder 🎵

Search for any song, listen to its **30-second preview**, and download that preview as **MP3** or **WAV** — all in your browser.

Search results and preview clips come from the free [iTunes Search API](https://performance-partners.apple.com/search-api) (no API key needed).

## How it works

- A tiny **zero-dependency Node server** (`server.js`) serves the frontend and proxies the iTunes Search API and Apple's preview audio (neither sends CORS headers, so the browser can't call them directly).
- The browser plays previews with an `<audio>` element and shows live progress.
- Downloads are converted **entirely in the browser**: the preview (AAC/M4A) is decoded with the Web Audio API, then encoded to
  - **WAV** — 16-bit PCM, written in plain JavaScript, or
  - **MP3** — 192 kbps, encoded with the vendored [lamejs](https://github.com/zhuker/lamejs) library (`public/vendor/lame.min.js`, LGPL).

No ffmpeg, no build step, no npm packages to install.

## Run it

```bash
node server.js
```

Then open <http://localhost:3000>, search for a song, hit play, and use the **Download MP3** / **Download WAV** buttons on any result.

To use a different port: `PORT=8080 node server.js`

## Project layout

```
server.js            Static file server + /api/search + /api/preview proxy
public/
  index.html         Page shell
  styles.css         Dark, music-app styling
  app.js             Search, playback, and MP3/WAV encoding logic
  vendor/
    lame.min.js      lamejs MP3 encoder (vendored, LGPL — see LAMEJS-LICENSE.txt)
```

## Notes

- Previews are the 30-second clips Apple publicly serves for every track — this app doesn't download full songs.
- The `/api/preview` proxy only accepts URLs on Apple's CDN (`*.apple.com` / `*.mzstatic.com`).
