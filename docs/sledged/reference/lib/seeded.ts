/**
 * Deterministic seeded picks.
 *
 * Used so the daily challenge is the same on every device with no backend
 * state, and so any rotating label stays stable across re-renders instead of
 * flickering.
 *
 * This is all that survives from Team Lift's js/lib/banter.js. The stacked
 * template banter that lived alongside it is deliberately gone: feed lines are
 * AI now, and the template stack read as robotic.
 */

/** djb2. Stable across platforms, which matters because clients and Cloud
 *  Functions must agree on the same pick for the same seed. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pickFrom<T>(arr: readonly T[], seed: string | number): T {
  return arr[hashStr(String(seed)) % arr.length];
}
