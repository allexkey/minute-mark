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
