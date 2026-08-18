// Aiden threads + the daily morning report. Pure logic only (no Firebase, no DOM).
// Specs: docs/superpowers/specs/2026-07-26-morning-report-design.md
//        docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md
//
// * One continuous `report` thread: Aiden appends a morning post each day
//   (role: 'report'). No daily wipe of report messages; purge by age (5 days).
// * Weekly recap still wipe-on-rewrite for `weekly` only.
// * Feed parents: factual placeholder then AI in config/banter.feedLines.
// * Thread replies under feed stay human-led only (parent is Aiden's voice).
import { addDays, mondayOf, weekdayIndex, todayStr } from './dates.js';
import { weeklyWorkoutCount } from './aggregate.js';
import { isBigEffort, hasAnyLog } from './banter.js';

/** Card-style parents (not feed entry ids). Kept as an array so callers stay generic. */
export const REPORT_TARGET = 'report';
/** Sunday weekly recap parent (Phase 4.3). */
export const WEEKLY_TARGET = 'weekly';
export const CARD_TARGETS = [REPORT_TARGET, WEEKLY_TARGET];

export const USER_MSG_MAX = 160;
export const AIDEN_MSG_MAX = 240;
/** AI feed parent line max (shorter than thread replies). */
export const FEED_LINE_MAX = 200;
export const FEED_THREAD_MAX_AGE_DAYS = 3;
/** Continuous morning-report thread message retention. */
export const REPORT_THREAD_MAX_AGE_DAYS = 5;
/** Home Coach chat card: always the latest N visible messages. */
export const COACH_PREVIEW_LIMIT = 3;
/** Expanded thread: first paint shows this many from the end (newest). */
export const THREAD_WINDOW_INITIAL = 40;
/** "Load earlier" grows the window by this many. */
export const THREAD_WINDOW_CHUNK = 20;
/** Clip long report posts on the home preview (full text in expanded thread). */
export const COACH_PREVIEW_TEXT_MAX = 180;
export const MEMORY_KEEP = 14;
/** Recent activity window size for feed line jobs (matches UI feed limit). */
export const FEED_LINE_JOB_LIMIT = 12;
/** Local HH:MM — first tick at or after this with reportDay !== today writes it. */
export const DAILY_REPORT_AFTER = '03:00';

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** True when the morning report is due (self-heals on first tick after wake). */
export function needsDailyReport(reportDay, today, now) {
  if (reportDay === today) return false;
  return hhmm(now) >= DAILY_REPORT_AFTER;
}

/** Standalone Sunday recap is gone. Monday's morning report covers last week. */
export function needsWeeklyReport(_weeklyWeekKey, _today, _now) {
  return false;
}

/** Previous Mon–Sun. Monday's report uses this, not the empty new week. */
export function lastWeekStandings(entries, users, todayStr) {
  return thisWeekStandings(entries, users, addDays(mondayOf(todayStr), -1));
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

/** User comments posted after the last Aiden message (array order). */
export function usersAfterLastAiden(thread) {
  const messages = thread?.messages || [];
  let lastAidenIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === 'aiden') { lastAidenIdx = i; break; }
  }
  const tail = lastAidenIdx < 0 ? messages : messages.slice(lastAidenIdx + 1);
  return tail.filter(m => m.kind === 'user' && m.deleted !== true);
}

/**
 * lastAidenAt to stamp after a successful reply.
 *
 * The tick used to stamp the NUC pre-call clock. Phone `at` is often a second
 * or two ahead, so the same comment stayed pending and the rerun/timer
 * answered it again (live 2026-08-18, twice). Cover the comments the model
 * actually saw. Mid-call comments have a later `at` and stay pending.
 */
export function answeredThroughAt(startedIso, replies, threadJobs) {
  let latest = startedIso || '';
  const answered = new Set(
    Object.entries(replies || {})
      .filter(([, text]) => String(text || '').trim())
      .map(([target]) => target)
  );
  for (const job of threadJobs || []) {
    if (!answered.has(job.target)) continue;
    for (const m of job.newUser || []) {
      if ((m.at || '') > latest) latest = m.at;
    }
  }
  return latest;
}

/**
 * threadScanAt so a client-ahead pendingAt does not keep looking unseen
 * after this tick already ran.
 */
export function scanMarkerAt(startedIso, pendingAt) {
  const a = startedIso || '';
  const b = typeof pendingAt === 'string' ? pendingAt : '';
  return a >= b ? a : b;
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
 * Digest material from a card thread (used for weekly wipe path; report no
 * longer digests+wipes daily). Keeps actual TEXT (truncated).
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

/** Wipe entire card thread keys (weekly still; report is continuous). */
export function wipeCardThreads(threads, targets = CARD_TARGETS) {
  const next = { ...(threads || {}) };
  for (const key of targets) delete next[key];
  return next;
}

/** Local YYYY-MM-DD from an ISO `at` timestamp. */
export function localDateFromAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return todayStr(d);
}

/**
 * Append Aiden's morning report as a message in the continuous report thread.
 * Does not wipe existing messages.
 */
export function appendReportMessage(thread, { text, day, nowIso }) {
  const body = String(text || '').trim();
  if (!body) return thread || { messages: [], lastAidenAt: null };
  const prev = thread || { messages: [], lastAidenAt: null };
  const messages = [...(prev.messages || []), {
    id: `aiden_report_${day}_${nowIso}`,
    kind: 'aiden',
    name: 'Aiden',
    text: body,
    at: nowIso,
    role: 'report',
    reportDay: day
  }];
  return { messages, lastAidenAt: nowIso };
}

/**
 * Memory digest of coach-chat lines that just aged out of the 5-day window.
 * Weekly wipe is gone, so this is how callbacks survive.
 */
/**
 * When those words were said, for the copywriter. Purged coach lines are at
 * least REPORT_THREAD_MAX_AGE_DAYS old. A digest `day` inside that window is
 * the write date (the 2026-08-18 "Pery said yesterday" bug), not speech.
 */
export function memoryWhen(day, today) {
  if (!day || !today) return 'earlier';
  const oldestFresh = addDays(today, -REPORT_THREAD_MAX_AGE_DAYS);
  if (day > oldestFresh) return 'earlier';
  return `on ${day}`;
}

export function digestDroppedReportMessages(prevThreads, nextThreads, today) {
  const before = visibleMessages(prevThreads?.[REPORT_TARGET]);
  const afterIds = new Set(visibleMessages(nextThreads?.[REPORT_TARGET]).map(m => m.id));
  const dropped = before.filter(m => m?.id && !afterIds.has(m.id));
  if (dropped.length === 0) return null;
  const lines = [];
  const spokenDays = [];
  for (const m of dropped) {
    const who = m.kind === 'aiden' ? 'Aiden' : (m.name || 'someone');
    const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (text) lines.push(`${who}: ${text}`);
    const spoken = localDateFromAt(m.at) || m.reportDay || '';
    if (spoken) spokenDays.push(spoken);
  }
  if (lines.length === 0) return null;
  const day = spokenDays.sort().at(-1) || today;
  return { day, lines: lines.slice(0, 8) };
}

/**
 * Drop messages in threads.report older than REPORT_THREAD_MAX_AGE_DAYS.
 * Keeps the report key; may leave an empty messages array.
 */
export function purgeReportThreadMessages(threads, { today }) {
  const next = { ...(threads || {}) };
  const t = next[REPORT_TARGET];
  if (!t?.messages?.length) return next;
  const oldest = addDays(today, -REPORT_THREAD_MAX_AGE_DAYS);
  const messages = t.messages.filter(m => {
    const day = localDateFromAt(m.at) || m.reportDay || '';
    return !day || day >= oldest;
  });
  if (messages.length === t.messages.length) return next;
  next[REPORT_TARGET] = { ...t, messages };
  return next;
}

/**
 * Drop feed threads older than FEED_THREAD_MAX_AGE_DAYS. Date is the only test
 * (entry id suffix). Does not touch report/weekly.
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

/**
 * Entries in the recent feed window that need an AI feed line.
 * @returns {object[]} entry objects (with id)
 */
export function collectFeedLineJobs({ entries, feedLines, today, limit = FEED_LINE_JOB_LIMIT }) {
  const map = feedLines || {};
  const items = [...(entries || [])]
    .filter(e => e?.id && hasAnyLog(e))
    .sort((a, b) => (b.date === a.date
      ? (b.updatedAt || 0) - (a.updatedAt || 0)
      : (b.date < a.date ? -1 : 1)))
    .slice(0, limit);
  return items.filter(e => {
    const text = map[e.id]?.text;
    return !(typeof text === 'string' && text.trim());
  });
}

/** Drop feedLines whose entry date is older than FEED_THREAD_MAX_AGE_DAYS. */
export function purgeStaleFeedLines(feedLines, { today }) {
  const next = { ...(feedLines || {}) };
  const oldest = addDays(today, -FEED_THREAD_MAX_AGE_DAYS);
  for (const key of Object.keys(next)) {
    const datePart = key.includes('_') ? key.slice(key.lastIndexOf('_') + 1) : '';
    if (datePart && datePart < oldest) delete next[key];
  }
  return next;
}

/**
 * Per-key write plan for feedLines (same spirit as threadWritePlan).
 * @returns {{sets: Record<string,object>, deletes: string[]}}
 */
export function feedLineWritePlan(prev, next) {
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

/**
 * Home Coach chat preview: always the latest N visible messages (report posts
 * included — the morning report is just one bubble in the chat, not a hero body).
 * @returns {{ mode: 'none'|'aiden'|'crew', messages: object[] }}
 */
export function reportPreviewMessages(thread, limit = COACH_PREVIEW_LIMIT) {
  const msgs = visibleMessages(thread);
  if (msgs.length === 0) return { mode: 'none', messages: [] };
  const n = Math.max(1, Math.min(Number(limit) || COACH_PREVIEW_LIMIT, 20));
  const hasUser = msgs.some(m => m.kind === 'user');
  return {
    mode: hasUser ? 'crew' : 'aiden',
    messages: msgs.slice(-n)
  };
}

/** Truncate long lines for the home Coach chat card. */
export function clipCoachPreviewText(text, max = COACH_PREVIEW_TEXT_MAX) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Expanded-thread window: newest `shownFromEnd` messages, for load-earlier.
 * @returns {{ messages: object[], hasMore: boolean, shown: number, total: number }}
 */
export function threadMessageWindow(messages, shownFromEnd = THREAD_WINDOW_INITIAL) {
  const all = Array.isArray(messages) ? messages : [];
  if (all.length === 0) return { messages: [], hasMore: false, shown: 0, total: 0 };
  const shown = Math.max(1, Math.min(Number(shownFromEnd) || THREAD_WINDOW_INITIAL, all.length));
  const start = all.length - shown;
  return {
    messages: all.slice(start),
    hasMore: start > 0,
    shown,
    total: all.length
  };
}

/**
 * Body text for the home report card.
 * Prefer today's banter.report when fresh; else latest role:report message text.
 */
/** Day stamp of the current morning report, from the pointer or the thread. */
export function currentReportDay(banter) {
  if (banter?.report?.day) return banter.report.day;
  if (typeof banter?.reportDay === 'string' && banter.reportDay) return banter.reportDay;
  const msgs = visibleMessages(banter?.threads?.[REPORT_TARGET]);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'report' && msgs[i].reportDay) return msgs[i].reportDay;
  }
  return null;
}

export function latestReportBody(banter, today) {
  const r = banter?.report;
  if (r?.text && r.day === today) return r.text;
  if (r?.text && r.day) return r.text; // stale stored report still better than nothing until template
  const msgs = visibleMessages(banter?.threads?.[REPORT_TARGET]);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'report' && msgs[i].text) return msgs[i].text;
  }
  return null;
}

export function trimMemory(memory, keep = MEMORY_KEEP) {
  const list = Array.isArray(memory) ? [...memory] : [];
  return list.slice(-keep);
}

/**
 * Apply Aiden replies + clean tombstones after a successful tick.
 *
 * `lastAidenAt` defaults to `nowIso` but the orchestrator passes
 * `answeredThroughAt` (max of pre-call and the comments this call answered).
 * A comment posted during the model call has `at` later than that, so it stays
 * pending and gets answered next tick rather than being silently marked as read.
 */
export function applyThreadReplies(threads, replies, nowIso, lastAidenAt = nowIso) {
  const next = { ...(threads || {}) };
  for (const [target, text] of Object.entries(replies || {})) {
    if (!text || !String(text).trim()) continue;
    const prev = next[target] || { messages: [], lastAidenAt: null };
    const pending = pendingForThread(prev);
    // Never stack a second Aiden on a thread whose last speaker is already
    // him. A rerun/parallel tick used to append blindly after a fresh re-read
    // that already contained the first reply (live 2026-08-18). Mid-call
    // comments sit *before* that Aiden message and stay pending via lastAidenAt
    // for the *next* tick; this write must not answer them (the model never saw
    // them) and must not add another line for the comment he just answered.
    if (usersAfterLastAiden(prev).length === 0 && pending.deletesToAck.length === 0) {
      continue;
    }
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
