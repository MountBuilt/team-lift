# Sledged — Costs & Pricing

**Date:** 2026-08-09
**Status:** Approved. Price is A$2.00 one-off, per person.

All figures USD unless marked. AUD conversion at ~0.65.

---

## 1. Unit cost of Aiden

Rates: **Grok 4.1 Fast — $0.20 per 1M input, $0.50 per 1M output.**
Token budgets from `04` §6. Worked for a crew of 6.

### Daily, per crew

| Job | Calls/day | Input | Output | Cost/call | Cost/day |
|---|---|---|---|---|---|
| `report` | 1 | 4,000 | 400 | $0.00100 | $0.00100 |
| `feedLine` | 6 | 1,500 | 60 | $0.00033 | $0.00198 |
| `threadReply` | 8 | 3,000 | 150 | $0.00068 | $0.00540 |
| `push` | 8 | 1,200 | 80 | $0.00028 | $0.00224 |
| | | | | **Total** | **$0.01062** |

### Weekly, per crew

| Job | Input | Output | Cost/week | Cost/month |
|---|---|---|---|---|
| `weeklyReport` | 5,000 | 500 | $0.00125 | $0.0054 |
| `notebook` | 6,000 | 400 | $0.00140 | $0.0060 |

### Per crew, per month

$0.01062 × 30 + $0.0054 + $0.0060 = **$0.330 per crew per month**

### Per user

| | Monthly |
|---|---|
| Crew share (crew of 6) | **$0.055** |
| DM, average paid user (~2 msgs/day) | $0.042 |
| DM, heavy paid user (~10 msgs/day) | $0.210 |
| **Free user** | **~$0.055** |
| **Typical paid user** | **~$0.097** |

**Note the free user is not free.** Generation is deliberately not
entitlement-aware (`04` §7) — Aiden writes the full line and the crew sees it;
only the free author's own view is redacted. So a free user costs the same as
a paid one minus DM. This is a considered trade: making Aiden go quiet about
free users would out them to the crew and gut the shop window.

---

## 2. Infrastructure

At ~1,000 installs / ~350 weekly-active users.

| Item | Monthly | Notes |
|---|---|---|
| Firestore reads | ~$0.40 | ~70k/day, 50k/day free, $0.06/100k over |
| Firestore writes | $0 | ~1k/day against 20k/day free |
| Firestore storage | ~$0.20 | Well under 1 GB |
| Cloud Functions v2 | ~$0 | Under the 2M invocation free tier |
| Cloud Scheduler | $0 | 3 jobs, first 3 free |
| Firebase Auth | $0 | Free to 50k MAU |
| FCM | $0 | Free |
| **Firebase total** | **~$1-3** | |
| Apple Developer | $8.25 | $99/yr |
| Google Play | ~$0.20 | $25 once, amortised |
| Domain | ~$1.25 | ~$15/yr |
| EAS Hosting (web) | $0 | Free tier |
| RevenueCat | $0 | Free under $2.5k/mo tracked revenue |
| **Fixed total** | **~$11-13** | |

---

## 3. The revenue model, honestly

**A$2.00 → US$1.30 gross → US$1.105 net** after Apple's 15% Small Business
Program rate. Round to **$1.10**.

**Cover per payer:** $1.10 ÷ $0.055 = **~20 months** for a free-tier-equivalent
load, ~11 months for a typical paid user including their DM usage. Either way,
comfortably over the "covers me for a year" bar.

### The structural weakness — state it plainly

A one-off purchase produces **revenue when a user converts, and nothing
thereafter**. Costs continue. So:

- **While growing, this model works.** New payers fund the accumulated base.
- **If growth stops, revenue goes to zero and costs do not.**

This is the known trade-off of choosing a one-off over a subscription, and it
was made deliberately. It is survivable here for two reasons, both of which
must be built:

1. **Costs are genuinely small.** 1,000 active users at $0.055 is $55/month.
2. **Dormancy controls (§4) mean inactive users cost nothing.** Most installs
   go quiet, and a quiet user generates no calls at all.

### Scenarios

Assuming 35% of installs remain active, 6% of active users convert.

| Installs | Active | Monthly AI | Fixed | Total cost | Payers to date | One-off revenue |
|---|---|---|---|---|---|---|
| 500 | 175 | $10 | $12 | **$22** | 11 | $12 |
| 1,000 | 350 | $19 | $12 | **$31** | 21 | $23 |
| 5,000 | 1,750 | $96 | $15 | **$111** | 105 | $116 |
| 25,000 | 8,750 | $481 | $25 | **$506** | 525 | $578 |

Revenue in the last column is **cumulative**, cost is **monthly**. So at 5,000
installs the app is roughly at break-even *for that month* only if it is still
adding ~100 payers a month. It is not a business; it is a cost-recovery
mechanism, which is what was asked for.

### When to switch to a subscription

Do not switch pre-emptively. Switch when **any** of these is true:

- Monthly infrastructure + AI exceeds **$300** and month-on-month new payers no
  longer cover it.
- Active users exceed **~10,000**.
- Growth flattens for two consecutive months while the active base holds.

Grandfather every existing one-off purchaser permanently. Reneging on a
"one-off, forever" promise is the fastest way to earn a wave of one-star
reviews.

---

## 4. Cost controls — build these, do not defer them

These are not optimisations. Without them a single loop or a single viral day
produces an unbounded bill.

### Dormancy — the big one

- **No report for a crew where nobody logged in the last 24 hours.** A report
  about nothing is bad copy anyway, so this is a product improvement that
  happens to halve the bill.
- **No weekly recap for a crew with zero activity that week.**
- **No notebook update for a crew with no new messages.**
- **No morning push to a user who has not opened the app in 14 days.** Send one
  "we'll stop bothering you" notification, then stop. Re-enable on next open.

### Rate limits (server-enforced, per user)

| Action | Limit |
|---|---|
| DM messages | 30/day paid; **20 total for the whole trial** |
| Thread messages | 60/day |
| Entries written | 20/day (an entry is one per day; this catches edit loops) |
| Feed-line generations | 1 per entry, ever. **No re-roll on edit.** |
| Thread reply generations | Debounced: answer all pending humans in one call |
| Crew joins | 10/day |

### Per-crew daily budget

Hard cap of **$0.05 per crew per day** (~5× expected). On breach, stop
generating for that crew until the next day and log it. A crew hitting this is
either extraordinary or abusive; either way it should not be silent.

### Global kill switch

`config/app.killSwitches` with independent flags for `generation`, `dm`,
`push`. Readable by every function, changeable from the Firebase console with
**no deploy**. Test it before launch — a switch nobody has flipped does not
work.

### Budget alarms

- GCP budget alert at $25, $50, $100/month.
- xAI spend alert at the same thresholds.
- A daily summary of generation count and cost, emailed. Anomalies are visible
  in a day rather than at the end of the month.

---

## 5. Why not self-host a model

Asked and answered: **no.**

- Break-even for self-hosting against frontier API pricing sits around
  **160-256M tokens/month**. Against Grok 4.1 Fast at $0.20/M, it is far
  further out still.
- A crew burns ~1.8M tokens/month. You would need well over a hundred active
  crews to reach even the frontier-priced crossover, at which point the API
  bill is about $45/month — less than a single GPU VPS.
- Raw GPU rental is only **30-40% of true cost**; the rest is orchestration,
  monitoring and the engineer time to keep it up. Common guidance is a 2.5-3×
  multiplier on the hardware line.
- The consensus threshold is: **under ~$50k/year of LLM spend, use the API.**
  Sledged is projected at under $1k/year at 25,000 installs.
- And the decisive one: an 8B open-weight model will not hold Aiden's voice.
  The product would get worse in exchange for a higher bill.

Revisit only if annual model spend passes five figures.

---

## 6. Pricing mechanics

- **Product id:** `sledged_unlock` (identical in App Store Connect, Play
  Console and RevenueCat).
- **Type: non-consumable.** Configuring a lifetime unlock as consumable is a
  common and painful error — RevenueCat then treats it as used up.
- **Price:** A$2.00, with equivalent Apple/Google price points per territory.
  Whole dollars everywhere it can be.
- **Small Business Program:** enrol. Every figure above assumes 15%, not 30%.
- **Restore Purchases** in Me, working across devices and reinstalls.
- **Entitlement is server-written only**, by the RevenueCat webhook. The client
  never writes it (`03` §5).
- **Trial** is tracked server-side on the user doc (`trialStartedAt`,
  `trialEndsAt`), set on **first crew join/create**, never on install.
