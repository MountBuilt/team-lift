import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entriesInWindow, weightSeries, stepsMatrix, workoutDots,
  weeklyWorkoutCount, streakWeeks, teamTiles, activityFeed
} from '../js/lib/aggregate.js';

const challenge = { title: 'Test', startDate: '2026-07-06', endDate: '2026-08-02' };
const users = [
  { id: 'u1', name: 'Sam', color: '#f97316' },
  { id: 'u2', name: 'Alex', color: '#22d3ee' }
];
const e = (userId, date, fields = {}) => ({
  userId, name: userId === 'u1' ? 'Sam' : 'Alex', date,
  weight: null, steps: null, workoutParts: null, updatedAt: 0, ...fields
});

test('entriesInWindow filters by date string comparison', () => {
  const entries = [e('u1', '2026-07-05'), e('u1', '2026-07-06'), e('u1', '2026-08-02'), e('u1', '2026-08-03')];
  assert.deepEqual(entriesInWindow(entries, challenge).map(x => x.date),
    ['2026-07-06', '2026-08-02']);
});

test('weightSeries computes % change from each user baseline', () => {
  const entries = [
    e('u1', '2026-07-06', { weight: 100 }),
    e('u1', '2026-07-10', { weight: 98 }),
    e('u2', '2026-07-08', { weight: 80 }),
    e('u2', '2026-07-06', { steps: 5000 }) // steps-only: not a baseline
  ];
  const s = weightSeries(entries, users, challenge);
  assert.equal(s.length, 2);
  const sam = s.find(x => x.userId === 'u1');
  assert.deepEqual(sam.points, [
    { date: '2026-07-06', pct: 0 },
    { date: '2026-07-10', pct: -2 }
  ]);
  const alex = s.find(x => x.userId === 'u2');
  assert.deepEqual(alex.points, [{ date: '2026-07-08', pct: 0 }]);
});

test('weightSeries omits users with no in-window weight', () => {
  const s = weightSeries([e('u1', '2026-07-06', { weight: 90 })], users, challenge);
  assert.equal(s.length, 1);
  assert.equal(s[0].userId, 'u1');
});

test('weightSeries omits a user whose only weight is a zero baseline', () => {
  const entries = [
    e('u1', '2026-07-06', { weight: 90 }),
    e('u2', '2026-07-06', { weight: 0 })
  ];
  const s = weightSeries(entries, users, challenge);
  assert.equal(s.length, 1);
  assert.equal(s[0].userId, 'u1');
});

test('stepsMatrix aligns values to dates, capped at today', () => {
  const entries = [e('u1', '2026-07-06', { steps: 8000 }), e('u2', '2026-07-07', { steps: 12000 })];
  const m = stepsMatrix(entries, users, challenge, '2026-07-08');
  assert.deepEqual(m.dates, ['2026-07-06', '2026-07-07', '2026-07-08']);
  const sam = m.series.find(x => x.userId === 'u1');
  assert.deepEqual(sam.values, [8000, null, null]);
});

test('workoutDots marks days with non-empty workoutParts', () => {
  const entries = [
    e('u1', '2026-07-06', { workoutParts: ['legs'] }),
    e('u1', '2026-07-08', { workoutParts: [] }),          // empty = no workout
    e('u1', '2026-07-09', { workoutParts: ['core', 'arms'] })
  ];
  assert.deepEqual(workoutDots(entries, 'u1', '2026-07-06'),
    [true, false, false, true, false, false, false]);
  assert.equal(weeklyWorkoutCount(entries, 'u1', '2026-07-06'), 2);
});

test('streakWeeks counts consecutive >=3 weeks backward', () => {
  const wk = (monday, days) => days.map(i => e('u1', `2026-07-${String(6 + monday * 7 + i).padStart(2, '0')}`, { workoutParts: ['legs'] }));
  // week of Jul 6: 3 workouts; week of Jul 13: 3 workouts; current week Jul 20: 1 workout
  const entries = [...wk(0, [0, 2, 4]), ...wk(1, [0, 1, 3]), ...wk(2, [0])];
  assert.equal(streakWeeks(entries, 'u1', '2026-07-20'), 2); // current not yet 3 → count prior weeks
  const more = [...entries, e('u1', '2026-07-22', { workoutParts: ['core'] }), e('u1', '2026-07-24', { workoutParts: ['back'] })];
  assert.equal(streakWeeks(more, 'u1', '2026-07-20'), 3); // current reached 3 → included
});

test('teamTiles sums the week across members', () => {
  const entries = [
    e('u1', '2026-07-06', { workoutParts: ['legs'], steps: 8000 }),
    e('u1', '2026-07-07', { workoutParts: ['core'] }),
    e('u1', '2026-07-09', { workoutParts: ['back'] }),
    e('u2', '2026-07-07', { steps: 12000 })
  ];
  assert.deepEqual(teamTiles(entries, users, '2026-07-06'),
    { totalWorkouts: 3, membersAt3: 1, totalMembers: 2, totalSteps: 20000 });
});

test('activityFeed sorts by updatedAt desc and truncates', () => {
  const entries = [e('u1', '2026-07-06', { updatedAt: 1 }), e('u2', '2026-07-07', { updatedAt: 3 }), e('u1', '2026-07-08', { updatedAt: 2 })];
  assert.deepEqual(activityFeed(entries, 2).map(x => x.updatedAt), [3, 2]);
});
