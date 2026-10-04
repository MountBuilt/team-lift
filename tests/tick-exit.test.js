import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exitCodeForError, backoffSecondsForExit, nextQuotaReset,
  EXIT_FAIL, EXIT_FIRESTORE_QUOTA, EXIT_COPY_BALANCE,
  FAIL_BACKOFF_SECONDS, BALANCE_BACKOFF_SECONDS
} from '../scripts/lib/tick-exit.mjs';

test('exitCodeForError: Firestore 429 is a quota exit', () => {
  assert.equal(exitCodeForError(new Error('GET config/banter: HTTP 429')), EXIT_FIRESTORE_QUOTA);
  assert.equal(exitCodeForError('RESOURCE_EXHAUSTED Quota exceeded.'), EXIT_FIRESTORE_QUOTA);
});

test('exitCodeForError: Grok 402 is a balance exit', () => {
  assert.equal(
    exitCodeForError(new Error('API error (status 402 Payment Required): Grok Build usage balance exhausted')),
    EXIT_COPY_BALANCE
  );
});

test('exitCodeForError: anything else is a generic fail', () => {
  assert.equal(exitCodeForError(new Error('copy rejected')), EXIT_FAIL);
  assert.equal(exitCodeForError(null), EXIT_FAIL);
});

test('nextQuotaReset is the following midnight Pacific', () => {
  // 2026-10-04 06:30Z is still 2026-10-03 23:30 PDT. Reset is 07:00Z.
  assert.equal(
    nextQuotaReset(new Date('2026-10-04T06:30:00Z')).toISOString(),
    '2026-10-04T07:00:00.000Z'
  );
  // Just after that reset, the next one is a day later (still PDT, UTC-7).
  assert.equal(
    nextQuotaReset(new Date('2026-10-04T07:30:00Z')).toISOString(),
    '2026-10-05T07:00:00.000Z'
  );
  // December is PST (UTC-8). 07:30Z is still the previous evening, so the
  // reset ahead is 08:00Z the same UTC date. 08:30Z is after that midnight.
  assert.equal(
    nextQuotaReset(new Date('2026-12-04T07:30:00Z')).toISOString(),
    '2026-12-04T08:00:00.000Z'
  );
  assert.equal(
    nextQuotaReset(new Date('2026-12-04T08:30:00Z')).toISOString(),
    '2026-12-05T08:00:00.000Z'
  );
});

test('backoffSecondsForExit: quota waits for Spark reset, other fails sit out', () => {
  const beforeReset = new Date('2026-10-04T06:30:00Z');
  assert.equal(backoffSecondsForExit(EXIT_FIRESTORE_QUOTA, beforeReset), 30 * 60);
  assert.equal(backoffSecondsForExit(EXIT_COPY_BALANCE, beforeReset), BALANCE_BACKOFF_SECONDS);
  assert.equal(backoffSecondsForExit(EXIT_FAIL, beforeReset), FAIL_BACKOFF_SECONDS);
  assert.equal(FAIL_BACKOFF_SECONDS, 30 * 60);
  assert.equal(backoffSecondsForExit(0, beforeReset), 0);
  // Never a tight loop if the reset is only a few seconds away.
  const almost = new Date('2026-10-04T06:59:30Z');
  assert.equal(backoffSecondsForExit(EXIT_FIRESTORE_QUOTA, almost), 60);
});
