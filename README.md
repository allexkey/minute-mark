# Minute Mark

A gym timer PWA for iPhone with two timers: **EMOM** (a new set every interval) and **Rest timer** (you work at your own pace; tapping starts a fixed rest countdown, then the next set starts automatically). The paragraph below describes EMOM.

An EMOM gym timer, built as a PWA for iPhone. Every minute it beeps and announces the set. The screen shows the set number and the total session time, and the whole screen changes colour by phase: green = work, blue = rest, orange = the last 5 s. You mark the end of a set with a tap, or with an AirPods press.

- Design spec: `design/specificatie-emom.html` (in Romanian)
- iOS rules verified on a real device: `.claude/skills/ios-pwa-rules/SKILL.md`
- iOS test page: `spike/`

## Commands

```bash
npm install
npm run dev       # http://127.0.0.1:5173
npm test          # engine unit tests (node --test, no extra deps)
npm run build     # dist/ with a generated service worker (offline)
npm run preview   # serve dist/ on http://127.0.0.1:4173
```

To try the app on an iPhone, serve `dist/` over HTTPS. Wake Lock and Media Session need a secure context. Install it with Share → Add to Home Screen.

## Tech stack

The app is plain JavaScript with no framework. Its only npm dependency is Vite.

**App (runs on the phone)**

| Layer | Technology |
|---|---|
| Language | JavaScript (ES modules), HTML, CSS; no framework |
| UI | Direct DOM with template strings; CSS custom properties and viewport units; separate portrait and landscape layouts |
| Fonts | Big Shoulders Display and Barlow (OFL), self-hosted in `public/fonts/` for offline use |
| Sound | Web Audio API: oscillator beeps scheduled ahead on the AudioContext clock |
| Voice | Web Speech API (`speechSynthesis`), en-US |
| AirPods | Media Session API with a silent looping `<audio>` so the app stays Now Playing; Audio Session API (`playback` / `ambient`) |
| Screen on | Screen Wake Lock API |
| Storage | localStorage for settings and the live session; IndexedDB for history |
| Offline | Hand-written service worker, cache-first |
| Install | Web App Manifest (PWA, Add to Home Screen) |

**Development**

| Role | Technology |
|---|---|
| Build and dev server | Vite 8; a small custom plugin in `vite.config.js` generates the service worker |
| Tests | `node:test` (built into Node 24); engine unit tests, no Jest or Vitest |
| Screenshots | `tools/shots.mjs` drives Chromium over the Chrome DevTools Protocol; no Playwright or Puppeteer |
| Icons | `tools/make-icons.py`, dependency-free Python that writes the PNGs |
| Runtime | Node 24 |

**Delivery**

| Role | Technology |
|---|---|
| Source | Git on GitHub (`allexkey/minute-mark`) |
| CI/CD | GitHub Actions: test, build and deploy on every push to `main` |
| Hosting | GitHub Pages over HTTPS (needed for Wake Lock and Media Session) |

The build is about 27 KB of JavaScript (under 10 KB gzipped). Later it can be wrapped with Capacitor for the App Store, keeping the same web code and adding native haptics and a Live Activity.

## Structure

| Path | What it does |
|---|---|
| `src/engine.js` | Pure session logic. All time comes from timestamps. Also lists the audio cues for a time window. |
| `src/audio.js` | Beeps scheduled ahead on the AudioContext clock, en-US voice, AirPods via Media Session |
| `src/main.js` | Controller: 250 ms tick, cue scheduling, lock-screen title, restoring an interrupted session |
| `src/views/` | Setup, Run, Summary, History, Settings |
| `src/store.js` | Settings and the live session in localStorage, history in IndexedDB, CSV export |
| `src/sw-template.js` | Service worker; `vite.config.js` fills in the precache list |
| `tools/make-icons.py` | Generates the PNG icons (no dependencies) |
| `tools/shots.mjs` | Screenshot tour through the Chrome DevTools Protocol (no dependencies) |

## Controls

| Action | How |
|---|---|
| Set done | Tap anywhere · AirPods single press |
| Undo | "Undo" button (3 s) · AirPods double press |
| Rest timer: change the current rest | −15s / +15s, Skip (AirPods presses during rest are ignored, except double = undo) |
| Pause | ⏸ button |
| End | Only from the pause screen |
