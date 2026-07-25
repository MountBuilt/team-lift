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
import { restDayStatus, feedLine } from '../../js/lib/banter.js';
import { yesterdaySummary, weightDelta } from '../../js/lib/report.js';
import { thisWeekStandings, AIDEN_MSG_MAX, REPORT_TARGET } from '../../js/lib/threads.js';
import { STORYLINES, activeStorylines } from '../storylines.mjs';

export const REPORT_MAX = 700;
export const PUSH_TITLE_MAX = 50;
export const PUSH_BODY_MAX = 240;

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
 * @param {object} opts
 * @param {boolean} opts.wantReport   true on the ~3am daily path
 * @param {object[]} opts.threadJobs  from collectThreadJobs
 * @param {object[]} opts.morning     users due a morning push
 * @param {object[]} opts.evening     users due an evening push
 */
export function buildContext({
  users, entries, banter, challengeStart, today,
  wantReport = false, threadJobs = [], morning = [], evening = []
}) {
  const monday = mondayOf(today);
  const yesterday = addDays(today, -1);
  const loggedOn = (userId, date) =>
    entries.some(e => e.userId === userId && e.date === date);

  const jobs = [];
  if (wantReport) jobs.push('report');
  if (threadJobs.length) jobs.push('threads');
  if (morning.length || evening.length) jobs.push('pushes');

  const threadWork = threadJobs.map(job => {
    const thread = banter?.threads?.[job.target];
    const entry = entries.find(e => e.id === job.target);
    const parent = job.target === REPORT_TARGET
      ? (banter?.report?.text ?? null)
      : (entry ? `${entry.name} ${feedLine(entry)}` : null);
    return {
      target: job.target,
      kind: job.kind,
      parent,
      messages: (thread?.messages || []).filter(m => m.deleted !== true).map(msgView),
      newUserMessages: job.newUser.map(msgView),
      deletesToAck: job.deletesToAck.map(m => ({
        name: m.name,
        note: 'user deleted this after you answered; acknowledge briefly, do not quote it'
      })),
      entry: entry ? entryView(entry, entries) : null
    };
  });

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

  return {
    today,
    botName: 'Aiden',
    jobs,
    challenge: dailyChallenge(today, challengeStart),
    // The morning report may ONLY talk about this. It is a completed day, so
    // roasting inactivity here is fair game (same-day grace does not apply).
    yesterday: wantReport ? yesterdaySummary(entries, users, today) : null,
    thisWeek: thisWeekStandings(entries, users, today),
    grace: {
      sameDay: 'Today is never a missed, lazy, skipped or rest day. The boys have until midnight to log. Only judge inactivity on completed days. The evening push is pure encouragement, never a roast for not logging today.',
      restDays: '1-2 consecutive empty completed days is a legit rest day, leave the bloke alone about it. 3 or more in a row is fair game.'
    },
    users: users.map(u => ({ id: u.id, name: u.name })),
    storylines: activeStorylines(STORYLINES, today)
      .map(s => ({ id: s.id, subject: s.subject, until: s.until, note: s.note })),
    previousReport: banter?.report?.text ?? null,
    reportHistory: (banter?.reportHistory ?? []).slice(-5),
    // Only content-bearing digests. Pre-2026-07-26 entries look like
    // {notes: ["workouts: Simon bantered (2 msgs)"]} — metadata with nothing to
    // call back to. Withhold them rather than hand Aiden noise; they age out of
    // the 14-day window on their own.
    memory: (banter?.memory ?? []).filter(m => Array.isArray(m?.lines) && m.lines.length > 0),
    threadWork,
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

  const report = asString(copy?.report).trim();
  if (wantReport) {
    if (!report) errors.push('missing report');
    else if (report.length > REPORT_MAX) errors.push(`report over ${REPORT_MAX} chars (got ${report.length})`);
    else banned(report, 'report', errors);
  } else if (report) {
    errors.push('report returned but not requested');
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

  return { ok: errors.length === 0, errors };
}

/** Strict-ish JSON schema for structured outputs. Lengths are checked above. */
export function copySchema() {
  return {
    type: 'object',
    properties: {
      report: { type: 'string' },
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
      }
    },
    required: ['report', 'threadReplies', 'pushes'],
    additionalProperties: false
  };
}
