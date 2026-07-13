import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHashes, changedSections, decidePushWork } from '../scripts/lib/decide.mjs';

const users = [
  { id: 'u1', name: 'Simon', push: { enabled: true, endpoint: 'https://x/1', keys: { p256dh: 'p', auth: 'a' } } },
  { id: 'u2', name: 'Dave', push: { enabled: false, endpoint: 'https://x/2', keys: { p256dh: 'p', auth: 'a' } } },
  { id: 'u3', name: 'Phill' }
];
const entries = [
  { id: 'u1_2026-07-13', userId: 'u1', date: '2026-07-13', weight: 82.5, updatedAt: 't1' },
  { id: 'u1_2026-07-12', userId: 'u1', date: '2026-07-12', steps: 10000, updatedAt: 't2' },
  { id: 'u3_2026-07-12', userId: 'u3', date: '2026-07-12', workoutParts: ['legs'], updatedAt: 't3' }
];
const at = (h, m) => new Date(2026, 6, 13, h, m); // local 2026-07-13
const TODAY = '2026-07-13';

test('hashes are stable and section-scoped', () => {
  const a = computeHashes(users, entries, TODAY);
  const b = computeHashes(users, [...entries].reverse(), TODAY);
  assert.deepEqual(a, b); // order-independent
  const stepsChanged = entries.map(e =>
    e.id === 'u1_2026-07-12' ? { ...e, steps: 12000 } : e);
  const c = computeHashes(users, stepsChanged, TODAY);
  assert.notEqual(c.steps, a.steps);
  assert.equal(c.weight, a.weight);
  assert.equal(c.workouts, a.workouts);
});

test('a rename invalidates every section', () => {
  const a = computeHashes(users, entries, TODAY);
  const renamed = users.map(u => u.id === 'u2' ? { ...u, name: 'Davo' } : u);
  const b = computeHashes(renamed, entries, TODAY);
  for (const k of ['weight', 'steps', 'workouts', 'feed']) assert.notEqual(b[k], a[k]);
});

test('changedSections diffs against stored hashes', () => {
  const computed = computeHashes(users, entries, TODAY);
  assert.deepEqual(changedSections(computed, computed), []);
  assert.deepEqual(
    changedSections(computed, { ...computed, feed: 'stale' }), ['feed']);
  assert.deepEqual(
    changedSections(computed, {}),
    ['weight', 'steps', 'workouts', 'feed']);
});

test('nothing due before 07:30', () => {
  const w = decidePushWork({ users, entries, pushState: {}, now: at(7, 0), today: TODAY });
  assert.equal(w.morningDue, false);
  assert.equal(w.eveningDue, false);
  assert.deepEqual(w.morning, []);
  assert.deepEqual(w.evening, []);
});

test('morning due at 08:00 targets only enabled subscriptions', () => {
  const w = decidePushWork({ users, entries, pushState: {}, now: at(8, 0), today: TODAY });
  assert.equal(w.morningDue, true);
  assert.deepEqual(w.morning.map(u => u.id), ['u1']);
});

test('morning already sent today does nothing', () => {
  const w = decidePushWork({
    users, entries, pushState: { lastMorning: TODAY }, now: at(8, 0), today: TODAY });
  assert.equal(w.morningDue, false);
});

test('morning fully missed is skipped, not sent at night', () => {
  const w = decidePushWork({ users, entries, pushState: { lastEvening: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.morningDue, false);
  assert.equal(w.skipMorning, true);
  assert.deepEqual(w.morning, []);
});

test('evening due at 21:00 targets enabled users with no entry today', () => {
  const w = decidePushWork({ users, entries, pushState: { lastMorning: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.eveningDue, true);
  assert.deepEqual(w.evening, []); // u1 logged today; u2 disabled; u3 never opted in
  const quiet = entries.filter(e => e.date !== TODAY);
  const w2 = decidePushWork({ users, entries: quiet, pushState: { lastMorning: TODAY }, now: at(21, 0), today: TODAY });
  assert.deepEqual(w2.evening.map(u => u.id), ['u1']);
});

test('evening already sent today does nothing', () => {
  const w = decidePushWork({
    users, entries, pushState: { lastMorning: TODAY, lastEvening: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.eveningDue, false);
});
