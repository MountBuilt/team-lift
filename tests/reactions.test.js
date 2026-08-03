import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REACTION_EMOJIS,
  userReaction,
  reactionCounts,
  toggleUserReaction
} from '../js/lib/reactions.js';

test('REACTION_EMOJIS is the fixed set', () => {
  assert.deepEqual(REACTION_EMOJIS, ['🔥', '💀', '👏', '😂']);
});

test('toggleUserReaction adds, switches, and clears', () => {
  let r = toggleUserReaction({}, 'u1', '🔥');
  assert.deepEqual(r, { u1: '🔥' });
  r = toggleUserReaction(r, 'u2', '💀');
  assert.deepEqual(r, { u1: '🔥', u2: '💀' });
  r = toggleUserReaction(r, 'u1', '👏'); // switch
  assert.deepEqual(r, { u1: '👏', u2: '💀' });
  r = toggleUserReaction(r, 'u1', '👏'); // clear same
  assert.deepEqual(r, { u2: '💀' });
});

test('userReaction and reactionCounts', () => {
  const r = { u1: '🔥', u2: '🔥', u3: '😂' };
  assert.equal(userReaction(r, 'u1'), '🔥');
  assert.equal(userReaction(r, 'nobody'), null);
  assert.deepEqual(reactionCounts(r), { '🔥': 2, '💀': 0, '👏': 0, '😂': 1 });
});

test('ignores unknown emoji values in counts', () => {
  assert.deepEqual(reactionCounts({ u1: 'x' }), { '🔥': 0, '💀': 0, '👏': 0, '😂': 0 });
});
