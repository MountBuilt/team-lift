import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickFrom, feedLine, stepsComment, workoutsComment, weightComment, banterFresh,
  STRETCH_ROASTS, TEN_K_LINES, NICKNAMES
} from '../js/lib/banter.js';
import { weightAxisBounds } from '../js/lib/aggregate.js';

const users = [
  { id: 'u1', name: 'Sam', color: '#f97316' },
  { id: 'u2', name: 'Alex', color: '#22d3ee' },
  { id: 'u3', name: 'Bruce', color: '#a3e635' }
];
const e = (userId, date, fields = {}) => ({
  userId, name: users.find(u => u.id === userId).name, date,
  weight: null, steps: null, workoutParts: null, updatedAt: 0, ...fields
});

test('pickFrom is deterministic and in range', () => {
  const arr = ['a', 'b', 'c'];
  assert.equal(pickFrom(arr, 'seed-x'), pickFrom(arr, 'seed-x'));
  assert.ok(arr.includes(pickFrom(arr, 'anything')));
});

test('feedLine is stable for the same entry', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['legs', 'chest'], updatedAt: 42 });
  assert.equal(feedLine(entry), feedLine(entry));
});

test('feedLine roasts stretching-only workouts', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['stretching'], updatedAt: 7 });
  assert.ok(STRETCH_ROASTS.includes(feedLine(entry)));
});

test('feedLine hypes a real workout and names the parts', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['legs', 'back'], updatedAt: 3 });
  const line = feedLine(entry);
  assert.ok(line.includes('legs + back'));
  assert.ok(!STRETCH_ROASTS.includes(line));
});

test('feedLine calls out exactly 10,000 steps', () => {
  const entry = e('u2', '2026-07-08', { steps: 10000, updatedAt: 5 });
  assert.ok(TEN_K_LINES.includes(feedLine(entry)));
});

test('feedLine mentions steps and weigh-in alongside a workout', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['arms'], steps: 12345, weight: 90, updatedAt: 9 });
  const line = feedLine(entry);
  assert.ok(line.includes('12,345'));
  assert.ok(/scale/i.test(line));
});

test('feedLine falls back when the entry is empty', () => {
  assert.ok(feedLine(e('u1', '2026-07-08')).length > 0);
});

test('stepsComment: sole stepper is carrying the team', () => {
  const entries = [e('u2', '2026-07-08', { steps: 9000 })];
  const c = stepsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Alex'));
  assert.ok(/carry|walking|legs/i.test(c));
});

test('stepsComment: exactly 10k gets side-eye when several have stepped', () => {
  const entries = [
    e('u2', '2026-07-08', { steps: 10000 }),
    e('u1', '2026-07-08', { steps: 4000 })
  ];
  const c = stepsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Alex'));
  assert.ok(c.includes('10'));
});

test('stepsComment: null when nobody has stepped', () => {
  assert.equal(stepsComment([], users, '2026-07-06', '2026-07-09'), null);
});

test('workoutsComment: stretching-only bloke gets sent to the squat rack', () => {
  const entries = [
    e('u1', '2026-07-07', { workoutParts: ['stretching'] }),
    e('u1', '2026-07-08', { workoutParts: ['stretching'] }),
    e('u2', '2026-07-08', { workoutParts: ['legs'] })
  ];
  const c = workoutsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Sam'));
  assert.ok(/squat rack|lift|barbell/i.test(c));
});

test('workoutsComment: slackers get named when others have trained', () => {
  const entries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  const c = workoutsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Alex') && c.includes('Bruce'));
});

test('workoutsComment: null when nobody has trained', () => {
  assert.equal(workoutsComment([], users, '2026-07-06', '2026-07-09'), null);
});

test('workoutsComment: zero-workout slacker gets a tradie nickname, top trainer gets the Olympic Torch compliment', () => {
  const entries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  const c = workoutsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(NICKNAMES.zeroWorkouts.some(n => c.includes(n.name)));
  assert.ok(c.includes(NICKNAMES.neverMisses[0].name));
  assert.ok(c.includes('Sam')); // Sam is the only one who trained this week
});

test('weightComment: lone weigher praised, laggards behind-schedule, whole team weighed-in is quiet', () => {
  const one = [e('u1', '2026-07-08', { weight: 90 })];
  const c1 = weightComment(one, users, '2026-07-09');
  assert.ok(c1.includes('Sam'));

  const two = [...one, e('u2', '2026-07-08', { weight: 80 })];
  const c2 = weightComment(two, users, '2026-07-09');
  assert.ok(c2.includes('Bruce'));
  assert.ok(NICKNAMES.trailingLogging.some(n => c2.includes(n.name)));

  const three = [...two, e('u3', '2026-07-08', { weight: 70 })];
  assert.equal(weightComment(three, users, '2026-07-09'), null);
});

test('weightComment: nobody weighed in gets a "never weighed in" nickname roast', () => {
  const c = weightComment([], users, '2026-07-09');
  assert.ok(NICKNAMES.neverWeighed.some(n => c.includes(n.name)));
});

test('STRETCH_ROASTS and TEN_K_LINES include nickname-flavoured lines, reachable via feedLine', () => {
  assert.ok(STRETCH_ROASTS.some(line => NICKNAMES.stretchOnly.some(n => line.includes(n.name))));
  assert.ok(TEN_K_LINES.some(line => NICKNAMES.tenK.some(n => line.includes(n.name))));

  let stretchHit = false;
  let tenKHit = false;
  for (let i = 0; i < 50 && !(stretchHit && tenKHit); i++) {
    const stretchLine = feedLine(e('u1', '2026-07-08', { workoutParts: ['stretching'], updatedAt: i }));
    if (NICKNAMES.stretchOnly.some(n => stretchLine.includes(n.name))) stretchHit = true;
    const tenKLine = feedLine(e('u2', '2026-07-08', { steps: 10000, updatedAt: i }));
    if (NICKNAMES.tenK.some(n => tenKLine.includes(n.name))) tenKHit = true;
  }
  assert.ok(stretchHit, 'expected a stretch-only nickname line to be reachable');
  assert.ok(tenKHit, 'expected a 10k nickname line to be reachable');
});

test('nickname-flavoured picks stay deterministic for the same inputs', () => {
  const workoutEntries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  assert.equal(
    workoutsComment(workoutEntries, users, '2026-07-06', '2026-07-09'),
    workoutsComment(workoutEntries, users, '2026-07-06', '2026-07-09')
  );
  assert.equal(
    weightComment([], users, '2026-07-09'),
    weightComment([], users, '2026-07-09')
  );
  const trailing = [e('u1', '2026-07-08', { weight: 90 }), e('u2', '2026-07-08', { weight: 80 })];
  assert.equal(
    weightComment(trailing, users, '2026-07-09'),
    weightComment(trailing, users, '2026-07-09')
  );
});

test('banterFresh accepts today/yesterday, rejects stale, future, or missing', () => {
  assert.equal(banterFresh({ date: '2026-07-10' }, '2026-07-10'), true);
  assert.equal(banterFresh({ date: '2026-07-09' }, '2026-07-10'), true);
  assert.equal(banterFresh({ date: '2026-07-08' }, '2026-07-10'), false);
  assert.equal(banterFresh({ date: '2026-07-11' }, '2026-07-10'), false);
  assert.equal(banterFresh(null, '2026-07-10'), false);
  assert.equal(banterFresh({}, '2026-07-10'), false);
});

test('weightAxisBounds pads to 10 kg multiples with breathing room', () => {
  assert.deepEqual(weightAxisBounds([95, 96]), { min: 80, max: 110 });
  assert.deepEqual(weightAxisBounds([92]), { min: 80, max: 110 });
  assert.deepEqual(weightAxisBounds([70, 120]), { min: 60, max: 130 });
  assert.deepEqual(weightAxisBounds([90]), { min: 80, max: 100 });
});
