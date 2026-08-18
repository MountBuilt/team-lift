#!/usr/bin/env node
// Team Lift tick: Aiden's morning report, thread replies, and push sends.
// Production (NUC):
//   - Event wake: teamlift-banter-watch.service (Firestore onSnapshot on
//     config/banter.pendingAt) for near-live thread replies.
//   - Safety timer: teamlift-banter.timer every 2 min for clock jobs + recovery.
// Mac launchd (com.teamlift.banter) is deprecated reference only — see
// docs/ops-nuc.md. This script owns every fetch, write and send;
// scripts/lib/copywriter.mjs owns the model call.
//
// Specs: docs/superpowers/specs/2026-07-26-morning-report-design.md
//        docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md
//
// SHAPE OF A TICK
//   1. Probe: read config/banter + config/push only (2 document reads). If
//      there is nothing to do, exit without writing anything. This is what
//      makes a 30s safety timer affordable on the free Spark plan.
//   2. Otherwise fetch users + entries and work out what copy is needed.
//   3. One model call for everything (report + weekly + threads + feedLines +
//      pushes).
//   4. Re-read config/banter, merge, and write only the fields that changed.
//   Report thread is continuous (append morning post; no daily wipe). Weekly
//   still digests+wipes. Feed parents live in banter.feedLines.
//
// DO NOT reintroduce whole-map `threads` writes. The client and this script
// both used to PATCH the entire map, so any comment posted while the model was
// thinking (1-3 minutes) was silently destroyed. Writes are per-thread-key now
// and `lastAidenAt` is stamped with max(pre-call, answered comment ats) so a
// client-ahead clock cannot reopen the same comment, while a comment that
// lands mid-call still stays pending for the next tick.
//
// Flags:
//   --dry-run            full tick including the model call; prints intended
//                        writes and pushes; writes and sends nothing
//   --send-test <userId> send one canned push to that user's subscription, exit
import webpush from 'web-push';
import { fetchCollection, fetchDoc, patchDoc, maskPath } from './lib/firestore-rest.mjs';
import { probeWork, decidePushWork } from './lib/decide.mjs';
import { buildContext, validateCopy } from './lib/context.mjs';
import { generateCopy, backendName, modelFor } from './lib/copywriter.mjs';
import { todayStr } from '../js/lib/dates.js';
import { exitCodeForError } from './lib/tick-exit.mjs';
import {
  collectThreadJobs, digestCardThreads, wipeCardThreads, purgeStaleFeedThreads,
  applyThreadReplies, trimMemory, threadWritePlan, REPORT_TARGET, WEEKLY_TARGET,
  appendReportMessage, purgeReportThreadMessages, digestDroppedReportMessages,
  collectFeedLineJobs, purgeStaleFeedLines, feedLineWritePlan,
  answeredThroughAt, scanMarkerAt
} from '../js/lib/threads.js';
import { mondayOf } from '../js/lib/dates.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { VAPID_PUBLIC_KEY } from '../js/push-config.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const testAt = args.indexOf('--send-test');
const TEST_USER = testAt >= 0 ? args[testAt + 1] : null;

const REPORT_HISTORY_KEEP = 8;
const LEGACY_FIELDS = ['cards', 'history', 'feed', 'feedMeta', 'hashes', 'date', 'cardsDay'];

const log = (...a) => console.log(...a);

const privateKey = readFileSync(join(homedir(), '.config/teamlift/vapid-private.key'), 'utf8').trim();
webpush.setVapidDetails('mailto:simong.aust@gmail.com', VAPID_PUBLIC_KEY, privateKey);

async function sendPush(user, payload) {
  const sub = { endpoint: user.push.endpoint, keys: user.push.keys };
  if (DRY) { log(`[dry-run] push to ${user.name}:`, JSON.stringify(payload)); return true; }
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 4 * 3600 });
    log(`pushed to ${user.name}`);
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      log(`subscription for ${user.name} is dead (${err.statusCode}) - disabling`);
      await patchDoc(`users/${user.id}`, {
        push: { ...user.push, enabled: false, updatedAt: new Date().toISOString() }
      }, ['push']);
      // Handled: dead sub must not block stamping the day wave.
      return true;
    }
    // Prefer statusCode; fall back through message/body so empty WebPushError
    // objects still leave a usable breadcrumb in the banter log.
    const detail = err.statusCode ?? err.message ?? err.body ?? String(err);
    log(`push to ${user.name} failed: ${detail}`);
    return false;
  }
}

async function patch(docPath, obj, paths) {
  if (paths.length === 0) return;
  if (DRY) { log(`[dry-run] PATCH ${docPath} mask=[${paths.join(', ')}]`, JSON.stringify(obj)); return; }
  await patchDoc(docPath, obj, paths);
}

async function main() {
  const today = todayStr();
  const now = new Date();
  // Stamped BEFORE the model call and used for threadScanAt / lastAidenAt, so
  // comments that arrive mid-call are picked up next tick rather than skipped.
  const startedIso = now.toISOString();

  // ---- 1. cheap probe: two document reads ---------------------------------
  const [banter, pushState] = await Promise.all([
    fetchDoc('config/banter'),
    fetchDoc('config/push')
  ]);
  const probe = probeWork({ banter, pushState, now, today });

  if (!probe.needsFullFetch && !TEST_USER) {
    // The wrapper suppresses logging for runs that print only this.
    log('idle');
    return;
  }

  // ---- 2. full state ------------------------------------------------------
  const [users, entries, challengeCfg] = await Promise.all([
    fetchCollection('users'),
    fetchCollection('entries'),
    fetchDoc('config/challenge')
  ]);
  if (users.length === 0) { console.error('empty roster (fetch failure?) - aborting'); process.exit(1); }

  if (TEST_USER) {
    const u = users.find(x => x.id === TEST_USER);
    if (!u?.push?.enabled) { console.error(`user ${TEST_USER} not found or push not enabled`); process.exit(1); }
    const ok = await sendPush(u, { title: 'Team Lift test', body: 'Push works. Now go do the challenge, legend.' });
    process.exit(ok ? 0 : 1);
  }

  // Threads before Aiden speaks: purge stale feed threads + old report messages.
  // Weekly still digests+wipes. Report is continuous (no wipe).
  const buildThreads = (raw) => {
    let t = purgeStaleFeedThreads(raw || {}, { today });
    t = purgeReportThreadMessages(t, { today });
    if (probe.wantWeekly) t = wipeCardThreads(t, [WEEKLY_TARGET]);
    return t;
  };
  const rawThreads = banter?.threads || {};
  const threads = buildThreads(rawThreads);
  const feedLinesBase = purgeStaleFeedLines(banter?.feedLines || {}, { today });

  let memory = trimMemory(banter?.memory || []);
  const droppedCoach = digestDroppedReportMessages(rawThreads, threads, today);
  if (droppedCoach) {
    memory = trimMemory([...memory, droppedCoach]);
    log(`digested ${droppedCoach.lines.length} aged coach-chat lines to memory`);
  }
  if (probe.wantReport) {
    log(`daily report due: reportDay ${banter?.reportDay ?? '(none)'} -> ${today} (append, no wipe)`);
  }
  if (probe.wantWeekly) {
    const weekKey = mondayOf(today);
    const digest = digestCardThreads(banter?.threads || {}, weekKey, [WEEKLY_TARGET]);
    if (digest) memory = trimMemory([...memory, digest]);
    log(`weekly report due: weekKey ${banter?.weeklyReport?.weekKey ?? '(none)'} -> ${weekKey}` +
        `${digest ? ` (digested ${digest.lines.length} weekly thread lines to memory)` : ''}`);
  }

  const threadJobs = collectThreadJobs({ threads, entries, today });
  const feedLineJobs = collectFeedLineJobs({
    entries, feedLines: feedLinesBase, today
  });
  const work = decidePushWork({ users, entries, pushState, now, today });

  log(`report=${probe.wantReport} weekly=${probe.wantWeekly} threads=${threadJobs.length}` +
      `(${threadJobs.map(j => j.kind).join(',')}) feedLines=${feedLineJobs.length} ` +
      `morning=${work.morning.length} evening=${work.evening.length} ` +
      `probe=${probe.unseenComment ? 'comment' : probe.scanStale ? 'staleScan' : 'time'}`);

  const pushStatePatch = {};
  if ((work.morningDue && work.morning.length === 0) || work.skipMorning) pushStatePatch.lastMorning = today;
  if (work.eveningDue && work.evening.length === 0) pushStatePatch.lastEvening = today;

  const needCopy = probe.wantReport || probe.wantWeekly || threadJobs.length > 0 ||
    feedLineJobs.length > 0 ||
    work.morning.length > 0 || work.evening.length > 0;

  if (!needCopy) {
    // Woke up for a stale-scan sweep and found nothing. Bump the scan marker so
    // the probe goes quiet again, and flush any thread / feedLine purge.
    const plan = threadWritePlan(banter?.threads || {}, threads);
    const flPlan = feedLineWritePlan(banter?.feedLines || {}, feedLinesBase);
    const idleObj = { threadScanAt: scanMarkerAt(startedIso, banter?.pendingAt) };
    const idlePaths = ['threadScanAt'];
    if (droppedCoach) {
      idleObj.memory = memory;
      idlePaths.push('memory');
    }
    await writeBanter(idleObj, idlePaths, plan, flPlan);
    if (Object.keys(pushStatePatch).length) {
      await patch('config/push', pushStatePatch, Object.keys(pushStatePatch));
    }
    log('nothing to write beyond scan marker');
    return;
  }

  // ---- 3. one model call --------------------------------------------------
  const context = buildContext({
    users,
    entries,
    banter: { ...banter, threads, memory, feedLines: feedLinesBase },
    challengeStart: challengeCfg?.startDate ?? today,
    today,
    wantReport: probe.wantReport,
    wantWeekly: probe.wantWeekly,
    threadJobs,
    feedLineJobs,
    morning: work.morning,
    evening: work.evening,
    previousMood: banter?.mood
  });
  log(`mood=${context.mood.name}${context.mood.sticky ? ' (sticky)' : ''}`);
  const backend = backendName();
  log(`calling ${backend} backend (${modelFor(backend)}) for jobs=[${context.jobs.join(',')}] ` +
      `contextBytes=${JSON.stringify(context).length}`);

  const { copy, backend: usedBackend, model, ms } = await generateCopy(context, { log });
  const verdict = validateCopy(copy, context);
  if (!verdict.ok) {
    console.error(`copy rejected (${usedBackend}/${model}, ${ms}ms):\n  ` + verdict.errors.join('\n  '));
    process.exit(1);
  }
  log(`copy ok via ${usedBackend} (${model}) in ${ms}ms`);

  // ---- 4. merge against fresh state and write ------------------------------
  const fresh = DRY ? banter : await fetchDoc('config/banter');
  let nextThreads = buildThreads(fresh?.threads);
  const replies = Object.fromEntries(
    (copy.threadReplies || []).map(r => [r.target, r.text])
  );
  const writtenIso = new Date().toISOString();
  if (Object.keys(replies).length) {
    // Cover the comments this call actually answered (client clocks run
    // ahead of the NUC). Mid-call comments have a later at and stay pending.
    const answeredAt = answeredThroughAt(startedIso, replies, threadJobs);
    nextThreads = applyThreadReplies(nextThreads, replies, writtenIso, answeredAt);
  }

  const report = (copy.report || '').trim();
  if (probe.wantReport && report) {
    const t = nextThreads[REPORT_TARGET];
    nextThreads = {
      ...nextThreads,
      [REPORT_TARGET]: appendReportMessage(t, { text: report, day: today, nowIso: writtenIso })
    };
  }

  const plan = threadWritePlan(fresh?.threads || {}, nextThreads);

  let nextFeedLines = purgeStaleFeedLines(fresh?.feedLines || banter?.feedLines || {}, { today });
  for (const row of copy.feedLines || []) {
    const id = row?.entryId;
    const text = String(row?.text || '').trim();
    if (!id || !text) continue;
    if (!feedLineJobs.some(e => e.id === id)) continue;
    nextFeedLines[id] = { text, at: writtenIso };
  }
  const flPlan = feedLineWritePlan(fresh?.feedLines || banter?.feedLines || {}, nextFeedLines);

  const obj = {
    threadScanAt: scanMarkerAt(startedIso, banter?.pendingAt),
    memory,
    mood: {
      name: context.mood.name,
      targets: context.mood.targets || [],
      trigger: context.mood.trigger || '',
      at: startedIso
    }
  };
  const paths = ['threadScanAt', 'memory', 'mood'];

  if (probe.wantReport && report) {
    obj.report = { day: today, text: report };
    obj.reportDay = today;
    obj.reportHistory = [...(fresh?.reportHistory ?? banter?.reportHistory ?? []), report]
      .slice(-REPORT_HISTORY_KEEP);
    paths.push('report', 'reportDay', 'reportHistory');
  }

  const weeklyText = (copy.weeklyReport || '').trim();
  if (probe.wantWeekly && weeklyText) {
    obj.weeklyReport = { weekKey: mondayOf(today), day: today, text: weeklyText };
    paths.push('weeklyReport');
  }

  await writeBanter(obj, paths, plan, flPlan);
  log(`banter written: report=${Boolean(obj.report)} weekly=${Boolean(obj.weeklyReport)} ` +
      `threadSets=[${Object.keys(plan.sets).join(',')}] threadDeletes=[${plan.deletes.join(',')}] ` +
      `feedSets=[${Object.keys(flPlan.sets).join(',')}] feedDeletes=[${flPlan.deletes.join(',')}]`);

  await dropLegacyFields(fresh ?? banter);

  // ---- 5. pushes ----------------------------------------------------------
  // Only morning motivation and the evening no-activity nudge. Report-up and
  // Aiden-replied were waking phones all day; they are off.
  // Spec (2026-07-13): advance lastMorning/lastEvening after the wave was
  // attempted. A single flaky endpoint must not re-spam everyone else on the
  // next 30s tick. (All-or-nothing stamping did exactly that on 2026-08-06:
  // Hunt/Phill failed, Simon/Pery got ~6 morning pushes in three minutes.)
  const copyFor = (u, kind) => (copy.pushes || []).find(p => p.userId === u.id && p.kind === kind);
  for (const [kind, targets, stamp] of [
    ['morning', work.morning, 'lastMorning'],
    ['evening', work.evening, 'lastEvening']
  ]) {
    if (targets.length === 0) continue;
    const results = await Promise.all(targets.map(u => {
      const p = copyFor(u, kind);
      if (!p?.title || !p?.body) return Promise.resolve(true);
      return sendPush(u, { title: p.title, body: p.body });
    }));
    pushStatePatch[stamp] = today;
    const failed = results.filter(ok => !ok).length;
    if (failed) {
      log(`${kind}: ${failed}/${targets.length} sends failed - day stamped anyway (no re-spam)`);
    }
  }

  if (Object.keys(pushStatePatch).length) {
    await patch('config/push', pushStatePatch, Object.keys(pushStatePatch));
  }
  log('tick complete');
}

/**
 * One PATCH for config/banter. Thread and feedLine keys are written
 * individually; keys in the mask but absent from the body are deleted by
 * Firestore, which is how purged keys disappear without whole-map stomps.
 */
async function writeBanter(obj, paths, plan, feedPlan = { sets: {}, deletes: [] }) {
  const body = { ...obj };
  const mask = [...paths];
  if (Object.keys(plan.sets).length) body.threads = plan.sets;
  for (const key of Object.keys(plan.sets)) mask.push(maskPath('threads', key));
  for (const key of plan.deletes) mask.push(maskPath('threads', key));
  if (Object.keys(feedPlan.sets).length) body.feedLines = feedPlan.sets;
  for (const key of Object.keys(feedPlan.sets)) mask.push(maskPath('feedLines', key));
  for (const key of feedPlan.deletes) mask.push(maskPath('feedLines', key));
  await patch('config/banter', body, mask);
}

/**
 * One-time cleanup of the pre-2026-07-26 fields. `feed`/`feedMeta` alone were
 * 110 dead AI feed lines (~21 KB) that every client re-downloaded on every
 * change to the doc, in a document with a 1 MiB ceiling.
 */
async function dropLegacyFields(doc) {
  const present = LEGACY_FIELDS.filter(f => doc && f in doc);
  if (present.length === 0) return;
  log(`dropping legacy config/banter fields: ${present.join(', ')}`);
  await patch('config/banter', {}, present);
}

main().catch(err => {
  console.error(err);
  process.exit(exitCodeForError(err));
});
