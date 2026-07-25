import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORYLINES, activeStorylines, storylineUntil, DEFAULT_DAYS
} from '../scripts/storylines.mjs';
import { buildContext } from '../scripts/lib/context.mjs';

const users = [
  { id: 'u1', name: 'Simon' },
  { id: 'u2', name: 'Swifty' },
  { id: 'u3', name: 'Jon' }
];
const entries = [
  { id: 'u1_2026-07-13', userId: 'u1', date: '2026-07-13', weight: 82.5, updatedAt: 't1' },
  { id: 'u2_2026-07-12', userId: 'u2', date: '2026-07-12', steps: 12000, updatedAt: 't2' }
];

test('a fed-in beat expires itself after DEFAULT_DAYS, no end date to maintain', () => {
  const s = { id: 'x', subject: 'Swifty', added: '2026-07-26', note: 'wagyu' };
  assert.equal(DEFAULT_DAYS, 3);
  assert.equal(storylineUntil(s), '2026-07-28');
  assert.equal(activeStorylines([s], '2026-07-26').length, 1, 'live the day it is added');
  assert.equal(activeStorylines([s], '2026-07-28').length, 1, 'live on the last day');
  assert.equal(activeStorylines([s], '2026-07-29').length, 0, 'forgotten the day after');
});

test('a beat is not live before the day it was added', () => {
  const s = { id: 'x', subject: 'team', added: '2026-07-26', note: 'n' };
  assert.equal(activeStorylines([s], '2026-07-25').length, 0);
});

test('days overrides the default for a beat with legs', () => {
  const s = { id: 'x', subject: 'Jon', added: '2026-07-26', days: 7, note: 'n' };
  assert.equal(storylineUntil(s), '2026-08-01');
  assert.equal(activeStorylines([s], '2026-08-01').length, 1);
  assert.equal(activeStorylines([s], '2026-08-02').length, 0);
});

test('an explicit until still works as an escape hatch', () => {
  const s = { id: 'x', subject: 'team', until: '2026-07-30', note: 'n' };
  assert.equal(storylineUntil(s), '2026-07-30');
  assert.equal(activeStorylines([s], '2026-07-30').length, 1);
  assert.equal(activeStorylines([s], '2026-07-31').length, 0);
});

test('a storyline with no start and no end is never live', () => {
  const orphan = { id: 'x', subject: 'team', note: 'n' };
  assert.equal(storylineUntil(orphan), null);
  assert.equal(activeStorylines([orphan], '2026-07-26').length, 0);
  assert.deepEqual(activeStorylines(undefined, '2026-07-26'), []);
});

test('the shipped list is short and well formed', () => {
  // Deliberately empty right now: the wagyu and no-scales beats were retired
  // on 2026-07-26 after a week of Aiden flogging them past the joke's life.
  assert.ok(STORYLINES.length <= 3, 'keep it to a few live beats at most');
  for (const s of STORYLINES) {
    assert.ok(s.id && s.subject && s.note, 'id, subject and note are required');
    assert.ok(storylineUntil(s), 'needs `added` (or an explicit `until`)');
    assert.ok(!/—/.test(s.note), 'no em-dash in a storyline note');
    assert.ok(!/\bgym\b/i.test(s.note), 'say workout, not gym');
  }
});

test('only active storylines reach the copywriter context', () => {
  const ctx = buildContext({
    users, entries, banter: {}, challengeStart: '2026-07-13', today: '2026-07-20',
    wantReport: true
  });
  assert.ok(Array.isArray(ctx.storylines));
  for (const s of ctx.storylines) {
    assert.ok(s.id && s.subject && s.note && s.until);
    assert.ok(s.until >= ctx.today, 'expired beats are withheld');
    assert.ok(!s.added || s.added <= ctx.today, 'future beats are withheld');
  }
});
