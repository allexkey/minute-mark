import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READY_MS, createSession, view, markDone, undoMark, adjustRest, skipRest, pause, resume,
  reachTarget, keepGoing, summary, cuesBetween, targetMs,
} from '../src/engine.js';

const T0 = 1_000_000;
const at = (e) => T0 + READY_MS + e;
const make = (o = {}) => createSession({ type: 'rest', rest: 60, ...o }, T0);

test('work phase counts up without a limit', () => {
  const s = make();
  const v = view(s, at(125_000));
  assert.deepEqual([v.phase, v.set, v.inSetMs, v.remainingMs, v.totalMs], ['work', 1, 125_000, null, 125_000]);
});

test('tap starts the rest countdown, then the next set starts by itself', () => {
  const s = make();
  assert.equal(markDone(s, at(34_000)), true);
  let v = view(s, at(40_000));
  assert.deepEqual([v.phase, v.set, v.remainingMs, v.markedAt], ['rest', 1, 54_000, 34_000]);
  assert.equal(view(s, at(90_000)).phase, 'last');
  v = view(s, at(94_000));
  assert.deepEqual([v.phase, v.set, v.inSetMs], ['work', 2, 0]);
  v = view(s, at(100_000));
  assert.deepEqual([v.phase, v.set, v.inSetMs], ['work', 2, 6000]);
});

test('no tap during rest or while paused', () => {
  const s = make();
  markDone(s, at(10_000));
  assert.equal(markDone(s, at(20_000)), false, 'already resting');
  pause(s, at(80_000));
  assert.equal(markDone(s, at(90_000)), false, 'paused');
});

test('second set is marked from its own start', () => {
  const s = make();
  markDone(s, at(30_000)); // rest until 90 s
  markDone(s, at(90_000 + 45_000));
  assert.deepEqual(s.rsets.map((r) => [r.start, r.doneAt, r.restEnd]), [[0, 30_000, 90_000], [90_000, 135_000, 195_000]]);
  assert.equal(view(s, at(140_000)).markedAt, 45_000);
});

test('undo during rest returns to work and keeps the set time running', () => {
  const s = make();
  markDone(s, at(30_000));
  assert.equal(undoMark(s, at(32_000)), true);
  const v = view(s, at(33_000));
  assert.deepEqual([v.phase, v.set, v.inSetMs], ['work', 1, 33_000]);
  markDone(s, at(50_000));
  assert.equal(view(s, at(51_000)).markedAt, 50_000);
  assert.equal(s.rsets.length, 1);
});

test('undo is not possible once the next set started', () => {
  const s = make();
  markDone(s, at(10_000));
  assert.equal(undoMark(s, at(71_000)), false);
});

test('+15 s / −15 s / skip change only the current rest', () => {
  const s = make();
  markDone(s, at(10_000)); // rest until 70 s
  adjustRest(s, at(20_000), 15_000);
  assert.equal(view(s, at(20_000)).remainingMs, 65_000);
  adjustRest(s, at(20_000), -15_000);
  adjustRest(s, at(20_000), -15_000);
  assert.equal(view(s, at(20_000)).remainingMs, 35_000);
  adjustRest(s, at(50_000), -60_000);
  assert.equal(view(s, at(50_000)).phase, 'work', 'never before now: next set starts');
  assert.equal(view(s, at(50_000)).set, 2);
  markDone(s, at(60_000));
  skipRest(s, at(65_000));
  assert.deepEqual([view(s, at(65_000)).phase, view(s, at(65_000)).set], ['work', 3]);
  assert.equal(s.restMs, 60_000, 'the configured rest is unchanged');
});

test('adjust/skip do nothing while working', () => {
  const s = make();
  assert.equal(adjustRest(s, at(5000), 15_000), false);
  assert.equal(skipRest(s, at(5000)), false);
});

test('pause freezes the rest countdown', () => {
  const s = make();
  markDone(s, at(10_000));
  pause(s, at(20_000));
  resume(s, at(500_000));
  const v = view(s, at(500_000 + 5000));
  assert.deepEqual([v.phase, v.remainingMs], ['rest', 45_000]);
});

test('target is reached when the last set is marked, with no rest after it', () => {
  const s = make({ target: 2 });
  assert.equal(targetMs(s), Infinity);
  markDone(s, at(20_000)); // rest until 80 s
  markDone(s, at(80_000 + 25_000));
  assert.equal(targetMs(s), 105_000);
  assert.equal(view(s, at(105_000)).phase, 'target');
  reachTarget(s);
  const sum = summary(s, at(999_000));
  assert.deepEqual([sum.sets, sum.totalMs, sum.durations], [2, 105_000, [20, 25]]);
  keepGoing(s, at(999_000));
  const v = view(s, at(999_000 + 10_000));
  assert.deepEqual([v.phase, v.set, v.remainingMs], ['rest', 2, 50_000]);
});

test('summary counts finished sets only', () => {
  const s = make();
  markDone(s, at(20_000));
  markDone(s, at(80_000 + 30_000)); // set 2 done, rest until 170 s
  const sum = summary(s, at(200_000)); // set 3 in progress
  assert.deepEqual([sum.type, sum.sets, sum.durations, sum.avg, sum.rest], ['rest', 2, [20, 30], 25, 60]);
});

test('cues: countdown, set 1, then 3-2-1 and go at the end of each rest', () => {
  const s = make();
  markDone(s, at(30_000));
  const list = cuesBetween(s, -READY_MS, 200_000).map((c) => `${c.kind}${c.set ?? ''}@${c.at}`);
  assert.deepEqual(list, ['tick@-3000', 'tick@-2000', 'tick@-1000', 'go1@0', 'tick@87000', 'tick@88000', 'tick@89000', 'go2@90000']);
});

test('cues move with the rest and get new ids', () => {
  const s = make();
  markDone(s, at(30_000));
  const before = cuesBetween(s, 0, 200_000).map((c) => c.id);
  adjustRest(s, at(40_000), 15_000);
  const after = cuesBetween(s, 0, 200_000).map((c) => c.id);
  assert.ok(after.includes('go@105000'));
  assert.ok(!after.includes('go@90000'));
  assert.ok(before.includes('go@90000'));
});

test('cues: no go after the target set', () => {
  const s = make({ target: 1 });
  markDone(s, at(30_000));
  assert.deepEqual(cuesBetween(s, 0, 200_000).map((c) => c.id), ['go@0']);
});

test('undo removes the pending go cue', () => {
  const s = make();
  markDone(s, at(30_000));
  undoMark(s, at(31_000));
  assert.deepEqual(cuesBetween(s, 0, 500_000).map((c) => c.id), ['go@0']);
});
