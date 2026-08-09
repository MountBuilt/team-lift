# Sledged — Build Plan

**Date:** 2026-08-09
**Status:** Approved.

**Start here.** This file says what to do and in what order.

---

## 0. The critical path is not the code

Two things have calendar lead times that no amount of coding speed fixes.
Start them on day one, before writing a line.

| Blocker | Lead time | Consequence if left late |
|---|---|---|
| **Apple Developer Program enrolment** | Days, sometimes over a week | No TestFlight, no provisioning, no App Store Connect. Blocks everything on iOS. |
| **Play closed testing: 12 testers × 14 continuous days** | **14 days minimum**, and the clock resets if testers drop | Blocks production access on Android. Left to the end, it delays launch by a fortnight. |

Simon currently has an **EAS account only**. Apple Developer ($99/yr) and Play
Console ($25) both need creating.

**Play account type matters:** personal accounts created after 2023-11-13 must
do the 12-tester test. Organisation accounts registered to a legal entity are
exempt. Decide this before creating the account — it cannot be changed later.

---

## Phase 0 — Day one, in parallel with nothing else

- [ ] Enrol in Apple Developer Program
- [ ] Create Google Play Console account (decide personal vs organisation first)
- [ ] Register the domain (`sledged.app` or similar)
- [ ] **Trademark clearance for "Sledged"**: IP Australia, USPTO, App Store and
      Play searches. Do this before any branding spend. If it fails, only the
      name changes.
- [ ] Create the Firebase project, enable Auth / Firestore / Functions
- [ ] Create the xAI API account and a billed key. Set a spend cap.
- [ ] Create the RevenueCat account
- [ ] Create the new GitHub repo, copy `docs/sledged/` into it, make `07`'s
      content the repo's `CLAUDE.md` / `AGENTS.md`
- [ ] Start recruiting 12 Play testers (the existing Team Lift crew is a
      natural start, plus mates)

**Nothing here is code. All of it is on the critical path.**

---

## Phase 1 — Foundation

**Goal:** an app that signs in and writes data safely.

- [ ] `npx create-expo` with Expo Router + TypeScript, SDK 56
- [ ] `expo-dev-client` and `npx expo prebuild`. **Do not start on Expo Go** —
      HealthKit, Health Connect, RevenueCat and native Google sign-in all need
      native modules, and migrating later wastes a week.
- [ ] Firebase SDK wired, config in place
- [ ] **Port `src/lib/`** from Team Lift with tests (`03` §9). Pure logic, no
      Firebase, no RN imports. This is free progress — the tests already exist.
- [ ] Firebase Auth: Apple + Google native sign-in
- [ ] Capture the Apple display name on **first** authorisation (it is never
      returned again)
- [ ] `users/{uid}` profile creation, colour assignment
- [ ] **`firestore.rules` + the emulator rules test suite** including all 14
      negative cases in `03` §5. **CI fails if any negative case passes.**
- [ ] GitHub Actions: typecheck, unit tests, rules tests on every push

**Exit criteria:** two accounts on two devices, rules suite green, cannot read
each other's data.

**Do not proceed past this phase with failing or absent rules tests.** Every
later phase writes data through those rules; a hole here is a hole everywhere.

---

## Phase 2 — Logging, the core loop

**Goal:** the app is useful with no AI and no crews.

- [ ] Tab shell with safe-area insets (Team Lift's notch bug — do not repeat)
- [ ] Log sheet: day picker (today / yesterday / day before only), weight,
      steps, workout chips, challenge tick
- [ ] Entry write/merge; blank fields do not overwrite
- [ ] Firestore offline persistence on; optimistic UI; "saved locally" state
- [ ] Daily challenge (ported), tick, streak
- [ ] Me tab: own weight trend in real kg, own history, edit
- [ ] Stats tab: week tiles, workouts panel, weight % chart, steps chart
- [ ] Design system: dark theme, type scale, the **Aiden card with the Sledged
      wordmark** (`01` §12)

**Exit criteria:** Simon logs for a week on a dev build without wanting to open
Team Lift instead.

---

## Phase 3 — Crews

**Goal:** multi-tenancy, working and provably isolated.

- [ ] Create crew, generate code, invite link
- [ ] Join by code and by deep link
- [ ] `onCrewMembership` function writing the `crews` custom claim
- [ ] Client force-refreshes the token after joining
- [ ] Crew tab: members, leaderboard, switcher for multiple crews
- [ ] Crew settings: name, banter intensity, remove member, rotate code
- [ ] Leave crew
- [ ] Recent activity feed with factual placeholder lines
- [ ] Peer reactions
- [ ] **Re-run the rules suite with real multi-crew data**

**Exit criteria:** three accounts, two crews, one user in both. Provably no
cross-crew read, verified by test not by inspection.

---

## Phase 4 — Aiden

**Goal:** the product actually exists.

- [ ] `functions/prompts/aiden.md` from `04` §8, verbatim
- [ ] Moods, ported verbatim
- [ ] Context builder as a **pure, tested function**
- [ ] xAI client, key in Secret Manager, JSON mode
- [ ] Validation: schema, length, no em-dash, no absolute kg, safety patterns
      (`04` §10). **A failure throws the whole run away.**
- [ ] `onEntryWritten` → `generateFeedLine`, 30s debounce, one line per entry,
      no re-roll on edit
- [ ] `firstLog` dedicated path — fires within seconds of the first ever entry
- [ ] Coach chat: continuous thread, messages subcollection, `Load earlier`
      windowing, opens at the bottom
- [ ] `onThreadMessage` → `generateThreadReply`, debounced, answers all pending
      humans in one message
- [ ] Typing indicator with timeout
- [ ] `morningReport` and `weeklyRecap` on Cloud Scheduler
- [ ] `updateNotebook` weekly
- [ ] Storylines, self-expiring after 3 days
- [ ] **Dormancy controls and rate limits** (`08` §4) — build now, not later
- [ ] Kill switches, and **flip each one once to prove it works**

**Exit criteria:** a week of real generated output that Simon reads and finds
funny. This is a **manual** gate. If the copy is flat, the cause is almost
always one of: the locker-room register was trimmed, the "a recap has failed"
rule was dropped, or a joke bank was added (`04` §0).

---

## Phase 5 — Money and health

- [ ] RevenueCat, `sledged_unlock` as **non-consumable**, same id in all three
      consoles
- [ ] Paywall screen, honest about what unlocks and that it is one-off
- [ ] Restore Purchases
- [ ] Webhook → `entitlement`, server-write-only
- [ ] Trial: `trialStartedAt` on **first crew join/create**, 14 days, DM capped
      at 20 messages for the trial
- [ ] **Redaction at read time** — teaser card for the free author's own line
      (`04` §7)
- [ ] Aiden's private nag, once daily maximum, never in an evening push
- [ ] HealthKit: steps + workouts, read-only, minimum types
- [ ] Health Connect: same
- [ ] Steps pre-fill the log sheet; detected workout surfaces as a suggestion
- [ ] App fully functional with permission denied

**Exit criteria:** sandbox purchase works, restores on a second device, and no
path exists by which a client can set its own entitlement.

---

## Phase 6 — Push, safety, compliance

- [ ] FCM, token storage, permission flow
- [ ] Morning push from 7:30am local, skipped after 8:30pm
- [ ] Evening push from 8:30pm **only if nothing logged**, pure encouragement
- [ ] **Per-user send state** so a failure never re-spams the crew (Team Lift
      bug — `03` §10)
- [ ] Per-notification opt-out
- [ ] **`moderateContent` pre-post filter** on every user message and every
      Aiden generation
- [ ] Report on every message, feed line and profile
- [ ] Block, with content disappearing immediately
- [ ] Auto-hide on report
- [ ] Moderation triage agent + escalation to Simon
- [ ] Audit log
- [ ] **In-app account deletion** (Apple 5.1.1(v)) with full data purge
- [ ] Web target: landing, invite, privacy policy, terms, support, deletion
      request page
- [ ] Privacy policy and terms written per `05` §7

**Exit criteria:** every checkbox in `05` §5 and §6 ticked.

---

## Phase 7 — Store submission

- [ ] EAS Build production profiles, EAS Submit
- [ ] Icons, splash, screenshots for all required device sizes
- [ ] Store listing copy. **Aiden's voice sells the app; the listing should
      sound like him without breaking store copy rules.**
- [ ] Apple: complete the **updated age rating questionnaire** (mandatory
      before any submission), privacy nutrition labels, Small Business Program
      enrolment
- [ ] Play: data safety form, Health Connect declaration + demo video, IARC
      rating
- [ ] **App Review notes with a demo account already inside a populated crew.**
      A reviewer with no mates sees an empty app and rejects it as incomplete.
      This is the most likely rejection cause for a social app and it is
      entirely avoidable.
- [ ] TestFlight to the Team Lift crew
- [ ] **Confirm the Play 12-tester / 14-day clock has completed**
- [ ] Submit

---

## Phase 8 — After launch

- [ ] Monitor: crash rate, D1/D7 retention, logs per active user per week,
      conversion, generation rejection rate, cost per active user
- [ ] Read Aiden's output daily for the first fortnight. Prompt drift is
      invisible in metrics and obvious in the copy.
- [ ] Migrate the Team Lift crew across, retire Team Lift once they are settled
- [ ] Diary: **rotate the Apple `.p8` sign-in key every 6 months**

---

## Sequencing notes

**Parallelisable:** Phase 0 runs alongside everything. Within Phase 4, the
context builder and the prompt work are independent of the trigger plumbing.
Within Phase 6, moderation and push are independent.

**Strictly sequential:** 1 → 3 (rules before multi-tenancy), 3 → 4 (Aiden needs
crews), 4 → 5 (redaction needs generation).

**Do not defer:** rules tests (Phase 1), dormancy and rate limits (Phase 4),
kill switches (Phase 4). Each of these is dramatically harder to retrofit than
to build, and each protects against a failure that is expensive or
unrecoverable.

---

## Definition of done, for the whole thing

1. `npm test`, rules tests, and typecheck all green in CI.
2. Every box in `05` §5 and §6 ticked.
3. Kill switches tested by flipping them.
4. A crew of real people used it for two weeks and kept logging.
5. Simon read a fortnight of Aiden's output and laughed at some of it.

Number 5 is not a joke. It is the only test that measures the actual product.
