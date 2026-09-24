// Session engine: pure functions over a plain, serialisable session object.
// All time is derived from timestamps (ms), never from counting ticks, so the
// state stays correct after iOS throttles or suspends the page.

export const READY_MS = 10_000;
export const LAST_MS = 5_000;
const COUNTDOWN = [3000, 2000, 1000];
const ANNOUNCE_EVERY_MS = 5 * 60_000;

export function createSession({ interval, target = 0, mode = 'airpods' }, now) {
  return {
    interval: interval * 1000,
    target,
    mode,
    startedAt: now,
    pausedAt: null,
    pausedTotal: 0,
    marks: {}, // set number -> ms into the set when it was marked done
    targetReached: false,
  };
}

/** Session time in ms: negative during the 10 s get-ready countdown. */
export function elapsed(s, now) {
  const t = s.pausedAt ?? now;
  return t - s.startedAt - s.pausedTotal - READY_MS;
}

export function targetMs(s) {
  return s.target ? s.target * s.interval : Infinity;
}

/** Everything the UI needs, derived from the session at `now`. */
export function view(s, now) {
  const e = elapsed(s, now);
  const I = s.interval;
  const paused = s.pausedAt != null;

  if (e < 0) {
    return { phase: 'ready', paused, set: 1, remainingMs: -e, frac: -e / READY_MS, totalMs: 0, elapsedMs: e };
  }
  if (e >= targetMs(s)) {
    return { phase: 'target', paused, set: s.target, remainingMs: 0, frac: 0, totalMs: targetMs(s), elapsedMs: e };
  }
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
  return true;
}

/** Undo the mark of the current set (rest or last-5-seconds phase). */
export function undoMark(s, now) {
  const v = view(s, now);
  if (v.paused || v.markedAt == null) return false;
  delete s.marks[v.set];
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

/** Freeze the session exactly on the target boundary (called once the target is crossed). */
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

/** Number of sets started so far. */
export function setsStarted(s, now) {
  const e = Math.min(elapsed(s, now), targetMs(s));
  if (e < 0) return 0;
  const n = Math.floor(e / s.interval) + 1;
  // Landing exactly on a boundary (e.g. the target) has not started a new set.
  return e > 0 && e % s.interval === 0 ? n - 1 : n;
}

export function summary(s, now) {
  const sets = setsStarted(s, now);
  const durations = [];
  for (let i = 1; i <= sets; i++) durations.push(s.marks[i] != null ? Math.round(s.marks[i] / 1000) : null);
  const marked = durations.filter((d) => d != null);
  return {
    sets,
    totalMs: Math.max(0, Math.min(elapsed(s, now), targetMs(s))),
    interval: s.interval / 1000,
    durations,
    avg: marked.length ? Math.round(marked.reduce((a, b) => a + b, 0) / marked.length) : null,
    slowest: marked.length > 2 ? Math.max(...marked) : null,
  };
}

/**
 * Audio cues whose session time falls in [from, to). Cues depend only on time,
 * so they never change when a set is marked or un-marked.
 * kinds: 'tick' (3-2-1), 'go' (new set), 'target' (target reached).
 */
export function cuesBetween(s, from, to) {
  const out = [];
  const I = s.interval;
  const end = targetMs(s);
  const push = (at, kind, extra = {}) => {
    if (at >= from && at < to) out.push({ at, kind, id: `${kind}@${at}`, ...extra });
  };
  // get-ready countdown and the start of set 1
  for (const c of COUNTDOWN) push(-c, 'tick');
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

/** Remaining time inside a set, rounded up so the display never shows 0:00 mid-set. */
export function fmtRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtInterval(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
