// Peer reactions on feed entries. Pure logic only.
// Shape on the entry doc: reactions: { [userId]: emoji }
// Written via FieldPath per user so concurrent reacts don't clobber.

export const REACTION_EMOJIS = ['🔥', '💀', '👏', '😂'];

export function userReaction(reactions, userId) {
  const em = reactions?.[userId];
  return REACTION_EMOJIS.includes(em) ? em : null;
}

/** Counts per emoji in the fixed set. */
export function reactionCounts(reactions) {
  const counts = Object.fromEntries(REACTION_EMOJIS.map(e => [e, 0]));
  for (const em of Object.values(reactions || {})) {
    if (Object.prototype.hasOwnProperty.call(counts, em)) counts[em]++;
  }
  return counts;
}

/**
 * Toggle: same emoji again clears; different emoji switches; new adds.
 * Returns a fresh map (does not mutate).
 */
export function toggleUserReaction(reactions, userId, emoji) {
  if (!REACTION_EMOJIS.includes(emoji) || !userId) {
    return { ...(reactions || {}) };
  }
  const next = { ...(reactions || {}) };
  if (next[userId] === emoji) delete next[userId];
  else next[userId] = emoji;
  return next;
}
