import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLED_SEASON, resolveSeason, seasonView, voiceRoster, reportBeat, hideNames,
  pushAllowed
} from '../js/lib/season.js';

const users = [
  { id: 'a', name: 'Hunt' },
  { id: 'b', name: 'Morry' },
  { id: 'c', name: 'Swifty' }
];

test('resolveSeason uses the bundled reboot while the stored season has ended', () => {
  const remote = { title: "Men's Group Challenge", startDate: '2026-07-13', endDate: '2026-09-06' };
  const got = resolveSeason(remote, '2026-09-22');
  assert.equal(got.title, 'Show Up');
  assert.equal(got.startDate, '2026-09-21');
  assert.equal(got.endDate, '2026-10-18');
});

test('resolveSeason trusts a later stored season that is still running', () => {
  const remote = { title: 'Winter', startDate: '2026-10-26', endDate: '2026-11-22' };
  const got = resolveSeason(remote, '2026-10-27');
  assert.equal(got.title, 'Winter');
  assert.equal(got.startDate, '2026-10-26');
  assert.equal(got.endDate, '2026-11-22');
});

test('seasonView is live inside the window and counts any log, not snacks', () => {
  const entries = [
    { userId: 'a', date: '2026-09-21', steps: 1000 },
    { userId: 'a', date: '2026-09-22', workoutParts: ['swimming'] },
    { userId: 'c', date: '2026-09-20', workoutParts: ['swimming'] },
    { userId: 'b', date: '2026-09-21', dailyChallenge: true }
  ];
  const s = seasonView(entries, users, BUNDLED_SEASON, '2026-09-22');
  assert.equal(s.phase, 'live');
  assert.equal(s.week, 1);
  assert.equal(s.weeks, 4);
  assert.equal(s.dayN, 2);
  assert.equal(s.totalDays, 28);
  assert.equal(s.daysLeft, 26);
  assert.equal(s.members.find(m => m.name === 'Hunt').days, 2);
  assert.equal(s.members.find(m => m.name === 'Swifty').days, 0);
  assert.equal(s.members.find(m => m.name === 'Morry').days, 1);
  assert.equal(s.members[0].name, 'Hunt');
});

test('seasonView is before the start and between after the end', () => {
  assert.equal(seasonView([], users, BUNDLED_SEASON, '2026-09-20').phase, 'before');
  const closed = seasonView(
    [{ userId: 'a', date: '2026-10-18', steps: 1 }],
    users, BUNDLED_SEASON, '2026-10-19'
  );
  assert.equal(closed.phase, 'between');
  assert.equal(closed.members.find(m => m.name === 'Hunt').days, 1);
});

test('voiceRoster dares a bloke gone 10 days and benches him after 13', () => {
  const entries = [
    { userId: 'a', date: '2026-09-21', steps: 1 },
    { userId: 'c', date: '2026-09-11', steps: 1 },
    { userId: 'b', date: '2026-09-08', steps: 1 }
  ];
  const v = voiceRoster(entries, users, '2026-09-22');
  assert.deepEqual(v.inPlay.map(x => x.name), ['Hunt']);
  assert.deepEqual(v.dare.map(x => x.name), ['Swifty']);
  assert.deepEqual(v.benched.map(x => x.name), ['Morry']);
});

test('pushAllowed stops once a bloke has been gone 13 days', () => {
  const entries = [
    { userId: 'a', date: '2026-09-21', steps: 1 },
    { userId: 'b', date: '2026-09-08', steps: 1 }
  ];
  assert.equal(pushAllowed(entries, 'a', '2026-09-22'), true);
  assert.equal(pushAllowed(entries, 'b', '2026-09-22'), false);
});

test('hideNames drops dared and benched blokes from a copy list', () => {
  const voice = voiceRoster([
    { userId: 'a', date: '2026-09-21', steps: 1 },
    { userId: 'c', date: '2026-09-11', steps: 1 },
    { userId: 'b', date: '2026-08-01', steps: 1 }
  ], users, '2026-09-22');
  assert.deepEqual(hideNames(['Hunt', 'Swifty', 'Morry'], voice), ['Hunt']);
});

test('reportBeat welcomes on the first report of a live season', () => {
  assert.equal(reportBeat({
    today: '2026-09-22',
    challenge: BUNDLED_SEASON,
    lastReportDay: '2026-09-06'
  }), 'welcome');
});

test('reportBeat still welcomes if this season only has the old scoreboard report', () => {
  assert.equal(reportBeat({
    today: '2026-09-23',
    challenge: BUNDLED_SEASON,
    lastReportDay: '2026-09-22',
    lastReportText: 'Yesterday the board was blank. Eight blokes, zero logs.'
  }), 'welcome');
});

test('reportBeat does not welcome again once this season has had a report', () => {
  assert.equal(reportBeat({
    today: '2026-09-28',
    challenge: BUNDLED_SEASON,
    lastReportDay: '2026-09-27'
  }), 'week');
  assert.notEqual(reportBeat({
    today: '2026-09-24',
    challenge: BUNDLED_SEASON,
    lastReportDay: '2026-09-23',
    lastReportText: 'Show Up. Anything you log counts.'
  }), 'welcome');
});

test('reportBeat marks the first morning after the season as an off week', () => {
  assert.equal(reportBeat({
    today: '2026-10-19',
    challenge: BUNDLED_SEASON,
    lastReportDay: '2026-10-18'
  }), 'offweek');
  assert.notEqual(reportBeat({
    today: '2026-10-20',
    challenge: BUNDLED_SEASON,
    lastReportDay: '2026-10-19'
  }), 'offweek');
});
