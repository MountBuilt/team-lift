# Team Lift

Static, no-build web app: vanilla ES modules + compiled Tailwind (committed
CSS) + Chart.js (CDN, deferred), Firebase Firestore backend (open rules,
trusted group, offline persistence on), installable PWA, hosted on GitHub
Pages.

Spec: docs/superpowers/specs/2026-07-08-team-lift-design.md

## Commands
- Unit tests: `node --test` (auto-discovers `tests/*.test.js`; Node 26 rejects a bare `tests/` directory argument)
- Run locally: `python3 -m http.server 8000` then open http://localhost:8000
- Deploy: push to `main` (GitHub Pages serves repo root)
- Firestore rules deploy: `firebase deploy --only firestore:rules`
- Tailwind rebuild (needed whenever HTML/JS gains a utility class not already
  in use): `npx tailwindcss@3.4.17 -i css/tailwind.source.css -o css/tailwind.css --minify`

## Conventions
- `js/lib/` = pure logic only (dates, aggregation). No Firebase imports, no DOM.
  Everything here needs `node --test` coverage.
- `js/ui/` = one module per screen/component; each exports a `render*` function
  that takes state and returns/updates DOM.
- All entry dates are local `YYYY-MM-DD` strings. Weeks are Mon–Sun.
- UI copy says "workout", never "gym".
- Feed lines and dashboard quips come from `js/lib/banter.js`: deliberately
  over-the-top, explicit Aussie gym banter (swearing intended — don't sanitise).
  Deterministic seeded picks so quips rotate daily and stay testable.
  No em-dashes in any user-facing copy or banter (they read as AI-written);
  use a comma, full stop, or plain hyphen.
- Daily challenge (`js/lib/challenge.js`): one bodyweight exercise per day,
  a pure function of the date (no backend state), reps ramp weekly from the
  challenge start. Ticking it writes `dailyChallenge: true` on that day's
  entry doc; streaks are consecutive ticked days.
- Team weight chart plots actual kg but keeps exact values obscured: coarse
  10 kg y-axis ticks, tooltips show change vs first weigh-in (never absolute kg).
