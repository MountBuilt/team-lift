// Aiden's daily morning report: what happened YESTERDAY across weight, the
// daily challenge, workouts and steps. Pure logic only (no Firebase, no DOM).
//
// Replaces the three per-card coach lines (weight/steps/workouts) that used to
// be rewritten at ~3am. One report a day, one comment thread, one beat with a
// through-line. See CLAUDE.md and
// docs/superpowers/specs/2026-07-26-morning-report-design.md
//
// PRIVACY: `weightDelta` is a signed change vs the bloke's previous weigh-in.
// Absolute kg NEVER appears in this summary, so the copywriter physically
// cannot leak it (the old context handed over raw `weight` and Aiden published
// "glued to 80" and "78 down to 75" on the live board).
import { addDays, mondayOf, dayLabel } from './dates.js';
import { weeklyWorkoutCount } from './aggregate.js';
import { challengeStreak } from './challenge.js';
import { pickFrom, stepsComment, workoutsComment, weightComment } from './banter.js';
import { thisWeekStandings } from './threads.js';

/** Signed change vs the most recent weigh-in strictly before `dateStr`, or null. */
export function weightDelta(entries, userId, dateStr) {
  const mine = entries
    .filter(e => e.userId === userId && typeof e.weight === 'number')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const idx = mine.findIndex(e => e.date === dateStr);
  if (idx <= 0) return null;
  return Math.round((mine[idx].weight - mine[idx - 1].weight) * 10) / 10;
}

/**
 * Everything the morning report is allowed to talk about: one completed day.
 * `todayStr` is today; the summary covers yesterday.
 */
export function yesterdaySummary(entries, users, todayStr) {
  const date = addDays(todayStr, -1);
  const dayEntries = entries.filter(e => e.date === date);
  const byUser = new Map(dayEntries.map(e => [e.userId, e]));

  const members = users.map(u => {
    const e = byUser.get(u.id);
    const parts = Array.isArray(e?.workoutParts) ? e.workoutParts : [];
    const steps = typeof e?.steps === 'number' ? e.steps : null;
    const weighedIn = typeof e?.weight === 'number';
    return {
      userId: u.id,
      name: u.name,
      logged: Boolean(e),
      workoutParts: parts,
      steps,
      weighedIn,
      weightDelta: weighedIn ? weightDelta(entries, u.id, date) : null,
      dailyChallenge: e?.dailyChallenge === true,
      challengeStreak: challengeStreak(entries, u.id, date),
      weekWorkouts: weeklyWorkoutCount(entries, u.id, mondayOf(date))
    };
  });

  const silent = members.filter(m => !m.logged).map(m => m.name);
  return {
    date,
    label: dayLabel(date, todayStr),
    members,
    silent,
    loggedCount: members.length - silent.length,
    totalMembers: members.length,
    teamSteps: members.reduce((s, m) => s + (m.steps ?? 0), 0),
    teamWorkouts: members.filter(m => m.workoutParts.length > 0).length,
    challengeTicks: members.filter(m => m.dailyChallenge).length
  };
}

// Offline fallback pool for the logging headline, so a dead tick still reads
// like Aiden rather than a status bar.
const TURNOUT_LINES = {
  all: [
    'Every single one of you on the board yesterday. That is the standard now, do not drop it.',
    'Full house yesterday, not one of you hiding. Back it up today.',
    'Whole squad logged yesterday. Bloody magnificent, keep the run going.'
  ],
  most: [
    'Most of you fronted up yesterday. The rest know who they are.',
    'Good turnout yesterday, a couple still missing in action.',
    'Solid numbers on the board yesterday, few stragglers to round up.'
  ],
  few: [
    'Thin on the board yesterday, boys. Sort it out today.',
    'Barely a pulse yesterday. Someone get the crew moving.',
    'Quiet day yesterday. That is not the standard we set.'
  ]
};

/**
 * Deterministic offline report, used when the AI report is missing or stale
 * (dead cron, first run, Mac asleep). Composes the existing per-section
 * template quips so the voice matches the AI report.
 */
export function templateReport(entries, users, todayStr, challenge = null) {
  const sum = yesterdaySummary(entries, users, todayStr);
  const monday = mondayOf(todayStr);
  const seed = `report|${sum.date}`;

  const ratio = sum.totalMembers === 0 ? 0 : sum.loggedCount / sum.totalMembers;
  const band = ratio === 1 ? 'all' : ratio >= 0.5 ? 'most' : 'few';
  const parts = [`${pickFrom(TURNOUT_LINES[band], seed)}`];

  // Rotate which two of the three sections get a line, so it is not the same
  // shape every morning.
  const sections = [
    () => workoutsComment(entries, users, monday, seed, todayStr),
    () => stepsComment(entries, users, monday, seed, todayStr),
    () => weightComment(entries, users, seed)
  ];
  const start = Math.abs(hash(seed)) % sections.length;
  parts.push(sections[start]());
  parts.push(sections[(start + 1) % sections.length]());

  if (challenge) {
    parts.push(sum.challengeTicks > 0
      ? `${sum.challengeTicks} of you ticked the challenge. Today it is ${challenge.reps} ${challenge.name}.`
      : `Nobody ticked the challenge yesterday. ${challenge.reps} ${challenge.name} today, no excuses.`);
  }
  return parts.filter(Boolean).join(' ');
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The report is usable if it was written for today or yesterday. */
export function reportFresh(report, todayStr) {
  return Boolean(report?.text) && Boolean(report?.day) &&
    addDays(report.day, 1) >= todayStr && report.day <= todayStr;
}

/**
 * Weekly recap is shown for the current week (weekKey === this monday) or
 * last week (weekKey === previous monday) so Mon–Sat still see Sunday's piece.
 */
export function weeklyReportFresh(weekly, todayStr) {
  if (!weekly?.text || !weekly?.weekKey) return false;
  const mon = mondayOf(todayStr);
  return weekly.weekKey === mon || weekly.weekKey === addDays(mon, -7);
}

/**
 * Offline weekly recap when the AI weekly is missing. Week standings only,
 * never absolute kg. Same voice as the other template banter.
 */
export function templateWeeklyReport(entries, users, todayStr) {
  const monday = mondayOf(todayStr);
  const seed = `weekly|${monday}`;
  const week = thisWeekStandings(entries, users, todayStr);
  const parts = [];

  const stepKing = [...week.members].sort((a, b) => b.steps - a.steps || a.name.localeCompare(b.name))[0];
  const workKing = [...week.members].sort((a, b) => b.workouts - a.workouts || a.name.localeCompare(b.name))[0];
  const chalKing = [...week.members].sort((a, b) => b.challengeTicks - a.challengeTicks || a.name.localeCompare(b.name))[0];

  parts.push(pickFrom([
    `Week of ${monday}: the board does not lie.`,
    `Sunday check-in for the week starting ${monday}.`,
    `Weekly wrap, boys. Mon through now on the table.`
  ], seed));

  if (workKing && workKing.workouts > 0) {
    parts.push(`${workKing.name} leads workouts at ${workKing.workouts} days. The rest of you, notes.`);
  } else {
    parts.push('Nobody has a real workout day on the board this week. Embarrassing.');
  }

  if (stepKing && stepKing.steps > 0) {
    parts.push(`${stepKing.name} is carrying steps at ${stepKing.steps.toLocaleString('en-AU')}.`);
  }

  if (chalKing && chalKing.challengeTicks > 0) {
    parts.push(`Challenge iron man: ${chalKing.name} with ${chalKing.challengeTicks} ticks.`);
  }

  const workLine = workoutsComment(entries, users, monday, seed + 'w', todayStr);
  if (workLine) parts.push(workLine);

  parts.push(pickFrom([
    'Finish the week like you mean it.',
    'Still time to fix your standing before Monday. Or not. Your funeral.',
    'One more session changes the story. Or it does not. Your call.'
  ], seed + 'x'));

  return parts.filter(Boolean).join(' ');
}
