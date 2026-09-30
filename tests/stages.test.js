import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREP_MS, createSession, view, elapsed, markDone, pause, resume, skipStage, endSets,
  summary, cuesBetween, remainingToEnd,
} from '../src/engine.js';

const T0 = 1_000_000;
const MIN = 60_000;
// warm-up 5 min + get ready 1 min before set 1
const W = 5 * MIN;
const lead = W + PREP_MS;
const at = (e) => T0 + lead + e; // session ms -> wall clock
const make = (o = {}) => createSession({ type: 'emom', interval: 60, warmup: 5, stretch: 10, ...o }, T0);
const phase = (s, now) => view(s, now).phase;

test('without warm-up / stretch nothing changes: 10 s get ready', () => {
  const s = createSession({ interval: 60 }, T0);
  assert.equal(elapsed(s, T0), -10_000);
  assert.equal(phase(s, T0 + 1000), 'ready');
  assert.equal(view(s, T0 + 1000).long, false);
});

test('warm-up, then a 1 min get ready, then set 1', () => {
  const s = make();
  let v = view(s, T0 + 60_000);
  assert.deepEqual([v.phase, v.remainingMs], ['warmup', 4 * MIN]);
  v = view(s, T0 + W + 20_000);
  assert.deepEqual([v.phase, v.remainingMs, v.long], ['ready', 40_000, true]);
  v = view(s, at(0));
  assert.deepEqual([v.phase, v.set], ['work', 1]);
});

test('skip warm-up jumps to the 1 min get ready and counts as skipped', () => {
  const s = make();
  assert.equal(skipStage(s, T0 + 60_000), true);
  const v = view(s, T0 + 60_000);
  assert.deepEqual([v.phase, v.remainingMs], ['ready', PREP_MS]);
  // End during the prep minute: 1 min of warm-up was done
  assert.equal(summary(s, T0 + 70_000).warmup, 60);
});

test('Stretch from pause: 1 min prep, then stretch, then done', () => {
  const s = make();
  pause(s, at(3 * MIN + 10_000));
  assert.equal(endSets(s, at(5 * MIN)), true);
  let v = view(s, at(5 * MIN) + 1000);
  assert.deepEqual([v.phase, v.remainingMs, v.set], ['prep', 59_000, 4]);
  v = view(s, at(5 * MIN) + PREP_MS + 2 * MIN);
  assert.deepEqual([v.phase, v.remainingMs], ['stretch', 8 * MIN]);
  assert.equal(phase(s, at(5 * MIN) + PREP_MS + 10 * MIN), 'done');
  const sum = summary(s, at(5 * MIN) + PREP_MS + 10 * MIN);
  assert.deepEqual([sum.sets, sum.totalMs, sum.warmup, sum.stretch], [4, 3 * MIN + 10_000, 300, 600]);
});

test('no stretch configured: endSets does nothing', () => {
  const s = make({ stretch: 0 });
  assert.equal(endSets(s, at(30_000)), false);
});

test('EMOM target with stretch: sets end on the target boundary', () => {
  const s = make({ target: 3 });
  assert.equal(phase(s, at(3 * MIN + 100)), 'target');
  endSets(s, at(3 * MIN + 100), 3 * MIN);
  assert.equal(phase(s, at(3 * MIN + 100)), 'prep');
  assert.equal(summary(s, at(3 * MIN + 100)).sets, 3);
});

test('rest timer target with stretch: sets end when the last set is marked', () => {
  const s = make({ type: 'rest', rest: 60, target: 2 });
  markDone(s, at(30_000));
  markDone(s, at(90_000 + 40_000));
  assert.equal(phase(s, at(130_000)), 'target');
  endSets(s, at(130_000), 130_000);
  const v = view(s, at(131_000));
  assert.deepEqual([v.phase, v.set], ['prep', 2]);
});

test('skip stretch finishes the session', () => {
  const s = make();
  endSets(s, at(2 * MIN));
  skipStage(s, at(2 * MIN) + 1000); // skip prep
  assert.equal(phase(s, at(2 * MIN) + 1000), 'stretch');
  skipStage(s, at(2 * MIN) + 61_000); // after 1 min of stretching
  assert.equal(phase(s, at(2 * MIN) + 61_000), 'done');
  assert.equal(summary(s, at(2 * MIN) + 61_000).stretch, 60);
});

test('pause freezes warm-up too', () => {
  const s = make();
  pause(s, T0 + 60_000);
  resume(s, T0 + 600_000);
  assert.equal(view(s, T0 + 600_000).remainingMs, 4 * MIN);
});

test('cues: warm-up → get ready → set 1, and prep → stretch → finish', () => {
  const s = make();
  const five = (t) => [5000, 4000, 3000, 2000, 1000].map((c) => `tick@${t - c}`);
  const pre = cuesBetween(s, -lead, 1).map((c) => `${c.kind}@${c.at}`);
  assert.deepEqual(pre, [...five(-60_000), 'stage@-60000', ...five(0), 'go@0']);
  endSets(s, at(2 * MIN));
  const post = cuesBetween(s, 2 * MIN, 99 * MIN).map((c) => `${c.kind}@${c.at}`);
  const a = 2 * MIN + PREP_MS;
  const b = a + 10 * MIN;
  const pulses = post.filter((c) => c.startsWith('pulse'));
  assert.deepEqual(post.filter((c) => !c.startsWith('pulse')), [...five(a), `stage@${a}`, ...five(b), `finish@${b}`]);
  assert.ok(!post.some((c) => c.startsWith('go')), 'no set cues after the sets ended');
  // a short beep every 30 s while stretching, stopping before the final countdown
  assert.equal(pulses.length, 19);
  assert.equal(pulses[0], `pulse@${a + 30_000}`);
  assert.equal(pulses.at(-1), `pulse@${b - 30_000}`);
});

test('remaining time: exact for EMOM with a target', () => {
  const s = make({ target: 12 });
  // during warm-up: 4 min warm-up + 1 min prep + 12 min sets + 1 min prep + 10 min stretch
  assert.deepEqual(remainingToEnd(s, T0 + 60_000), { ms: (4 + 1 + 12 + 1 + 10) * MIN, approx: false });
  assert.deepEqual(remainingToEnd(s, at(2 * MIN)), { ms: (10 + 1 + 10) * MIN, approx: false });
});

test('remaining time: open without a target, estimated for the rest timer', () => {
  const open = make();
  assert.deepEqual(remainingToEnd(open, at(5 * MIN)), { ms: 11 * MIN, open: true });
  const r = make({ type: 'rest', rest: 60, target: 3, stretch: 0 });
  markDone(r, at(40_000)); // set 1 took 40 s; rest until 100 s
  const est = remainingToEnd(r, at(50_000));
  // 50 s rest left + 2 sets × 40 s + 1 rest × 60 s
  assert.deepEqual(est, { ms: 50_000 + 80_000 + 60_000, approx: true });
});

test('remaining time during prep and stretch is exact', () => {
  const s = make();
  endSets(s, at(3 * MIN));
  assert.deepEqual(remainingToEnd(s, at(3 * MIN) + 30_000), { ms: 30_000 + 10 * MIN });
  assert.deepEqual(remainingToEnd(s, at(3 * MIN) + PREP_MS + 60_000), { ms: 9 * MIN });
});
