# Aiden Sunday weekly recap (2026-08-03)

Amendment to the morning-report design. Read with
`docs/superpowers/specs/2026-07-26-morning-report-design.md`.

## What

Once a week Aiden writes a **week standings recap** (300–600 chars, hard cap
700), stored on `config/banter.weeklyReport`:

```
{ weekKey: 'YYYY-MM-DD',  // mondayOf(Sunday)
  day: 'YYYY-MM-DD',      // the Sunday it was written
  text: '...' }
```

One comment thread: `target: 'weekly'` (`WEEKLY_TARGET` in `js/lib/threads.js`).

## When

- **Sunday**, first tick at or after **03:00**, when
  `weeklyReport.weekKey !== mondayOf(today)`.
- Self-heals if the host slept: same rule as the daily report.
- Same model call as that tick’s other jobs (daily report if also due, threads,
  pushes). **Never a second model call** for the weekly alone on a busy tick.

## Content rules

- Week scope: Mon–Sun via precomputed `thisWeek` (same as morning report).
- Same-day grace for **Sunday**: no roast for not-yet-logging today.
- Rest-day grace for 1–2 empty **completed** days still applies.
- **No absolute kg.** Deltas / standings only. `validateCopy` backstop.
- A pure scoreboard recap has **failed** — same “land a hit” rule as the
  morning report.
- Offline fallback: `templateWeeklyReport()` in `js/lib/report.js`.

## UI

Dashboard card **Aiden's week recap** under the morning report when:

- stored weekly is fresh for this or last week (`weeklyReportFresh`), or
- it is Sunday (template until the tick writes).

## Thread hygiene

`wipeCardThreads` / `digestCardThreads` take an optional target list. The
orchestrator digests+wipes **only** `report` when the daily is due, and
**only** `weekly` when the weekly is due, so a Sunday daily rewrite does not
kill the weekly thread mid-conversation.

## Out of scope

- Push that only announces the weekly (crew already gets morning/evening).
- Replacing the morning report on Sunday (both can run the same day).
