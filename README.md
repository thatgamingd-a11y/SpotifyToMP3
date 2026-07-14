# 👣 StepMap

A step tracker with a map that shows everywhere you've walked. It runs
entirely in your browser — your steps and location history are stored **only
on your device** (browser localStorage) and are never uploaded anywhere.

## What it does

- **Counts your steps** using your phone's motion sensor while a walk is
  active. If your device has no motion sensor (e.g. a laptop), steps are
  estimated from the GPS distance you cover.
- **Draws your route live on a map** while you walk, and keeps every past
  walk on the map so you can see everywhere you've been.
- **Keeps daily history**: steps and distance per day, plus all-time totals.
- Tries to keep your screen awake during a walk so counting isn't
  interrupted.

## How to use it

1. Open the app (see below) on your phone.
2. Tap **▶ Start walk**. Allow **motion** and **location** access when asked.
3. Walk! Your steps, distance, and route update live.
4. Tap **■ Stop walk** when you're done — the walk is saved to your map and
   your daily history.

Open **History & totals** at the bottom to see past days, or to erase all
your data.

## Running it

The app is completely static (just `index.html`, `style.css`, `app.js`), so
there are two easy options:

### Option A — GitHub Pages (best for your phone)

Phones only allow GPS and motion sensors on **HTTPS** pages, and GitHub Pages
gives you that for free:

1. In this repository on GitHub, go to **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, pick your
   main branch and the `/ (root)` folder, then save.
3. Open the published URL on your phone (something like
   `https://<your-username>.github.io/<repo-name>/`).

### Option B — Locally

```bash
npm start
```

Then open <http://localhost:3000>. This works on the same computer
(`localhost` counts as secure), but note a desktop browser usually has no
motion sensor, so steps will be estimated from GPS distance — the map still
works if your browser can get a location fix.

## Notes & limits

- The browser must stay open (foreground) during a walk — browsers pause
  motion sensors for background tabs. The app requests a screen wake lock to
  help with this.
- Step counting from a phone accelerometer is an estimate; treat trends, not
  exact counts, as the signal.
- Map tiles are loaded from [OpenStreetMap](https://www.openstreetmap.org/);
  only your route drawing stays on your device — no location data is sent to
  any server.
