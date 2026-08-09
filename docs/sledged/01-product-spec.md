# Sledged — Product Specification

**Date:** 2026-08-09
**Status:** Approved.

---

## 1. Vision

Sledged is a group fitness accountability app where an AI character called
**Aiden** roasts, praises and stirs a crew of mates into logging something
every day.

It is not a training app. It does not write programmes, count sets, or coach
form. There are a hundred of those. Sledged does one thing: it makes the daily
act of logging feel like walking into a change room where someone is going to
say something about you.

**The wedge:** existing accountability apps are polite. They send "Great job!"
and a green tick. That is why nobody opens them on day nine. Aiden is rude,
specific, has moods, remembers what you said last week, and will take another
bloke's side against you. People screenshot that. Nobody screenshots a green
tick.

**The moat:** the banter is generated from your crew's actual numbers and
actual conversations. A competitor can copy the feature list in a fortnight.
They cannot copy two months of your crew's in-jokes.

---

## 2. The one goal

**Get the crew logging something every day.** Judge every proposed feature
against it. If it does not increase the chance a bloke opens the app and logs
tomorrow, it does not ship.

---

## 3. Who it is for

**Primary — "the crew regular."** Male, 25-45, Australian or Australian-
adjacent humour, trains 2-5 times a week, already in a group chat with the
blokes he trains near. He is not chasing a PB spreadsheet. He wants the
social pressure and he wants to laugh. He is the one who screenshots.

**Secondary — "the mate who got dragged in."** Installed because someone sent
an invite link and the screenshots were funny. Logs sporadically. Converts to
regular if Aiden notices him in the first week, churns if Aiden does not.
**This user's first seven days is the single highest-leverage part of the
product.**

**Explicit non-user.** Anyone wanting a workout programme, macro tracking,
form video, or a supportive wellness tone. Sledged is not for them and should
not be softened to try.

**Reachable audience.** The register puts the app at 16+ or 18+ (see `05`).
That is accepted. A watered-down Sledged is worth less than a smaller one that
lands.

---

## 4. Core loop

```
open app  ->  see what Aiden said about the crew overnight
          ->  see where you sit against the others
          ->  log today (steps auto-filled, two taps for the rest)
          ->  Aiden reacts to your log by name
          ->  someone replies, Aiden argues back
          ->  push notification tomorrow morning pulls you in again
```

Every part of that loop must survive a crew of two. A crew of two is the
normal starting state and most products of this shape feel dead there.

---

## 5. Onboarding

**Decision: log first, crew prompt after.** Value before commitment. A crew
wall on cold store traffic loses the majority of installs before they have
seen anything.

```
1. Splash / value prop     one screen, one line, one button. No carousel.
2. Sign in                 Apple or Google. Native sheets, not web OAuth.
3. Name + handle           first name as displayed to the crew.
4. Health permission       "Auto-fill your steps?" Skippable, re-askable later.
5. First log               the log sheet, pre-filled with today's steps.
6. Aiden reacts            immediately, by name, to that first log.
7. Crew prompt             "Sledged is rubbish alone. Get your mates in."
                           -> Create a crew (get invite link, share sheet)
                           -> Join a crew (paste code / open invite link)
                           -> Later (dismissible, re-prompted daily until done)
```

**Step 6 is the demo.** It is the first and possibly only chance to show what
the app is. It must fire within a couple of seconds of the first save and it
must be good. Budget a dedicated prompt path for it (`04` §7).

**Solo state.** A user with no crew gets: logging, streaks, the daily
challenge, their own stats, and **one Aiden line per day** about their own log.
No coach chat, no DM, no leaderboard. Solo is a waiting room, and it should
feel slightly lonely on purpose — the crew prompt is always visible.

**Deep link.** An invite link opened on a device without the app goes to the
web landing page, which shows the crew name, who is in it, and store buttons.
After install, the invite is honoured via deferred deep link if available, and
by pasting the code if not. Do not block on deferred deep linking; the paste
fallback must work on day one.

---

## 6. Screens

Four tabs. Sticky bottom tab bar with safe-area insets (Team Lift's `.safe-top`
lesson: PWA/notch handling was a real bug, do not repeat it).

### 6.1 Home

The default tab. Ordered by what pulls someone back in.

1. **Coach chat card** — the latest 3 visible messages from the crew's
   continuous report thread, Aiden's morning post included, each clipped to
   ~180 characters. Tapping opens the full thread. **This is the top of the
   screen because it is the reason people open the app.**
2. **Your status strip** — logged today or not, current streak, today's
   challenge with a tick button.
3. **Daily challenge card** — today's exercise and reps, tick to complete,
   streak count.
4. **Crew leaderboard** — this week Mon-Sun, workouts and challenge ticks.
   Compact. Taps through to Stats.
5. **Recent activity** — the crew's logs, most recent first, each with Aiden's
   feed line as its headline and peer reactions underneath. Tap to open its
   thread.

**No "LOG SOMETHING" nudge card.** Team Lift removed it; the floating (+)
button is the log entry point and the nudge card was noise.

### 6.2 Stats

- Week tiles: crew workouts this week, blokes at 3+, crew total steps.
- Workouts panel: per member, Mon-Sun dot row for this week with last week
  alongside. Bold at 3+. Flame for a multi-week streak.
- Weight chart: **percent change from each member's own baseline.** Everyone
  starts at 0%. Absolute kg never appears. Missing days are line gaps, not
  zeros.
- Steps chart: stacked daily bars, one segment per member in their colour.

### 6.3 Crew

- Crew switcher at the top if the user is in more than one.
- Member list with colours, weekly standing, streaks.
- Invite: share link, copy code.
- Crew settings (creator only): name, **banter intensity** (Savage / Standard
  / Clean), remove member.
- Per-member: block, report.

### 6.4 Me

- Your own weight trend **in real kg** (private, your data, your eyes).
- Your steps and workout history.
- Your entries, tap to edit.
- Settings: health permissions, notifications, banter intensity preference,
  restore purchase, **delete account**, privacy policy, support.

### 6.5 Log sheet (modal, from the floating +)

- Day picker offering **today, yesterday, the day before only**. No calendar.
  Nobody backfills further, and a calendar is a whole date picker to choose
  between three realistic answers.
- One form, all fields at once: weight, steps, workout body-part chips,
  challenge tick. No "what do you want to log?" step.
- Steps pre-filled from Health where permitted, editable.
- Opening a day you already logged pre-fills it for editing.
- Blank fields do **not** overwrite existing values. Clearing a field is
  explicit.

Workout parts: arms, shoulders, legs, chest, back, core, full body, stretching.

### 6.6 Coach chat (full thread)

- The crew's continuous conversation. Aiden's morning report is a message in
  it, posted each morning, not a separate static card.
- Opens scrolled to the **bottom** (newest).
- Height-capped with **Load earlier** windowing (40 initial, 20 per chunk).
- Aiden-is-typing dots while a reply is pending, with a timeout so a broken
  backend leaves a quiet thread rather than Aiden typing forever.
- Long-press a message: report, block author, delete own.

### 6.7 DM Aiden (paid)

Private 1:1 thread. Same mechanics as coach chat, no other crew member sees it.
Rate limited (`08` §4).

---

## 7. Crews

- A user may belong to **multiple crews**, each capped at **12 members**.
- Created by any user; creator is admin.
- Joined by invite link or 6-character code. Codes are single-crew, not
  single-use, and rotatable by the admin.
- Aiden treats each crew as a separate world: separate report, separate
  notebook, separate storylines. He never mentions crew A in crew B.
- Leaving a crew removes you from its future reports. Your past entries stay
  in your own history but are removed from that crew's feed.

**Why 12.** It bounds Aiden's context (and therefore cost), and it keeps the
banter sharp — he cannot hold thirty blokes' running jokes in one prompt, and
a report naming thirty people is a phone book.

---

## 8. Free vs paid

**Price: A$2.00, one-off, per person, non-consumable.** No subscription in v1.

### Free forever

- Logging, editing, history, streaks
- Daily challenge and challenge streaks
- Crew membership, invites, leaderboard, stats, charts
- Peer reactions
- **Aiden's morning report** (crew-wide)
- **Aiden's Sunday weekly recap** (crew-wide)
- Reading everything the crew posts

The crew-wide report and recap are free because they cost the same whether a
crew has two blokes or twelve — one generation, shared. The marginal cost of
an extra free user is effectively zero, and they are the thing worth
screenshotting. Putting the growth engine behind a paywall would be a
self-inflicted wound.

### Paid — "Aiden talks to you"

- Aiden's **feed line about your specific log**, in full
- Aiden **replying to you** in coach chat
- **DM Aiden**
- Personalised callbacks to your own history

Per-user AI is what scales with headcount, so per-user AI is what is charged
for. The economics of this split are worked in `08`.

### Trial

**14 days of full paid access, starting when the user creates or joins their
first crew.** Not on install. A user who installs, pokes around solo and never
gets a crew must not burn trial budget.

DM is capped at **20 messages for the duration of the trial**. This bounds the
worst case; a trial user who discovers DM on day one cannot run up a bill.

### The tightass mechanic

When a free user's trial has ended:

- **The crew sees Aiden's full feed line about that user's log.** Aiden does
  not go quiet about him, and the crew never learns he is on free.
- **That user sees his own line redacted:** the card shows Aiden's avatar, the
  fact that he said something, and a teaser — *"Aiden's got something to say
  about that squat session. $2."*
- **Aiden nags that user directly, in that user's own view only**, savagely
  and in character. This is the one place Aiden is allowed to mention money,
  and he should be funny about it, not a paywall in a costume.
- Coach chat: Aiden's replies to *other* people are fully visible. Replies
  addressed to the free user are redacted the same way.

**What is explicitly forbidden:** naming the non-payer to the crew. It
discloses one user's purchase status to third parties, reads as public shaming
for non-payment, and is a genuine store rejection risk. Aiden may never say
"Dave hasn't paid" or anything a crew member could decode. The FOMO comes from
the redaction the free user sees, and from him mentioning it in the group chat
himself.

**Purchase restoration** must work across devices and reinstalls, and must be
reachable from Me without signing in again.

---

## 9. Health integration

Read-only. **Steps and workouts only.** No writes back.

- iOS: HealthKit — step count, workout sessions.
- Android: Health Connect — same.
- Steps auto-fill the log sheet for the selected day.
- A detected workout surfaces as a suggestion: *"Health says you trained for
  52 minutes. Log it?"* — one tap to accept, which opens the log sheet
  pre-filled with the body-part chips left for the user.
- **Never write health data to Firestore beyond what the user saves as an
  entry.** Raw health records stay on device.
- Permission is skippable at onboarding and re-askable from Me. The app is
  fully functional without it.

Weight stays manual. Reading weight from Health is technically easy and a
privacy liability disproportionate to the benefit.

---

## 10. Notifications

Two, both via FCM. Both are Aiden in voice, never system-generated text.

- **Morning (from 7:30am local):** motivation. Something true about the user's
  recent work, today's challenge with real reps, then a shove out the door.
  Skipped after 8:30pm.
- **Evening (from 8:30pm local):** only if the user has logged nothing today.
  **Pure encouragement, never a spray.** Offer the easy win: the challenge
  reps, a short walk, just the scales. This is a rule, not a tone preference —
  a roast at 9pm to someone having a bad day is how you lose a user.

State is tracked per user so a missed send self-heals and never double-sends.
Team Lift's bug here — one failed send re-spamming the whole crew — is
documented in `03`; do not reintroduce it.

Users can disable either independently. Disabling both is allowed.

---

## 11. Safety and moderation (user-facing)

Detail and compliance obligations in `05`. The UX:

- **Report** on every message, feed line and user profile. One tap, a reason
  picker, immediate confirmation.
- **Block** on every user. A blocked user's content disappears from the
  reporter's feeds and threads immediately.
- Reported content is **hidden immediately**, pending review. This is what
  makes the 24-hour obligation survivable for a solo operator.
- A user whose content is removed is told, once, plainly.
- Aiden's own output goes through the same filter as human content. He is
  allowed to be filthy; he is not allowed to be hateful, sexual about minors,
  or targeted harassment. The line is drawn in `04` §9.

---

## 12. Brand

**Inherits Team Lift.** True dark (#0f0f0f-#111 ground), bold high-contrast
sans, strong red/orange accent, clean cards, subtle borders, large touch
targets, mobile first.

**The one addition:** Aiden's lines render in a visually distinct card that
carries the **Sledged wordmark**. Not a share button — a persistent mark. When
someone screenshots Aiden with the system button and drops it in a group chat,
the app name goes with it. That is the entire growth strategy and it costs one
component.

Charts use an accessible categorical palette that doubles as the member colour
palette. Weight chart y-axis stays coarse so exact values are not readable.

---

## 13. Out of scope for v1

- Subscriptions, multiple price tiers, gifting
- Photos, progress pics, video
- Workout programmes, set/rep logging, exercise library
- Apple Watch or Wear OS app
- Direct messages between users (Aiden DM only)
- Web logging (web is invite + landing + policy pages only)
- Cross-crew leaderboards, global rankings, public profiles
- Data export
- Localisation beyond English

Each of these is a defensible v2. None of them is the difference between a
crew logging daily and not.
