// Shared name filter for the merged weight + steps card.
// null means every name is on (the default).

export function toggleTrendVisible(visibleIds, tappedId, allIds) {
  const allOn = visibleIds == null || visibleIds.length === allIds.length;
  if (allOn) return [tappedId];
  const next = new Set(visibleIds);
  if (next.has(tappedId)) next.delete(tappedId);
  else next.add(tappedId);
  if (next.size === 0) return null;
  return [...next];
}

export function trendNameOn(visibleIds, id) {
  if (visibleIds == null) return true;
  return visibleIds.includes(id);
}
