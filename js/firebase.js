import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
// IndexedDB persistence: repeat visits paint instantly from the local cache
// (onSnapshot fires with cached data first) and live updates stream in behind.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
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
}

export async function updateUserPush(userId, push) {
  await setDoc(doc(db, 'users', userId), { push }, { mergeFields: ['push'] });
}

// Aiden threads live on config/banter.threads (see js/lib/threads.js + CLAUDE.md).
// Full-map replace of `threads` — callers pass the complete map from live state
// after a local append/delete (acceptable race for a small trusted group).
export async function writeBanterThreads(threads) {
  await setDoc(doc(db, 'config', 'banter'), { threads }, { mergeFields: ['threads'] });
}
