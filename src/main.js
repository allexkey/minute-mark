import './styles.css';
import * as E from './engine.js';
import { AudioCues } from './audio.js';
import { keepAwake, allowSleep } from './wakelock.js';
import * as store from './store.js';
import { mountSetup } from './views/setup.js';
import { mountRun } from './views/run.js';
import { mountSummary } from './views/summary.js';
import { mountHistory } from './views/history.js';
import { mountSettings } from './views/settings.js';

const SCHEDULE_AHEAD_MS = 8000; // > the ~2 s timer throttling of a locked iPhone
const TICK_MS = 250;
const STALE_VOICE_MS = 3000; // don't speak a cue we only noticed long after it happened
const RESTORE_MAX_AGE_MS = 6 * 3600_000;

const root = document.getElementById('app');
const audio = new AudioCues();

let runView = null;
let rafId = 0;
let lastE = null; // session ms at the previous tick
let lastTitle = '';
let lastBeat = 0;
let hiddenAt = 0;

const app = {
  cfg: store.loadCfg(),
  session: null,
  markedWallAt: 0,
  historyFilter: '',

  saveCfg() { store.saveCfg(this.cfg); },

  go(name, ...args) {
    cancelAnimationFrame(rafId);
    runView = null;
    if (name === 'setup') mountSetup(root, app);
    else if (name === 'history') mountHistory(root, app);
    else if (name === 'settings') mountSettings(root, app);
    else if (name === 'summary') mountSummary(root, app, ...args);
    else if (name === 'run') {
      runView = mountRun(root, app);
      frame();
    }
    window.scrollTo(0, 0);
  },

  // ---- session lifecycle (Start runs inside the user's tap) ----

  async start() {
    const s = E.createSession(this.cfg, Date.now());
    this.session = s;
    this.markedWallAt = 0;
    lastE = null;
    lastTitle = '';
    const started = audio.start(s.mode, { onDone: () => app.markDone(), onUndo: () => app.undo() });
    audio.say('Get ready');
    keepAwake();
    store.persistStorage();
    persist(true);
    this.go('run');
    await started;
    tick();
  },

  markDone() {
    const s = this.session;
    if (!s || !E.markDone(s, Date.now())) return;
    this.markedWallAt = Date.now();
    if (s.type === 'rest') {
      audio.cancelAll(); // the next set's cues depend on this mark
      if (E.view(s, Date.now()).phase === 'target') { finish({ targetReached: true }); return; }
    }
    audio.confirm();
    if (this.cfg.sayRest) audio.say('Rest');
    persist(true);
    tick();
  },

  undo() {
    const s = this.session;
    if (!s || !E.undoMark(s, Date.now())) return;
    this.markedWallAt = 0;
    if (s.type === 'rest') audio.cancelAll();
    audio.undo();
    persist(true);
    tick();
  },

  /** Rest timer: ±15 s on the current rest. */
  adjustRest(deltaMs) {
    const s = this.session;
    if (!s || !E.adjustRest(s, Date.now(), deltaMs)) return;
    audio.cancelAll();
    audio.now((t) => audio.tone(deltaMs > 0 ? 880 : 660, 0.07, t));
    persist(true);
    tick();
  },

  skipRest() {
    const s = this.session;
    if (!s || !E.skipRest(s, Date.now())) return;
    audio.cancelAll();
    persist(true);
    tick();
  },

  pause() {
    const s = this.session;
    if (!s || !E.pause(s, Date.now())) return;
    audio.cancelAll();
    audio.pauseTone();
    audio.say('Paused');
    persist(true);
    tick();
  },

  async resume() {
    const s = this.session;
    if (!s) return;
    if (!audio.ready) await audio.start(s.mode, { onDone: () => app.markDone(), onUndo: () => app.undo() });
    else await audio.wake();
    E.resume(s, Date.now());
    lastE = E.elapsed(s, Date.now());
    audio.resumeTone();
    audio.say('Resuming');
    keepAwake();
    persist(true);
    tick();
  },

  end() {
    if (!this.session) return;
    finish({ targetReached: false });
  },

  async keepGoing() {
    const s = this.session;
    if (!s) return;
    if (!audio.ready) await audio.start(s.mode, { onDone: () => app.markDone(), onUndo: () => app.undo() });
    else await audio.wake();
    E.keepGoing(s, Date.now());
    lastE = E.elapsed(s, Date.now());
    audio.say('Keep going');
    keepAwake();
    persist(true);
    this.go('run');
    tick();
  },

  // ---- history ----

  history: () => store.allSessions(),

  async exercises() {
    const list = await store.allSessions();
    return [...new Set(list.map((r) => r.exercise).filter(Boolean))];
  },

  async saveRecord(rec, opts) {
    if (opts.isNew) {
      const { id, ...fresh } = rec;
      await store.addSession(fresh);
      closeSession();
    } else {
      await store.putSession(rec);
    }
    this.go('history');
  },

  discard() {
    closeSession();
    this.go('setup');
  },

  async deleteRecord(id) {
    await store.deleteSession(id);
    this.go('history');
  },

  async openRecord(id) {
    const rec = await store.getSession(id);
    if (rec) this.go('summary', rec, { isNew: false });
  },
};

// ---- the clock ------------------------------------------------------------------

/** Runs every 250 ms (throttled to ~2 s by iOS when locked): cues, voice, lock screen, heartbeat. */
function tick() {
  const s = app.session;
  if (!s) return;
  const now = Date.now();
  const v = E.view(s, now);

  if (!v.paused) {
    const e = E.elapsed(s, now);
    if (lastE != null && e > lastE) {
      for (const cue of E.cuesBetween(s, lastE, e)) {
        onCue(cue, e);
        if (!app.session) return; // target reached ended the run
      }
    }
    lastE = e;
    audio.schedule(E.cuesBetween(s, e, e + SCHEDULE_AHEAD_MS), e);
  }

  const title = v.paused ? 'Paused'
    : v.phase === 'ready' ? 'Get ready'
    : v.phase === 'rest' ? `Set ${v.set} · Rest`
    : v.phase === 'last' ? `Set ${v.set + 1} next`
    : `Set ${v.set}`;
  if (title !== lastTitle) { lastTitle = title; audio.setNowPlaying(title); }

  persist(false);
}

/** A cue's moment has passed: visuals and voice (the sound itself was scheduled ahead). */
function onCue(cue, e) {
  if (cue.kind === 'target') { finish({ targetReached: true }); return; }
  if (cue.kind !== 'go' || e - cue.at > STALE_VOICE_MS) return;
  runView?.flash();
  const text = app.cfg.announceMinutes && cue.announceMinutes ? `${cue.announceMinutes} minutes` : `Set ${cue.set}`;
  setTimeout(() => audio.say(text), 450); // after the long beep
}

function frame() {
  if (runView && app.session) runView.update(E.view(app.session, Date.now()), app.session, app);
  rafId = requestAnimationFrame(frame);
}

function persist(force) {
  const now = Date.now();
  if (!force && now - lastBeat < 1000) return;
  lastBeat = now;
  store.saveLive(app.session, now);
}

function finish({ targetReached }) {
  const s = app.session;
  const now = Date.now();
  if (targetReached) E.reachTarget(s);
  else E.pause(s, now);
  audio.cancelAll();
  const sum = E.summary(s, now);
  const rec = {
    startedAt: s.startedAt, type: s.type, mode: s.mode, interval: sum.interval, rest: sum.rest, sets: sum.sets, totalMs: sum.totalMs,
    durations: sum.durations, avg: sum.avg, slowest: sum.slowest, exercise: '', note: '',
  };
  if (targetReached) {
    if (s.type === 'rest') audio.final(); // EMOM already scheduled its target chord as a cue
    audio.say(`Target reached. ${sum.sets} sets.`);
  } else {
    audio.final();
    audio.say(sum.sets ? `Session complete. ${sum.sets} ${sum.sets === 1 ? 'set' : 'sets'}.` : 'Session ended.');
    audio.stopSoon();
    app.session = null;
    store.clearLive();
  }
  allowSleep();
  lastTitle = '';
  app.go('summary', rec, { isNew: true, targetReached });
}

/** After Save or Discard: drop the (possibly kept-for-"Keep going") session. */
function closeSession() {
  if (app.session) { app.session = null; store.clearLive(); }
  audio.stop();
  allowSleep();
}

setInterval(tick, TICK_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); persist(true); return; }
  audio.wake();
  const s = app.session;
  if (s && runView && hiddenAt && Date.now() - hiddenAt > 10_000 && s.pausedAt == null) {
    const v = E.view(s, Date.now());
    const away = Math.round((Date.now() - hiddenAt) / 60_000);
    runView.toast(`You were away ${away ? `${away} min` : 'a moment'} · Set ${v.set} in progress`);
  }
  hiddenAt = 0;
  tick();
});

// ---- boot -------------------------------------------------------------------------

function boot() {
  const live = store.loadLive();
  if (live?.session && Date.now() - live.heartbeat < RESTORE_MAX_AGE_MS) {
    const s = live.session;
    // The app was closed mid-session: freeze it where we last saw it.
    if (s.pausedAt == null) s.pausedAt = live.heartbeat;
    app.session = s;
    if (s.targetReached) { finish({ targetReached: true }); return; }
    app.go('run');
    runView?.toast('Session restored · tap Resume');
    return;
  }
  store.clearLive();
  app.go('setup');
}

boot();

// Dev-only handle for automated screenshots (tools/shots.mjs); stripped from production builds.
if (import.meta.env.DEV) window.__mm = { app, E };

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
