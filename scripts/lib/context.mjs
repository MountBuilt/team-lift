// Builds the context file the copywriter skill reads, and validates the copy
// it returns. Pure: no network, no clock.
//
// Aiden threads (2026-07-19): see docs/superpowers/specs/2026-07-19-aiden-threads-design.md
// and js/lib/threads.js. Card parents only on daily refresh; threadReplies for
// hourly banter-back.
import { dailyChallenge, challengeStreak } from '../../js/lib/challenge.js';
import { addDays } from '../../js/lib/dates.js';
import { restDayStatus } from '../../js/lib/banter.js';
import { thisWeekStandings, AIDEN_MSG_MAX, CARD_TARGETS } from '../../js/lib/threads.js';
import { STORYLINES, activeStorylines } from '../storylines.mjs';

const entryView = (e) => {
  const out = { id: e.id, userId: e.userId, name: e.name, date: e.date, updatedAt: e.updatedAt ?? '' };
  if (typeof e.weight === 'number') out.weight = e.weight;
  if (typeof e.steps === 'number') out.steps = e.steps;
  if (Array.isArray(e.workoutParts) && e.workoutParts.length) out.workoutParts = e.workoutParts;
  if (e.dailyChallenge === true) out.dailyChallenge = true;
  return out;
};

const msgView = (m) => ({
  id: m.id,
  kind: m.kind,
  name: m.name ?? (m.kind === 'aiden' ? 'Aiden' : ''),
  text: m.text,
  at: m.at,
  ...(m.deleted ? { deleted: true } : {}),
  ...(m.userId ? { userId: m.userId } : {})
});

/**
 * @param {object} opts
 * @param {string[]} opts.changed - sections to rewrite: weight|steps|workouts|feed
 * @param {object[]} [opts.threadJobs] - from collectThreadJobs
 * @param {boolean} [opts.dailyCardRefresh]
 */
export function buildContext({
  users, entries, banter, challengeStart, changed, morning, evening, today,
  threadJobs = [], dailyCardRefresh = false
}) {
  const challenge = dailyChallenge(today, challengeStart);
  const feedStart = addDays(today, -6);
  const recentStart = addDays(today, -13);
  const feed = banter?.feed ?? {};
  const feedMeta = banter?.feedMeta ?? {};
  const threads = banter?.threads ?? {};

  const feedNeeds = !changed.includes('feed') ? [] : entries
    .filter(e => e.date && e.date >= feedStart)
    .filter(e => !(e.id in feed) || feedMeta[e.id] !== (e.updatedAt ?? ''))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(e => ({ entryId: e.id, ...entryView(e) }));

  const pushFor = (kind) => (u) => {
    const rest = restDayStatus(entries, u.id, today);
    return {
      kind,
      userId: u.id,
      name: u.name,
      streak: challengeStreak(entries, u.id, today),
      emptyDays: rest.emptyDays,
      resting: rest.resting,
      fairGame: rest.fairGame,
      recentDays: entries
        .filter(e => e.userId === u.id && e.date >= recentStart)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map(entryView)
    };
  };

  const thisWeek = thisWeekStandings(entries, users, today);

  // Compact jobs for the copywriter: one reply string per target required.
  const threadWork = threadJobs.map(job => {
    const parent = CARD_TARGETS.includes(job.target)
      ? (banter?.cards?.[job.target] ?? null)
      : (feed[job.target] ?? null);
    const thread = threads[job.target];
    return {
      target: job.target,
      kind: job.kind,
      parent,
      messages: (thread?.messages || []).filter(m => m.deleted !== true).map(msgView),
      newUserMessages: job.newUser.map(msgView),
      deletesToAck: job.deletesToAck.map(m => ({
        id: m.id, name: m.name, note: 'user deleted this after you answered; acknowledge briefly, do not quote it'
      })),
      commentWorthy: job.worthy.map(entryView)
    };
  });

  return {
    today,
    botName: 'Aiden',
    dailyCardRefresh,
    challenge,
    // Precomputed Mon–Sun standings. Card parents MUST use these for session
    // counts — never invent all-time totals from the raw entries dump.
    thisWeek,
    grace: {
      sameDay: 'Today is never a missed, lazy, skipped or rest day. Only roast inactivity on completed days (yesterday and earlier). The evening push is pure encouragement, never a roast for not logging today.',
      restDays: '1-2 consecutive empty completed days is a legit rest day, leave the bloke alone about it. 3 or more in a row is fair game.'
    },
    users: users.map(u => ({ id: u.id, name: u.name })),
    entries: entries.map(entryView),
    sections: [...changed],
    storylines: activeStorylines(STORYLINES, today)
      .map(s => ({ id: s.id, subject: s.subject, until: s.until, note: s.note })),
    currentCards: banter?.cards ?? {},
    history: banter?.history ?? [],
    memory: banter?.memory ?? [],
    feedNeeds,
    currentFeed: feed,
    threadWork,
    pushes: [...morning.map(pushFor('morning')), ...evening.map(pushFor('evening'))]
  };
}

const banned = (text, where, errors) => {
  if (/—/.test(text)) errors.push(`em-dash in ${where}`);
  if (/\bgym\b/i.test(text)) errors.push(`"gym" in ${where} (say workout)`);
};

export function validateCopy(copy, context) {
  const errors = [];
  const cards = copy?.cards ?? {};
  const feed = copy?.feed ?? {};
  const pushes = Array.isArray(copy?.pushes) ? copy.pushes : [];
  const threadReplies = copy?.threadReplies ?? {};

  for (const [k, v] of Object.entries(cards)) {
    if (!context.sections.includes(k)) errors.push(`card "${k}" was not a requested section`);
    if (typeof v !== 'string' || !v.trim() || v.length > 200) errors.push(`card "${k}" empty or over 200 chars`);
    else banned(v, `card "${k}"`, errors);
  }
  for (const s of context.sections) {
    if (s !== 'feed' && !(s in cards)) errors.push(`missing card for section "${s}"`);
  }

  const neededIds = new Set(context.feedNeeds.map(f => f.entryId));
  for (const [id, line] of Object.entries(feed)) {
    if (!neededIds.has(id)) errors.push(`unknown feed entry "${id}"`);
    if (typeof line !== 'string' || !line.trim() || line.length > 240) errors.push(`feed line "${id}" empty or over 240 chars`);
    else banned(line, `feed line "${id}"`, errors);
  }
  for (const id of neededIds) {
    if (!(id in feed)) errors.push(`missing feed line for "${id}"`);
  }

  const wanted = new Map(context.pushes.map(p => [`${p.userId}|${p.kind}`, p]));
  const got = new Set();
  for (const p of pushes) {
    const key = `${p?.userId}|${p?.kind}`;
    if (!wanted.has(key)) { errors.push(`unrequested push ${key}`); continue; }
    got.add(key);
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 50) errors.push(`push ${key} title empty or over 50 chars`);
    else banned(p.title, `push ${key} title`, errors);
    if (typeof p.body !== 'string' || !p.body.trim() || p.body.length > 240) errors.push(`push ${key} body empty or over 240 chars`);
    else banned(p.body, `push ${key} body`, errors);
  }
  for (const key of wanted.keys()) {
    if (!got.has(key)) errors.push(`missing push ${key}`);
  }

  const wantedTargets = new Set((context.threadWork || []).map(t => t.target));
  for (const [target, text] of Object.entries(threadReplies)) {
    if (!wantedTargets.has(target)) errors.push(`unrequested threadReply "${target}"`);
    if (typeof text !== 'string' || !text.trim() || text.length > AIDEN_MSG_MAX) {
      errors.push(`threadReply "${target}" empty or over ${AIDEN_MSG_MAX} chars`);
    } else banned(text, `threadReply "${target}"`, errors);
  }
  for (const target of wantedTargets) {
    if (!(target in threadReplies)) errors.push(`missing threadReply for "${target}"`);
  }

  return { ok: errors.length === 0, errors };
}
