---
name: verify
description: Drive Team Lift headless against the real Firestore backend to verify UI changes end-to-end
---

# Verifying Team Lift

Static app, no build. Backend is the live Firestore (open rules) — reads are
safe; **never press SAVE in the log modal or submit signup** (writes to prod).

## Launch

```bash
python3 -m http.server 8010 &   # serve repo root
```

Playwright isn't installed globally; `npm i playwright-core` in a scratch dir
and launch with an explicit `executablePath` from `~/Library/Caches/ms-playwright/
chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell`.

## Drive

- Skip gate + PIN by seeding localStorage in an init script:
  `teamlift_pw_ok = '1'`, `teamlift_userId = <user doc id>`.
- Get user ids read-only via Firestore REST:
  `https://firestore.googleapis.com/v1/projects/team-lift-app/databases/(default)/documents/users?key=<apiKey from js/config.js>`
  (Simon = `jgK5w2BEIE8mkubmSEuL`)
- `page.goto` must use `waitUntil: 'domcontentloaded'` — Firestore's live
  channel means `networkidle` never fires.
- Wait for `#weight-chart, #weight-empty`, then ~1.5s for snapshots to settle.
- Flows worth screenshotting: dashboard (charts, tiles, dots, feed), ME tab,
  `#fab` → log modal (chips, prefill), chart hover for tooltip privacy.

## Mobile / PWA chrome (do not skip after nav or header changes)

Installed iOS PWA uses `viewport-fit=cover` + `black-translucent`, so content
draws under the status bar / home indicator. Desktop Chrome will not catch this.

1. Emulate a phone viewport (e.g. iPhone 14, 390×844) **and** inject safe areas
   before paint:
   ```js
   await page.addInitScript(() => {
     const s = document.createElement('style');
     s.textContent = `:root {
       --sat: 47px; --sab: 34px;
     }
     .safe-top { padding-top: var(--sat) !important; }
     .safe-bottom { padding-bottom: calc(7rem + var(--sab)) !important; }`;
     document.documentElement.appendChild(s);
   });
   ```
   (Headless Chromium often leaves `env(safe-area-inset-*)` at 0; force them.)
2. Assert the sticky tab bar is tappable:
   - `nav.safe-top` exists; each `.tab` has `getBoundingClientRect().top >= 40`
     (below a ~47px status inset) and `height >= 44`.
   - Click STATS and ME; confirm `#view` content swaps (Stats charts / Me header).
3. Assert FAB / bottom content is not under the home indicator:
   - `#fab` bottom edge is above `viewportHeight - safeBottom`.
4. Screenshot dash + stats + me at phone size after every sticky-nav or safe-area
   change.
