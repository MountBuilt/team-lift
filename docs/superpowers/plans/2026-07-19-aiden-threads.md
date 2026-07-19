# Aiden Threads + Daily Card Freeze — Implementation Plan

> Implemented in-session 2026-07-19 (Grok). Spec:
> `docs/superpowers/specs/2026-07-19-aiden-threads-design.md`.
> Handoff for Claude: `CLAUDE.md` § "Aiden + card parents".

**Goal:** Daily ~3am card parents with week standings; crew can banter Aiden in threads; Aiden replies hourly.

## Files touched

| Path | Role |
|------|------|
| `js/lib/threads.js` | Pure: thisWeek, 3am gate, pending, purge, comment-worthy, apply replies |
| `tests/threads.test.js` | Coverage for the above |
| `scripts/lib/context.mjs` | `thisWeek`, `threadWork`, `threadReplies` validation |
| `scripts/orchestrator.mjs` | Daily path, no mid-day card rewrite, thread jobs + memory |
| `scripts/lib/decide.mjs` | Comment warning for Claude/Grok |
| `.claude/skills/copywriter/SKILL.md` | Aiden + thisWeek + threadReplies rules |
| `js/firebase.js` | `writeBanterThreads` |
| `js/ui/thread.js` | Tap parent, N comments, compose, delete |
| `js/ui/dashboard.js` / `feed.js` | Wire threads |
| `css/style.css` | Thread chrome |
| `sw.js` | Cache `teamlift-v3` |
| `CLAUDE.md` | Maintainer handoff |

## Post-deploy

1. Commit + push to `main` (GitHub Pages).
2. Run `bash scripts/refresh-banter.sh` (or wait for hourly tick after 03:00) so `cardsDay` stamps and parents regenerate with `thisWeek`.
3. Smoke: tap a coach line, send a short reply, wait for next hour for Aiden.
