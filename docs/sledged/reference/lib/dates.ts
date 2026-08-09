/**
 * Pure local-date helpers.
 *
 * All dates in Sledged are "YYYY-MM-DD" strings in device-local time.
 *
 * NEVER construct a Date from one of these with `new Date(str)` — that parses
 * as UTC and shifts the day for anyone west of Greenwich, which is everyone
 * using this app. Use parseLocal.
 */

export type DateStr = string; // YYYY-MM-DD

export function parseLocal(dateStr: DateStr): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr(now: Date = new Date()): DateStr {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: DateStr, n: number): DateStr {
  const dt = parseLocal(dateStr);
  dt.setDate(dt.getDate() + n);
  return todayStr(dt);
}

/** JS getDay() is Sun=0; weeks here run Mon-Sun, so Mon=0. */
export function weekdayIndex(dateStr: DateStr): number {
  return (parseLocal(dateStr).getDay() + 6) % 7;
}

export function mondayOf(dateStr: DateStr): DateStr {
  return addDays(dateStr, -weekdayIndex(dateStr));
}

export function dateRange(startStr: DateStr, endStr: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = startStr; d <= endStr; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 1-based week number relative to the crew's challengeStart. */
export function weekNumber(dateStr: DateStr, challengeStartStr: DateStr): number {
  const anchor = parseLocal(mondayOf(challengeStartStr));
  const day = parseLocal(mondayOf(dateStr));
  return Math.round((day.getTime() - anchor.getTime()) / (7 * 86400000)) + 1;
}

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatShort(dateStr: DateStr): string {
  const dt = parseLocal(dateStr);
  return `${WEEKDAYS_SHORT[weekdayIndex(dateStr)]} ${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
}

/** How many days back the log sheet's day picker offers. */
export const DAY_CHOICES = 3;

/**
 * Options for the log sheet's day picker: today, yesterday, the day before.
 *
 * There is deliberately no calendar input. A whole date picker to choose
 * between three realistic answers is worse on a phone, and nobody backfills
 * further than two days.
 *
 * If the sheet was opened to edit something older (from Me), that day is
 * appended so the current selection is always representable.
 */
export function dayOptions(
  selectedDate?: DateStr | null,
  today: DateStr = todayStr(),
): { date: DateStr; label: string }[] {
  const opts: { date: DateStr; label: string }[] = [];
  for (let i = 0; i < DAY_CHOICES; i++) {
    const date = addDays(today, -i);
    opts.push({ date, label: dayLabel(date, today) });
  }
  if (selectedDate && !opts.some((o) => o.date === selectedDate)) {
    opts.push({ date: selectedDate, label: formatShort(selectedDate) });
  }
  return opts;
}

/**
 * Human day label relative to today: Today, Yesterday, the weekday name for
 * 2-6 days ago, else the short date (which also covers future dates).
 */
export function dayLabel(dateStr: DateStr, today: DateStr): string {
  if (dateStr === today) return 'Today';
  const diffDays = Math.round(
    (parseLocal(today).getTime() - parseLocal(dateStr).getTime()) / 86400000,
  );
  if (diffDays === 1) return 'Yesterday';
  if (diffDays >= 2 && diffDays <= 6) return WEEKDAYS_LONG[weekdayIndex(dateStr)];
  return formatShort(dateStr);
}
