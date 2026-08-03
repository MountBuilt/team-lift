import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeWork, decidePushWork, STALE_SCAN_MINUTES } from '../scripts/lib/decide.mjs';

const users = [
  { id: 'u1', name: 'Simon', push: { enabled: true, endpoint: 'https://x/1', keys: { p256dh: 'p', auth: 'a' } } },
  { id: 'u2', name: 'Dave', push: { enabled: false, endpoint: 'https://x/2', keys: { p256dh: 'p', auth: 'a' } } },
  { id: 'u3', name: 'Phill' }
];
const entries = [
  { id: 'u1_2026-07-13', userId: 'u1', date: '2026-07-13', weight: 82.5, updatedAt: 't1' },
  { id: 'u1_2026-07-12', userId: 'u1', date: '2026-07-12', steps: 10000, updatedAt: 't2' },
  { id: 'u3_2026-07-12', userId: 'u3', date: '2026-07-12', workoutParts: ['legs'], updatedAt: 't3' }
];
const at = (h, m) => new Date(2026, 6, 13, h, m); // local 2026-07-13
const TODAY = '2026-07-13';

// A scan marker `mins` minutes before `now`.
const scannedAgo = (now, mins) => new Date(now.getTime() - mins * 60000).toISOString();

const settled = (now) => ({
  banter: { reportDay: TODAY, threadScanAt: scannedAgo(now, 1), pendingAt: scannedAgo(now, 5) },
  pushState: { lastMorning: TODAY, lastEvening: TODAY }
});

// ---- probeWork: the two-read early exit that makes a 60s tick affordable ----

test('probe is idle when the report is written, pushes are sent and no comment is unseen', () => {
  const now = at(12, 0);
  const p = probeWork({ ...settled(now), now, today: TODAY });
  assert.equal(p.needsFullFetch, false);
  assert.equal(p.wantReport, false);
  assert.equal(p.threadsPossible, false);
});

test('a comment newer than the last scan wakes the tick', () => {
  const now = at(12, 0);
  const base = settled(now);
  const p = probeWork({
    ...base,
    banter: { ...base.banter, pendingAt: scannedAgo(now, 0.2) }, // after threadScanAt
    now,
    today: TODAY
  });
  assert.equal(p.unseenComment, true);
  assert.equal(p.threadsPossible, true);
  assert.equal(p.needsFullFetch, true);
});

test('a stale scan marker forces a sweep even if pendingAt never moved', () => {
  const now = at(12, 0);
  const base = settled(now);
  const p = probeWork({
    ...base,
    banter: {
      ...base.banter,
      // scan older than the threshold, and nothing new since it ran
      threadScanAt: scannedAgo(now, STALE_SCAN_MINUTES + 1),
      pendingAt: scannedAgo(now, STALE_SCAN_MINUTES + 5)
    },
    now,
    today: TODAY
  });
  assert.equal(p.unseenComment, false);
  assert.equal(p.scanStale, true);
  assert.equal(p.needsFullFetch, true);
});

test('a never-scanned doc is treated as stale, not as quiet', () => {
  const now = at(12, 0);
  const p = probeWork({
    banter: { reportDay: TODAY },
    pushState: { lastMorning: TODAY, lastEvening: TODAY },
    now,
    today: TODAY
  });
  assert.equal(p.scanStale, true);
  assert.equal(p.needsFullFetch, true);
});

test('the report is due after 03:00 on a new day and not before', () => {
  const early = at(2, 30);
  const late = at(3, 10);
  const stale = { reportDay: '2026-07-12', threadScanAt: scannedAgo(early, 1), pendingAt: scannedAgo(early, 5) };
  const pushState = { lastMorning: TODAY, lastEvening: TODAY };

  assert.equal(probeWork({ banter: stale, pushState, now: early, today: TODAY }).wantReport, false);
  assert.equal(probeWork({ banter: stale, pushState, now: late, today: TODAY }).wantReport, true);
});

test('the report is not rewritten once it is written for today', () => {
  const now = at(9, 0);
  const p = probeWork({ ...settled(now), now, today: TODAY });
  assert.equal(p.wantReport, false);
});

test('a due push wakes the tick even with nothing else pending', () => {
  const now = at(8, 0);
  const base = settled(now);
  const p = probeWork({
    ...base,
    pushState: { lastEvening: TODAY }, // morning unsent
    now,
    today: TODAY
  });
  assert.equal(p.morningDue, true);
  assert.equal(p.needsFullFetch, true);
});

// ---- decidePushWork ------------------------------------------------------

test('nothing due before 07:30', () => {
  const w = decidePushWork({ users, entries, pushState: {}, now: at(7, 0), today: TODAY });
  assert.equal(w.morningDue, false);
  assert.equal(w.eveningDue, false);
  assert.deepEqual(w.morning, []);
  assert.deepEqual(w.evening, []);
});

test('morning due at 08:00 targets only enabled subscriptions', () => {
  const w = decidePushWork({ users, entries, pushState: {}, now: at(8, 0), today: TODAY });
  assert.equal(w.morningDue, true);
  assert.deepEqual(w.morning.map(u => u.id), ['u1']);
});

test('morning already sent today does nothing', () => {
  const w = decidePushWork({
    users, entries, pushState: { lastMorning: TODAY }, now: at(8, 0), today: TODAY
  });
  assert.equal(w.morningDue, false);
  assert.deepEqual(w.morning, []);
});

test('morning fully missed is skipped, not sent at night', () => {
  const w = decidePushWork({ users, entries, pushState: { lastEvening: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.morningDue, false);
  assert.equal(w.skipMorning, true);
  assert.deepEqual(w.morning, []);
});

test('evening due at 21:00 targets enabled users with no entry today', () => {
  const w = decidePushWork({ users, entries, pushState: { lastMorning: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.eveningDue, true);
  assert.deepEqual(w.evening.map(u => u.id), []); // u1 logged today

  const quiet = entries.filter(e => e.date !== TODAY);
  const w2 = decidePushWork({ users, entries: quiet, pushState: { lastMorning: TODAY }, now: at(21, 0), today: TODAY });
  assert.deepEqual(w2.evening.map(u => u.id), ['u1']);
});

test('evening already sent today does nothing', () => {
  const w = decidePushWork({
    users, entries: [], pushState: { lastMorning: TODAY, lastEvening: TODAY }, now: at(21, 0), today: TODAY
  });
  assert.equal(w.eveningDue, false);
  assert.deepEqual(w.evening, []);
});

test('weekly report wakes the probe on Sunday after 03:00', () => {
  // 2026-08-02 Sunday
  const now = new Date(2026, 7, 2, 4, 0);
  const today = '2026-08-02';
  const p = probeWork({
    banter: {
      reportDay: today,
      threadScanAt: new Date(now.getTime() - 60000).toISOString(),
      pendingAt: new Date(now.getTime() - 300000).toISOString()
    },
    pushState: { lastMorning: today, lastEvening: today },
    now,
    today
  });
  assert.equal(p.wantWeekly, true);
  assert.equal(p.needsFullFetch, true);
});

test('weekly report does not fire mid-week', () => {
  const now = new Date(2026, 7, 4, 10, 0); // Tue
  const today = '2026-08-04';
  const p = probeWork({
    banter: {
      reportDay: today,
      weeklyReport: { weekKey: '2026-07-27', text: 'old' },
      threadScanAt: new Date(now.getTime() - 60000).toISOString(),
      pendingAt: new Date(now.getTime() - 300000).toISOString()
    },
    pushState: { lastMorning: today, lastEvening: today },
    now,
    today
  });
  assert.equal(p.wantWeekly, false);
  assert.equal(p.needsFullFetch, false);
});
