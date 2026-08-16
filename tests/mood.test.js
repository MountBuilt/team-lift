import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRefreshMood, moodFromEvent, resolveMood, MOODS
} from '../scripts/lib/context.mjs';

const named = (name) => {
  assert.ok(MOODS.some(m => m.name === name), `unknown mood ${name}`);
};

test('shouldRefreshMood: missing previous always refreshes', () => {
  assert.equal(shouldRefreshMood(null, { wantReport: true }), true);
  assert.equal(shouldRefreshMood({}, { threadJobs: [{ target: 'report' }] }), true);
});

test('shouldRefreshMood: more comments on the same thread keep the mood', () => {
  const prev = { name: 'combative', targets: ['report'], trigger: 'thread:report' };
  assert.equal(shouldRefreshMood(prev, {
    threadJobs: [{ target: 'report' }]
  }), false);
});

test('shouldRefreshMood: a new thread target is a new event', () => {
  const prev = { name: 'combative', targets: ['report'] };
  assert.equal(shouldRefreshMood(prev, {
    threadJobs: [{ target: 'u1_2026-08-16' }]
  }), true);
});

test('shouldRefreshMood: a morning report is a new event', () => {
  const prev = { name: 'dry', targets: ['report'] };
  assert.equal(shouldRefreshMood(prev, { wantReport: true }), true);
});

test('shouldRefreshMood: new feed lines are a new event', () => {
  const prev = { name: 'dry', targets: [] };
  assert.equal(shouldRefreshMood(prev, { feedLineJobs: [{ id: 'x' }] }), true);
});

test('shouldRefreshMood: a morning or evening push wave is a new event', () => {
  const prev = { name: 'dry', targets: [] };
  assert.equal(shouldRefreshMood(prev, { morning: [{ id: 'u1' }] }), true);
  assert.equal(shouldRefreshMood(prev, { evening: [{ id: 'u1' }] }), true);
});

test('moodFromEvent: thin yesterday turnout is combative', () => {
  const mood = moodFromEvent({
    wantReport: true,
    yesterday: { loggedCount: 2, totalMembers: 8, silent: ['a', 'b', 'c', 'd', 'e', 'f'] }
  });
  named(mood.name);
  assert.equal(mood.name, 'combative');
});

test('moodFromEvent: full house is wired', () => {
  const mood = moodFromEvent({
    wantReport: true,
    yesterday: { loggedCount: 8, totalMembers: 8, silent: [] }
  });
  assert.equal(mood.name, 'wired');
});

test('moodFromEvent: two-plus snack skips among logged is filthy', () => {
  const mood = moodFromEvent({
    wantReport: true,
    yesterday: { loggedCount: 6, totalMembers: 8, silent: ['a', 'b'] },
    challengeYesterday: { skippedAmongLogged: ['x', 'y'] }
  });
  assert.equal(mood.name, 'filthy');
});

test('moodFromEvent: a delete after he answered is sulking', () => {
  const mood = moodFromEvent({
    threadJobs: [{ target: 'report', deletesToAck: [{ name: 'Simon' }] }]
  });
  assert.equal(mood.name, 'sulking');
});

test('moodFromEvent: evening-only is affectionate', () => {
  const mood = moodFromEvent({ evening: [{ id: 'u1' }] });
  assert.equal(mood.name, 'affectionate');
});

test('moodFromEvent: a big-effort feed line is grandiose', () => {
  const mood = moodFromEvent({
    feedLineJobs: [{ id: 'e1', steps: 18000 }]
  });
  assert.equal(mood.name, 'grandiose');
});

test('moodFromEvent: returns a known mood with targets from the event', () => {
  const mood = moodFromEvent({
    threadJobs: [{ target: 'report' }, { target: 'u1_2026-08-16' }]
  });
  assert.ok(MOODS.some(m => m.name === mood.name));
  assert.ok(mood.note);
  assert.deepEqual(mood.targets.sort(), ['report', 'u1_2026-08-16']);
});

test('resolveMood: continuation keeps the previous mood and marks it sticky', () => {
  const prev = { name: 'sulking', note: 'wounded', targets: ['report'], trigger: 'thread:report' };
  const next = resolveMood(prev, { threadJobs: [{ target: 'report', deletesToAck: [] }] });
  assert.equal(next.name, 'sulking');
  assert.equal(next.sticky, true);
  assert.match(next.note, /wounded|still/i);
});

test('resolveMood: a new event picks from the data, not the previous name', () => {
  const prev = { name: 'affectionate', targets: ['report'] };
  const next = resolveMood(prev, {
    wantReport: true,
    yesterday: { loggedCount: 1, totalMembers: 8, silent: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
  });
  assert.equal(next.name, 'combative');
  assert.notEqual(next.sticky, true);
});
