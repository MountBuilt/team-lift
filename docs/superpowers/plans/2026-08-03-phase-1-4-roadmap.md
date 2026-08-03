# Team Lift — Phases 1–4 Roadmap

**Date:** 2026-08-03  
**Status:** Ready to execute one phase at a time  
**Primary maintainer:** Grok · **Occasional reviewer:** Claude (do not lock out)  
**How to run a phase:** start a new chat and say e.g. `build phase 1` (point at this file)

---

## North star

**Get the crew logging something every day.** Every change is judged against that.

## Non-negotiables (all phases)

- **Cost:** SuperGrok only for AI (`grok -p` + `~/.grok/auth.json`). No metered xAI API, no Blaze/Cloud Functions unless Simon explicitly opens the budget.
- **Stack:** Static vanilla ES modules, committed Tailwind, Chart.js CDN, Firestore Spark, GitHub Pages. No rebuild-as-React.
- **Aiden contract (do not regress):** template-only feed parents; human-led threads only; moods + turn depth; one morning report; never whole-map `threads` PATCH; `lastAidenAt` pre-call; weight **deltas only** in public copy/charts.
- **Voice:** Aussie gym banter, swearing OK, no em-dashes, "workout" not "gym".
- **Security:** Keep light obscurity model (shared password, client PINs, open rules, deletes denied). Accepted risk for a trusted group.
- **Maintainers:** Grok is primary. Claude may review or touch code occasionally — leave `CLAUDE.md` / dual-maintainer notes intact; update wording to "Grok primary, Claude welcome" rather than removing Claude.
- **Ship size:** One phase per few days. Test in prod before starting the next. Prefer small commits and a short prod checklist at the end of each phase.
- **Specs still in force:** `CLAUDE.md` + `docs/superpowers/specs/2026-07-26-morning-report-design.md` + `2026-08-02-aiden-moods-design.md`.

## Cost model (unchanged)

| Piece | Where | Cost |
|---|---|---|
| Hosting | GitHub Pages | $0 |
| Backend | Firebase Spark | $0 (within free reads/writes) |
| Aiden + push copy | SuperGrok via `grok -p` | SuperGrok sub only |
| Tick host | Intel NUC (Phase 1) | $0 power you already pay |
| Dev machine | MacBook | stays for coding only |

---

## Phase map (overview)

| Phase | Theme | Prod risk | Depends on |
|---|---|---|---|
| **1** | Tick on NUC + SSH remote | Ops only (Aiden/push host) | Network access to NUC |
| **2** | Logging friction + social board | UI, logging path | None (can run before 1 if needed) |
| **3** | Dashboard IA + Me + install/push nudge | UI polish | Phase 2 nice-to-have |
| **4** | Engagement loops + hardening | UI + optional re-render | Phase 2–3 |

**Recommended order:** 1 → 2 → 3 → 4.  
Phase 1 is pure ops so Aiden/push no longer need the Mac awake. Phases 2–4 are product; they deploy via `main` / GitHub Pages as today.

If the NUC is blocked (travel, hardware), **start Phase 2** on Mac tick and do Phase 1 when home — product work does not require the NUC.

---

# Phase 1 — NUC tick host + remote access

**Goal:** Aiden, morning report, thread replies, and web push run on the always-on Intel NUC (Linux Mint). MacBook is for development only. You can SSH into the NUC from the Mac without needing a monitor.

**Out of scope:** Product UI changes, Firebase rule changes, metered APIs.

## 1.1 Remote access (do this first)

### Preferred: SSH on the LAN + optional Tailscale

**LAN SSH (minimum):**

1. On the NUC (once with keyboard/monitor, or if you already have local shell):
   ```bash
   sudo apt update
   sudo apt install -y openssh-server
   sudo systemctl enable --now ssh
   ```
2. Find NUC IP / hostname on the router, or on NUC: `hostname -I` / `hostname`.
3. From Mac:
   ```bash
   ssh <user>@<nuc-ip-or-hostname>
   ```
4. Optional Mac convenience (`~/.ssh/config`):
   ```
   Host teamlift-nuc
     HostName <nuc-ip-or-hostname>
     User <user>
   ```
   Then: `ssh teamlift-nuc`

**Off-LAN without opening router ports (recommended): Tailscale**

- Install Tailscale on Mac and NUC (free for personal use).
- SSH via Tailscale hostname/IP from anywhere.
- Avoid port-forwarding 22 to the public internet.

**Optional later:** VS Code / Cursor Remote-SSH, or `mosh` if Wi‑Fi is flaky. Not required for Phase 1.

### First-time NUC access if truly headless

If no screen/keyboard: temporary HDMI + keyboard once, or use Mint’s existing desktop session if any. After SSH is up you never need the display for Team Lift.

## 1.2 What must exist on the NUC

Same secrets/tools the Mac tick uses today:

| Item | Mac path today | NUC path |
|---|---|---|
| Repo checkout | `~/Projects/team-lift` | e.g. `~/team-lift` (clone of `main`) |
| Node (LTS, 20+ fine; tests use modern Node) | system / nvm | install via NodeSource, nvm, or distro |
| SuperGrok | `grok` on PATH, `~/.grok/auth.json` | same after install + login/copy |
| VAPID private key | `~/.config/teamlift/vapid-private.key` | **same key** (must match public key in repo) |
| Optional Claude fallback | `~/.config/teamlift/claude-token` etc. | only if you want fallback |
| `scripts/node_modules` | local | `cd scripts && npm ci` |
| Timezone | Sydney (push windows 07:30 / 20:30 local) | `Australia/Sydney` on NUC |

**Auth strategy for headless SuperGrok:**

1. Prefer: run `grok login` once on NUC if interactive browser/device flow works over SSH.
2. Pragmatic fallback: securely copy `~/.grok/auth.json` (and ensure `grok` binary is installed) from Mac → NUC via `scp`. Treat as a secret; mode `600`.
3. Confirm with a dry run (below). Child process must still strip `XAI_API_KEY` (already in copywriter) so no metered burn.

**Never commit** VAPID private key or `auth.json`.

## 1.3 systemd timer (replace launchd)

**Files to add in repo (agent implements):**

- `scripts/teamlift-banter.service` — oneshot unit that runs `refresh-banter.sh`
- `scripts/teamlift-banter.timer` — every 60s
- Small doc section in `CLAUDE.md` (or `docs/ops-nuc.md`) for install/uninstall
- Adjust `scripts/refresh-banter.sh` log path so it works on Linux **and** Mac:
  - Today: `$HOME/Library/Logs/teamlift-banter.log` (macOS only)
  - Target: prefer `$HOME/.local/state/teamlift/banter.log` (or `/var/log` only if you want root), with fallback so Mac hand-runs still work during transition

**Install on NUC (operator steps after agent lands unit files):**

```bash
# example paths — match your clone and user
mkdir -p ~/.config/systemd/user
cp ~/team-lift/scripts/teamlift-banter.service ~/.config/systemd/user/
cp ~/team-lift/scripts/teamlift-banter.timer ~/.config/systemd/user/
# Edit WorkingDirectory / path to refresh-banter.sh if needed
systemctl --user daemon-reload
systemctl --user enable --now teamlift-banter.timer
systemctl --user list-timers | grep teamlift
# linger so timer runs when no interactive login:
sudo loginctl enable-linger $USER
```

Prefer **user** systemd units so secrets stay under `$HOME`. If user timers are flaky without linger, enable linger as above.

## 1.4 Deploy workflow (Mac develops, NUC runs)

1. Develop and commit on Mac; push to `main` (Pages + code).
2. On NUC: `cd ~/team-lift && git pull && cd scripts && npm ci` (only when `package-lock` changes).
3. No need to reinstall the timer unless unit files change.
4. Hand test from Mac via SSH:
   ```bash
   ssh teamlift-nuc 'bash ~/team-lift/scripts/refresh-banter.sh --dry-run'
   ```

Optional later (not required Phase 1): a one-line `scripts/pull-and-restart.sh` on NUC.

## 1.5 Cutover checklist (prod test)

- [ ] SSH works: `ssh teamlift-nuc`
- [ ] NUC timezone: `timedatectl` → `Australia/Sydney` (or correct local group TZ)
- [ ] `node -v`, `grok` resolves, `~/.grok/auth.json` present
- [ ] VAPID private key present; `bash scripts/refresh-banter.sh --dry-run` succeeds
- [ ] Timer active: `systemctl --user status teamlift-banter.timer`
- [ ] Live tick: comment on report in the app → Aiden replies within ~1–2 min with **Mac asleep / launchd unloaded**
- [ ] Morning window (or force via time-travel only if you have a safe test path): push path still works
- [ ] **Unload Mac launchd** so two hosts don’t double-send:
  ```bash
  launchctl unload ~/Library/LaunchAgents/com.teamlift.banter.plist
  # or disable whatever path you used to install it
  ```
- [ ] Keep Mac plist in repo as historical/reference or mark deprecated in comments; do not delete docs that explain the probe/tick design

## 1.6 Agent task list (when you say `build phase 1`)

- [x] Make `refresh-banter.sh` log path Linux-friendly (cross-platform)
- [x] Add systemd unit + timer templates under `scripts/`
- [x] Document NUC install, secrets, cutover, and Mac unload in `docs/ops-nuc.md` (or CLAUDE.md section)
- [x] Update CLAUDE.md Commands: tick runs on NUC; Mac is optional hand-run / dry-run
- [x] Maintainer line: Grok primary, Claude welcome for review
- [x] Do **not** require product UI changes in this phase
- [ ] Operator (Simon) still does: SSH enable, Tailscale optional, copy secrets, enable timer, unload Mac — agent provides exact commands

**Prod verification for Phase 1:** Mac fully offline overnight; morning report + evening nags + a human thread reply all work next day.

---

# Phase 2 — Logging friction + social visibility

**Goal:** Make “log something today” obvious and fast; show who’s on the board.

**Maps to review items:** 1–5 (today board, personal nudge, quick log, celebration, thread affordance).

## 2.1 Today board

- Dashboard strip: each member chip/avatar (color + initial or name).
- States: **logged something today** vs **quiet** (same definition as `hasAnyLog` in `js/lib/banter.js`).
- Optional secondary marks: challenge done / workout logged (keep simple; don’t overload).
- Placement: near top (with or just under header / before long charts). Same-day grace: no roast copy for quiet members; neutral UI only.

**Pure logic:** prefer a small helper in `js/lib/` (e.g. `loggedToday(entries, userId, today)`) + tests.

## 2.2 Personal “you haven’t logged” CTA

- If current user has no `hasAnyLog` for today: prominent banner/card near top.
- Copy in banter voice, not guilt-trip (same-day grace).
- Primary button opens log sheet (`openLogModal()`).
- Disappears immediately when their entry gains any real field (snapshot).

## 2.3 Quick log sheet

Evolve `js/ui/logmodal.js` without a second modal:

- **Mode chips or sections:** full form remains default; add friction reducers:
  - Last **weight prefill** from most recent weigh-in (editable; blank if never weighed).
  - **Step presets:** e.g. 5k / 8k / 10k / 12k + keep free number field.
  - Clear empty-state placeholders so “one field only” feels intentional.
- Do not require all fields; existing omit/clear semantics stay.
- Keep 3-day day picker; no calendar.

## 2.4 Post-save celebration

- On successful `saveEntry` from the log sheet: small confetti (`burstFrom`) + optional `navigator.vibrate` (respect reduced motion).
- Challenge tick already celebrates — keep that; don’t double-spam if they only tick challenge from the card.
- Optional: brief FAB pulse; keep subtle.

## 2.5 Thread discoverability

- When comment count is 0 on report or feed parents: quiet control e.g. `Banter` / `Say something` (not heavy “Reply” chrome).
- Expand + focus compose on tap (same as parent tap).
- Do not change thread write rules or Aiden human-led policy.

## 2.6 Tests + constraints

- [x] Unit tests for any new pure helpers
- [x] No AI calls on log path
- [x] No absolute kg on team surfaces
- [x] Tailwind rebuild if new utilities appear

**Prod checklist:** open app as self → see nudge if empty → log steps only with preset → feed line instant → celebration → today board flips to you; expand report with empty banter control → comment → Aiden still answers from NUC (or Mac tick until Phase 1 cutover).

---

# Phase 3 — Dashboard IA + Me + install/push

**Goal:** Put logging and status above charts; make Me a real personal scoreboard; raise install/push uptake.

**Maps to review items:** 6–8.

## 3.1 Dashboard reorder

Target order (adjust slightly if it feels wrong in prod, but keep “log first” bias):

1. Header (challenge title, week, heatbar)
2. **Today board** + **personal nudge** (from Phase 2)
3. **Daily challenge**
4. **Aiden’s morning report**
5. Team tiles (workouts / 3+ / steps)
6. **Workouts this week**
7. **Recent activity**
8. Weight chart
9. Steps chart

Charts stay; they move down. One report card only — no coach lines back on chart cards.

## 3.2 Me view upgrades

In `js/ui/me.js`, still private where it matters:

- Challenge streak (reuse `challengeStreak`)
- Days logged this week (Mon–Sun, `hasAnyLog`)
- Steps this week (sum)
- Workouts this week (already have slabs) — keep
- Weight chart stays **actual kg** (private)
- Entry list: keep tap-to-edit

Pure aggregation helpers in `js/lib/aggregate.js` (or thin wrappers) + tests if new.

## 3.3 Install + push coach mark

- After first successful log (or first visit when push supported but off): one-time dismissible card.
- Steps: Add to Home Screen (iOS/Android short copy) → Me → turn on notifications.
- Persist dismiss in `localStorage` (e.g. `tl_push_coach_dismissed`).
- Do not nag every session; once dismissed, stay quiet unless you later add a Me-only hint.

## 3.4 Visual polish pass (light)

- [x] Empty states: banter voice, clear CTA to log
- [x] Ensure new strips match heat/Anton system (no redesign)
- [x] Safe-area / FAB overlap check with new top content

**Shipped (agent):** dashboard reorder; Me scoreboard (`daysLoggedThisWeek`, `weeklySteps`, challenge streak); install/push coach (`js/lib/push-coach.js` + `tl_push_coach_dismissed`); empty-state CTAs.

**Prod checklist:** fresh eyes scroll — challenge and log CTA above charts; Me shows streak/steps/days; install card once then gone; push still works on installed PWA.

---

# Phase 4 — Engagement loops + hardening

**Goal:** More reasons to open the app without adding AI cost or breaking Aiden; reduce full-repaint pain; tidy maintainer docs.

**Maps to review items:** 9 + later engagement ideas (peer reactions, weekly awards, optional Sunday recap, banter pools).

## 4.1 Peer reactions (no AI)

- On feed rows (and optionally report): one-tap reactions from a small fixed set (e.g. 🔥 💀 👏 😂).
- Store on entry doc or a small map field (design in phase start — prefer **per-entry field** updated with FieldPath / merge so concurrent reactions don’t clobber).
- Show counts + who reacted lightly (or just counts if space tight).
- Client-only; no orchestrator involvement.
- Firestore rules already open for trusted group — OK under accepted security model.

## 4.2 Weekly awards (client-side)

- Pure functions over week window: e.g. most steps, most workouts, challenge iron man (most challenge ticks), consistency (most days logged).
- Render a small “This week’s podium” card on dashboard (Sun–Mon transition: show last week’s winners Mon morning optional).
- Deterministic; no model call.
- Never expose absolute kg in awards.

## 4.3 Sunday / weekly Aiden recap (optional SuperGrok)

- Only if Phase 1 NUC is solid and cost stays SuperGrok-only.
- One extra report shape or weekend flag in orchestrator: week standings banter, still 300–600 chars, one thread target.
- Must reuse one-call-per-tick discipline; do not add a second model call on busy ticks if avoidable (batch into same generateCopy when due).
- Spec amendment short doc under `docs/superpowers/specs/` if behaviour changes.

If this feels heavy, **ship 4.1 + 4.2 first** and leave 4.3 as a follow-up task inside Phase 4.

## 4.4 Banter pool refresh

- When feed templates feel stale: widen pools in `js/lib/banter.js` + tests.
- No AI back into feed parents.

## 4.5 Hardening: reduce full re-render pain

- Today every Firestore snapshot rebuilds dashboard/Me HTML (compose drafts already survive).
- Incremental improvements (pick what’s proportional):
  - Don’t wipe expanded thread panels / scroll position carelessly
  - Or targeted re-render of feed/today-board only when entries/banter change
- Keep pure logic tested; no framework migration.

## 4.6 Docs / maintainer hygiene

- CLAUDE.md: Grok primary, Claude welcome; NUC is production tick host; Mac is dev.
- Point Commands at `docs/ops-nuc.md`.
- Do not remove Claude-oriented guidance that still helps a visiting Claude review.

**Prod checklist:** react on a mate’s log; see awards mid-week; feed lines still instant; Aiden human-led only; overnight NUC still sole tick host; optional weekly recap once if implemented.

---

## Explicitly deferred (not in Phases 1–4)

| Idea | Why deferred |
|---|---|
| HealthKit / Health Connect auto steps | Native apps, platform lock-in, not needed for 8-person PWA |
| Photo proof / Storage | Cost + privacy complexity |
| Cloud Functions / Blaze | Billing surface |
| Real multi-tenant auth | Overkill for trusted crew |
| Rebuild in React/Next | Violates stack + cost simplicity |
| Proactive AI praise under every log | Explicitly rejected 2026-08-02 |

---

## How an agent should run a phase

When the user says **`build phase N`**:

1. Read this file and the relevant section fully.
2. Read `CLAUDE.md` + morning-report / moods specs before touching Aiden, feed, tick, or copywriter.
3. Implement only that phase’s scope; do not “helpfully” start the next phase.
4. Prefer TDD for new pure helpers (`js/lib/`, `scripts/lib/`).
5. Run `node --test` before claiming done.
6. Tailwind rebuild if new utility classes appear.
7. End with a **prod test checklist** for Simon (short, numbered).
8. Phase 1 will need Simon for SSH, secrets, and cutover; agent should not claim NUC is live without operator confirmation.
9. Commits: clear messages; no force-push; don’t push unless asked.
10. Claude may review later — leave comments on cross-agent behaviour (orchestrator, banter shape, aiden prompt) when you change them.

---

## Suggested calendar (loose)

| Day | Work |
|---|---|
| Day 0–1 | Phase 1: NUC + cutover, Mac unload |
| Day 2–4 | Phase 2 in prod, crew uses quick log + board |
| Day 5–7 | Phase 3 polish after feedback |
| Day 8+ | Phase 4 in slices (reactions → awards → optional recap → re-render) |

Adjust freely; **one phase stable in prod before the next**.

---

## Success criteria (end of Phase 4)

- [ ] Aiden + push run on NUC; Mac can sleep indefinitely
- [ ] Logging is faster (presets/prefill) and socially visible (today board + nudge)
- [ ] Dashboard prioritises log/status over charts; Me is worth opening
- [ ] Install/push path is obvious once
- [ ] Extra engagement (reactions/awards) without new AI cost
- [ ] SuperGrok remains the only intentional AI cost
- [ ] Claude can still land and review without being locked out
- [ ] Light security model unchanged and accepted
