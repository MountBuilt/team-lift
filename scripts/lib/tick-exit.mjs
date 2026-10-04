// Exit codes the tick wrapper uses for local backoff.
// A failed tick must not full-fetch users+entries on the 2 min timer.
// Measured 2026-10-01: a copy failure every 5 min read ~2,800 docs/hour and
// spent the 50k Spark cap by afternoon, so Aiden went silent until midnight
// Pacific. Quota errors now wait for that reset. Other failures wait 30 min,
// which keeps a broken model under the cap even if it fails all day.

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_FIRESTORE_QUOTA = 2;
export const EXIT_COPY_BALANCE = 3;

/** Spark free-tier document quotas reset at midnight Pacific. */
export const QUOTA_RESET_TZ = 'America/Los_Angeles';
/** A generic failure (copy rejected, grok crash) sits out this long. */
export const FAIL_BACKOFF_SECONDS = 30 * 60;
/** Grok 402 is not the Firestore cap. Hourly is enough. */
export const BALANCE_BACKOFF_SECONDS = 60 * 60;

export function exitCodeForError(err) {
  const m = String(err?.message || err || '');
  if (/HTTP 429|RESOURCE_EXHAUSTED|Quota exceeded/i.test(m)) return EXIT_FIRESTORE_QUOTA;
  if (/402|balance exhausted|usage balance|Payment Required/i.test(m)) {
    return EXIT_COPY_BALANCE;
  }
  return EXIT_FAIL;
}

function tzParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const bag = {};
  for (const p of dtf.formatToParts(date)) bag[p.type] = p.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second)
  };
}

/** UTC instant of midnight on the given calendar date in `timeZone`. */
function zonedMidnightUtc(year, month, day, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const got = tzParts(new Date(utcGuess), timeZone);
  const asUTC = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
  return new Date(utcGuess - (asUTC - utcGuess));
}

/**
 * Next Spark daily reset strictly after `now`. The 2 min safety timer is the
 * alarm: backoff_until is this instant, and the next tick after it runs.
 */
export function nextQuotaReset(now = new Date()) {
  const p = tzParts(now, QUOTA_RESET_TZ);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedMidnightUtc(
    next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), QUOTA_RESET_TZ
  );
}

/** Seconds to sit out after this exit before the next probe. */
export function backoffSecondsForExit(code, now = new Date()) {
  if (code === EXIT_FIRESTORE_QUOTA) {
    const ms = nextQuotaReset(now).getTime() - now.getTime();
    return Math.max(60, Math.ceil(ms / 1000));
  }
  if (code === EXIT_COPY_BALANCE) return BALANCE_BACKOFF_SECONDS;
  if (code === EXIT_FAIL) return FAIL_BACKOFF_SECONDS;
  return 0;
}
