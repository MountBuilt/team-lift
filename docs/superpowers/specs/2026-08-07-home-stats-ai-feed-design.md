# Home Stats tab, continuous morning thread, AI feed (2026-08-07)

Source of truth for this redesign. Supersedes these parts of
`2026-07-26-morning-report-design.md`:

- Recent activity is **template-only forever** (feed parents are AI again;
  factual placeholder until the tick lands).
- Morning report thread is **wiped daily** (report thread is continuous;
  messages last 5 days).
- Dashboard holds all scoreboard charts/tiles (they move to a **Stats** tab).

Thread mechanics from `2026-07-19-aiden-threads-design.md` still stand
(message shape, soft-delete, per-key writes, human-led feed replies).
Weekly recap from `2026-08-03-weekly-recap-design.md` is **unchanged**
(separate Sunday card, wipe-on-rewrite for `weekly` only).

Maintainers: Grok primary, Claude welcome. Read this before touching tabs,
the report card, feed parents, or the tick.

## Why

The one goal is still **getting the crew to log something every day.**

Four product problems:

1. **Redundant CTA.** "LOG SOMETHING" on the home nudge card duplicates the
   (+) FAB. Extra chrome, no extra logs.
2. **Crowded Dashboard.** Week tiles, workouts panel, weight chart and team
   steps chart bury status, challenge, Aiden and the feed. Scoreboard belongs
   on its own tab.
3. **Stale feed lines.** Template `feedLine()` stacks field recitals with stock
   closers ("end of discussion", "bookended the day", "man of many courses").
   Pool size alone is not enough; the crew wants fresh, relevant copy and
   accepts non-instant generation.
4. **Disposable morning banter.** Rewriting `report` and wiping
   `threads.report` every morning kills the day's conversation. The report
   copy is good; the lifetime is not.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Log nudge card | **Remove entire card** (pep + button). (+) remains the log entry. |
| Stats tab | **Tiles + workouts panel + weight chart + team steps chart.** Podium awards stay on Dashboard. |
| Ship style | **One pass** (UI + continuous report + AI feed in one implementation). |
| Report thread | **Flat continuous chat.** Aiden appends a morning post each day. No daily wipe. |
| Home preview | **Coach chat** card: always the **latest 3** visible messages (report posts included). No separate static report body. Empty thread uses report pointer / template as synthetic preview only. Open thread at bottom; load-earlier windowing. |
| Report message TTL | **5 calendar days** (by message `at` date, local). Hard delete on tick. |
| Weekly recap | **Leave separate** (current Sunday card + wipe-on-rewrite). |
| Feed parents | **AI for every log.** Factual placeholder immediately; AI line replaces it once and sticks. |
| Feed storage | `config/banter.feedLines[entryId] = { text, at }`. |
| Proactive praise under feed | **Still off.** Parent is Aiden's voice again; human-led thread replies only. |

## 1. Navigation and Stats tab

### Tabs

Sticky top nav becomes three equal tabs:

| Tab | Contents |
|---|---|
| **Dashboard** | Header, today board, push coach (when shown), daily challenge, morning-report **preview** card, Sunday weekly recap (unchanged rules), this week's podium, recent activity |
| **Stats** | Week tiles (workouts this wk / hit 3+ this wk / team steps this wk), workouts-this-week panel, weight chart, team steps chart |
| **Me** | Unchanged |

- Default tab remains Dashboard (`state.tab` defaults to `'dash'`).
- Charts mount only while Stats is active (do not init Chart.js on Dashboard).
- No bottom nav.

### Drop log nudge

Remove `logNudgeHtml` / the log-nudge card from Dashboard entirely.
Logging entry points: (+) FAB, Me tab, chart/feed empty-state CTAs if retained.

**Today on the board** stays (who has / has not logged). Same-day grace
unchanged.

### Files (expected)

- `js/app.js` — third tab, route `stats`.
- `js/ui/dashboard.js` — drop nudge, tiles, workouts panel, charts; keep rest.
- New or extracted `js/ui/stats.js` — `renderStats(container, state, opts)` with
  tiles, workouts panel, charts + empty states moved from dashboard.
- `js/charts.js` — called from Stats after render, not Dashboard.

## 2. Continuous morning-report thread

### Data model

Keep denormalised today pointer (probe, fallbacks, pushes):

```
config/banter.report = { day: 'YYYY-MM-DD', text: '...' }
config/banter.reportDay = 'YYYY-MM-DD'
```

Thread at `config/banter.threads.report` is **continuous**. Messages:

```
{
  id: string,
  kind: 'user' | 'aiden',
  userId?: string,       // user only
  name?: string,
  text: string,
  at: ISO string,
  deleted?: boolean,
  role?: 'report',       // aiden only: morning post for a calendar day
  reportDay?: string     // YYYY-MM-DD when role === 'report'
}
```

Each morning (first tick after 03:00 when `reportDay !== today`):

1. Model writes `report` text as today (300–600 chars, hard cap 700). Same
   content rules as 2026-07-26 (yesterday only, no absolute kg, land a hit).
2. Orchestrator sets `report` / `reportDay` / appends `reportHistory`.
3. Orchestrator **appends** an Aiden message with `role: 'report'` and
   `reportDay: today` to `threads.report`.
4. **Does not** call `wipeCardThreads` for `report`. Weekly wipe for
   `weekly` stays on the weekly-due path only.
5. `digestCardThreads` for report is optional for memory; prefer deriving
   anti-repetition from `reportHistory` and recent report-role messages.
   Do not wipe after digest.

If nobody replied since the last morning post, Aiden is talking to himself
in history. That is fine.

### Purge

- New constant: `REPORT_THREAD_MAX_AGE_DAYS = 5`.
- On every tick that already full-fetches and runs
  `purgeStaleFeedThreads` (any non-idle path), also drop messages in
  `threads.report` whose local calendar date of `at` is older than
  `today - 5 days`. Keep the thread key; empty messages array is ok.
  Idle probe-only ticks do not open the banter write path just to purge.
- Feed entry threads remain `FEED_THREAD_MAX_AGE_DAYS = 3`.
- `CARD_TARGETS` still skips feed-style date-from-key purge for `report` /
  `weekly`; report uses the message-level 5-day purge instead.

### Home UI (Dashboard card) — Coach chat

Not the full expanded thread by default.

1. Eyebrow: **Coach chat** + msg count (or "live" when empty).
2. **Preview:** always the **latest 3** visible messages in `threads.report`
   (report-role posts included — the morning report is one bubble among peers).
   Long lines clipped for the card (`COACH_PREVIEW_TEXT_MAX`); full text in
   the expanded panel.
3. **Empty thread fallback:** prefer fresh `banter.report` for today; else
   latest `role: 'report'` in thread; else `templateReport()` offline. Shown
   as a synthetic preview line only — **not** written to the thread.
4. CTA: tap preview to expand. Opens scrolled to **bottom** (newest). Message
   list is height-capped; **Load earlier** grows a from-the-end window
   (`THREAD_WINDOW_INITIAL` / `THREAD_WINDOW_CHUNK`). Composer, typing dots,
   delete rules unchanged. Full retained history = 5-day purge window.

Template offline body must **not** be appended as a fake Aiden message.
Only the real model report becomes a `role: 'report'` message.

### Tick / copywriter touchpoints

- `needsDailyReport` unchanged.
- `collectThreadJobs` for `target: 'report'` unchanged (human-led).
- `applyThreadReplies` stays for reply messages; report append is a
  separate orchestrator step on the report-due path (so report posts are
  not confused with reply jobs).
- Still **one model call** per tick for report + weekly + thread replies +
  feed lines + pushes.
- Per-key `threadWritePlan` still required; never PATCH whole `threads`.

### Edge cases

| Case | Behaviour |
|---|---|
| Host slept past 03:00 | First tick writes one report for that calendar day (self-heal). |
| Two ticks same morning | `reportDay === today` → no second report message. |
| User comments during model call | Pre-call `lastAidenAt` stamp; mid-call comment stays pending (existing rule). |
| Soft-delete | Unchanged. |

## 3. AI recent-activity lines

### Display contract

| State | Parent text |
|---|---|
| Just logged / waiting on tick | **Factual placeholder** from `factualFeedLine(entry)` — inventory only, e.g. `chest + back · 8,412 steps · scales · challenge`. Name + BIG EFFORT badge as today. No joke pools. |
| AI ready | `banter.feedLines[entryId].text` replaces placeholder. |
| Tick dead / failed | Placeholder remains. Never fall back to old pep-suffix templates. |

Stability: one AI line per entry id. Re-editing the same day's entry does
**not** re-queue generation if `feedLines[entryId]` already has text.

### Storage

```
config/banter.feedLines = {
  [entryId]: { text: string, at: ISO string }
}
```

- Tick owns writes. Client only reads for render.
- Write with a **partial plan** (only keys generated this tick), same spirit
  as `threadWritePlan` — do not stomp unrelated keys.
- Purge `feedLines` when the entry date (from `entryId` suffix
  `{userId}_{YYYY-MM-DD}`) is older than `today - FEED_THREAD_MAX_AGE_DAYS`
  (3 days), same date rule as feed threads. Doc must not grow without bound.

### Jobs

`collectFeedLineJobs({ entries, feedLines, today })` returns entry ids in
the recent activity window that have a real log (`hasAnyLog`) and no
usable `feedLines[entryId].text`.

Included in the single copywriter call as job type `feedLines`. Context per
entry: name, date, workout parts, steps, challenge flag, **weightDelta only**
(never absolute kg), big-effort flag. No raw weight.

Response shape:

```
feedLines: [ { entryId, text }, ... ]
```

Caps:

- Max length **200** characters (hard reject over).
- Absolute kg banned via existing `findAbsoluteWeight` / `validateCopy`.
- Only requested entryIds accepted.

### Voice (prompt)

- One line. React to the **most interesting** fact; do not recite every
  field as a checklist.
- Vary sentence shape; ban stock closers that made templates stale
  ("end of discussion", "bookended the day", "man of many courses", and
  similar formula endings).
- Same locker-room register and moods as the rest of Aiden.
- Empty string if a job was listed in error; orchestrator skips empty.

### Feed threads

- Tap parent still opens `threads[entryId]`.
- **No proactive praise** under feed rows: parent is Aiden again; unprompted
  reply would restate him. `collectThreadJobs` stays human-led only.

### Template cleanup

- Add pure `factualFeedLine(entry)` (+ tests).
- Remove feed-parent pep pools / `feedLine` composer paths that produce
  stacked closers once the AI path is live, so they cannot regress.
- Keep challenge-card quips and other non-feed banter that still has a home.
- Keep nickname / rest-day helpers used by report templates and pushes.

## 4. Migration

1. Deploy client + tick together when possible. Client tolerates missing
   `feedLines` (placeholder) and missing report-role messages (uses
   `banter.report` / template).
2. First morning after deploy: append report message; do not wipe existing
   `threads.report` if any mid-day banter exists.
3. Backfill AI feed lines only for entries in the **current recent window**
   on the next busy ticks, not full history.
4. No user-facing migration UI.

## 5. Out of scope

- Continuous weekly-recap thread.
- Changing push windows or push copy rules.
- AI on Stats charts or podium awards.
- Aligning feed-thread TTL from 3 → 5 days.
- Bottom navigation or Me tab redesign.
- Bringing proactive feed praise back.

## 6. Success checks

1. No log-nudge card on Dashboard; (+) opens the log sheet.
2. Stats tab owns tiles, workouts panel, weight chart, team steps; Dashboard
   does not.
3. Morning banter from prior days remains in the report thread up to 5 days;
   home preview is 1-message when Aiden-only, 3 when crew has spoken.
4. After log + successful tick, feed parent is AI, not stacked pep suffixes;
   placeholder never shows those closers.
5. Absolute kg never appears in report, feed lines, or thread replies.
6. Idle tick still probe-exits (Spark free tier).
7. `node --test` green.

## 7. Implementation touch list (guidance)

| Area | Likely files |
|---|---|
| Tabs / Stats | `js/app.js`, `js/ui/dashboard.js`, `js/ui/stats.js` (new), `js/charts.js` |
| Report preview UI | `js/ui/dashboard.js`, `js/ui/thread.js`, `js/lib/threads.js` |
| Purge / append report | `js/lib/threads.js`, `scripts/orchestrator.mjs` |
| Feed AI | `js/lib/banter.js`, `js/ui/feed.js`, `scripts/lib/context.mjs`, `scripts/lib/copywriter.mjs`, `scripts/prompt/aiden.md`, `scripts/orchestrator.mjs` |
| Tests | `tests/threads.test.js`, `tests/banter.test.js`, `tests/decide.test.js`, `tests/copywriter.test.js`, new factual-line tests |
| Docs | This file; CLAUDE.md Aiden bullets; note supersession on 2026-07-26 spec |

## 8. Supersession notes for maintainers

When implementing, update CLAUDE.md:

- Recent activity is **not** template-only: factual placeholder then AI
  `feedLines[entryId]`.
- Morning report thread is **continuous**; no daily wipe of `report`.
- Report message retention **5 days**.
- Home shows report preview + activity-aware strip, not always full thread.
- Stats tab owns scoreboard charts/tiles.

Do not reintroduce: whole-map `threads` patches, absolute kg in context,
proactive feed praise, daily wipe of the report thread, or LOG SOMETHING
nudge card.
