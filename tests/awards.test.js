import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyAwards } from '../js/lib/awards.js';

const users = [
  { id: 'u1', name: 'Sam', color: '#f97316' },
  { id: 'u2', name: 'Alex', color: '#22d3ee' },
  { id: 'u3', name: 'Bruce', color: '#a3e635' }
];
const e = (userId, date, fields = {}) => ({
  userId, name: users.find(u => u.id === userId).name, date,
  weight: null, steps: null, workoutParts: null, dailyChallenge: false, ...fields
});

// Week Mon 2026-07-06 .. Sun 2026-07-12
const monday = '2026-07-06';

test('weeklyAwards picks leaders for steps, workouts, challenge, consistency', () => {
  const entries = [
    e('u1', '2026-07-06', { steps: 5000, workoutParts: ['legs'], dailyChallenge: true }),
    e('u1', '2026-07-07', { steps: 1000, dailyChallenge: true }),
    e('u2', '2026-07-06', { steps: 12000, workoutParts: ['chest'] }),
    e('u2', '2026-07-07', { workoutParts: ['back'] }),
    e('u2', '2026-07-08', { workoutParts: ['arms'] }),
    e('u3', '2026-07-06', { steps: 100, dailyChallenge: true }),
    e('u3', '2026-07-07', { dailyChallenge: true }),
    e('u3', '2026-07-08', { dailyChallenge: true }),
    e('u3', '2026-07-09', { dailyChallenge: true }),
    // outside week
    e('u1', '2026-07-13', { steps: 99999, workoutParts: ['legs', 'chest'] })
  ];
  const a = weeklyAwards(entries, users, monday);
  assert.equal(a.steps.userId, 'u2');
  assert.equal(a.steps.value, 12000);
  assert.equal(a.workouts.userId, 'u2');
  assert.equal(a.workouts.value, 3);
  assert.equal(a.challenge.userId, 'u3');
  assert.equal(a.challenge.value, 4);
  // consistency: days with hasAnyLog — u3 has 4, u1 has 2, u2 has 3
  assert.equal(a.consistency.userId, 'u3');
  assert.equal(a.consistency.value, 4);
});

test('weeklyAwards returns null categories when nobody qualifies', () => {
  const a = weeklyAwards([], users, monday);
  assert.equal(a.steps, null);
  assert.equal(a.workouts, null);
  assert.equal(a.challenge, null);
  assert.equal(a.consistency, null);
});

test('weeklyAwards breaks ties by name ascending', () => {
  const entries = [
    e('u1', '2026-07-06', { steps: 5000 }),
    e('u2', '2026-07-06', { steps: 5000 })
  ];
  const a = weeklyAwards(entries, users, monday);
  // Alex before Sam
  assert.equal(a.steps.userId, 'u2');
  assert.equal(a.steps.name, 'Alex');
});
