# Aiden Threads + Daily Card Freeze — Design

**Date:** 2026-07-19  
**Status:** Approved — implementation in progress (Grok + Claude shared maintainers)  
**Depends on:** Team Lift v1 (`2026-07-08`), push + orchestrator (`2026-07-13`)

## 1. Overview & goals

Two linked upgrades:

1. **Stop stale / wrong coach lines** on the three dashboard cards (weight,
   workouts, steps): rewrite parents once per day at ~3am with precomputed
   week standings, and keep those parents fixed for the calendar day.
2. **Let the crew banter back at Aiden** (the banter bot) under each card
   parent and under each recent activity line. Aiden answers on the hourly
   tick; the UI stays light; Firestore stays on the existing `config/banter`
   doc.

Philosophy: group-chat energy, not a support ticket system. Sub-hour delay is
fine. No “waiting on Aiden”. No Reply buttons littered across the board.

## 2. Naming

| Term | Meaning |
|------|---------|
| **Aiden** | The banter bot (copywriter voice + UI attribution for bot messages) |
| **Parent** | The coach line under a card, or the AI feed line on an activity row |
| **Thread** | Flat list of user + Aiden messages under a parent |
| **cardsDay** | Local `YYYY-MM-DD` the three card parents were last written |

## 3. Problems this fixes

### 3.1 Stale workouts (and friends) coach copy

Observed failure: parent said Hunt and Simon were “locked at 7 sessions”
while **this week** both were on 4. Root causes:

- Model counted all-time workout days from a flat entry dump.
- Card hash only changes when entry data changes, so a wrong line can sit
  for hours/days while the panel numbers stay correct.
- Skill examples encourage “dead heat on N sessions” without forcing
  Mon–Sun scope.

### 3.2 No way for the boys to push back

When Aiden misses, the only fix is the next regen. Threads let the crew
correct him in public and give him material.

## 4. Daily rhythm

| When | Behaviour |
|------|-----------|
| **First tick after 03:00 local** with `cardsDay !== today` (self-heals if Mac slept) | Force new **parent** cards for weight, steps, workouts. Digest yesterday’s **card** threads into `memory`. Wipe card threads. Set `cardsDay = today`. |
| **Rest of calendar day** | Card **parents do not change**, even when entries change. Live reaction is in **threads** (human + Aiden). |
| **Every hourly tick** | Existing push windows. Feed line hash regen as today. **Thread work:** one Aiden message per target that has pending human messages, delete-to-ack, and/or a **comment-worthy** new log (see §7). |
| **Feed parents** | Still created/updated when activity hashes change (not frozen like cards). |

Timezone: same as today — the Mac running `com.teamlift.banter` (Sydney group).

## 5. Data model

All thread state lives on **`config/banter`** (Option 1). No new collections.

```js
// config/banter (extensions only; existing fields unchanged)
{
  date: string,              // existing freshness stamp
  cardsDay: string,          // "YYYY-MM-DD" parents were written
  cards: { weight, steps, workouts },
  feed: { [entryId]: string },
  feedMeta: { [entryId]: string },
  hashes: { weight, steps, workouts, feed },
  history: [ /* existing last ~8 card runs */ ],

  memory: [
    // Daily digests after card-thread purge. Keep last ~14 days.
    { day: "YYYY-MM-DD", notes: string[] }  // 1–3 short bullets
  ],

  threads: {
    // Card targets (keys fixed)
    weight:   Thread,
    steps:    Thread,
    workouts: Thread,
    // Feed targets (keys = entry document id, same as feed map)
    [entryId]: Thread
  }
}

// Thread
{
  messages: Message[],
  lastAidenAt: string | null   // ISO; tick bookkeeping only
}

// Message
{
  id: string,                  // client-generated unique id
  kind: "user" | "aiden",
  userId?: string,             // user only
  name?: string,               // user display name; Aiden may omit or "Aiden"
  text: string,                // max 160 for user; Aiden soft-cap ~200–240
  at: string,                  // ISO; ordering only — never shown in UI
  deleted?: boolean            // soft-delete after Aiden has seen the msg
}
```

### 5.1 Delete semantics

| When author deletes | Behaviour |
|---------------------|-----------|
| **Before Aiden has incorporated the message** | Hard-remove from `messages`. Treated as never happened. |
| **After Aiden has replied past that message** | Set `deleted: true`. Hidden in UI. Next tick context includes a short fact (“Simon deleted an earlier comment”). Aiden may acknowledge once; then hard-drop the tombstone. |

Only the **author** can delete their own user messages. Aiden messages are not user-deletable in v1.

### 5.2 Retention / DB light

| Data | Retention |
|------|-----------|
| Card threads (`weight` / `steps` / `workouts`) | Wiped at daily 3am refresh after digest → `memory` |
| Feed threads | Dropped when parent leaves the recent feed **or** when parent entry date is older than **3 local days** (whichever first). No digest required for feed (discard). |
| `memory` | Last ~14 daily digests |
| Caps on message count | **None in v1** — revisit if the banter doc grows |

## 6. UI

### 6.1 Affordances (no Reply litter)

- There is **no** standalone “Reply” control under every card/row.
- **N comments** appears **only when N ≥ 1**, where N = count of **all visible** messages in the thread (user + Aiden, excluding soft-deleted).
- **Tapping the parent text** (coach line under a card, or the banter phrase on a feed row) **opens/expands the thread and focuses the compose field** so the keyboard comes up.
- If N = 0, nothing says “0 comments”; the parent text is still tappable to start the first message.
- Optional subtle cue on parent (e.g. slight affordance styling) so tap targets are discoverable without dozens of buttons — keep minimal.

### 6.2 Expanded thread

- Flat chronological list (no nesting).
- No timestamps in the UI.
- User lines: name + text; **rubbish bin** only on **own** messages.
- Aiden lines: labelled **Aiden** + text; no bin.
- Compose: **2–3 line** textarea, autofocus on open, **160 char** hard max.
- Only action on compose: **triangle send** icon (no extra Cancel button required; tap outside / collapse can dismiss — implementation detail, keep simple).
- After send: message appears immediately via Firestore snapshot. No “Waiting on Aiden”.

### 6.3 Collapsed default

- Parent always visible.
- If N ≥ 1: show **N comments** (tapping it also expands + can focus compose, same as parent tap).
- Expanded state is local UI only (not persisted).

## 7. When Aiden writes in a thread

On each hourly tick, for each thread target, Aiden posts **at most one** new
message that covers **all pending work** since the last Aiden pass:

1. **New human messages** (non-deleted, after last answered watermark).
2. **Delete acknowledgements** (soft-deleted messages Aiden already answered).
3. **Comment-worthy new logs** (proactive, no human required) — see below.

If none of the above, Aiden stays quiet on that target.

### 7.1 Comment-worthy logs (context only; not pure proactive)

**Live correction (2026-07-19):** pure proactive digs under a feed parent are
**off**. The feed parent line is already Aiden’s public reaction. Opening a
solo thread under it (especially when a comment-worthy entry was **re-edited**
and `updatedAt` cleared the scan watermark) made him re-hype the same log
with nobody else in the thread. Feed threads are **human-led**.

`isCommentWorthy` still exists (tested) and is attached as **context** when
humans already have pending messages on that feed thread, so Aiden can nod at
a big log while answering the crew. Heuristics:

- Workout with **≥ 3 body parts**, or workout **+** daily challenge on same day.
- Steps **≥ 15_000** (aligns with feed effort badges).
- First weigh-in of the challenge window for that user (trend start).
- Weekly target crossed: user reaches **3rd workout day this Mon–Sun** on this write.

**Not comment-worthy alone:** tiny step days, stretch-only, challenge tick with
nothing else, routine single-part sessions.

Card threads stay human-led plus Aiden replies to humans.

(If product later wants unprompted feed monologues again, gate them so Aiden
never re-posts after `lastAidenAt` / existing aiden messages on that target.)

### 7.2 Batching

One Aiden string per target per tick. Address multiple humans and one
comment-worthy event in the same line/paragraph if needed. Soft length
target ~200 chars; hard validation cap can match cards (200) or sit at 240 —
pick one in implementation and test it.

## 8. Orchestrator + copywriter

### 8.1 Context additions

`buildContext` gains:

- `cardsDay`, `today`, force flag for daily card rewrite.
- **`thisWeek`**: precomputed Mon–Sun standings, e.g. per user
  `{ name, workouts, steps, challengeTicks }` plus team totals. Workouts card
  **must** use these numbers only for session counts.
- `memory` (recent digests).
- `threads`: parents + messages + pending sets (new user msgs, deletes to ack,
  comment-worthy entry refs).
- Existing grace rules, storylines, pushes, feedNeeds.

### 8.2 Daily 3am card path

1. Detect need: local time ≥ 03:00 and `cardsDay !== today` (or missing).
2. Build digest notes from card threads → append `memory`, trim to 14 days.
3. Clear `threads.weight|steps|workouts`.
4. Force `sections` to include `weight`, `steps`, `workouts`.
5. Write new `cards.*`, `cardsDay`, hashes, history as today.
6. Same Claude call may also handle thread replies / pushes / feed.

### 8.3 Copywriter rules (additions)

- Bot name **Aiden**; thread replies are in his voice (UI shows “Aiden”).
- Card **parents**: grounded in **this week’s** `thisWeek` data; no all-time
  session races. One beat, ≤ 200 chars, no em-dash, say “workout” not “gym”.
- Card parents are the **morning kickoff** for the day; they will not be
  rewritten mid-day — do not promise “before the weekend” countdown nonsense
  that ages badly; prefer durable framing.
- Thread replies: answer the boys, own mistakes, optional board delta; grace
  rules still apply. Do not re-quote soft-deleted text.
- Memory: callback when funny; do not revive expired storylines.

### 8.4 Validation

Extend `validateCopy` for `threadReplies` map: only requested target keys,
non-empty strings, length cap, banned tokens (em-dash, “gym”).

## 9. Client writes

- `saveThreadMessage(target, { id, text })` → append user message on
  `config/banter.threads[target]` (merge / array strategy chosen in plan —
  prefer read-modify-write via transaction or careful patch; document race
  acceptance for v1 if Spark limits force it).
- `deleteThreadMessage(target, messageId)` → hard delete if not yet answered;
  else soft-delete.
- Max 160 chars enforced in UI; reject blank.
- Only logged-in user; `userId` / `name` from session.

Open rules remain (trusted group). No new security model in this work.

## 10. Stale-card fix summary (non-thread)

| Fix | Detail |
|-----|--------|
| Daily parent refresh | §4 3am path |
| Precomputed standings | `thisWeek` in context |
| Skill / validation | Week-scoped workouts; Aiden naming |
| Mid-day accuracy | Parents freeze; numbers on tiles/dots stay live; Aiden talks in threads |

## 11. Out of scope (v1)

- Push notifications when Aiden replies
- Edit message, admin moderation UI
- Rate limits / message caps
- Firebase Auth / closed rules
- Showing “message deleted” placeholders (vanish only)
- Rewriting card parents mid-day on hash change
- Proactive Aiden cold-starts on empty card threads

## 12. Testing

Pure logic (node --test):

- 3am need detection / `cardsDay` transitions
- Digest + wipe of card threads; feed drop by age (3 days) and by feed window
- Delete-before vs delete-after Aiden watermark
- Comment-worthy heuristics
- `thisWeek` aggregation matches dashboard week counts
- `validateCopy` thread reply rules
- Hash behaviour: card parents forced daily; mid-day entry changes do not
  require parent rewrite

No full browser E2E required for merge; manual smoke on device after deploy.

## 13. Rollout

1. Implement daily freeze + `thisWeek` + skill (parents improve even before UI).
2. Thread schema + client expand/compose/delete.
3. Orchestrator pending + Aiden thread replies + memory.
4. Deploy via push to `main` (GitHub Pages); bump SW cache string if shell UI changes.
5. Force one banter tick after deploy so parents regenerate.

## 14. Open implementation choices (plan can decide)

- Exact Firestore array update strategy (transaction vs full threads map patch).
- Whether parent tap and “N comments” share one expand controller.
- Aiden thread reply hard char cap 200 vs 240.
- Whether feed purge is only age-based or also when `groupFeedByDay` drops the item (do both: age ≥ 3 days **or** not in current feed set).

## 15. Success criteria

- Workouts parent never claims all-time “7–7” when the week panel shows 4–4.
- Card parents refresh every local morning (or first wake after 3am).
- Users can open a thread by tapping parent text; first message needs no prior N.
- “N comments” only when N ≥ 1; no Reply chrome everywhere.
- Aiden batches all new human msgs on a target into one hourly reply.
- Author delete before reply = gone; after reply = Aiden can acknowledge next hour.
- Card threads empty after 3am; Aiden retains short digests in `memory`.
- Feed banter/threads older than 3 days gone from the doc.
