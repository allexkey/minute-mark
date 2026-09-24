// Session engine: pure functions over a plain, serialisable session object.
// All time is derived from timestamps (ms), never from counting ticks, so the
// state stays correct after iOS throttles or suspends the page.
//
// Two session types:
//   'emom' — a new set starts every interval; tapping only marks the set done.
//   'rest' — a set lasts until you tap; then a rest countdown runs and the next set starts when it ends.

export const READY_MS = 10_000;
export const LAST_MS = 5_000;
export const REST_STEP_MS = 15_000;
const COUNTDOWN = [3000, 2000, 1000];
const ANNOUNCE_EVERY_MS = 5 * 60_000;

export function createSession({ type = 'emom', interval = 60, rest = 60, target = 0, mode = 'airpods' }, now) {
  return {
    type,
    interval: interval * 1000,
    restMs: rest * 1000,
    target,
    mode,
    startedAt: now,
    pausedAt: null,
    pausedTotal: 0,
    marks: {}, // set number -> ms into the set when it was marked done
    rsets: [], // rest type: [{ start, doneAt, restEnd }] in session ms
    targetReached: false,
  };
}

/** Session time in ms: negative during the 10 s get-ready countdown. */
export function elapsed(s, now) {
  const t = s.pausedAt ?? now;
  return t - s.startedAt - s.pausedTotal - READY_MS;
}

/** Session time at which the target is reached (Infinity while unknown or without a target). */
export function targetMs(s) {
  if (!s.target) return Infinity;
  if (s.type === 'rest') return s.rsets[s.target - 1]?.doneAt ?? Infinity;
  return s.target * s.interval;
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

  if (e < 0) {
    return { phase: 'ready', paused, set: 1, remainingMs: -e, frac: -e / READY_MS, totalMs: 0, elapsedMs: e };
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
  if (v.paused || v.markedAt == null || v.phase === 'target') return false;
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

/** Freeze the session exactly where the target was reached. */
export function reachTarget(s) {
  s.pausedAt = s.startedAt + s.pausedTotal + READY_MS + targetMs(s);
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
  const e = Math.min(elapsed(s, now), targetMs(s));
  if (e < 0) return 0;
  const n = Math.floor(e / s.interval) + 1;
  // Landing exactly on a boundary (e.g. the target) has not started a new set.
  return e > 0 && e % s.interval === 0 ? n - 1 : n;
}

export function summary(s, now) {
  const totalMs = Math.max(0, Math.min(elapsed(s, now), targetMs(s)));
  let durations;
  if (s.type === 'rest') {
    // only finished sets count; a set still in progress at End is left out
    durations = s.rsets.filter((r) => r.doneAt != null).map((r) => Math.round((r.doneAt - r.start) / 1000));
  } else {
    durations = [];
    for (let i = 1; i <= setsStarted(s, now); i++) durations.push(s.marks[i] != null ? Math.round(s.marks[i] / 1000) : null);
  }
  const marked = durations.filter((d) => d != null);
  return {
    type: s.type,
    sets: durations.length,
    totalMs,
    interval: s.interval / 1000,
    rest: s.restMs / 1000,
    durations,
    avg: marked.length ? Math.round(marked.reduce((a, b) => a + b, 0) / marked.length) : null,
    slowest: marked.length > 2 ? Math.max(...marked) : null,
  };
}

/**
 * Audio cues whose session time falls in [from, to).
 * kinds: 'tick' (3-2-1), 'go' (new set), 'target' (EMOM target reached).
 * EMOM cues depend only on time. Rest-type cues move when a rest is marked,
 * undone or adjusted; their ids include the time, so moved cues get new ids.
 */
export function cuesBetween(s, from, to) {
  const out = [];
  const push = (at, kind, extra = {}) => {
    if (at >= from && at < to) out.push({ at, kind, id: `${kind}@${at}`, ...extra });
  };
  // get-ready countdown and the start of set 1
  for (const c of COUNTDOWN) push(-c, 'tick');

  if (s.type === 'rest') {
    push(0, 'go', { set: 1, announceMinutes: null });
    s.rsets.forEach((r, i) => {
      const set = i + 2;
      if (r.restEnd == null || (s.target && set > s.target)) return;
      for (const c of COUNTDOWN) if (r.restEnd - c >= r.doneAt) push(r.restEnd - c, 'tick');
      push(r.restEnd, 'go', { set, announceMinutes: null });
    });
    return out.sort((a, b) => a.at - b.at);
  }

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
  return out.sort((a, b) => a.at - b.at);
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
