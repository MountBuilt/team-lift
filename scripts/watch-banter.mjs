#!/usr/bin/env node
// Always-on NUC watcher: Firestore onSnapshot on config/banter wakes the tick
// as soon as a client stamps pendingAt (comment / pokeAiden / writeBanterThread).
//
// Premium path: event-first replies. teamlift-banter.timer (30s) is the safety
// net for clock-driven work (report, morning/evening push) and missed events.
//
// FREE SPARK PLAN: do not poll. A realtime listener on one document costs:
//   - 1 read on attach
//   - 1 read per server-side change to that document
// Idle time is free. Spawning the tick still uses REST probes (2 docs) only when
// we decide to run — and refresh-banter.sh single-flights so timer+event never
// double-send.
//
// Ops: docs/ops-nuc.md
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldWakeOnBanter, WAKE_DEBOUNCE_MS } from './lib/wake.mjs';

// Same public client config the web app ships (js/config.js) — not a secret.
const firebaseConfig = {
  apiKey: 'AIzaSyAWOzfMn7YjxaqSr2qx6zTLRE0_xs9VpZI',
  authDomain: 'team-lift-app.firebaseapp.com',
  projectId: 'team-lift-app',
  storageBucket: 'team-lift-app.firebasestorage.app',
  messagingSenderId: '392861872242',
  appId: '1:392861872242:web:673bb846b9e7cc508d92eb'
};

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const TICK = join(HERE, 'refresh-banter.sh');

const log = (...a) => console.log(new Date().toISOString(), ...a);

initializeApp(firebaseConfig);
const db = getFirestore();

let prevPendingAt = '';
let isFirst = true;
let debounceTimer = null;
let pendingReason = null;

function scheduleTick(reason) {
  pendingReason = reason;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const why = pendingReason || 'event';
    pendingReason = null;
    runTick(why);
  }, WAKE_DEBOUNCE_MS);
}

function runTick(reason) {
  log(`wake=${reason} spawning tick`);
  const child = spawn('bash', [TICK], {
    cwd: REPO,
    env: {
      ...process.env,
      TEAM_LIFT_WAKE: reason,
      // Match systemd unit PATH so grok/node resolve under a minimal env.
      PATH: [
        process.env.HOME + '/.grok/bin',
        process.env.HOME + '/.local/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        process.env.PATH || ''
      ].join(':')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let out = '';
  child.stdout.on('data', (b) => { out += b; process.stdout.write(b); });
  child.stderr.on('data', (b) => { out += b; process.stderr.write(b); });
  child.on('error', (err) => log(`tick spawn error: ${err.message}`));
  child.on('close', (code) => {
    const idle = /\nidle\n/.test(`\n${out}`) || out.trim().endsWith('\nidle') || /^idle$/m.test(out);
    log(`tick done wake=${reason} exit=${code}${idle ? ' idle' : ''}`);
  });
}

log(`watching config/banter (debounce=${WAKE_DEBOUNCE_MS}ms) repo=${REPO}`);

onSnapshot(
  doc(db, 'config', 'banter'),
  (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const pendingAt = typeof data.pendingAt === 'string' ? data.pendingAt : '';
    const decision = shouldWakeOnBanter({
      pendingAt,
      prevPendingAt,
      isFirstSnapshot: isFirst
    });
    isFirst = false;
    prevPendingAt = decision.nextPendingAt;
    if (!decision.wake) return;
    scheduleTick(decision.reason);
  },
  (err) => {
    log(`onSnapshot error: ${err.message}`);
    // Let systemd Restart=always pick us up if the stream is dead.
    process.exit(1);
  }
);

function shutdown(sig) {
  log(`signal ${sig}, exiting`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
