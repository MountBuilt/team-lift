import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldWakeOnBanter } from '../scripts/lib/wake.mjs';

test('first snapshot always wakes once (startup catch-up)', () => {
  const d = shouldWakeOnBanter({
    pendingAt: '2026-08-03T10:00:00.000Z',
    prevPendingAt: '',
    isFirstSnapshot: true
  });
  assert.equal(d.wake, true);
  assert.equal(d.reason, 'startup');
  assert.equal(d.nextPendingAt, '2026-08-03T10:00:00.000Z');
});

test('pendingAt advance wakes', () => {
  const d = shouldWakeOnBanter({
    pendingAt: '2026-08-03T10:01:00.000Z',
    prevPendingAt: '2026-08-03T10:00:00.000Z',
    isFirstSnapshot: false
  });
  assert.equal(d.wake, true);
  assert.equal(d.reason, 'pendingAt');
});

test('Aiden write that leaves pendingAt unchanged does not wake', () => {
  const d = shouldWakeOnBanter({
    pendingAt: '2026-08-03T10:00:00.000Z',
    prevPendingAt: '2026-08-03T10:00:00.000Z',
    isFirstSnapshot: false
  });
  assert.equal(d.wake, false);
  assert.equal(d.reason, 'noop');
  assert.equal(d.nextPendingAt, '2026-08-03T10:00:00.000Z');
});

test('empty pendingAt after first does not wake', () => {
  const d = shouldWakeOnBanter({
    pendingAt: '',
    prevPendingAt: '',
    isFirstSnapshot: false
  });
  assert.equal(d.wake, false);
});
