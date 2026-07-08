// Over-the-top Aussie gym banter for the feed and dashboard commentary.
// Pure logic: deterministic picks (seeded hash) so output is testable and
// dashboard quips rotate daily instead of flickering on every render.
import { addDays } from './dates.js';

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pickFrom(arr, seed) {
  return arr[hashStr(String(seed)) % arr.length];
}

// ---- Recent activity lines (rendered after the bolded name) ----

export const STRETCH_ROASTS = [
  "did a bit of stretching. Adorable. Get in the squat rack and lift some actual fucking weight, princess.",
  "logged 'stretching' as a workout. Mate. That's a warm-up, not a workout. Pick up a barbell.",
  "had a lovely little stretch. The yoga retreat is that way, sweetheart — the iron is over here.",
  "stretched. Again. Soft as a servo sausage roll. Go move some heavy shit."
];

export const TEN_K_LINES = [
  "claims EXACTLY 10,000 steps. Yeah righto mate, suspiciously round number that one.",
  "logged 10,000 steps on the dot. Sure champ, and I'm the bloody Prime Minister.",
  "hit exactly 10k steps. Not 9,987. Not 10,113. Exactly 10,000. Righto."
];

const WORKOUT_LINES = [
  "absolutely smashed {parts}. Weapon. 💪",
  "punished {parts} like it owed him money.",
  "destroyed {parts}. Get around him, boys!",
  "hit {parts} hard. That's how it's fucking done.",
  "flogged {parts}. Carn the big fella!"
];

const BIG_STEP_LINES = [
  "racked up {steps} steps. Absolute machine.",
  "clocked {steps} steps. Bloke is part greyhound."
];

const STEP_LINES = [
  "got {steps} steps in. Keep 'em coming, legend.",
  "banked {steps} steps. Every step is a middle finger to the couch."
];

const WEIGH_LINES = [
  "fronted the scales. Takes guts to face the truth. Good man.",
  "weighed in. No hiding from the iron truth, and he knows it."
];

const STEP_SUFFIXES = [
  "Chucked {steps} steps on top for good measure.",
  "Plus {steps} steps. Greedy."
];

const WEIGH_SUFFIX = "Faced the scales while he was at it. Full send.";

const hasWorkout = (e) => Array.isArray(e.workoutParts) && e.workoutParts.length > 0;
const stretchOnly = (parts) => parts.length > 0 && parts.every(p => p === 'stretching');
const fmtSteps = (n) => n.toLocaleString('en-AU');

export function feedLine(entry) {
  const seed = `${entry.userId}|${entry.date}|${entry.updatedAt}`;
  const parts = hasWorkout(entry) ? entry.workoutParts : [];
  const pieces = [];

  if (parts.length > 0) {
    pieces.push(stretchOnly(parts)
      ? pickFrom(STRETCH_ROASTS, seed + 'w')
      : pickFrom(WORKOUT_LINES, seed + 'w').replace('{parts}', parts.join(' + ')));
  }
  if (typeof entry.steps === 'number') {
    if (pieces.length === 0) {
      const pool = entry.steps === 10000 ? TEN_K_LINES
        : entry.steps >= 15000 ? BIG_STEP_LINES : STEP_LINES;
      pieces.push(pickFrom(pool, seed + 's').replace('{steps}', fmtSteps(entry.steps)));
    } else {
      pieces.push(entry.steps === 10000
        ? "Also 'exactly' 10,000 steps. Righto."
        : pickFrom(STEP_SUFFIXES, seed + 's').replace('{steps}', fmtSteps(entry.steps)));
    }
  }
  if (typeof entry.weight === 'number') {
    pieces.push(pieces.length === 0 ? pickFrom(WEIGH_LINES, seed + 'k') : WEIGH_SUFFIX);
  }
  return pieces.join(' ') || 'logged... something. Commit to it next time, champ.';
}

// ---- Dashboard card commentary (one line per card, rotates daily) ----

const inWeek = (entries, mondayStr) => {
  const end = addDays(mondayStr, 6);
  return entries.filter(e => e.date >= mondayStr && e.date <= end);
};

export function stepsComment(entries, users, mondayStr, todaySeed) {
  const week = inWeek(entries, mondayStr).filter(e => typeof e.steps === 'number' && e.steps > 0);
  if (week.length === 0) return null;
  const byUser = new Map();
  for (const e of week) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.steps);
  const name = (id) => users.find(u => u.id === id)?.name ?? 'Someone';

  if (byUser.size === 1) {
    const n = name([...byUser.keys()][0]);
    return pickFrom([
      `${n} is absolutely carrying the team here right now. Step it up, boys.`,
      `${n} is out there doing all the walking while the rest of you warm the couch. Pathetic effort, lads.`,
      `One set of legs moving and they belong to ${n}. The rest of you — shoes on, now.`
    ], todaySeed + 'steps1');
  }
  const tenK = week.find(e => e.steps === 10000);
  if (tenK) {
    const n = name(tenK.userId);
    return pickFrom([
      `Yeah sure ${n}, EXACTLY 10k? Very tidy number that, mate.`,
      `${n} logging a perfect 10,000. Round numbers don't lie... except when they do, champ.`
    ], todaySeed + 'steps2');
  }
  const [leadId] = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
  return pickFrom([
    `${name(leadId)} is leading the charge. The rest of you, get walking.`,
    `${name(leadId)} out front and cruising. Chase him down, boys.`
  ], todaySeed + 'steps3');
}

export function workoutsComment(entries, users, mondayStr, todaySeed) {
  const week = inWeek(entries, mondayStr).filter(hasWorkout);
  if (week.length === 0) return null;
  const partsByUser = new Map();
  for (const e of week) {
    partsByUser.set(e.userId, [...(partsByUser.get(e.userId) ?? []), ...e.workoutParts]);
  }
  const stretcher = users.find(u => partsByUser.has(u.id) && stretchOnly(partsByUser.get(u.id)));
  if (stretcher) {
    return pickFrom([
      `${stretcher.name} has only logged stretching. Get in the squat rack and fucking lift some actual weights, you sissy.`,
      `All ${stretcher.name} has trained is 'stretching'. Bend over for the barbell instead, princess — it's called a deadlift.`,
      `${stretcher.name}: stretching is what you do BEFORE the workout, sunshine. Go lift something heavy.`
    ], todaySeed + 'wk1');
  }
  const slackers = users.filter(u => !partsByUser.has(u.id));
  if (slackers.length > 0 && slackers.length < users.length) {
    const names = slackers.map(u => u.name).join(', ');
    return pickFrom([
      `Oi ${names} — the weights aren't gonna lift themselves. Move.`,
      `${names}: zero workouts. Zero. The bar misses you, fellas.`
    ], todaySeed + 'wk2');
  }
  return pickFrom([
    `Every bloke on the board. Bloody beautiful.`,
    `Whole squad training. That's the standard, gents.`
  ], todaySeed + 'wk3');
}

export function weightComment(entries, users, todaySeed) {
  const weighers = new Set(entries.filter(e => typeof e.weight === 'number').map(e => e.userId));
  if (weighers.size !== 1 || users.length < 2) return null;
  const n = users.find(u => u.id === [...weighers][0])?.name ?? 'One bloke';
  return pickFrom([
    `${n} is the only one game enough to face the scales. The rest of you scared of a number?`,
    `Only ${n} has weighed in. Scales don't bite, ladies.`
  ], todaySeed + 'kg1');
}
