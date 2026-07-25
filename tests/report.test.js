import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightDelta, yesterdaySummary, templateReport, reportFresh
} from '../js/lib/report.js';
import { dailyChallenge } from '../js/lib/challenge.js';
import { findAbsoluteWeight } from '../scripts/lib/context.mjs';

const TODAY = '2026-07-20'; // Monday
const users = [
  { id: 'h', name: 'Hunt' },
  { id: 's', name: 'Simon' },
  { id: 'm', name: 'Morry' }
];
// Yesterday is Sunday 2026-07-19.
const entries = [
  { id: 'h_2026-07-15', userId: 'h', name: 'Hunt', date: '2026-07-15', weight: 90 },
  { id: 'h_2026-07-19', userId: 'h', name: 'Hunt', date: '2026-07-19', weight: 88.5, steps: 19000, workoutParts: ['legs', 'core'], dailyChallenge: true },
  { id: 's_2026-07-18', userId: 's', name: 'Simon', date: '2026-07-18', dailyChallenge: true },
  { id: 's_2026-07-19', userId: 's', name: 'Simon', date: '2026-07-19', steps: 4000, dailyChallenge: true }
  // Morry logged nothing at all.
];

test('weightDelta compares against the previous weigh-in, not the previous day', () => {
  assert.equal(weightDelta(entries, 'h', '2026-07-19'), -1.5); // 90 -> 88.5
  assert.equal(weightDelta(entries, 'h', '2026-07-15'), null, 'first weigh-in has no delta');
  assert.equal(weightDelta(entries, 's', '2026-07-19'), null, 'never weighed in');
});

test('yesterdaySummary covers the completed day only', () => {
  const s = yesterdaySummary(entries, users, TODAY);
  assert.equal(s.date, '2026-07-19');
  assert.equal(s.label, 'Yesterday');
  assert.equal(s.totalMembers, 3);
  assert.equal(s.loggedCount, 2);
  assert.deepEqual(s.silent, ['Morry']);
  assert.equal(s.teamSteps, 23000);
  assert.equal(s.teamWorkouts, 1);
  assert.equal(s.challengeTicks, 2);

  const hunt = s.members.find(m => m.name === 'Hunt');
  assert.equal(hunt.logged, true);
  assert.deepEqual(hunt.workoutParts, ['legs', 'core']);
  assert.equal(hunt.weighedIn, true);
  assert.equal(hunt.weightDelta, -1.5);

  const simon = s.members.find(m => m.name === 'Simon');
  assert.equal(simon.challengeStreak, 2, 'streak measured as at yesterday');

  const morry = s.members.find(m => m.name === 'Morry');
  assert.equal(morry.logged, false);
  assert.equal(morry.steps, null);
  assert.equal(morry.weightDelta, null);
});

test('yesterdaySummary never exposes an absolute weight', () => {
  const s = yesterdaySummary(entries, users, TODAY);
  const json = JSON.stringify(s);
  assert.equal(json.includes('88.5'), false);
  assert.equal(json.includes('"weight"'), false);
});

test('templateReport is deterministic, mentions today\'s challenge, and stays clean', () => {
  const ch = dailyChallenge(TODAY, '2026-07-13');
  const a = templateReport(entries, users, TODAY, ch);
  const b = templateReport(entries, users, TODAY, ch);
  assert.equal(a, b, 'same day, same report');
  assert.ok(a.length > 60);
  assert.ok(a.includes(ch.name), 'names the exercise');
  assert.ok(a.includes(String(ch.reps)), 'names the reps');
  assert.equal(/—/.test(a), false, 'no em-dash');
  assert.equal(/\bgym\b/i.test(a), false, 'says workout, not gym');
  assert.equal(findAbsoluteWeight(a), null, 'no absolute weight');
});

test('templateReport rotates across days', () => {
  const ch = dailyChallenge(TODAY, '2026-07-13');
  const seen = new Set();
  for (const day of ['2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21']) {
    seen.add(templateReport(entries, users, day, ch));
  }
  assert.ok(seen.size > 1, 'the fallback is not one frozen string');
});

test('templateReport copes with an empty roster and no challenge', () => {
  assert.equal(typeof templateReport([], [], TODAY), 'string');
  assert.ok(templateReport(entries, users, TODAY).length > 0);
});

test('reportFresh accepts today and yesterday, rejects older or missing', () => {
  assert.equal(reportFresh({ day: TODAY, text: 'x' }, TODAY), true);
  assert.equal(reportFresh({ day: '2026-07-19', text: 'x' }, TODAY), true);
  assert.equal(reportFresh({ day: '2026-07-18', text: 'x' }, TODAY), false);
  assert.equal(reportFresh({ day: TODAY, text: '' }, TODAY), false);
  assert.equal(reportFresh(null, TODAY), false);
  assert.equal(reportFresh({ text: 'x' }, TODAY), false);
});
