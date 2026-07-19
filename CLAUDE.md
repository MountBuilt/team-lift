# Team Lift

Static, no-build web app: vanilla ES modules + compiled Tailwind (committed
CSS) + Chart.js (CDN, deferred), Firebase Firestore backend (open rules,
trusted group, offline persistence on), installable PWA, hosted on GitHub
Pages.

**Maintainers:** Claude and Grok both work this repo. Read this file and the
specs under `docs/superpowers/specs/` before changing banter, push, or threads.
Leave short comments when you change cross-agent behaviour (orchestrator,
`config/banter` shape, copywriter skill).

## Specs (read these)
- v1 app: `docs/superpowers/specs/2026-07-08-team-lift-design.md`
- Push + orchestrator: `docs/superpowers/specs/2026-07-13-push-notifications-design.md`
- **Aiden threads + daily card freeze (2026-07-19):**
  `docs/superpowers/specs/2026-07-19-aiden-threads-design.md` — **source of
  truth** for coach parents, crew replies, and Aiden memory.

## Commands
- Unit tests: `node --test` (auto-discovers `tests/*.test.js`; Node 26 rejects a bare `tests/` directory argument)
- Run locally: `python3 -m http.server 8000` then open http://localhost:8000
- Deploy: push to `main` (GitHub Pages serves repo root)
- Firestore rules deploy: `firebase deploy --only firestore:rules`
- Hourly tick (banter + pushes + Aiden threads) by hand: `bash scripts/refresh-banter.sh`
  (wrapper for `node scripts/orchestrator.mjs`; supports `--dry-run` and
  `--send-test <userId>`; logs to `~/Library/Logs/teamlift-banter.log`)
- Tailwind rebuild (needed whenever HTML/JS gains a utility class not already
  in use): `npx tailwindcss@3.4.17 -i css/tailwind.source.css -o css/tailwind.css --minify`

## Conventions
- `js/lib/` = pure logic only (dates, aggregation, threads). No Firebase imports, no DOM.
  Everything here needs `node --test` coverage.
- `js/ui/` = one module per screen/component; each exports a `render*` function
  that takes state and returns/updates DOM.
- All entry dates are local `YYYY-MM-DD` strings. Weeks are Mon–Sun.
- UI copy says "workout", never "gym".
- The banter bot is named **Aiden** (UI label + copywriter voice). Offline
  fallback templates still live in `js/lib/banter.js` when AI banter is stale.
- Feed lines and dashboard quips: deliberately over-the-top, explicit Aussie
  gym banter (swearing intended — don't sanitise). Deterministic seeded picks
  so quips rotate daily and stay testable.
  No em-dashes in any user-facing copy or banter (they read as AI-written);
  use a comma, full stop, or plain hyphen.
- Topical storylines (`scripts/storylines.mjs`): real-world banter fed from
  the group chat. Each entry is `{ id, subject, until, note }` (`subject` = a
  bloke's name or `'team'`, `until` = inclusive last-active `YYYY-MM-DD`).
  `context.mjs` passes the active set to the copywriter, which weaves them in;
  they're folded into the card hashes so adding/expiring one regenerates the
  cards next tick, then it reverts to general banter on its own. To add one,
  edit the array. Same-day grace: nobody is roasted for not-yet-logging today,
  and 1-2 empty days = rest (`REST_GRACE_DAYS`), 3+ = fair game.
- Daily challenge (`js/lib/challenge.js`): one bodyweight exercise per day,
  a pure function of the date (no backend state), reps ramp weekly from the
  challenge start. Ticking it writes `dailyChallenge: true` on that day's
  entry doc; streaks are consecutive ticked days.
- Team weight chart plots actual kg but keeps exact values obscured: coarse
  10 kg y-axis ticks, tooltips show change vs first weigh-in (never absolute kg).
- Web push (`js/push.js`, toggle on the Me view): raw VAPID, subscription
  stored on `users/{id}.push`. Sent by `scripts/orchestrator.mjs` on the
  hourly launchd tick: morning motivation from 7:30am (skipped after 8:30pm),
  evening reminder from 8:30pm only if nothing is logged that day; state in
  `config/push` (`lastMorning`/`lastEvening`) so missed ticks self-heal and
  never double-send. Claude (Sonnet) writes all copy via
  `.claude/skills/copywriter` from a pre-built context file and never touches
  the network; the orchestrator owns every fetch, hash, PATCH, and send.

## Aiden + card parents (2026-07-19) — do not regress

Full detail: `docs/superpowers/specs/2026-07-19-aiden-threads-design.md`.

- **Bot name:** Aiden.
- **Card parents** (`config/banter.cards` weight/steps/workouts): rewritten only
  on the **daily ~3am path** (`cardsDay !== today` and local time ≥ 03:00;
  self-heals on first tick after Mac wake). **Do not** rewrite card parents
  mid-day when entry hashes change — that was the stale "Hunt and Simon on 7
  sessions" class of bug. Mid-day reaction lives in **threads**.
- **Week scope:** copywriter context includes precomputed `thisWeek` standings
  (Mon–Sun). Workouts parent must use those counts, never all-time session totals.
- **Threads** live on `config/banter.threads` (not a new collection):
  - Keys: `weight` | `steps` | `workouts` | `{entryId}` for feed rows.
  - Messages: `{ id, kind: 'user'|'aiden', userId?, name?, text, at, deleted? }`.
  - User text max 160. Author can bin own messages anytime.
  - Delete **before** Aiden answers → hard remove (never happened).
  - Delete **after** → soft-delete; next tick Aiden may ack once, then drop tombstone.
- **UI:** No "Reply" buttons. Tap the **parent text** to expand thread + focus
  compose. Show **"N comments"** only when N ≥ 1 (N = all visible msgs, user+Aiden).
  No timestamps. No "waiting on Aiden".
- **Aiden hourly:** at most **one** reply per target per tick, covering all new
  human messages (+ delete acks). May also post on **feed** threads for
  comment-worthy new logs (see `js/lib/threads.js`). Card threads stay human-led.
- **3am:** digest card threads → `memory[]` (keep ~14 days), wipe card threads,
  write new parents. Feed threads discarded when parent is **> 3 days** old or
  off the recent feed — no feed digest.
- Pure helpers: `js/lib/threads.js` (+ tests). Orchestrator: `scripts/orchestrator.mjs`.
  Context/validate: `scripts/lib/context.mjs`. Skill: `.claude/skills/copywriter`.
