import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsDailyReport, needsWeeklyReport, visibleMessages, commentCount, thisWeekStandings,
  lastWeekStandings,
  isCommentWorthy, aidenHasSpoken, pendingForThread, collectThreadJobs,
  digestCardThreads, wipeCardThreads, purgeStaleFeedThreads, applyThreadReplies,
  aidenThinkingState,
  threadWritePlan, deleteUserMessage, appendUserMessage,
  appendReportMessage, purgeReportThreadMessages, digestDroppedReportMessages,
  collectFeedLineJobs,
  purgeStaleFeedLines, feedLineWritePlan, reportPreviewMessages, latestReportBody,
  currentReportDay,
  clipCoachPreviewText, threadMessageWindow,
  CARD_TARGETS, REPORT_TARGET, USER_MSG_MAX, REPORT_THREAD_MAX_AGE_DAYS,
  COACH_PREVIEW_LIMIT, THREAD_WINDOW_INITIAL
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
  it('lastWeekStandings on Monday is the week that just ended', () => {
    const w = lastWeekStandings(entries, users, '2026-07-20');
    assert.equal(w.monday, '2026-07-13');
    assert.equal(w.end, '2026-07-19');
    assert.equal(w.members.find(m => m.name === 'Simon').workouts, 4);
    assert.equal(thisWeekStandings(entries, users, '2026-07-20').monday, '2026-07-20');
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

  it('never speaks under a log unprompted', () => {
    // 2026-08-02: proactive praise removed. The feed line IS Aiden's voice, so
    // an unprompted reply under it was him restating himself.
    const entries = [bigLog('u_2026-07-19', '2026-07-19')];
    const jobs = collectThreadJobs({ threads: {}, entries, today: '2026-07-19' });
    assert.equal(jobs.length, 0);
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
      entries, today: '2026-07-19'
    });
    assert.equal(jobs.length, 0);
  });

  it('ignores logs older than yesterday', () => {
    const entries = [bigLog('u_2026-07-14', '2026-07-14')];
    const jobs = collectThreadJobs({
      threads: {}, entries, today: '2026-07-19'
    });
    assert.equal(jobs.length, 0);
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
      entries, today: '2026-07-19'
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, 'feed', 'a human-led thread opens a feed job');
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
      threads: {}, entries, today: '2026-07-19'
    });
    assert.equal(jobs.length, 0);
  });
});

describe('aidenThinkingState', () => {
  const now = new Date('2026-07-19T10:00:00.000Z');
  const userMsg = (at) => ({ id: 'u1', kind: 'user', userId: 's', name: 'Simon', text: 'oi', at });

  it('says thinking while a fresh comment waits on a reply', () => {
    const t = { lastAidenAt: null, messages: [userMsg('2026-07-19T09:59:30.000Z')] };
    const s = aidenThinkingState(t, now);
    assert.equal(s.thinking, true);
    assert.ok(s.expiresInMs > 0);
  });

  it('goes quiet once Aiden has answered past the comment', () => {
    const t = {
      lastAidenAt: '2026-07-19T09:59:45.000Z',
      messages: [
        userMsg('2026-07-19T09:59:30.000Z'),
        { id: 'a1', kind: 'aiden', name: 'Aiden', text: 'righto', at: '2026-07-19T09:59:50.000Z' }
      ]
    };
    assert.equal(aidenThinkingState(t, now).thinking, false);
  });

  it('gives up rather than spinning forever when no reply arrives', () => {
    const t = { lastAidenAt: null, messages: [userMsg('2026-07-19T09:50:00.000Z')] }; // 10 min ago
    assert.equal(aidenThinkingState(t, now).thinking, false);
  });

  it('uses the newest pending comment as the clock', () => {
    const t = {
      lastAidenAt: null,
      messages: [userMsg('2026-07-19T09:40:00.000Z'), userMsg('2026-07-19T09:59:50.000Z')]
    };
    assert.equal(aidenThinkingState(t, now).thinking, true);
  });

  it('ignores threads with no humans waiting, and junk timestamps', () => {
    assert.equal(aidenThinkingState(undefined, now).thinking, false);
    assert.equal(aidenThinkingState({ messages: [] }, now).thinking, false);
    assert.equal(aidenThinkingState({
      messages: [{ id: 'a', kind: 'aiden', text: 'x', at: '2026-07-19T09:59:00.000Z' }]
    }, now).thinking, false);
    assert.equal(aidenThinkingState({
      lastAidenAt: null, messages: [userMsg('not-a-date')]
    }, now).thinking, false);
  });

  it('does not count a deleted comment as waiting', () => {
    const t = {
      lastAidenAt: null,
      messages: [{ ...userMsg('2026-07-19T09:59:30.000Z'), deleted: true }]
    };
    assert.equal(aidenThinkingState(t, now).thinking, false);
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
    assert.deepEqual(CARD_TARGETS, ['report', 'weekly']);
  });
});

describe('needsWeeklyReport', () => {
  it('never fires: week recap is Monday\'s morning report', () => {
    const sunday = '2026-08-02';
    const now = new Date(2026, 7, 2, 3, 10);
    assert.equal(needsWeeklyReport(null, sunday, now), false);
    assert.equal(needsWeeklyReport(null, '2026-07-28', now), false);
  });
});

describe('continuous report thread', () => {
  it('appendReportMessage adds role:report without wiping history', () => {
    const prev = {
      messages: [
        { id: 'old', kind: 'aiden', name: 'Aiden', text: 'Yesterday.', at: '2026-07-18T03:00:00.000Z', role: 'report', reportDay: '2026-07-18' },
        { id: 'u1', kind: 'user', name: 'Simon', text: 'oi', at: '2026-07-18T10:00:00.000Z' }
      ],
      lastAidenAt: '2026-07-18T03:00:00.000Z'
    };
    const next = appendReportMessage(prev, {
      text: 'Fresh morning.',
      day: '2026-07-19',
      nowIso: '2026-07-19T03:05:00.000Z'
    });
    assert.equal(next.messages.length, 3);
    assert.equal(next.messages[0].text, 'Yesterday.');
    assert.equal(next.messages.at(-1).role, 'report');
    assert.equal(next.messages.at(-1).reportDay, '2026-07-19');
    assert.equal(next.messages.at(-1).text, 'Fresh morning.');
  });

  it(`purgeReportThreadMessages drops messages older than ${REPORT_THREAD_MAX_AGE_DAYS} days`, () => {
    const threads = {
      [REPORT_TARGET]: {
        messages: [
          { id: 'a', kind: 'aiden', text: 'old', at: '2026-07-10T03:00:00.000Z', role: 'report' },
          { id: 'b', kind: 'user', text: 'recent', at: '2026-07-17T12:00:00.000Z' },
          { id: 'c', kind: 'aiden', text: 'today', at: '2026-07-19T03:00:00.000Z', role: 'report' }
        ]
      }
    };
    const purged = purgeReportThreadMessages(threads, { today: '2026-07-19' });
    const msgs = purged[REPORT_TARGET].messages;
    assert.equal(msgs.some(m => m.id === 'a'), false);
    assert.equal(msgs.some(m => m.id === 'b'), true);
    assert.equal(msgs.some(m => m.id === 'c'), true);
  });

  it('digestDroppedReportMessages keeps the actual text of purged coach lines', () => {
    const prev = {
      [REPORT_TARGET]: {
        messages: [
          { id: 'a', kind: 'aiden', name: 'Aiden', text: 'old roast', at: '2026-07-10T03:00:00.000Z' },
          { id: 'b', kind: 'user', name: 'Simon', text: 'still here', at: '2026-07-17T12:00:00.000Z' }
        ]
      }
    };
    const next = purgeReportThreadMessages(prev, { today: '2026-07-19' });
    const digest = digestDroppedReportMessages(prev, next, '2026-07-19');
    assert.ok(digest);
    assert.equal(digest.day, '2026-07-19');
    assert.ok(digest.lines.some(l => l.includes('old roast')));
    assert.equal(digest.lines.some(l => l.includes('still here')), false);
    assert.equal(digestDroppedReportMessages(next, next, '2026-07-19'), null);
  });

  it('reportPreviewMessages: always last N including report posts (Coach chat)', () => {
    const onlyReport = {
      messages: [
        { id: '1', kind: 'aiden', text: 'R1', at: 't1', role: 'report' },
        { id: '2', kind: 'aiden', text: 'R2', at: 't2', role: 'report' }
      ]
    };
    const o = reportPreviewMessages(onlyReport);
    assert.equal(o.mode, 'aiden');
    assert.equal(o.messages.length, 2);
    assert.equal(o.messages[0].text, 'R1');
    assert.equal(o.messages[1].text, 'R2');

    const aidenReply = {
      messages: [
        { id: '1', kind: 'aiden', text: 'R', at: 't1', role: 'report' },
        { id: '2', kind: 'aiden', text: 'solo banter', at: 't2' }
      ]
    };
    const a = reportPreviewMessages(aidenReply);
    assert.equal(a.mode, 'aiden');
    assert.equal(a.messages.length, 2);
    assert.equal(a.messages[1].text, 'solo banter');

    const crew = {
      messages: [
        { id: '1', kind: 'aiden', text: 'R', at: 't1', role: 'report' },
        { id: '2', kind: 'user', name: 'Simon', text: 'oi', at: 't2' },
        { id: '3', kind: 'aiden', text: 'yeah', at: 't3' },
        { id: '4', kind: 'user', name: 'Dan', text: 'lol', at: 't4' },
        { id: '5', kind: 'user', name: 'Simon', text: 'again', at: 't5' }
      ]
    };
    const c = reportPreviewMessages(crew);
    assert.equal(c.mode, 'crew');
    assert.equal(c.messages.length, COACH_PREVIEW_LIMIT);
    assert.equal(c.messages[0].text, 'yeah');
    assert.equal(c.messages[2].text, 'again');

    assert.deepEqual(reportPreviewMessages({ messages: [] }), { mode: 'none', messages: [] });
  });

  it('currentReportDay prefers the pointer then the latest report post', () => {
    assert.equal(currentReportDay({ report: { day: '2026-08-16', text: 'x' } }), '2026-08-16');
    assert.equal(currentReportDay({ reportDay: '2026-08-15' }), '2026-08-15');
    assert.equal(currentReportDay({
      threads: {
        [REPORT_TARGET]: {
          messages: [
            { id: '1', kind: 'aiden', role: 'report', reportDay: '2026-08-14', text: 'old' },
            { id: '2', kind: 'aiden', role: 'report', reportDay: '2026-08-16', text: 'new' }
          ]
        }
      }
    }), '2026-08-16');
    assert.equal(currentReportDay({}), null);
  });

  it('clipCoachPreviewText truncates long report posts for the home card', () => {
    assert.equal(clipCoachPreviewText('short'), 'short');
    const long = 'x'.repeat(200);
    const clipped = clipCoachPreviewText(long, 180);
    assert.ok(clipped.endsWith('…'));
    assert.equal(clipped.length, 180);
  });

  it('threadMessageWindow slices from the end for load-earlier', () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({ id: String(i), text: `m${i}` }));
    const first = threadMessageWindow(msgs, THREAD_WINDOW_INITIAL);
    assert.equal(first.total, 50);
    assert.equal(first.shown, THREAD_WINDOW_INITIAL);
    assert.equal(first.hasMore, true);
    assert.equal(first.messages[0].id, String(50 - THREAD_WINDOW_INITIAL));
    assert.equal(first.messages.at(-1).id, '49');

    const more = threadMessageWindow(msgs, THREAD_WINDOW_INITIAL + 20);
    assert.equal(more.shown, 50, 'cannot show more than total');
    assert.equal(more.hasMore, false);

    const empty = threadMessageWindow([], 40);
    assert.deepEqual(empty, { messages: [], hasMore: false, shown: 0, total: 0 });
  });

  it('latestReportBody prefers today report then thread report messages', () => {
    assert.equal(
      latestReportBody({ report: { day: '2026-07-19', text: 'Today body' } }, '2026-07-19'),
      'Today body'
    );
    assert.equal(
      latestReportBody({
        threads: {
          [REPORT_TARGET]: {
            messages: [
              { id: '1', kind: 'aiden', text: 'Old report', at: 't', role: 'report' }
            ]
          }
        }
      }, '2026-07-19'),
      'Old report'
    );
  });
});

describe('feedLines helpers', () => {
  it('collectFeedLineJobs returns entries missing AI text in the window', () => {
    const entries = [
      { id: 'u_2026-07-19', userId: 'u', name: 'Dan', date: '2026-07-19', steps: 1000 },
      { id: 'u_2026-07-18', userId: 'u', name: 'Dan', date: '2026-07-18', workoutParts: ['legs'] },
      { id: 'u_2026-07-17', userId: 'u', name: 'Dan', date: '2026-07-17' } // no log
    ];
    const jobs = collectFeedLineJobs({
      entries,
      feedLines: { 'u_2026-07-18': { text: 'already', at: 't' } },
      today: '2026-07-19'
    });
    assert.deepEqual(jobs.map(e => e.id), ['u_2026-07-19']);
  });

  it('purgeStaleFeedLines and feedLineWritePlan', () => {
    const map = {
      'u_2026-07-10': { text: 'old', at: 't' },
      'u_2026-07-18': { text: 'ok', at: 't' }
    };
    const purged = purgeStaleFeedLines(map, { today: '2026-07-19' });
    assert.equal(purged['u_2026-07-10'], undefined);
    assert.ok(purged['u_2026-07-18']);

    const plan = feedLineWritePlan(map, {
      'u_2026-07-18': { text: 'ok', at: 't' },
      'u_2026-07-19': { text: 'new', at: 't2' }
    });
    assert.deepEqual(Object.keys(plan.sets), ['u_2026-07-19']);
    assert.deepEqual(plan.deletes, ['u_2026-07-10']);
  });
});
