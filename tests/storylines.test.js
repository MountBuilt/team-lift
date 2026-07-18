import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORYLINES, activeStorylines } from '../scripts/storylines.mjs';
import { computeHashes } from '../scripts/lib/decide.mjs';

const users = [
  { id: 'u1', name: 'Simon' },
  { id: 'u2', name: 'Swifty' },
  { id: 'u3', name: 'Jon' }
];
const entries = [
  { id: 'u1_2026-07-13', userId: 'u1', date: '2026-07-13', weight: 82.5, updatedAt: 't1' },
  { id: 'u2_2026-07-12', userId: 'u2', date: '2026-07-12', steps: 12000, updatedAt: 't2' }
];

test('seeded storylines: exactly two live entries, Swifty and Jon, until 2026-07-25', () => {
  assert.equal(STORYLINES.length, 2);
  const swifty = STORYLINES.find(s => s.subject === 'Swifty');
  const jon = STORYLINES.find(s => s.subject === 'Jon');
  assert.ok(swifty && jon, 'expected a Swifty and a Jon storyline');
  assert.equal(swifty.until, '2026-07-25');
  assert.equal(jon.until, '2026-07-25');
  assert.match(swifty.note, /wagyu|steak/i);
  assert.match(jon.note, /scale/i);
  for (const s of STORYLINES) {
    assert.ok(s.id && s.subject && s.until && s.note);
    assert.ok(!/—/.test(s.note), 'no em-dash in a storyline note');
    assert.ok(!/\bgym\b/i.test(s.note), 'say workout, not gym');
  }
});

test('activeStorylines keeps a storyline through its until date and drops it after', () => {
  const both = activeStorylines(STORYLINES, '2026-07-20');
  assert.equal(both.length, 2);
  const lastDay = activeStorylines(STORYLINES, '2026-07-25'); // inclusive
  assert.equal(lastDay.length, 2);
  const after = activeStorylines(STORYLINES, '2026-07-26'); // expired
  assert.equal(after.length, 0);
});

test('computeHashes folds the active storyline set into every dashboard-card hash', () => {
  // While a storyline is live vs after it has expired, the card hashes must
  // differ so adding or expiring a storyline regenerates the cards on the next
  // tick. weight/steps/workouts do not otherwise depend on `today`, so any
  // difference here is the storyline fold at work.
  const live = computeHashes(users, entries, '2026-07-20'); // both storylines active
  const gone = computeHashes(users, entries, '2030-01-01'); // none active
  for (const k of ['weight', 'steps', 'workouts']) {
    assert.notEqual(gone[k], live[k], `${k} hash should change when the storyline set changes`);
  }
});

test('computeHashes is stable while the active storyline set is unchanged (weight is today-independent)', () => {
  const a = computeHashes(users, entries, '2026-07-20');
  const b = computeHashes(users, entries, '2026-07-24'); // both still active, no entry churn
  assert.equal(a.weight, b.weight);
  assert.equal(a.workouts, b.workouts);
});
