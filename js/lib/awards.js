// Client-side weekly awards. No AI, no absolute kg.
import { weeklyWorkoutCount, daysLoggedThisWeek, weeklySteps } from './aggregate.js';
import { addDays } from './dates.js';

/**
 * Pick a winner among users by numeric score. Score 0 or less never wins.
 * Ties: lower name (localeCompare) wins for stability.
 * @returns {{ userId, name, color, value } | null}
 */
function pickWinner(users, scoreOf) {
  let best = null;
  for (const u of users || []) {
    const value = scoreOf(u);
    if (!(value > 0)) continue;
    if (
      !best ||
      value > best.value ||
      (value === best.value && String(u.name).localeCompare(String(best.name)) < 0)
    ) {
      best = { userId: u.id, name: u.name, color: u.color, value };
    }
  }
  return best;
}

function challengeTicks(entries, userId, mondayStr) {
  const end = addDays(mondayStr, 6);
  let n = 0;
  for (const e of entries || []) {
    if (e.userId !== userId || e.date < mondayStr || e.date > end) continue;
    if (e.dailyChallenge === true) n++;
  }
  return n;
}

/**
 * This week's podium categories (Mon–Sun of mondayStr).
 * @returns {{ steps, workouts, challenge, consistency }} each winner or null
 */
export function weeklyAwards(entries, users, mondayStr) {
  return {
    steps: pickWinner(users, u => weeklySteps(entries, u.id, mondayStr)),
    workouts: pickWinner(users, u => weeklyWorkoutCount(entries, u.id, mondayStr)),
    challenge: pickWinner(users, u => challengeTicks(entries, u.id, mondayStr)),
    consistency: pickWinner(users, u => daysLoggedThisWeek(entries, u.id, mondayStr))
  };
}

export const AWARD_LABELS = {
  steps: 'Most steps',
  workouts: 'Most workouts',
  challenge: 'Challenge iron man',
  consistency: 'Most days logged'
};
