/* StepMap — step tracker + map of everywhere you've walked.
   All data stays on this device (browser localStorage). */

(() => {
  "use strict";

  const STORAGE_KEY = "stepmap.v1";
  const STRIDE_METERS = 0.75;        // avg step length, used when no motion sensor
  const MIN_POINT_GAP_M = 4;         // ignore GPS jitter below this distance
  const MAX_ACCURACY_M = 60;         // ignore fixes with worse accuracy
  const MAX_SPEED_MPS = 8;           // faster than this = GPS jump, not walking
  const STEP_THRESHOLD = 1.4;        // m/s^2 above gravity baseline
  const STEP_MIN_INTERVAL_MS = 280;  // max ~3.5 steps/sec

  // ---------- storage ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s === "object" && s.days && s.paths) return s;
      }
    } catch (e) { /* corrupted state: start fresh */ }
    return { days: {}, paths: [] };
  }

  const state = loadState();
  let saveQueued = false;

  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      setStatus("Storage full — oldest walk paths were trimmed.");
      state.paths.splice(0, Math.ceil(state.paths.length / 4));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e2) {}
    }
  }

  // debounced save for high-frequency updates (every step / GPS fix)
  function save() {
    if (saveQueued) return;
    saveQueued = true;
    setTimeout(() => {
      saveQueued = false;
      saveNow();
    }, 400);
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function day(key) {
    if (!state.days[key]) state.days[key] = { steps: 0, distance: 0 };
    return state.days[key];
  }

  // ---------- elements ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    todaySteps: $("todaySteps"),
    walkSteps: $("walkSteps"),
    walkDistance: $("walkDistance"),
    walkTime: $("walkTime"),
    trackBtn: $("trackBtn"),
    status: $("status"),
    totalSteps: $("totalSteps"),
    totalDistance: $("totalDistance"),
    totalWalks: $("totalWalks"),
    historyList: $("historyList"),
    clearBtn: $("clearBtn"),
  };

  function setStatus(msg) {
    el.status.textContent = msg;
  }

  // ---------- map ----------

  const map = L.map("map", { zoomControl: false }).setView([51.505, -0.09], 15);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const historyLayer = L.layerGroup().addTo(map);
  let liveLine = null;
  let hereMarker = null;

  function drawHistory() {
    historyLayer.clearLayers();
    const allPoints = [];
    for (const path of state.paths) {
      if (path.points.length < 2) continue;
      L.polyline(path.points, { color: "#60a5fa", weight: 4, opacity: 0.7 })
        .addTo(historyLayer);
      allPoints.push(...path.points);
    }
    return allPoints;
  }

  function fitToHistory() {
    const pts = drawHistory();
    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts).pad(0.15));
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => map.setView([p.coords.latitude, p.coords.longitude], 16),
        () => {},
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }

  // ---------- distance ----------

  function haversine(a, b) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function fmtDistance(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  }

  // ---------- step detection (accelerometer) ----------

  let motionWorks = false;
  let gravity = 9.81;
  let lastStepAt = 0;
  let aboveThreshold = false;

  function onMotion(e) {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;
    const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
    gravity = gravity * 0.92 + mag * 0.08; // slow baseline follows gravity
    const delta = mag - gravity;

    if (delta > STEP_THRESHOLD && !aboveThreshold) {
      aboveThreshold = true;
      const now = Date.now();
      if (now - lastStepAt > STEP_MIN_INTERVAL_MS) {
        lastStepAt = now;
        motionWorks = true;
        addSteps(1);
      }
    } else if (delta < STEP_THRESHOLD * 0.5) {
      aboveThreshold = false;
    }
  }

  async function enableMotion() {
    if (typeof DeviceMotionEvent === "undefined") return false;
    // iOS 13+ needs an explicit permission request from a user gesture
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted") return false;
      } catch (e) {
        return false;
      }
    }
    window.addEventListener("devicemotion", onMotion);
    return true;
  }

  function disableMotion() {
    window.removeEventListener("devicemotion", onMotion);
  }

  // ---------- walk session ----------

  let tracking = false;
  let watchId = null;
  let walk = null; // { startedAt, steps, distance, points }
  let timerId = null;
  let wakeLock = null;

  function addSteps(n) {
    if (!tracking) return;
    walk.steps += n;
    day(todayKey()).steps += n;
    save();
    renderCounts();
  }

  function onPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy > MAX_ACCURACY_M) {
      setStatus("Waiting for a better GPS signal…");
      return;
    }
    const pt = [latitude, longitude];

    if (!hereMarker) {
      hereMarker = L.circleMarker(pt, {
        radius: 8, color: "#fff", weight: 2, fillColor: "#34d399", fillOpacity: 1,
      }).addTo(map);
      map.setView(pt, Math.max(map.getZoom(), 16));
    } else {
      hereMarker.setLatLng(pt);
    }

    const now = pos.timestamp || Date.now();
    const last = walk.points[walk.points.length - 1];
    if (last) {
      const d = haversine(last, pt);
      if (d < MIN_POINT_GAP_M) return;
      const dt = (now - walk.lastFixAt) / 1000;
      const speed = dt > 0 ? d / dt : Infinity;
      // GPS jumps (signal reacquired far away) would inflate the numbers:
      // move the trail there but don't count the leap as walking
      if (speed <= MAX_SPEED_MPS) {
        walk.distance += d;
        day(todayKey()).distance += d;
        // no accelerometer? estimate steps from distance walked
        if (!motionWorks) {
          const estimated = Math.round(walk.distance / STRIDE_METERS);
          const diff = estimated - walk.steps;
          if (diff > 0) {
            walk.steps += diff;
            day(todayKey()).steps += diff;
          }
        }
      }
    }

    walk.lastFixAt = now;
    walk.points.push(pt);
    liveLine.addLatLng(pt);
    map.panTo(pt);
    save();
    renderCounts();
    setStatus(motionWorks ? "Tracking — counting your steps." :
      "Tracking — steps estimated from distance.");
  }

  function onPositionError(err) {
    if (err.code === err.PERMISSION_DENIED) {
      setStatus("Location permission denied — map tracking is off, steps still count.");
    } else {
      setStatus("GPS unavailable right now — still trying…");
    }
  }

  async function startWalk() {
    walk = { startedAt: Date.now(), lastFixAt: 0, steps: 0, distance: 0, points: [] };
    tracking = true;
    motionWorks = false;

    el.trackBtn.textContent = "■ Stop walk";
    el.trackBtn.classList.add("tracking");

    liveLine = L.polyline([], { color: "#34d399", weight: 5 }).addTo(map);

    const motionOk = await enableMotion();
    if (!window.isSecureContext) {
      setStatus("This page needs HTTPS for GPS & sensors — see the README.");
    } else if (!motionOk) {
      setStatus("No motion sensor — steps will be estimated from GPS distance.");
    } else {
      setStatus("Walk started — off you go!");
    }

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 20000,
      });
    }

    timerId = setInterval(renderCounts, 1000);
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) {}
  }

  function stopWalk() {
    tracking = false;
    disableMotion();
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearInterval(timerId);
    try { wakeLock?.release(); } catch (e) {}
    wakeLock = null;

    const saved = walk.points.length >= 2 || walk.steps > 0;
    if (walk.points.length >= 2) {
      state.paths.push({ startedAt: walk.startedAt, points: walk.points });
    }
    saveNow();

    if (liveLine) { map.removeLayer(liveLine); liveLine = null; }
    if (hereMarker) { map.removeLayer(hereMarker); hereMarker = null; }
    drawHistory();

    el.trackBtn.textContent = "▶ Start walk";
    el.trackBtn.classList.remove("tracking");
    setStatus(saved
      ? `Walk saved: ${walk.steps} steps, ${fmtDistance(walk.distance)}.`
      : "Walk ended — no movement recorded.");
    walk = null;
    renderAll();
  }

  // ---------- rendering ----------

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
             : `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderCounts() {
    el.todaySteps.textContent = day(todayKey()).steps.toLocaleString();
    if (walk) {
      el.walkSteps.textContent = walk.steps.toLocaleString();
      el.walkDistance.textContent = fmtDistance(walk.distance);
      el.walkTime.textContent = fmtTime(Date.now() - walk.startedAt);
    } else {
      el.walkSteps.textContent = "0";
      el.walkDistance.textContent = "0 m";
      el.walkTime.textContent = "0:00";
    }
  }

  function renderHistory() {
    let steps = 0, dist = 0;
    const keys = Object.keys(state.days).sort().reverse();
    el.historyList.innerHTML = "";
    for (const k of keys) {
      const d = state.days[k];
      steps += d.steps;
      dist += d.distance;
      const li = document.createElement("li");
      const date = document.createElement("span");
      date.className = "day";
      date.textContent = k;
      const val = document.createElement("span");
      val.textContent = `${d.steps.toLocaleString()} steps · ${fmtDistance(d.distance)}`;
      li.append(date, val);
      el.historyList.appendChild(li);
    }
    el.totalSteps.textContent = steps.toLocaleString() + " steps";
    el.totalDistance.textContent = fmtDistance(dist);
    el.totalWalks.textContent = state.paths.length + " walks";
  }

  function renderAll() {
    renderCounts();
    renderHistory();
  }

  // ---------- wire up ----------

  el.trackBtn.addEventListener("click", () => (tracking ? stopWalk() : startWalk()));

  el.clearBtn.addEventListener("click", () => {
    if (!confirm("Delete ALL your steps and map history? This cannot be undone.")) return;
    state.days = {};
    state.paths = [];
    localStorage.removeItem(STORAGE_KEY);
    drawHistory();
    renderAll();
    setStatus("All data erased.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });

  renderAll();
  fitToHistory();
})();
