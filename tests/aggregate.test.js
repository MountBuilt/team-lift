import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entriesInWindow, chartWindow, weightSeries, stepsMatrix, workoutDots,
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

test('entriesInWindow keeps pre-start entries, caps at challenge end', () => {
  const entries = [e('u1', '2026-07-05'), e('u1', '2026-07-06'), e('u1', '2026-08-02'), e('u1', '2026-08-03')];
  assert.deepEqual(entriesInWindow(entries, challenge).map(x => x.date),
    ['2026-07-05', '2026-07-06', '2026-08-02']);
});

test('chartWindow spans challenge when today is inside it', () => {
  assert.deepEqual(chartWindow([], challenge, '2026-07-10'),
    { start: '2026-07-06', end: '2026-07-10' });
});

test('chartWindow starts early when today or entries precede the challenge', () => {
  assert.deepEqual(chartWindow([], challenge, '2026-07-02'),
    { start: '2026-07-02', end: '2026-07-02' });
  assert.deepEqual(chartWindow([e('u1', '2026-06-30')], challenge, '2026-07-02'),
    { start: '2026-06-30', end: '2026-07-02' });
});

test('chartWindow caps end at challenge end', () => {
  assert.deepEqual(chartWindow([], challenge, '2026-08-10'),
    { start: '2026-07-06', end: '2026-08-02' });
});

test('weightSeries returns each user\'s weigh-ins in kg, date-sorted', () => {
  const entries = [
    e('u1', '2026-07-10', { weight: 98 }),
    e('u1', '2026-07-06', { weight: 100 }),
    e('u2', '2026-07-08', { weight: 80 }),
    e('u2', '2026-07-06', { steps: 5000 }) // steps-only: not a weigh-in
  ];
  const s = weightSeries(entries, users, challenge);
  assert.equal(s.length, 2);
  const sam = s.find(x => x.userId === 'u1');
  assert.deepEqual(sam.points, [
    { date: '2026-07-06', kg: 100 },
    { date: '2026-07-10', kg: 98 }
  ]);
  const alex = s.find(x => x.userId === 'u2');
  assert.deepEqual(alex.points, [{ date: '2026-07-08', kg: 80 }]);
});

test('weightSeries includes pre-start weigh-ins', () => {
  const s = weightSeries([e('u1', '2026-07-03', { weight: 90 })], users, challenge);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].points, [{ date: '2026-07-03', kg: 90 }]);
});

test('weightSeries omits users with no weigh-in', () => {
  const s = weightSeries([e('u1', '2026-07-06', { weight: 90 })], users, challenge);
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

test('stepsMatrix shows pre-start days when today is before the challenge', () => {
  const entries = [e('u2', '2026-07-02', { steps: 10000 })];
  const m = stepsMatrix(entries, users, challenge, '2026-07-03');
  assert.deepEqual(m.dates, ['2026-07-02', '2026-07-03']);
  const alex = m.series.find(x => x.userId === 'u2');
  assert.deepEqual(alex.values, [10000, null]);
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
