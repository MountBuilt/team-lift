/**
 * Daily challenge: one bodyweight exercise a day, doable in or out of a
 * workout, starting easy and ramping with the challenge week.
 *
 * Pure: the pick is a deterministic function of the date, so every device
 * shows the same challenge with no backend state at all. Ticking it writes
 * `dailyChallenge: true` onto that day's entry.
 *
 * Sledged change from Team Lift: challengeStart comes from the crew doc rather
 * than a single global config, so each crew ramps from its own start date. A
 * solo user with no crew uses their own signup date.
 */
import { pickFrom } from './seeded.js';
import { addDays, weekNumber, type DateStr } from './dates.js';

export type Exercise = { name: string; base: number; perWeek: number };

export const EXERCISES: readonly Exercise[] = [
  { name: 'push ups', base: 10, perWeek: 3 },
  { name: 'air squats', base: 15, perWeek: 5 },
  { name: 'jumping jacks', base: 30, perWeek: 10 },
  { name: 'burpees', base: 8, perWeek: 2 },
  { name: 'high knees', base: 40, perWeek: 10 },
];

export type Challenge = { name: string; reps: number; week: number };

/**
 * Reps ramp by challenge week (Mon-Sun from challengeStart), so the same
 * exercise is always harder later on. Days before the start clamp to week 1 so
 * the app is usable before kickoff.
 */
export function dailyChallenge(dateStr: DateStr, challengeStartStr: DateStr): Challenge {
  const ex = pickFrom(EXERCISES, `daily|${dateStr}`);
  const week = Math.max(1, weekNumber(dateStr, challengeStartStr));
  return { name: ex.name, reps: ex.base + (week - 1) * ex.perWeek, week };
}

type ChallengeEntry = { userId: string; date: DateStr; dailyChallenge?: boolean };

export function challengeDoneOn(entries: ChallengeEntry[], dateStr: DateStr): string[] {
  return entries
    .filter((e) => e.date === dateStr && e.dailyChallenge === true)
    .map((e) => e.userId);
}

/**
 * Consecutive ticked days ending today.
 *
 * A day still in progress does not break the chain: done-yesterday-but-not-
 * yet-today still counts the run. Same-day grace, in streak form.
 */
export function challengeStreak(
  entries: ChallengeEntry[],
  userId: string,
  today: DateStr,
): number {
  const done = new Set(
    entries.filter((e) => e.userId === userId && e.dailyChallenge === true).map((e) => e.date),
  );
  let day = done.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
