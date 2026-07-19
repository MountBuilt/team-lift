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

// Feed badge for monster days. Deterministic per entry so it stays stable
// across re-renders; vary the wording so "BIG EFFORT" is not every row.
export const EFFORT_LABELS = [
  'BIG EFFORT',
  'HUGE',
  'MASSIVE',
  'UNIT',
  'LEGEND',
  'WEAPON',
  'ANIMAL',
  'KING SLAYER',
  'BEAST',
  'MACHINE',
  'ABSOLUTE UNIT'
];

/** Monster step day, multi-part session, or workout + challenge same day. */
export function isBigEffort(entry) {
  if (!entry) return false;
  const parts = Array.isArray(entry.workoutParts) ? entry.workoutParts.length : 0;
  return (typeof entry.steps === 'number' && entry.steps >= 15000)
    || parts >= 3
    || (parts > 0 && entry.dailyChallenge === true);
}

/** Stable badge text for a big-effort feed row. */
export function effortLabel(entry) {
  const seed = `${entry?.id || entry?.userId || ''}|${entry?.date || ''}|effort`;
  return pickFrom(EFFORT_LABELS, seed);
}

// AI-written banter from config/banter beats the template pool while it's
// fresh (written today or yesterday); after that the templates take over so
// a dead cron job never leaves week-old quips on the board.
export function banterFresh(banter, todayStr) {
  return Boolean(banter?.date) && addDays(banter.date, 1) >= todayStr && banter.date <= todayStr;
}

// ---- Same-day grace + rest days -------------------------------------------
//
// TWO grace rules the whole banter system must obey:
//
// 1. SAME-DAY GRACE: today is NEVER a missed / lazy / skipped / rest day. The
//    boys get until the end of the day to log, so every "you did nothing"
//    judgement is made only on COMPLETED days (yesterday and earlier). Today
//    only ever earns praise, never a roast for inactivity. In the dashboard
//    cards this means "who skipped" is computed off completed days, and the
//    lazy branches stay silent on a day that has no completed day behind it.
// 2. REST DAYS: a day with nothing logged at all is a day off. 1 or 2
//    consecutive empty COMPLETED days is legit rest - leave the bloke alone.
//    3 or more in a row is fair game.
//
// Both live here as pure helpers so the offline templates, the copywriter
// guidance, and the push context all apply the exact same rule.

// A bloke "logged something" on a day if any real field is present.
export const hasAnyLog = (e) =>
  typeof e.weight === 'number' ||
  (typeof e.steps === 'number' && e.steps > 0) ||
  (Array.isArray(e.workoutParts) && e.workoutParts.length > 0) ||
  e.dailyChallenge === true;

export const REST_GRACE_DAYS = 2; // 1-2 empty completed days = legit rest
const EMPTY_LOOKBACK = 30;        // cap the walk-back so a fresh member terminates

// Consecutive empty COMPLETED days ending yesterday. Today is graced: it never
// counts, because the day isn't over. Returns 0 when the bloke logged
// something yesterday (he's active, no rest to speak of).
export function emptyDayStreak(entries, userId, todayStr) {
  const logged = new Set(
    entries.filter(e => e.userId === userId && hasAnyLog(e)).map(e => e.date)
  );
  let day = addDays(todayStr, -1); // start at yesterday; today is graced
  let streak = 0;
  while (!logged.has(day) && streak < EMPTY_LOOKBACK) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

// Classify a bloke's recent inactivity. `resting` = leave him alone (1-2 empty
// completed days). `fairGame` = pile on (3+). `active` = logged yesterday.
export function restDayStatus(entries, userId, todayStr) {
  const emptyDays = emptyDayStreak(entries, userId, todayStr);
  return {
    emptyDays,
    active: emptyDays === 0,
    resting: emptyDays >= 1 && emptyDays <= REST_GRACE_DAYS,
    fairGame: emptyDays >= 3
  };
}

// ---- Tradie nicknames, assigned strictly by behaviour (never randomly) ----
//
// A nickname is NEVER a bare tag ("Sam's a Show Bag"). The nickname alone
// isn't the joke — the `punchline` explaining the joke is the joke, and an
// optional `nudge` lands a call to action on the group. See
// .claude/skills/copywriter/SKILL.md for the full authored table this
// is drawn from.
//
// Which CANDIDATE from a pool gets used can rotate day to day (via
// pickFrom), but which POOL applies is always determined by what the data
// actually shows — a bloke on a streak must never wear a roast nickname.
const N = {
  blister: { name: 'blister', punchline: 'only turns up once the hard sets are already done', nudge: "Don't let him waltz in just for the cooldown or the leaderboard flex." },
  brakePad: { name: 'brake pad', punchline: 'wears out after two rounds then starts squealing', nudge: 'Someone give him a push before he grinds the whole session to a halt.' },
  caneToad: { name: 'cane toad', punchline: 'sits straight down the second he stops and goes nowhere', nudge: "Get him back up lads, we're not finished yet." },
  cordless: { name: 'cordless', punchline: 'charges all rest day then goes flat again after fifteen minutes', nudge: 'Someone plug him back in.' },
  deckChair: { name: 'deck chair', punchline: 'folds straight under pressure the second the weight goes up', nudge: 'Stand him back up and get another round out of him.' },
  devondale: { name: 'Devondale', punchline: 'only ever grabs the cream jobs and leaves the hard stuff for everyone else', nudge: 'Time to share the load, mate.' },
  englishFog: { name: 'English fog', punchline: "won't lift a thing this morning", nudge: 'Someone give it a shove and see if it clears.' },
  gSpot: { name: 'G-Spot', punchline: 'never around when the tough sets or the early sessions drop', nudge: 'Hard to find when you actually need him.' },
  grenade: { name: 'grenade', punchline: "feels like we're all just waiting for him to pull the pin", nudge: 'Steady on, lads.' },
  harveyNorman: { name: 'Harvey Norman', punchline: 'weeks of no interest and now he wants the top spot', nudge: "Too late mate, interest's due." },
  mastercard: { name: 'Mastercard', punchline: "always taking credit for the spotter's work or the group's average", nudge: 'Do your own lifting next time.' },
  muffler: { name: 'muffler', punchline: 'already exhausted and making noise about it', nudge: 'Rest later, finish the set now.' },
  noodles: { name: 'noodles', punchline: "thought that finisher would take two minutes and it's been twelve", nudge: 'Get under a barbell properly next time.' },
  paperStraw: { name: 'paper straw', punchline: 'works hard for a while but never lasts long enough', nudge: "Let's see if we can get a bit more out of him this round." },
  pothole: { name: 'pothole', punchline: 'sits right in the middle of the road slowing the whole group down', nudge: 'Either fill it with effort or get out of the way.' },
  seaweed: { name: 'seaweed', punchline: 'floats around doing fuck all and stinking up the group average', nudge: 'Either start swimming or get washed out.' },
  sensorLight: { name: 'sensor light', punchline: 'only starts logging reps once the leaderboard updates or someone walks past', nudge: "Works fine when it's being watched." },
  showBag: { name: 'show bag', punchline: 'full of shit excuses for the missed sessions and weak numbers', nudge: 'Less talk, more lift.' },
  slinky: { name: 'slinky', punchline: 'good for fuck all except watching him tumble down the leaderboard', nudge: 'Fun to push though.' },
  trapdoor: { name: 'trapdoor', punchline: "grabs everyone for a yarn while the timer's running", nudge: 'Shut it and get back to work, lads.' },
  wheelbarrow: { name: 'wheelbarrow', punchline: 'only works when pushed', nudge: 'Get behind him and give him a shove on that last set.' },
  wicketKeeper: { name: 'wicket-keeper', punchline: 'puts the gloves on for the workout then stands around doing not much', nudge: 'Get stuck in mate.' },
  tenMmSocket: { name: '10 mm socket', punchline: 'never around when you actually need him for the hard sets or the early sessions', nudge: '' },
  twoStroke: { name: '2-stroke', punchline: 'hard to get going and smoking excuses halfway through', nudge: 'Either fire up properly or choke on it.' },
  rod: { name: 'Rod', punchline: 'retired on duty. Shows up, does the bare minimum and collects the leaderboard points', nudge: 'Someone give him a reason to actually work.' },
  seagull: { name: 'seagull', punchline: 'flies in, makes a mess of the session, then leaves the rest of us to clean it up', nudge: 'Either do it properly or stay on the beach.' },
  breakTimeBarry: { name: 'Break Time Barry', punchline: 'somehow always on smoko when the rest of us are mid-set', nudge: 'Get off the bench and back in the game.' },
  foremanOfWatching: { name: 'Foreman of Watching', punchline: "stands around supervising everyone else's form without touching a weight", nudge: 'Either get stuck in or shut it.' },
  snipersNightmare: { name: "sniper's nightmare", punchline: 'hard to pin down on consistency and even harder to hit with any real effort', nudge: 'Someone take the shot and get him moving.' },
  milkCarton: { name: 'milk carton', punchline: 'been missing so long his face belongs on the side of one', nudge: 'Someone phone it in if you spot him.' },
  yogaMat: { name: 'yoga mat', punchline: 'gets rolled out for a stretch then packed straight back in the cupboard', nudge: 'Unroll a barbell instead, mate.' },
  servoPie: { name: 'servo pie', punchline: 'looks the goods for about a minute then falls apart in your hands', nudge: 'Hold together for one more round.' },
  handbrake: { name: 'handbrake', punchline: 'left on the whole trip, dragging the team average down the road', nudge: 'Release it and let the group roll.' },
  phantom: { name: 'phantom', punchline: 'never once turned up on the scales, no numbers, no proof he was ever here', nudge: 'Materialise on the scales, mate.' },
  screenDoor: { name: 'screen door', punchline: 'swinging in the breeze doing bugger all while the work piles up', nudge: 'Latch on and get stuck in.' },
  // ---- compliments (the only nicknames that can land on a bloke showing up) ----
  olympicTorch: { name: 'Olympic Torch', punchline: 'never goes out', nudge: 'Absolute machine, keep it lit.', compliment: true },
  freightTrain: { name: 'freight train', punchline: 'just keeps rolling and nothing on the board is slowing him down', nudge: 'Get on or get out the way.', compliment: true },
  lighthouse: { name: 'lighthouse', punchline: 'stands there every single day showing the rest of you where the work is', nudge: 'Follow the light, boys.', compliment: true }
};

export const NICKNAMES = {
  zeroWorkouts: [N.sensorLight, N.gSpot, N.tenMmSocket, N.snipersNightmare, N.harveyNorman, N.breakTimeBarry, N.rod, N.milkCarton, N.screenDoor],
  stretchOnly: [N.noodles, N.wicketKeeper, N.foremanOfWatching, N.englishFog, N.devondale, N.rod, N.blister, N.yogaMat],
  tenK: [N.showBag, N.mastercard],
  neverWeighed: [N.gSpot, N.tenMmSocket, N.snipersNightmare, N.showBag, N.phantom],
  inconsistent: [N.paperStraw, N.cordless, N.twoStroke, N.brakePad, N.deckChair, N.caneToad, N.muffler, N.servoPie],
  wheelbarrow: [N.wheelbarrow],
  trailingTeam: [N.pothole, N.seaweed, N.slinky, N.harveyNorman, N.handbrake],
  neverMisses: [N.olympicTorch, N.freightTrain, N.lighthouse]
};

// ---- Observational-simile composer ----
//
// Shape: (name ->) framing verb -> nickname -> the punchline that explains
// the joke -> usually a short call to action. Framing verbs rotate so two
// lines in the same render never lean on the same one.
//
// `subject` is either a person's name (for a standalone sentence, e.g. a
// dashboard card) or omitted/null to continue a sentence that already named
// the person elsewhere (e.g. the bolded name in a feed row).
// Nicknames don't all take the same article: "a wheelbarrow" but "an Olympic
// Torch", "the Foreman of Watching", and bare "noodles" / "Harvey Norman".
// Everything not listed takes "a".
const NO_ARTICLE = new Set(['noodles', 'seaweed', 'Harvey Norman', 'Break Time Barry']);
const AN_ARTICLE = new Set(['English fog', 'Olympic Torch']);
const THE_ARTICLE = new Set(['Foreman of Watching']);

function articleFor(name) {
  if (NO_ARTICLE.has(name)) return '';
  if (AN_ARTICLE.has(name)) return 'an';
  if (THE_ARTICLE.has(name)) return 'the';
  return 'a';
}

const withArticle = (art, name) => (art ? `${art} ${name}` : name);

// `ok(article, compliment)` keeps a framing verb away from nicknames it can't
// agree with — "has gone full Foreman of Watching" and "is a proper noodles"
// are both wrong — and away from the one compliment when the verb implies
// faking it: "pulling an Olympic Torch" reads as an accusation, not praise.
const FRAMING_VERBS = [
  { ok: () => true,
    standalone: (n, a, k) => `${n} is being ${withArticle(a, k)}`,
    continuation: (a, k) => `He's being ${withArticle(a, k)}` },
  { ok: () => true,
    standalone: (n, a, k) => `${n} is back to being ${withArticle(a, k)}`,
    continuation: (a, k) => `He's back to being ${withArticle(a, k)}` },
  { ok: (a) => a !== 'the',
    standalone: (n, a, k) => `${n} has gone full ${k}`,
    continuation: (a, k) => `He's gone full ${k}` },
  { ok: (a, c) => a !== 'the' && !c,
    standalone: (n, a, k) => `${n} seems like he's gone ${k}`,
    continuation: (a, k) => `Seems like he's gone ${k}` },
  { ok: (a, c) => (a === 'a' || a === 'an') && !c,
    standalone: (n, a, k) => `${n} is pulling ${a} ${k}`,
    continuation: (a, k) => `He's pulling ${a} ${k}` },
  { ok: (a) => a === 'a',
    standalone: (n, a, k) => `${n} is a proper ${k}`,
    continuation: (a, k) => `He's a proper ${k}` }
];

const allowedFrames = (art, compliment) =>
  FRAMING_VERBS.reduce((ids, f, i) => (f.ok(art, compliment) ? [...ids, i] : ids), []);

// Returns an index into FRAMING_VERBS that agrees with this nickname's
// article, avoiding `avoidIdx` so two lines in one card never echo each other.
function framingIndex(seed, nick, avoidIdx = -1) {
  const allowed = allowedFrames(articleFor(nick.name), Boolean(nick.compliment));
  let k = hashStr(String(seed)) % allowed.length;
  if (allowed[k] === avoidIdx && allowed.length > 1) k = (k + 1) % allowed.length;
  return allowed[k];
}

// Roughly one card in two gets a nickname at all — a card with no nickname
// is fine, and often funnier. Never let a nickname show up in every comment.
function nicknameGate(seed) {
  return hashStr(`${seed}|nickgate`) % 2 === 0;
}

// The actual joke: name/continuation + framing verb + nickname + the
// punchline that explains it + an optional call to action. Never a bare tag.
export function nicknameLine(nick, framingIdx, subject = null) {
  const verb = FRAMING_VERBS[framingIdx];
  const art = articleFor(nick.name);
  const lead = subject
    ? verb.standalone(subject, art, nick.name)
    : verb.continuation(art, nick.name);
  const nudge = nick.nudge ? ` ${nick.nudge}` : '';
  return `${lead} - ${nick.punchline}.${nudge}`;
}

// Seeded convenience: pick a nickname from `pool`, gate it on a coin-flip,
// and compose a standalone (named) observational line. Returns null when
// the gate misses, so callers can fall back to a plain line.
function maybeNicknameLine(seed, pool, person, avoidIdx = -1) {
  if (!nicknameGate(seed)) return null;
  const nick = pickFrom(pool, seed + 'nick' + person.id);
  const idx = framingIndex(seed + 'verb' + person.id, nick, avoidIdx);
  return { text: nicknameLine(nick, idx, person.name), idx };
}

// ---- Recent activity lines (rendered after the bolded name) ----
// These are continuations of a sentence that already named the person (the
// UI bolds the name before this text), so nickname lines here use the
// pronoun-based continuation form, not a repeated name.

const STRETCH_PLAIN = [
  "did a bit of stretching. Adorable. Get in the squat rack and lift some actual fucking weight, princess.",
  "logged 'stretching' as a workout. Mate. That's a warm-up, not a workout. Pick up a barbell.",
  "had a lovely little stretch. The yoga retreat is that way, sweetheart. The iron is over here.",
  "stretched. Again. Soft as a servo sausage roll. Go move some heavy shit.",
  "called that a workout? The squat rack's still there, champ. Stretching doesn't count.",
  "logged a stretch and nothing else. The bar's still loaded from yesterday, mate.",
  "clocked off after a stretch. Big day planned, or just allergic to the barbell?",
  "touched his toes and called it training. Pilates class is down the hall, sunshine.",
  "reached for the sky and nothing else. The dumbbells are on the floor for a reason, mate.",
  "had a stretch. Groundbreaking. The bar's not gonna spot itself, princess."
];

const STRETCH_LEAD_INS = [
  'stretched again.',
  "logged 'stretching' as the whole session.",
  'called that a workout.',
  'had a cheeky stretch and nothing else.',
  'stretched and clocked off.',
  'did the stretch, skipped the work.',
  'ticked the box with a stretch.'
];

export const STRETCH_ROASTS = [
  ...STRETCH_PLAIN,
  ...NICKNAMES.stretchOnly.map((nick, i) =>
    `${STRETCH_LEAD_INS[i % STRETCH_LEAD_INS.length]} ${nicknameLine(nick, framingIndex(`stretch${i}`, nick))}`)
];

const TEN_K_PLAIN = [
  "claims EXACTLY 10,000 steps. Yeah righto mate, suspiciously round number that one.",
  "logged 10,000 steps on the dot. Sure champ, and I'm the bloody Prime Minister.",
  "hit exactly 10k steps. Not 9,987. Not 10,113. Exactly 10,000. Righto."
];

const TEN_K_LEAD_INS = [
  'logged a suspiciously perfect 10,000 steps.',
  'hit exactly 10k on the dot.'
];

export const TEN_K_LINES = [
  ...TEN_K_PLAIN,
  ...NICKNAMES.tenK.map((nick, i) =>
    `${TEN_K_LEAD_INS[i % TEN_K_LEAD_INS.length]} ${nicknameLine(nick, framingIndex(`tenk${i}`, nick))}`)
];

const WORKOUT_LINES = [
  "absolutely smashed {parts}. Weapon. 💪",
  "punished {parts} like it owed him money.",
  "destroyed {parts}. Get around him, boys!",
  "hit {parts} hard. That's how it's fucking done.",
  "flogged {parts}. Carn the big fella!",
  "put {parts} through the wringer. The bar's still shaking.",
  "took {parts} out the back and dealt with it. Ruthless.",
  "went to war with {parts} and came home the winner.",
  "made {parts} his personal problem today. Sorted.",
  "battered {parts}. Someone check the equipment's still bolted down.",
  "gave {parts} the full treatment. No survivors."
];

const BIG_STEP_LINES = [
  "racked up {steps} steps. Absolute machine.",
  "clocked {steps} steps. Bloke is part greyhound.",
  "walked {steps} steps. Did he take a wrong turn to Bendigo?",
  "banked {steps} steps. The couch has filed a missing persons report.",
  "put up {steps} steps. Legs like a bloody postie."
];

const STEP_LINES = [
  "got {steps} steps in. Keep 'em coming, legend.",
  "banked {steps} steps. Every step is a middle finger to the couch.",
  "notched {steps} steps. Small wins stack up, keep marching.",
  "logged {steps} steps. That's {steps} more than the blokes still in bed.",
  "put {steps} steps on the board. Onwards, soldier."
];

const WEIGH_LINES = [
  "fronted the scales. Takes guts to face the truth. Good man.",
  "weighed in. No hiding from the iron truth, and he knows it.",
  "stepped on the scales like a man. Respect for facing the number.",
  "faced the scales head on. That's more than half of you can say."
];

const STEP_SUFFIXES = [
  "Chucked {steps} steps on top for good measure.",
  "Plus {steps} steps. Greedy.",
  "And {steps} steps to finish. Show off.",
  "Topped it with {steps} steps. Bloke doesn't sit down."
];

const WEIGH_SUFFIX = "Faced the scales while he was at it. Full send.";

// Daily challenge feed lines. Solo lines carry the whole sentence; suffixes
// tack onto a day that already logged something else.
const CHALLENGE_SOLO_LINES = [
  "knocked over the daily challenge. Tick. Easiest win of the day, boys.",
  "got the daily challenge done. No excuses, just reps.",
  "smashed the daily challenge before half of you even opened the app. Standard set.",
  "banked the daily challenge. Loungeroom floor counts, champ. Reps are reps.",
  "ticked the daily challenge. Simple as. The rest of you are running out of daylight.",
  "did the daily challenge without a fuss. Take notes, fellas."
];

const CHALLENGE_SUFFIXES = [
  "Daily challenge ticked too. Greedy bugger.",
  "And the daily challenge on top. Full marks today.",
  "Daily challenge done as well. No notes.",
  "Squeezed the daily challenge in too. Overachiever.",
  "Challenge ticked on top of it. Absolute glutton for it."
];

// Rotating one-liner under the dashboard challenge card, seeded by date.
export const CHALLENGE_QUIPS = [
  "In the workout or on the loungeroom floor. Reps are reps.",
  "Takes two minutes, champ. Your excuses take longer.",
  "No barbell needed. No excuses accepted.",
  "Knock it over before smoko or cop it in the feed.",
  "Do it now, brag about it all day. That's the deal.",
  "Two minutes of reps or a whole day of the boys chirping you. Your call.",
  "The floor's right there. So are your excuses. Only one of them helps."
];

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
  if (entry.dailyChallenge === true) {
    pieces.push(pieces.length === 0
      ? pickFrom(CHALLENGE_SOLO_LINES, seed + 'c')
      : pickFrom(CHALLENGE_SUFFIXES, seed + 'c'));
  }
  return pieces.join(' ') || 'logged... something. Commit to it next time, champ.';
}

// ---- Dashboard card commentary (one line per card, rotates daily) ----
//
// `todaySeed` seeds the daily rotation. `todayStr` is the actual local date;
// it defaults to `todaySeed` because in the live app the seed IS today's date
// (see js/ui/dashboard.js), and it is what enforces SAME-DAY GRACE: today is
// never counted as a skipped/lazy day here. Tests that vary the seed for RNG
// coverage pass a real date as `todayStr` so the grace maths stay meaningful.

const inWeek = (entries, mondayStr) => {
  const end = addDays(mondayStr, 6);
  return entries.filter(e => e.date >= mondayStr && e.date <= end);
};

export function stepsComment(entries, users, mondayStr, todaySeed, todayStr = todaySeed) {
  const week = inWeek(entries, mondayStr).filter(e => typeof e.steps === 'number' && e.steps > 0);
  if (week.length === 0) return null;
  // Same-day grace: there is only something to roast the couch-warmers about
  // once at least one completed day has gone by this week.
  const hasCompletedDay = todayStr > mondayStr;
  const byUser = new Map();
  for (const e of week) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.steps);
  const name = (id) => users.find(u => u.id === id)?.name ?? 'Someone';

  if (byUser.size === 1) {
    const n = name([...byUser.keys()][0]);
    if (!hasCompletedDay) {
      // First day of the week: nobody has "missed" anything yet, so this is
      // encouragement, not a spray.
      return pickFrom([
        `${n} first on the board this week. Good start, now who's chasing him?`,
        `${n} out of the blocks early. Get moving and make him work for it, boys.`
      ], todaySeed + 'steps1a');
    }
    return pickFrom([
      `${n} is absolutely carrying the team here right now. Step it up, boys.`,
      `${n} is out there doing all the walking while the rest of you warm the couch. Pathetic effort, lads.`,
      `One set of legs moving and they belong to ${n}. The rest of you: shoes on, now.`,
      `${n} is a one-man walking club this week. The rest of you have forgotten you own legs.`
    ], todaySeed + 'steps1');
  }
  const tenK = week.find(e => e.steps === 10000);
  if (tenK) {
    const n = name(tenK.userId);
    return pickFrom([
      `Yeah sure ${n}, EXACTLY 10k? Very tidy number that, mate.`,
      `${n} logging a perfect 10,000. Round numbers don't lie... except when they do, champ.`,
      `${n} rocks up with a spotless 10,000. Not 9,999, not 10,001. Pull the other one.`
    ], todaySeed + 'steps2');
  }
  // Head-to-head: if the top two are within a nose of each other, call the race.
  const sorted = [...byUser.entries()].sort((a, b) => b[1] - a[1]);
  const [leadId, leadSteps] = sorted[0];
  if (sorted.length >= 2) {
    const [secondId, secondSteps] = sorted[1];
    if (leadSteps > 0 && (leadSteps - secondSteps) / leadSteps <= 0.1) {
      return pickFrom([
        `${name(leadId)} and ${name(secondId)} are neck and neck on steps. Someone put a foot down and settle it.`,
        `Two-horse race up top: ${name(leadId)} just shading ${name(secondId)}. Winner takes the bragging rights.`
      ], todaySeed + 'steps4');
    }
  }
  return pickFrom([
    `${name(leadId)} is leading the charge. The rest of you, get walking.`,
    `${name(leadId)} out front and cruising. Chase him down, boys.`,
    `${name(leadId)} setting the pace on steps. Reel him in before Sunday.`
  ], todaySeed + 'steps3');
}

export function workoutsComment(entries, users, mondayStr, todaySeed, todayStr = todaySeed) {
  const week = inWeek(entries, mondayStr).filter(hasWorkout);
  if (week.length === 0) return null;
  // Positive aggregation counts everything logged this week, today included.
  const partsByUser = new Map();
  for (const e of week) {
    partsByUser.set(e.userId, [...(partsByUser.get(e.userId) ?? []), ...e.workoutParts]);
  }
  const stretcher = users.find(u => partsByUser.has(u.id) && stretchOnly(partsByUser.get(u.id)));
  if (stretcher) {
    return pickFrom([
      `${stretcher.name} has only logged stretching. Get in the squat rack and fucking lift some actual weights, you sissy.`,
      `All ${stretcher.name} has trained is 'stretching'. Bend over for the barbell instead, princess. It's called a deadlift.`,
      `${stretcher.name}: stretching is what you do BEFORE the workout, sunshine. Go lift something heavy.`
    ], todaySeed + 'wk1');
  }

  // Same-day grace + rest-day grace: a bloke is only a "slacker" if he skipped
  // COMPLETED days (today isn't over), and we leave alone anyone taking a
  // legit 1-2 day rest. A bloke who logged other stuff but no workout (empty
  // streak 0) or who's been AWOL 3+ days is fair game.
  const doneWeek = week.filter(e => e.date < todayStr);
  const trainedOnDone = new Set(doneWeek.map(e => e.userId));
  const slackers = users.filter(u => !trainedOnDone.has(u.id));
  const roastable = slackers.filter(u => !restDayStatus(entries, u.id, todayStr).resting);
  if (doneWeek.length > 0 && trainedOnDone.size > 0 && roastable.length > 0) {
    const names = roastable.map(u => u.name).join(', ');
    const base = pickFrom([
      `Oi ${names}, the weights aren't gonna lift themselves. Move.`,
      `${names}: zero workouts on the completed days. The bar misses you, fellas.`,
      `${names} still owe the barbell a session this week. Clock's ticking.`
    ], todaySeed + 'wk2');

    // Nickname assigned by behaviour: this bloke skipped his completed
    // training days, full stop — never picked from any other pool. Gated: not
    // every card gets a nickname.
    const tagged = roastable[0];
    const roast = maybeNicknameLine(todaySeed + 'wk2', NICKNAMES.zeroWorkouts, tagged);
    return roast ? `${base} ${roast.text}` : base;
  }

  // Nobody worth roasting: everyone trained, or the only ones who haven't are
  // on a legit rest. Celebrate it, and single out the standouts.
  const daysByUser = new Map();
  for (const e of week) daysByUser.set(e.userId, (daysByUser.get(e.userId) ?? 0) + 1);
  const ranked = [...daysByUser.entries()].sort((a, b) => b[1] - a[1]);

  // Head-to-head rivalry: top two blokes level on training days this week.
  if (ranked.length >= 2 && ranked[0][1] === ranked[1][1] && ranked[0][1] >= 2) {
    const a = users.find(u => u.id === ranked[0][0]);
    const b = users.find(u => u.id === ranked[1][0]);
    if (a && b) {
      return pickFrom([
        `${a.name} and ${b.name} both on ${ranked[0][1]} sessions this week. Dead heat, one of you break the tie.`,
        `Neck and neck: ${a.name} and ${b.name} matching each other session for session. Winner earns the week.`
      ], todaySeed + 'wkrival');
    }
  }

  const praise = pickFrom([
    `Every bloke on the board. Bloody beautiful.`,
    `Whole squad training. That's the standard, gents.`,
    `Not a single bludger this week. Get around each other, boys.`
  ], todaySeed + 'wk3');
  const torch = users.find(u => u.id === ranked[0]?.[0]);
  if (!torch) return praise;
  // The one kind of nickname that can land on a bloke actually showing up.
  const torchLine = maybeNicknameLine(todaySeed + 'wk3torch', NICKNAMES.neverMisses, torch);
  return torchLine ? `${praise} ${torchLine.text}` : praise;
}

export function weightComment(entries, users, todaySeed) {
  if (users.length < 2) return null;
  const weighers = new Set(entries.filter(e => typeof e.weight === 'number').map(e => e.userId));
  const nonWeighers = users.filter(u => !weighers.has(u.id));

  if (weighers.size === 0) {
    // Nobody has weighed in at all — everyone qualifies for a "never
    // weighed in" nickname; rotate who gets showcased day to day.
    const target = pickFrom(users, todaySeed + 'kg0');
    const nick = maybeNicknameLine(todaySeed + 'kg0', NICKNAMES.neverWeighed, target);
    if (nick) {
      return pickFrom([
        `Not one of you has faced the scales yet. ${nick.text}`,
        `Zero weigh-ins on the board. ${nick.text}`
      ], todaySeed + 'kg0');
    }
    return pickFrom([
      `Not one of you has faced the scales yet. Get on the bloody scales.`,
      `Zero weigh-ins on the board. Someone front up.`
    ], todaySeed + 'kg0');
  }

  if (weighers.size === 1) {
    const n = users.find(u => u.id === [...weighers][0])?.name ?? 'One bloke';
    return pickFrom([
      `${n} is the only one game enough to face the scales. The rest of you scared of a number?`,
      `Only ${n} has weighed in. Scales don't bite, ladies.`,
      `${n} fronted the scales solo. The other blokes are hiding behind theirs like it's a spider.`
    ], todaySeed + 'kg1');
  }

  if (nonWeighers.length > 0) {
    // Most of the team has weighed in but a few are trailing — that's a
    // "dragging the team average" nickname, not a "never weighed in" one.
    const laggard = pickFrom(nonWeighers, todaySeed + 'kg2');
    const names = nonWeighers.map(u => u.name).join(', ');
    const nick = maybeNicknameLine(todaySeed + 'kg2', NICKNAMES.trailingTeam, laggard);
    if (nick) {
      return pickFrom([
        `Everyone's fronted the scales except ${names}. ${nick.text}`,
        `${names} still haven't weighed in. ${nick.text}`
      ], todaySeed + 'kg2');
    }
    return pickFrom([
      `Everyone's fronted the scales except ${names}. Catch up, lads.`,
      `${names} still haven't weighed in. Scales are waiting.`
    ], todaySeed + 'kg2');
  }

  return null; // everyone's weighed in — nothing to roast here
}
