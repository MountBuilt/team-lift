// Web push opt-in/out. Not in js/lib because it touches Notification,
// PushManager and Firestore. iOS shows these APIs only in an installed PWA
// (16.4+), so pushSupported() doubles as the "installed?" check.
import { VAPID_PUBLIC_KEY } from './push-config.js';
import { updateUserPush } from './firebase.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function enablePush(userId) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  const { endpoint, keys } = sub.toJSON();
  await updateUserPush(userId, {
    enabled: true,
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    updatedAt: new Date().toISOString()
  });
  return { ok: true };
}

export async function disablePush(userId, user) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  await updateUserPush(userId, {
    ...(user.push || {}),
    enabled: false,
    updatedAt: new Date().toISOString()
  });
}
