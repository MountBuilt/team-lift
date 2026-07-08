# Team Lift

Static, no-build web app: vanilla ES modules + Tailwind (CDN) + Chart.js (CDN),
Firebase Firestore backend (open rules, trusted group), hosted on GitHub Pages.

Spec: docs/superpowers/specs/2026-07-08-team-lift-design.md

## Commands
- Unit tests: `node --test` (auto-discovers `tests/*.test.js`; Node 26 rejects a bare `tests/` directory argument)
- Run locally: `python3 -m http.server 8000` then open http://localhost:8000
- Deploy: push to `main` (GitHub Pages serves repo root)
- Firestore rules deploy: `firebase deploy --only firestore:rules`

## Conventions
- `js/lib/` = pure logic only (dates, aggregation). No Firebase imports, no DOM.
  Everything here needs `node --test` coverage.
- `js/ui/` = one module per screen/component; each exports a `render*` function
  that takes state and returns/updates DOM.
- All entry dates are local `YYYY-MM-DD` strings. Weeks are Mon–Sun.
- UI copy says "workout", never "gym".
- Team weight chart plots actual kg but keeps exact values obscured: coarse
  10 kg y-axis ticks, tooltips show change vs first weigh-in (never absolute kg).
