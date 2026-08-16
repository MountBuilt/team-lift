import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exitCodeForError, backoffSecondsForExit,
  EXIT_FAIL, EXIT_FIRESTORE_QUOTA, EXIT_COPY_BALANCE
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

test('backoffSecondsForExit: quota/balance sit out an hour, other fails 5 minutes', () => {
  assert.equal(backoffSecondsForExit(EXIT_FIRESTORE_QUOTA), 3600);
  assert.equal(backoffSecondsForExit(EXIT_COPY_BALANCE), 3600);
  assert.equal(backoffSecondsForExit(EXIT_FAIL), 300);
  assert.equal(backoffSecondsForExit(0), 0);
});
