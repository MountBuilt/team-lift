// Pure helpers for the one-time install + push coach mark (Phase 3).
// UI persists dismiss in localStorage under PUSH_COACH_KEY.

export const PUSH_COACH_KEY = 'tl_push_coach_dismissed';

/**
 * One-time card: Add to Home Screen → Me → notifications.
 * Quiet once dismissed or when push is already enabled.
 * Show after first log, or when the push APIs are available (installed PWA)
 * but notifications are still off.
 */
export function shouldShowPushCoach({
  dismissed = false,
  pushEnabled = false,
  everLogged = false,
  pushSupported = false
} = {}) {
  if (dismissed || pushEnabled) return false;
  return everLogged || pushSupported;
}
