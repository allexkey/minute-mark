---
name: ios-pwa-rules
description: Verified iPhone PWA rules for the Minute Mark EMOM timer — audio cues, voice, AirPods/Media Session, screen lock, wake lock, silent switch. Use whenever writing or reviewing code that plays sounds, speaks, reacts to AirPods or media keys, keeps the screen on, runs timers, or must work with the iPhone locked; and before telling the user something "works on iOS".
---

# iOS PWA rules (Minute Mark)

These rules come from a real-device test on **iPhone, iOS 26.6.1** (Safari 26.6.1 and the installed Home Screen app), 23 Sep 2026. The test page is `spike/index.html`. The full design spec is `design/specificatie-emom.html`.

Note: the user agent says `iPhone OS 18_7` — that value is frozen by Apple. Read the real version from `Version/26.x`.

## Verified behaviour

| Area | Result on iOS 26.6.1 |
|---|---|
| Media Session handlers (`play`, `pause`, `stop`, `nexttrack`, `previoustrack`, `seekforward`, `seekbackward`) | All register without error |
| AirPods single press | Fires `pause`, also with the screen **locked** (installed app) |
| AirPods double press | Fires `nexttrack` — a distinct event |
| Staying Now Playing | Calling `audio.play()` inside the `pause` handler succeeds, so the app keeps receiving presses |
| Lock screen | Shows `MediaMetadata` title + artist ("Set 2 · Minute Mark") |
| JS with screen locked, mode A (`audioSession.type = 'playback'` + looping silent `<audio>`) | Keeps running, but `setInterval` is throttled to ~2 s |
| Web Audio beeps + `speechSynthesis` with screen locked, mode A | Audible |
| Mode B (`audioSession.type = 'ambient'`, no `<audio>` loop) | Music from Spotify keeps playing; beeps and voice mix on top |
| Silent (ring/silent) switch on | Beeps still audible in **both** mode A and mode B |
| Screen Wake Lock | Works in Safari and in the installed app; re-request it on `visibilitychange` → visible |
| Vibration | Not available on iOS PWA |

**Not yet tested:** mode B with the screen locked. Until it is verified, keep the screen on in mode B (wake lock) and do not promise locked-screen cues in that mode.

## Rules

1. **Never trigger cues from `setInterval`/`setTimeout` ticks.** The locked iPhone throttles them to ~2 s. Schedule every beep ahead on the `AudioContext` clock (`osc.start(ac.currentTime + delta)`), at least ~3 s into the future, and reschedule when the state changes (pause, undo, resume).
2. **Derive all time from timestamps**, never by counting ticks: `elapsed = now - startedAt - pausedTotal`. The set number and the total must stay correct after the page was throttled or suspended.
3. **Unlock audio in the Start tap:** create or resume the `AudioContext`, start the `<audio>` loop (mode A), and speak or prime `speechSynthesis` — all inside the same user gesture.
4. **Set `navigator.audioSession.type` before any audio starts:** `'playback'` in AirPods mode, `'ambient'` in With music mode. Feature-detect it (`'audioSession' in navigator`). Changing the mode means tearing the audio down and starting again.
5. **Mode A (AirPods) needs a looping `<audio>`** with a generated silent WAV (a blob URL, `loop = true`, `playsinline`). Set `navigator.mediaSession.metadata` and `playbackState = 'playing'`.
6. **Map AirPods presses:** `pause` and `play` mean **set done**; `nexttrack` means **UNDO**. After handling `pause`, immediately call `audio.play()` and set `playbackState = 'playing'` again. Log the reason if `play()` rejects.
7. **Keep the lock screen informative:** update `MediaMetadata.title` on every phase change, e.g. `Set 8 · Rest · 0:18`. Do not rewrite it every second.
8. **Wake lock:** request it on Start, listen for `release`, re-request it on `visibilitychange` → visible, and release it on End.
9. **Voice:** use `SpeechSynthesisUtterance` with `lang = 'en-US'` and prefer a voice whose `lang` matches `/^en[-_]US/`. All app strings and voice lines are English.
10. **No haptics on iOS PWA.** Do not design any feature that depends on vibration. Guard `navigator.vibrate` behind feature detection (it is a no-op bonus on Android).

## Testing on the iPhone

- Wake Lock and Media Session need **HTTPS**. Serve the build locally (e.g. `python3 -m http.server --bind 127.0.0.1`) and expose it through an HTTPS tunnel.
- **Ask the user before downloading a tunnel tool** (such as `cloudflared`). The user asked to remove third-party downloads after the last session.
- Test in the **installed Home Screen app**, not only in Safari. The AirPods and locked-screen results above were obtained in standalone mode.
- Reuse `spike/index.html` for isolated audio/Media Session checks. It logs every event and has a "Copy log" button, so the user can paste the log into the chat.
- Record new findings in the "Verified behaviour" table above, and in the test results section of the design spec.
