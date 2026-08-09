# Reference implementation

Working, **verified** code to copy into the new Sledged repo. Not documentation
about code — this is the code.

Everything here was run on 2026-08-10 and passed. Nothing in this directory is
aspirational.

## What is here

| File | Goes to | Status |
|---|---|---|
| `firestore.rules` | repo root | **Verified.** 24/24, plus mutation-tested |
| `rules.test.ts` | `tests/rules.test.ts` | 16 negative + 8 positive cases |
| `lib/dates.ts` | `src/lib/dates.ts` | **Verified.** Ported from Team Lift |
| `lib/seeded.ts` | `src/lib/seeded.ts` | **Verified.** Deterministic pick helper |
| `lib/challenge.ts` | `src/lib/challenge.ts` | **Verified.** Now per-crew `challengeStart` |
| `lib/*.test.ts` | alongside their modules | 27/27 passing, `tsc --strict` clean |
| `package.json`, `vitest.config.ts`, `tsconfig.json`, `firebase.json` | merge into the new repo's equivalents | Minimal, working |

## Running it

The Firestore emulator needs a JDK.

```bash
brew install openjdk
export JAVA_HOME=/opt/homebrew/opt/openjdk
export PATH="$JAVA_HOME/bin:$PATH"

npm install
npx vitest run lib/                                              # pure logic
npx firebase emulators:exec --only firestore "npx vitest run rules.test.ts"
```

## How the rules were verified

A green test suite proves nothing on its own: `assertFails` also passes when a
call fails for the wrong reason, and a rules file that denies everything passes
every negative test. So the suite was checked three ways.

1. **All 24 pass** against the real rules — 16 denials and 8 permits. The
   positive cases are what stop "deny everything" from looking correct.
2. **Mutation: `entries` read opened to `if true`.** Cases 1, 12 and 13 failed.
   The cross-crew, unauthenticated and revoked-claim tests all have teeth.
3. **Mutation: private weights opened to any signed-in user.** Case 15 failed,
   and only case 15. The test that protects the product's central privacy
   promise fires precisely when that promise breaks.

Rules were restored and re-run clean after each mutation.

**Do this again whenever you change the rules.** If you add a rule and no test
fails when you deliberately break it, you have added an untested rule.

## Two bugs already found and fixed here

Both were caught by review, before the emulator ran. Worth knowing about,
because both would have been easy to reintroduce.

1. **Solo users could not log.** `inCrew()` read `request.auth.token.crews`
   directly. A brand new user has no `crews` claim at all, reading a missing
   key errors the whole rule out, and the write is denied. That would have
   killed the very first entry a new user makes, which is the one that triggers
   Aiden's `firstLog` line and is the single highest-leverage moment in
   onboarding. Fixed with a defaulted `myCrews()` accessor, and there is now a
   positive test for it.

2. **`weightKg` sat on a crew-readable document.** The architecture said "never
   expose absolute kg" while the data model put it on `entries/{id}`, which
   every crew member can read. Hiding a field in the UI is not a control when
   the document is readable directly. Raw kg now lives in
   `users/{uid}/weights/{date}`, owner-only, and the entry carries `weightDelta`
   plus a `hasWeight` flag. Rules reject an entry that even *contains* a
   `weightKg` key, so it cannot creep back.

## Not yet ported

The rest of Team Lift's `js/lib/` — `aggregate`, `awards`, `reactions`,
`report`, `threads` — plus their existing `node --test` suites. See
`../03-architecture.md` §9 for the port map and which tests are worth
converting.
