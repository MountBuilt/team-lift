# Dash home, snack challenge, 48-hour recap (2026-08-16)

Source of truth for the home surface after this date. Supersedes these
parts of earlier specs:

- `2026-08-07-home-stats-ai-feed-design.md` §1 (three tabs, Stats tab,
  today-on-the-board, podium on Dashboard, scoreboard charts living only
  on Stats). Coach chat, AI feed parents, report thread lifetime, and
  tick/write rules from that spec still stand.
- `2026-08-03-weekly-recap-design.md` **UI visibility only**. The Sunday
  write, `weeklyReport` shape, wipe-on-rewrite, and thread target `weekly`
  are unchanged. The card is no longer shown for the whole following week.

Thread mechanics from `2026-07-19-aiden-threads-design.md` still stand.
The one goal is still **getting the crew to log something every day.**

Maintainers: Grok primary, Claude welcome. Read this before touching tabs,
the daily challenge, the workouts card, the recap card, or the dash charts.

## Why

The Stats tab hid the week board and the trends. The Dashboard then filled
up with a today board, a podium, and a recap that sat there all week. The
daily challenge also ramped every week until it stopped being a snack.

This pass puts the useful scoreboard back on Dash, throws out the chrome
that does not get a log, and makes the snack vanish once you have ticked it.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Tabs | **Dash \| Me.** Stats tab is gone. Leftover `state.tab === 'stats'` lands on Dash. |
| Today on the board | **Remove.** |
| Podium | **Remove** from Dash. `weeklyAwards` can stay as a pure helper. |
| Score tiles | **Remove** the three-up row (workouts this wk / hit 3+ / team steps). |
| Challenge numbers | **Snack band**, up and down by day. No weekly ramp. |
| Challenge pair | Two equal cards. Left = snack + tick. Right = seeded nudge. |
| Tick label | **Rolling set** (smashed it, sorted, done, …), seeded by date. |
| After tick | **Both cards collapse** and stay gone for that user for the rest of the day. |
| Workouts card | Keep 7 dots. Drop `x/7` and last-week counts. Fill = workout, ring = snack. |
| Recap visibility | **No standalone card.** Monday's morning report covers last week. |
| Weight + steps | **One card**, two graphs, one shared name legend. Smooth weight lines, no dots, no date axis. |
| Dash order | Header, snack pair (if open), workouts, coach, trends, feed. |

## 1. Navigation

Sticky top nav is two equal tabs: **DASH** and **ME**.

- Default tab remains `'dash'`.
- Charts mount while Dash is showing (same Chart.js entrance rule as today:
  animate on tab visit, not on Firestore snapshot redraws).
- No bottom nav.
- Files: drop the Stats button and `renderStats` route from `js/app.js`.
  Keep `js/ui/stats.js` as a non-routed helper (workouts panel + chart
  shells) imported by the dashboard. Do not leave a third tab.

## 2. Dashboard stack

```
header
push-coach          (only while shouldShowPushCoach)
challenge pair      (only while this user has not ticked today, and
                     today <= challenge.endDate)
workouts this week
coach chat          (unchanged preview + thread)
week recap          (only in the 2-day window)
weight | steps      (one row, two cards)
recent activity
```

(+) FAB remains the log entry. No LOG SOMETHING card.

## 3. Daily challenge

### Snack numbers

`dailyChallenge(dateStr, challengeStartStr)` still picks the exercise with
`pickFrom(EXERCISES, \`daily|${dateStr}\`)`. It no longer uses
`weekNumber` to add `perWeek` reps.

Each exercise has a snack band. Reps for that day are a deterministic
integer inside `[min, max]` inclusive, seeded by the date and the
exercise name so every device agrees.

| Exercise | min | max |
|---|---|---|
| push ups | 8 | 15 |
| air squats | 10 | 20 |
| jumping jacks | 20 | 40 |
| burpees | 5 | 10 |
| high knees | 20 | 40 |

Returned shape stays `{ name, reps, week }`. `week` can still be reported
for context (challenge week number) but it must not change the reps.

Same-day grace for Aiden copy is unchanged: never claim someone avoided
today's snack.

### Pair layout

Two equal cards on one row.

**Left: snack**

- Eyebrow: Daily challenge.
- Streak mark in the header when this user's streak is 2+ days
  (`challengeStreak`, same helper as today).
- Big line: `{reps} {NAME}`.
- Full-width tick button. Label is **not** fixed "I'VE DONE IT".
- While saving: `SAVING…` then the collapse starts. On error, re-enable
  and restore today's label.

**Right: nudge**

- Eyebrow rotates with the line kind: **Fact**, **Fuel**, or **Push**.
- Body from `challengeNudgeCard(dateStr, exerciseName)`.
- Mix of a health fact, a fuel line, or a push that makes them want the
  snack. Prefer a line tagged to that exercise when the pool has one.
- Deterministic. No em-dashes. Encouraging, not filthy Aiden register.
  One or two short sentences, hard cap 120 characters.
- Not a thread.

Do not render `CHALLENGE_QUIPS` under the reps. Fold any line worth
keeping into the nudge pool and stop importing `CHALLENGE_QUIPS` from
the dashboard.

### Tick labels

`challengeTickLabel(dateStr)` picks one string from a fixed pool with
`pickFrom`, seed `tick|${dateStr}`. Display in the existing display /
uppercase button style.

Pool (locked, add only if a test needs more variety):

- smashed it
- sorted
- done
- knocked it
- nailed it
- ticked
- job done
- easy
- in the bag
- done and dusted

Same day, same label on every device. Do not re-roll on re-render.

### After tick

Ticking still writes `dailyChallenge: true` on that day's entry.

On the successful tick only:

1. Existing confetti burst on the button.
2. Both cards of the pair play a short collapse (scale + fade + height
   to 0, ~400ms). Cards below slide up with the layout.
3. `prefers-reduced-motion: reduce` skips the motion: hide immediately
   after the write.

Later paints that day (snapshot refresh, tab return) omit the pair
entirely. No DONE TODAY stamp. Proof that you ticked lives on the
workouts card ring and in the feed line.

If the write fails, the pair stays.

The pair is per-user: your tick hides it for you, not for the crew.

## 4. Workouts this week

Keep the card and the 7 Mon–Sun dots.

**Remove** from each row: the `count/7` figure and the last-week
`(n)` figure. Remove the "last wk in ( )" hint. The whole-team-at-3+
banner can stay.

**Dot states** (one circle per day):

| Workout | Snack | Render |
|---|---|---|
| no | no | empty (current edge fill) |
| yes | no | filled (accent, or green if the row has hit 3 workouts) |
| no | yes | empty fill + green ring |
| yes | yes | filled + green ring |

Tooltip on a marked day still lists workout parts. If the snack is
ticked that day, append a short "snack" mark to the tooltip.

Need a pure helper so the UI does not invent the matrix. Extend
`workoutWeek` (or add `weekMarks(entries, userId, mondayStr)`) to
return `{ date, parts, challenge }` per day. `challenge` is true when
that user has `dailyChallenge: true` on that date.

## 5. Week recap is Monday's report

No standalone weekly card. `needsWeeklyReport` is always false. The
Sunday `weeklyReport` write is retired.

Monday's morning `report` covers **last week** (Mon–Sun that just
ended) via `context.lastWeek` and `context.reportKind === 'week'`.
Tue–Sun reports stay yesterday-only (`reportKind: 'day'`).

Same-day grace still applies on Monday. Today's snack is still an
invitation. Call it a snack in the copy.

The leftover `weekly` thread has no home card. Treat comments there
like the report thread if anyone still has it open.

## 6. Weight and steps

Two equal cards on one row, under the recap (or under coach when the
recap is hidden).

- Left: Weight. Line chart, existing series, existing tooltip
  (change vs first weigh-in, never absolute kg).
- Right: Steps. Bar chart, existing stacked team series.
- Short canvases (about half the current Stats height, ~h-28 / 7rem).
- No y-axis tick labels. No x-axis numbers required beyond a couple of
  date marks if they still fit. Legend can stay as tiny name dots.
- Empty states stay inside each card with the existing LOG IT button.

Charts still only draw when their canvases exist.

## 7. Unchanged

- Coach chat preview, open-at-bottom, load-earlier, 5-day report TTL.
- AI feed parents, `feedLines`, human-led replies, typing dots.
- (+) FAB, Me tab, log sheet, reactions, push coach, PWA chrome.
- Never publish an absolute weight in kg.
- Aiden still invitation-only on the snack: today is invitation, not a
  roast for not-yet-done.

## 8. Tests

Pure helpers under `js/lib/` need `node --test` coverage:

- `dailyChallenge` stays inside each exercise's snack band; same date
  is stable; later weeks are **not** required to be harder; a fortnight
  of the same exercise must not be a monotone climb.
- `challengeNudge` is deterministic, has no em-dash, and prefers an
  exercise-tagged fact when one exists.
- `challengeTickLabel` is deterministic and only returns a pool member.
- Week marks include `challenge` per day.
- Monday `templateReport` recaps last week. Mid-week still says yesterday.

## Out of scope

- Changing the Sunday recap write or weekly thread wipe.
- Putting coach lines back on chart cards.
- Rebuilding the Me tab.
- New backend state for quotes or tick labels.
