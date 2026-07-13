import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateCopy } from '../scripts/lib/context.mjs';

const TODAY = '2026-07-13';
const users = [{ id: 'u1', name: 'Simon' }, { id: 'u2', name: 'Dave' }];
const entries = [
  { id: 'u1_2026-07-12', userId: 'u1', name: 'Simon', date: '2026-07-12', workoutParts: ['legs'], dailyChallenge: true, updatedAt: 'ts-1' },
  { id: 'u2_2026-07-10', userId: 'u2', name: 'Dave', date: '2026-07-10', steps: 10000, updatedAt: 'ts-2' },
  { id: 'u1_2026-05-01', userId: 'u1', name: 'Simon', date: '2026-05-01', weight: 90, updatedAt: 'ts-0' }
];
const banter = {
  feed: { 'u1_2026-07-12': 'smashed legs.' },
  feedMeta: { 'u1_2026-07-12': 'ts-1' },
  cards: { weight: 'old weight line' },
  history: [{ ts: '2026-07-12', sections: ['feed'], cards: {} }]
};
const base = {
  users, entries, banter, challengeStart: '2026-07-13',
  changed: ['feed'], morning: [users[0]], evening: [], today: TODAY
};

test('buildContext: challenge, feedNeeds, pushes', () => {
  const ctx = buildContext(base);
  assert.equal(ctx.today, TODAY);
  assert.ok(ctx.challenge.name && ctx.challenge.reps > 0);
  // u1_2026-07-12 has a line with matching updatedAt -> not needed;
  // u2_2026-07-10 has no line -> needed; the May entry is outside the 7-day feed window.
  assert.deepEqual(ctx.feedNeeds.map(f => f.entryId), ['u2_2026-07-10']);
  assert.equal(ctx.pushes.length, 1);
  const p = ctx.pushes[0];
  assert.equal(p.kind, 'morning');
  assert.equal(p.userId, 'u1');
  assert.ok(p.recentDays.every(e => e.date >= '2026-06-29')); // 14-day window
});

test('buildContext: changed updatedAt re-flags a feed entry', () => {
  const stale = { ...banter, feedMeta: { 'u1_2026-07-12': 'ts-OLD' } };
  const ctx = buildContext({ ...base, banter: stale });
  assert.deepEqual(ctx.feedNeeds.map(f => f.entryId).sort(),
    ['u1_2026-07-12', 'u2_2026-07-10']);
});

test('validateCopy accepts a complete, clean copy', () => {
  const ctx = buildContext(base);
  const copy = {
    cards: {},
    feed: { 'u2_2026-07-10': 'clocked 10,000 on the dot. Suspiciously round, mate.' },
    pushes: [{ userId: 'u1', kind: 'morning', title: 'Oi Simon', body: `Legs yesterday, good. Today's challenge: ${ctx.challenge.reps} ${ctx.challenge.name}. Get it done.` }]
  };
  assert.deepEqual(validateCopy(copy, ctx), { ok: true, errors: [] });
});

test('validateCopy rejects em-dashes, gym, missing pushes, unknown ids, missing cards', () => {
  const ctx = buildContext({ ...base, changed: ['weight', 'feed'] });
  const bad = {
    cards: { steps: 'not a changed section' }, // also missing the requested weight card
    feed: { 'nope_2026-07-01': 'line', 'u2_2026-07-10': 'went to the gym — hard' },
    pushes: []
  };
  const res = validateCopy(bad, ctx);
  assert.equal(res.ok, false);
  const all = res.errors.join('\n');
  assert.match(all, /em-dash/);
  assert.match(all, /gym/);
  assert.match(all, /missing push/i);
  assert.match(all, /unknown feed/i);
  assert.match(all, /steps/); // card for a section that wasn't requested
  assert.match(all, /missing card for section "weight"/);
});
