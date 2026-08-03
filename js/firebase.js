import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, addDoc, serverTimestamp, FieldPath, deleteField
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
// IndexedDB persistence: repeat visits paint instantly from the local cache
// (onSnapshot fires with cached data first) and live updates stream in behind.
// experimentalAutoDetectLongPolling: fall back when QUIC/WebChannel flakes
// (ERR_QUIC_PROTOCOL_ERROR / Listen 400) instead of looping noisy reconnects.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalAutoDetectLongPolling: true
});

const millis = (ts) => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;

export function subscribeAll(onChange) {
  const data = { users: [], entries: [], challenge: null, banter: null };
  const emit = () => onChange({ ...data });

  const unsubs = [
    onSnapshot(collection(db, 'users'), (snap) => {
      data.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }),
    onSnapshot(collection(db, 'entries'), (snap) => {
      data.entries = snap.docs.map(d => {
        const e = d.data();
        return { id: d.id, ...e, updatedAt: millis(e.updatedAt) };
      });
      emit();
    }),
    onSnapshot(doc(db, 'config', 'challenge'), (snap) => {
      data.challenge = snap.exists() ? snap.data() : null;
      emit();
    }),
    // Daily AI-written banter (written by the local refresh-banter cron job);
    // the app falls back to js/lib/banter.js templates when absent or stale.
    onSnapshot(doc(db, 'config', 'banter'), (snap) => {
      data.banter = snap.exists() ? snap.data() : null;
      emit();
    })
  ];
  return () => unsubs.forEach(u => u());
}

export async function createUser({ name, pin, color }) {
  const ref = await addDoc(collection(db, 'users'), {
    name, pin, color, createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function saveEntry(userId, userName, date, fields) {
  const ref = doc(db, 'entries', `${userId}_${date}`);
  await setDoc(ref, {
    userId, name: userName, date,
    ...fields,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { mergeFields: ['userId', 'name', 'date', 'updatedAt', 'createdAt', ...Object.keys(fields)] });
  // Wake the tick so Aiden reacts to a big log within a minute or so instead of
  // on the next hour. Best-effort: a failure here just means the normal
  // stale-scan sweep picks it up (see scripts/lib/decide.mjs).
  pokeAiden().catch(() => {});
}

/**
 * Stamp `config/banter.pendingAt`. The orchestrator's cheap probe compares it
 * against `threadScanAt` to decide whether a tick needs to fetch anything at
 * all, which is what lets the job run every 60s for ~2 document reads when
 * idle. See scripts/lib/decide.mjs probeWork().
 */
export async function pokeAiden() {
  await setDoc(doc(db, 'config', 'banter'),
    { pendingAt: new Date().toISOString() },
    { mergeFields: ['pendingAt'] });
}

export async function updateUserPush(userId, push) {
  await setDoc(doc(db, 'users', userId), { push }, { mergeFields: ['push'] });
}

/**
 * One user's reaction on an entry (FieldPath so concurrent reacts don't clobber).
 * Pass emoji null to clear. Shape: entries/{id}.reactions.{userId} = emoji.
 */
export async function writeEntryReaction(entryId, userId, emoji) {
  if (!entryId || !userId) return;
  await setDoc(
    doc(db, 'entries', entryId),
    { reactions: { [userId]: emoji ?? deleteField() } },
    { mergeFields: [new FieldPath('reactions', userId)] }
  );
}

// Aiden threads live on config/banter.threads (see js/lib/threads.js + CLAUDE.md).
//
// Writes ONE thread key via a FieldPath, never the whole map. The old full-map
// replace meant two blokes commenting at the same time clobbered each other,
// and the hourly tick (which also rewrote the whole map from a snapshot taken
// before a 1-3 minute model call) destroyed anything posted in between.
// FieldPath is required rather than a dotted string because entry ids contain
// hyphens, which Firestore's field-path parser rejects.
//
// Passing `null` removes the key outright (deleteField), so binning the last
// comment in a thread does not leave `{messages: []}` behind forever.
//
// `pendingAt` rides along in the same write (one round trip, and the tick can
// never see the comment without the marker that wakes it).
export async function writeBanterThread(target, thread) {
  await setDoc(
    doc(db, 'config', 'banter'),
    {
      threads: { [target]: thread ?? deleteField() },
      pendingAt: new Date().toISOString()
    },
    { mergeFields: [new FieldPath('threads', target), 'pendingAt'] }
  );
}
