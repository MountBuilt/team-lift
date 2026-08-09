# Sledged — Security, Privacy & Store Compliance

**Date:** 2026-08-09
**Status:** Approved. **Read this before submitting anything to either store.**

Every item in §5 and §6 is a gate. Missing one means rejection, and a rejection
costs a review cycle, not an afternoon.

---

## 1. Threat model

What is actually worth protecting here, in priority order.

| # | Threat | Impact | Control |
|---|---|---|---|
| 1 | **Cross-crew data leak** — user in crew A reads crew B's entries or messages | Severe. Private bodyweight and health data exposed to strangers. Reportable under Australian Privacy Act if at scale. | Custom-claim rules + tested negative cases (`03` §5) |
| 2 | **LLM key extraction** | Direct financial loss, unbounded | Key in Secret Manager, server-side only, never in a client bundle |
| 3 | **Cost exhaustion** — someone loops DM or spams entries | Financial | Per-user and per-crew rate limits, global kill switch (`08` §4) |
| 4 | **Entitlement forgery** — client sets `entitlement: 'paid'` | Revenue loss | `entitlement` is server-write-only; RevenueCat webhook is the only writer |
| 5 | **Absolute weight disclosure** to other crew members | Trust destroyed; this crew's whole product premise | Never denormalised into shared reads; validator backstop; charts use deltas only |
| 6 | **Harassment via the app** | User harm, store removal | Report, block, pre-post filter, 24h action |
| 7 | **Aiden produces harmful content** | User harm, store removal, press risk | Prompt rules + output moderation + report (`04` §9) |
| 8 | **Account takeover** | Moderate | Apple/Google federated auth only; no passwords to steal |
| 9 | **Invite code brute force** | A stranger joins a crew | 6-char codes are weak alone — rate limit join attempts per user and per IP; admin can rotate |
| 10 | **Health data misuse** | Store removal, legal | Raw health records never leave the device; only what the user saves as an entry is stored |

**Explicitly accepted:** a determined crew member can screenshot anything
another crew member posts. That is the nature of a social app and no control
fixes it. The mitigation is that people choose their own crews.

**Explicitly NOT accepted, unlike Team Lift:** open Firestore rules. Team Lift
documented "obscurity-level security is explicitly accepted (public repo, open
rules, low-stakes data, trusted group)". Every clause of that justification
fails the moment a stranger can install the app.

---

## 2. Data inventory

What is collected, why, and where it goes. This table is the source for both
stores' privacy disclosures — keep it accurate or the disclosures drift.

| Data | Source | Stored | Shared with crew | Sent to xAI | Purpose |
|---|---|---|---|---|---|
| Apple/Google user id | Auth | Yes | No | No | Identity |
| Email | Auth | Yes | No | No | Account recovery, operator contact |
| Display name | User | Yes | **Yes** | **Yes** | Attribution, banter |
| Bodyweight (kg) | User | Yes, in `users/{uid}/weights/*`, **owner-readable only** | **No, never** | **No, only deltas** | Personal trend |
| Weight delta | Derived | Derived | Yes | Yes | Charts, banter |
| Steps | User or Health | Yes | Yes | Yes | Leaderboard, banter |
| Workout body parts | User or Health | Yes | Yes | Yes | Leaderboard, banter |
| Challenge ticks | User | Yes | Yes | Yes | Streaks, banter |
| Messages | User | Yes | Yes | Yes | Conversation |
| Push token | Device | Yes | No | No | Notifications |
| Purchase status | RevenueCat | Yes | No | No | Entitlement |
| Raw HealthKit records | Health | **No** | No | No | Read on device, discarded |

**Third parties that receive personal data:** Google (Firebase), xAI (banter
generation), RevenueCat (purchase). All three must be named in the privacy
policy. **No advertising SDKs, no analytics SDKs that fingerprint, no data
brokers.**

**Analytics decision:** Firebase Analytics only, with IDFA/ATT **not**
requested. The app does not track users across apps or websites, which means
no App Tracking Transparency prompt and a clean "Data Not Linked To You" story
for analytics. Given HealthKit forbids using health data for advertising
anyway, there is nothing to gain by opting into tracking.

---

## 3. Secrets

| Secret | Where | Never |
|---|---|---|
| xAI API key | GCP Secret Manager, read by Functions | In the app bundle, in the repo, in EAS env vars exposed to the client |
| Apple `.p8` sign-in key | Secret Manager | Committed. **Rotate every 6 months** — diary it |
| RevenueCat secret key | Secret Manager (webhook validation) | Client |
| Firebase web config | Client (this is fine, it is not a secret) | Confused for a secret — it identifies the project, rules do the protecting |
| Service account JSON | Never on a developer machine if avoidable | Committed, ever |

`.gitignore` must cover `*.p8`, `*serviceAccount*.json`, `google-services.json`
and `GoogleService-Info.plist` if they carry anything project-specific beyond
public config, and `.env*`.

**Add a secret-scanning pre-commit hook.** The repo is likely to be public or
semi-public and an agent will paste a key into a file eventually.

---

## 4. Firestore rules — test plan

The full intent table is in `03` §5. The requirement here:

**CI fails if any negative case passes.** The 16 negative cases in `03` §5 are
the minimum, not the target. Add one for every new collection.

Run with `firebase emulators:exec --only firestore "npm run test:rules"`.

**Reviewer note for the building agent:** if a rules test fails, the fix is
almost never to loosen the rule. It is to change the client to stop doing the
thing. Loosening a rule to make a test pass is how this project gets a
cross-crew leak.

---

## 5. Apple App Store gates

Every one of these is mandatory. Ordered by how likely it is to be missed.

### 5.1 Guideline 1.2 — User Generated Content

The app has crew chat and AI-generated content about named users. All four
requirements apply, and Apple's February 2026 revision clarified that AI chat
features are in scope.

- [ ] **Filter objectionable content before it posts.** `moderateContent` runs
      on every user message and every Aiden generation. Not just on report.
- [ ] **Report on every piece of UGC** — messages, feed lines, profiles. One
      tap, reachable without leaving the content.
- [ ] **Block any user.** Blocked users' content disappears from feeds and
      threads immediately and completely.
- [ ] **Act within 24 hours** of a report: remove the content and eject the
      offender. Automated hide-on-report satisfies the removal half instantly;
      the operator agent triages and escalates.
- [ ] Published contact method for reports.
- [ ] Terms of use that users must accept, stating zero tolerance for abusive
      content. Apple looks for this specifically.

**Design note that makes this survivable for one person:** hide first, review
later. The instant auto-hide means the 24-hour clock is met by the system, not
by Simon being awake.

### 5.2 Guideline 5.1.1(v) — Account deletion

- [ ] **In-app account deletion.** Not an email, not a web form, not "contact
      support". Reachable from Me in a small number of taps.
- [ ] Deletes the account and all associated personal data.
- [ ] If anything must be retained (legal/financial records of a purchase),
      say so plainly at the point of deletion.
- [ ] Deletion also removes the user from crews and soft-deletes their messages.

### 5.3 Age rating

Apple's ratings were overhauled: 12+ and 17+ are gone; 4+, 9+, 13+, 16+ and
18+ remain. The questionnaire was updated and **completion is required before
you can submit anything**.

- [ ] Complete the updated questionnaire in App Store Connect.
- [ ] Answer honestly on **frequent/intense profanity or crude humour** —
      Aiden produces it every day, by design.
- [ ] Answer honestly on **sexual content or nudity (infrequent/mild)** — the
      innuendo register counts.
- [ ] **The questionnaire explicitly requires counting AI chatbot output.** You
      cannot rate the app on the static UI and ignore what Aiden says.
- [ ] Expected outcome: **16+, possibly 18+.** Accept it. Do not soften the
      product to chase a lower rating; a diluted Sledged is worth less than a
      correctly rated one.
- [ ] The per-crew `clean` intensity setting **does not lower the rating**.
      Apple rates on all content the app is capable of producing.

### 5.4 HealthKit

- [ ] `NSHealthShareUsageDescription` written in plain language saying exactly
      what is read (steps, workouts) and why.
- [ ] Request the **minimum** read types. No weight, no heart rate, no sleep.
- [ ] **Never use health data for advertising or data mining.** This is an
      absolute Apple rule and it permanently closes the ads monetisation path.
- [ ] Privacy policy explicitly covers health data.
- [ ] The app must be fully functional if permission is denied.
- [ ] Do not store health data in iCloud.

### 5.5 In-app purchase

- [ ] Digital unlock uses IAP (3.1.1). No external payment link.
- [ ] Product configured **non-consumable** in App Store Connect and mirrored
      in RevenueCat with the same identifier. A lifetime unlock misconfigured
      as consumable is a common and painful mistake.
- [ ] **Restore Purchases** is present and works.
- [ ] Price, what is unlocked, and that it is a one-off are stated clearly
      before purchase.
- [ ] Enrol in the **Small Business Program** (15% instead of 30%). The whole
      cost model in `08` assumes it.

### 5.6 Privacy nutrition labels

- [ ] Complete in App Store Connect from the §2 table.
- [ ] Declare Health & Fitness, Identifiers, User Content, Contact Info.
- [ ] Declare third-party sharing with xAI for content generation.
- [ ] Do **not** declare tracking; the app does not track.

### 5.7 Other

- [ ] Privacy policy URL, publicly reachable, no login.
- [ ] Support URL with a working contact method.
- [ ] Sign in with Apple offered (mandatory once Google sign-in is offered).
- [ ] No placeholder content, no lorem ipsum, no dead links in the build.
- [ ] Demo crew credentials in App Review notes — **the reviewer will not have
      mates to invite.** Give them an account already in a populated crew with
      real-looking banter, or they will see an empty app and reject it as
      incomplete. This is the single most likely rejection cause for a social
      app and it is entirely avoidable.

---

## 6. Google Play gates

### 6.1 The two-week wall — do this in week one

**Personal developer accounts created after 2023-11-13 must run a closed test
with at least 12 testers opted in for 14 continuous days before applying for
production access.** Organisation accounts (registered legal entity) are
exempt.

- [ ] Create the Play Console account **now**, not at launch.
- [ ] Decide personal vs organisation early (see `00` open questions).
- [ ] If personal: recruit 12 real testers with distinct Google accounts on
      real devices. Emulators and duplicates do not count.
- [ ] Get them opted in and keep them opted in. The clock resets if the count
      drops.

This is a hard schedule dependency. Left to the end, it delays launch by a
fortnight.

### 6.2 Other Play requirements

- [ ] **Data safety form**, consistent with the §2 table and with the Apple
      labels. Inconsistency between stores is a flag.
- [ ] **Health Connect declaration form** — Play requires a separate
      declaration for apps reading health data, with a demo video.
- [ ] Health Connect privacy policy link inside the app, on the permissions
      screen.
- [ ] **UGC policy** — same four pillars as Apple 1.2.
- [ ] Content rating questionnaire (IARC). Expect **Mature 17+**.
- [ ] Target API level current per Play's rolling requirement.
- [ ] Account deletion — Play also requires an in-app path **and** a
      web-accessible deletion request URL. The web target covers this.

---

## 7. Privacy policy — required content

Host at `sledged.app/privacy` (web target). Must be reachable without login and
linked from both store listings and from the app.

Sections:
1. **Who we are**, and a contact address that is monitored.
2. **What we collect** — the §2 table in plain language.
3. **Health data** — a dedicated section. What is read, that it is read on
   device, that raw records are not uploaded, that only what the user saves is
   stored, that it is never used for advertising.
4. **How AI is used** — that logs, names and messages are sent to xAI to
   generate banter; that xAI is a processor; a link to their terms.
5. **Who we share with** — Google, xAI, RevenueCat. Named, with purpose.
6. **Retention** — how long entries and messages are kept.
7. **Your rights** — access, correction, deletion; how in-app deletion works.
8. **Children** — the app is not for under-16s, consistent with the rating.
9. **Changes** and how users are told.

Also publish **Terms of Use** covering acceptable content and zero tolerance
for abuse. Apple looks for this on UGC apps specifically.

**Jurisdiction:** Australian Privacy Principles apply. GDPR applies to any EU
users, so honour access and deletion requests properly regardless of origin —
the in-app deletion already does most of the work.

---

## 8. Content moderation operations

The obligation is 24 hours. The operator is one person. The system must carry
it.

**Pipeline:**
1. **Pre-post filter.** Every user message and every Aiden generation passes
   `moderateContent` (a cheap classifier call) before it is written. High
   severity is blocked outright and never stored as visible.
2. **Report.** Any user reports any item. The item is **hidden immediately**,
   before any human sees the report.
3. **Triage agent.** An automated agent reviews the queue: reads the content
   and the report reason, classifies it, and either confirms removal, restores
   it, or **escalates to Simon** for anything ambiguous, repeated, or involving
   a minor or a threat.
4. **Escalation** reaches Simon by email and push.
5. **Repeat offenders** are ejected. Track reports per user; three upheld
   reports is an automatic ban pending review.

**Audit log.** Every moderation action — automated or human — is recorded with
timestamp, actor, item and outcome. If a store or a regulator asks how a report
was handled, this is the answer.

**Aiden is moderated like a user.** If his output is reported, it is hidden and
reviewed the same way. A high report rate on his output is the signal that a
prompt change went wrong.

---

## 9. Incident response

Short, because at this scale a long plan is a fiction that never gets used.

| Incident | Immediate action |
|---|---|
| Cross-crew data leak | Kill switch on the affected read path, fix rules, deploy, assess notification obligation under the Privacy Act |
| xAI key leaked | Rotate in Secret Manager, redeploy, review billing |
| Cost spike | Global generation kill switch in `config/app` — no deploy needed |
| Aiden produces something serious | Kill switch on generation, hide the item, review the prompt, keep the audit log |
| Store removal notice | Do not argue first. Fix, document the fix, appeal with evidence |

**The kill switches must exist and be tested before launch.** A switch nobody
has ever flipped does not work.
