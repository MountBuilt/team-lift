# Home Stats, Continuous Report Thread, AI Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Stats tab + drop log nudge, continuous 5-day morning-report thread with activity-aware home preview, and AI feed lines after factual placeholders.

**Architecture:** Pure helpers in `js/lib/` (factual lines, feed-line jobs, report append/purge, preview selection) stay Firebase-free and tested under `node --test`. UI splits scoreboard into `js/ui/stats.js`. Tick still one model call; orchestrator appends report messages (no wipe), merges `feedLines` partial writes, purges old report messages and feedLines.

**Tech Stack:** Vanilla ES modules, Firestore, Chart.js, Node test runner, SuperGrok copywriter.

## Global Constraints

- No absolute kg in banter context or copy (weightDelta only).
- No em-dashes in user-facing copy; say "workout" not "gym".
- Never whole-map PATCH of `threads` or `feedLines`.
- Report thread: continuous, 5-day message TTL; weekly wipe unchanged.
- Feed parents: AI; no proactive praise under feed.
- Idle tick remains probe-only (2 reads).
- UI copy: no LOG SOMETHING nudge card.

**Spec:** `docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md`

---

### Task 1: Pure helpers — factual feed line, feedLines jobs/purge, report append/purge, preview

**Files:**
- Modify: `js/lib/banter.js` — add `factualFeedLine`; keep `hasAnyLog` etc.; remove feed-parent pep composer usage from export path used by UI (or reimplement `feedLine` as factual alias for tests/callers).
- Modify: `js/lib/threads.js` — `REPORT_THREAD_MAX_AGE_DAYS=5`, `FEED_LINE_MAX=200`, `appendReportMessage`, `purgeReportThreadMessages`, `collectFeedLineJobs`, `purgeStaleFeedLines`, `feedLineWritePlan`, `reportPreviewMessages`, `latestReportText`.
- Test: `tests/banter.test.js`, `tests/threads.test.js`

**Interfaces produced:**
- `factualFeedLine(entry) => string`
- `collectFeedLineJobs({ entries, feedLines, today, limit=12 }) => entry[]` (entries needing AI text)
- `purgeStaleFeedLines(feedLines, { today }) => next map`
- `feedLineWritePlan(prev, next) => { sets, deletes }`
- `appendReportMessage(thread, { text, day, nowIso }) => thread`
- `purgeReportThreadMessages(threads, { today }) => threads`
- `reportPreviewMessages(thread) => { mode: 'none'|'aiden'|'crew', messages: msg[] }`
- `latestReportBody(banter, today, templateFn) => string` optional helper

- [ ] **Step 1:** Add failing tests for `factualFeedLine`, report purge/append, feedLine jobs, preview modes.
- [ ] **Step 2:** Implement helpers.
- [ ] **Step 3:** Update/remove obsolete `feedLine` pep tests to match factual behaviour.
- [ ] **Step 4:** `node --test` green for banter + threads.

---

### Task 2: Copywriter path — context, validate, schema, prompt, orchestrator

**Files:**
- Modify: `scripts/lib/context.mjs` — `feedLineWork` in context; jobs include `feedLines`; parent for feed threads uses AI line or factual; validate feedLines; schema.
- Modify: `scripts/prompt/aiden.md` — `feedLines` job section; update report continuous note.
- Modify: `scripts/orchestrator.mjs` — no wipe on report; append report message; collect feed jobs; needCopy includes feed jobs; write feedLines plan; purge feedLines + report messages.
- Modify: `scripts/lib/copywriter.mjs` — output instructions mention `feedLines`.
- Modify: `scripts/lib/decide.mjs` — comment only (feed via poke/stale scan).
- Test: `tests/copywriter.test.js` (if present), extend context validation tests if any.

- [ ] **Step 1:** Wire buildContext + validateCopy + copySchema for feedLines.
- [ ] **Step 2:** Orchestrator: buildThreads without report wipe; append report; feed lines merge.
- [ ] **Step 3:** Prompt voice for feed lines.
- [ ] **Step 4:** Run relevant tests.

---

### Task 3: UI — Stats tab, drop nudge, report preview, AI feed render

**Files:**
- Create: `js/ui/stats.js`
- Modify: `js/app.js` — third tab
- Modify: `js/ui/dashboard.js` — remove nudge/tiles/workouts/charts; report preview card
- Modify: `js/ui/feed.js` — factual then AI from `banter.feedLines`
- Modify: `js/ui/thread.js` if needed for report preview strip
- Modify: `CLAUDE.md` Aiden bullets

- [ ] **Step 1:** Extract Stats, wire tab.
- [ ] **Step 2:** Report home card with body + activity strip + open thread.
- [ ] **Step 3:** Feed uses AI/placeholder.
- [ ] **Step 4:** Update CLAUDE.md.
- [ ] **Step 5:** Full `node --test`.

---

### Task 4: Commit and push

- [ ] Commit implementation (one or few logical commits).
- [ ] Push to `origin/main`.
