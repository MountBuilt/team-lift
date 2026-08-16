import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightDelta, yesterdaySummary, templateReport, reportFresh,
  weeklyReportFresh, templateWeeklyReport
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

test('templateReport is deterministic, mentions today\'s snack, and stays clean', () => {
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
  assert.match(a, /week/i, 'Monday report covers the week that was');
  assert.ok(!/\bchallenge\b/i.test(a), 'says snack, not challenge');
});

test('templateReport mid-week still covers yesterday', () => {
  const ch = dailyChallenge('2026-07-21', '2026-07-13');
  const text = templateReport(entries, users, '2026-07-21', ch);
  assert.match(text, /yesterday/i);
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

test('weeklyReportFresh is true on the write day and the next day only', () => {
  const weekly = { weekKey: '2026-08-10', day: '2026-08-16', text: 'hi' };
  assert.equal(weeklyReportFresh(weekly, '2026-08-16'), true);
  assert.equal(weeklyReportFresh(weekly, '2026-08-17'), true);
  assert.equal(weeklyReportFresh(weekly, '2026-08-18'), false);
  assert.equal(weeklyReportFresh(weekly, '2026-08-15'), false);
  assert.equal(weeklyReportFresh({ day: '2026-08-16', text: '' }, '2026-08-16'), false);
  assert.equal(weeklyReportFresh(null, '2026-08-16'), false);
});

test('templateWeeklyReport is non-empty and has no absolute kg or em-dash', () => {
  const users = [
    { id: 'u1', name: 'Sam', color: '#f97316' },
    { id: 'u2', name: 'Alex', color: '#22d3ee' }
  ];
  const entries = [
    { userId: 'u1', name: 'Sam', date: '2026-08-03', steps: 5000, workoutParts: ['legs'] },
    { userId: 'u2', name: 'Alex', date: '2026-08-04', steps: 12000, dailyChallenge: true }
  ];
  const text = templateWeeklyReport(entries, users, '2026-08-09'); // Sunday
  assert.ok(text.length > 40, text);
  assert.ok(!text.includes('—'));
  assert.ok(!/\b\d{2,3}\s*kg\b/i.test(text), text);
});
