// Exit codes the tick wrapper uses for local backoff.
// 429/402 used to leave pendingAt hot, so the 30s timer full-fetched the
// roster until Spark quota died and Aiden went silent for a day.

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_FIRESTORE_QUOTA = 2;
export const EXIT_COPY_BALANCE = 3;

export function exitCodeForError(err) {
  const m = String(err?.message || err || '');
  if (/HTTP 429|RESOURCE_EXHAUSTED|Quota exceeded/i.test(m)) return EXIT_FIRESTORE_QUOTA;
  if (/402|balance exhausted|usage balance|Payment Required/i.test(m)) {
    return EXIT_COPY_BALANCE;
  }
  return EXIT_FAIL;
}

/** Seconds to sit out after this exit before the next probe. */
export function backoffSecondsForExit(code) {
  if (code === EXIT_FIRESTORE_QUOTA || code === EXIT_COPY_BALANCE) return 3600;
  if (code === EXIT_FAIL) return 300;
  return 0;
}
