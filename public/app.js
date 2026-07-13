/* global lamejs */

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

// One shared player so starting a track stops the previous one.
const player = new Audio();
let currentCard = null; // card element whose track is loaded in the player

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

const PLAY_GLYPH = '▶';
const PAUSE_GLYPH = '❚❚';

function proxied(previewUrl) {
  return '/api/preview?url=' + encodeURIComponent(previewUrl);
}

function setStatus(message, isError = false) {
  statusEl.hidden = !message;
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', isError);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;

  stopPlayback();
  resultsEl.innerHTML = '';
  setStatus('Searching…');

  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    if (!data.results.length) {
      setStatus(`No previews found for “${q}”. Try another search.`);
      return;
    }
    setStatus('');
    for (const track of data.results) resultsEl.appendChild(renderCard(track));
  } catch (err) {
    setStatus(err.message, true);
  }
});

function renderCard(track) {
  const li = document.createElement('li');
  li.className = 'card';

  const top = document.createElement('div');
  top.className = 'card-top';

  const img = document.createElement('img');
  img.className = 'artwork';
  img.src = track.artwork;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    img.removeAttribute('src');
    img.classList.add('artwork-fallback');
  });

  const meta = document.createElement('div');
  meta.className = 'meta';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = track.title;
  title.title = track.title;
  const artist = document.createElement('div');
  artist.className = 'artist';
  artist.textContent = track.artist;
  const album = document.createElement('div');
  album.className = 'album';
  album.textContent = track.album;
  meta.append(title, artist, album);
  top.append(img, meta);

  const playerRow = document.createElement('div');
  playerRow.className = 'player-row';

  const playBtn = document.createElement('button');
  playBtn.className = 'play-btn';
  playBtn.textContent = PLAY_GLYPH;
  playBtn.setAttribute('aria-label', `Play preview of ${track.title}`);

  const progress = document.createElement('div');
  progress.className = 'progress';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  progress.appendChild(fill);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = '0:00';

  playerRow.append(playBtn, progress, time);

  const dlRow = document.createElement('div');
  dlRow.className = 'download-row';
  const mp3Btn = document.createElement('button');
  mp3Btn.className = 'dl-btn';
  mp3Btn.textContent = 'Download MP3';
  const wavBtn = document.createElement('button');
  wavBtn.className = 'dl-btn';
  wavBtn.textContent = 'Download WAV';
  dlRow.append(mp3Btn, wavBtn);

  li.append(top, playerRow, dlRow);

  playBtn.addEventListener('click', () => togglePlay(li, track, playBtn, fill, time));
  mp3Btn.addEventListener('click', () => download(track, 'mp3', mp3Btn));
  wavBtn.addEventListener('click', () => download(track, 'wav', wavBtn));

  return li;
}

/* ---------------- Playback ---------------- */

function stopPlayback() {
  player.pause();
  player.removeAttribute('src');
  if (currentCard) {
    currentCard.querySelector('.play-btn').textContent = PLAY_GLYPH;
    currentCard.querySelector('.progress-fill').style.width = '0%';
    currentCard.querySelector('.time').textContent = '0:00';
  }
  currentCard = null;
}

function togglePlay(card, track, playBtn, fill, time) {
  if (currentCard === card) {
    if (player.paused) {
      player.play();
      playBtn.textContent = PAUSE_GLYPH;
    } else {
      player.pause();
      playBtn.textContent = PLAY_GLYPH;
    }
    return;
  }

  stopPlayback();
  currentCard = card;
  player.src = proxied(track.previewUrl);
  player.play().catch(() => {
    setStatus('Could not play this preview.', true);
    stopPlayback();
  });
  playBtn.textContent = PAUSE_GLYPH;

  player.ontimeupdate = () => {
    if (currentCard !== card || !player.duration) return;
    fill.style.width = (player.currentTime / player.duration) * 100 + '%';
    const s = Math.floor(player.currentTime);
    time.textContent = `0:${String(s).padStart(2, '0')}`;
  };
  player.onended = () => {
    if (currentCard === card) stopPlayback();
  };
}

/* ---------------- Download & conversion ---------------- */

async function download(track, format, btn) {
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Converting…';
  try {
    const res = await fetch(proxied(track.previewUrl));
    if (!res.ok) throw new Error('Could not fetch the preview audio.');
    const bytes = await res.arrayBuffer();
    const audio = await getAudioContext().decodeAudioData(bytes);

    const blob = format === 'wav' ? encodeWav(audio) : encodeMp3(audio);
    const name = safeFilename(`${track.artist} - ${track.title} (preview).${format}`);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    setStatus(`Download failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 180);
}

function floatTo16(channelData) {
  const out = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWav(audio) {
  const numCh = Math.min(2, audio.numberOfChannels);
  const sampleRate = audio.sampleRate;
  const frames = audio.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let ch = 0; ch < numCh; ch++) channels.push(floatTo16(audio.getChannelData(ch)));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      view.setInt16(offset, channels[ch][i], true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function encodeMp3(audio) {
  const numCh = Math.min(2, audio.numberOfChannels);
  const sampleRate = audio.sampleRate;
  const left = floatTo16(audio.getChannelData(0));
  const right = numCh === 2 ? floatTo16(audio.getChannelData(1)) : null;

  const encoder = new lamejs.Mp3Encoder(numCh, sampleRate, 192);
  const blockSize = 1152;
  const parts = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const chunk = right
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
      : encoder.encodeBuffer(leftChunk);
    if (chunk.length) parts.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail);

  return new Blob(parts, { type: 'audio/mpeg' });
}
