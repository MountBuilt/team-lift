import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORYLINES, activeStorylines } from '../scripts/storylines.mjs';
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

test('active storylines reach the copywriter context', () => {
  const ctx = buildContext({
    users, entries, banter: {}, challengeStart: '2026-07-13', today: '2026-07-20',
    wantReport: true
  });
  assert.equal(ctx.storylines.length, 2);
  assert.deepEqual(new Set(ctx.storylines.map(s => s.subject)), new Set(['Swifty', 'Jon']));
  for (const s of ctx.storylines) assert.ok(s.note && s.until && s.id);
});

test('expired storylines are withheld from the context', () => {
  const ctx = buildContext({
    users, entries, banter: {}, challengeStart: '2026-07-13', today: '2026-07-26',
    wantReport: true
  });
  assert.deepEqual(ctx.storylines, []);
});
