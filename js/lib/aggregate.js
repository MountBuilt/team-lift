// Pure aggregation over entries/users/challenge. No Firebase, no DOM.
import { addDays, dateRange, weekdayIndex, dayLabel } from './dates.js';

const hasWorkout = (entry) => Array.isArray(entry.workoutParts) && entry.workoutParts.length > 0;

// Pre-start entries are kept so the app is fully usable before the challenge
// begins; only the end is capped.
export function entriesInWindow(entries, challenge) {
  return entries.filter(e => e.date <= challenge.endDate);
}

// Date span for time-axis charts: from the earliest of challenge start, today,
// and any logged entry, up to today (capped at challenge end). Start is always
// <= end, so dateRange over it is never empty.
export function chartWindow(entries, challenge, todayStr) {
  const end = todayStr < challenge.endDate ? todayStr : challenge.endDate;
  let start = challenge.startDate < end ? challenge.startDate : end;
  for (const e of entries) if (e.date < start) start = e.date;
  return { start, end };
}

export function weightSeries(entries, users, challenge) {
  const inWin = entriesInWindow(entries, challenge).filter(e => typeof e.weight === 'number');
  return users.map(u => {
    const points = inWin
      .filter(e => e.userId === u.id)
      .sort((a, b) => a.date < b.date ? -1 : 1);
    if (points.length === 0) return null;
    return {
      userId: u.id, name: u.name, color: u.color,
      points: points.map(p => ({ date: p.date, kg: p.weight }))
    };
  }).filter(Boolean);
}

export function stepsMatrix(entries, users, challenge, todayStr) {
  const { start, end } = chartWindow(entries, challenge, todayStr);
  const dates = dateRange(start, end);
  const byKey = new Map(entries.map(e => [`${e.userId}_${e.date}`, e]));
  return {
    dates,
    series: users.map(u => ({
      userId: u.id, name: u.name, color: u.color,
      values: dates.map(d => {
        const e = byKey.get(`${u.id}_${d}`);
        return e && typeof e.steps === 'number' ? e.steps : null;
      })
    }))
  };
}

// Explicit y-axis bounds for the team weight chart: 10 kg multiples with at
// least a decade of padding each side. Chart.js autoscaling collapses when
// the data span is under a tick step, so the bounds are always set by us.
export function weightAxisBounds(kgValues) {
  return {
    min: Math.floor(Math.min(...kgValues) / 10) * 10 - 10,
    max: Math.ceil(Math.max(...kgValues) / 10) * 10 + 10
  };
}

// Mon..Sun for one user: { date, parts } per day, merging parts (dedup,
// order-preserved) if more than one entry somehow lands on the same day.
export function workoutWeek(entries, userId, mondayStr) {
  const days = dateRange(mondayStr, addDays(mondayStr, 6)).map(date => ({ date, parts: [] }));
  for (const e of entries) {
    if (e.userId !== userId || e.date < mondayStr || e.date > addDays(mondayStr, 6)) continue;
    if (!Array.isArray(e.workoutParts)) continue;
    const day = days[weekdayIndex(e.date)];
    for (const part of e.workoutParts) {
      if (!day.parts.includes(part)) day.parts.push(part);
    }
  }
  return days;
}

export function workoutDots(entries, userId, mondayStr) {
  return workoutWeek(entries, userId, mondayStr).map(d => d.parts.length > 0);
}

export function weeklyWorkoutCount(entries, userId, mondayStr) {
  return workoutDots(entries, userId, mondayStr).filter(Boolean).length;
}

export function streakWeeks(entries, userId, currentMondayStr) {
  let streak = 0;
  let monday = currentMondayStr;
  if (weeklyWorkoutCount(entries, userId, monday) >= 3) streak++;
  monday = addDays(monday, -7);
  while (weeklyWorkoutCount(entries, userId, monday) >= 3) {
    streak++;
    monday = addDays(monday, -7);
  }
  return streak;
}

export function teamTiles(entries, users, mondayStr) {
  const end = addDays(mondayStr, 6);
  const week = entries.filter(e => e.date >= mondayStr && e.date <= end);
  const totalWorkouts = week.filter(hasWorkout).length;
  const totalSteps = week.reduce((sum, e) => sum + (typeof e.steps === 'number' ? e.steps : 0), 0);
  const membersAt3 = users.filter(u => weeklyWorkoutCount(entries, u.id, mondayStr) >= 3).length;
  return { totalWorkouts, membersAt3, totalMembers: users.length, totalSteps };
}

// Newest `limit` entries by (date DESC, updatedAt DESC), grouped into day
// buckets in that same order. Sorting by date first (not just updatedAt)
// means a backdated entry rises to the top of ITS OWN day, not the whole feed.
export function groupFeedByDay(entries, todayStr, limit = 12) {
  const items = [...entries]
    .sort((a, b) => b.date === a.date ? b.updatedAt - a.updatedAt : (b.date < a.date ? -1 : 1))
    .slice(0, limit);
  const groups = [];
  const byDate = new Map();
  for (const item of items) {
    let group = byDate.get(item.date);
    if (!group) {
      group = { date: item.date, label: dayLabel(item.date, todayStr), items: [] };
      byDate.set(item.date, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
