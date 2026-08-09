# Sledged — Technical Architecture

**Date:** 2026-08-09
**Status:** Approved. Stack is decided.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Expo SDK 56 / React Native 0.85**, TypeScript | New Architecture (Fabric + TurboModules + JSI) is mandatory from SDK 55; the legacy bridge is gone from the codebase. Nothing to configure, nothing to opt into. |
| Routing | **Expo Router** | File-based, gives the web target for free, native stack + tabs. |
| Backend | **Firebase** | See §2. |
| Auth | **Firebase Auth** — Apple + Google native | Free to 50k MAU. Native sheets via `expo-apple-authentication` and `@react-native-google-signin/google-signin`. |
| Database | **Firestore** | Realtime `onSnapshot` and **built-in offline persistence**. |
| Server logic | **Cloud Functions v2** (+ Cloud Scheduler) | Event triggers and cron. Scales to zero. |
| Push | **FCM** via `expo-notifications` | Free. |
| IAP | **RevenueCat** (`react-native-purchases`) | Free under $2.5k/mo tracked revenue. |
| Health | `@kingstinct/react-native-healthkit` (iOS), `react-native-health-connect` (Android) | Both actively maintained 2026. Both need a dev build. |
| LLM | **xAI API, Grok 4.1 Fast** | See §7. |
| State | **Zustand** + Firestore listeners | Small, no boilerplate, no provider tree. |
| Charts | **victory-native** (Skia) | RN-native, no WebView. |
| Tests | **Vitest** (logic), `@firebase/rules-unit-testing` (rules), Maestro (smoke flows) | |
| CI/Build | **EAS Build + EAS Submit**, GitHub Actions for tests | |
| Web | Expo Router web export, hosted on **EAS Hosting** | Invite + landing + policy pages only. |

**Expo Go is not usable.** HealthKit, Health Connect, RevenueCat and native
Google sign-in all need native modules. Development runs on a **dev client**
(`expo-dev-client` + `npx expo prebuild`) from day one. Do not start on Expo Go
and migrate later; that wastes a week.

### Why Firebase and not Supabase

Supabase's Postgres + row-level security is genuinely the better fit for
multi-tenant crews, and this decision was made against that.

1. **Cost floor.** Supabase pauses free projects after 7 days of inactivity,
   so production means Pro at **$25/month = $300/year from day one**. Firebase
   Blaze has no floor; at MVP scale this app costs ~$1-5/month. For an app
   whose stated goal is to cover its own costs at A$2 a head, $300/year is
   ~270 users of pure overhead.
2. **Offline.** Firestore persists and replays writes with no work. People log
   sets in basement gyms with no signal. Supabase has no offline story and you
   would build a write queue yourself.
3. **Realtime.** `onSnapshot` is the shape the whole UI wants.
4. **Auth.** Free to 50k MAU with native Apple/Google.
5. **Head start.** Team Lift's pure logic already assumes this data shape.

**The cost:** multi-tenant rules are harder in Firestore than RLS, and getting
them wrong leaks one crew's data to another. That is bought off with §5 —
custom claims plus a tested rules suite. This is the single most important
piece of engineering in the project.

**Optionality:** all Firestore access goes behind `src/data/` (§9). A later
move to Postgres is a rewrite of one directory, not the app.

---

## 2. Firestore data model

Design rules that fall out of Team Lift's scars:

- **Messages are documents in subcollections, never entries in a map field.**
  Team Lift kept threads as a map on one config doc and whole-map writes
  destroyed comments posted while the model was thinking. The subcollection
  shape makes that class of bug impossible.
- **Denormalise `crewId` onto everything a rule must check.** Rules must never
  need a `get()` (each one costs a read and is where holes get written).
- **Denormalise display name and colour** onto entries and messages so the feed
  renders from one query.
- **Raw bodyweight never touches a crew-readable document.** The entry doc is
  read by every crew member, so it carries only `weightDelta` and a `hasWeight`
  flag. The actual kg lives in `users/{uid}/weights/{date}`, which only its
  owner can read. Any design that puts `weightKg` on the entry breaks the
  product's central privacy promise no matter what the UI renders, because the
  document is readable directly. The client computes the delta on write.

```
users/{uid}
  displayName    string
  colour         string        // hex, from the fixed palette
  crews          string[]      // crew ids, mirrored into custom claims
  entitlement    'free' | 'paid'
  trialStartedAt timestamp|null   // set on FIRST crew join/create, never on install
  trialEndsAt    timestamp|null
  dmTrialUsed    number        // messages sent to DM during trial, cap 20
  blocked        string[]      // uids this user has blocked
  health         { stepsEnabled: bool, workoutsEnabled: bool }
  push           { token: string|null, morning: bool, evening: bool }
  createdAt      timestamp
  deletedAt      timestamp|null

crews/{crewId}
  name           string
  code           string        // 6 chars, uppercase, rotatable
  createdBy      uid
  memberIds      string[]      // max 12, source of truth for membership
  intensity      'savage' | 'standard' | 'clean'
  challengeStart string        // YYYY-MM-DD, anchors challenge rep ramp
  createdAt      timestamp

crews/{crewId}/members/{uid}
  displayName    string        // denormalised
  colour         string
  joinedAt       timestamp
  role           'admin' | 'member'

entries/{uid}_{YYYY-MM-DD}          // CREW-READABLE. Never put a raw kg here.
  userId         uid
  crewIds        string[]      // every crew this user was in when logged
  displayName    string        // denormalised
  date           string        // YYYY-MM-DD, device-local
  weightDelta    number|null   // signed change vs the user's own baseline
  hasWeight      boolean       // did they weigh in, without saying what it was
  steps          number|null
  workoutParts   string[]|null
  dailyChallenge boolean
  source         'manual' | 'health'
  reactions      map<uid, emoji>
  createdAt      timestamp
  updatedAt      timestamp

crews/{crewId}/threads/{threadId}          // 'report' | 'weekly' | entry id
  kind           'report' | 'weekly' | 'feed'
  entryId        string|null
  lastAidenAt    timestamp|null
  pendingSince   timestamp|null    // drives the typing indicator
  updatedAt      timestamp

crews/{crewId}/threads/{threadId}/messages/{msgId}
  kind           'user' | 'aiden'
  userId         uid|null
  displayName    string|null
  text           string          // user <=160, aiden <=240
  role           'report' | 'weekly' | null
  reportDay      string|null     // YYYY-MM-DD for report posts
  targetUserId   uid|null        // set when Aiden addresses one person -> redaction
  deleted        boolean
  moderation     'clean' | 'held' | 'removed'
  createdAt      timestamp

crews/{crewId}/feedLines/{entryId}
  text           string          // <=200
  targetUserId   uid             // whose entry -> drives redaction
  moderation     'clean' | 'held' | 'removed'
  createdAt      timestamp

users/{uid}/weights/{YYYY-MM-DD}    // OWNER-ONLY. The only place a raw kg exists.
  kg             number
  createdAt      timestamp

crews/{crewId}/notebook/current
  text           string          // Aiden's self-maintained crew memory, <=1200 chars
  updatedAt      timestamp

crews/{crewId}/state/aiden
  lastReportDay  string|null     // YYYY-MM-DD
  lastWeeklyKey  string|null     // YYYY-Www
  storylines     [{ id, subject, added, note, days? }]

dms/{uid}/messages/{msgId}
  kind, text, createdAt          // same shape as thread messages

reports/{reportId}                          // moderation reports
  reporterUid, targetType, targetPath, reason, status, createdAt

config/app
  minBuild, killSwitches, announcement
```

**Indexes needed:** `entries` on `(crewIds array-contains, date desc)`,
`(userId, date desc)`. `reports` on `(status, createdAt)`.

**No document is ever deleted by the client.** Deletes are denied in rules;
soft-delete via `deleted: true`. The sole exception is account deletion, run
server-side by a Cloud Function.

---

## 3. Client architecture

```
app/                          Expo Router routes
  (auth)/                     sign-in, onboarding
  (tabs)/                     home, stats, crew, me
  thread/[crewId]/[threadId]  coach chat / feed thread
  dm/                         DM Aiden
  +html.tsx, index.web.tsx    web landing + invite
src/
  data/                       ONLY place that imports firebase
    entries.ts crews.ts threads.ts users.ts
  lib/                        PURE logic, no firebase, no RN imports (see §9)
  ui/                         components
  hooks/
  store/                      zustand
functions/                    Cloud Functions v2 (separate package)
  src/aiden/ src/moderation/ src/crews/ src/account/
  prompts/aiden.md
```

**`src/lib/` is pure and fully tested. `src/data/` is the only Firebase
importer.** This is Team Lift's convention and it is why its logic was
testable under plain Node. Keep it.

**Offline.** Enable Firestore persistence. Writes queue and replay
automatically. The UI renders optimistically from the local cache; show a
subtle "saved locally" state rather than a spinner or an error when offline.

---

## 4. Cloud Functions

| Function | Trigger | Does |
|---|---|---|
| `onEntryWritten` | Firestore `entries/{id}` write | Enqueue a feed-line generation for each of the entry's crews. Debounced 30s so rapid edits produce one line. |
| `generateFeedLine` | Task queue | One xAI call, writes `feedLines/{entryId}`. |
| `onThreadMessage` | Firestore message create, `kind == 'user'` | Set `pendingSince`, enqueue a reply. |
| `generateThreadReply` | Task queue | One xAI call answering all pending humans in one message. |
| `morningReport` | Scheduler, hourly | For each crew whose local 03:00-and-after window has arrived and `lastReportDay != today`, generate and append the report message. |
| `weeklyRecap` | Scheduler, hourly Sunday | Same, keyed on `lastWeeklyKey`. |
| `updateNotebook` | Scheduler, weekly | Rewrite each crew's notebook from the week's threads. |
| `sendPushes` | Scheduler, every 30 min | Morning and evening pushes per user local time, with per-user state so a failure never re-spams. |
| `onCrewMembership` | Firestore `crews/{id}` write | Recompute `crews` custom claim for affected users. |
| `moderateContent` | Called inline by every generator and on user message create | Pre-post filter. Sets `moderation`. |
| `onReport` | Firestore `reports/{id}` create | Immediately hide target, notify operator. |
| `deleteAccount` | Callable | Purge user data, per Apple 5.1.1(v). |
| `revenueCatWebhook` | HTTPS | Update `entitlement`. |

**All model calls are server-side.** The xAI key lives in Secret Manager and
never reaches a client. There is no client-callable "ask Aiden anything"
endpoint that is not rate limited.

**Scheduler runs hourly, not per-minute.** Team Lift's every-30-seconds tick
existed because it had no event triggers. Sledged has them. Hourly + events is
cheaper and simpler.

---

## 5. Security model — the important part

**Membership lives in the auth token as a custom claim.**

`onCrewMembership` writes `{ crews: ['crewA', 'crewB'] }` as a custom claim
whenever `crews/{id}.memberIds` changes. Clients call
`getIdToken(true)` after joining to pick it up.

Rules then read membership straight off the token:

```
function inCrew(crewId) {
  return request.auth != null
      && request.auth.token.crews is list
      && request.auth.token.crews.hasAny([crewId]);
}
```

**Why not `get()`:** a `get()` in a rule costs a document read on every
evaluation, and the read-your-own-membership-doc pattern is exactly where an
agent writes `allow read: if true` to make a test pass. The claim is checked
by Firebase before your code runs, and it cannot be forged.

**Claim size:** 1000 bytes total. Crew ids are 20 chars; a user in a
realistic number of crews fits comfortably. If a user somehow exceeds it,
`onCrewMembership` must fail loudly rather than truncate silently.

### Rule intent, per collection

| Path | Read | Create | Update | Delete |
|---|---|---|---|---|
| `users/{uid}` | own only | own only | own only, **cannot self-set `entitlement`, `crews`, `trial*`** | never |
| `users/{uid}/weights/*` | **owner only, no exceptions** | owner | owner | owner |
| `crews/{id}` | members | signed-in | admin only, `memberIds` server-only | never |
| `crews/{id}/members/*` | members | server | server | server |
| `entries/{id}` | own, or a member of a crew in `crewIds` | own, id must equal `{uid}_{date}` | own; **reactions writable by any crew member for their own key only** | never |
| `threads/*` | crew members | server | server | never |
| `messages/*` | crew members, `moderation != 'removed'` | crew members, `kind=='user'`, own uid, <=160 chars | author, only to set `deleted` | never |
| `feedLines/*` | crew members | server | server | never |
| `notebook`, `state`, `dms` | server / own | server | server | server |
| `reports/*` | **nobody** (operator via console) | signed-in | server | never |
| `config/app` | all | never | never | never |

**Server-only writes** are enforced by checking the request has no auth
(Admin SDK bypasses rules) — i.e. simply `allow write: if false` for those
paths, since the Admin SDK is not subject to rules at all.

### Rules test suite — mandatory

`@firebase/rules-unit-testing` against the emulator. Must include these
negative cases, each asserting a **denial**:

1. Member of crew A reads an entry whose `crewIds` is `['crewB']`.
2. Member of crew A reads crew B's messages, feed lines, notebook.
3. User writes an entry with someone else's uid.
4. User writes an entry with a document id that does not match `{uid}_{date}`.
5. User sets their own `entitlement` to `'paid'`.
6. User adds a crew id to their own `users/{uid}.crews`.
7. User forges a message with `kind: 'aiden'`.
8. User edits another user's message text.
9. User writes a reaction under another user's key.
10. Any client delete, on every collection.
11. Any client read of `reports/*`.
12. Unauthenticated read of anything.
13. A user removed from a crew (claim revoked) reading that crew's data.
14. Message create exceeding 160 characters.
15. **A crew member reads another member's `users/{uid}/weights/*`.** This is
    the one that protects the product's central promise; it must be denied even
    for people in the same crew.
16. An entry create containing a `weightKg` field at all (weight belongs in the
    owner-only subcollection; reject the shape outright so it cannot creep back).

CI fails on any of these passing. This suite is the deliverable, not the
rules file.

---

## 6. Auth flow

1. Native Apple or Google sheet returns an identity token.
2. Exchange for a Firebase credential, `signInWithCredential`.
3. First sign-in triggers profile creation (`displayName`, `colour`).
4. On crew join, `onCrewMembership` sets the claim; client force-refreshes the
   token.

**Apple specifics:** Sign in with Apple is mandatory once Google is offered.
Apple only returns the user's name on the **very first** authorisation —
capture it then or it is gone. The OAuth signing key (`.p8`) must be rotated
every 6 months; put a calendar reminder in the launch checklist.

---

## 7. The Aiden pipeline

Full behaviour in `04`. Mechanically:

```
trigger (entry write / user message / scheduler)
  -> build context   pure function, src/lib + server data
  -> moderate?       no, generation is moderated on output
  -> xAI call        Grok 4.1 Fast, JSON mode, server-side key
  -> validate        schema + hard rules (no absolute kg, no em-dash, length)
  -> moderate        pre-post filter on the output
  -> write           per-document write, never a whole-map PATCH
```

**Validation rejects the whole run** rather than writing bad copy. Team Lift's
`findAbsoluteWeight()` backstop ports across — the context never contains a
raw weight, so the model cannot leak one, and the validator catches it anyway.

**`lastAidenAt` is stamped with the pre-call time**, so a message posted while
the model is thinking stays pending and gets answered on the next pass.

**Provider fallback:** on xAI failure, retry once, then give up silently. Do
not fall back to another provider — the register will not match and inconsistent
voice is worse than no line. The client already shows a factual placeholder.

---

## 8. Cost controls

Hard limits, enforced server-side, detailed in `08`:

- Per-crew generation budget per day.
- Per-user DM rate limit; 20 messages total during trial.
- Thread reply debounce: answer all pending humans in one call.
- Feed-line debounce: 30s, one line per entry, no re-roll on edit.
- Global kill switch in `config/app` that disables generation without a deploy.

---

## 9. Port map from Team Lift

`js/lib/` is pure logic with no Firebase and no DOM. Port it to TypeScript
with its tests. Adapt where noted for multi-crew.

| Team Lift | Sledged | Adaptation |
|---|---|---|
| `js/lib/dates.js` | `src/lib/dates.ts` | None. `parseLocal`, `todayStr`, `addDays`, `mondayOf`, `weekNumber`, `dayOptions`, `dayLabel`. Note the existing warning: never `new Date(str)` on a `YYYY-MM-DD` (parses as UTC). |
| `js/lib/challenge.js` | `src/lib/challenge.ts` | `challengeStart` comes from the crew doc, not global config. |
| `js/lib/aggregate.js` | `src/lib/aggregate.ts` | Every function takes a crew-scoped entry list. Drop the challenge-window concept; use a rolling window. |
| `js/lib/awards.js` | `src/lib/awards.ts` | None. |
| `js/lib/reactions.js` | `src/lib/reactions.ts` | None. Fixed set stays 🔥💀👏😂. |
| `js/lib/report.js` | `src/lib/report.ts` | Keep `weightDelta`, `yesterdaySummary`, `templateReport` (the offline/fallback report). |
| `js/lib/threads.js` | split | Message/window/preview helpers to `src/lib/threads.ts`. Job collection and write plans move server-side to `functions/src/aiden/`. **Drop everything about whole-map writes and purging maps** — the subcollection model makes it dead code. |
| `js/lib/banter.js` | `src/lib/seeded.ts` | Keep only the seeded deterministic pick helper. All stacked template banter is dead: feed lines are AI now. |
| `scripts/prompt/aiden.md` | `functions/prompts/aiden.md` | See `04`. |
| `scripts/lib/context.mjs` `MOODS` | `functions/src/aiden/moods.ts` | Verbatim. |
| `scripts/storylines.mjs` | per-crew `state/aiden.storylines` | Self-expiring after 3 days, same rule. |

**The tests port too, and they are the real head start.** Team Lift has 17
`node --test` suites under `tests/`, of which these cover logic that survives:
`dates`, `daypicker`, `challenge`, `aggregate`, `awards`, `reactions`,
`report`, `threads`, `banter`, `storylines`, `push-context`, `push-coach`.
Convert them to Vitest alongside their modules rather than writing new ones —
they encode edge cases (UTC date parsing, streak boundaries, rest-day grace)
that took real bugs to discover. Skip `wake`, `copywriter`, `firestore-rest`,
`decide` and `esc`: they test NUC plumbing that does not exist here.

**Do not port:** `js/firebase.js`, `js/push.js`, `js/state.js`, `js/ui/*`,
`js/charts.js`, `scripts/orchestrator.mjs`, `scripts/watch-banter.mjs`,
`scripts/lib/firestore-rest.mjs`, `scripts/lib/wake.mjs`, `sw.js`. All of it is
either NUC plumbing or vanilla-DOM UI.

---

## 10. Known bugs in Team Lift not to reintroduce

Each of these is a fixed commit in the Team Lift history. They will recur if
the same shape is rebuilt.

1. **Whole-map `threads` PATCH destroyed concurrent comments.** Solved
   structurally here by subcollections.
2. **One failed push send re-spammed the whole crew** on the next tick.
   Per-user send state, updated per user, not per run.
3. **Stacked template pep-suffix feed lines read as robotic.** Feed lines are
   AI or a plain factual placeholder. Never a template stack.
4. **Challenge grace:** never claim someone skipped *today's* challenge. The
   day is not over. Only yesterday's is fair game.
5. **Safe-area insets** under the notch made tabs untappable in standalone
   mode.
