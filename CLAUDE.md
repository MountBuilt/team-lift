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

**Deploy rule (agents — always):** After any `git push` to `main`, immediately
`ssh teamlift-nuc 'cd ~/team-lift && git pull --ff-only'` and confirm HEAD
matches. UI ships via GitHub Pages; Aiden/tick code only runs what the NUC has
checked out. Do not leave the NUC behind the remote. If `scripts/package-lock.json`
changed, `npm ci` in `scripts/` on the NUC. If unit files changed, reinstall
systemd units per `docs/ops-nuc.md`. Restart `teamlift-banter-watch.service`
when orchestrator/watcher code changed.

## Specs (read these)
- v1 app: `docs/superpowers/specs/2026-07-08-team-lift-design.md`
- Push + orchestrator: `docs/superpowers/specs/2026-07-13-push-notifications-design.md`
- Thread mechanics: `docs/superpowers/specs/2026-07-19-aiden-threads-design.md`
  (its three card parents are superseded; the thread rules still stand)
- Morning report + live replies (2026-07-26):
  `docs/superpowers/specs/2026-07-26-morning-report-design.md`
- **Home Stats + continuous report + AI feed (2026-08-07):**
  `docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md` — **source of
  truth** for tabs, report thread lifetime, and feed parents.
- NUC tick ops: `docs/ops-nuc.md`
- Sunday weekly recap: `docs/superpowers/specs/2026-08-03-weekly-recap-design.md`

## Commands
- Unit tests: `node --test` (auto-discovers `tests/*.test.js`; Node 26 rejects a bare `tests/` directory argument)
- Run locally: `python3 -m http.server 8000` then open http://localhost:8000
- Deploy: push to `main` (GitHub Pages serves repo root), **then always pull
  on the NUC** — `ssh teamlift-nuc 'cd ~/team-lift && git pull --ff-only'`
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
- No standalone weekly recap card. Monday's morning report covers last week
  (`reportKind: 'week'`, `lastWeek` standings). Tue–Sun reports stay yesterday
  only. `needsWeeklyReport` is always false. Spec:
  `docs/superpowers/specs/2026-08-16-dash-home-design.md`.
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
- Daily snack (`js/lib/challenge.js`): one bodyweight snack per day, a
  pure function of the date (no backend state). Reps sit in a snack band
  and can go down or up day to day. Ticking it writes `dailyChallenge: true`
  on that day's entry doc; streaks are consecutive ticked days. UI and
  Aiden copy say **snack**, never challenge, for this daily exercise.
- Team weight chart plots actual kg but keeps exact values obscured: no
  y-axis numbers, tooltips show change vs first weigh-in (never absolute kg).
- Log sheet day picker: `dayOptions()` in `js/lib/dates.js` offers today,
  yesterday and the day before, collapsed to the selected day until tapped.
  There is no calendar input; nobody backfills further than two days.
- Web push (`js/push.js`, toggle on the Me view): raw VAPID, subscription
  stored on `users/{id}.push`. Sent by `scripts/orchestrator.mjs`: morning
  motivation from 7:30am (skipped after 8:30pm), evening reminder from 8:30pm
  only if nothing is logged that day; **report-up** from 7:30 once today's
  report exists (`lastReport`, replaces the morning wave so they are not
  doubled); **Aiden-replied** to the humans he just answered (any hour).
  State in `config/push` (`lastMorning`/`lastEvening`/`lastReport`) so missed
  ticks self-heal and never double-send.

## Aiden (2026-08-07) — do not regress

Full detail: `docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md`
(plus 2026-07-26 for tick shape and 2026-08-02 moods).

- **Tabs:** Dashboard (header, snack pair until ticked, workouts, Coach chat,
  merged weight + steps card, feed) | Me.
  No Stats tab, today-board, podium, or score tiles. No LOG SOMETHING nudge;
  (+) FAB is the log entry. Spec:
  `docs/superpowers/specs/2026-08-16-dash-home-design.md`.
  Sticky top nav uses `.safe-top` (`env(safe-area-inset-top)`) so PWA tabs
  stay tappable under the notch (`black-translucent` + `viewport-fit=cover`).
- **Recent activity is AI.** Client shows `factualFeedLine(entry)` until the
  tick writes `config/banter.feedLines[entryId] = { text, at }`, then that
  line sticks (no re-roll on edit). Never fall back to stacked pep-suffix
  templates. Max 200 chars; no absolute kg.
- **Aiden reacts as a comment only when spoken to (2026-08-02).** Parent is
  Aiden's voice again, so unprompted feed praise stays off. `collectThreadJobs`
  is human-led only.
- **Aiden has moods (2026-08-02, event-sticky 2026-08-16).** `MOODS` in
  `scripts/lib/context.mjs`. `resolveMood` picks from the event that woke
  him (report data, a new log, a new thread, a delete, a push wave) and
  persists `{ name, targets, trigger }` on `config/banter.mood` until the
  next event. Same-thread follow-ups stay in that mood (`sticky: true`).
  Includes non-agreeable moods (`combative`, `sulking`, `unhinged`, `filthy`).
- **Threads are conversations after turn 1.** `aidenTurns` / `turnGuidance`:
  turn 1 hooks to the log or report; later turns go off topic and vary shape.
- **Coach chat (continuous report thread).** `config/banter.report` ({day, text})
  still holds today's pointer for probes/pushes. Each morning Aiden **appends**
  a message with `role: 'report'` to `threads.report` (no daily wipe). Message
  TTL **5 days**. Home card title is **Coach chat**: always the **latest 3**
  visible messages (report posts included, clipped ~180 chars). No separate
  static report body. Open thread scrolls to **bottom** (newest); panel is
  height-capped with **Load earlier** windowing (`THREAD_WINDOW_INITIAL` 40,
  chunk 20). Empty thread falls back to `banter.report` / `templateReport` as a
  synthetic preview only (not written). Weekly recap still separate and
  wipe-on-rewrite. Do NOT put coach lines back on chart cards.
- **Today's challenge is invitation-only in the report.** Context hands
  `challenge` (today) + `challengeYesterday` (ticked / skippedAmongLogged).
  Never claim someone avoided today's exercise; same-day grace applies.
- **Week scope:** weekly standings from precomputed `thisWeek` (Mon–Sun) only.
- **Threads** live on `config/banter.threads`:
  - Keys: `report` | `weekly` | `{entryId}` for feed rows.
  - Messages: `{ id, kind: 'user'|'aiden', userId?, name?, text, at, deleted?,
    role?, reportDay? }`.
  - User text max 160, Aiden 240, feed line 200. Author can bin own messages.
  - Delete **before** Aiden answers → hard remove; **after** → soft-delete.
  - Feed threads purged on **date only** (3 days). Report messages 5 days.
    Aged report-thread lines are digested into `memory` on purge (weekly
    wipe no longer feeds memory). Never whole-map PATCH of `threads` or
    `feedLines`.
- **Never PATCH the whole `threads` map.** The client writes one key via
  `FieldPath`; the tick writes a per-key `threadWritePlan` computed against a
  freshly re-read doc. Whole-map writes were destroying comments posted while
  the model was thinking. And `lastAidenAt` is stamped with the **pre-call**
  time so a mid-call comment stays pending.
- **The tick is event-first + a 30s safety probe.** Clients stamp
  `config/banter.pendingAt` (`pokeAiden()`); the NUC `teamlift-banter-watch`
  service listens with Firestore `onSnapshot` and runs the tick immediately.
  `teamlift-banter.timer` every 30s covers clock jobs (report/push) and missed
  events. `probeWork()` still reads two config docs and exits if idle — stay on
  Spark free tier (no polling loops). Don't add per-tick work that needs a full
  fetch on every safety tick.
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
