import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateCopy, findAbsoluteWeight, copySchema, REPORT_MAX } from '../scripts/lib/context.mjs';
import { REPORT_TARGET } from '../js/lib/threads.js';

const TODAY = '2026-07-13';
const users = [{ id: 'u1', name: 'Simon' }, { id: 'u2', name: 'Dave' }];
const entries = [
  { id: 'u1_2026-07-12', userId: 'u1', name: 'Simon', date: '2026-07-12', workoutParts: ['legs'], dailyChallenge: true, weight: 88, updatedAt: 'ts-1' },
  { id: 'u2_2026-07-10', userId: 'u2', name: 'Dave', date: '2026-07-10', steps: 10000, updatedAt: 'ts-2' },
  { id: 'u1_2026-05-01', userId: 'u1', name: 'Simon', date: '2026-05-01', weight: 90, updatedAt: 'ts-0' }
];
const banter = {
  report: { day: '2026-07-12', text: 'Yesterday was quiet, boys.' },
  reportHistory: ['older report', 'Yesterday was quiet, boys.'],
  memory: [{ day: '2026-07-12', lines: ['Simon: Morry is a milk carton'] }],
  threads: {}
};
const base = {
  users, entries, banter, challengeStart: '2026-07-13',
  today: TODAY, wantReport: true, morning: [users[0]], evening: []
};

test('buildContext: jobs, challenge, yesterday summary and pushes', () => {
  const ctx = buildContext(base);
  assert.equal(ctx.today, TODAY);
  assert.deepEqual(ctx.jobs, ['report', 'pushes']);
  assert.ok(ctx.challenge.name && ctx.challenge.reps > 0);
  assert.equal(ctx.yesterday.date, '2026-07-12');
  assert.equal(ctx.yesterday.loggedCount, 1);
  assert.deepEqual(ctx.yesterday.silent, ['Dave']);

  assert.equal(ctx.pushes.length, 1);
  const p = ctx.pushes[0];
  assert.equal(p.kind, 'morning');
  assert.equal(p.userId, 'u1');
  assert.equal(p.loggedYesterday, true);
  assert.equal(p.loggedToday, false);
  assert.ok(p.week && typeof p.week.workouts === 'number');
});

test('buildContext: no absolute weight anywhere in the payload', () => {
  // The leak is prevented structurally, not by a prompt rule: Aiden is handed
  // signed deltas and never a raw kg figure. Live copy had published
  // "glued to 80" and "78 down to 75" before this.
  const ctx = buildContext(base);
  const json = JSON.stringify(ctx);
  assert.equal(json.includes('"weight"'), false, 'no raw weight field');
  assert.equal(json.includes('88'), false, 'no absolute kg value');
  const simon = ctx.yesterday.members.find(m => m.name === 'Simon');
  assert.equal(simon.weighedIn, true);
  assert.equal(simon.weightDelta, -2); // 90 -> 88
});

test('buildContext: drops the duplication the old context shipped', () => {
  const ctx = buildContext(base);
  // These four alone were ~62 KB of the old 94 KB payload.
  assert.equal('entries' in ctx, false);
  assert.equal('currentFeed' in ctx, false);
  assert.equal('currentCards' in ctx, false);
  assert.equal('feedNeeds' in ctx, false);
  assert.equal(ctx.pushes[0].recentDays, undefined, 'no 14-day per-user replay');
  assert.ok(JSON.stringify(ctx).length < 12000, 'context stays small');
});

test('buildContext: continuity material for freshness', () => {
  const ctx = buildContext(base);
  assert.equal(ctx.previousReport, 'Yesterday was quiet, boys.');
  assert.equal(ctx.reportHistory.length, 2);
  assert.ok(ctx.memory[0].lines[0].includes('milk carton'));
});

test('buildContext: withholds legacy content-free memory digests', () => {
  const ctx = buildContext({
    ...base,
    banter: {
      ...banter,
      memory: [
        { day: '2026-07-20', notes: ['weight: Swifty, Simon bantered (8 msgs)'] }, // legacy
        { day: '2026-07-21', lines: ['Dan: still calling me rookie?'] }            // useful
      ]
    }
  });
  assert.equal(ctx.memory.length, 1);
  assert.equal(ctx.memory[0].day, '2026-07-21');
});

test('buildContext: yesterday is withheld when no report is wanted', () => {
  const ctx = buildContext({ ...base, wantReport: false, morning: [] });
  assert.equal(ctx.yesterday, null);
  assert.deepEqual(ctx.jobs, []);
});

test('buildContext: passes only live storylines, plus the grace rules', () => {
  const ctx = buildContext(base);
  // The shipped list is deliberately empty (see tests/storylines.test.js);
  // assert the shape and the filtering, not a count.
  assert.ok(Array.isArray(ctx.storylines));
  for (const s of ctx.storylines) {
    assert.ok(s.id && s.subject && s.until && s.note);
    assert.ok(s.until >= ctx.today, 'only active storylines are passed through');
  }
  assert.ok(ctx.grace && /never/i.test(ctx.grace.sameDay));
  assert.ok(/rest/i.test(ctx.grace.restDays));
});

test('buildContext: pushes carry same-day-graced rest status (emptyDays never counts today)', () => {
  const ctx = buildContext(base);
  const p = ctx.pushes[0];
  assert.equal(p.emptyDays, 0);
  assert.equal(p.resting, false);
  assert.equal(p.fairGame, false);
  assert.equal(typeof p.challengeStreak, 'number');
});

test('buildContext: threadWork carries the parent line so Aiden does not repeat it', () => {
  const ctx = buildContext({
    ...base,
    wantReport: false,
    morning: [],
    threadJobs: [
      {
        target: REPORT_TARGET,
        kind: 'report',
        newUser: [{ id: 'm1', kind: 'user', name: 'Simon', text: 'oi', at: 't' }],
        deletesToAck: [],
        worthy: []
      },
      {
        target: 'u1_2026-07-12',
        kind: 'praise',
        newUser: [],
        deletesToAck: [],
        worthy: [entries[0]]
      }
    ]
  });
  assert.deepEqual(ctx.jobs, ['threads']);
  const reportJob = ctx.threadWork.find(t => t.target === REPORT_TARGET);
  assert.equal(reportJob.parent, 'Yesterday was quiet, boys.');
  const feedJob = ctx.threadWork.find(t => t.target === 'u1_2026-07-12');
  assert.ok(feedJob.parent.startsWith('Simon '), 'feed parent is the local template line');
  assert.equal(feedJob.entry.weighedIn, true);
  assert.equal(feedJob.entry.weight, undefined, 'still no absolute weight');
});

test('validateCopy accepts a complete, clean payload', () => {
  const ctx = buildContext(base);
  const copy = {
    report: `Simon carried the crew yesterday with legs and the challenge ticked while Dave went missing entirely. Today it is ${ctx.challenge.reps} ${ctx.challenge.name}, so no hiding.`,
    threadReplies: [],
    pushes: [{ userId: 'u1', kind: 'morning', title: 'Oi Simon', body: `Legs yesterday, good. Today: ${ctx.challenge.reps} ${ctx.challenge.name}. Get it done.` }]
  };
  assert.deepEqual(validateCopy(copy, ctx), { ok: true, errors: [] });
});

test('validateCopy rejects a missing report and a missing push', () => {
  const ctx = buildContext(base);
  const res = validateCopy({ report: '', threadReplies: [], pushes: [] }, ctx);
  assert.equal(res.ok, false);
  const all = res.errors.join('\n');
  assert.match(all, /missing report/);
  assert.match(all, /missing push u1\|morning/);
});

test('validateCopy rejects an over-long report', () => {
  const ctx = buildContext(base);
  const res = validateCopy({
    report: 'a'.repeat(REPORT_MAX + 1), threadReplies: [], pushes: [{ userId: 'u1', kind: 'morning', title: 't', body: 'b' }]
  }, ctx);
  assert.ok(res.errors.some(e => /report over/.test(e)));
});

test('validateCopy rejects a report that was not asked for', () => {
  const ctx = buildContext({ ...base, wantReport: false, morning: [] });
  const res = validateCopy({ report: 'surprise', threadReplies: [], pushes: [] }, ctx);
  assert.ok(res.errors.some(e => /not requested/.test(e)));
});

test('validateCopy requires one threadReply per requested target', () => {
  const ctx = buildContext({
    ...base,
    wantReport: false,
    morning: [],
    threadJobs: [{
      target: REPORT_TARGET,
      kind: 'report',
      newUser: [{ id: 'm1', kind: 'user', name: 'Simon', text: 'oi', at: 't' }],
      deletesToAck: [],
      worthy: []
    }]
  });
  assert.equal(ctx.threadWork.length, 1);

  const missing = validateCopy({ report: '', threadReplies: [], pushes: [] }, ctx);
  assert.ok(missing.errors.some(e => e.includes('missing threadReply')));

  const unknown = validateCopy({
    report: '', pushes: [],
    threadReplies: [{ target: 'nope', text: 'hi' }]
  }, ctx);
  assert.ok(unknown.errors.some(e => /unrequested threadReply/.test(e)));

  const dupes = validateCopy({
    report: '', pushes: [],
    threadReplies: [
      { target: REPORT_TARGET, text: 'one' },
      { target: REPORT_TARGET, text: 'two' }
    ]
  }, ctx);
  assert.ok(dupes.errors.some(e => /duplicate threadReply/.test(e)));

  const good = validateCopy({
    report: '', pushes: [],
    threadReplies: [{ target: REPORT_TARGET, text: 'Fair call Simon, this week is the board that matters.' }]
  }, ctx);
  assert.deepEqual(good, { ok: true, errors: [] });
});

test('validateCopy rejects em-dashes and "gym"', () => {
  const ctx = buildContext(base);
  const res = validateCopy({
    report: 'Went to the gym — it was great.',
    threadReplies: [],
    pushes: [{ userId: 'u1', kind: 'morning', title: 'Oi', body: 'Fine body copy here.' }]
  }, ctx);
  assert.equal(res.ok, false);
  const all = res.errors.join('\n');
  assert.match(all, /em-dash/);
  assert.match(all, /gym/);
});

test('findAbsoluteWeight catches absolutes and leaves deltas alone', () => {
  assert.ok(findAbsoluteWeight('the scales are glued to 80 for a third morning'));
  assert.ok(findAbsoluteWeight('cracked the scales, 78 down to 75'));
  assert.ok(findAbsoluteWeight('weighed in at 84.2 kg today'));
  assert.ok(findAbsoluteWeight('sitting on 102 kilos'));

  assert.equal(findAbsoluteWeight('backed the 0.7 kilo drop with a real session'), null);
  assert.equal(findAbsoluteWeight('crept up half a kilo on the scales'), null);
  assert.equal(findAbsoluteWeight('down 1.4 kg since Monday'), null);
  assert.equal(findAbsoluteWeight('banked 19,062 steps and ticked the challenge'), null);
  assert.equal(findAbsoluteWeight('40 air squats before smoko'), null);
});

test('validateCopy blocks an absolute weight in any slot', () => {
  const ctx = buildContext(base);
  const res = validateCopy({
    report: 'Simon is parked on 88 kg and will not shift.',
    threadReplies: [],
    pushes: [{ userId: 'u1', kind: 'morning', title: 'Oi', body: 'Down half a kilo, keep rolling.' }]
  }, ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => /absolute weight/.test(e)));
});

test('copySchema is a strict object schema with no dynamic keys', () => {
  const s = copySchema();
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required.sort(), ['pushes', 'report', 'threadReplies']);
  assert.equal(s.properties.threadReplies.items.additionalProperties, false);
  assert.equal(s.properties.pushes.items.additionalProperties, false);
});
