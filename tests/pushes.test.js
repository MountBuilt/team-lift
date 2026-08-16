import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipPushBody, reportPushPayload, replyPushPayload, replyPushUserIds
} from '../js/lib/pushes.js';

test('clipPushBody trims, caps, and never uses an em-dash', () => {
  assert.equal(clipPushBody('  hello  '), 'hello');
  const long = 'x'.repeat(200);
  const clipped = clipPushBody(long, 20);
  assert.ok(clipped.length <= 20);
  assert.ok(clipped.endsWith('…'));
  assert.equal(clipped.includes('—'), false);
});

test('reportPushPayload is a lock-screen hook into Coach chat', () => {
  const p = reportPushPayload('Hunt carried the week. Twelve burpees today, no excuses.');
  assert.equal(p.title, 'Aiden posted');
  assert.match(p.body, /Hunt carried/);
  assert.ok(p.title.length <= 50);
  assert.ok(p.body.length <= 240);
});

test('reportPushPayload falls back when the report text is empty', () => {
  const p = reportPushPayload('   ');
  assert.equal(p.title, 'Aiden posted');
  assert.match(p.body, /Coach chat/i);
});

test('replyPushPayload quotes Aiden without a name prefix', () => {
  const p = replyPushPayload('Get off the stretching mat, princess.');
  assert.equal(p.title, 'Aiden replied');
  assert.equal(p.body, 'Get off the stretching mat, princess.');
});

test('replyPushUserIds is only the humans he just answered', () => {
  const jobs = [
    {
      target: 'report',
      newUser: [{ userId: 'u1', text: 'oi' }, { userId: 'u2', text: 'nah' }]
    },
    {
      target: 'u3_2026-08-16',
      newUser: [{ userId: 'u3', text: 'legs' }]
    }
  ];
  const ids = replyPushUserIds(jobs, { report: 'Settle down.' });
  assert.deepEqual(ids.sort(), ['u1', 'u2']);
});
