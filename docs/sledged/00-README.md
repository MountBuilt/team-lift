# Sledged — Build Documentation Pack

**Date:** 2026-08-09
**Status:** Approved. Decisions are settled — build to them.
**Audience:** the coding agent (SuperGrok) and Simon.

---

## What this is

Sledged is a group fitness accountability app for iOS, Android and web, built
around an AI character called **Aiden** who roasts and motivates a crew of
mates into logging something every day.

It is a ground-up rebuild of **Team Lift**, a working closed-crew PWA that
proved the concept with one crew of Australian tradies. Team Lift lives at
`github.com/<owner>/team-lift` and keeps running for that crew throughout the
build. Sledged is a **new repo, clean slate** — no migration, no shared code
at runtime, but a deliberate port of the parts that earned their keep.

This pack contains every decision needed to build it. It was produced from a
research and interview session. **Where it states a decision, that decision is
made** — do not reopen it, do not present it back as an option. Where it says
"open", it is genuinely open.

---

## The one goal

**Get the crew logging something every day.**

Team Lift had this same line at the top of its `CLAUDE.md` and it did real
work: it killed features. Judge every change against it. A feature that does
not increase the chance a bloke opens the app and logs tomorrow is not a
feature, it is a liability with a maintenance cost.

Corollary, learned the hard way on Team Lift: **the banter is the product.**
The logging is the excuse. The crew's actual behaviour was screenshotting
Aiden's lines into their external WhatsApp group, and that is what pulled new
blokes in. Every design call in this pack protects that.

---

## Reading order

Read all of these before writing code. They are short on purpose.

| # | File | Read it for |
|---|---|---|
| 00 | `00-README.md` | This. Orientation, glossary, non-negotiables. |
| 01 | `01-product-spec.md` | What the app is. Screens, flows, free/paid split. |
| 02 | `02-user-stories.md` | Stories with acceptance criteria, in build order. |
| 03 | `03-architecture.md` | Stack, data model, security model, functions, port map. |
| 04 | `04-aiden.md` | The AI system. Voice, moods, memory, triggers, costs. |
| 05 | `05-security-privacy-compliance.md` | Rules, threat model, store gates. **Read before submitting anything.** |
| 06 | `06-build-plan.md` | Phases, lead times, launch checklist. **Start here for what to do first.** |
| 07 | `07-agent-instructions.md` | Repo conventions. Becomes the new repo's `CLAUDE.md` / `AGENTS.md`. |
| 08 | `08-costs-and-pricing.md` | Unit economics and the kill switches that keep them true. |

If you only read two: **06** tells you what to do next, **05** tells you what
will get you rejected.

---

## Non-negotiables

These are not preferences. Breaking one either gets the app rejected, costs
real money, or destroys the thing that makes it work.

**Product**
1. **No share/screenshot feature.** Sharing stays organic via the system
   screenshot button. Instead, Aiden's lines render in a card carrying the
   Sledged wordmark so a raw screenshot self-brands. This was an explicit
   decision, not an oversight.
2. **Never display an absolute bodyweight in kg** anywhere another user can
   see it — charts, banter, feed, leaderboard. Deltas and trends only. Your
   own weight in your own private view is the sole exception.
3. **No em-dashes in user-facing copy or banter.** They read as AI-written.
   Comma, full stop, or plain hyphen.
4. Copy says **"workout"**, never "gym".
5. The bot is **Aiden**. Always. In UI labels and in his own voice.

**Money**
6. **A$2.00 one-off, per person, non-consumable.** No subscriptions in v1.
7. **The 14-day trial starts on crew join/create, never on install.**

**Compliance**
8. **Firestore rules are tested or they are wrong.** An emulator-based rules
   suite with negative cases is a build deliverable, not a nice-to-have.
9. **In-app account deletion** is mandatory (Apple 5.1.1(v)).
10. **UGC needs all four**: pre-post filtering, per-item report, per-user
    block, 24-hour action on reports (Apple 1.2).

**Cost**
11. **Never call the LLM from the client.** Every model call goes through a
    Cloud Function with the key server-side and a rate limit in front of it.
12. **Do not self-host a model.** The maths is in `08`. It is not close.

---

## Glossary

| Term | Meaning |
|---|---|
| **Aiden** | The AI character. Not "the bot", not "the coach" in UI copy. |
| **Crew** | A group of up to 12 users who see each other's logs. The tenant boundary. |
| **Entry** | One user's log for one day: weight, steps, workout parts, challenge tick. |
| **Feed line** | Aiden's one-line reaction to a specific entry, shown in Recent activity. |
| **Coach chat** | The continuous crew-wide thread where Aiden posts the morning report and the crew replies. |
| **Thread** | Any comment conversation: on the report, the weekly recap, or a feed entry. |
| **Morning report** | Aiden's daily crew-wide post covering yesterday. Free for everyone. |
| **Weekly recap** | Sunday version, covering Mon-Sun. Free for everyone. |
| **DM** | Private 1:1 conversation between a user and Aiden. Paid only. |
| **Notebook** | Aiden's self-maintained crew memory: nicknames, running jokes, grudges. |
| **Storyline** | A real-world topical joke fed in manually, self-expiring after 3 days. |
| **Mood** | One of ten personality states rolled per generation so Aiden isn't flat. |
| **Tightass mechanic** | Redacting Aiden's personalised lines from free users to drive FOMO. |
| **Grace** | The rules stopping Aiden roasting someone unfairly (same-day, rest days). |
| **The tick** | Team Lift's legacy cron loop. **Does not exist in Sledged** — replaced by triggers. |

---

## What carries over from Team Lift, and what does not

**Carries over (port it, don't reinvent):**
- `js/lib/` — pure logic, no Firebase, no DOM. Dates, aggregation, challenge,
  threads, report, awards, reactions. Port map in `03`.
- `scripts/prompt/aiden.md` — the voice guide. Reproduced and adapted in `04`.
  It is the single highest-value artefact in the whole project.
- `MOODS` from `scripts/lib/context.mjs`. Reproduced in `04`.
- The grace rules, the freshness rules, and the "a report that is only a
  standings recap has failed" rule. All in `04`.
- Design language: true dark, bold sans, high contrast, red/orange accent.

**Does not carry over (actively harmful at public scale):**
- **Open Firestore rules.** Team Lift allows read/write to anyone with the web
  key. That was a documented, accepted risk for a trusted crew of eight. It is
  a data breach the day a stranger installs Sledged.
- **Shared password + client-checked PIN.** Not authentication.
- **The NUC.** A systemd timer on a home Intel NUC behind a residential
  connection is a single point of failure with no on-call. Sledged uses
  Firestore triggers and Cloud Scheduler.
- **`grok -p` via SuperGrok OAuth.** That is a personal-plan CLI. Serving an
  app from it is outside the plan's terms. Production uses a billed xAI API
  key.
- **Whole-map document PATCHes.** Team Lift learned this the painful way —
  writing the whole `threads` map destroyed comments posted while the model was
  thinking. Sledged's data model avoids the shape entirely by putting messages
  in subcollections. See `03`.

---

## Open questions (genuinely undecided)

Everything else in this pack is decided. These are not.

1. **Trademark clearance for "Sledged."** A web search found no conflicting app
   or mark. That is not clearance. IP Australia and USPTO searches plus both
   store searches are needed before any spend on branding. If it fails, the
   name changes and nothing else does.
2. **Play Console account type.** A *personal* account created after
   2023-11-13 must run a closed test with 12 testers for 14 continuous days
   before production access. An *organisation* account (registered legal
   entity) is exempt. Whether to register a company to skip this is Simon's
   call and has tax and cost implications outside this pack's scope.
3. **Exact launch date.** Driven by (2) and by Apple enrolment lead time.
