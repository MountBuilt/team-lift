// Pure helpers for the banter watcher. No network; easy to unit-test.
//
// Free-tier note: we only *act* when pendingAt advances. Aiden's own writes
// (threadScanAt, threads, memory) still deliver an onSnapshot callback and
// cost 1 listener read each, but we do not spawn a tick for those.

/**
 * Decide whether a banter snapshot should wake a tick.
 *
 * @param {{ pendingAt?: string, prevPendingAt: string, isFirstSnapshot: boolean }} args
 * @returns {{ wake: boolean, reason: string, nextPendingAt: string }}
 */
export function shouldWakeOnBanter({ pendingAt = '', prevPendingAt, isFirstSnapshot }) {
  const next = typeof pendingAt === 'string' ? pendingAt : '';
  if (isFirstSnapshot) {
    // After reboot/restart, one tick catches anything left pending without
    // waiting for the safety timer. Idle probe is two reads if nothing to do.
    return { wake: true, reason: 'startup', nextPendingAt: next };
  }
  if (next && next !== prevPendingAt) {
    return { wake: true, reason: 'pendingAt', nextPendingAt: next };
  }
  return { wake: false, reason: 'noop', nextPendingAt: prevPendingAt };
}

/** Default debounce so a double-tap comment (or comment+log) coalesces. */
export const WAKE_DEBOUNCE_MS = 400;
