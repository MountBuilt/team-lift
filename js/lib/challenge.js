// Daily challenge: one bodyweight exercise a day, doable in or out of a
// workout, starting easy and ramping with the challenge week. Pure logic:
// the pick is a deterministic function of the date, so every device shows
// the same challenge with no extra backend state. Ticking it off writes
// `dailyChallenge: true` onto that day's entry doc.
import { pickFrom } from './banter.js';
import { addDays, weekNumber } from './dates.js';

export const EXERCISES = [
  { name: 'push ups', base: 10, perWeek: 3 },
  { name: 'air squats', base: 15, perWeek: 5 },
  { name: 'jumping jacks', base: 30, perWeek: 10 },
  { name: 'burpees', base: 8, perWeek: 2 },
  { name: 'high knees', base: 40, perWeek: 10 }
];

// Reps ramp by challenge week (Mon–Sun, from the challenge start date), so
// the same exercise is always harder later on. Pre-start days clamp to
// week 1 so the app stays usable before kickoff.
export function dailyChallenge(dateStr, challengeStartStr) {
  const ex = pickFrom(EXERCISES, `daily|${dateStr}`);
  const week = Math.max(1, weekNumber(dateStr, challengeStartStr));
  return { name: ex.name, reps: ex.base + (week - 1) * ex.perWeek, week };
}

export function challengeDoneOn(entries, dateStr) {
  return entries.filter(e => e.date === dateStr && e.dailyChallenge === true).map(e => e.userId);
}

// Consecutive ticked days ending today. A day still in progress doesn't
// break the chain: done-yesterday-but-not-yet-today still counts the run.
export function challengeStreak(entries, userId, todayStr) {
  const done = new Set(
    entries.filter(e => e.userId === userId && e.dailyChallenge === true).map(e => e.date)
  );
  let day = done.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
