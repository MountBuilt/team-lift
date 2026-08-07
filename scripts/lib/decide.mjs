// Pure decisions for the tick: is there any work, and which pushes are due.
// No network, no clock reads; callers pass `now` and `today`.
//
// 2026-07-26: section-hash machinery gone. Report is time-driven (after 03:00).
// Feed lines are AI again (2026-08-07) but jobs are found after full fetch when
// poke/stale-scan already woke the tick — probe stays 2-doc cheap.
import { needsDailyReport, needsWeeklyReport } from '../../js/lib/threads.js';

export const MORNING_AFTER = '07:30';
export const MORNING_CUTOFF = '20:30'; // a fully missed morning is skipped, never sent at night
export const EVENING_AFTER = '20:30';
/** Force a full scan at least this often even if `pendingAt` never moves, so a
 *  client that fails to stamp it cannot silently stall Aiden forever. */
export const STALE_SCAN_MINUTES = 30;

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const minutesSince = (iso, now) => {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 60000 : Infinity;
};

/**
 * Cheap probe: given only the two small config docs, decide whether this tick
 * needs to fetch users+entries at all. An idle tick costs 2 document reads and
 * zero writes, which is what lets the job run every 60s instead of hourly.
 */
export function probeWork({ banter, pushState, now, today }) {
  const t = hhmm(now);
  const wantReport = needsDailyReport(banter?.reportDay, today, now);
  const wantWeekly = needsWeeklyReport(banter?.weeklyReport?.weekKey, today, now);

  const pendingAt = banter?.pendingAt ?? '';
  const scanAt = banter?.threadScanAt ?? '';
  const unseenComment = Boolean(pendingAt) && pendingAt > scanAt;
  const scanStale = minutesSince(scanAt, now) >= STALE_SCAN_MINUTES;
  const threadsPossible = unseenComment || scanStale;

  const morningUnsent = (pushState?.lastMorning ?? '') !== today;
  const eveningUnsent = (pushState?.lastEvening ?? '') !== today;
  const morningDue = morningUnsent && t >= MORNING_AFTER && t < MORNING_CUTOFF;
  const skipMorning = morningUnsent && t >= MORNING_CUTOFF;
  const eveningDue = eveningUnsent && t >= EVENING_AFTER;

  return {
    wantReport,
    wantWeekly,
    threadsPossible,
    unseenComment,
    scanStale,
    morningDue,
    eveningDue,
    skipMorning,
    needsFullFetch: wantReport || wantWeekly || threadsPossible || morningDue || eveningDue || skipMorning
  };
}

export function decidePushWork({ users, entries, pushState, now, today }) {
  const t = hhmm(now);
  const enabled = users.filter(u => u.push?.enabled === true && u.push.endpoint);
  const morningUnsent = (pushState?.lastMorning ?? '') !== today;
  const eveningUnsent = (pushState?.lastEvening ?? '') !== today;

  const morningDue = morningUnsent && t >= MORNING_AFTER && t < MORNING_CUTOFF;
  const skipMorning = morningUnsent && t >= MORNING_CUTOFF;
  const eveningDue = eveningUnsent && t >= EVENING_AFTER;

  let evening = [];
  if (eveningDue) {
    const loggedToday = new Set(entries.filter(e => e.date === today).map(e => e.userId));
    evening = enabled.filter(u => !loggedToday.has(u.id));
  }
  return {
    morningDue, eveningDue, skipMorning,
    morning: morningDue ? enabled : [],
    evening
  };
}
