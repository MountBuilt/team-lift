#!/usr/bin/env node
// Hourly tick for Team Lift: refresh AI banter for changed sections and send
// due push notifications. Claude is invoked at most once per tick, as a pure
// copywriter (context.json in, copy.json out); this script owns all fetches,
// hashes, PATCHes, and web-push sends.
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
      return true; // handled; don't block state advancing
    }
    log(`push to ${user.name} failed: ${err.statusCode ?? err.message}`);
    return false;
  }
}

async function patch(docPath, obj, paths) {
  if (DRY) { log(`[dry-run] PATCH ${docPath} mask=[${paths.join(', ')}]`, JSON.stringify(obj)); return; }
  await patchDoc(docPath, obj, paths);
}

async function main() {
  const today = todayStr();
  const now = new Date();

  const [users, entries, banter, pushState, challengeCfg] = await Promise.all([
    fetchCollection('users'),
    fetchCollection('entries'),
    fetchDoc('config/banter'),
    fetchDoc('config/push'),
    fetchDoc('config/challenge')
  ]);
  // The roster is never legitimately empty; treat it as a fetch failure so we
  // don't hash "everything emptied" and burn an AI call on garbage.
  if (users.length === 0) { console.error('empty roster (fetch failure?) - aborting'); process.exit(1); }

  if (TEST_USER) {
    const u = users.find(x => x.id === TEST_USER);
    if (!u?.push?.enabled) { console.error(`user ${TEST_USER} not found or push not enabled`); process.exit(1); }
    const ok = await sendPush(u, { title: 'Team Lift test', body: 'Push works. Now go do the challenge, legend.' });
    process.exit(ok ? 0 : 1);
  }

  const hashes = computeHashes(users, entries, today);
  const changed = changedSections(hashes, banter?.hashes);
  const work = decidePushWork({ users, entries, pushState, now, today });
  log(`changed=[${changed.join(',')}] morningDue=${work.morningDue}(${work.morning.length}) ` +
      `eveningDue=${work.eveningDue}(${work.evening.length}) skipMorning=${work.skipMorning}`);

  // Push-state advances that need no copy: due windows with nobody to send
  // to, and a fully missed morning.
  const pushStatePatch = {};
  if ((work.morningDue && work.morning.length === 0) || work.skipMorning) pushStatePatch.lastMorning = today;
  if (work.eveningDue && work.evening.length === 0) pushStatePatch.lastEvening = today;

  const needCopy = changed.length > 0 || work.morning.length > 0 || work.evening.length > 0;

  if (!needCopy) {
    log('no copy needed - bumping banter date only');
    await patch('config/banter', { date: today }, ['date']);
    if (Object.keys(pushStatePatch).length) {
      await patch('config/push', pushStatePatch, Object.keys(pushStatePatch));
    }
    return;
  }

  // One Claude call for everything: context in, copy out.
  const workdir = mkdtempSync(join(tmpdir(), 'teamlift-'));
  let copy;
  try {
    const context = buildContext({
      users, entries, banter, challengeStart: challengeCfg?.startDate ?? today,
      changed, morning: work.morning, evening: work.evening, today
    });
    writeFileSync(join(workdir, 'context.json'), JSON.stringify(context, null, 2));
    log(`invoking claude (sonnet) for sections=[${changed.join(',')}] pushes=${context.pushes.length}`);
    execFileSync('claude', [
      '-p', `/copywriter ${workdir}`,
      '--model', 'sonnet',
      '--allowedTools', 'Read', 'Write',
      '--max-turns', '15'
    ], { cwd: REPO, stdio: 'inherit' });
    copy = JSON.parse(readFileSync(join(workdir, 'copy.json'), 'utf8'));
    const verdict = validateCopy(copy, context);
    if (!verdict.ok) {
      console.error('copy rejected:\n  ' + verdict.errors.join('\n  '));
      process.exit(1); // nothing advanced; next tick retries
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  // Banter PATCH: changed cards + new feed lines + history + date + hashes,
  // all in one masked write. Nothing outside the mask is touched.
  if (changed.length > 0) {
    const obj = { date: today, hashes };
    const paths = ['date', 'hashes.weight', 'hashes.steps', 'hashes.workouts', 'hashes.feed'];
    const cardSections = changed.filter(s => s !== 'feed' && copy.cards?.[s]);
    if (cardSections.length) {
      obj.cards = Object.fromEntries(cardSections.map(s => [s, copy.cards[s]]));
      paths.push(...cardSections.map(s => maskPath('cards', s)));
    }
    const feedIds = Object.keys(copy.feed ?? {});
    if (feedIds.length) {
      const metaByEntry = new Map(entries.map(e => [e.id, e.updatedAt ?? '']));
      obj.feed = copy.feed;
      obj.feedMeta = Object.fromEntries(feedIds.map(id => [id, metaByEntry.get(id) ?? '']));
      paths.push(...feedIds.map(id => maskPath('feed', id)));
      paths.push(...feedIds.map(id => maskPath('feedMeta', id)));
    }
    if (cardSections.length) {
      obj.history = [...(banter?.history ?? []),
        { ts: today, sections: changed, cards: obj.cards }].slice(-8);
      paths.push('history');
    }
    await patch('config/banter', obj, paths);
    log(`banter updated: cards=[${cardSections.join(',')}] feedLines=${feedIds.length}`);
  } else {
    await patch('config/banter', { date: today }, ['date']);
  }

  // Sends. lastMorning/lastEvening only advance when every targeted send was
  // handled (delivered or dead-subscription-disabled), so a transient failure
  // retries next hour without re-spamming the ones that worked... acceptable
  // for a crew this size; a flaky push service is the rare case.
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
