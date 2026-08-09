# Sledged — Public App Design (master spec)

**Date:** 2026-08-09
**Status:** Approved design. Build documentation complete.

## What this is

Sledged is the public, store-distributed successor to Team Lift: a multi-tenant
crew fitness app for iOS, Android and web, built around Aiden's banter.

**The full design is a documentation pack, not a single file.** It lives in
[`docs/sledged/`](../../sledged/) and is written for the agent that will build
it (SuperGrok), in a new repo, from a clean slate.

| File | Contents |
|---|---|
| [`00-README.md`](../../sledged/00-README.md) | Orientation, non-negotiables, glossary, what ports from Team Lift |
| [`01-product-spec.md`](../../sledged/01-product-spec.md) | Vision, personas, screens, onboarding, free/paid split, brand |
| [`02-user-stories.md`](../../sledged/02-user-stories.md) | Stories with testable acceptance criteria, in build order |
| [`03-architecture.md`](../../sledged/03-architecture.md) | Stack, Firestore model, security model, functions, port map |
| [`04-aiden.md`](../../sledged/04-aiden.md) | The AI system: voice guide, moods, memory, redaction, validation |
| [`05-security-privacy-compliance.md`](../../sledged/05-security-privacy-compliance.md) | Threat model, rules tests, privacy, Apple + Play gates |
| [`06-build-plan.md`](../../sledged/06-build-plan.md) | Phases, lead times, launch checklist |
| [`07-agent-instructions.md`](../../sledged/07-agent-instructions.md) | Becomes the new repo's `CLAUDE.md` / `AGENTS.md` |
| [`08-costs-and-pricing.md`](../../sledged/08-costs-and-pricing.md) | Unit economics, break-even, cost controls |

## Headline decisions

- **Multi-tenant crews**, open to anyone. Multiple crews per user, capped at 12.
- **Expo SDK 56 / RN 0.85 + Firebase.** Chosen over Supabase on cost floor
  ($0 vs $300/yr), offline persistence, and free auth.
- **Aiden moves off the NUC** to Firestore triggers + Cloud Scheduler.
- **xAI API, Grok 4.1 Fast**, billed key. Provider chosen for register as much
  as price: other providers sanitise the voice.
- **A$2.00 one-off, per person.** 14-day trial starting on first crew join.
  Crew-level banter free forever; Aiden talking *to you* is paid.
- **No share feature.** Aiden's cards carry the wordmark so system screenshots
  self-brand.
- **Open Firestore rules do not survive.** Custom-claim multi-tenancy plus a
  mandatory emulator rules test suite with 16 negative cases.

## Relationship to Team Lift

Team Lift keeps running untouched for the existing crew throughout the build,
and is retired only once that crew has migrated to Sledged.

Ports across: `js/lib/` pure logic (dates, aggregate, challenge, threads,
report, awards, reactions), `scripts/prompt/aiden.md`, `MOODS`, the grace and
freshness rules, and the dark visual language.

Does not port: open rules, the shared password and PIN, the NUC tick, the
`grok -p` SuperGrok CLI path, and the whole-map `threads` write shape.
