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

While a comment is waiting on Aiden, the thread shows a 3-dot "Aiden is typing"
indicator (`aidenThinkingState()`), so a ~20s to 1 minute wait reads as composing
rather than ignoring. It stops after `THINKING_WINDOW_MINUTES`, because a broken
tick should leave a quiet thread rather than Aiden apparently typing forever.

### Recent activity is template-only

`js/ui/feed.js` always renders `feedLine(entry)`. No AI, no waiting, no
rewriting. The line is the reward for logging, so it must appear immediately and
must not change afterwards; the seed is `userId|date` (not `updatedAt`) so
editing an entry keeps its line.

Freshness here comes from **pool size**, not from the model. The pools in
`js/lib/banter.js` were roughly doubled. When the feed starts to feel stale, add
lines to those pools. Do not put the AI back in the feed parent.

### Aiden reacts as a comment, not a rewrite

Superseded 2026-08-02, see `2026-08-02-aiden-moods-design.md`: proactive
`praise` jobs are removed. `collectThreadJobs` is human-led only. The feed
parent is Aiden's own template line, so replying to it unprompted was him
restating himself, and it read as canned.

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

Default is **SuperGrok** via Grok Build headless (`grok -p`), authenticated
with `~/.grok/auth.json` (`grok login`). No metered `console.x.ai` credits.
The child process strips `XAI_API_KEY` / `GROK_API_KEY` so a shell that has an
API key for other work cannot silently bill the banter tick. Measured
**~6s** for a structured thread-shaped call (2026-08-02).

Fallbacks (automatic, or force with `TEAM_LIFT_COPY_BACKEND`):

| Backend | When | Notes |
|---|---|---|
| `grok-cli` | default when `grok` + auth present | SuperGrok monthly sub |
| `cli` | Claude fallback | `claude -p` on Pro, ~16-20s thread |
| `api` | Anthropic key present | Messages API, metered escape hatch |

Two settings on both CLI paths are load bearing. Measured on Claude; same
discipline applies to Grok Build:

| | Effect |
|---|---|
| `stdio: ['ignore', ...]` | Without it the CLI waits for piped input that never arrives, and warns. |
| `cwd: tmpdir()` | Run from the repo root and the coding agent loads CLAUDE.md / AGENTS.md / `.claude/` as context. **38.6s → 17.4s** on Claude for the same prompt. Nothing in this job needs repo context. |

The original 88s figure was the report-plus-thread job with both of these wrong
on Claude.

Models live in `copywriter.mjs` (`GROK_MODEL`, `CLAUDE_MODEL`).

## Storylines forget themselves

`scripts/storylines.mjs`. Feed a beat in as
`{ id, subject, added: '<today>', note }` and it goes live on the next tick and
expires `DEFAULT_DAYS` (3) later. There is no end date to maintain.

This replaced hand-written `until` dates, which nobody moved: the first two
storylines (Swifty's wagyu, Jon's missing scales) were still in every piece of
copy a week after they stopped being funny. Three days is about how long a
group-chat bit survives. `days` overrides it for a beat with real legs; use it
sparingly, because a joke outliving the moment is exactly what makes the whole
thing feel stale.

## Voice guide

`scripts/prompt/aiden.md`, loaded as the system prompt. Replaced
`.claude/skills/copywriter/SKILL.md` (394 lines, 28.8 KB), which is deleted.

It carries principles, the register, the grace rules, the job specs and the hard
bans. Two parts are load bearing and were both learned the hard way:

- **The locker-room register** (soft-sexist harden-up, innuendo, camp/
  shower-block) with a handful of calibration examples. This is wanted, not
  merely tolerated. It got cut in the first pass at slimming the prompt and the
  copy went flat immediately.
- **"A report that is only a standings recap has failed."** Without that line
  the model writes accurate scoreboard prose and no jokes. Measured: the same
  context produced a flat recap before the line and a nicknamed sledge after.

What it must not become again is a **bank**: 24 numbered joke shapes and a
40-row nickname table made the output *more* formulaic, because the model worked
through the list instead of reacting to the data. Examples to calibrate the
voice, yes. A menu to rotate through, no. Anti-repetition comes from
`previousReport`, `reportHistory` and `memory`.

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
