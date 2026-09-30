// Session engine: pure functions over a plain, serialisable session object.
// All time is derived from timestamps (ms), never from counting ticks, so the
// state stays correct after iOS throttles or suspends the page.
//
// Two set types:
//   'emom' — a new set starts every interval; tapping only marks the set done.
//   'rest' — a set lasts until you tap; then a rest countdown runs and the next set starts when it ends.
//
// One timeline, in session ms (0 = start of set 1):
//   [warm-up W] [get ready R] | sets … mainEnd | [prep P] [stretch S] | done
//   R is 10 s without a warm-up and 1 min after one. Skipping a stage moves the timeline forward.

export const READY_MS = 10_000;
export const PREP_MS = 60_000;
export const LAST_MS = 5_000;
export const REST_STEP_MS = 15_000;
const COUNTDOWN = [5000, 4000, 3000, 2000, 1000]; // 5-4-3-2-1: the whole orange last-5-seconds screen
const STRETCH_PULSE_MS = 30_000; // a short beep every 30 s while stretching
const ANNOUNCE_EVERY_MS = 5 * 60_000;
const DEFAULT_SET_MS = 45_000; // rest-timer estimate before any set is done

export function createSession({ type = 'emom', interval = 60, rest = 60, target = 0, mode = 'airpods', warmup = 0, stretch = 0 }, now) {
  return {
    type,
    interval: interval * 1000,
    restMs: rest * 1000,
    target,
    mode,
    warmupMs: warmup * 60_000,
    stretchMs: stretch * 60_000,
    readyMs: warmup ? PREP_MS : READY_MS,
    wallStart: now,
    startedAt: now,
    pausedAt: null,
    pausedTotal: 0,
    marks: {}, // set number -> ms into the set when it was marked done
    rsets: [], // rest type: [{ start, doneAt, restEnd }] in session ms
    mainEnd: null, // session ms where the sets ended (then prep + stretch follow)
    skipped: { warmup: 0, stretch: 0 },
    targetReached: false,
  };
}

// sessions saved by older versions have no stages
const readyOf = (s) => s.readyMs ?? READY_MS;
const warmOf = (s) => s.warmupMs ?? 0;
const stretchOf = (s) => s.stretchMs ?? 0;

/** Session time in ms: negative during warm-up and get-ready. */
export function elapsed(s, now) {
  const t = s.pausedAt ?? now;
  return t - s.startedAt - s.pausedTotal - readyOf(s) - warmOf(s);
}

/** Session time at which the target is reached (Infinity while unknown or without a target). */
export function targetMs(s) {
  if (!s.target) return Infinity;
  if (s.type === 'rest') return s.rsets[s.target - 1]?.doneAt ?? Infinity;
  return s.target * s.interval;
}

/** Session time at which the sets end: the target, or where the user moved on to stretching. */
function setsEnd(s) {
  return Math.min(targetMs(s), s.mainEnd ?? Infinity);
}

/** Rest type: the set in progress. Once a rest ends, the next set exists implicitly until it is marked. */
function restCurrent(s, e) {
  const list = s.rsets;
  const last = list[list.length - 1];
  if (!last) return { set: 1, start: 0, doneAt: null, restEnd: null, implicit: true };
  if (last.doneAt != null && e >= last.restEnd) {
    return { set: list.length + 1, start: last.restEnd, doneAt: null, restEnd: null, implicit: true };
  }
  return { set: list.length, ...last, implicit: false };
}

/** Everything the UI needs, derived from the session at `now`. */
export function view(s, now) {
  const e = elapsed(s, now);
  const paused = s.pausedAt != null;
  const R = readyOf(s);

  if (s.mainEnd != null && e >= s.mainEnd) {
    const d = e - s.mainEnd;
    const S = stretchOf(s);
    const base = { paused, set: setsDone(s), totalMs: s.mainEnd, elapsedMs: e };
    if (d < PREP_MS) return { ...base, phase: 'prep', remainingMs: PREP_MS - d, frac: (PREP_MS - d) / PREP_MS };
    if (d < PREP_MS + S) return { ...base, phase: 'stretch', remainingMs: PREP_MS + S - d, frac: (PREP_MS + S - d) / S };
    return { ...base, phase: 'done', remainingMs: 0, frac: 0 };
  }
  if (e < -R) {
    const rem = -R - e;
    return { phase: 'warmup', paused, set: 1, remainingMs: rem, frac: rem / warmOf(s), totalMs: 0, elapsedMs: e };
  }
  if (e < 0) {
    return { phase: 'ready', paused, set: 1, remainingMs: -e, frac: -e / R, totalMs: 0, elapsedMs: e, long: R > READY_MS };
  }
  const end = targetMs(s);
  if (e >= end) {
    return { phase: 'target', paused, set: s.target, remainingMs: 0, frac: 0, totalMs: end, elapsedMs: e };
  }

  if (s.type === 'rest') {
    const c = restCurrent(s, e);
    if (c.doneAt == null) {
      const inSet = e - c.start;
      // no limit while working: the ring sweeps once a minute
      return { phase: 'work', paused, set: c.set, inSetMs: inSet, remainingMs: null, frac: (inSet % 60_000) / 60_000, totalMs: e, elapsedMs: e, markedAt: null };
    }
    const remainingMs = c.restEnd - e;
    const span = c.restEnd - c.doneAt;
    return {
      phase: remainingMs <= LAST_MS ? 'last' : 'rest', paused, set: c.set, remainingMs,
      frac: span > 0 ? remainingMs / span : 0, totalMs: e, elapsedMs: e, markedAt: c.doneAt - c.start,
    };
  }

  const I = s.interval;
  const set = Math.floor(e / I) + 1;
  const inSet = e - (set - 1) * I;
  const remainingMs = I - inSet;
  const markedAt = s.marks[set];
  const phase = remainingMs <= LAST_MS ? 'last' : markedAt != null ? 'rest' : 'work';
  return { phase, paused, set, inSetMs: inSet, remainingMs, frac: remainingMs / I, totalMs: e, elapsedMs: e, markedAt };
}

const SET_PHASES = new Set(['work', 'rest', 'last']);
export const inSets = (v) => SET_PHASES.has(v.phase);

/** Tap / AirPods press: the current set is done. Returns true if it changed anything. */
export function markDone(s, now) {
  const v = view(s, now);
  if (v.paused || v.phase !== 'work') return false;
  s.marks[v.set] = v.inSetMs;
  if (s.type === 'rest') {
    const e = elapsed(s, now);
    const c = restCurrent(s, e);
    const rec = { start: c.start, doneAt: e, restEnd: e + s.restMs };
    if (c.implicit) s.rsets.push(rec);
    else s.rsets[s.rsets.length - 1] = rec;
  }
  return true;
}

/** Undo the mark of the current set (while still resting / in its last 5 seconds). */
export function undoMark(s, now) {
  const v = view(s, now);
  if (v.paused || v.markedAt == null || !inSets(v)) return false;
  delete s.marks[v.set];
  if (s.type === 'rest') {
    const last = s.rsets[s.rsets.length - 1];
    last.doneAt = null;
    last.restEnd = null;
  }
  return true;
}

/** Rest type: lengthen or shorten the current rest (never before now). */
export function adjustRest(s, now, deltaMs) {
  const v = view(s, now);
  if (s.type !== 'rest' || v.paused || (v.phase !== 'rest' && v.phase !== 'last')) return false;
  const e = elapsed(s, now);
  const last = s.rsets[s.rsets.length - 1];
  last.restEnd = Math.max(e, last.restEnd + deltaMs);
  return true;
}

/** Rest type: end the rest now; the next set starts immediately. */
export function skipRest(s, now) {
  const v = view(s, now);
  if (s.type !== 'rest' || v.paused || (v.phase !== 'rest' && v.phase !== 'last')) return false;
  s.rsets[s.rsets.length - 1].restEnd = elapsed(s, now);
  return true;
}

/** Skip the rest of the warm-up, a get-ready / prep minute, or the stretch. */
export function skipStage(s, now) {
  const v = view(s, now);
  if (v.paused || !['warmup', 'ready', 'prep', 'stretch'].includes(v.phase)) return false;
  if (v.phase === 'warmup') s.skipped.warmup += v.remainingMs;
  if (v.phase === 'stretch') s.skipped.stretch += v.remainingMs;
  s.startedAt -= v.remainingMs; // move the timeline forward to the next stage
  return true;
}

/** Leave the sets and go to the 1 min prep + stretch. `atMs` = session time where the sets ended. */
export function endSets(s, now, atMs) {
  const v = view(s, now);
  if (s.mainEnd != null || !stretchOf(s) || !(inSets(v) || v.phase === 'target')) return false;
  s.mainEnd = atMs ?? Math.min(elapsed(s, now), targetMs(s));
  if (s.pausedAt != null) {
    // resume exactly where the sets ended
    s.pausedAt = s.startedAt + s.pausedTotal + readyOf(s) + warmOf(s) + s.mainEnd;
    resume(s, now);
  }
  return true;
}

export function pause(s, now) {
  if (s.pausedAt != null) return false;
  s.pausedAt = now;
  return true;
}

export function resume(s, now) {
  if (s.pausedAt == null) return false;
  s.pausedTotal += now - s.pausedAt;
  s.pausedAt = null;
  return true;
}

/** Freeze the session exactly where the target was reached (no stretch after it). */
export function reachTarget(s) {
  s.pausedAt = s.startedAt + s.pausedTotal + readyOf(s) + warmOf(s) + targetMs(s);
  s.targetReached = true;
}

/** "Keep going" after the target: drop the target and continue from where it stopped. */
export function keepGoing(s, now) {
  s.target = 0;
  s.targetReached = false;
  resume(s, now);
}

/** EMOM: number of sets started so far. */
export function setsStarted(s, now) {
  const e = Math.min(elapsed(s, now), setsEnd(s));
  if (e < 0) return 0;
  const n = Math.floor(e / s.interval) + 1;
  // Landing exactly on a boundary (e.g. the target) has not started a new set.
  return e > 0 && e % s.interval === 0 ? n - 1 : n;
}

function setsDone(s) {
  if (s.type === 'rest') return s.rsets.filter((r) => r.doneAt != null).length;
  const e = setsEnd(s);
  return Number.isFinite(e) ? Math.ceil(e / s.interval) : 0;
}

export function summary(s, now) {
  const e = elapsed(s, now);
  const totalMs = Math.max(0, Math.min(e, setsEnd(s)));
  let durations;
  if (s.type === 'rest') {
    // only finished sets count; a set still in progress at End is left out
    durations = s.rsets.filter((r) => r.doneAt != null && r.doneAt <= setsEnd(s)).map((r) => Math.round((r.doneAt - r.start) / 1000));
  } else {
    durations = [];
    for (let i = 1; i <= setsStarted(s, now); i++) durations.push(s.marks[i] != null ? Math.round(s.marks[i] / 1000) : null);
  }
  const marked = durations.filter((d) => d != null);
  const W = warmOf(s);
  const S = stretchOf(s);
  const R = readyOf(s);
  const warmupDone = W ? Math.max(0, Math.min(W, e + R + W) - s.skipped.warmup) : 0;
  const stretchDone = s.mainEnd != null ? Math.max(0, Math.min(S, e - s.mainEnd - PREP_MS) - s.skipped.stretch) : 0;
  return {
    type: s.type,
    sets: durations.length,
    totalMs,
    sessionMs: Math.max(0, (s.pausedAt ?? now) - s.wallStart),
    warmup: Math.round(warmupDone / 1000),
    stretch: Math.round(stretchDone / 1000),
    interval: s.interval / 1000,
    rest: s.restMs / 1000,
    durations,
    avg: marked.length ? Math.round(marked.reduce((a, b) => a + b, 0) / marked.length) : null,
    slowest: marked.length > 2 ? Math.max(...marked) : null,
  };
}

/**
 * Time left until the end of the whole session.
 * { ms, approx } — approx when the sets' length is estimated from your pace (rest timer);
 * { ms, open: true } — sets without a target: ms is only what comes after them.
 */
export function remainingToEnd(s, now) {
  const v = view(s, now);
  const e = elapsed(s, now);
  const S = stretchOf(s);
  const after = S ? PREP_MS + S : 0;
  switch (v.phase) {
    case 'done': case 'target': return { ms: 0 };
    case 'stretch': return { ms: v.remainingMs };
    case 'prep': return { ms: v.remainingMs + S };
    default: break;
  }
  const lead = v.phase === 'warmup' ? v.remainingMs + readyOf(s) : v.phase === 'ready' ? v.remainingMs : 0;
  const sets = setsRemaining(s, v, Math.max(0, e));
  if (sets == null) return { ms: lead + after, open: true };
  return { ms: lead + sets.ms + after, approx: sets.approx };
}

function setsRemaining(s, v, e) {
  if (!s.target) return null;
  if (s.type === 'emom') return { ms: Math.max(0, s.target * s.interval - e), approx: false };
  const done = s.rsets.filter((r) => r.doneAt != null);
  const avg = done.length ? done.reduce((a, r) => a + (r.doneAt - r.start), 0) / done.length : DEFAULT_SET_MS;
  const left = s.target - done.length; // sets not yet done, including the current one
  if (v.phase === 'rest' || v.phase === 'last') {
    return { ms: v.remainingMs + left * avg + Math.max(0, left - 1) * s.restMs, approx: true };
  }
  const current = v.phase === 'work' ? Math.max(0, avg - v.inSetMs) : avg;
  return { ms: current + Math.max(0, left - 1) * (s.restMs + avg), approx: true };
}

/**
 * Audio cues whose session time falls in [from, to).
 * kinds: 'tick' (5-4-3-2-1), 'go' (new set), 'pulse' (every 30 s while stretching), 'target' (EMOM target reached: the end-of-sets beeps),
 * 'stage' (warm-up → get ready, prep → stretch; carries the words to say), 'finish' (end of stretch).
 * EMOM cues depend only on time. Other cues move when a rest is marked, undone or adjusted or a stage
 * is skipped; their ids include the time, so moved cues get new ids.
 */
export function cuesBetween(s, from, to) {
  const out = [];
  const push = (at, kind, extra = {}) => {
    if (at >= from && at < to) out.push({ at, kind, id: `${kind}@${at}`, ...extra });
  };
  const R = readyOf(s);
  if (warmOf(s)) {
    for (const c of COUNTDOWN) push(-R - c, 'tick');
    push(-R, 'stage', { say: 'Get ready. Sets start in one minute.' });
  }
  // get-ready countdown before set 1
  for (const c of COUNTDOWN) push(-c, 'tick');

  if (s.type === 'rest') {
    push(0, 'go', { set: 1, announceMinutes: null });
    s.rsets.forEach((r, i) => {
      const set = i + 2;
      if (r.restEnd == null || (s.target && set > s.target)) return;
      for (const c of COUNTDOWN) if (r.restEnd - c >= r.doneAt) push(r.restEnd - c, 'tick');
      push(r.restEnd, 'go', { set, announceMinutes: null });
    });
  } else {
    const I = s.interval;
    const end = targetMs(s);
    const first = Math.max(0, Math.floor(from / I));
    for (let k = first; k * I < to + I; k++) {
      const boundary = k * I;
      if (boundary > end) break;
      if (boundary === end) { push(boundary, 'target'); break; }
      const set = k + 1;
      const announceMinutes = boundary > 0 && boundary % ANNOUNCE_EVERY_MS === 0 ? boundary / 60_000 : null;
      push(boundary, 'go', { set, announceMinutes });
      for (const c of COUNTDOWN) if (boundary + I - c <= end) push(boundary + I - c, 'tick');
    }
  }

  // nothing from the sets after they ended; then prep → stretch → finish
  const stop = s.mainEnd ?? Infinity;
  const kept = out.filter((c) => c.at < stop || c.at < 0);
  if (s.mainEnd != null) {
    const a = s.mainEnd + PREP_MS;
    const b = a + stretchOf(s);
    const before = out.length;
    for (const c of COUNTDOWN) push(a - c, 'tick');
    push(a, 'stage', { say: `Stretch. ${stretchOf(s) / 60_000} minutes.` });
    // stop the 30 s pulses before the final countdown
    for (let p = a + STRETCH_PULSE_MS; p < b - COUNTDOWN[0]; p += STRETCH_PULSE_MS) push(p, 'pulse');
    for (const c of COUNTDOWN) push(b - c, 'tick');
    push(b, 'finish');
    kept.push(...out.slice(before));
  }
  return [...new Map(kept.map((c) => [c.id, c])).values()].sort((x, y) => x.at - y.at);
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Remaining time, rounded up so the display never shows 0:00 before the end. */
export function fmtRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Elapsed time as m:ss, rounded down (a stopwatch). */
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtInterval(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
