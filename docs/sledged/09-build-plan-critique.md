# Sledged — Build Plan Critique

**Date:** 2026-08-10
**Status:** Planning input. Not yet incorporated into 01–08.
**Source:** External review of the full pack (`docs/sledged/*` + verified rules),
then cut short by subscription expiry. Captured here so the next planning
pass can act on it without re-deriving the findings.

**Scope of review:** tech stack, design/UX/UI, service design, user journeys,
failure modes and mitigations, device coverage, auth barrier, Aiden quality and
abuse surface, budget blowout, crew security, invite flow.

**How to use this file:** Treat every item as a candidate change to 01–08 and
`reference/`. Do not start building until blockers in §1 are resolved or
explicitly accepted with a written risk. When a finding is incorporated, tick it
here and link the target doc section.

---

## Verdict

Best-in-class docs pack for a solo build. Decisions are stated, scars from Team
Lift are encoded, rules are emulator-verified. Weak spots are all in the same
place: the layer between "signed-in user" and "server" — no App Check, no
timezone model, stale-claim window, pre-post filter that is not pre-post, and
two scheduler scans that eat the free tier. Plus the riskiest assumption
(Aiden is funny + moderatable) is validated last, in Phase 4.

Two things this pack does better than most funded apps: the privacy model is
structurally enforced rather than UI-enforced, and the voice guide's failure
modes are documented from real regressions. Do not let a reviewer talk you out
of either.

---

## 1. Blockers (fix before code)

### 1.1 Moderation is not pre-post — compliance gap + Apple 1.2 risk

`reference/firestore.rules` allows crew read when `moderation != 'removed'`.
Client creates with `moderation: 'pending'`. So every message is crew-visible
from write until the trigger flips it. `05` claims "High severity is blocked
outright and never stored as visible." False as built.

**Fix:**

```
allow read: if inCrew(crewId)
  && (existing().moderation == 'clean' || isSelf(existing().userId));
```

Author sees own instantly; crew sees post-clear (~1s). Same fix for
`feedLines` (currently same hole, though server-written so lower risk).

- [ ] Incorporated into `reference/firestore.rules` + `05`

### 1.2 No Firebase App Check anywhere

Web config ships in the bundle. Any bot with a scripted Google sign-in hits
Firestore REST and every callable directly, no app involved. Per-user rate
limits do nothing when accounts are free and unlimited. This is the missing
control behind threats #3 and #9 in `05` §1.

**Fix:** App Attest (iOS) / Play Integrity (Android) / reCAPTCHA Enterprise
(web), enforced on Firestore + Functions + Auth. Add to Phase 1, not Phase 6.

- [ ] Incorporated into `03`, `05`, `06` Phase 1

### 1.3 Timezone does not exist in the data model

`03` §4 says morning report fires on "crew local 03:00", pushes on "user local
7:30am". No timezone field on `users/` or `crews/`. And a crew spans members in
different zones.

**Fix:**

- Store IANA tz per user (`Intl.DateTimeFormat().resolvedOptions().timeZone`),
  refresh on app open.
- Crew report time = creator's tz, stored on the crew doc, admin-editable.
- Half-hour zones (Adelaide +9:30, Darwin +9:30/+10:30) and partial DST mean
  an hourly scheduler cannot hit 7:30 local. `sendPushes` at 30 min is fine;
  `morningReport` must also be 30 min, or store `nextReportAt` and query it.

- [ ] Incorporated into `03` schema + `06`

### 1.4 Removed member keeps read/write access for up to 60 minutes

Rules read `request.auth.token.crews`. Firebase ID tokens live 60 min. `02` C4
says "A removed member immediately loses read access (claim revoked)." Not
true. Worse: the negative rules suite mints a fresh token, so the test passes
while production leaks. False confidence.

**Options:**

| Option | Trade-off |
|---|---|
| (a) Accept and document a 60-min window so they can't renew | Simple; honest C4 |
| (b) Add `memberIds.hasAny([uid])` via `get()` on sensitive paths only | One read cost; real immediate revoke |
| (c) Kick + rotate code + soft-purge | Defence in depth with invite fix |

Pick one, and rewrite C4's criterion to match.

- [ ] Decision recorded in `02` C4 + `03`/`05`

### 1.5 `inviteCodes/{code}` is world-readable

Unauthenticated enumeration of a 6-char space, harvesting crew names, and free
read burn with no rate limit. Codes are also non-expiring and reusable, so one
forward puts a stranger inside a crew's health data.

**Fix:**

- Resolve codes through an HTTPS function with App Check + per-IP limit, never
  a public collection.
- 8 chars, Crockford base32 (no O/0/I/1).
- Separate short-lived share token from the permanent code if needed.
- Auto-rotate the code when a member is removed.
- Notify the admin on join with one-tap kick.

- [ ] Incorporated into `03`, `05`, rules, invite UX

### 1.6 Two scheduler full-scans dominate cost, and aren't in `08`

`sendPushes` every 30 min = 48 scans/day. Over 1,000 active users that is
48k reads/day — the entire 50k free tier, before anyone opens the app.
`morningReport` hourly does the same over crews.

**Fix:** Query by due-time, not scan-all. Users keyed to the half hour; crews
on `nextReportAt`. Same pattern for `weeklyRecap` and `updateNotebook`.

**Second cost hole:** every generation rebuilds 14-day context ≈ 170 reads. At
6 feed lines + 8 replies + report per crew per day that's ~2.5k reads/crew/day.
100 crews = 250k/day. Cache the crew day-context in one doc; invalidate on
entry write.

- [ ] Incorporated into `03` schedulers + `08` cost model

### 1.7 No backups

Firestore PITR and scheduled export are unmentioned. The app holds health data.
One bad `deleteAccount` deploy is unrecoverable. Enable daily GCS export +
7-day PITR.

- [ ] Incorporated into `05`/`06` Phase 1 + `08`

---

## 2. Stack, reconsidered

Firebase-over-Supabase reasoning holds. Expo/RN path holds with amendments:

### 2.1 Which Firebase SDK is unstated, and it decides whether offline works

`06` says only "Firebase SDK wired". The JS SDK's persistent cache is
IndexedDB-backed — React Native has no IndexedDB, so you get memory cache only:
kill the app, lose cache. Offline is cited as reason #2 for choosing Firebase
(`03` §1). It only holds with `@react-native-firebase/*` (native SDKs,
persistence on by default). You need RNFirebase for FCM anyway.

**Consequence:** web target needs the JS SDK, so `src/data/` becomes a
two-implementation boundary. Fine if web is landing-only — write it down now.

- [ ] Decision in `03` §1 + data-layer boundary

### 2.2 Push transport unspecified

"FCM via Expo" is ambiguous. Functions must send via either Expo Push API or
FCM Admin SDK, and those need different token types. With RNFirebase you're on
FCM tokens + Admin SDK. Decide; a half-migrated token store is a day lost.

- [ ] Decision in `03`

### 2.3 Vitest doesn't test components

Fine for pure lib. There is no component-test story at all; Maestro smoke flows
are the only UI coverage. Acceptable for solo, but say so explicitly so the
agent doesn't invent a Jest setup mid-build.

- [ ] Explicit testing policy in `06`/`07`

### 2.4 Add three things absent from the stack table

| Missing | Why |
|---|---|
| **Sentry or Crashlytics** | `06` Phase 8 says "monitoring" without collecting crashes from day one |
| **EAS Update** | Only way a solo operator fixes a client bug without a review cycle. `config/app.minBuild` handles force-upgrade but not the fix |
| **Analytics event spec** | `01` calls the secondary user's first 7 days "the single highest-leverage part of the product" and nothing measures it |

**Six events minimum:** `signed_in`, `first_log`, `aiden_seen`, `crew_joined`,
`d1_return`, `paywall_seen` / `paywall_purchased`.

- [ ] Stack table + Phase 1 updated in `03`/`06`

---

## 3. Design, UX, UI

IA is sound and evidence-based (ported from a working app). Gaps:

| Gap | Detail |
|---|---|
| **No empty states** | Not one, anywhere. "Must survive a crew of two" (`01` §4) actually lives as: solo home, brand-new crew, no data yet, offline, Aiden down, feed emptied by blocks. Ship a designed state for each or the first-week user sees a broken-looking product. |
| **Solo state too thin** | Contradicts the trial rule. Solo = one Aiden line a day forever, because the 14-day trial only starts at crew join. The user who most needs to recruit mates gets the least Aiden. Give solo users their own feed line plus ~3 DM messages/day, capped, gated by dormancy. Costs cents; it's the demo that makes them send the invite. |
| **Stats and Crew overlap** | Leaderboard on Home, standings in Stats, members in Crew. Three surfaces for one fact. Merge Stats into Crew, go to 3 tabs, more weight on Home. |
| **Nag fatigue** | Free user gets a redacted card on every own log plus a daily nag job. Two paywall touches a day, forever. Cap total lifetime nags; make the teaser sound like the real line — a genuine tease converts better than an ad and stays on-voice. |
| **Accessibility** | Nothing. Dark-only with red/orange needs 4.5:1. Member colour is the sole carrier of meaning in the steps chart — add pattern or direct labels. Decide on `allowFontScaling`. |
| **Android edge-to-edge** | Mandatory at target SDK. Twin of Team Lift's notch bug — same class, listed only for iOS in `06` Phase 2. |
| **Notification deep links** | Unspecified. Tapping a coach push should land in coach chat, not Home. |
| **Never a blank morning** | If generation fails, `templateReport` must post. Spec implies it for the client placeholder but never states it for the server report path. |
| **Cheap wins** | Haptic + streak animation on save; Aiden writes the invite share-sheet text (on-brand growth lever that respects the no-share-button decision). |

- [ ] Empty states + journey polish into `01`/`02` Phase 2
- [ ] Solo Aiden budget decision in `01`/`04`/`08`
- [ ] Tab IA decision in `01`

---

## 4. User journeys — stories exist, journeys don't

`02` is good acceptance criteria, not journeys. Eight unmapped, four of them
load-bearing:

1. **Invite → store → install → join.** The entire growth mechanism, and the
   spec says "do not block on deferred deep linking". Needs a real design:
   Universal Links / App Links, fallback, code paste, and what the web landing
   shows (crew name, member count, a sample Aiden line — not that crew's real
   lines, privacy).
2. **Block inside a 12-person crew.** A blocks B. Aiden's report names B, and
   Aiden's replies quote B's text. Block does not survive Aiden, which is an
   Apple 1.2 gap. Decide: block within a crew forces a leave, or block filters
   Aiden output mentioning the blocked name (you know the display name).
3. **Report as griefing.** Auto-hide-on-report is global and instant. One
   member reports the morning report, the whole crew loses it. Fix:
   hide-for-reporter instantly, global on triage, rate-limit reports per user
   per day.
4. **Admin lifecycle.** No admin transfer. Creator deletes their account
   (mandatory feature) and the crew is permanently unadministrable — can't
   rotate the code, can't kick. Member leaves, crew orphans, no cleanup.
5. **Return-after-30-days** — dormancy re-enable path is one line in `08`, no UX.
6. **Device switch / restore / same person, two providers.** Apple on iPhone and
   Google on Android = two accounts, two purchases, split history. Need
   provider linking in Me.
7. **Trial expiry day** — what the user actually sees.
8. **Age gate.** Rated 16+/18+, no age collection anywhere. Aiden's register
   aimed at a 14-year-old who lied is the reputational risk, not the store one.
   A date-of-birth or year-of-birth gate is cheap.

- [ ] Journey maps added (or stories expanded) in `02`
- [ ] Block × Aiden decision in `05`
- [ ] Report scope decision in `05`
- [ ] Admin transfer / orphan crew in `03`

---

## 5. Auth, barrier to entry

Apple + Google federated is the right call: no passwords to steal, no reset
flow to build, satisfies Apple's SIWA requirement.

**The barrier is the ordering.** `01` §5 puts sign-in first — while the same
section argues "value before commitment" for the crew wall. Same argument
applies to auth.

**Recommendation:** Firebase anonymous auth on first launch. Log immediately,
see Aiden's `firstLog` line, then upgrade to Apple/Google at crew create/join
(where it's mandatory). `linkWithCredential` preserves the uid, so entries and
entitlement carry over. Custom claims work fine on anonymous users.

**Costs of that path:** orphan anon accounts (prune at 30 days idle), and
Apple's deletion requirement still applies to them.

**Other notes:**

- Apple private-relay emails make any "email recovery" row in `05` §2 fictional
  — federated-only has no recovery.
- Google sign-in needs SHA-1 per build variant; the debug/release mismatch is
  the classic EAS trap.

- [ ] Auth ordering decision in `01`/`03`/`05`

---

## 6. Devices

| Surface | Notes |
|---|---|
| **iOS** | Fine. Decide iPad support = off now. Clean screenshots for every listing and a reviewer looking at a stretched phone layout. |
| **Android** | RN 0.85 floor is comfortable. Health Connect, and Play's health-data declaration + demo video can burn multiple review cycles — buffer two weeks, not two days. |
| **Foldables / tablets (Android)** | Can't be opted out easily; need a sane phone-first layout. |
| **Web** | Landing only, so no charts, no Skia WASM. But the existing Team Lift crew loses web logging in the migration — they're on a PWA today. Flag it to them before cutover. |
| **Health data reality** | Steps only reach Health Connect if the user's Fitbit/Garmin app writes there. Manual fallback exists, so it degrades correctly. |

- [ ] iPad off + Android tablet policy in `01`/`06`
- [ ] Team Lift web-logging loss flagged in launch checklist

---

## 7. Aiden — making him work

`04` is the strongest file in the pack. Three additions:

1. **Move the Aiden spike to week one.** Today it's Phase 4, after ~3 phases of
   table stakes, and the manual gate ("Simon reads a week and laughs") is the
   project's riskiest assumption. A Node script — ported prompt, real Team Lift
   data, xAI API — costs a day and validates register, latency, token budget,
   and the moderation conflict below before any app exists. Single
   highest-value change to `06`.
2. **Regression fixtures must cross moods × intensities**, not just 10
   contexts. `04` §11 has 10 contexts; the risk lives in `unhinged` × `savage`
   at temperature 0.9.
3. **Pin the model id** and treat xAI deprecation as a scheduled event. The
   fixture suite is the upgrade gate.

- [ ] Phase 0 Aiden spike in `06`
- [ ] Fixture matrix + model pin in `04`

---

## 8. Aiden — abuse, injection, going rogue

### 8.1 Moderation classifier is unspecified, and conflicts with the product

`05` §8 says "a cheap classifier call" and never picks one. Off-the-shelf
toxicity models (Perspective, OpenAI omni-moderation, Azure Content Safety)
score Aiden's intended output as toxic — profanity, soft-sexist harden-up,
innuendo are the register you're paying for. Set the filter tight and Aiden is
neutered by his own filter; set it loose and it stops nothing.

**You need a custom rubric classifier:** one cheap model call with an explicit
allow-list (profanity, innuendo, harden-up, camp between adults) and the `04`
§9 deny-list (minors, protected-class slurs, threats, self-harm/disordered
eating, medical advice, real people outside the crew). Build it against a
labelled fixture set of real Team Lift lines. Same weight as the rules suite;
right now it's half a sentence.

- [ ] Rubric + fixtures as Phase 4 deliverable in `04`/`05`/`06`

### 8.2 Prompt injection is not mentioned once in ~3,400 lines

Every user message enters the thread context. Vectors, in severity order:

| Vector | Risk | Mitigation |
|---|---|---|
| **Persistent injection via the notebook** | User steers content into `notebook/current`; it becomes trusted context in every future generation for that crew, indefinitely | Run §10 validator + §9 patterns on notebook at write time; wrap as untrusted data; cap it; operator read/reset |
| **Display name as payload** | Names go into every title/prompt | Validate charset, length, no newlines, no colons |
| **System-prompt extraction** | Voice guide isn't a credential, but it is the moat | Refusal instruction + output check for high n-gram overlap with the prompt file |
| **Jailbreak-then-screenshot** | Easiest in DM where output filter is the only control | Log every DM generation; rate-limit hard |
| **Weight extraction** | Already structurally defeated — model never receives absolute kg | Keep; best design decision in the pack |

- [ ] Injection section added to `05`
- [ ] Notebook write-time validation in `04`/`03`

### 8.3 Rogue containment is decent

Prompts live in the deployed bundle, not Firestore, so nobody edits Aiden's
brain from a console. Keep it that way. Validation discards bad output.

**Add:**

- Rejection-rate alarm (rising rate = prompt regression)
- Per-crew "Aiden mute" so one bad crew doesn't need a global kill

- [ ] Alarms + mute in `04`/`08`

### 8.4 "No fallback provider" is right for voice, wrong for silence

xAI outage = the product just stops with no signal. Fall back to
`templateReport` for the report only — an "Aiden's off the tools" state rather
than dead air.

- [ ] Fallback behaviour in `04`/`03`

---

## 9. Budget blowout

`08` §4 is good but under-specified in three places:

1. **Where do rate-limit counters live?** If Firestore, each check is a read +
   write, and a per-user counter doc has a 1 write/sec ceiling. Use
   `rateLimits/{uid}_{YYYYMMDD}` (or shard + `increment()`), TTL-deleted. Say
   it, or it gets built as a hot doc.
2. **`maxInstances` on every function.** v2 defaults can hit xAI at full
   concurrency and the per-crew daily budget only catches it after the money's
   gone. Cap each function, and add a circuit breaker on xAI 429/5xx.
3. **`onEntryWritten` fires on every write**, including reaction toggles.
   Generation is capped at one per entry, but the trigger still runs and
   reads. Early-exit on `feedLines/{entryId}` existence before building any
   context, and implement the 30s debounce as a Cloud Task with a dedupe key.
4. **Moderation call volume is missing from the `08` cost table entirely** — it
   roughly doubles call count (every generation + every user message). Free
   tiers exist; pick one and put it in the table.
5. **Budget alarms at $25/$50/$100 are right.** Add a hard xAI org spend cap,
   which is a ceiling rather than an alert.

- [ ] Rate-limit storage design in `03`/`08`
- [ ] `maxInstances` + circuit breaker in `03`/`08`
- [ ] Trigger early-exit + Cloud Task debounce in `03`
- [ ] Moderation cost row + hard spend cap in `08`

---

## 10. Crew security + invite flow

Covered in 1.4 and 1.5. Two more:

- **Entry field bounds are not enforced in rules.** Client can write nonsense
  that pollutes the leaderboard and Aiden's context. Bound steps 0–200000,
  weightDelta -50..50, `workoutParts` a subset of the fixed 8, max length 8.
- **Reactions emoji set is client-only.** Enforce the fixed set in rules; the
  reaction key is already correctly locked to the writer's own uid.
- **Leaving a crew doesn't remove your history from that crew's feed.**
  `crewIds` is baked into each entry at write time and the rule reads it.
  Either a server function strips the crewId from historical entries on leave
  (bounded work, batched), or document that leave = soft leave of membership
  only and history stays (product decision either way).

- [ ] Field bounds + reaction set in rules + tests
- [ ] Leave/history product decision in `01`/`03`/`05`

---

## 11. Concrete plan changes

| Move | To |
|---|---|
| Aiden spike (Node script, real data, xAI) | **Phase 0** |
| App Check enforcement | **Phase 1** |
| Timezone model | **Phase 1** (schema decision) |
| Crash reporting + analytics events | **Phase 1** |
| Custom moderation rubric + fixtures | **Phase 4**, as a named deliverable |
| Firestore PITR + daily export | **Phase 1** |
| Empty-state and journey design | **Phase 2** |

Also missing from `06` entirely:

- Any duration estimate (realistically **8–16 weeks solo**)
- A monitored support inbox (store gate)
- The legal-entity decision — which is sitting on the critical path for both
  the Play 14-day wall and personal liability on a UGC health app

- [ ] `06` rewritten with Phase 0/1 inserts + duration + legal entity + support

---

## Next planning session — suggested order

1. Resolve §1 blockers (accept / fix / rewrite acceptance criteria).
2. Decide auth ordering (§5) and solo Aiden budget (§3) — product shape.
3. Decide block × Aiden and report scope (§4) — compliance.
4. Fold stack amendments (§2) and cost fixes (§1.6, §9) into `03`/`08`.
5. Rewrite `06` phases from the table in §11.
6. Only then open the new repo and start Phase 0 (enrolments + Aiden spike).
