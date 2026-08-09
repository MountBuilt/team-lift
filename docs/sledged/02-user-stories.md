# Sledged — User Stories

**Date:** 2026-08-09
**Status:** Approved.

Ordered to match the phases in `06`. Each story has acceptance criteria that
are testable. "Done" means the criteria pass, not that the code exists.

Format: **[Phase] ID — Story.** Then criteria.

---

## Epic A — Identity (Phase 1)

**[1] A1 — As a new user, I sign in with Apple or Google so I never manage a password.**
- Both buttons present on the sign-in screen; native sheets, not a web view.
- Sign in with Apple is offered (mandatory once Google is offered).
- Apple's returned display name is captured on **first** authorisation and
  persisted. Apple never returns it again.
- Successful sign-in creates `users/{uid}` with a display name and an assigned
  colour from the fixed palette.
- Returning users land straight on Home, no re-auth.
- Sign-in failure shows a plain message and leaves the user able to retry.

**[1] A2 — As a user, my data is mine and nobody outside my crews can read it.**
- The rules test suite passes all 16 negative cases in `03` §5.
- A user in crew A cannot read entries, messages, feed lines or the notebook of
  crew B, verified by automated test.
- A user cannot write another user's entry, forge an `aiden` message, set their
  own `entitlement`, or add a crew id to their own user doc.
- No client can delete any document.
- CI fails if any negative case passes.

**[6] A3 — As a user, I can delete my account from inside the app.**
- Reachable from Me in three taps or fewer.
- Confirmation states plainly what is deleted and that it cannot be undone.
- Deletion removes the user doc, entries, DM history, push token; soft-deletes
  their crew messages; removes them from all crews.
- The user is signed out and the account cannot be signed back into.
- A web page also accepts deletion requests (Play requirement).

---

## Epic B — Logging (Phase 2)

**[2] B1 — As a user, I log today in a few taps.**
- Floating (+) opens the log sheet from any tab.
- One form: weight, steps, workout body-part chips, challenge tick. No "what do
  you want to log?" step.
- Day picker offers **today, yesterday, the day before only**. No calendar.
- Saving writes `entries/{uid}_{date}`.
- The sheet closes and the feed updates without a manual refresh.

**[2] B2 — As a user, editing a past day does not destroy what I already logged.**
- Opening a day with an existing entry pre-fills every field.
- Saving with a field left blank does **not** overwrite the stored value.
- Clearing a field is possible and explicit.
- `updatedAt` changes; `createdAt` does not.

**[2] B3 — As a user, logging works with no signal.**
- With the device offline, a save succeeds and appears immediately in the UI.
- A "saved locally" state is shown, not an error or an endless spinner.
- The write reaches Firestore when connectivity returns, without user action.
- Two offline edits to the same day resolve to the later one.

**[2] B4 — As a user, I see a daily challenge and can tick it off.**
- One bodyweight exercise per day, identical for every user on that date.
- Reps ramp by challenge week from the crew's `challengeStart`.
- Ticking writes `dailyChallenge: true` on that day's entry.
- The streak counts consecutive ticked days; **a day still in progress does not
  break it** (done yesterday, not yet today, still counts).

**[2] B5 — As a user, I see my own weight in kg but nobody else ever does.**
- Me shows the user's own weight trend in real kg.
- No other screen, chart, feed line, banter line or export shows an absolute kg
  figure for anyone.
- The team weight chart plots percent change from each member's own baseline;
  everyone starts at 0%.
- Missing days render as gaps, not zeros.

---

## Epic C — Crews (Phase 3)

**[3] C1 — As a user, I create a crew and get a link to send my mates.**
- Creating asks only for a name.
- A 6-character code and a share link are produced immediately.
- The creator is admin and the first member.
- The share sheet opens with a sensible default message.

**[3] C2 — As a mate, I join a crew from a link or a code.**
- Opening the link with the app installed joins directly (after sign-in).
- Opening it without the app installed shows the web landing page with the crew
  name and store buttons.
- Pasting a 6-character code also works, and must work even if deferred deep
  linking does not.
- Joining a crew already at 12 members fails with a clear message.
- After joining, the crew's data is visible **within one refresh** (the custom
  claim requires a forced token refresh).

**[3] C3 — As a user in several crews, each stays separate.**
- A crew switcher appears only when the user is in more than one.
- Feed, leaderboard, coach chat and stats all scope to the selected crew.
- Aiden never mentions one crew in another.

**[3] C4 — As a crew admin, I manage my crew.**
- Rename, rotate the invite code, remove a member, set banter intensity
  (Savage / Standard / Clean).
- Non-admins see none of these controls, and rules deny them regardless of UI.
- A removed member immediately loses read access (claim revoked).

**[3] C5 — As a user, I react to a mate's log.**
- Fixed set 🔥💀👏😂, one reaction per user per entry, tappable to change or
  remove.
- Written under the user's own key only; rules deny writing another user's key.
- Counts update live for everyone in the crew.

---

## Epic D — Aiden (Phase 4)

**[4] D1 — As a brand new user, Aiden reacts to my very first log.**
- A line appears within seconds of the first ever entry.
- It takes the piss out of the log rather than welcoming the user.
- It does not reference stats the user does not have.
- It is generated by the dedicated `firstLog` path, not the generic feed line.

**[4] D2 — As a crew member, I get a morning report about yesterday.**
- Posted as a message in the continuous coach chat each morning, one per crew
  per day.
- 300-600 characters, hard cap 700.
- Covers yesterday only; quotes weekly standings from precomputed data.
- Names today's challenge with real reps as an invitation.
- **Never** says anyone avoided, skipped or failed *today's* challenge.
- Not generated for a crew where nobody logged in the last 24 hours.
- Contains at least one named member and at least one actual sledge, not only a
  standings recap.

**[4] D3 — As a crew member, Aiden reacts to each log in the feed.**
- One line per entry, max 200 characters.
- Replaces the factual placeholder; the placeholder shows until it arrives.
- **One generation per entry, ever.** Editing the entry does not re-roll it.
- Reacts to the most interesting fact, not a checklist of every field.

**[4] D4 — As a crew member, Aiden talks back when I talk to him.**
- Aiden replies only after a human has posted in that thread. Never unprompted.
- Max 240 characters.
- All pending human messages are answered in **one** reply, not several.
- Turn 1 hooks to the parent; later turns go off topic unless a human raises
  stats.
- A typing indicator shows while a reply is pending and **gives up after a
  timeout** so a broken backend leaves a quiet thread, not permanent dots.
- A message posted while Aiden is generating is still answered (pre-call
  timestamp).

**[4] D5 — As a user, Aiden remembers.**
- Generations see the last 14 days plus the crew notebook.
- The notebook is rewritten weekly, capped at 1200 characters.
- It never contains an absolute weight or anything moderated out.
- Callbacks reference things that genuinely happened in that crew.

**[4] D6 — As the operator, bad output never reaches users.**
- Every generation is validated: schema, length, no em-dash, no absolute kg, no
  cross-crew mention, no money talk outside the nag job, safety patterns.
- A validation failure discards the **whole** run. No partial writes.
- Every rejection is logged with job, reason and raw output.
- Output also passes the moderation filter before being written.

**[4] D7 — As the operator, no crew can run up an unbounded bill.**
- Per-crew daily generation budget enforced; breach stops generation for that
  crew until the next day and logs it.
- Per-user rate limits enforced server-side (`08` §4).
- Dormant crews and users generate nothing.
- Kill switches for `generation`, `dm` and `push` work from the console with no
  deploy, and have each been flipped at least once in testing.

---

## Epic E — Money (Phase 5)

**[5] E1 — As a new crew member, I get 14 days of the full app.**
- The trial starts on **first crew create or join**, never on install.
- A solo user who never joins a crew never starts a trial.
- Remaining days are visible.
- DM is capped at **20 messages for the whole trial**.
- On expiry the account drops to free with no data loss.

**[5] E2 — As a free user, I still get the crew banter.**
- Morning report and Sunday recap are fully visible.
- All of the crew's messages and other members' feed lines are fully visible.
- Logging, streaks, challenge, leaderboard, stats and reactions all work.

**[5] E3 — As a free user, Aiden's lines about me are teased, not shown.**
- The line about the user's own entry shows a redacted teaser with the price.
- Aiden's replies addressed specifically to that user are redacted the same way.
- **The crew sees every one of those lines in full.**
- Nothing anywhere reveals to other members which users are on free.
- Aiden nags the free user privately, in character, at most once a day, and
  never in an evening push.

**[5] E4 — As a user, I pay once and it sticks.**
- A$2.00, one-off, stated clearly as one-off before purchase.
- Product is **non-consumable** in all three consoles with the same identifier.
- Entitlement updates within seconds of purchase.
- Restore Purchases works on a second device and after a reinstall.
- The client cannot write its own entitlement; rules deny it.

---

## Epic F — Health (Phase 5)

**[5] F1 — As a user, my steps fill themselves in.**
- Permission is requested with a plain-language explanation, and is skippable.
- With permission, the log sheet pre-fills steps for the selected day, editable.
- Without permission, everything still works and the app never nags more than
  once.
- Permission is re-requestable from Me.

**[5] F2 — As a user, a workout my phone detected is offered to me.**
- A detected session surfaces as a suggestion naming the duration.
- One tap opens the log sheet pre-filled, leaving the body-part chips to the
  user.
- Dismissing a suggestion does not re-surface the same session.
- **No raw health record is ever written to Firestore.** Only what the user
  saves as an entry is stored.

---

## Epic G — Notifications (Phase 6)

**[6] G1 — As a user, a morning push gets me moving.**
- Sent from 7:30am local, skipped after 8:30pm.
- Written by Aiden: something true about recent work, today's challenge with
  real reps, then a shove.
- One per user per day, maximum.

**[6] G2 — As a user, an evening nudge is kind, not a spray.**
- Sent from 8:30pm local **only if the user has logged nothing that day**.
- Pure encouragement, offering the easy win.
- **Never** a roast, never calls the user lazy or missing.

**[6] G3 — As the operator, a failed send never spams the crew.**
- Send state is tracked **per user**, updated per user, not per run.
- One user's failure does not cause resends to anyone else.
- A missed window self-heals on the next run without double-sending.
- Users can disable morning and evening independently.

---

## Epic H — Safety (Phase 6)

**[6] H1 — As a user, I report anything.**
- Report is available on every message, feed line and profile, including
  Aiden's own output.
- One tap, a reason picker, immediate confirmation.
- The reported item is **hidden immediately**, before any human review.

**[6] H2 — As a user, I block someone and stop seeing them.**
- Block is available on any user.
- Their messages, feed lines and reactions vanish from the blocker's views at
  once.
- Blocking is one-directional and not disclosed to the blocked user.

**[6] H3 — As the operator, reports are handled within 24 hours.**
- Auto-hide on report satisfies removal instantly, without the operator awake.
- A triage agent classifies each report and confirms, restores, or escalates.
- Escalations reach Simon by email and push.
- Three upheld reports against a user triggers an automatic ban pending review.
- Every action is written to an audit log with timestamp, actor, item, outcome.

**[6] H4 — As a user, objectionable content is stopped before it posts.**
- Every user message and every Aiden generation passes the pre-post filter.
- High-severity content is blocked and never stored as visible.
- Aiden is subject to the same filter as humans.

---

## Epic I — Growth (throughout)

**[2] I1 — As a user who screenshots Aiden, the app name goes with it.**
- Aiden's lines render in a card carrying the Sledged wordmark.
- The mark is legible in a cropped screenshot of a single card.
- **There is no share button.** Sharing stays organic via the system
  screenshot. This is a deliberate decision, not an omission.

**[3] I2 — As a solo user, the app pushes me toward getting mates in.**
- A solo user gets logging, streaks, challenge, own stats, and **one Aiden line
  a day** about their own log.
- No coach chat, no DM, no leaderboard while solo.
- The crew prompt is persistently visible and re-offered daily until acted on.
