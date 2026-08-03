import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowPushCoach, PUSH_COACH_KEY } from '../js/lib/push-coach.js';

test('PUSH_COACH_KEY is stable for localStorage', () => {
  assert.equal(PUSH_COACH_KEY, 'tl_push_coach_dismissed');
});

test('shouldShowPushCoach stays quiet when dismissed or push already on', () => {
  assert.equal(shouldShowPushCoach({
    dismissed: true, pushEnabled: false, everLogged: true, pushSupported: true
  }), false);
  assert.equal(shouldShowPushCoach({
    dismissed: false, pushEnabled: true, everLogged: true, pushSupported: true
  }), false);
});

test('shouldShowPushCoach after first log even if not installed yet', () => {
  assert.equal(shouldShowPushCoach({
    dismissed: false, pushEnabled: false, everLogged: true, pushSupported: false
  }), true);
});

test('shouldShowPushCoach when installed (push API on) but notifications off', () => {
  assert.equal(shouldShowPushCoach({
    dismissed: false, pushEnabled: false, everLogged: false, pushSupported: true
  }), true);
});

test('shouldShowPushCoach quiet for brand-new browser visit with no log and no push API', () => {
  assert.equal(shouldShowPushCoach({
    dismissed: false, pushEnabled: false, everLogged: false, pushSupported: false
  }), false);
});
