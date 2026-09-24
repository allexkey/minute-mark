import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READY_MS, createSession, view, markDone, undoMark, pause, resume,
  reachTarget, keepGoing, summary, cuesBetween, fmtClock, fmtRemaining,
} from '../src/engine.js';

const T0 = 1_000_000;
// session time `e` (ms after the get-ready countdown) -> wall clock
const at = (e) => T0 + READY_MS + e;
const make = (o = {}) => createSession({ interval: 60, ...o }, T0);

test('get-ready countdown comes first', () => {
  const s = make();
  const v = view(s, T0 + 3000);
  assert.equal(v.phase, 'ready');
  assert.equal(v.remainingMs, 7000);
  assert.equal(v.totalMs, 0);
});

test('set number and remaining time follow the clock', () => {
  const s = make();
  let v = view(s, at(0));
  assert.deepEqual([v.phase, v.set, v.remainingMs], ['work', 1, 60_000]);
  v = view(s, at(7 * 60_000 + 42_000));
  assert.deepEqual([v.phase, v.set, v.remainingMs, v.totalMs], ['work', 8, 18_000, 462_000]);
});

test('marking a set switches to rest and records its duration', () => {
  const s = make();
  assert.equal(markDone(s, at(34_000)), true);
  const v = view(s, at(40_000));
  assert.equal(v.phase, 'rest');
  assert.equal(v.markedAt, 34_000);
  assert.equal(markDone(s, at(41_000)), false, 'cannot mark twice');
});

test('last 5 seconds override work and rest', () => {
  const s = make();
  assert.equal(view(s, at(55_000)).phase, 'last');
  assert.equal(view(s, at(54_999)).phase, 'work');
  assert.equal(markDone(s, at(56_000)), false, 'no marking in the last 5 s');
});

test('undo returns the set to work', () => {
  const s = make();
  markDone(s, at(20_000));
  assert.equal(undoMark(s, at(21_000)), true);
  assert.equal(view(s, at(22_000)).phase, 'work');
  assert.equal(undoMark(s, at(23_000)), false, 'nothing to undo');
});

test('a new set starts unmarked', () => {
  const s = make();
  markDone(s, at(30_000));
  assert.equal(view(s, at(60_000)).phase, 'work');
  assert.equal(view(s, at(60_000)).set, 2);
});

test('pause freezes everything, resume continues where it stopped', () => {
  const s = make();
  pause(s, at(10_000));
  assert.equal(view(s, at(500_000)).totalMs, 10_000);
  assert.equal(view(s, at(500_000)).paused, true);
  assert.equal(markDone(s, at(500_000)), false, 'no marking while paused');
  resume(s, at(500_000));
  const v = view(s, at(505_000));
  assert.equal(v.totalMs, 15_000);
  assert.equal(v.set, 1);
});

test('pausing during get-ready keeps the countdown', () => {
  const s = make();
  pause(s, T0 + 4000);
  resume(s, T0 + 60_000);
  assert.equal(view(s, T0 + 61_000).remainingMs, 5000);
});

test('target freezes on the exact boundary; keep going continues', () => {
  const s = make({ target: 3 });
  assert.equal(view(s, at(3 * 60_000 + 1200)).phase, 'target');
  reachTarget(s);
  const sum = summary(s, at(999_000));
  assert.equal(sum.sets, 3);
  assert.equal(sum.totalMs, 180_000);
  keepGoing(s, at(999_000));
  const v = view(s, at(999_000 + 5000));
  assert.deepEqual([v.phase, v.set, v.totalMs], ['work', 4, 185_000]);
});

test('summary lists durations, unmarked sets as null', () => {
  const s = make();
  markDone(s, at(24_400));
  markDone(s, at(60_000 + 30_000));
  markDone(s, at(3 * 60_000 + 50_000));
  const sum = summary(s, at(3 * 60_000 + 55_000));
  assert.deepEqual(sum.durations, [24, 30, null, 50]);
  assert.equal(sum.sets, 4);
  assert.equal(sum.avg, 35);
  assert.equal(sum.slowest, 50);
});

test('ending during get-ready gives an empty summary', () => {
  const s = make();
  assert.equal(summary(s, T0 + 2000).sets, 0);
});

test('cues: countdown, new sets, 3-2-1 before each minute', () => {
  const s = make();
  const cues = cuesBetween(s, -READY_MS, 120_000);
  const list = cues.map((c) => `${c.kind}${c.set ?? ''}@${c.at}`);
  assert.deepEqual(list, [
    'tick@-3000', 'tick@-2000', 'tick@-1000',
    'go1@0', 'tick@57000', 'tick@58000', 'tick@59000',
    'go2@60000', 'tick@117000', 'tick@118000', 'tick@119000',
  ]);
});

test('cues: window is half-open and ids are stable', () => {
  const s = make();
  const a = cuesBetween(s, 57_000, 60_000).map((c) => c.id);
  const b = cuesBetween(s, 56_000, 61_000).map((c) => c.id);
  assert.deepEqual(a, ['tick@57000', 'tick@58000', 'tick@59000']);
  assert.ok(a.every((id) => b.includes(id)));
});

test('cues: every 5 minutes the voice announces minutes', () => {
  const s = make();
  const go = cuesBetween(s, 0, 11 * 60_000).filter((c) => c.kind === 'go');
  assert.equal(go[5].set, 6);
  assert.equal(go[5].announceMinutes, 5);
  assert.equal(go[10].announceMinutes, 10);
  assert.equal(go[4].announceMinutes, null);
});

test('cues: target ends with a target cue and nothing after', () => {
  const s = make({ target: 2 });
  const list = cuesBetween(s, 0, 10 * 60_000).map((c) => `${c.kind}@${c.at}`);
  assert.deepEqual(list.slice(-2), ['tick@119000', 'target@120000']);
});

test('cues work with a 90 s interval', () => {
  const s = make({ interval: 90 });
  const go = cuesBetween(s, 0, 16 * 60_000).filter((c) => c.kind === 'go');
  assert.equal(go[1].at, 90_000);
  assert.equal(go[10].announceMinutes, 15);
});

test('formatting', () => {
  assert.equal(fmtClock(462_000), '07:42');
  assert.equal(fmtClock(3_723_000), '1:02:03');
  assert.equal(fmtRemaining(17_001), '0:18');
  assert.equal(fmtRemaining(60_000), '1:00');
});
