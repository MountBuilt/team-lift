# Push Notifications + Pipeline Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user opt-in web push (morning motivation + evening nag) sent from the hourly Mac job, with the banter pipeline reworked so Claude only writes copy.

**Architecture:** Client subscribes via the service worker (raw VAPID Web Push, no FCM) and stores the subscription on the user's Firestore doc. A Node orchestrator replaces the bash+python hourly pipeline: fetch once, decide work (changed banter sections, morning pushes due after 7:30, evening nags after 20:30 for anyone with nothing logged), make ONE `claude -p --model sonnet` call that reads a pre-built context file and writes a copy JSON, then the orchestrator does every Firestore PATCH and web-push send itself.

**Tech Stack:** Vanilla ES modules (no build), Firestore REST, Node 26 (`node --test`), `web-push` npm package (local tooling in `scripts/` only, never served).

**Spec:** `docs/superpowers/specs/2026-07-13-push-notifications-design.md`

## Global Constraints

- Spark free tier only: no billing, no Cloud Functions, no FCM.
- Voice: over-the-top Aussie gym banter, swearing intended. **No em-dashes (—) anywhere.** Say "workout", never "gym". No persistent nicknames. Never state absolute weight in kg.
- All dates are local `YYYY-MM-DD` strings; use `js/lib/dates.js` helpers, never `new Date(str)`.
- `js/lib/` stays pure (no Firebase, no DOM). Sender-side pure logic lives in `scripts/lib/*.mjs`, tested from `tests/`.
- Every Firestore REST PATCH must carry `updateMask.fieldPaths` for exactly the fields written; a bare PATCH wipes the rest of the doc. Hyphenated field-path segments (entry doc ids) must be backtick-quoted and the backticks percent-encoded.
- Firestore doc shapes:
  - `users/{id}.push = { enabled: bool, endpoint: string, keys: { p256dh, auth }, updatedAt: ISO string }`
  - `config/push = { lastMorning: 'YYYY-MM-DD', lastEvening: 'YYYY-MM-DD' }`
  - `config/banter` unchanged: `date`, `cards.{weight,steps,workouts}`, `feed.{entryId}`, `feedMeta.{entryId}`, `hashes.{weight,steps,workouts,feed}`, `history[]` (last 8 of `{ts, sections, cards}`).
- Push windows (Mac local time = Sydney): morning sends from 07:30, but not after 20:30 (a fully missed morning is skipped, never sent at night); evening sends from 20:30, only to opted-in users with zero entries dated today.
- AI copy call: `claude -p "/copywriter <workdir>" --model sonnet --allowedTools Read Write --max-turns 15`. Claude never uses curl and never PATCHes.
- Firestore REST public config: `KEY=AIzaSyAWOzfMn7YjxaqSr2qx6zTLRE0_xs9VpZI`, `BASE=https://firestore.googleapis.com/v1/projects/team-lift-app/databases/(default)/documents` (public client identifiers, fine to commit).
- Commits: end messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Known accepted effect: the hash format changes from python `json.dumps` to JS `JSON.stringify` (float formatting differs), so the first orchestrator run sees every section "changed" and regenerates all banter once. Harmless.
- Firestore rules already allow all reads/writes on `users/*` and `config/*`; no rules change needed.

---

### Task 1: VAPID keys, scripts package, client key constant

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/.gitignore`
- Create: `js/push-config.js`
- Create (outside repo): `~/.config/teamlift/vapid-private.key`

**Interfaces:**
- Produces: `VAPID_PUBLIC_KEY` (string export from `js/push-config.js`), consumed by Task 4 (client) and Task 8 (orchestrator). Private key file consumed by Task 8.

- [ ] **Step 1: Create `scripts/package.json` and `scripts/.gitignore`**

`scripts/package.json`:
```json
{
  "name": "teamlift-scripts",
  "private": true,
  "type": "module",
  "description": "Local sender tooling for the hourly launchd job. Never served by the site.",
  "dependencies": {
    "web-push": "^3.6.7"
  }
}
```

`scripts/.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Install**

Run: `cd /Users/simongilmore/Projects/team-lift/scripts && npm install`
Expected: `added N packages`, creates `scripts/node_modules/` (ignored) and `scripts/package-lock.json` (committed).

- [ ] **Step 3: Generate the VAPID keypair**

Run: `cd /Users/simongilmore/Projects/team-lift/scripts && npx web-push generate-vapid-keys`
Expected output contains a `Public Key:` and `Private Key:` (both base64url strings).

- [ ] **Step 4: Store the private key**

```bash
mkdir -p ~/.config/teamlift
printf '%s' '<PRIVATE KEY FROM STEP 3>' > ~/.config/teamlift/vapid-private.key
chmod 600 ~/.config/teamlift/vapid-private.key
```
Verify: `wc -c ~/.config/teamlift/vapid-private.key` prints a nonzero byte count (~43).

- [ ] **Step 5: Create `js/push-config.js` with the public key**

```js
// Web Push VAPID public key (public identifier, safe to commit). The private
// half lives in ~/.config/teamlift/vapid-private.key on the sender Mac.
export const VAPID_PUBLIC_KEY = '<PUBLIC KEY FROM STEP 3>';
```

- [ ] **Step 6: Commit**

```bash
git add scripts/package.json scripts/package-lock.json scripts/.gitignore js/push-config.js
git commit -m "feat(push): VAPID keypair, scripts package with web-push

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Service worker push handlers

**Files:**
- Modify: `sw.js` (append after the existing fetch handler, line 33)

**Interfaces:**
- Consumes: push payload JSON `{ title, body }` (produced by Task 8's sender).
- Produces: notification display + click-to-open. No exports.

- [ ] **Step 1: Append push + notificationclick handlers to `sw.js`**

```js
// Web push: payload is JSON { title, body } sent by scripts/orchestrator.mjs.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { /* malformed payload: show fallback */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Team Lift', {
    body: data.body || 'Get after it.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('.');
    })
  );
});
```

- [ ] **Step 2: Syntax check**

Run: `node --check sw.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "feat(push): service worker push + notificationclick handlers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Firestore REST helpers (`scripts/lib/firestore-rest.mjs`)

**Files:**
- Create: `scripts/lib/firestore-rest.mjs`
- Test: `tests/firestore-rest.test.js`

**Interfaces:**
- Produces (consumed by Tasks 5, 6, 8):
  - `decodeValue(v)` / `decodeFields(fields)` — Firestore REST Value(s) → plain JS
  - `encodeValue(v)` / `encodeFields(obj)` — plain JS → Firestore REST Value(s); integers → `integerValue`, non-integers → `doubleValue`
  - `maskPath(...segments)` → dotted field path, backtick-quoting segments not matching `[A-Za-z_][A-Za-z0-9_]*`
  - `buildPatchUrl(docPath, fieldPaths)` → full PATCH URL with key + percent-encoded updateMask
  - `async fetchCollection(name)` → `[{ id, ...fields }]`, paginated (pageSize 300, follows `nextPageToken`)
  - `async fetchDoc(path)` → plain object or `null` on 404
  - `async patchDoc(docPath, obj, fieldPaths)` → PATCH with mask, throws on non-2xx
  - `BASE`, `KEY` constants

- [ ] **Step 1: Write the failing tests**

`tests/firestore-rest.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeValue, decodeFields, encodeValue, encodeFields, maskPath, buildPatchUrl, BASE, KEY
} from '../scripts/lib/firestore-rest.mjs';

test('decodeValue handles scalars, timestamps, arrays, maps', () => {
  assert.equal(decodeValue({ stringValue: 'hi' }), 'hi');
  assert.equal(decodeValue({ integerValue: '42' }), 42);
  assert.equal(decodeValue({ doubleValue: 1.5 }), 1.5);
  assert.equal(decodeValue({ booleanValue: true }), true);
  assert.equal(decodeValue({ timestampValue: '2026-07-13T00:00:00Z' }), '2026-07-13T00:00:00Z');
  assert.equal(decodeValue({ nullValue: null }), null);
  assert.deepEqual(decodeValue({ arrayValue: { values: [{ stringValue: 'a' }] } }), ['a']);
  assert.deepEqual(
    decodeValue({ mapValue: { fields: { k: { integerValue: '1' } } } }),
    { k: 1 }
  );
  assert.deepEqual(decodeValue({ arrayValue: {} }), []);
});

test('encode/decode round-trips plain objects', () => {
  const obj = { date: '2026-07-13', n: 3, w: 82.5, on: true, tags: ['a', 'b'], nested: { x: 1 } };
  assert.deepEqual(decodeFields(encodeFields(obj)), obj);
});

test('encodeValue picks integerValue for whole numbers', () => {
  assert.deepEqual(encodeValue(10), { integerValue: '10' });
  assert.deepEqual(encodeValue(10.5), { doubleValue: 10.5 });
});

test('maskPath backtick-quotes hyphenated segments only', () => {
  assert.equal(maskPath('cards', 'weight'), 'cards.weight');
  assert.equal(maskPath('feed', 'u2_2026-07-08'), 'feed.`u2_2026-07-08`');
});

test('buildPatchUrl percent-encodes backticks in the mask', () => {
  const url = buildPatchUrl('config/banter', ['date', 'feed.`u2_2026-07-08`']);
  assert.ok(url.startsWith(`${BASE}/config/banter?key=${KEY}&`));
  assert.ok(url.includes('updateMask.fieldPaths=date'));
  assert.ok(url.includes('updateMask.fieldPaths=feed.%60u2_2026-07-08%60'));
  assert.ok(!url.includes('`'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/simongilmore/Projects/team-lift && node --test tests/firestore-rest.test.js`
Expected: FAIL, cannot find module `scripts/lib/firestore-rest.mjs`.

- [ ] **Step 3: Implement `scripts/lib/firestore-rest.mjs`**

```js
// Firestore REST helpers for the sender pipeline. Public client identifiers
// (same key the web app ships in js/config.js), not secrets.
export const KEY = 'AIzaSyAWOzfMn7YjxaqSr2qx6zTLRE0_xs9VpZI';
export const BASE = 'https://firestore.googleapis.com/v1/projects/team-lift-app/databases/(default)/documents';

export function decodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decodeValue(v)]));
}

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encodeValue(v)]));
}

// Firestore only accepts bare field-path segments matching
// [A-Za-z_][A-Za-z0-9_]*; anything else (entry ids contain hyphens) must be
// backtick-quoted.
export function maskPath(...segments) {
  return segments
    .map(s => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '`' + s + '`'))
    .join('.');
}

export function buildPatchUrl(docPath, fieldPaths) {
  const mask = fieldPaths.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
  return `${BASE}/${docPath}?key=${KEY}&${mask}`;
}

const docIdOf = (doc) => doc.name.slice(doc.name.lastIndexOf('/') + 1);

export async function fetchCollection(name) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${name}?key=${KEY}&pageSize=300` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`GET ${name}: HTTP ${resp.status}`);
    const json = await resp.json();
    for (const d of json.documents || []) out.push({ id: docIdOf(d), ...decodeFields(d.fields) });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function fetchDoc(path) {
  const resp = await fetch(`${BASE}/${path}?key=${KEY}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GET ${path}: HTTP ${resp.status}`);
  return decodeFields((await resp.json()).fields);
}

export async function patchDoc(docPath, obj, fieldPaths) {
  const resp = await fetch(buildPatchUrl(docPath, fieldPaths), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeFields(obj) })
  });
  if (!resp.ok) throw new Error(`PATCH ${docPath}: HTTP ${resp.status} ${await resp.text()}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/firestore-rest.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/firestore-rest.mjs tests/firestore-rest.test.js
git commit -m "feat(sender): firestore REST helpers with pagination and mask-safe PATCH

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Client opt-in (push module, firebase write, Me-view toggle)

**Files:**
- Create: `js/push.js`
- Modify: `js/firebase.js` (append export)
- Modify: `js/ui/me.js` (new section + handler)
- Modify (maybe): `css/tailwind.css` via rebuild

**Interfaces:**
- Consumes: `VAPID_PUBLIC_KEY` from `js/push-config.js` (Task 1).
- Produces: `pushSupported()`, `async enablePush(userId)` → `{ ok, reason? }`, `async disablePush(userId, user)`; `updateUserPush(userId, push)` in `js/firebase.js`. Writes `users/{id}.push` in the Task-1 shape.

- [ ] **Step 1: Add `updateUserPush` to `js/firebase.js`**

Append after `saveEntry`:
```js
export async function updateUserPush(userId, push) {
  await setDoc(doc(db, 'users', userId), { push }, { mergeFields: ['push'] });
}
```

- [ ] **Step 2: Create `js/push.js`**

```js
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
```

- [ ] **Step 3: Add the toggle section to `js/ui/me.js`**

Add import at the top:
```js
import { pushSupported, enablePush, disablePush } from '../push.js';
```

Compute before `container.innerHTML`:
```js
const pushOn = me.push?.enabled === true;
```

Insert this section into the template between the MY ENTRIES `</section>` and the logout button:
```js
      <section class="rounded-2xl bg-card border border-edge p-4">
        <h3 class="mb-2 font-black">NOTIFICATIONS</h3>
        ${pushSupported() ? `
        <p class="text-sm text-neutral-400">Morning motivation plus an evening kick up the arse if you haven't logged anything.</p>
        <button id="push-toggle" class="mt-3 w-full rounded-xl border border-edge py-3 text-sm font-black
          ${pushOn ? 'text-green-400' : 'text-neutral-400'}">
          ${pushOn ? 'NOTIFICATIONS ON' : 'TURN ON NOTIFICATIONS'}</button>`
      : '<p class="text-sm text-neutral-500">Install the app to your home screen first, then this switch turns up.</p>'}
      </section>
```

Add the handler after the existing `#logout` listener (the Firestore write triggers `onSnapshot`, which re-renders the whole view, so no manual state flip is needed on success):
```js
  const toggle = container.querySelector('#push-toggle');
  toggle?.addEventListener('click', async () => {
    toggle.disabled = true;
    toggle.textContent = 'WORKING…';
    try {
      if (pushOn) {
        await disablePush(me.id, me);
      } else {
        const res = await enablePush(me.id);
        if (!res.ok) {
          toggle.textContent = 'BLOCKED. ALLOW NOTIFICATIONS IN SETTINGS.';
          return;
        }
      }
    } catch {
      toggle.textContent = 'FAILED. TAP TO TRY AGAIN.';
      toggle.disabled = false;
    }
  });
```

- [ ] **Step 4: Rebuild Tailwind (new utility classes may be in play)**

Run: `npx tailwindcss@3.4.17 -i css/tailwind.source.css -o css/tailwind.css --minify`
Expected: exits 0. `git status` may or may not show `css/tailwind.css` changed; commit it if it did.

- [ ] **Step 5: Syntax checks + full test suite**

Run: `node --check js/push.js && node --check js/ui/me.js && node --check js/firebase.js && node --test`
Expected: checks pass, all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add js/push.js js/firebase.js js/ui/me.js css/tailwind.css
git commit -m "feat(push): per-user opt-in toggle on Me view, subscription stored on user doc

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Decision logic (`scripts/lib/decide.mjs`)

**Files:**
- Create: `scripts/lib/decide.mjs`
- Test: `tests/decide.test.js`

**Interfaces:**
- Consumes: plain decoded docs from Task 3 (`users` with optional `.push`, `entries` with `date`/`userId`/`weight`/`steps`/`workoutParts`/`updatedAt`).
- Produces (consumed by Task 8):
  - `computeHashes(users, entries, today)` → `{ weight, steps, workouts, feed }` (sha256 hex)
  - `changedSections(computed, stored)` → subset of `['weight','steps','workouts','feed']`
  - `decidePushWork({ users, entries, pushState, now, today })` → `{ morningDue, eveningDue, skipMorning, morning: [user], evening: [user] }`
  - Constants `MORNING_AFTER = '07:30'`, `MORNING_CUTOFF = '20:30'`, `EVENING_AFTER = '20:30'`

- [ ] **Step 1: Write the failing tests**

`tests/decide.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHashes, changedSections, decidePushWork } from '../scripts/lib/decide.mjs';

const users = [
  { id: 'u1', name: 'Simon', push: { enabled: true, endpoint: 'https://x/1', keys: { p256dh: 'p', auth: 'a' } } },
  { id: 'u2', name: 'Dave', push: { enabled: false, endpoint: 'https://x/2', keys: { p256dh: 'p', auth: 'a' } } },
  { id: 'u3', name: 'Phill' }
];
const entries = [
  { id: 'u1_2026-07-13', userId: 'u1', date: '2026-07-13', weight: 82.5, updatedAt: 't1' },
  { id: 'u1_2026-07-12', userId: 'u1', date: '2026-07-12', steps: 10000, updatedAt: 't2' },
  { id: 'u3_2026-07-12', userId: 'u3', date: '2026-07-12', workoutParts: ['legs'], updatedAt: 't3' }
];
const at = (h, m) => new Date(2026, 6, 13, h, m); // local 2026-07-13
const TODAY = '2026-07-13';

test('hashes are stable and section-scoped', () => {
  const a = computeHashes(users, entries, TODAY);
  const b = computeHashes(users, [...entries].reverse(), TODAY);
  assert.deepEqual(a, b); // order-independent
  const stepsChanged = entries.map(e =>
    e.id === 'u1_2026-07-12' ? { ...e, steps: 12000 } : e);
  const c = computeHashes(users, stepsChanged, TODAY);
  assert.notEqual(c.steps, a.steps);
  assert.equal(c.weight, a.weight);
  assert.equal(c.workouts, a.workouts);
});

test('a rename invalidates every section', () => {
  const a = computeHashes(users, entries, TODAY);
  const renamed = users.map(u => u.id === 'u2' ? { ...u, name: 'Davo' } : u);
  const b = computeHashes(renamed, entries, TODAY);
  for (const k of ['weight', 'steps', 'workouts', 'feed']) assert.notEqual(b[k], a[k]);
});

test('changedSections diffs against stored hashes', () => {
  const computed = computeHashes(users, entries, TODAY);
  assert.deepEqual(changedSections(computed, computed), []);
  assert.deepEqual(
    changedSections(computed, { ...computed, feed: 'stale' }), ['feed']);
  assert.deepEqual(
    changedSections(computed, {}),
    ['weight', 'steps', 'workouts', 'feed']);
});

test('nothing due before 07:30', () => {
  const w = decidePushWork({ users, entries, pushState: {}, now: at(7, 0), today: TODAY });
  assert.equal(w.morningDue, false);
  assert.equal(w.eveningDue, false);
  assert.deepEqual(w.morning, []);
  assert.deepEqual(w.evening, []);
});

test('morning due at 08:00 targets only enabled subscriptions', () => {
  const w = decidePushWork({ users, entries, pushState: {}, now: at(8, 0), today: TODAY });
  assert.equal(w.morningDue, true);
  assert.deepEqual(w.morning.map(u => u.id), ['u1']);
});

test('morning already sent today does nothing', () => {
  const w = decidePushWork({
    users, entries, pushState: { lastMorning: TODAY }, now: at(8, 0), today: TODAY });
  assert.equal(w.morningDue, false);
});

test('morning fully missed is skipped, not sent at night', () => {
  const w = decidePushWork({ users, entries, pushState: { lastEvening: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.morningDue, false);
  assert.equal(w.skipMorning, true);
  assert.deepEqual(w.morning, []);
});

test('evening due at 21:00 targets enabled users with no entry today', () => {
  const w = decidePushWork({ users, entries, pushState: { lastMorning: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.eveningDue, true);
  assert.deepEqual(w.evening, []); // u1 logged today; u2 disabled; u3 never opted in
  const quiet = entries.filter(e => e.date !== TODAY);
  const w2 = decidePushWork({ users, entries: quiet, pushState: { lastMorning: TODAY }, now: at(21, 0), today: TODAY });
  assert.deepEqual(w2.evening.map(u => u.id), ['u1']);
});

test('evening already sent today does nothing', () => {
  const w = decidePushWork({
    users, entries, pushState: { lastMorning: TODAY, lastEvening: TODAY }, now: at(21, 0), today: TODAY });
  assert.equal(w.eveningDue, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/decide.test.js`
Expected: FAIL, cannot find module `scripts/lib/decide.mjs`.

- [ ] **Step 3: Implement `scripts/lib/decide.mjs`**

```js
// Pure decisions for the hourly tick: which banter sections changed and which
// pushes are due. No network, no clock reads; callers pass `now` and `today`.
import { createHash } from 'node:crypto';
import { addDays } from '../../js/lib/dates.js';

export const MORNING_AFTER = '07:30';
export const MORNING_CUTOFF = '20:30'; // a fully missed morning is skipped, never sent at night
export const EVENING_AFTER = '20:30';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

// Section hashing, ported from the retired python block in
// refresh-banter.sh: hash exactly the data each dashboard section reads, and
// fold the (id, name) roster into every hash so a new member or a rename
// invalidates all four.
export function computeHashes(users, entries, today) {
  const usersKey = users
    .map(u => [u.id, u.name ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const feedStart = addDays(today, -6);

  const weight = [], steps = [], workouts = [], feed = [];
  for (const e of entries) {
    if (typeof e.weight === 'number') weight.push([e.userId, e.date, e.weight]);
    if (typeof e.steps === 'number') steps.push([e.userId, e.date, e.steps]);
    if (Array.isArray(e.workoutParts) && e.workoutParts.length) {
      workouts.push([e.userId, e.date, e.workoutParts]);
    }
    if (e.date && e.date >= feedStart) feed.push([e.id, e.updatedAt ?? '']);
  }
  const byUserDate = (a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1);
  weight.sort(byUserDate); steps.sort(byUserDate); workouts.sort(byUserDate); feed.sort(byUserDate);

  const hash = (rows) =>
    createHash('sha256').update(JSON.stringify([usersKey, rows])).digest('hex');
  return { weight: hash(weight), steps: hash(steps), workouts: hash(workouts), feed: hash(feed) };
}

export function changedSections(computed, stored) {
  return ['weight', 'steps', 'workouts', 'feed']
    .filter(k => computed[k] !== (stored?.[k] ?? ''));
}

export function decidePushWork({ users, entries, pushState, now, today }) {
  const t = hhmm(now);
  const enabled = users.filter(u => u.push?.enabled === true && u.push.endpoint);
  const morningUnsent = (pushState?.lastMorning ?? '') !== today;
  const eveningUnsent = (pushState?.lastEvening ?? '') !== today;

  const morningDue = morningUnsent && t >= MORNING_AFTER && t < MORNING_CUTOFF;
  const skipMorning = morningUnsent && t >= MORNING_CUTOFF;
  const eveningDue = eveningUnsent && t >= EVENING_AFTER;

  let evening = [];
  if (eveningDue) {
    const loggedToday = new Set(entries.filter(e => e.date === today).map(e => e.userId));
    evening = enabled.filter(u => !loggedToday.has(u.id));
  }
  return {
    morningDue, eveningDue, skipMorning,
    morning: morningDue ? enabled : [],
    evening
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/decide.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/decide.mjs tests/decide.test.js
git commit -m "feat(sender): pure tick decisions - section hashes and push due-windows

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Copy context + validation (`scripts/lib/context.mjs`)

**Files:**
- Create: `scripts/lib/context.mjs`
- Test: `tests/push-context.test.js`

**Interfaces:**
- Consumes: decoded docs (Task 3 shapes), `dailyChallenge`/`challengeStreak` from `js/lib/challenge.js`, `addDays` from `js/lib/dates.js`.
- Produces (consumed by Tasks 7 and 8):
  - `buildContext({ users, entries, banter, challengeStart, changed, morning, evening, today })` → the context object written to `context.json`:
    ```
    {
      today, challenge: { name, reps, week },
      users: [{ id, name }],
      entries: [{ id, userId, name, date, weight?, steps?, workoutParts?, dailyChallenge?, updatedAt }],  // all entries, compact
      sections: [...changed],
      currentCards: { weight?, steps?, workouts? },
      history: [...],                       // banter history as-is
      feedNeeds: [{ entryId, name, date, weight?, steps?, workoutParts?, dailyChallenge?, updatedAt }],  // only when 'feed' in changed
      currentFeed: { entryId: line },       // for continuity, never rewritten wholesale
      pushes: [{ kind: 'morning'|'evening', userId, name, streak, recentDays: [entries last 14d] }]
    }
    ```
  - `validateCopy(copy, context)` → `{ ok, errors: [] }` where `copy` is Claude's output:
    ```
    { cards: { <section>: string }, feed: { <entryId>: string }, pushes: [{ userId, kind, title, body }] }
    ```

- [ ] **Step 1: Write the failing tests**

`tests/push-context.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateCopy } from '../scripts/lib/context.mjs';

const TODAY = '2026-07-13';
const users = [{ id: 'u1', name: 'Simon' }, { id: 'u2', name: 'Dave' }];
const entries = [
  { id: 'u1_2026-07-12', userId: 'u1', name: 'Simon', date: '2026-07-12', workoutParts: ['legs'], dailyChallenge: true, updatedAt: 'ts-1' },
  { id: 'u2_2026-07-10', userId: 'u2', name: 'Dave', date: '2026-07-10', steps: 10000, updatedAt: 'ts-2' },
  { id: 'u1_2026-05-01', userId: 'u1', name: 'Simon', date: '2026-05-01', weight: 90, updatedAt: 'ts-0' }
];
const banter = {
  feed: { 'u1_2026-07-12': 'smashed legs.' },
  feedMeta: { 'u1_2026-07-12': 'ts-1' },
  cards: { weight: 'old weight line' },
  history: [{ ts: '2026-07-12', sections: ['feed'], cards: {} }]
};
const base = {
  users, entries, banter, challengeStart: '2026-07-13',
  changed: ['feed'], morning: [users[0]], evening: [], today: TODAY
};

test('buildContext: challenge, feedNeeds, pushes', () => {
  const ctx = buildContext(base);
  assert.equal(ctx.today, TODAY);
  assert.ok(ctx.challenge.name && ctx.challenge.reps > 0);
  // u1_2026-07-12 has a line with matching updatedAt -> not needed;
  // u2_2026-07-10 has no line -> needed; the May entry is outside the 7-day feed window.
  assert.deepEqual(ctx.feedNeeds.map(f => f.entryId), ['u2_2026-07-10']);
  assert.equal(ctx.pushes.length, 1);
  const p = ctx.pushes[0];
  assert.equal(p.kind, 'morning');
  assert.equal(p.userId, 'u1');
  assert.ok(p.recentDays.every(e => e.date >= '2026-06-29')); // 14-day window
});

test('buildContext: changed updatedAt re-flags a feed entry', () => {
  const stale = { ...banter, feedMeta: { 'u1_2026-07-12': 'ts-OLD' } };
  const ctx = buildContext({ ...base, banter: stale });
  assert.deepEqual(ctx.feedNeeds.map(f => f.entryId).sort(),
    ['u1_2026-07-12', 'u2_2026-07-10']);
});

test('validateCopy accepts a complete, clean copy', () => {
  const ctx = buildContext(base);
  const copy = {
    cards: {},
    feed: { 'u2_2026-07-10': 'clocked 10,000 on the dot. Suspiciously round, mate.' },
    pushes: [{ userId: 'u1', kind: 'morning', title: 'Oi Simon', body: `Legs yesterday, good. Today's challenge: ${ctx.challenge.reps} ${ctx.challenge.name}. Get it done.` }]
  };
  assert.deepEqual(validateCopy(copy, ctx), { ok: true, errors: [] });
});

test('validateCopy rejects em-dashes, gym, missing pushes, unknown ids, missing cards', () => {
  const ctx = buildContext({ ...base, changed: ['weight', 'feed'] });
  const bad = {
    cards: { steps: 'not a changed section' }, // also missing the requested weight card
    feed: { 'nope_2026-07-01': 'line', 'u2_2026-07-10': 'went to the gym — hard' },
    pushes: []
  };
  const res = validateCopy(bad, ctx);
  assert.equal(res.ok, false);
  const all = res.errors.join('\n');
  assert.match(all, /em-dash/);
  assert.match(all, /gym/);
  assert.match(all, /missing push/i);
  assert.match(all, /unknown feed/i);
  assert.match(all, /steps/); // card for a section that wasn't requested
  assert.match(all, /missing card for section "weight"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/push-context.test.js`
Expected: FAIL, cannot find module `scripts/lib/context.mjs`.

- [ ] **Step 3: Implement `scripts/lib/context.mjs`**

```js
// Builds the context file the copywriter skill reads, and validates the copy
// it returns. Pure: no network, no clock.
import { dailyChallenge, challengeStreak } from '../../js/lib/challenge.js';
import { addDays } from '../../js/lib/dates.js';

const entryView = (e) => {
  const out = { id: e.id, userId: e.userId, name: e.name, date: e.date, updatedAt: e.updatedAt ?? '' };
  if (typeof e.weight === 'number') out.weight = e.weight;
  if (typeof e.steps === 'number') out.steps = e.steps;
  if (Array.isArray(e.workoutParts) && e.workoutParts.length) out.workoutParts = e.workoutParts;
  if (e.dailyChallenge === true) out.dailyChallenge = true;
  return out;
};

export function buildContext({ users, entries, banter, challengeStart, changed, morning, evening, today }) {
  const challenge = dailyChallenge(today, challengeStart);
  const feedStart = addDays(today, -6);
  const recentStart = addDays(today, -13);
  const feed = banter?.feed ?? {};
  const feedMeta = banter?.feedMeta ?? {};

  const feedNeeds = !changed.includes('feed') ? [] : entries
    .filter(e => e.date && e.date >= feedStart)
    .filter(e => !(e.id in feed) || feedMeta[e.id] !== (e.updatedAt ?? ''))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(e => ({ entryId: e.id, ...entryView(e) }));

  const pushFor = (kind) => (u) => ({
    kind,
    userId: u.id,
    name: u.name,
    streak: challengeStreak(entries, u.id, today),
    recentDays: entries
      .filter(e => e.userId === u.id && e.date >= recentStart)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(entryView)
  });

  return {
    today,
    challenge,
    users: users.map(u => ({ id: u.id, name: u.name })),
    entries: entries.map(entryView),
    sections: [...changed],
    currentCards: banter?.cards ?? {},
    history: banter?.history ?? [],
    feedNeeds,
    currentFeed: feed,
    pushes: [...morning.map(pushFor('morning')), ...evening.map(pushFor('evening'))]
  };
}

const banned = (text, where, errors) => {
  if (/—/.test(text)) errors.push(`em-dash in ${where}`);
  if (/\bgym\b/i.test(text)) errors.push(`"gym" in ${where} (say workout)`);
};

export function validateCopy(copy, context) {
  const errors = [];
  const cards = copy?.cards ?? {};
  const feed = copy?.feed ?? {};
  const pushes = Array.isArray(copy?.pushes) ? copy.pushes : [];

  for (const [k, v] of Object.entries(cards)) {
    if (!context.sections.includes(k)) errors.push(`card "${k}" was not a requested section`);
    if (typeof v !== 'string' || !v.trim() || v.length > 200) errors.push(`card "${k}" empty or over 200 chars`);
    else banned(v, `card "${k}"`, errors);
  }
  // Every requested card section must come back, or the stale card would
  // survive while its hash advances and it never regenerates.
  for (const s of context.sections) {
    if (s !== 'feed' && !(s in cards)) errors.push(`missing card for section "${s}"`);
  }

  const neededIds = new Set(context.feedNeeds.map(f => f.entryId));
  for (const [id, line] of Object.entries(feed)) {
    if (!neededIds.has(id)) errors.push(`unknown feed entry "${id}"`);
    if (typeof line !== 'string' || !line.trim() || line.length > 240) errors.push(`feed line "${id}" empty or over 240 chars`);
    else banned(line, `feed line "${id}"`, errors);
  }
  for (const id of neededIds) {
    if (!(id in feed)) errors.push(`missing feed line for "${id}"`);
  }

  const wanted = new Map(context.pushes.map(p => [`${p.userId}|${p.kind}`, p]));
  const got = new Set();
  for (const p of pushes) {
    const key = `${p?.userId}|${p?.kind}`;
    if (!wanted.has(key)) { errors.push(`unrequested push ${key}`); continue; }
    got.add(key);
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 50) errors.push(`push ${key} title empty or over 50 chars`);
    else banned(p.title, `push ${key} title`, errors);
    if (typeof p.body !== 'string' || !p.body.trim() || p.body.length > 240) errors.push(`push ${key} body empty or over 240 chars`);
    else banned(p.body, `push ${key} body`, errors);
  }
  for (const key of wanted.keys()) {
    if (!got.has(key)) errors.push(`missing push ${key}`);
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/push-context.test.js`
Expected: all PASS. Also run `node --test` to confirm nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/context.mjs tests/push-context.test.js
git commit -m "feat(sender): copywriter context assembly and copy validation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Copywriter skill

**Files:**
- Create: `.claude/skills/copywriter/SKILL.md`
- Reference (copy voice content from): `.claude/skills/refresh-banter/SKILL.md` (do NOT delete it in this task; Task 9 retires it)

**Interfaces:**
- Consumes: `<workdir>/context.json` in the Task 6 `buildContext` shape.
- Produces: `<workdir>/copy.json` in the Task 6 `validateCopy` shape: `{ cards, feed, pushes }`.

- [ ] **Step 1: Create `.claude/skills/copywriter/SKILL.md`**

Frontmatter and job description exactly as below; then splice in, **verbatim from `.claude/skills/refresh-banter/SKILL.md`**, these sections: `## Voice` (lines under that heading), `### Nickname bank` with `#### Delivery rules`, `#### The table`, and `#### Behaviour → eligible nicknames`. Drop the old skill's fetch/PATCH/argument/continuity-mechanics sections (the orchestrator owns all of that now).

```markdown
---
name: copywriter
description: Write banter cards, feed lines, and push notification copy for Team Lift from a pre-built context file (invoked headless by scripts/orchestrator.mjs)
---

# Team Lift copywriter

You write copy for a private fitness challenge app used by a small group of
Aussie men who are mates. This runs unattended - do the whole job and exit;
never ask questions. You make NO network calls: everything you need is in one
JSON file, and your entire output is one JSON file.

## Argument

You are invoked as `/copywriter <workdir>`. Read `<workdir>/context.json`.
Write `<workdir>/copy.json`. Nothing else. Do not run curl, do not touch
Firestore, do not compute hashes or dates.

## Input: context.json

- `today`, `challenge` ({name, reps, week}: today's daily challenge, already
  computed for you)
- `users` (id, name), `entries` (everything logged, compact fields)
- `sections`: which banter cards to rewrite (subset of weight/steps/workouts/
  feed). Empty means no banter work, pushes only.
- `currentCards`, `history` (last runs: {ts, sections, cards}), `currentFeed`:
  what's already live. Use these for continuity - advance the storyline,
  never restate last time's beat with new numbers plugged in. Callbacks to
  an earlier joke are good; the framing must move forward.
- `feedNeeds`: the ONLY entries you write feed lines for. Write one line per
  item, keyed by entryId.
- `pushes`: the notifications to write, one per {userId, kind}. Each has the
  bloke's name, challenge streak, and his last 14 days of entries.

## Output: copy.json

```json
{
  "cards": { "weight": "...", "steps": "...", "workouts": "..." },
  "feed": { "<entryId>": "..." },
  "pushes": [ { "userId": "...", "kind": "morning", "title": "...", "body": "..." } ]
}
```

- `cards`: one key per section in `sections` (omit `feed` here; feed output
  goes in `feed`). One sentence or two short ones, max 160 chars, grounded in
  this week's data. No data yet? Rally the boys to be first.
- `feed`: one line per `feedNeeds` item. Lines render after the bolded name,
  so start with a verb phrase, e.g. `smashed legs + chest. Absolute weapon.`
  No two alike, and never near-identical to anything in `currentFeed` or
  `history`.
- `pushes`: one object per requested push, exactly. Title max 50 chars, body
  max 240. Plain text only, emoji sparingly (💪🔥 fine).

## Push copy

These land on a bloke's lock screen. Brutal, masculine, tough, but focused on
success. Same voice as everything else.

- **morning**: get him moving. Say something true about his recent work (a
  streak to protect, a strong week to keep rolling, or days of nothing to
  call out), then name today's challenge with the actual exercise and reps
  ("40 air squats today, get them done before smoko"). End with a shove.
- **evening**: he has logged NOTHING today and the day is nearly over. Tell
  him straight. One entry, anything, before he sleeps: the challenge reps,
  a walk, even just the scales. Make not-logging feel like letting the boys
  down, but keep the door open - there's still time tonight.
- Use his name or a behaviour-earned nickname (rules below). Never a random
  nickname, never one that contradicts his data.

[VOICE, NICKNAME BANK, DELIVERY RULES, TABLE, AND BEHAVIOUR MAP: copied
verbatim from .claude/skills/refresh-banter/SKILL.md]

## Hard rules

- Never use an em-dash (—) anywhere. Comma, full stop, or plain hyphen.
- Say "workout", never "gym".
- Never state anyone's absolute weight in kg - trends and deltas only.
- Output must be valid JSON, matching the shape above exactly. The
  orchestrator validates it and a failed validation throws your work away.
```

- [ ] **Step 2: Verify the splice**

Run: `grep -c 'Olympic Torch' .claude/skills/copywriter/SKILL.md`
Expected: at least 1 (the nickname table made it in). Also `grep -c 'em-dash' .claude/skills/copywriter/SKILL.md` ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/copywriter/SKILL.md
git commit -m "feat(sender): copywriter skill - pure copy in/out, no network

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Orchestrator + wrapper rewrite

**Files:**
- Create: `scripts/orchestrator.mjs`
- Rewrite: `scripts/refresh-banter.sh` (becomes a thin wrapper; launchd plist stays untouched since path and args don't change)

**Interfaces:**
- Consumes: everything above — Task 3 REST helpers, Task 5 decisions, Task 6 context/validation, Task 7 skill, Task 1 keys, `todayStr` from `js/lib/dates.js`.
- Produces: the hourly entrypoint. Flags: `--dry-run` (full tick incl. Claude, prints intended PATCHes/pushes, writes and sends nothing), `--send-test <userId>` (one canned real push, then exit).

- [ ] **Step 1: Write `scripts/orchestrator.mjs`**

```js
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
```

- [ ] **Step 2: Syntax check + full unit suite**

Run: `node --check scripts/orchestrator.mjs && node --test`
Expected: all PASS.

- [ ] **Step 3: Rewrite `scripts/refresh-banter.sh` as a thin wrapper**

Full new content (replaces everything; the plist keeps calling this same path, so no `launchctl` re-bootstrap is needed):
```bash
#!/bin/bash
# Hourly Team Lift tick, run by launchd (com.teamlift.banter). Thin wrapper:
# all logic lives in scripts/orchestrator.mjs (banter refresh + push sends).
# Uses the Pro subscription via a long-lived token from `claude setup-token`,
# stored in ~/.config/teamlift/claude-token (chmod 600). Safe to run by hand;
# pass --dry-run or --send-test <userId> straight through.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"

exec >>"$LOG" 2>&1
echo "--- $(date) ---"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "No token at $TOKEN_FILE - run: claude setup-token, then paste the token into that file."
  exit 0
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
exec node "$REPO/scripts/orchestrator.mjs" "$@"
```

- [ ] **Step 4: Dry-run against live data**

Run: `cd /Users/simongilmore/Projects/team-lift && node scripts/orchestrator.mjs --dry-run`
Expected: logs `changed=[...]` (likely all four sections, because the hash format changed from python to JS - a known one-time effect), invokes Claude on Sonnet, prints `[dry-run] PATCH config/banter ...` with a mask containing `date`, `hashes.*`, changed `cards.*`; prints `[dry-run] push to ...` lines only if a push window is currently due AND someone has opted in (nobody has yet, so normally none). **No real writes and no real sends.** If the Claude call fails, fix before proceeding; do not weaken validation to pass. (If the nested `claude` call can't authenticate when run bare, use `CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/teamlift/claude-token)" node scripts/orchestrator.mjs --dry-run`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrator.mjs scripts/refresh-banter.sh
git commit -m "feat(sender): node orchestrator - one claude call, script-owned PATCHes and push sends

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Retire the old skill, docs, live verification

**Files:**
- Delete: `.claude/skills/refresh-banter/SKILL.md` (directory too)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything; final integration gate.

- [ ] **Step 1: Delete the superseded skill**

```bash
git rm -r .claude/skills/refresh-banter
```
(The copywriter skill carries its voice content forward; the fetch/PATCH mechanics now live in the orchestrator.)

- [ ] **Step 2: Update `CLAUDE.md`**

In `## Commands`, replace the Tailwind line's neighbourhood by adding after the Firestore rules line:
```markdown
- Hourly tick (banter + pushes) by hand: `bash scripts/refresh-banter.sh`
  (wrapper for `node scripts/orchestrator.mjs`; supports `--dry-run` and
  `--send-test <userId>`; logs to `~/Library/Logs/teamlift-banter.log`)
```

In `## Conventions`, update the banter bullet's pipeline sentence and add a push bullet at the end:
```markdown
- Web push (`js/push.js`, toggle on the Me view): raw VAPID, subscription
  stored on `users/{id}.push`. Sent by `scripts/orchestrator.mjs` on the
  hourly launchd tick: morning motivation from 7:30am (skipped after 8:30pm),
  evening reminder from 8:30pm only if nothing is logged that day; state in
  `config/push` (`lastMorning`/`lastEvening`) so missed ticks self-heal and
  never double-send. Claude (Sonnet) writes all copy via
  `.claude/skills/copywriter` from a pre-built context file and never touches
  the network; the orchestrator owns every fetch, hash, PATCH, and send.
```

- [ ] **Step 3: Full verification**

Run: `node --test`
Expected: all tests PASS.
Run: `node scripts/orchestrator.mjs --dry-run`
Expected: clean tick as in Task 8 Step 4. (If the bare `node` run can't authenticate the nested `claude` call, run `bash scripts/refresh-banter.sh --dry-run` instead and read the result from `tail -40 ~/Library/Logs/teamlift-banter.log`.)

- [ ] **Step 4: One real tick by hand**

Run: `bash scripts/refresh-banter.sh && tail -30 ~/Library/Logs/teamlift-banter.log`
Expected: log block ends with `tick complete` (or `no copy needed - bumping banter date only` on a second immediate run). This performs the one-time full banter regeneration (hash format change) for real. No pushes go out because nobody has opted in yet.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: retire refresh-banter skill, document push pipeline

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: Push to main (deploys via GitHub Pages)**

```bash
git push origin main
```

- [ ] **Step 7: On-phone checklist (manual, for Simon)**

1. Open the installed PWA (may need one close/reopen to pick up the new service worker), Me tab → NOTIFICATIONS → TURN ON → allow the permission prompt. Button should flip to NOTIFICATIONS ON.
2. On the Mac: `node scripts/orchestrator.mjs --send-test <yourUserId>` (user id visible in Firestore console or `curl` of `/users`). A "Team Lift test" notification should land on the phone; tapping it opens the app.
3. Next morning after 7:30, confirm the real morning push arrives and names the day's challenge.
