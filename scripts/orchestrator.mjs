#!/usr/bin/env node
// Hourly tick for Team Lift: Aiden banter (card parents + feed + threads) and
// push notifications. Claude is invoked at most once per tick as a pure
// copywriter (context.json in, copy.json out); this script owns all fetches,
// hashes, PATCHes, and web-push sends.
//
// Card parents (weight/steps/workouts) rewrite only on the ~3am daily path
// (cardsDay !== today, local time ≥ 03:00). Mid-day entry changes do NOT
// rewrite parents — Aiden reacts in threads instead.
// Spec: docs/superpowers/specs/2026-07-19-aiden-threads-design.md
//
// Flags:
//   --dry-run            full tick including the Claude call; prints intended
//                        PATCHes and pushes; writes and sends nothing
//   --send-test <userId> send one canned push to that user's subscription, exit
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { fetchCollection, fetchDoc, patchDoc, maskPath } from './lib/firestore-rest.mjs';
import { computeHashes, changedSections, decidePushWork } from './lib/decide.mjs';
import { buildContext, validateCopy } from './lib/context.mjs';
import { todayStr } from '../js/lib/dates.js';
import { groupFeedByDay } from '../js/lib/aggregate.js';
import {
  needsDailyCardRefresh, collectThreadJobs, digestCardThreads, wipeCardThreads,
  purgeStaleFeedThreads, applyThreadReplies, trimMemory, CARD_TARGETS
} from '../js/lib/threads.js';
import { VAPID_PUBLIC_KEY } from '../js/push-config.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const testAt = args.indexOf('--send-test');
const TEST_USER = testAt >= 0 ? args[testAt + 1] : null;

const privateKey = readFileSync(join(homedir(), '.config/teamlift/vapid-private.key'), 'utf8').trim();
webpush.setVapidDetails('mailto:simong.aust@gmail.com', VAPID_PUBLIC_KEY, privateKey);

const log = (...a) => console.log(...a);

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
      return true;
    }
    log(`push to ${user.name} failed: ${err.statusCode ?? err.message}`);
    return false;
  }
}

async function patch(docPath, obj, paths) {
  if (DRY) { log(`[dry-run] PATCH ${docPath} mask=[${paths.join(', ')}]`, JSON.stringify(obj)); return; }
  await patchDoc(docPath, obj, paths);
}

// groupFeedByDay sorts on numeric updatedAt; REST gives ISO strings — keep
// string updatedAt on entries for feedMeta / scanAt comparisons.
function withMillis(entries) {
  return entries.map(e => ({
    ...e,
    updatedAt: e.updatedAt ? Date.parse(e.updatedAt) || 0 : 0
  }));
}

async function main() {
  const today = todayStr();
  const now = new Date();
  const nowIso = now.toISOString();

  const [users, entries, banter, pushState, challengeCfg] = await Promise.all([
    fetchCollection('users'),
    fetchCollection('entries'),
    fetchDoc('config/banter'),
    fetchDoc('config/push'),
    fetchDoc('config/challenge')
  ]);
  if (users.length === 0) { console.error('empty roster (fetch failure?) - aborting'); process.exit(1); }

  if (TEST_USER) {
    const u = users.find(x => x.id === TEST_USER);
    if (!u?.push?.enabled) { console.error(`user ${TEST_USER} not found or push not enabled`); process.exit(1); }
    const ok = await sendPush(u, { title: 'Team Lift test', body: 'Push works. Now go do the challenge, legend.' });
    process.exit(ok ? 0 : 1);
  }

  const hashes = computeHashes(users, entries, today);
  const hashChanged = changedSections(hashes, banter?.hashes);
  // Card parents only on daily refresh — never mid-day hash chase (stale-copy bug).
  const dailyCardRefresh = needsDailyCardRefresh(banter?.cardsDay, today, now);
  const sections = [];
  if (dailyCardRefresh) sections.push(...CARD_TARGETS);
  if (hashChanged.includes('feed')) sections.push('feed');

  const feedIds = groupFeedByDay(withMillis(entries), today, 12).flatMap(g => g.items.map(i => i.id));
  let threads = purgeStaleFeedThreads(banter?.threads || {}, { today, feedIds });
  let memory = trimMemory(banter?.memory || []);

  if (dailyCardRefresh) {
    const digest = digestCardThreads(threads, banter?.cardsDay || today);
    if (digest) memory = trimMemory([...memory, digest]);
    threads = wipeCardThreads(threads);
    log(`daily card refresh: cardsDay ${banter?.cardsDay ?? '(none)'} -> ${today}`);
  }

  const threadJobs = collectThreadJobs({
    threads,
    entries,
    today,
    scanAt: banter?.threadScanAt || null,
    feedIds
  });

  const work = decidePushWork({ users, entries, pushState, now, today });
  log(`sections=[${sections.join(',')}] threads=${threadJobs.length} ` +
      `morningDue=${work.morningDue}(${work.morning.length}) ` +
      `eveningDue=${work.eveningDue}(${work.evening.length}) skipMorning=${work.skipMorning} ` +
      `dailyCards=${dailyCardRefresh}`);

  const pushStatePatch = {};
  if ((work.morningDue && work.morning.length === 0) || work.skipMorning) pushStatePatch.lastMorning = today;
  if (work.eveningDue && work.evening.length === 0) pushStatePatch.lastEvening = today;

  const needCopy = sections.length > 0 || threadJobs.length > 0 ||
    work.morning.length > 0 || work.evening.length > 0;

  // Always keep banter date + threadScanAt fresh; sync card hashes on quiet ticks
  // so mid-day data drift does not reappear as "changed" forever.
  if (!needCopy) {
    log('no copy needed - bumping date/scan + syncing hashes');
    const quiet = {
      date: today,
      threadScanAt: nowIso,
      hashes,
      threads
    };
    const paths = ['date', 'threadScanAt', 'hashes.weight', 'hashes.steps', 'hashes.workouts', 'hashes.feed', 'threads'];
    if (dailyCardRefresh) {
      // Should not happen without needCopy if daily forces sections — belt and braces.
      quiet.cardsDay = today;
      quiet.memory = memory;
      paths.push('cardsDay', 'memory');
    }
    await patch('config/banter', quiet, paths);
    if (Object.keys(pushStatePatch).length) {
      await patch('config/push', pushStatePatch, Object.keys(pushStatePatch));
    }
    return;
  }

  const workdir = mkdtempSync(join(tmpdir(), 'teamlift-'));
  let copy;
  try {
    // Pass banter with post-wipe threads so context matches what we will write.
    const banterForCtx = { ...banter, threads, memory };
    const context = buildContext({
      users,
      entries,
      banter: banterForCtx,
      challengeStart: challengeCfg?.startDate ?? today,
      changed: sections,
      morning: work.morning,
      evening: work.evening,
      today,
      threadJobs,
      dailyCardRefresh
    });
    writeFileSync(join(workdir, 'context.json'), JSON.stringify(context, null, 2));
    log(`invoking claude (sonnet) for sections=[${sections.join(',')}] ` +
        `threads=${threadJobs.map(j => j.target).join(',')} pushes=${context.pushes.length}`);
    execFileSync('claude', [
      '-p', `/copywriter ${workdir}`,
      '--model', 'sonnet',
      '--allowedTools', 'Read', 'Write',
      '--max-turns', '30'
    ], { cwd: REPO, stdio: 'inherit' });
    copy = JSON.parse(readFileSync(join(workdir, 'copy.json'), 'utf8'));
    const verdict = validateCopy(copy, context);
    if (!verdict.ok) {
      console.error('copy rejected:\n  ' + verdict.errors.join('\n  '));
      process.exit(1);
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  // Merge Aiden thread replies into the in-memory threads map.
  if (copy.threadReplies && Object.keys(copy.threadReplies).length) {
    threads = applyThreadReplies(threads, copy.threadReplies, nowIso);
  }

  const obj = {
    date: today,
    threadScanAt: nowIso,
    hashes,
    threads,
    memory
  };
  const paths = [
    'date', 'threadScanAt', 'threads', 'memory',
    'hashes.weight', 'hashes.steps', 'hashes.workouts', 'hashes.feed'
  ];

  if (dailyCardRefresh) {
    obj.cardsDay = today;
    paths.push('cardsDay');
  }

  const cardSections = sections.filter(s => s !== 'feed' && copy.cards?.[s]);
  if (cardSections.length) {
    obj.cards = Object.fromEntries(cardSections.map(s => [s, copy.cards[s]]));
    paths.push(...cardSections.map(s => maskPath('cards', s)));
    obj.history = [...(banter?.history ?? []),
      { ts: today, sections, cards: obj.cards }].slice(-8);
    paths.push('history');
  }

  const feedIdsWritten = Object.keys(copy.feed ?? {});
  if (feedIdsWritten.length) {
    // feedMeta must match entry.updatedAt strings used in buildContext feedNeeds.
    const rawMeta = new Map(entries.map(e => [e.id, e.updatedAt ?? '']));
    obj.feed = copy.feed;
    obj.feedMeta = Object.fromEntries(feedIdsWritten.map(id => [id, rawMeta.get(id) ?? '']));
    paths.push(...feedIdsWritten.map(id => maskPath('feed', id)));
    paths.push(...feedIdsWritten.map(id => maskPath('feedMeta', id)));
  }

  await patch('config/banter', obj, paths);
  log(`banter updated: cards=[${cardSections.join(',')}] feedLines=${feedIdsWritten.length} ` +
      `threadReplies=${Object.keys(copy.threadReplies || {}).length}`);

  const copyFor = (u, kind) => copy.pushes.find(p => p.userId === u.id && p.kind === kind);
  for (const [kind, targets, stamp] of [
    ['morning', work.morning, 'lastMorning'],
    ['evening', work.evening, 'lastEvening']
  ]) {
    if (targets.length === 0) continue;
    const results = await Promise.all(targets.map(u => {
      const p = copyFor(u, kind);
      return sendPush(u, { title: p.title, body: p.body });
    }));
    if (results.every(Boolean)) pushStatePatch[stamp] = today;
    else log(`${kind}: some sends failed - will retry next hour`);
  }
  if (Object.keys(pushStatePatch).length) {
    await patch('config/push', pushStatePatch, Object.keys(pushStatePatch));
  }
  log('tick complete');
}

main().catch(err => { console.error(err); process.exit(1); });
