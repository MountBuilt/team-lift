// Daily challenge: one bodyweight snack a day, doable in or out of a
// workout. The pick is a deterministic function of the date, so every
// device agrees with no extra backend state. Reps sit in a snack band
// and can go down or up day to day. Ticking it off writes
// `dailyChallenge: true` onto that day's entry doc.
import { pickFrom } from './banter.js';
import { addDays, weekNumber } from './dates.js';

export const EXERCISES = [
  { name: 'push ups', min: 8, max: 15 },
  { name: 'air squats', min: 10, max: 20 },
  { name: 'jumping jacks', min: 20, max: 40 },
  { name: 'burpees', min: 5, max: 10 },
  { name: 'high knees', min: 20, max: 40 }
];

export const TICK_LABELS = [
  'tick',
  'smash it',
  'sort it',
  'knock it',
  'nail it',
  'bag it',
  'hit it',
  'send it',
  'do it',
  'get it done'
];

// Mixed companion card: facts, fuel, and a push. Tagged lines win when the
// day's move has any. Encouraging, not filthy. No em-dashes. Hard cap 120.
export const NUDGE_EYEBROWS = { fact: 'Fact', fuel: 'Fuel', push: 'Push' };

export const NUDGES = [
  { exercise: 'push ups', kind: 'fact', text: 'Eight to fifteen push ups is a coffee-break reset for your chest and the slump from the desk.' },
  { exercise: 'push ups', kind: 'fact', text: 'Push ups load your chest, triceps and core. No kit, no travel, just the floor.' },
  { exercise: 'push ups', kind: 'push', text: 'The floor is right there. Hands down, chest proud, and you own the next hour.' },
  { exercise: 'push ups', kind: 'fuel', text: 'A short set now beats a perfect set you never start. Drop and go.' },
  { exercise: 'air squats', kind: 'fact', text: 'Air squats wake the hips and legs after sitting. Ten honest ones beat another scroll.' },
  { exercise: 'air squats', kind: 'fact', text: 'Sit down, stand up. That is a squat. Your knees and back want the practice.' },
  { exercise: 'air squats', kind: 'push', text: 'Stand up like you mean it. Your legs remember. Let them work.' },
  { exercise: 'air squats', kind: 'fuel', text: 'Every squat is a vote for a stronger week. Cast it now.' },
  { exercise: 'jumping jacks', kind: 'fact', text: 'Jumping jacks light the heart in under a minute. Arms up, bounce, done.' },
  { exercise: 'jumping jacks', kind: 'fact', text: 'A burst of jacks is a blood-flow snack. Better than another coffee.' },
  { exercise: 'jumping jacks', kind: 'push', text: 'Get the heart loud. Twenty seconds and the slump has to leave the room.' },
  { exercise: 'jumping jacks', kind: 'fuel', text: 'Move first, think later. Jacks now, excuses never.' },
  { exercise: 'burpees', kind: 'fact', text: 'A few burpees is a full-body snack, not a session. Keep them tidy and stop.' },
  { exercise: 'burpees', kind: 'fuel', text: 'Burpees earn their hate. That is why a tiny set still feels like a win.' },
  { exercise: 'burpees', kind: 'push', text: 'One ugly burpee still counts. Start ugly. Finish standing.' },
  { exercise: 'burpees', kind: 'fuel', text: 'This snack makes the rest of the day easier. Drop, up, done.' },
  { exercise: 'high knees', kind: 'fact', text: 'High knees are a standing cardio snack. Drive the knees, pump the arms, breathe.' },
  { exercise: 'high knees', kind: 'fact', text: 'Twenty high knees and your heart has clocked on. No track required.' },
  { exercise: 'high knees', kind: 'push', text: 'Drive the knees. You are not a statue. Wake the machine.' },
  { exercise: 'high knees', kind: 'fuel', text: 'Twenty high knees and you already did more than sitting down.' },
  { exercise: null, kind: 'push', text: 'Two minutes now. That is the whole deal.' },
  { exercise: null, kind: 'fuel', text: 'Small reps, done today, beat a heroic plan for Monday.' },
  { exercise: null, kind: 'push', text: 'You have the time. You are reading this.' },
  { exercise: null, kind: 'fuel', text: 'Nobody ever regretted the set they actually did.' }
];

function snackReps(ex, dateStr) {
  const band = [];
  for (let n = ex.min; n <= ex.max; n++) band.push(n);
  return pickFrom(band, `reps|${dateStr}|${ex.name}`);
}

// Snack band only. Challenge week is still returned for context but it
// must not change the reps. Pre-start days clamp week to 1.
export function dailyChallenge(dateStr, challengeStartStr) {
  const ex = pickFrom(EXERCISES, `daily|${dateStr}`);
  const week = Math.max(1, weekNumber(dateStr, challengeStartStr));
  return { name: ex.name, reps: snackReps(ex, dateStr), week };
}

export function challengeTickLabel(dateStr) {
  return pickFrom(TICK_LABELS, `tick|${dateStr}`);
}

export function challengeNudgeCard(dateStr, exerciseName) {
  const tagged = NUDGES.filter(n => n.exercise === exerciseName);
  const pool = tagged.length ? tagged : NUDGES.filter(n => !n.exercise);
  const n = pickFrom(pool, `nudge|${dateStr}|${exerciseName}`);
  return { text: n.text, eyebrow: NUDGE_EYEBROWS[n.kind] || 'Fuel' };
}

export function challengeNudge(dateStr, exerciseName) {
  return challengeNudgeCard(dateStr, exerciseName).text;
}

export function challengeDoneOn(entries, dateStr) {
  return entries.filter(e => e.date === dateStr && e.dailyChallenge === true).map(e => e.userId);
}

/**
 * One line after this user has ticked: who smashed today's snack.
 * Names the ticked crew only. Never who is still outstanding.
 */
export function snackCrewLine(entries, users, dateStr, challenge) {
  if (!challenge) return null;
  const doneIds = new Set(challengeDoneOn(entries, dateStr));
  const done = (users || []).filter(u => doneIds.has(u.id));
  if (done.length === 0) return null;
  const move = `${challenge.reps} ${challenge.name}`;
  const n = done.length;
  const total = (users || []).length;
  if (n === 1) return `${done[0].name} smashed ${move}`;
  if (total > 1 && n === total) return `The lot of you smashed ${move}`;
  const names = done.map(u => u.name);
  if (names.length <= 3) return `${n}/${total} smashed ${move} · ${names.join(', ')}`;
  return `${n}/${total} smashed ${move}`;
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
