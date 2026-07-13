---
name: verify
description: How to run and verify the StepMap app (step counting, GPS route tracking on a Leaflet map, localStorage persistence) in a sandboxed/CI environment.
---

# Verifying StepMap

Static app (index.html / style.css / app.js, Leaflet vendored in
vendor/leaflet/). Serve with `node server.js` (port 3000, zero deps).

## Drive it with Playwright + mocked geolocation

- Chromium: `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`
  with `playwright-core` (npm registry is reachable even when CDNs are not).
- Context: `{ geolocation: {latitude, longitude}, permissions: ["geolocation"] }`,
  then `context.setGeolocation(...)` per GPS fix.
- **Move at walking pace**: app.js has a speed gate (`MAX_SPEED_MPS = 8`) that
  discards implausibly fast segments as GPS jumps. Fixes arrive with real
  timestamps, so hops must be < ~7 m per 0.9 s sleep or distance/steps stay 0.
  Also hops must exceed `MIN_POINT_GAP_M = 4` to register at all.
- Desktop Chromium has no motion sensor → steps are estimated from GPS
  distance (`/ 0.75 m`); that's the expected path here.

## Flows worth driving

1. Start walk → feed ~5.5 m fixes every 900 ms → steps/distance/timer tick,
   green live polyline + marker (`#map path.leaflet-interactive`).
2. Stop → "Walk saved" status, History & totals updates.
3. Reload → today's steps persist, saved walks drawn as blue polylines.
4. Probes: GPS teleport mid-walk (not counted, delta ~0), no-move walk
   ("no movement recorded", not saved), erase-all confirm/cancel dialog,
   corrupt localStorage **seeded via `addInitScript`** (a plain
   `localStorage.setItem(garbage)` + reload gets healed by the app's
   save-on-hidden handler before the new page loads).

## Gotchas

- unpkg/CDNs and tile.openstreetmap.org are blocked by the sandbox network
  policy: map tiles render black (harmless, `ERR_TUNNEL_CONNECTION_FAILED`
  console noise), and Leaflet must stay vendored, not on a CDN.
- Saves are debounced 400 ms (`save()`) except walk-stop and tab-hide which
  are synchronous (`saveNow()`) — don't reintroduce the debounce there or a
  stop-then-close loses the walk.
