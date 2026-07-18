// Pure decisions for the hourly tick: which banter sections changed and which
// pushes are due. No network, no clock reads; callers pass `now` and `today`.
import { createHash } from 'node:crypto';
import { addDays } from '../../js/lib/dates.js';
import { STORYLINES, activeStorylines } from '../storylines.mjs';

export const MORNING_AFTER = '07:30';
export const MORNING_CUTOFF = '20:30'; // a fully missed morning is skipped, never sent at night
export const EVENING_AFTER = '20:30';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

// Section hashing, ported from the retired python block in
// refresh-banter.sh: hash exactly the data each dashboard section reads, and
// fold the (id, name) roster into every hash so a new member or a rename
// invalidates all four.
export function computeHashes(users, entries, today) {
  const usersKey = users
    .map(u => [u.id, u.name ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // Fold the ACTIVE storylines into every hash the same way the roster is, so
  // adding a storyline or one expiring forces the cards to regenerate on the
  // next tick instead of waiting for entry data to change.
  const storyKey = activeStorylines(STORYLINES, today)
    .map(s => [s.id, s.subject, s.until])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const feedStart = addDays(today, -6);

  const weight = [], steps = [], workouts = [], feed = [];
  for (const e of entries) {
    if (typeof e.weight === 'number') weight.push([e.userId, e.date, e.weight]);
    if (typeof e.steps === 'number') steps.push([e.userId, e.date, e.steps]);
    if (Array.isArray(e.workoutParts) && e.workoutParts.length) {
      workouts.push([e.userId, e.date, e.workoutParts]);
    }
    if (e.date && e.date >= feedStart) feed.push([e.id, e.updatedAt ?? '']);
  }
  const byUserDate = (a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1);
  weight.sort(byUserDate); steps.sort(byUserDate); workouts.sort(byUserDate); feed.sort(byUserDate);

  const hash = (rows) =>
    createHash('sha256').update(JSON.stringify([usersKey, storyKey, rows])).digest('hex');
  return { weight: hash(weight), steps: hash(steps), workouts: hash(workouts), feed: hash(feed) };
}

export function changedSections(computed, stored) {
  return ['weight', 'steps', 'workouts', 'feed']
    .filter(k => computed[k] !== (stored?.[k] ?? ''));
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
