# Team Lift

Static, no-build web app: vanilla ES modules + compiled Tailwind (committed
CSS) + Chart.js (CDN, deferred), Firebase Firestore backend (open rules,
trusted group, offline persistence on), installable PWA, hosted on GitHub
Pages.

**The one goal: get the crew logging something every day.** Judge every change
against that.

**Maintainers:** **Grok primary**, Claude welcome for review and occasional
edits. Read this file and the specs under `docs/superpowers/specs/` before
changing the report, the feed, the tick, or the copywriter. Leave short
comments when you change cross-agent behaviour (orchestrator, `config/banter`
shape, `scripts/prompt/aiden.md`).

**Production tick host:** Intel NUC (Linux Mint, systemd user timer). Mac is
for development and optional hand/dry-run only. Ops: `docs/ops-nuc.md`.

## Specs (read these)
- v1 app: `docs/superpowers/specs/2026-07-08-team-lift-design.md`
- Push + orchestrator: `docs/superpowers/specs/2026-07-13-push-notifications-design.md`
- Thread mechanics: `docs/superpowers/specs/2026-07-19-aiden-threads-design.md`
  (its three card parents are superseded; the thread rules still stand)
- **Morning report + live replies (2026-07-26):**
  `docs/superpowers/specs/2026-07-26-morning-report-design.md` — **source of
  truth** for Aiden, the feed, and the tick.
- NUC tick ops: `docs/ops-nuc.md`
- Sunday weekly recap: `docs/superpowers/specs/2026-08-03-weekly-recap-design.md`

## Commands
- Unit tests: `node --test` (auto-discovers `tests/*.test.js`; Node 26 rejects a bare `tests/` directory argument)
- Run locally: `python3 -m http.server 8000` then open http://localhost:8000
- Deploy: push to `main` (GitHub Pages serves repo root)
- Firestore rules deploy: `firebase deploy --only firestore:rules`
- Tick (report + replies + pushes): **production** is the NUC systemd timer
  (`teamlift-banter.timer`, every 60s). Hand/dry-run from any machine:
  `bash scripts/refresh-banter.sh` (wrapper for `node scripts/orchestrator.mjs`;
  supports `--dry-run` and `--send-test <userId>`; logs to
  `~/.local/state/teamlift/banter.log`; silent for idle ticks). Install /
  cutover: `docs/ops-nuc.md`
- Tailwind rebuild (needed whenever HTML/JS gains a utility class not already
  in use): `npx tailwindcss@3.4.17 -i css/tailwind.source.css -o css/tailwind.css --minify`

## Conventions
- `js/lib/` = pure logic only (dates, aggregation, threads, report). No Firebase
  imports, no DOM. Everything here needs `node --test` coverage. If a UI module
  grows a pure helper worth testing, move it here (it cannot be imported under
  node otherwise, because `js/firebase.js` pulls the SDK from a CDN URL).
- `js/ui/` = one module per screen/component; each exports a `render*` function
  that takes state and returns/updates DOM.
- All entry dates are local `YYYY-MM-DD` strings. Weeks are Mon–Sun.
- UI copy says "workout", never "gym".
- The banter bot is named **Aiden** (UI label + copywriter voice).
- Feed lines and dashboard quips: deliberately over-the-top, explicit Aussie
  gym banter (swearing intended — don't sanitise). Deterministic seeded picks
  so quips rotate daily and stay testable.
  No em-dashes in any user-facing copy or banter (they read as AI-written);
  use a comma, full stop, or plain hyphen.
- Peer reactions live on `entries/{id}.reactions` as `{ [userId]: emoji }`
  (fixed set 🔥💀👏😂), written with FieldPath per user. Client-only; no tick
  involvement. Weekly awards are pure client functions over Mon–Sun.
- Sunday weekly recap: `config/banter.weeklyReport` + thread target `weekly`,
  same one-call-per-tick as the morning report. Spec:
  `docs/superpowers/specs/2026-08-03-weekly-recap-design.md`.
- **Never publish an absolute weight in kg.** Deltas and trends only, in the
  charts and in the banter. The copywriter context carries `weightDelta` and
  never a raw weight, so the model cannot leak one; `findAbsoluteWeight()` in
  `scripts/lib/context.mjs` is a backstop.
- Topical storylines (`scripts/storylines.mjs`): real-world banter fed from the
  group chat. `{ id, subject, added, note }` where `subject` is a bloke's name
  or `'team'` and `added` is the day you fed it in. **It expires itself
  `DEFAULT_DAYS` (3) later** — you never maintain an end date. `days` overrides
  that, but reach for it rarely: the first two storylines carried hand-written
  `until` dates, nobody moved them, and Aiden was still doing wagyu and
  no-scales material a week after both had stopped being funny. Same-day grace:
  nobody is roasted for not-yet-logging today, and 1-2 empty days = rest
  (`REST_GRACE_DAYS`), 3+ = fair game.
- Daily challenge (`js/lib/challenge.js`): one bodyweight exercise per day,
  a pure function of the date (no backend state), reps ramp weekly from the
  challenge start. Ticking it writes `dailyChallenge: true` on that day's
  entry doc; streaks are consecutive ticked days.
- Team weight chart plots actual kg but keeps exact values obscured: coarse
  10 kg y-axis ticks, tooltips show change vs first weigh-in (never absolute kg).
- Log sheet day picker: `dayOptions()` in `js/lib/dates.js` offers today,
  yesterday and the day before, collapsed to the selected day until tapped.
  There is no calendar input; nobody backfills further than two days.
- Web push (`js/push.js`, toggle on the Me view): raw VAPID, subscription
  stored on `users/{id}.push`. Sent by `scripts/orchestrator.mjs`: morning
  motivation from 7:30am (skipped after 8:30pm), evening reminder from 8:30pm
  only if nothing is logged that day; state in `config/push`
  (`lastMorning`/`lastEvening`) so missed ticks self-heal and never double-send.

## Aiden (2026-07-26) — do not regress

Full detail: `docs/superpowers/specs/2026-07-26-morning-report-design.md`.

- **Recent activity is template-only.** `js/ui/feed.js` always renders
  `feedLine(entry)`, instantly, client-side, no AI. It is the reward for
  logging, so it must never be rewritten after the fact. Freshness comes from
  widening the pools in `js/lib/banter.js`, not from the model. The seed is
  `userId|date`, so editing an entry keeps its line.
- **Aiden reacts as a comment, never a rewrite, and only when spoken to
  (2026-08-02).** Proactive `praise` jobs are gone: the template feed line is
  already Aiden's voice, so an unprompted reply under it was him restating
  himself, which is exactly the "canned" feeling the crew called out.
  `collectThreadJobs` is human-led only. Don't put unprompted feed reactions
  back.
- **Aiden has moods (2026-08-02).** `MOODS` in `scripts/lib/context.mjs`, one
  picked per tick from `seed` (minute-of-epoch, passed by the orchestrator) and
  handed over as `context.mood`. Several are deliberately not agreeable
  (`combative`, `sulking`, `unhinged`, `filthy`) because the flat, even,
  always-supportive register was the failure mode.
- **Threads are conversations after turn 1.** `threadWork[].aidenTurns` and
  `turnGuidance` tell the model how deep it is: turn 1 hooks to the log or the
  report, every turn after that the stats are off the table and he is expected
  to go off topic, push back and vary the shape. A 30-message thread of the
  same beat is the bug this fixes.
- **One morning report, not three card parents.** `config/banter.report`
  ({day, text}), 300-600 chars, covers **yesterday only** across weight,
  challenge, workouts and steps, with one thread (`target: 'report'`). Written
  on the first tick after 03:00. Do NOT put coach lines back on the
  weight/steps/workouts cards.
- **Week scope:** any weekly standing quoted in copy comes from the precomputed
  `thisWeek` (Mon–Sun), never all-time totals.
- **Threads** live on `config/banter.threads`:
  - Keys: `report` | `{entryId}` for feed rows.
  - Messages: `{ id, kind: 'user'|'aiden', userId?, name?, text, at, deleted? }`.
  - User text max 160, Aiden 240. Author can bin own messages anytime.
  - Delete **before** Aiden answers → hard remove; **after** → soft-delete, then
    Aiden acks once and the tombstone drops.
  - Purged on **date only** (3 days). Do not reintroduce purge-by-feed-window:
    with 8 blokes logging daily that window is ~1.5 days, so comments were being
    binned inside 2 days.
- **Never PATCH the whole `threads` map.** The client writes one key via
  `FieldPath`; the tick writes a per-key `threadWritePlan` computed against a
  freshly re-read doc. Whole-map writes were destroying comments posted while
  the model was thinking. And `lastAidenAt` is stamped with the **pre-call**
  time so a mid-call comment stays pending.
- **The tick is a 60s probe.** `probeWork()` reads two config docs and exits if
  there is nothing to do; only then does it fetch users + entries. Clients stamp
  `config/banter.pendingAt` (`pokeAiden()`) so a comment or a log wakes Aiden
  within a minute or two. Don't add per-tick work that needs a full fetch.
- **Aiden-is-typing dots.** `aidenThinkingState()` drives a 3-dot indicator in
  the thread while a comment waits on a reply, so the crew waits instead of
  assuming they were ignored. It gives up after `THINKING_WINDOW_MINUTES` so a
  broken tick leaves a quiet thread, not Aiden typing forever.
- **Copy backend:** `scripts/lib/copywriter.mjs`. Default is **SuperGrok**
  via `grok -p` (Grok Build OAuth at `~/.grok/auth.json`, no console.x.ai
  metered bill). Child env strips `XAI_API_KEY` so systemd/launchd cannot
  silently burn API credits. Measured ~6s for a structured thread-shaped call.
  Fallbacks: `claude -p` (Claude Pro), then Anthropic Messages API if
  `~/.config/teamlift/anthropic-key` is set. Force with
  `TEAM_LIFT_COPY_BACKEND=grok|claude|api`. Both CLI paths need **stdin
  closed** and **cwd off-repo** (else the coding agent loads project
  CLAUDE.md / AGENTS.md and the call more than doubles).
- **Voice guide:** `scripts/prompt/aiden.md`. Two things it must keep:
  - The **locker-room register** (soft-sexist harden-up, innuendo, camp) with a
    few calibration examples. This is wanted, not tolerated. It was cut once
    during a prompt slim and the copy immediately went flat.
  - The rule that a report which is only a standings recap has **failed** —
    without it the model writes accurate scoreboard prose and no jokes.
  What it must NOT grow back into is the old 394-line, 28.8 KB skill: a bank of
  24 numbered joke shapes plus a 40-row nickname table made the copy MORE
  formulaic, because the model worked through the list instead of reacting to
  the data. Examples to calibrate voice, yes; a menu to rotate, no.
- Pure helpers: `js/lib/threads.js`, `js/lib/report.js` (+ tests).
  Orchestrator: `scripts/orchestrator.mjs`. Context/validate:
  `scripts/lib/context.mjs`.
