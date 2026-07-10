import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, dailyChallenge, challengeStreak, challengeDoneOn } from '../js/lib/challenge.js';
import { dateRange, addDays } from '../js/lib/dates.js';

const START = '2026-07-06'; // a Monday

const e = (userId, date, fields = {}) => ({
  userId, date, updatedAt: 0, ...fields
});

test('dailyChallenge is deterministic for a given date', () => {
  assert.deepEqual(dailyChallenge('2026-07-10', START), dailyChallenge('2026-07-10', START));
});

test('dailyChallenge picks a known exercise with whole-number reps', () => {
  for (const d of dateRange('2026-07-06', '2026-08-06')) {
    const c = dailyChallenge(d, START);
    assert.ok(EXERCISES.some(x => x.name === c.name), `unknown exercise ${c.name}`);
    assert.ok(Number.isInteger(c.reps) && c.reps > 0);
  }
});

test('dailyChallenge varies the exercise across a fortnight', () => {
  const names = new Set(dateRange('2026-07-06', '2026-07-19').map(d => dailyChallenge(d, START).name));
  assert.ok(names.size >= 3, `expected variety, got ${[...names].join(', ')}`);
});

test('dailyChallenge reps ramp up week on week for the same exercise', () => {
  // Scan two months for a pair of dates in different weeks with the same
  // exercise; later week must demand more reps.
  const picks = dateRange('2026-07-06', '2026-09-06').map(d => ({ d, ...dailyChallenge(d, START) }));
  const byName = new Map();
  let checked = 0;
  for (const p of picks) {
    const prev = byName.get(p.name);
    if (prev && p.week > prev.week) {
      assert.ok(p.reps > prev.reps, `${p.name} week ${p.week} (${p.reps}) not harder than week ${prev.week} (${prev.reps})`);
      checked++;
    }
    if (!prev) byName.set(p.name, p);
  }
  assert.ok(checked >= 3, 'expected to compare several exercises across weeks');
});

test('dailyChallenge starts easy: week 1 uses each exercise\'s base reps', () => {
  for (const d of dateRange(START, addDays(START, 6))) {
    const c = dailyChallenge(d, START);
    const ex = EXERCISES.find(x => x.name === c.name);
    assert.equal(c.reps, ex.base);
    assert.equal(c.week, 1);
  }
});

test('dailyChallenge before the challenge starts clamps to week 1', () => {
  const c = dailyChallenge('2026-06-20', START);
  assert.equal(c.week, 1);
  const ex = EXERCISES.find(x => x.name === c.name);
  assert.equal(c.reps, ex.base);
});

test('challengeDoneOn lists who ticked the challenge that day', () => {
  const entries = [
    e('u1', '2026-07-10', { dailyChallenge: true }),
    e('u2', '2026-07-10', { workoutParts: ['legs'] }),
    e('u3', '2026-07-09', { dailyChallenge: true })
  ];
  assert.deepEqual(challengeDoneOn(entries, '2026-07-10'), ['u1']);
});

test('challengeStreak counts consecutive days ending today', () => {
  const entries = ['2026-07-08', '2026-07-09', '2026-07-10']
    .map(d => e('u1', d, { dailyChallenge: true }));
  assert.equal(challengeStreak(entries, 'u1', '2026-07-10'), 3);
});

test('challengeStreak survives today being not-yet-done (day in progress)', () => {
  const entries = ['2026-07-08', '2026-07-09']
    .map(d => e('u1', d, { dailyChallenge: true }));
  assert.equal(challengeStreak(entries, 'u1', '2026-07-10'), 2);
});

test('challengeStreak breaks on a missed day', () => {
  const entries = ['2026-07-06', '2026-07-07', '2026-07-09', '2026-07-10']
    .map(d => e('u1', d, { dailyChallenge: true }));
  assert.equal(challengeStreak(entries, 'u1', '2026-07-10'), 2);
});

test('challengeStreak is zero with nothing recent, and ignores other users', () => {
  const entries = [
    e('u1', '2026-07-01', { dailyChallenge: true }),
    e('u2', '2026-07-10', { dailyChallenge: true })
  ];
  assert.equal(challengeStreak(entries, 'u1', '2026-07-10'), 0);
});

test('challengeStreak ignores entries without an explicit dailyChallenge tick', () => {
  const entries = [
    e('u1', '2026-07-10', { workoutParts: ['legs'], steps: 9000 }),
    e('u1', '2026-07-09', { dailyChallenge: true })
  ];
  assert.equal(challengeStreak(entries, 'u1', '2026-07-10'), 1);
});
