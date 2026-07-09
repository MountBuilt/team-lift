// Pure local-date helpers. All dates are "YYYY-MM-DD" strings in device-local
// time; never construct dates from these strings with `new Date(str)` (that
// parses as UTC) — use parseLocal.

export function parseLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, n) {
  const dt = parseLocal(dateStr);
  dt.setDate(dt.getDate() + n);
  return todayStr(dt);
}

export function weekdayIndex(dateStr) {
  return (parseLocal(dateStr).getDay() + 6) % 7; // JS: Sun=0 → Mon=0
}

export function mondayOf(dateStr) {
  return addDays(dateStr, -weekdayIndex(dateStr));
}

export function dateRange(startStr, endStr) {
  const out = [];
  for (let d = startStr; d <= endStr; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekNumber(dateStr, challengeStartStr) {
  const anchor = parseLocal(mondayOf(challengeStartStr));
  const day = parseLocal(mondayOf(dateStr));
  return Math.round((day - anchor) / (7 * 86400000)) + 1;
}

export function totalWeeks(startStr, endStr) {
  return weekNumber(endStr, startStr);
}

export function formatShort(dateStr) {
  const dt = parseLocal(dateStr);
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekdayIndex(dateStr)];
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];
  return `${wd} ${dt.getDate()} ${mo}`;
}

// Human day label relative to today: Today, Yesterday, full weekday name for
// 2..6 days ago, else the short formatted date (also covers future dates).
export function dayLabel(dateStr, todayStr) {
  if (dateStr === todayStr) return 'Today';
  const diffDays = Math.round((parseLocal(todayStr) - parseLocal(dateStr)) / 86400000);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays >= 2 && diffDays <= 6) {
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return names[weekdayIndex(dateStr)];
  }
  return formatShort(dateStr);
}
