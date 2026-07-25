# Aiden's morning report + live replies (2026-07-26)

Source of truth for how Aiden works. Supersedes the card-parent half of
`2026-07-19-aiden-threads-design.md` (thread mechanics from that doc still
stand; the three card parents do not).

Maintainers: Claude and Grok. Read this before touching the report, the feed,
the copywriter, or the tick.

## Why this exists

The one goal is **getting the crew to log something every day.** Everything
below is judged against that.

The previous design worked but had three problems:

1. **Repetition.** Every feed entry got an AI line generated in isolation from
   the same four fields, so the copy became a checklist recital. Measured over
   the 110 stored lines: 70 mentioned the scales, 39 said "ticked", 15 opened
   with "backed", `"before most blokes"` appeared 10 times. A 28.8 KB skill file
   full of numbered joke "shapes" made it worse, not better: the model reached
   for a listed shape instead of reacting to what happened.
2. **Cost.** A 94 KB context (~25k tokens) per call, of which about two thirds
   was duplication, invoked through a full Claude Code agent (its system prompt,
   the project CLAUDE.md, the skill, up to 60 turns) 9 to 22 times a day to
   produce a few hundred characters.
3. **Latency.** The AI feed line replaced the instant local one up to an hour
   later, so the text visibly changed under the bloke who logged it.

## The shape now

| Surface | Who writes it | When | Rewritten? |
|---|---|---|---|
| Recent activity line | `feedLine()` template, client-side | instantly on save | never |
| Morning report | Aiden (one model call) | once a day, first tick after 03:00 | daily |
| Thread replies | Aiden (same call) | within ~1-2 min of a comment or a big log | never |
| Push copy | Aiden (same call) | 07:30 / 20:30 windows | n/a |

### Recent activity is template-only

`js/ui/feed.js` always renders `feedLine(entry)`. No AI, no waiting, no
rewriting. The line is the reward for logging, so it must appear immediately and
must not change afterwards; the seed is `userId|date` (not `updatedAt`) so
editing an entry keeps its line.

Freshness here comes from **pool size**, not from the model. The pools in
`js/lib/banter.js` were roughly doubled. When the feed starts to feel stale, add
lines to those pools. Do not put the AI back in the feed parent.

### Aiden reacts as a comment, not a rewrite

`collectThreadJobs` opens a `praise` job when a bloke posts a comment-worthy log
that Aiden has never replied to. This deliberately re-enables the proactive feed
comments that were switched off on 2026-07-19 — that ban existed because the AI
feed *parent* was Aiden's voice, so a thread reply repeated it. The parent is a
template now, so a reply is a reaction rather than an echo.

The old re-fire bug is prevented structurally: the gate is
`aidenHasSpoken(thread)`, which an entry edit cannot undo. Capped at
`MAX_PROACTIVE_FEED` per tick, today and yesterday only.

### One report replaces three card parents

`config/banter.report = { day, text }`, 300-600 chars (hard cap 700), covering
**yesterday only** across weight, the daily challenge, workouts and steps, with
one comment thread (`target: 'report'`). Rendered at the top of the dashboard by
`reportCard()`.

Do not put coach lines back on the weight/steps/workouts cards. One connected
piece with a through-line beats three disconnected quips, it is one comment
surface instead of three, and one model call instead of three.

`js/lib/report.js` provides `templateReport()`, a deterministic offline version
composed from the existing per-section quips, used when the AI report is missing
or stale (dead tick, first run, Mac asleep). So the card always renders.

## Absolute weights cannot leak

The team chart deliberately obscures kg (coarse ticks, delta-only tooltips) and
the banter was undoing it: live copy published "glued to 80" and "78 down to
75". The context now carries **`weightDelta` only, never an absolute**, so the
model cannot state one. `findAbsoluteWeight()` in `context.mjs` is a regex
backstop, not the primary defence.

## The tick

`scripts/orchestrator.mjs`, every 60 seconds via launchd.

1. **Probe** (`probeWork`): read `config/banter` + `config/push` only, 2
   document reads. Exit immediately when there is nothing to do — no writes, and
   the wrapper does not even log the run. This is what makes a 60s interval
   affordable (~2,900 reads/day against a 50k free-tier allowance) and near-live
   replies possible.
2. Otherwise fetch users + entries, work out what copy is needed.
3. **One model call** for report + all thread replies + all pushes
   (`scripts/lib/copywriter.mjs`).
4. Re-read `config/banter`, merge, write only changed fields.

Work is detected via `config/banter.pendingAt`, stamped by the client whenever
someone comments or saves an entry (`pokeAiden()` in `js/firebase.js`). A
`STALE_SCAN_MINUTES` sweep runs regardless, so a client that fails to stamp it
cannot stall Aiden forever.

### Two write rules that must not regress

- **Never PATCH the whole `threads` map.** The client and the tick both did, so
  any comment posted while the model was thinking (1-3 minutes, up to 22 times a
  day) was silently destroyed. The client writes one key via `FieldPath`;
  the tick computes a per-key `threadWritePlan` against a freshly re-read doc.
- **`lastAidenAt` is the PRE-CALL timestamp**, not the write time. A comment
  that lands mid-call is then still pending and gets answered next tick instead
  of being marked as read without being seen.

### Copy backend

`scripts/lib/copywriter.mjs` picks automatically:

- `~/.config/teamlift/anthropic-key` present → **Messages API**, one turn,
  structured output, ~3-6s. Required for replies to feel live. Metered.
- otherwise → **`claude -p`** on the Pro subscription via
  `CLAUDE_CODE_OAUTH_TOKEN`. No per-token bill, but it spins up an agent per
  call: measured at 88s. Fine for the 3am report, too slow to feel live.

Model is one constant (`MODEL` in `copywriter.mjs`). Thinking is on for the
report (nobody is waiting at 3am) and off for thread-only ticks (someone is).

## Voice guide

`scripts/prompt/aiden.md`, loaded as the system prompt. Replaced
`.claude/skills/copywriter/SKILL.md` (394 lines, 28.8 KB), which is deleted.

It carries principles, the grace rules, the job specs and the hard bans. It
deliberately does **not** carry a bank of numbered joke shapes or a 40-row
nickname table: those made the output more formulaic, because the model picked
from the list instead of reacting to the data. Anti-repetition is driven by
`previousReport`, `reportHistory` and `memory` instead.

`memory` digests now store the **actual text** of what the crew said (truncated),
not `"workouts: Simon bantered (2 msgs)"`. The old shape meant callbacks were
impossible, so the memory feature did nothing.

## Grace rules (unchanged, still override the roast)

1. **Same-day grace.** Today is never a missed, lazy or skipped day.
2. **Rest days.** 1-2 empty completed days is a legitimate rest day; 3+ is fair
   game.

The morning report covers a *completed* day, so silence in it is fair game
subject to rule 2.

## Pure logic and coverage

`js/lib/` stays pure (no Firebase, no DOM) and every function there has
`node --test` coverage: `report.js` (new), `threads.js`, `banter.js`,
`aggregate.js`, `dates.js` (now including the day picker), `challenge.js`.
