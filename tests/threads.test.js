import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsDailyReport, visibleMessages, commentCount, thisWeekStandings,
  isCommentWorthy, aidenHasSpoken, pendingForThread, collectThreadJobs,
  digestCardThreads, wipeCardThreads, purgeStaleFeedThreads, applyThreadReplies,
  threadWritePlan, deleteUserMessage, appendUserMessage,
  CARD_TARGETS, REPORT_TARGET, USER_MSG_MAX, MAX_PROACTIVE_FEED
} from '../js/lib/threads.js';

describe('needsDailyReport', () => {
  it('false when reportDay is already today', () => {
    const now = new Date('2026-07-19T10:00:00');
    assert.equal(needsDailyReport('2026-07-19', '2026-07-19', now), false);
  });
  it('false before 03:00 even if reportDay is stale', () => {
    const now = new Date('2026-07-19T02:30:00');
    assert.equal(needsDailyReport('2026-07-18', '2026-07-19', now), false);
  });
  it('true at/after 03:00 when reportDay is missing or yesterday', () => {
    const now = new Date('2026-07-19T03:00:00');
    assert.equal(needsDailyReport('2026-07-18', '2026-07-19', now), true);
    assert.equal(needsDailyReport(null, '2026-07-19', now), true);
  });
  it('self-heals on the first tick after a late wake', () => {
    const now = new Date('2026-07-19T14:20:00'); // Mac slept through 3am
    assert.equal(needsDailyReport('2026-07-18', '2026-07-19', now), true);
  });
});

describe('thisWeekStandings', () => {
  const users = [
    { id: 'h', name: 'Hunt' },
    { id: 's', name: 'Simon' }
  ];
  // Mon 13 Jul 2026 week; pre-week workouts must not count
  const entries = [
    { userId: 'h', date: '2026-07-08', workoutParts: ['full body'] },
    { userId: 'h', date: '2026-07-13', workoutParts: ['full body'] },
    { userId: 'h', date: '2026-07-15', workoutParts: ['cardio'] },
    { userId: 's', date: '2026-07-13', workoutParts: ['chest'] },
    { userId: 's', date: '2026-07-14', workoutParts: ['cardio'] },
    { userId: 's', date: '2026-07-15', workoutParts: ['full body'] },
    { userId: 's', date: '2026-07-17', workoutParts: ['back'] }
  ];
  it('counts Mon-Sun only, not all-time', () => {
    const w = thisWeekStandings(entries, users, '2026-07-19');
    assert.equal(w.monday, '2026-07-13');
    const hunt = w.members.find(m => m.name === 'Hunt');
    const simon = w.members.find(m => m.name === 'Simon');
    assert.equal(hunt.workouts, 2);
    assert.equal(simon.workouts, 4);
    assert.notEqual(hunt.workouts, 3); // would be wrong if pre-week counted
  });
});

describe('isCommentWorthy', () => {
  const monday = '2026-07-13';
  it('flags a monster step day and a four-part session', () => {
    assert.equal(isCommentWorthy({ id: 'a', userId: 'u', date: '2026-07-18', steps: 18000 }, [], monday), true);
    assert.equal(isCommentWorthy({
      id: 'b', userId: 'u', date: '2026-07-18',
      workoutParts: ['a', 'b', 'c', 'd']
    }, [], monday), true);
  });
  it('no longer flags the old softer bar (15k steps, three parts)', () => {
    // Tightened 2026-07-26: the old thresholds fired on 45% of all entries.
    assert.equal(isCommentWorthy({ id: 'c', userId: 'u', date: '2026-07-18', steps: 15000 }, [], monday), false);
    assert.equal(isCommentWorthy({
      id: 'd', userId: 'u', date: '2026-07-18', workoutParts: ['a', 'b', 'c']
    }, [], monday), false);
  });
  it('flags a real session plus the challenge', () => {
    assert.equal(isCommentWorthy({
      id: 'e', userId: 'u', date: '2026-07-18',
      workoutParts: ['legs', 'core'], dailyChallenge: true
    }, [], monday), true);
  });
  it('flags a first-ever weigh-in', () => {
    const first = { id: 'f', userId: 'u', date: '2026-07-18', weight: 84 };
    assert.equal(isCommentWorthy(first, [first], monday), true);
    const later = { id: 'g', userId: 'u', date: '2026-07-19', weight: 83 };
    assert.equal(isCommentWorthy(later, [first, later], monday), false);
  });
  it('flags third workout day of the week only', () => {
    const entries = [
      { userId: 'u', date: '2026-07-13', workoutParts: ['a'] },
      { userId: 'u', date: '2026-07-14', workoutParts: ['a'] },
      { userId: 'u', date: '2026-07-15', workoutParts: ['a'] }
    ];
    assert.equal(isCommentWorthy(entries[2], entries, monday), true);
    const fourth = { userId: 'u', date: '2026-07-16', workoutParts: ['a'] };
    assert.equal(isCommentWorthy(fourth, [...entries, fourth], monday), false);
  });
  it('ignores quiet single-part days', () => {
    assert.equal(isCommentWorthy({
      userId: 'u', date: '2026-07-18', workoutParts: ['cardio'], steps: 2000
    }, [], monday), false);
  });
});

describe('pendingForThread + delete', () => {
  it('treats user msgs after lastAidenAt as pending', () => {
    const thread = {
      lastAidenAt: '2026-07-19T01:00:00.000Z',
      messages: [
        { id: '1', kind: 'user', userId: 's', name: 'Simon', text: 'old', at: '2026-07-19T00:00:00.000Z' },
        { id: '2', kind: 'user', userId: 's', name: 'Simon', text: 'new', at: '2026-07-19T02:00:00.000Z' }
      ]
    };
    const p = pendingForThread(thread);
    assert.equal(p.newUser.length, 1);
    assert.equal(p.newUser[0].id, '2');
  });
  it('hard-deletes before Aiden, soft-deletes after', () => {
    const base = {
      lastAidenAt: '2026-07-19T01:00:00.000Z',
      messages: [
        { id: 'old', kind: 'user', userId: 's', name: 'Simon', text: 'x', at: '2026-07-19T00:30:00.000Z' },
        { id: 'new', kind: 'user', userId: 's', name: 'Simon', text: 'y', at: '2026-07-19T02:00:00.000Z' }
      ]
    };
    const soft = deleteUserMessage(base, 'old', 's');
    assert.equal(soft.thread.messages.find(m => m.id === 'old').deleted, true);
    const hard = deleteUserMessage(base, 'new', 's');
    assert.equal(hard.thread.messages.some(m => m.id === 'new'), false);
  });
});

describe('digest / wipe / purge / apply', () => {
  it('digests the report thread with the ACTUAL text, then wipes it', () => {
    // The old digest stored "workouts: Simon bantered (2 msgs)", which gave
    // Aiden nothing to call back to, so `memory` was decorative.
    const threads = {
      [REPORT_TARGET]: {
        messages: [
          { id: '1', kind: 'user', name: 'Simon', text: 'Morry is a milk carton', at: 't1' },
          { id: '2', kind: 'aiden', name: 'Aiden', text: 'Fair call, zero since Monday', at: 't2' },
          { id: '3', kind: 'user', name: 'Dan', text: 'gone', at: 't3', deleted: true }
        ]
      },
      'u_2026-07-18': { messages: [{ id: '4', kind: 'user', name: 'Dan', text: 'x', at: 't' }] }
    };
    const d = digestCardThreads(threads, '2026-07-19');
    assert.equal(d.day, '2026-07-19');
    assert.ok(d.lines.some(l => l.includes('Simon') && l.includes('milk carton')));
    assert.ok(d.lines.some(l => l.startsWith('Aiden:')));
    assert.equal(d.lines.some(l => l.includes('gone')), false, 'deleted messages stay out of memory');

    const wiped = wipeCardThreads(threads);
    assert.equal(wiped[REPORT_TARGET], undefined);
    assert.ok(wiped['u_2026-07-18'], 'feed threads survive the daily wipe');
  });
  it('returns null when there is nothing to remember', () => {
    assert.equal(digestCardThreads({}, '2026-07-19'), null);
  });
  it('purges feed threads on date only, so 2-day-old banter survives', () => {
    // Regression: purging by "not in the current 12-item feed window" binned
    // comments after ~1.5 days despite FEED_THREAD_MAX_AGE_DAYS being 3.
    const threads = {
      [REPORT_TARGET]: { messages: [] },
      'u_2026-07-10': { messages: [{ id: '1', kind: 'aiden', text: 'old', at: 't' }] },
      'u_2026-07-17': { messages: [{ id: '2', kind: 'aiden', text: 'ok', at: 't' }] },
      'u_2026-07-19': { messages: [{ id: '3', kind: 'user', text: 'hi', at: 't' }] }
    };
    const purged = purgeStaleFeedThreads(threads, { today: '2026-07-19' });
    assert.ok(purged[REPORT_TARGET]);
    assert.equal(purged['u_2026-07-10'], undefined, 'older than 3 days goes');
    assert.ok(purged['u_2026-07-17'], 'two days old survives (used to be binned)');
    assert.ok(purged['u_2026-07-19']);
  });
  it('applyThreadReplies appends Aiden and clears answered tombstones', () => {
    const threads = {
      [REPORT_TARGET]: {
        lastAidenAt: '2026-07-19T01:00:00.000Z',
        messages: [
          { id: '1', kind: 'user', userId: 's', name: 'Simon', text: 'gone', at: '2026-07-19T00:00:00.000Z', deleted: true },
          { id: '2', kind: 'user', userId: 's', name: 'Simon', text: 'hi', at: '2026-07-19T02:00:00.000Z' }
        ]
      }
    };
    const next = applyThreadReplies(threads, { [REPORT_TARGET]: 'Fair call mate.' }, '2026-07-19T03:00:00.000Z');
    const t = next[REPORT_TARGET];
    assert.equal(t.messages.some(m => m.deleted), false);
    assert.equal(t.messages.at(-1).kind, 'aiden');
    assert.equal(t.messages.at(-1).name, 'Aiden');
    assert.equal(t.lastAidenAt, '2026-07-19T03:00:00.000Z');
  });
  it('stamps lastAidenAt with the PRE-CALL time so mid-call comments stay pending', () => {
    const preCall = '2026-07-19T03:00:00.000Z';
    const written = '2026-07-19T03:02:30.000Z';
    const midCall = '2026-07-19T03:01:00.000Z'; // posted while the model was thinking
    const threads = {
      [REPORT_TARGET]: {
        lastAidenAt: null,
        messages: [
          { id: '1', kind: 'user', userId: 's', name: 'Simon', text: 'first', at: '2026-07-19T02:59:00.000Z' },
          { id: '2', kind: 'user', userId: 'd', name: 'Dan', text: 'landed mid-call', at: midCall }
        ]
      }
    };
    const next = applyThreadReplies(threads, { [REPORT_TARGET]: 'Righto.' }, written, preCall);
    assert.equal(next[REPORT_TARGET].lastAidenAt, preCall);
    assert.equal(next[REPORT_TARGET].messages.at(-1).at, written, 'Aiden still sorts last');
    // Dan's comment must still be pending on the next tick.
    const pending = pendingForThread(next[REPORT_TARGET]);
    assert.deepEqual(pending.newUser.map(m => m.id), ['2']);
  });
});

describe('threadWritePlan', () => {
  it('touches only changed keys and lists removals', () => {
    const prev = {
      a: { messages: [{ id: '1', text: 'x' }] },
      b: { messages: [{ id: '2', text: 'y' }] },
      gone: { messages: [] }
    };
    const next = {
      a: { messages: [{ id: '1', text: 'x' }] },              // untouched
      b: { messages: [{ id: '2', text: 'y' }, { id: '3' }] },   // changed
      c: { messages: [{ id: '4' }] }                            // new
    };
    const plan = threadWritePlan(prev, next);
    assert.deepEqual(Object.keys(plan.sets).sort(), ['b', 'c']);
    assert.deepEqual(plan.deletes, ['gone']);
    assert.equal('a' in plan.sets, false, 'unchanged keys are never rewritten');
  });
  it('is a no-op when nothing moved', () => {
    const same = { a: { messages: [] } };
    const plan = threadWritePlan(same, { a: { messages: [] } });
    assert.deepEqual(plan.sets, {});
    assert.deepEqual(plan.deletes, []);
  });
  it('handles a missing previous map', () => {
    const plan = threadWritePlan(undefined, { a: { messages: [] } });
    assert.deepEqual(Object.keys(plan.sets), ['a']);
    assert.deepEqual(plan.deletes, []);
  });
});

describe('collectThreadJobs', () => {
  const bigLog = (id, date, extra = {}) => ({
    id, userId: id.split('_')[0], name: 'Dan', date, steps: 19000, ...extra
  });

  it('opens a praise job for a fresh big log Aiden has not touched', () => {
    // Proactive praise is back ON (2026-07-26): the feed parent is a local
    // template now, so Aiden commenting under it is a reaction, not an echo.
    const entries = [bigLog('u_2026-07-19', '2026-07-19')];
    const jobs = collectThreadJobs({
      threads: {}, entries, today: '2026-07-19', feedIds: ['u_2026-07-19']
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, 'praise');
    assert.equal(jobs[0].target, 'u_2026-07-19');
    assert.equal(jobs[0].worthy.length, 1);
  });

  it('never re-fires once Aiden has spoken, even if the entry is re-edited', () => {
    // The 2026-07-19 re-hype bug: updatedAt moving past scanAt re-triggered a
    // reply. Gate is now "has Aiden ever spoken here", which an edit cannot undo.
    const entries = [bigLog('u_2026-07-19', '2026-07-19', { updatedAt: '2026-07-19T23:00:00.000Z' })];
    const jobs = collectThreadJobs({
      threads: {
        'u_2026-07-19': {
          lastAidenAt: '2026-07-19T05:00:00.000Z',
          messages: [{ id: 'a1', kind: 'aiden', name: 'Aiden', text: 'Unit.', at: '2026-07-19T05:00:00.000Z' }]
        }
      },
      entries, today: '2026-07-19', feedIds: ['u_2026-07-19']
    });
    assert.equal(jobs.length, 0);
  });

  it('ignores logs older than yesterday', () => {
    const entries = [bigLog('u_2026-07-14', '2026-07-14')];
    const jobs = collectThreadJobs({
      threads: {}, entries, today: '2026-07-19', feedIds: ['u_2026-07-14']
    });
    assert.equal(jobs.length, 0);
  });

  it('caps proactive praise per tick', () => {
    const entries = Array.from({ length: MAX_PROACTIVE_FEED + 3 }, (_, i) =>
      bigLog(`u${i}_2026-07-19`, '2026-07-19'));
    const jobs = collectThreadJobs({
      threads: {}, entries, today: '2026-07-19', feedIds: entries.map(e => e.id)
    });
    assert.equal(jobs.length, MAX_PROACTIVE_FEED);
  });

  it('opens a feed job when humans are pending, with worthy context attached', () => {
    const entries = [bigLog('u_2026-07-19', '2026-07-19')];
    const jobs = collectThreadJobs({
      threads: {
        'u_2026-07-19': {
          lastAidenAt: null,
          messages: [{ id: '1', kind: 'user', name: 'Simon', text: 'beast', at: '2026-07-19T09:00:00.000Z' }]
        }
      },
      entries, today: '2026-07-19', feedIds: ['u_2026-07-19']
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, 'feed', 'a human-led thread is not downgraded to praise');
    assert.equal(jobs[0].newUser.length, 1);
    assert.equal(jobs[0].worthy.length, 1);
  });

  it('answers humans under the report parent', () => {
    const jobs = collectThreadJobs({
      threads: {
        [REPORT_TARGET]: {
          lastAidenAt: null,
          messages: [{ id: '1', kind: 'user', name: 'Simon', text: 'oi', at: '2026-07-19T09:00:00.000Z' }]
        }
      },
      entries: [], today: '2026-07-19', feedIds: []
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, 'report');
    assert.equal(jobs[0].newUser.length, 1);
  });

  it('ignores a quiet log nobody is talking about', () => {
    const entries = [{ id: 'u_2026-07-19', userId: 'u', name: 'Dan', date: '2026-07-19', steps: 3000 }];
    const jobs = collectThreadJobs({
      threads: {}, entries, today: '2026-07-19', feedIds: ['u_2026-07-19']
    });
    assert.equal(jobs.length, 0);
  });
});

describe('aidenHasSpoken', () => {
  it('detects a reply via lastAidenAt or a message', () => {
    assert.equal(aidenHasSpoken(undefined), false);
    assert.equal(aidenHasSpoken({ messages: [] }), false);
    assert.equal(aidenHasSpoken({ lastAidenAt: 't' }), true);
    assert.equal(aidenHasSpoken({ messages: [{ kind: 'aiden' }] }), true);
    assert.equal(aidenHasSpoken({ messages: [{ kind: 'user' }] }), false);
  });
});

describe('visible comment count', () => {
  it('counts user + Aiden, skips deleted', () => {
    const thread = {
      messages: [
        { id: '1', kind: 'user', text: 'a', deleted: true },
        { id: '2', kind: 'user', text: 'b' },
        { id: '3', kind: 'aiden', text: 'c' }
      ]
    };
    assert.equal(commentCount(thread), 2);
    assert.equal(visibleMessages(thread).length, 2);
  });
  it('append respects shape', () => {
    const t = appendUserMessage(null, { id: '1', kind: 'user', text: 'x', at: 't' });
    assert.equal(t.messages.length, 1);
    assert.equal(USER_MSG_MAX, 160);
    assert.deepEqual(CARD_TARGETS, ['report']);
  });
});
