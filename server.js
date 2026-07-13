// Zero-dependency Node server: serves the static frontend and proxies the
// iTunes Search API + preview audio (both of which lack CORS headers).
// Run with: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* ---------------- Audius (full tracks, free & legal) ---------------- */

// Audius is a decentralized platform; api.audius.co lists the current
// discovery nodes. Cache the list and fall back to known hosts if it's down.
const AUDIUS_APP = 'track-finder';
const AUDIUS_FALLBACK_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];
let audiusHosts = null;
let audiusHostsFetchedAt = 0;

async function getAudiusHosts() {
  if (audiusHosts && Date.now() - audiusHostsFetchedAt < 60 * 60 * 1000) {
    return audiusHosts;
  }
  try {
    const res = await fetch('https://api.audius.co', { signal: AbortSignal.timeout(8_000) });
    const data = await res.json();
    if (Array.isArray(data.data) && data.data.length) {
      audiusHosts = data.data;
      audiusHostsFetchedAt = Date.now();
      return audiusHosts;
    }
  } catch {
    // fall through to the static list
  }
  return AUDIUS_FALLBACK_HOSTS;
}

async function audiusFetch(pathAndQuery, timeoutMs) {
  const hosts = await getAudiusHosts();
  let lastErr;
  for (const host of hosts.slice(0, 3)) {
    try {
      const res = await fetch(host + pathAndQuery, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastErr = new Error(`Audius host returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No Audius host reachable');
}

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 180);
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Preview URLs must point at Apple's CDN — never proxy arbitrary hosts.
function isAllowedPreviewUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  return (
    host === 'apple.com' ||
    host.endsWith('.apple.com') ||
    host === 'mzstatic.com' ||
    host.endsWith('.mzstatic.com')
  );
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function handleSearch(req, res, query) {
  const term = (query.get('q') || '').trim();
  if (!term) return sendJson(res, 400, { error: 'Missing search query' });
  if (query.get('source') === 'audius') return searchAudius(res, term);
  return searchItunes(res, term);
}

async function searchAudius(res, term) {
  try {
    const upstream = await audiusFetch(
      `/v1/tracks/search?query=${encodeURIComponent(term)}&app_name=${AUDIUS_APP}`,
      10_000
    );
    const data = await upstream.json();
    const results = (data.data || [])
      .filter((t) => t.is_streamable !== false)
      .slice(0, 24)
      .map((t) => ({
        id: t.id,
        source: 'audius',
        title: t.title,
        artist: (t.user && t.user.name) || 'Unknown artist',
        album: t.genre || '',
        artwork: (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'])) || '',
        durationMs: (t.duration || 0) * 1000,
        // Artists opt in to downloads on Audius; respect that choice.
        downloadable: Boolean(t.is_downloadable ?? t.downloadable),
      }));
    sendJson(res, 200, { results });
  } catch (err) {
    sendJson(res, 502, { error: 'Audius search failed: ' + err.message });
  }
}

async function searchItunes(res, term) {
  const apiUrl = new URL('https://itunes.apple.com/search');
  apiUrl.searchParams.set('term', term);
  apiUrl.searchParams.set('media', 'music');
  apiUrl.searchParams.set('entity', 'song');
  apiUrl.searchParams.set('limit', '24');

  try {
    const upstream = await fetch(apiUrl, { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok) {
      return sendJson(res, 502, { error: `Search service returned ${upstream.status}` });
    }
    const data = await upstream.json();
    const results = (data.results || [])
      .filter((t) => t.previewUrl)
      .map((t) => ({
        id: t.trackId,
        source: 'itunes',
        downloadable: true,
        title: t.trackName,
        artist: t.artistName,
        album: t.collectionName || '',
        // Bump the artwork from 100x100 to 300x300 for crisper cards.
        artwork: (t.artworkUrl100 || '').replace('100x100', '300x300'),
        previewUrl: t.previewUrl,
        durationMs: t.trackTimeMillis || 0,
      }));
    sendJson(res, 200, { results });
  } catch (err) {
    sendJson(res, 502, { error: 'Search failed: ' + err.message });
  }
}

async function handlePreview(req, res, query) {
  const rawUrl = query.get('url') || '';
  if (!isAllowedPreviewUrl(rawUrl)) {
    return sendJson(res, 400, { error: 'Invalid preview URL' });
  }

  try {
    const upstream = await fetch(rawUrl, { signal: AbortSignal.timeout(20_000) });
    if (!upstream.ok || !upstream.body) {
      return sendJson(res, 502, { error: `Preview fetch returned ${upstream.status}` });
    }
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
      'Cache-Control': 'public, max-age=3600',
    };
    const len = upstream.headers.get('content-length');
    if (len) headers['Content-Length'] = len;
    res.writeHead(200, headers);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    sendJson(res, 502, { error: 'Preview fetch failed: ' + err.message });
  }
}

// Streams the full track from Audius. With download=1 it sets a
// Content-Disposition header so the browser saves the MP3 directly.
async function handleAudiusStream(req, res, query) {
  const id = query.get('id') || '';
  if (!/^[A-Za-z0-9]{1,32}$/.test(id)) {
    return sendJson(res, 400, { error: 'Invalid track id' });
  }
  try {
    const upstream = await audiusFetch(`/v1/tracks/${id}/stream?app_name=${AUDIUS_APP}`, 30_000);
    if (!upstream.body) return sendJson(res, 502, { error: 'Audius stream had no body' });
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'public, max-age=3600',
    };
    const len = upstream.headers.get('content-length');
    if (len) headers['Content-Length'] = len;
    if (query.get('download') === '1') {
      const name = sanitizeName(query.get('name') || `audius-${id}.mp3`);
      headers['Content-Disposition'] = contentDisposition(name);
    }
    res.writeHead(200, headers);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    sendJson(res, 502, { error: 'Audius stream failed: ' + err.message });
  }
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  // path.join + normalize can still escape with crafted input; enforce the root.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }
  if (pathname === '/api/search') return handleSearch(req, res, searchParams);
  if (pathname === '/api/preview') return handlePreview(req, res, searchParams);
  if (pathname === '/api/audius/stream') return handleAudiusStream(req, res, searchParams);
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`♪ Track Finder running at http://localhost:${PORT}`);
});
