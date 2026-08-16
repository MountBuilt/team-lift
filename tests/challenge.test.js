import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXERCISES, dailyChallenge, challengeStreak, challengeDoneOn,
  challengeNudge, challengeNudgeCard, challengeTickLabel, TICK_LABELS, NUDGES,
  NUDGE_EYEBROWS
} from '../js/lib/challenge.js';
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

test('dailyChallenge reps stay inside each exercise snack band', () => {
  for (const d of dateRange('2026-07-06', '2026-10-06')) {
    const c = dailyChallenge(d, START);
    const ex = EXERCISES.find(x => x.name === c.name);
    assert.ok(c.reps >= ex.min && c.reps <= ex.max, `${c.name} ${c.reps} outside ${ex.min}-${ex.max}`);
  }
});

test('dailyChallenge reps are not a monotone weekly climb', () => {
  const byName = new Map();
  for (const d of dateRange('2026-07-06', '2026-09-06')) {
    const p = dailyChallenge(d, START);
    const list = byName.get(p.name) || [];
    list.push(p.reps);
    byName.set(p.name, list);
  }
  let sawDrop = false;
  for (const reps of byName.values()) {
    if (reps.some((n, i) => i > 0 && n < reps[i - 1])) sawDrop = true;
  }
  assert.ok(sawDrop, 'expected at least one exercise to go down on a later day');
});

test('dailyChallenge week 1 stays inside the snack band', () => {
  for (const d of dateRange(START, addDays(START, 6))) {
    const c = dailyChallenge(d, START);
    const ex = EXERCISES.find(x => x.name === c.name);
    assert.ok(c.reps >= ex.min && c.reps <= ex.max);
    assert.equal(c.week, 1);
  }
});

test('dailyChallenge before the challenge starts clamps to week 1 and a snack count', () => {
  const c = dailyChallenge('2026-06-20', START);
  assert.equal(c.week, 1);
  const ex = EXERCISES.find(x => x.name === c.name);
  assert.ok(c.reps >= ex.min && c.reps <= ex.max);
});

test('challengeTickLabel is deterministic and only returns a pool member', () => {
  assert.equal(challengeTickLabel('2026-08-16'), challengeTickLabel('2026-08-16'));
  assert.ok(TICK_LABELS.includes(challengeTickLabel('2026-08-16')));
  const seen = new Set(dateRange('2026-08-01', '2026-08-21').map(challengeTickLabel));
  assert.ok(seen.size >= 3, `expected variety, got ${[...seen].join(', ')}`);
});

test('challengeNudge is deterministic, short, and has no em-dash', () => {
  const a = challengeNudge('2026-08-16', 'push ups');
  const b = challengeNudge('2026-08-16', 'push ups');
  assert.equal(a, b);
  assert.ok(a.length > 0 && a.length <= 120, a);
  assert.ok(!a.includes('—'), a);
  for (const n of NUDGES) {
    assert.ok(n.text.length <= 120, n.text);
    assert.ok(!n.text.includes('—'), n.text);
  }
});

test('challengeNudge prefers an exercise-tagged fact when the pool has one', () => {
  const tagged = NUDGES.filter(n => n.exercise === 'push ups').map(n => n.text);
  assert.ok(tagged.length >= 1, 'need push-up tagged nudges');
  for (const d of dateRange('2026-08-01', '2026-08-21')) {
    assert.ok(tagged.includes(challengeNudge(d, 'push ups')), d);
  }
});

test('challengeNudgeCard rotates eyebrow with the line kind', () => {
  const kinds = new Set(NUDGES.map(n => n.kind));
  assert.ok(kinds.has('fact') && kinds.has('fuel') && kinds.has('push'));
  for (const n of NUDGES) {
    assert.ok(NUDGE_EYEBROWS[n.kind], n.text);
  }
  const card = challengeNudgeCard('2026-08-16', 'push ups');
  assert.ok(Object.values(NUDGE_EYEBROWS).includes(card.eyebrow));
  assert.equal(card.text, challengeNudge('2026-08-16', 'push ups'));
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
