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

test('buildContext: includes active storylines and the grace rules', () => {
  const ctx = buildContext(base); // today 2026-07-13, seeded storylines run to 07-25
  assert.ok(Array.isArray(ctx.storylines) && ctx.storylines.length >= 1);
  for (const s of ctx.storylines) {
    assert.ok(s.id && s.subject && s.until && s.note);
    assert.ok(s.until >= ctx.today, 'only active storylines are passed through');
  }
  assert.ok(ctx.grace && /never/i.test(ctx.grace.sameDay));
  assert.ok(/rest/i.test(ctx.grace.restDays));
});

test('buildContext: an expired storyline window drops all storylines', () => {
  const ctx = buildContext({ ...base, challengeStart: '2030-01-01', today: '2030-01-01' });
  assert.deepEqual(ctx.storylines, []);
});

test('buildContext: pushes carry same-day-graced rest status (emptyDays never counts today)', () => {
  // Simon logged 2026-07-12 (a workout) and nothing since; today is 07-13, so
  // yesterday was logged => emptyDays 0, today's blank is graced.
  const ctx = buildContext(base);
  const p = ctx.pushes[0];
  assert.equal(p.userId, 'u1');
  assert.equal(p.emptyDays, 0);
  assert.equal(p.resting, false);
  assert.equal(p.fairGame, false);
  assert.equal(typeof p.streak, 'number');
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
  assert.deepEqual(validateCopy(copy, ctx), { ok: true, errors: [], missingFeed: [] });
});

test('validateCopy allows partial feed (missing lines listed, not fatal)', () => {
  // Wake ticks that nail cards/pushes must not throw the whole job away when
  // Claude skips one re-edited feed entry - daily card cycle depends on this.
  const ctx = buildContext(base);
  const copy = {
    cards: {},
    feed: {},
    pushes: [{ userId: 'u1', kind: 'morning', title: 'Oi Simon', body: 'Get the challenge done before smoko.' }]
  };
  const res = validateCopy(copy, ctx);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.missingFeed, ['u2_2026-07-10']);
});

test('buildContext: thisWeek standings and empty threadWork by default', () => {
  const ctx = buildContext(base);
  assert.ok(ctx.thisWeek && Array.isArray(ctx.thisWeek.members));
  assert.equal(ctx.botName, 'Aiden');
  assert.deepEqual(ctx.threadWork, []);
});

test('validateCopy requires threadReplies for each threadWork target', () => {
  const ctx = buildContext({
    ...base,
    changed: [],
    morning: [],
    threadJobs: [{
      target: 'workouts',
      kind: 'card',
      newUser: [{ id: 'm1', kind: 'user', name: 'Simon', text: 'oi', at: 't' }],
      deletesToAck: [],
      worthy: []
    }]
  });
  assert.equal(ctx.threadWork.length, 1);
  const bad = validateCopy({ cards: {}, feed: {}, pushes: [], threadReplies: {} }, ctx);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.includes('missing threadReply')));
  const good = validateCopy({
    cards: {}, feed: {}, pushes: [],
    threadReplies: { workouts: 'Fair call Simon, this week is the board that matters.' }
  }, ctx);
  assert.deepEqual(good, { ok: true, errors: [], missingFeed: [] });
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
