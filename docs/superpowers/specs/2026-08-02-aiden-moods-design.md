# Aiden: moods, conversation depth, and a compose box that stays open

2026-08-02. Amends `2026-07-26-morning-report-design.md`, which stays the source
of truth for everything not contradicted here.

## The complaint

A thread ran past thirty messages and Aiden said the same thing every time:
same shape, same hook back to the workout, same agreeable register. He was also
commenting under logs nobody had spoken on, and the compose box collapsed
whenever a Firestore snapshot repainted the feed, so nobody saw the typing dots
or his reply landing.

## 1. Human-led threads only

`collectThreadJobs` no longer opens proactive `praise` jobs.
`MAX_PROACTIVE_FEED` and `PROACTIVE_MAX_AGE_DAYS` are gone with them.

The reasoning that brought them back on 2026-07-26 was wrong in one place: the
feed parent being a *template* does not make it someone else's voice. It is
Aiden's voice, written by the same persona. Commenting under it unprompted is
him agreeing with himself, and it is the single most canned thing on the board.
Aiden speaks under a log when a human speaks first. Nowhere else.

## 2. Moods

`MOODS` in `scripts/lib/context.mjs`. Ten of them.

**2026-08-16:** mood is event-sticky, not clock-rotated. `resolveMood` picks
from the event that woke him (report data, a new log, a new thread, a delete,
a push wave) and persists `{ name, targets, trigger }` on `config/banter.mood`.
More comments on the same thread keep that mood (`sticky: true`). The old
`seed = floor(now / 60000)` rotation is retired.

Four are deliberately not nice: `combative` (argue, do not concede), `sulking`
(passive aggressive and a bit pathetic), `unhinged` (go somewhere nobody
expected and do not circle back to the stats), `filthy` (lean all the way into
the change-room register). The flat, even, always-supportive Aiden was the
failure mode, so the mood list has to contain moods that are not support.

The prompt is told the mood beats the register default.

## 3. Conversation depth

`threadWork[]` carries `aidenTurns` (his non-deleted messages in that thread)
and a `turnGuidance` string:

- turn 1: hook to `parent` / `entry`, then take it somewhere.
- turn 2+: **the stats, the workout and the standings are off the table**
  unless a bloke raises them. React to what was actually said, change the
  subject, wind him up, hold a grudge from earlier in the thread.

The prompt's `threadReplies` section now also requires: treat every joke and
shape in your own earlier `messages` as burnt, go off topic on purpose, push
back and disagree, vary the *shape* (question, single word, accusation, non
sequitur, callback, bet, story about yourself), and vary the length (240 is a
cap, not a target).

## 4. The compose box survives a repaint

`js/ui/thread.js` keeps a module-level `drafts` map and a `focusedTarget`.

Every Firestore snapshot rebuilds the feed's innerHTML, which destroyed the
textarea mid-sentence: on mobile the keyboard dropped and the thread looked
like it had closed, so the typing dots and Aiden's reply were never seen.

`restoreCompose()` runs from `bindPanel()` on every paint. It puts the draft
text back, and refocuses **only** if the bloke had that input focused when the
repaint hit. The blur handler distinguishes a real blur from a repaint by
checking `input.isConnected` — a removed element blurs too, and clearing
`focusedTarget` on that is what would lose the keyboard.

Sending clears the draft before the repaint, so the box comes back empty,
focused, with the typing dots under it.
