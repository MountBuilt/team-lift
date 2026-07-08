# Team Lift — Group Accountability Web App (v1 Spec)

**Date:** 2026-07-08
**Status:** Approved design, pending implementation plan

## 1. Overview & Goals

A simple, mobile-first web app for a small closed group (<10 known people) to log
daily fitness metrics during a fixed-window challenge and see team progress for
accountability.

Core metrics per person per day:

- Bodyweight (kg, one decimal allowed)
- Steps (daily total)
- Workout session (multi-select body parts — "workout", not "gym", so home
  sessions count)

Philosophy:

- Team-focused dashboard first; a small private "Me" view second
- Motivating, never shaming — no leaderboards, no rankings, no absolute weights
  on shared charts
- The only target is **3+ workout sessions per week** per person
- Minimal barriers to use: one form, few taps, instant updates
- Deliberately simple, short-term tool; rebuild properly if it outlives the
  challenge

## 2. Tech Stack (zero cost, no build step)

- **Frontend:** Vanilla HTML + Tailwind CSS (CDN) + Chart.js (CDN)
- **Code structure:** Native ES modules, small focused files:
  - `index.html`
  - `css/style.css` (only what Tailwind can't express)
  - `js/firebase.js` — Firebase init + Firestore helpers
  - `js/state.js` — app state, auth/identity, localStorage persistence
  - `js/charts.js` — chart construction/update
  - `js/ui/` — screen/component modules (gate, roster, dashboard, me-view,
    log-modal, feed)
- **Backend:** Firebase Firestore only (free Spark plan), realtime via
  `onSnapshot`
- **Hosting:** GitHub Pages (public repo)
- No framework, no bundler.

## 3. Identity & Access

1. **Password gate** on first load: single shared password, hardcoded in JS.
   Obscurity-level security is explicitly accepted (public repo, open Firestore
   rules, low-stakes data, trusted group).
2. **Roster screen** after the gate:
   - Existing members appear as a tappable name list.
   - Tapping your name prompts for your 4-digit PIN.
   - **First-time users** tap "I'm new" → type their first name → choose their
     own 4-digit PIN → get auto-assigned the next color from a fixed palette.
3. Successful identification is cached in localStorage (`userId`) so return
   visits go straight to the dashboard. Lost storage or a new device just means
   re-picking your name + PIN — history never splits.
4. PINs are stored in the user doc and checked client-side. This keeps honest
   people honest; it is not real security and that's fine.
5. Users can only create/edit **their own** entries.
6. Rogue/unknown users can be deleted manually in the Firebase console.

## 4. Data Model (Firestore)

### `users/{userId}`

```js
{
  name: string,        // first name, as typed by the user
  pin: string,         // 4-digit, chosen by the user, client-checked
  color: string,       // hex, auto-assigned from fixed palette at signup
  createdAt: timestamp
}
```

### `entries/{userId}_{YYYY-MM-DD}`

Document ID is `userId_date` — one entry per person per day by construction.

```js
{
  userId: string,
  name: string,              // denormalized for the feed
  date: string,              // "YYYY-MM-DD", local date
  weight: number | null,     // kg
  steps: number | null,
  workoutParts: string[] | null, // e.g. ["legs", "core"]
  createdAt: timestamp,
  updatedAt: timestamp
}
```

Workout part options: arms, chest, legs, back, core, shoulders, cardio,
stretching, full body.

### `config/challenge`

```js
{
  title: string,      // e.g. "Winter Shred"
  startDate: string,  // "YYYY-MM-DD"
  endDate: string     // "YYYY-MM-DD"
}
```

Edited in the Firebase console to start a new challenge window. The dashboard
frames everything within this window ("Week 2 of 6").

### Firestore security rules

Open read/write on `users`, `entries`, and `config` (trusted small group,
accepted risk). Rules file kept in repo for later tightening.

## 5. Time Conventions

- Single timezone group; dates are each device's **local date** as
  `YYYY-MM-DD` strings.
- Weeks run **Monday–Sunday**.

## 6. UI Aesthetic

- True dark default (#0f0f0f–#111 background), bold sans-serif, high contrast,
  strong red/orange accent, clean cards, subtle borders.
- Mobile-first, large touch targets; responsive on desktop.
- Loading skeletons on first paint; friendly empty states ("No entries yet —
  be the first!").
- Charts follow the dataviz skill guidance (accessible categorical palette
  doubles as the member color palette).

## 7. Screens

### 7.1 Dashboard (default, team view)

- **Header:** challenge title + "Week X of N" / "Day X of N" progress strip.
- **Team tiles:** total workouts this week · "X/Y people at 3+ this week" ·
  team total steps this week.
- **Weight chart:** multi-line, **% change from each member's baseline**
  (their first weight entry within the challenge window; everyone starts at
  0%). Actual kg never shown on team charts. Members without a baseline are
  omitted. Missing days render as line gaps, not zeros.
- **Steps chart:** stacked daily bars over the challenge window, one segment
  per member in their color — reads as team momentum.
- **Workouts panel:** per member, current week as Mon–Sun dot row
  (● ● ● ○ ○ ○ ○), green/bold at 3+, last week's row alongside for
  comparison. Subtle 🔥 for members on a multi-week 3+ streak. Celebratory
  state when the *whole team* hits 3+ for the week.
- **Activity feed:** last ~12 entries across the group — "Sam logged a
  legs + core workout · Tue".

### 7.2 Me view (second tab)

- Your actual kg trend line (private-feeling, real numbers).
- Your steps history.
- Your workout history for the window.
- List of your past entries with tap-to-edit.

### 7.3 Log Entry modal (floating + button)

- Date picker, default today; backdating allowed to any date.
- **Single form, all three fields at once** (no "what do you want to log?"
  step): weight input, steps input, workout body-part chips.
- Opening a date that already has your entry **pre-fills** it for editing.
- Blank fields on save do **not** overwrite existing values; explicit clearing
  is possible per field.
- Save writes/merges `entries/{userId}_{date}`.

## 8. Error Handling & Edge Cases

- Failed/offline writes → retry toast; Firestore's local cache gives
  optimistic UI.
- Realtime `onSnapshot` listeners on `entries`, `users`, `config` keep the
  dashboard live.
- Duplicate names allowed (differ by userId) but discouraged in the signup UI
  with a warning if the name already exists.
- Data outside the current challenge window is retained but not charted.

## 9. Infrastructure Setup (agent-executed via CLI)

Agents perform setup with the Firebase CLI and `gh` CLI; the user only
authenticates when prompted (`firebase login`, `gh auth login`).

1. Create Firebase project + Firestore database; deploy open rules.
2. Create web app registration; capture `firebaseConfig` into `js/firebase.js`.
3. Seed `config/challenge` with the first window (dates confirmed with user at
   build time).
4. Create public GitHub repo; enable GitHub Pages (deploy from `main`).
5. Verify live site end-to-end.

## 10. Implementation Order

1. Repo + Firebase project + config + rules (infra)
2. Password gate → roster → name/PIN signup → localStorage persistence
3. Log Entry modal + Firestore write/merge + edit flow
4. Dashboard skeleton + realtime listeners + team tiles
5. Weight %-change chart
6. Steps stacked chart
7. Workouts panel + streaks + activity feed
8. Me view
9. Polish: empty/loading states, celebration state, mobile QA, deploy

## 11. Out of Scope (v1)

- Real authentication (Firebase Auth), server-side validation
- Editing other members' entries; admin UI for challenge windows
- Historical challenge archives/comparison across windows
- Notifications/reminders
