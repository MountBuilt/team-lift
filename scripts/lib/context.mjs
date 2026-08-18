// Builds the context object handed to the copywriter, and validates the copy
// it returns. Pure: no network, no clock.
//
// 2026-07-26 rewrite. The old context was 94 KB (~25k tokens) for a job whose
// entire output is a few hundred characters, and roughly two thirds of it was
// duplication: the full all-time `entries` dump, all 110 feed lines ever
// written, and 14 days of per-user `recentDays` that restated `entries`. This
// version hands over precomputed facts only and lands near 6 KB.
//
// It also structurally prevents the absolute-kg leak: no absolute weight is
// ever put in the context, only signed deltas, so Aiden cannot publish "glued
// to 80" even if he wanted to. validateCopy keeps a regex backstop.
import { dailyChallenge, challengeStreak } from '../../js/lib/challenge.js';
import { addDays, mondayOf } from '../../js/lib/dates.js';
import { restDayStatus, displayFeedLine, factualFeedLine, isBigEffort } from '../../js/lib/banter.js';
import { yesterdaySummary, weightDelta } from '../../js/lib/report.js';
import {
  thisWeekStandings, lastWeekStandings, AIDEN_MSG_MAX, FEED_LINE_MAX, REPORT_TARGET, WEEKLY_TARGET,
  memoryWhen
} from '../../js/lib/threads.js';
import { STORYLINES, activeStorylines } from '../storylines.mjs';

export const REPORT_MAX = 700;
export const PUSH_TITLE_MAX = 50;
export const PUSH_BODY_MAX = 240;
export { FEED_LINE_MAX };

/** Entry as the copywriter sees it. NEVER carries absolute weight. */
const entryView = (e, entries) => {
  const out = { id: e.id, name: e.name, date: e.date };
  if (typeof e.steps === 'number') out.steps = e.steps;
  if (Array.isArray(e.workoutParts) && e.workoutParts.length) out.workoutParts = e.workoutParts;
  if (e.dailyChallenge === true) out.dailyChallenge = true;
  if (typeof e.weight === 'number') {
    out.weighedIn = true;
    const d = weightDelta(entries, e.userId, e.date);
    if (d !== null) out.weightDelta = d;
  }
  return out;
};

const msgView = (m) => ({
  kind: m.kind,
  name: m.name ?? (m.kind === 'aiden' ? 'Aiden' : ''),
  text: m.text,
  ...(m.deleted ? { deleted: true } : {})
});

/**
 * Aiden's mood. Picked from the event that woke him (report data, a new log,
 * a new thread, a delete, a push wave) and then held until the next event.
 * Same-thread follow-ups keep it so he does not flip personality mid-chat.
 * Deliberately includes moods that are NOT agreeable.
 */
export const MOODS = [
  { name: 'wired', note: 'Overcaffeinated and loud. Short bursts, exclamations, ready to start something.' },
  { name: 'filthy', note: 'Crass and rude in the change-room register. Lean into the innuendo and the harden-up. This is the mood the crew actually wants, do not soften it.' },
  { name: 'dry', note: 'Deadpan. Understated, one flat brutal observation, no exclamation marks.' },
  { name: 'combative', note: 'Playful disagreement, not a fight. Take the piss, do not concede every point, then land a joke. Never hostile, never "you are wrong" as the whole reply.' },
  { name: 'unhinged', note: 'Go somewhere nobody expected. A tangent, a conspiracy theory, a stupid hypothetical, a grudge about something unrelated. Do not circle back to the stats.' },
  { name: 'sulking', note: 'Wounded and passive aggressive because nobody appreciates you. Be a bit pathetic about it, it is funnier than being tough.' },
  { name: 'grandiose', note: 'You are the greatest coach who ever lived and this crew does not deserve you. Absurd self-importance.' },
  { name: 'conspiratorial', note: 'Pick a bloke and take his side against the others. Gossip, whisper, stir the pot between two of them.' },
  { name: 'bored', note: 'Cannot be arsed. Blunt, brief, faintly insulting about how boring the conversation has got.' },
  { name: 'affectionate', note: 'Weirdly, uncomfortably warm about one of them. Too much. It should make him squirm.' }
];

const moodByName = (name) => MOODS.find(m => m.name === name) || MOODS[2];

const eventTargets = (opts) =>
  [...new Set((opts.threadJobs || []).map(j => j.target).filter(Boolean))];

/** Clock seed kept for tests / fallback hash. Prefer moodFromEvent. */
export function moodFor(seed) {
  const n = Math.abs(Math.trunc(Number(seed) || 0));
  return MOODS[n % MOODS.length];
}

/**
 * Keep the current mood when this tick is only more chat on the same
 * thread(s) that set it. Any new report, log, push wave, or new target
 * is an event and he reacts.
 */
export function shouldRefreshMood(previous, opts = {}) {
  if (!previous?.name) return true;
  if (opts.wantReport || opts.wantWeekly) return true;
  if ((opts.feedLineJobs || []).length) return true;
  if ((opts.morning || []).length || (opts.evening || []).length) return true;
  const targets = eventTargets(opts);
  if (targets.length === 0) return true;
  const held = new Set(previous.targets || []);
  return targets.some(t => !held.has(t));
}

function pickMoodName(opts = {}) {
  const jobs = opts.threadJobs || [];
  if (jobs.some(j => (j.deletesToAck || []).length > 0)) return 'sulking';

  const hasReport = Boolean(opts.wantReport);
  const hasFeed = (opts.feedLineJobs || []).length > 0;
  const hasThread = jobs.length > 0;
  const hasMorning = (opts.morning || []).length > 0;
  const hasEvening = (opts.evening || []).length > 0;

  if (hasEvening && !hasReport && !hasFeed && !hasThread && !hasMorning) {
    return 'affectionate';
  }

  if (hasReport) {
    const y = opts.yesterday || {};
    const total = Number(y.totalMembers) || 0;
    const logged = Number(y.loggedCount) || 0;
    const skipped = opts.challengeYesterday?.skippedAmongLogged || [];
    if (total > 0 && logged === total) return 'wired';
    if (skipped.length >= 2) return 'filthy';
    const silent = Array.isArray(y.silent) ? y.silent.length : (total - logged);
    if (total > 0 && silent >= total / 2) return 'dry';
    if (total > 0 && logged / total < 0.35) return 'bored';
    return 'dry';
  }

  if (hasFeed) {
    if ((opts.feedLineJobs || []).some(e => e.bigEffort === true || isBigEffort(e))) {
      return 'grandiose';
    }
    return 'dry';
  }

  if (hasThread) return chatMoodName(opts);
  if (hasMorning) return 'wired';
  return 'dry';
}

/** Fun locker-room chat moods. Combative is not in the pool. */
const CHAT_MOODS = [
  'filthy', 'wired', 'dry', 'unhinged', 'conspiratorial', 'grandiose', 'affectionate'
];

function chatMoodName(opts) {
  const key = eventTargets(opts).slice().sort().join(',') || 'thread';
  let n = 0;
  for (let i = 0; i < key.length; i++) n = (n + key.charCodeAt(i) * (i + 1)) | 0;
  return CHAT_MOODS[Math.abs(n) % CHAT_MOODS.length];
}

/** Mood that fits this event. Always a member of MOODS plus targets. */
export function moodFromEvent(opts = {}) {
  const picked = moodByName(pickMoodName(opts));
  return {
    name: picked.name,
    note: picked.note,
    targets: eventTargets(opts),
    trigger: [
      opts.wantReport ? 'report' : '',
      (opts.feedLineJobs || []).length ? 'feed' : '',
      eventTargets(opts).length ? `thread:${eventTargets(opts).slice().sort().join(',')}` : '',
      (opts.evening || []).length ? 'evening' : '',
      (opts.morning || []).length ? 'morning' : ''
    ].filter(Boolean).join('|') || 'event'
  };
}

/**
 * Sticky mood: keep previous through same-thread follow-ups, otherwise
 * react to the new event. `sticky: true` tells the prompt he is still in it.
 */
export function resolveMood(previous, opts = {}) {
  if (!shouldRefreshMood(previous, opts)) {
    const held = moodByName(previous.name);
    return {
      name: held.name,
      note: `Still ${held.name}. ${held.note}`,
      targets: [...new Set([...(previous.targets || []), ...eventTargets(opts)])],
      trigger: previous.trigger || '',
      sticky: true
    };
  }
  return moodFromEvent(opts);
}

/**
 * @param {object} opts
 * @param {boolean} opts.wantReport   true on the ~3am daily path
 * @param {boolean} opts.wantWeekly   true Sunday after 03:00 when week recap due
 * @param {object[]} opts.threadJobs  from collectThreadJobs
 * @param {object[]} opts.feedLineJobs entries needing AI feed lines (from collectFeedLineJobs)
 * @param {object[]} opts.morning     users due a morning push
 * @param {object[]} opts.evening     users due an evening push
 * @param {object}   [opts.previousMood] persisted mood from config/banter
 */
export function buildContext({
  users, entries, banter, challengeStart, today,
  wantReport = false, wantWeekly = false, threadJobs = [], feedLineJobs = [],
  morning = [], evening = [], previousMood = null
}) {
  const monday = mondayOf(today);
  const yesterday = addDays(today, -1);
  const loggedOn = (userId, date) =>
    entries.some(e => e.userId === userId && e.date === date);

  const jobs = [];
  if (wantReport) jobs.push('report');
  if (wantWeekly) jobs.push('weeklyReport');
  if (threadJobs.length) jobs.push('threads');
  if (feedLineJobs.length) jobs.push('feedLines');
  if (morning.length || evening.length) jobs.push('pushes');

  const threadWork = threadJobs.map(job => {
    const thread = banter?.threads?.[job.target];
    const entry = entries.find(e => e.id === job.target);
    let parent = null;
    if (job.target === REPORT_TARGET) parent = banter?.report?.text ?? null;
    else if (job.target === WEEKLY_TARGET) parent = banter?.weeklyReport?.text ?? null;
    else if (entry) parent = `${entry.name} ${displayFeedLine(entry, banter)}`;
    const live = (thread?.messages || []).filter(m => m.deleted !== true);
    // How deep this conversation is. Turn 1 is where the stats belong; after
    // that the crew wants a bloke in the chat, not a scoreboard on a loop.
    const aidenTurns = live.filter(m => m.kind === 'aiden').length;
    return {
      target: job.target,
      kind: job.kind,
      parent,
      aidenTurns,
      turnGuidance: aidenTurns === 0
        ? 'Your first reply here. Hook it to the log or the report above, then take it somewhere.'
        : `You have already spoken ${aidenTurns} time(s) in this thread. Do NOT go back to the stats, the workout or the standings. This is now a conversation: react to what the bloke actually said, change the subject, wind him up, tell him about your day, hold a grudge from earlier in the thread. Repeating an earlier beat of yours is the worst thing you can do here.`,
      messages: live.map(msgView),
      newUserMessages: job.newUser.map(msgView),
      deletesToAck: job.deletesToAck.map(m => ({
        name: m.name,
        note: 'user deleted this after you answered; acknowledge briefly, do not quote it'
      })),
      entry: entry ? entryView(entry, entries) : null
    };
  });

  const feedLineWork = (feedLineJobs || []).map(e => ({
    entryId: e.id,
    name: e.name,
    date: e.date,
    facts: entryView(e, entries),
    factualPlaceholder: factualFeedLine(e),
    bigEffort: isBigEffort(e)
  }));

  const pushFor = (kind) => (u) => {
    const rest = restDayStatus(entries, u.id, today);
    const week = thisWeekStandings(entries, users, today).members
      .find(m => m.userId === u.id);
    return {
      kind,
      userId: u.id,
      name: u.name,
      challengeStreak: challengeStreak(entries, u.id, today),
      emptyDays: rest.emptyDays,
      resting: rest.resting,
      fairGame: rest.fairGame,
      loggedYesterday: loggedOn(u.id, yesterday),
      loggedToday: loggedOn(u.id, today),
      week: week ? { workouts: week.workouts, steps: week.steps, challengeTicks: week.challengeTicks } : null
    };
  };

  const todayChallenge = dailyChallenge(today, challengeStart);
  const yDay = addDays(today, -1);
  const yChallenge = dailyChallenge(yDay, challengeStart);
  const ySummary = wantReport ? yesterdaySummary(entries, users, today) : null;
  // Who actually faced yesterday's challenge (logged that day). Silent blokes
  // did not "avoid" the exercise; they simply did not log.
  const yLogged = ySummary ? ySummary.members.filter(m => m.logged) : [];
  const challengeYesterday = wantReport ? {
    ...yChallenge,
    date: yDay,
    ticked: yLogged.filter(m => m.dailyChallenge).map(m => m.name),
    skippedAmongLogged: yLogged.filter(m => !m.dailyChallenge).map(m => m.name)
  } : null;

  const mood = resolveMood(previousMood || banter?.mood, {
    wantReport,
    wantWeekly,
    threadJobs,
    feedLineJobs,
    morning,
    evening,
    yesterday: ySummary,
    challengeYesterday
  });

  return {
    today,
    botName: 'Aiden',
    jobs,
    mood,
    // TODAY's invitation only. Nobody has completed or failed it yet at report
    // time (same-day grace). Do not name anyone as avoiding this exercise.
    challenge: {
      ...todayChallenge,
      note: 'Invitation for everyone today. Nobody has done or skipped it yet. Call it a snack. Never say a bloke avoided, skipped, or failed this snack.'
    },
    // Completed-day snack results. Roast skips only from skippedAmongLogged.
    challengeYesterday,
    reportKind: wantReport && today === mondayOf(today) ? 'week' : 'day',
    // The morning report may ONLY talk about this on Tue-Sun. Monday uses lastWeek.
    yesterday: ySummary,
    thisWeek: thisWeekStandings(entries, users, today),
    lastWeek: lastWeekStandings(entries, users, today),
    grace: {
      sameDay: 'Today is never a missed, lazy, skipped or rest day. The boys have until midnight to log. Only judge inactivity on completed days. The evening push is pure encouragement, never a roast for not logging today.',
      restDays: '1-2 consecutive empty completed days is a legit rest day, leave the bloke alone about it. 3 or more in a row is fair game.',
      challengeToday: 'context.challenge is TODAY only: name the exercise and reps as a pull for everyone. Call it a snack, never a challenge. Never claim anyone avoided, skipped, dodged or failed it. A bloke who has not logged today is not avoiding the snack; the day is not over.',
      challengeYesterday: 'Only challengeYesterday.skippedAmongLogged may be roasted for skipping the snack, and only for YESTERDAY\'s exercise/reps. Silent blokes (yesterday.silent) missed the whole day, not specifically the snack. Do not mix today\'s exercise name with yesterday\'s skips.',
      mondayReport: 'On Monday, reportKind is week. Cover lastWeek (the week that was). Do not write a yesterday-only daily update.'
    },
    users: users.map(u => ({ id: u.id, name: u.name })),
    storylines: activeStorylines(STORYLINES, today)
      .map(s => ({ id: s.id, subject: s.subject, until: s.until, note: s.note })),
    previousReport: banter?.report?.text ?? null,
    reportHistory: (banter?.reportHistory ?? []).slice(-5),
    previousWeeklyReport: banter?.weeklyReport?.text ?? null,
    // Only content-bearing digests. Pre-2026-07-26 entries look like
    // {notes: ["workouts: Simon bantered (2 msgs)"]} — metadata with nothing to
    // call back to. Withhold them rather than hand Aiden noise; they age out of
    // the 14-day window on their own.
    memory: (banter?.memory ?? [])
      .filter(m => Array.isArray(m?.lines) && m.lines.length > 0)
      .map(m => ({ day: m.day, when: memoryWhen(m.day, today), lines: m.lines })),
    threadWork,
    feedLineWork,
    pushes: [...morning.map(pushFor('morning')), ...evening.map(pushFor('evening'))]
  };
}

// ---- validation -----------------------------------------------------------

/**
 * Absolute weights must never reach the board (the team chart deliberately
 * obscures them with coarse ticks and delta-only tooltips, and the banter was
 * undoing that). Deltas are fine: "0.7 kilo drop", "half a kilo". A number of
 * 40+ attached to kg, or a 2-3 digit number sitting next to a scale word, is
 * an absolute and gets rejected.
 */
export function findAbsoluteWeight(text) {
  const unit = /\b(\d{2,3}(?:\.\d+)?)\s*(?:kg|kilo|kilos|kilogram|kilograms)\b/gi;
  for (const m of text.matchAll(unit)) {
    if (Number(m[1]) >= 40) return m[0];
  }
  const nearScales = [
    /\b(?:scales?|weigh(?:s|ed|ing)?|weigh-?in)\b[^.!?]{0,24}?\b(\d{2,3})(?:\.\d+)?\b/i,
    /\b(\d{2,3})(?:\.\d+)?\b[^.!?]{0,24}?\bon the scales\b/i
  ];
  for (const re of nearScales) {
    const m = text.match(re);
    if (m && Number(m[1]) >= 40) return m[0].trim();
  }
  return null;
}

const banned = (text, where, errors) => {
  if (/—/.test(text)) errors.push(`em-dash in ${where}`);
  if (/\bgym\b/i.test(text)) errors.push(`"gym" in ${where} (say workout)`);
  const kg = findAbsoluteWeight(text);
  if (kg) errors.push(`absolute weight "${kg}" in ${where} (deltas only)`);
};

const asString = (v) => (typeof v === 'string' ? v : '');

/**
 * Validate copywriter output against the context that requested it.
 * Shape (arrays, not maps, so it can be a strict JSON schema):
 *   { report?: string,
 *     threadReplies: [{target, text}],
 *     pushes: [{userId, kind, title, body}] }
 */
export function validateCopy(copy, context) {
  const errors = [];
  const wantReport = context.jobs.includes('report');
  const wantWeekly = context.jobs.includes('weeklyReport');

  const report = asString(copy?.report).trim();
  if (wantReport) {
    if (!report) errors.push('missing report');
    else if (report.length > REPORT_MAX) errors.push(`report over ${REPORT_MAX} chars (got ${report.length})`);
    else banned(report, 'report', errors);
  } else if (report) {
    errors.push('report returned but not requested');
  }

  const weeklyReport = asString(copy?.weeklyReport).trim();
  if (wantWeekly) {
    if (!weeklyReport) errors.push('missing weeklyReport');
    else if (weeklyReport.length > REPORT_MAX) {
      errors.push(`weeklyReport over ${REPORT_MAX} chars (got ${weeklyReport.length})`);
    } else banned(weeklyReport, 'weeklyReport', errors);
  } else if (weeklyReport) {
    errors.push('weeklyReport returned but not requested');
  }

  const replies = Array.isArray(copy?.threadReplies) ? copy.threadReplies : [];
  const wantedTargets = new Set((context.threadWork || []).map(t => t.target));
  const gotTargets = new Set();
  for (const r of replies) {
    const target = asString(r?.target);
    const text = asString(r?.text).trim();
    if (!wantedTargets.has(target)) { errors.push(`unrequested threadReply "${target}"`); continue; }
    if (gotTargets.has(target)) { errors.push(`duplicate threadReply "${target}"`); continue; }
    gotTargets.add(target);
    if (!text || text.length > AIDEN_MSG_MAX) {
      errors.push(`threadReply "${target}" empty or over ${AIDEN_MSG_MAX} chars`);
    } else banned(text, `threadReply "${target}"`, errors);
  }
  for (const target of wantedTargets) {
    if (!gotTargets.has(target)) errors.push(`missing threadReply for "${target}"`);
  }

  const pushes = Array.isArray(copy?.pushes) ? copy.pushes : [];
  const wanted = new Map(context.pushes.map(p => [`${p.userId}|${p.kind}`, p]));
  const got = new Set();
  for (const p of pushes) {
    const key = `${p?.userId}|${p?.kind}`;
    if (!wanted.has(key)) { errors.push(`unrequested push ${key}`); continue; }
    got.add(key);
    const title = asString(p.title).trim();
    const body = asString(p.body).trim();
    if (!title || title.length > PUSH_TITLE_MAX) errors.push(`push ${key} title empty or over ${PUSH_TITLE_MAX} chars`);
    else banned(title, `push ${key} title`, errors);
    if (!body || body.length > PUSH_BODY_MAX) errors.push(`push ${key} body empty or over ${PUSH_BODY_MAX} chars`);
    else banned(body, `push ${key} body`, errors);
  }
  for (const key of wanted.keys()) {
    if (!got.has(key)) errors.push(`missing push ${key}`);
  }

  const wantFeed = context.jobs.includes('feedLines');
  const feedOut = Array.isArray(copy?.feedLines) ? copy.feedLines : [];
  const wantedFeedIds = new Set((context.feedLineWork || []).map(f => f.entryId));
  const gotFeedIds = new Set();
  if (wantFeed) {
    for (const row of feedOut) {
      const entryId = asString(row?.entryId);
      const text = asString(row?.text).trim();
      if (!wantedFeedIds.has(entryId)) {
        errors.push(`unrequested feedLine "${entryId}"`);
        continue;
      }
      if (gotFeedIds.has(entryId)) {
        errors.push(`duplicate feedLine "${entryId}"`);
        continue;
      }
      gotFeedIds.add(entryId);
      if (!text || text.length > FEED_LINE_MAX) {
        errors.push(`feedLine "${entryId}" empty or over ${FEED_LINE_MAX} chars`);
      } else banned(text, `feedLine "${entryId}"`, errors);
    }
    for (const id of wantedFeedIds) {
      if (!gotFeedIds.has(id)) errors.push(`missing feedLine for "${id}"`);
    }
  } else if (feedOut.length) {
    errors.push('feedLines returned but not requested');
  }

  return { ok: errors.length === 0, errors };
}

/** Strict-ish JSON schema for structured outputs. Lengths are checked above. */
export function copySchema() {
  return {
    type: 'object',
    properties: {
      report: { type: 'string' },
      weeklyReport: { type: 'string' },
      threadReplies: {
        type: 'array',
        items: {
          type: 'object',
          properties: { target: { type: 'string' }, text: { type: 'string' } },
          required: ['target', 'text'],
          additionalProperties: false
        }
      },
      pushes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            kind: { type: 'string', enum: ['morning', 'evening'] },
            title: { type: 'string' },
            body: { type: 'string' }
          },
          required: ['userId', 'kind', 'title', 'body'],
          additionalProperties: false
        }
      },
      feedLines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            entryId: { type: 'string' },
            text: { type: 'string' }
          },
          required: ['entryId', 'text'],
          additionalProperties: false
        }
      }
    },
    required: ['report', 'weeklyReport', 'threadReplies', 'pushes', 'feedLines'],
    additionalProperties: false
  };
}
