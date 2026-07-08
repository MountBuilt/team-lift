import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const millis = (ts) => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;

export function subscribeAll(onChange) {
  const data = { users: [], entries: [], challenge: null };
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
