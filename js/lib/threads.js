// Aiden threads + daily card-parent freeze. Pure logic only (no Firebase, no DOM).
// Spec: docs/superpowers/specs/2026-07-19-aiden-threads-design.md
//
// Card coach lines (weight/steps/workouts) rewrite once per local day (~3am).
// Crew banter lives in threads under those parents and under feed entry ids.
// Keep this file the single source for pending work, purge, and comment-worthy
// rules so the orchestrator and tests cannot drift.
import { addDays, mondayOf } from './dates.js';
import { weeklyWorkoutCount } from './aggregate.js';

export const CARD_TARGETS = ['weight', 'steps', 'workouts'];
export const USER_MSG_MAX = 160;
export const AIDEN_MSG_MAX = 240;
export const FEED_THREAD_MAX_AGE_DAYS = 3;
export const MEMORY_KEEP = 14;
/** Local HH:MM — first tick at or after this with cardsDay !== today rewrites parents. */
export const DAILY_CARD_AFTER = '03:00';

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

export function needsDailyCardRefresh(cardsDay, today, now) {
  if (cardsDay === today) return false;
  return hhmm(now) >= DAILY_CARD_AFTER;
}

/** Messages shown in the UI (soft-deleted hidden). */
export function visibleMessages(thread) {
  return (thread?.messages || []).filter(m => m && m.deleted !== true);
}

export function commentCount(thread) {
  return visibleMessages(thread).length;
}

/**
 * Mon–Sun standings the copywriter must use for card parents (not all-time).
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

/** Aligns with feed "BIG EFFORT" plus first weigh-in and 3rd workout day of week. */
export function isCommentWorthy(entry, entries, mondayStr) {
  if (!entry) return false;
  const parts = Array.isArray(entry.workoutParts) ? entry.workoutParts.length : 0;
  if (typeof entry.steps === 'number' && entry.steps >= 15000) return true;
  if (parts >= 3) return true;
  if (parts > 0 && entry.dailyChallenge === true) return true;
  if (typeof entry.weight === 'number') {
    const earlier = entries.some(e =>
      e.userId === entry.userId &&
      typeof e.weight === 'number' &&
      e.date < entry.date
    );
    if (!earlier) return true;
  }
  // Third workout day of this Mon–Sun week (crossing the team target), not every
  // session after that.
  if (parts > 0 && weeklyWorkoutCount(entries, entry.userId, mondayStr) === 3) {
    return true;
  }
  return false;
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
 * Card targets: human pending only.
 * Feed targets: human pending and/or comment-worthy entries since scanAt.
 */
export function collectThreadJobs({ threads, entries, today, scanAt, feedIds }) {
  const monday = mondayOf(today);
  const jobs = [];
  const tmap = threads || {};

  for (const key of CARD_TARGETS) {
    const pending = pendingForThread(tmap[key]);
    if (pending.hasWork) {
      jobs.push({
        target: key,
        kind: 'card',
        newUser: pending.newUser,
        deletesToAck: pending.deletesToAck,
        worthy: []
      });
    }
  }

  const feedIdSet = new Set(feedIds || []);
  // Proactive "comment-worthy" jobs need a scan watermark. Without one (first
  // deploy / missing threadScanAt), every big-effort entry in the window would
  // fire at once and overwhelm the copywriter tick.
  const worthyByEntry = new Map();
  if (scanAt) {
    for (const e of entries) {
      if (!e?.id || !e.date) continue;
      if (e.date < addDays(today, -FEED_THREAD_MAX_AGE_DAYS)) continue;
      const updated = typeof e.updatedAt === 'number'
        ? new Date(e.updatedAt).toISOString()
        : (e.updatedAt || '');
      if (updated && updated <= scanAt) continue;
      if (!isCommentWorthy(e, entries, monday)) continue;
      worthyByEntry.set(e.id, e);
    }
  }

  const feedTargets = new Set([
    ...Object.keys(tmap).filter(k => !CARD_TARGETS.includes(k)),
    ...worthyByEntry.keys()
  ]);

  for (const target of feedTargets) {
    if (feedIds && !feedIdSet.has(target) && !worthyByEntry.has(target)) {
      // Still allow pending human work on a thread even if momentarily off feed set
      const pendingOnly = pendingForThread(tmap[target]);
      if (!pendingOnly.hasWork) continue;
    }
    const pending = pendingForThread(tmap[target]);
    const worthy = worthyByEntry.has(target) ? [worthyByEntry.get(target)] : [];
    if (!pending.hasWork && worthy.length === 0) continue;
    jobs.push({
      target,
      kind: 'feed',
      newUser: pending.newUser,
      deletesToAck: pending.deletesToAck,
      worthy
    });
  }

  return jobs;
}

/** One-line digest material from card threads before 3am wipe. */
export function digestCardThreads(threads, day) {
  const notes = [];
  for (const key of CARD_TARGETS) {
    const vis = visibleMessages(threads?.[key]);
    if (vis.length === 0) continue;
    const users = vis.filter(m => m.kind === 'user').map(m => m.name || 'someone');
    const unique = [...new Set(users)];
    if (unique.length) {
      notes.push(`${key}: ${unique.join(', ')} bantered (${vis.length} msgs)`);
    } else {
      notes.push(`${key}: Aiden only (${vis.length} msgs)`);
    }
  }
  if (notes.length === 0) return null;
  return { day, notes: notes.slice(0, 3) };
}

export function wipeCardThreads(threads) {
  const next = { ...(threads || {}) };
  for (const key of CARD_TARGETS) delete next[key];
  return next;
}

/**
 * Drop feed threads older than FEED_THREAD_MAX_AGE_DAYS or not in the current
 * recent-feed id set. Card keys always kept (until wipeCardThreads).
 */
export function purgeStaleFeedThreads(threads, { today, feedIds }) {
  const next = { ...(threads || {}) };
  const keep = new Set(feedIds || []);
  const oldest = addDays(today, -FEED_THREAD_MAX_AGE_DAYS);
  for (const key of Object.keys(next)) {
    if (CARD_TARGETS.includes(key)) continue;
    // entry ids are `{userId}_{YYYY-MM-DD}`
    const datePart = key.includes('_') ? key.slice(key.lastIndexOf('_') + 1) : '';
    const tooOld = datePart && datePart < oldest;
    const offFeed = keep.size > 0 && !keep.has(key);
    if (tooOld || offFeed) delete next[key];
  }
  return next;
}

export function trimMemory(memory, keep = MEMORY_KEEP) {
  const list = Array.isArray(memory) ? [...memory] : [];
  return list.slice(-keep);
}

/** Apply Aiden replies + clean tombstones after a successful tick. */
export function applyThreadReplies(threads, replies, nowIso) {
  const next = { ...(threads || {}) };
  for (const [target, text] of Object.entries(replies || {})) {
    if (!text || !String(text).trim()) continue;
    const prev = next[target] || { messages: [], lastAidenAt: null };
    const messages = (prev.messages || [])
      .filter(m => !(m.kind === 'user' && m.deleted === true && (m.at || '') <= (prev.lastAidenAt || nowIso)))
      .concat([{
        id: `aiden_${target}_${nowIso}`,
        kind: 'aiden',
        name: 'Aiden',
        text: String(text).trim(),
        at: nowIso
      }]);
    next[target] = { messages, lastAidenAt: nowIso };
  }
  return next;
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
