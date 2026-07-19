import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsDailyCardRefresh, visibleMessages, commentCount, thisWeekStandings,
  isCommentWorthy, pendingForThread, collectThreadJobs, digestCardThreads,
  wipeCardThreads, purgeStaleFeedThreads, applyThreadReplies, deleteUserMessage,
  appendUserMessage, CARD_TARGETS, USER_MSG_MAX
} from '../js/lib/threads.js';

describe('needsDailyCardRefresh', () => {
  it('false when cardsDay is already today', () => {
    const now = new Date('2026-07-19T10:00:00');
    assert.equal(needsDailyCardRefresh('2026-07-19', '2026-07-19', now), false);
  });
  it('false before 03:00 even if cardsDay is stale', () => {
    const now = new Date('2026-07-19T02:30:00');
    assert.equal(needsDailyCardRefresh('2026-07-18', '2026-07-19', now), false);
  });
  it('true at/after 03:00 when cardsDay is missing or yesterday', () => {
    const now = new Date('2026-07-19T03:00:00');
    assert.equal(needsDailyCardRefresh('2026-07-18', '2026-07-19', now), true);
    assert.equal(needsDailyCardRefresh(null, '2026-07-19', now), true);
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
  it('flags 15k steps and multi-part workouts', () => {
    assert.equal(isCommentWorthy({ id: 'a', userId: 'u', date: '2026-07-18', steps: 15000 }, [], monday), true);
    assert.equal(isCommentWorthy({
      id: 'b', userId: 'u', date: '2026-07-18',
      workoutParts: ['a', 'b', 'c']
    }, [], monday), true);
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
  it('digests card threads and wipes them', () => {
    const threads = {
      workouts: {
        messages: [
          { id: '1', kind: 'user', name: 'Simon', text: 'oi', at: 't1' },
          { id: '2', kind: 'aiden', name: 'Aiden', text: 'righto', at: 't2' }
        ]
      },
      'u_2026-07-18': { messages: [{ id: '3', kind: 'user', name: 'Dan', text: 'x', at: 't' }] }
    };
    const d = digestCardThreads(threads, '2026-07-19');
    assert.ok(d.notes.some(n => n.includes('workouts') && n.includes('Simon')));
    const wiped = wipeCardThreads(threads);
    assert.equal(wiped.workouts, undefined);
    assert.ok(wiped['u_2026-07-18']);
  });
  it('purges feed threads older than 3 days or off the feed set', () => {
    const threads = {
      weight: { messages: [] },
      'u_2026-07-10': { messages: [{ id: '1', kind: 'aiden', text: 'old', at: 't' }] },
      'u_2026-07-18': { messages: [{ id: '2', kind: 'aiden', text: 'ok', at: 't' }] },
      'u_2026-07-19': { messages: [{ id: '3', kind: 'user', text: 'hi', at: 't' }] }
    };
    const purged = purgeStaleFeedThreads(threads, {
      today: '2026-07-19',
      feedIds: ['u_2026-07-19']
    });
    assert.ok(purged.weight);
    assert.equal(purged['u_2026-07-10'], undefined);
    assert.equal(purged['u_2026-07-18'], undefined);
    assert.ok(purged['u_2026-07-19']);
  });
  it('applyThreadReplies appends Aiden and clears answered tombstones', () => {
    const threads = {
      workouts: {
        lastAidenAt: '2026-07-19T01:00:00.000Z',
        messages: [
          { id: '1', kind: 'user', userId: 's', name: 'Simon', text: 'gone', at: '2026-07-19T00:00:00.000Z', deleted: true },
          { id: '2', kind: 'user', userId: 's', name: 'Simon', text: 'hi', at: '2026-07-19T02:00:00.000Z' }
        ]
      }
    };
    const next = applyThreadReplies(threads, { workouts: 'Fair call mate.' }, '2026-07-19T03:00:00.000Z');
    assert.equal(next.workouts.messages.some(m => m.deleted), false);
    assert.equal(next.workouts.messages.at(-1).kind, 'aiden');
    assert.equal(next.workouts.messages.at(-1).name, 'Aiden');
    assert.equal(next.workouts.lastAidenAt, '2026-07-19T03:00:00.000Z');
  });
});

describe('collectThreadJobs', () => {
  it('opens feed job for comment-worthy entry since scanAt', () => {
    const entries = [{
      id: 'u_2026-07-19',
      userId: 'u',
      name: 'Dan',
      date: '2026-07-19',
      steps: 16000,
      updatedAt: '2026-07-19T08:00:00.000Z'
    }];
    const jobs = collectThreadJobs({
      threads: {},
      entries,
      today: '2026-07-19',
      scanAt: '2026-07-19T07:00:00.000Z',
      feedIds: ['u_2026-07-19']
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].target, 'u_2026-07-19');
    assert.equal(jobs[0].worthy.length, 1);
  });
  it('card jobs only when humans pending', () => {
    const jobs = collectThreadJobs({
      threads: {
        workouts: {
          lastAidenAt: null,
          messages: [{ id: '1', kind: 'user', name: 'Simon', text: 'oi', at: '2026-07-19T09:00:00.000Z' }]
        }
      },
      entries: [],
      today: '2026-07-19',
      scanAt: null,
      feedIds: []
    });
    assert.ok(jobs.some(j => j.target === 'workouts' && j.newUser.length === 1));
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
    assert.deepEqual(CARD_TARGETS, ['weight', 'steps', 'workouts']);
  });
});
