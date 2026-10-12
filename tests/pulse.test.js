import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READY_MS, PREP_MS, createSession, markDone, undoMark, adjustRest, endSets, cuesBetween } from '../src/engine.js';

const T0 = 1_000_000;
const MIN = 60_000;
const pulsesIn = (s, from, to) => cuesBetween(s, from, to).filter((c) => c.kind === 'pulse').map((c) => c.at);

test('off by default: no 30 s beeps anywhere', () => {
  const s = createSession({ interval: 60, warmup: 5, stretch: 5 }, T0);
  assert.deepEqual(pulsesIn(s, -10 * MIN, 30 * MIN), []);
});

test('EMOM 1:00: one low beep at the half of every minute', () => {
  const s = createSession({ interval: 60, pulse: true }, T0);
  assert.deepEqual(pulsesIn(s, -READY_MS, 3 * MIN), [30_000, 90_000, 150_000]);
});

test('EMOM: counted from the start of each set, clear of the 5-4-3-2-1', () => {
  // 1:30 sets: beeps at 0:30 and 1:00 of each set (1:30 is the next set)
  const s = createSession({ interval: 90, pulse: true }, T0);
  assert.deepEqual(pulsesIn(s, 0, 180_000), [30_000, 60_000, 120_000, 150_000]);
  // 0:30 sets leave no room for one
  assert.deepEqual(pulsesIn(createSession({ interval: 30, pulse: true }, T0), 0, 3 * MIN), []);
  // 0:35 sets: 0:30 would fall inside the countdown
  assert.deepEqual(pulsesIn(createSession({ interval: 35, pulse: true }, T0), 0, 3 * MIN), []);
});

test('EMOM with a target: nothing after the last set', () => {
  const s = createSession({ interval: 60, target: 2, pulse: true }, T0);
  assert.deepEqual(pulsesIn(s, 0, 10 * MIN), [30_000, 90_000]);
});

test('rest timer: every 30 s of the set, then every 30 s of the rest', () => {
  const s = createSession({ type: 'rest', rest: 90, pulse: true }, T0);
  const at = (e) => T0 + READY_MS + e;
  // set 1 still running: beeps keep coming
  assert.deepEqual(pulsesIn(s, 0, 100_000), [30_000, 60_000, 90_000]);
  markDone(s, at(70_000)); // set 1 took 70 s; rest 70 → 160 s
  // set: 30, 60. rest: 100, 130 (160 is the next set; 155+ is the countdown)
  assert.deepEqual(pulsesIn(s, 0, 160_000), [30_000, 60_000, 100_000, 130_000]);
  // set 2 starts at 160 s
  assert.deepEqual(pulsesIn(s, 160_000, 260_000), [190_000, 220_000, 250_000]);
});

test('rest timer: beeps follow undo and +15 s', () => {
  const s = createSession({ type: 'rest', rest: 60, pulse: true }, T0);
  const at = (e) => T0 + READY_MS + e;
  markDone(s, at(20_000)); // rest 20 → 80 s
  assert.deepEqual(pulsesIn(s, 20_000, 80_000), [50_000]);
  adjustRest(s, at(30_000), 30_000); // rest until 110 s
  assert.deepEqual(pulsesIn(s, 20_000, 110_000), [50_000, 80_000]);
  undoMark(s, at(40_000)); // back to work on set 1
  assert.deepEqual(pulsesIn(s, 20_000, 110_000), [30_000, 60_000, 90_000]);
});

test('rest timer with a target: no beeps for a set past the target', () => {
  const s = createSession({ type: 'rest', rest: 60, target: 1, pulse: true }, T0);
  markDone(s, T0 + READY_MS + 45_000);
  assert.deepEqual(pulsesIn(s, 0, 10 * MIN), [30_000]);
});

test('warm-up, the get-ready minute, prep and stretch each count from their own start', () => {
  const s = createSession({ interval: 60, warmup: 5, stretch: 5, pulse: true }, T0);
  const lead = 5 * MIN + PREP_MS;
  const warm = pulsesIn(s, -lead, -PREP_MS);
  assert.equal(warm.length, 9); // 0:30 … 4:30 of the warm-up
  assert.equal(warm[0], -lead + 30_000);
  assert.equal(warm.at(-1), -PREP_MS - 30_000);
  assert.deepEqual(pulsesIn(s, -PREP_MS, 0), [-30_000]); // half of the get-ready minute
  endSets(s, T0 + lead + 2 * MIN);
  const a = 2 * MIN + PREP_MS;
  assert.deepEqual(pulsesIn(s, 2 * MIN, a), [2 * MIN + 30_000]); // half of the prep minute
  const stretch = pulsesIn(s, a, a + 5 * MIN);
  assert.equal(stretch.length, 9);
  assert.equal(stretch[0], a + 30_000);
  assert.equal(stretch.at(-1), a + 5 * MIN - 30_000);
  // no set beeps once the sets are over
  assert.deepEqual(pulsesIn(s, 2 * MIN, a).filter((t) => t > 2 * MIN + 30_000), []);
});

test('the short 10 s get ready has no 30 s beep', () => {
  const s = createSession({ interval: 60, pulse: true }, T0);
  assert.deepEqual(pulsesIn(s, -READY_MS, 0), []);
});
