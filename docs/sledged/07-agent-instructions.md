# Sledged — Agent Working Instructions

**Date:** 2026-08-09

**This file becomes the new repo's `CLAUDE.md` and `AGENTS.md`.** Copy it to
the repo root under both names (or one, symlinked) so every coding agent reads
it before touching anything.

---

# Sledged

Expo / React Native app (iOS, Android, web) where an AI character called
**Aiden** roasts a crew of mates into logging their training every day.

**The one goal: get the crew logging something every day.** Judge every change
against it.

**Second rule, learned from the predecessor app: the banter is the product.**
The logging is the excuse. Do not make changes that make Aiden safer, blander,
more consistent or more agreeable. That is the failure mode, and it is always
introduced with good intentions.

---

## Read before changing anything

The full design lives in `docs/sledged/`. Read the file that covers your area
before you edit:

| Changing | Read |
|---|---|
| Anything at all, first time | `00-README.md`, `06-build-plan.md` |
| A screen, a flow, the paywall | `01-product-spec.md` |
| Data model, rules, functions | `03-architecture.md` |
| **The prompt, moods, memory, validation** | `04-aiden.md` — **read all of it** |
| Rules, privacy, store submission | `05-security-privacy-compliance.md` |
| Rate limits, budgets, pricing | `08-costs-and-pricing.md` |

---

## Non-negotiables

Breaking one of these either gets the app rejected, costs money, or kills the
thing that makes it work.

1. **Never call the LLM from a client.** Every model call goes through a Cloud
   Function, key in Secret Manager, rate limit in front.
2. **Never display an absolute bodyweight in kg** where another user can see
   it. Deltas only. Own weight in own private view is the sole exception.
3. **Never loosen a Firestore rule to make a test pass.** Change the client.
   Loosening rules is how this project gets a cross-crew data leak.
4. **Never write a whole map field** where a per-document write will do. The
   predecessor destroyed live comments this way.
5. **No em-dashes in user-facing copy or banter.** Comma, full stop, or plain
   hyphen.
6. **No share/screenshot feature.** Deliberate. Sharing stays organic.
7. **The trial starts on first crew join/create, never on install.**
8. **Aiden never names a non-paying user to their crew.**
9. **Generation is never entitlement-aware.** Redaction happens at read time.
10. **Do not add a bank of joke templates to the prompt.** It has been tried;
    it made the copy more formulaic, not less (`04` §0).

---

## Conventions

**Structure**
- `src/lib/` — **pure logic only.** No Firebase, no React, no React Native
  imports. Everything here needs unit tests. If a component grows a pure helper
  worth testing, move it here.
- `src/data/` — **the only place that imports Firebase.** Every read and write
  goes through it. This is what keeps a future backend migration to one
  directory.
- `src/ui/` — one component per file, presentational, takes props.
- `app/` — Expo Router routes only. Thin. Logic lives in hooks and `src/lib/`.
- `functions/` — separate package, its own `package.json` and tests.

**Data**
- All entry dates are local `YYYY-MM-DD` strings.
- **Never `new Date(dateStr)` on a `YYYY-MM-DD`** — it parses as UTC and shifts
  the day. Use `parseLocal()` from `src/lib/dates.ts`.
- Weeks run Monday to Sunday.
- Entry document id is always `{uid}_{date}`. One entry per person per day, by
  construction.

**Copy**
- Say "workout", never "gym".
- The bot is **Aiden**, always, in UI labels and in his own voice.
- Feed lines and banter are deliberately over-the-top Australian gym talk.
  Swearing is intended. **Do not sanitise it.** The app is age-rated for it.
- Aiden never mentions money except in the private nag job.

**Style**
- TypeScript strict. No `any` without a comment explaining why.
- Prefer small files. A file over ~300 lines is usually doing two things.
- Match the surrounding code's idiom rather than importing a new pattern.
- Comment *why*, not *what*. Leave a short comment when changing cross-cutting
  behaviour (rules, the prompt, the context builder, rate limits).

---

## Commands

```bash
npm run typecheck          # tsc --noEmit
npm test                   # vitest, src/lib and functions
npm run test:rules         # firebase emulators:exec --only firestore
npm run lint

npx expo start --dev-client       # run the app (dev client, NOT Expo Go)
npx expo prebuild --clean         # after adding any native module

eas build --profile development --platform ios
eas build --profile production --platform all
eas submit --platform ios

firebase deploy --only firestore:rules
firebase deploy --only functions
firebase emulators:start
```

**Expo Go does not work.** HealthKit, Health Connect, RevenueCat and native
Google sign-in all need native modules. Always the dev client.

---

## Testing

| Layer | Tool | Requirement |
|---|---|---|
| `src/lib/` | Vitest | Every exported function. This is where the logic lives. |
| Security rules | `@firebase/rules-unit-testing` | **All 16 negative cases in `03` §5. CI fails if any passes.** |
| Functions | Vitest + emulator | Context builders and validators, at minimum. |
| Aiden output | Fixture set | Mechanical properties only: length, no em-dash, no absolute kg, real names, challenge not attributed as failed today. |
| Flows | Maestro | Sign in, log, join crew, purchase. |

**Do not try to assert funniness automatically.** The gate on copy quality is a
human reading a week of output (`06` Phase 4).

CI on every push: typecheck, lint, unit tests, rules tests. All four green or
the build fails.

---

## Deploy

1. `main` is protected. Work on branches, merge via PR.
2. CI green before merge, no exceptions for rules tests.
3. `firebase deploy --only firestore:rules` **whenever rules change**, and run
   the rules suite against the deployed project afterwards.
4. `firebase deploy --only functions` for backend changes.
5. `eas build` + `eas submit` for store releases.
6. Web target deploys to EAS Hosting; it serves the privacy policy and support
   URLs that both stores require, so **it must not go down**.

---

## Secrets

Never commit: `*.p8`, `*serviceAccount*.json`, `.env*`, any xAI or RevenueCat
key. A secret-scanning pre-commit hook is installed; do not bypass it.

The Firebase web config in the client is **not** a secret. It identifies the
project. Rules do the protecting. Do not "fix" it by hiding it.

**Rotate the Apple `.p8` sign-in key every 6 months.**

---

## Things the predecessor got wrong — do not rebuild them

Each of these is a real bug that shipped in Team Lift and was fixed the hard
way.

1. **Whole-map document writes** destroyed comments posted while the model was
   generating. Messages are subcollection documents here; keep it that way.
2. **One failed push send re-spammed the whole crew** next tick. Send state is
   per user, updated per user.
3. **Stacked template banter** read as robotic. Feed lines are AI or a plain
   factual placeholder. Never a template stack.
4. **Roasting someone for "skipping" today's challenge.** The day is not over.
   Only yesterday's is fair game.
5. **Safe-area insets** under the notch made tabs untappable in standalone
   mode.
6. **Open Firestore rules.** Documented as accepted risk for a trusted crew of
   eight. It is a breach the moment a stranger installs.

---

## When you are unsure

- **A product question** (should this feature exist, what should it do): check
  `01`. If it is not there, ask Simon. Do not invent scope.
- **A voice question** (is this line too far, should Aiden say this): check
  `04` §8 and §9. The register is intentional; the §9 lines are absolute.
- **A cost question**: check `08`. If a change adds model calls, say so in the
  PR with an estimate.
- **A security question**: check `05`. Default to the restrictive answer and
  write a test for it.

If a doc contradicts itself, the doc is wrong — flag it rather than picking
whichever reading is easier to build.
