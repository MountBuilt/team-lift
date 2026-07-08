// Pure aggregation over entries/users/challenge. No Firebase, no DOM.
import { addDays, dateRange, weekdayIndex, mondayOf } from './dates.js';

const hasWorkout = (entry) => Array.isArray(entry.workoutParts) && entry.workoutParts.length > 0;

export function entriesInWindow(entries, challenge) {
  return entries.filter(e => e.date >= challenge.startDate && e.date <= challenge.endDate);
}

export function weightSeries(entries, users, challenge) {
  const inWin = entriesInWindow(entries, challenge).filter(e => typeof e.weight === 'number');
  return users.map(u => {
    const points = inWin
      .filter(e => e.userId === u.id)
      .sort((a, b) => a.date < b.date ? -1 : 1);
    if (points.length === 0) return null;
    const baseline = points[0].weight;
    return {
      userId: u.id, name: u.name, color: u.color,
      points: points.map(p => ({
        date: p.date,
        pct: Math.round(((p.weight - baseline) / baseline) * 1000) / 10
      }))
    };
  }).filter(Boolean);
}

export function stepsMatrix(entries, users, challenge, todayStr) {
  const end = todayStr < challenge.endDate ? todayStr : challenge.endDate;
  const dates = dateRange(challenge.startDate, end);
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

export function workoutDots(entries, userId, mondayStr) {
  const dots = [false, false, false, false, false, false, false];
  const end = addDays(mondayStr, 6);
  for (const e of entries) {
    if (e.userId === userId && e.date >= mondayStr && e.date <= end && hasWorkout(e)) {
      dots[weekdayIndex(e.date)] = true;
    }
  }
  return dots;
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

export function activityFeed(entries, limit = 12) {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
