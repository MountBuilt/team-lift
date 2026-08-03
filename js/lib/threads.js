// Aiden threads + the daily morning report. Pure logic only (no Firebase, no DOM).
// Spec: docs/superpowers/specs/2026-07-26-morning-report-design.md
//
// 2026-07-26 rework (Claude/Opus 5). Read this before changing thread behaviour:
//
// * The three card parents (weight/steps/workouts) are GONE. One `report`
//   parent replaces them, rewritten once a day on the ~3am path. Crew banter
//   hangs off that single thread plus per-entry feed threads.
// * Feed parent lines are now LOCAL TEMPLATES (js/lib/banter.js feedLine),
//   written instantly by the client with no AI call and never rewritten.
// * Because the feed parent is no longer Aiden's voice, Aiden reacting under a
//   feed line is no longer double-talk, so proactive feed comments are back ON
//   (they were disabled 2026-07-19 for exactly that reason). The old re-fire
//   bug is fixed structurally: proactive fires only when a thread has NO Aiden
//   message at all, so re-editing an entry can never re-trigger it.
import { addDays, mondayOf, weekdayIndex } from './dates.js';
import { weeklyWorkoutCount } from './aggregate.js';
import { isBigEffort } from './banter.js';

/** Card-style parents (not feed entry ids). Kept as an array so callers stay generic. */
export const REPORT_TARGET = 'report';
/** Sunday weekly recap parent (Phase 4.3). */
export const WEEKLY_TARGET = 'weekly';
export const CARD_TARGETS = [REPORT_TARGET, WEEKLY_TARGET];

export const USER_MSG_MAX = 160;
export const AIDEN_MSG_MAX = 240;
export const FEED_THREAD_MAX_AGE_DAYS = 3;
export const MEMORY_KEEP = 14;
/** Local HH:MM — first tick at or after this with reportDay !== today writes it. */
export const DAILY_REPORT_AFTER = '03:00';

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** True when the morning report is due (self-heals on first tick after wake). */
export function needsDailyReport(reportDay, today, now) {
  if (reportDay === today) return false;
  return hhmm(now) >= DAILY_REPORT_AFTER;
}

/**
 * Sunday weekly recap due after 03:00 when we have not yet written for this
 * week's monday key. Self-heals if the host slept through Sunday morning.
 * weekdayIndex Sunday === 6 (Mon=0).
 */
export function needsWeeklyReport(weeklyWeekKey, today, now) {
  if (weekdayIndex(today) !== 6) return false;
  if (hhmm(now) < DAILY_REPORT_AFTER) return false;
  return weeklyWeekKey !== mondayOf(today);
}

/** Messages shown in the UI (soft-deleted hidden). */
export function visibleMessages(thread) {
  return (thread?.messages || []).filter(m => m && m.deleted !== true);
}

export function commentCount(thread) {
  return visibleMessages(thread).length;
}

/**
 * Mon–Sun standings the report must use for session counts (not all-time).
 * workouts = days with a non-empty workoutParts this week.
 */
export function thisWeekStandings(entries, users, todayStr) {
  const monday = mondayOf(todayStr);
  const end = addDays(monday, 6);
  const weekEntries = entries.filter(e => e.date >= monday && e.date <= end);
  const members = users.map(u => {
    const mine = weekEntries.filter(e => e.userId === u.id);
    const steps = mine.reduce((s, e) => s + (typeof e.steps === 'number' ? e.steps : 0), 0);
    const challengeTicks = mine.filter(e => e.dailyChallenge === true).length;
    const workouts = weeklyWorkoutCount(entries, u.id, monday);
    return { userId: u.id, name: u.name, workouts, steps, challengeTicks };
  });
  return {
    monday,
    end,
    members,
    teamWorkouts: members.reduce((s, m) => s + m.workouts, 0),
    teamSteps: members.reduce((s, m) => s + m.steps, 0),
    membersAt3: members.filter(m => m.workouts >= 3).length
  };
}

/**
 * Aligns with the feed "BIG EFFORT" badge (delegated to isBigEffort so the two
 * can never drift), plus a first weigh-in and the week's third workout day.
 */
export function isCommentWorthy(entry, entries, mondayStr) {
  if (!entry) return false;
  const parts = Array.isArray(entry.workoutParts) ? entry.workoutParts.length : 0;
  if (isBigEffort(entry)) return true;
  if (typeof entry.weight === 'number') {
    const earlier = entries.some(e =>
      e.userId === entry.userId &&
      typeof e.weight === 'number' &&
      e.date < entry.date
    );
    if (!earlier) return true;
  }
  // Third workout day of this Mon–Sun week (crossing the team target).
  if (parts > 0 && weeklyWorkoutCount(entries, entry.userId, mondayStr) === 3) {
    return true;
  }
  return false;
}

/** True once Aiden has said anything in this thread. */
export function aidenHasSpoken(thread) {
  return Boolean(thread?.lastAidenAt) ||
    (thread?.messages || []).some(m => m.kind === 'aiden');
}

/**
 * How long the UI claims Aiden is composing a reply. Production wakes on
 * Firestore pendingAt (usually under 1s) then SuperGrok takes ~6–20s, so most
 * replies land well under a minute. A few minutes remains the honest fault
 * window; past that something is wrong (NUC down, tick failing) and
 * pretending he is still typing is worse than going quiet.
 */
export const THINKING_WINDOW_MINUTES = 3;

/**
 * Should the UI show the "Aiden is typing" dots under this thread?
 *
 * True while a human message is waiting on a reply and is recent enough that
 * one is plausibly coming. Only human-pending threads count: a proactive praise
 * job is also "Aiden thinking", but nobody is sitting there waiting for it.
 *
 * `expiresInMs` lets the UI drop the dots on a timer instead of spinning
 * forever when no reply arrives.
 */
export function aidenThinkingState(thread, now = new Date(), windowMinutes = THINKING_WINDOW_MINUTES) {
  const quiet = { thinking: false, expiresInMs: 0 };
  const pending = pendingForThread(thread).newUser;
  if (pending.length === 0) return quiet;
  const newest = pending.reduce((a, b) => ((a.at || '') > (b.at || '') ? a : b));
  const at = Date.parse(newest.at || '');
  if (!Number.isFinite(at)) return quiet;
  const waited = Math.max(0, now.getTime() - at);
  const remaining = windowMinutes * 60000 - waited;
  return remaining > 0 ? { thinking: true, expiresInMs: remaining } : quiet;
}

/**
 * Pending Aiden work for one thread target.
 * User msgs with at > lastAidenAt (or any if never answered) and not deleted.
 * Soft-deletes Aiden already answered (at <= lastAidenAt) need a brief ack.
 */
export function pendingForThread(thread) {
  const messages = thread?.messages || [];
  const last = thread?.lastAidenAt || '';
  const newUser = messages.filter(m =>
    m.kind === 'user' && m.deleted !== true && (!last || (m.at || '') > last)
  );
  const deletesToAck = messages.filter(m =>
    m.kind === 'user' && m.deleted === true && last && (m.at || '') <= last
  );
  return { newUser, deletesToAck, hasWork: newUser.length > 0 || deletesToAck.length > 0 };
}

/**
 * Build the list of thread targets Aiden should answer this tick.
 *
 * Two sources, in priority order:
 *  1. Humans talking under the report parent.
 *  2. Humans talking under a feed line.
 *
 * HUMAN-LED ONLY (2026-08-02). Proactive `praise` jobs used to open on any
 * fresh comment-worthy log, so Aiden replied to a feed line he had effectively
 * already written (the template feed line IS his voice) and just restated it.
 * The crew read it as canned. Aiden now speaks under a log only when a human
 * speaks first. Do not put unprompted feed reactions back.
 *
 * @param {object} opts
 * @param {object} opts.threads   config/banter.threads
 * @param {object[]} opts.entries  all entries (numeric or ISO updatedAt both fine)
 * @param {string} opts.today
 */
export function collectThreadJobs({ threads, entries, today }) {
  const monday = mondayOf(today);
  const tmap = threads || {};
  const list = entries || [];
  const entryById = new Map(list.filter(e => e?.id).map(e => [e.id, e]));
  const jobs = new Map();

  const worthyFor = (target) => {
    const e = entryById.get(target);
    return e && isCommentWorthy(e, list, monday) ? [e] : [];
  };

  // 1. Card parents (morning report + weekly recap).
  for (const key of CARD_TARGETS) {
    const pending = pendingForThread(tmap[key]);
    if (pending.hasWork) {
      jobs.set(key, {
        target: key,
        kind: key === WEEKLY_TARGET ? 'weekly' : 'report',
        newUser: pending.newUser,
        deletesToAck: pending.deletesToAck,
        worthy: []
      });
    }
  }

  // 2. Human-led feed threads.
  for (const target of Object.keys(tmap).filter(k => !CARD_TARGETS.includes(k))) {
    const pending = pendingForThread(tmap[target]);
    if (!pending.hasWork) continue;
    jobs.set(target, {
      target,
      kind: 'feed',
      newUser: pending.newUser,
      deletesToAck: pending.deletesToAck,
      worthy: worthyFor(target)
    });
  }

  return [...jobs.values()];
}

/**
 * Digest material from the report thread before the 3am wipe.
 * Keeps the actual TEXT (truncated), not just who spoke — the old version
 * stored "workouts: Simon bantered (2 msgs)", which gave Aiden nothing to call
 * back to, so the memory feature did literally nothing.
 */
export function digestCardThreads(threads, day, targets = CARD_TARGETS) {
  const lines = [];
  for (const key of targets) {
    for (const m of visibleMessages(threads?.[key])) {
      const who = m.kind === 'aiden' ? 'Aiden' : (m.name || 'someone');
      const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text) lines.push(`${who}: ${text}`);
    }
  }
  if (lines.length === 0) return null;
  return { day, lines: lines.slice(0, 8) };
}

export function wipeCardThreads(threads, targets = CARD_TARGETS) {
  const next = { ...(threads || {}) };
  for (const key of targets) delete next[key];
  return next;
}

/**
 * Drop feed threads older than FEED_THREAD_MAX_AGE_DAYS. No longer purges by
 * "not in the current 12-item feed window" — with 8 blokes logging daily that
 * window is ~1.5 days, so crew comments were being binned inside 2 days
 * despite the 3-day rule. Date is the only test now.
 */
export function purgeStaleFeedThreads(threads, { today }) {
  const next = { ...(threads || {}) };
  const oldest = addDays(today, -FEED_THREAD_MAX_AGE_DAYS);
  for (const key of Object.keys(next)) {
    if (CARD_TARGETS.includes(key)) continue;
    // entry ids are `{userId}_{YYYY-MM-DD}`
    const datePart = key.includes('_') ? key.slice(key.lastIndexOf('_') + 1) : '';
    if (datePart && datePart < oldest) delete next[key];
  }
  return next;
}

export function trimMemory(memory, keep = MEMORY_KEEP) {
  const list = Array.isArray(memory) ? [...memory] : [];
  return list.slice(-keep);
}

/**
 * Apply Aiden replies + clean tombstones after a successful tick.
 *
 * `lastAidenAt` defaults to `nowIso` but the orchestrator passes the PRE-CALL
 * timestamp instead. The model call takes seconds to minutes, and a comment
 * posted during it has `at` later than that, so it stays pending and gets
 * answered next tick rather than being silently marked as read.
 */
export function applyThreadReplies(threads, replies, nowIso, lastAidenAt = nowIso) {
  const next = { ...(threads || {}) };
  for (const [target, text] of Object.entries(replies || {})) {
    if (!text || !String(text).trim()) continue;
    const prev = next[target] || { messages: [], lastAidenAt: null };
    const messages = (prev.messages || [])
      .filter(m => !(m.kind === 'user' && m.deleted === true && (m.at || '') <= (prev.lastAidenAt || lastAidenAt)))
      .concat([{
        id: `aiden_${target}_${nowIso}`,
        kind: 'aiden',
        name: 'Aiden',
        text: String(text).trim(),
        at: nowIso
      }]);
    next[target] = { messages, lastAidenAt };
  }
  return next;
}

/**
 * Per-key write plan so the orchestrator never PATCHes the whole `threads` map.
 * Whole-map writes from both the client and the tick were silently destroying
 * comments posted while Claude was thinking (1-3 minutes,
 * every tick). Compare a freshly-fetched map against the intended one and
 * touch only what actually changed.
 *
 * @returns {{sets: Record<string,object>, deletes: string[]}}
 */
export function threadWritePlan(prev, next) {
  const before = prev || {};
  const after = next || {};
  const sets = {};
  const deletes = [];
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) sets[key] = after[key];
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) deletes.push(key);
  }
  return { sets, deletes };
}

/** Hard-remove a user message if Aiden has not answered past it; else soft-delete. */
export function deleteUserMessage(thread, messageId, userId) {
  const messages = [...(thread?.messages || [])];
  const idx = messages.findIndex(m => m.id === messageId && m.kind === 'user' && m.userId === userId);
  if (idx < 0) return { thread, changed: false };
  const msg = messages[idx];
  const last = thread?.lastAidenAt || '';
  if (!last || (msg.at || '') > last) {
    messages.splice(idx, 1);
  } else {
    messages[idx] = { ...msg, deleted: true };
  }
  return {
    thread: { messages, lastAidenAt: thread?.lastAidenAt ?? null },
    changed: true
  };
}

export function appendUserMessage(thread, message) {
  const messages = [...(thread?.messages || []), message];
  return { messages, lastAidenAt: thread?.lastAidenAt ?? null };
}
