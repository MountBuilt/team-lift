# Push Notifications + Pipeline Rework — Design

Date: 2026-07-13
Status: approved (pending spec review)

## Goal

Per-user opt-in web push notifications for the installed PWA, in the banter
voice (brutal, masculine, Aussie, success-focused, sweary, no em-dashes):

- **Morning motivation** (first hourly tick after 7:30am Sydney): personal,
  references the user's recent entries (or absence), names today's daily
  challenge exercise and reps.
- **Evening reminder** (first tick after 8:30pm Sydney): only sent to users
  who have push enabled and **zero entries logged today**; a hard shove to
  get something in before the day ends.

Both messages are AI-written per user per day. Folded into the same work:
rework the turn-heavy refresh-banter pipeline so Claude only writes copy and
never touches curl/Firestore (fixes the recurring max-turns failures).

## Constraints

- Spark free tier only. No billing, no Cloud Functions. Sender is Simon's
  Mac via the existing hourly launchd job (`com.teamlift.banter`).
- Raw Web Push (VAPID), not FCM: no client SDK weight, works on iOS 16.4+
  installed PWAs. Permission prompt must come from a user tap.
- Mac-asleep ticks self-heal: a missed morning push goes out at the next
  tick after wake, never double-sends, and an all-day-off Mac just means a
  quiet day (accepted).
- AI copy calls run `claude -p --model sonnet` (cheap on the Pro plan;
  can be bumped per-call later if copy quality ever slips).

## Client

### Opt-in toggle (Me view)

- "Notifications" toggle in `js/ui/me.js`. Shown only when
  `'Notification' in window && 'PushManager' in window` (i.e. installed PWA
  on a capable OS); otherwise a one-line hint to install the app first.
- Toggle ON (user tap): `Notification.requestPermission()` →
  `registration.pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey: <VAPID public key> })` → write subscription to the
  user's doc:

  ```
  users/{id}.push = {
    enabled: true,
    endpoint: string,
    keys: { p256dh: string, auth: string },
    updatedAt: ISO string
  }
  ```

- Toggle OFF: `subscription.unsubscribe()` and set `push.enabled = false`
  (keep the record for debugging).
- Permission denied: toggle reverts with a short explanation.
- VAPID public key committed as a constant (e.g. `js/push-config.js`).

### Service worker (`sw.js`)

- `push` event: parse JSON payload `{ title, body }`, show notification with
  the app icon.
- `notificationclick`: close the notification, focus an existing app window
  or open one.
- Existing fetch/caching behaviour unchanged.

## Sender: unified hourly orchestrator

Replace the bash+python pipeline in `scripts/refresh-banter.sh` with a Node
orchestrator (`scripts/orchestrator.mjs`, name flexible) run by the same
launchd plist, hourly. `scripts/` gets its own `package.json` with the
`web-push` dependency — local tooling only, never served by the site.

Each tick:

1. **Fetch once**: `users`, `entries`, `config/banter`, `config/push` via
   Firestore REST (as today). Bail if the roster comes back empty (fetch
   failure guard, as today).
2. **Decide work**:
   - Banter sections whose data hash changed (port existing hash logic).
   - Morning pushes due: local time ≥ 07:30, `config/push.lastMorning !==
     today`, at least one user with `push.enabled`.
   - Evening pushes due: local time ≥ 20:30, `config/push.lastEvening !==
     today`, at least one enabled user with no entry dated today.
3. **One `claude -p --model sonnet` call** if any copy is needed. The
   orchestrator writes a context file (relevant users' last-7-day entries,
   today's challenge exercise/reps from `js/lib/challenge.js`, changed
   banter sections' data, voice rules); Claude reads it and writes a JSON
   file of copy (banter sections and/or per-user push messages). Claude
   makes **no network calls and no PATCHes** — pure copywriting. Allowed
   tools shrink accordingly; max-turns drops to a small number.
4. **Orchestrator applies results**: PATCH `config/banter` (always with
   `updateMask.fieldPaths` — a bare PATCH wipes omitted fields), send pushes
   via `web-push`, then advance `config/banter.date`/`hashes` and
   `config/push.lastMorning`/`lastEvening` only for the work that succeeded.

### State doc

```
config/push = {
  lastMorning: 'YYYY-MM-DD',
  lastEvening: 'YYYY-MM-DD'
}
```

Advancing only on success gives retry-next-hour for free and prevents
double-sends.

### Push failure handling

- Push service responds 404/410: subscription is dead (cleared Safari data,
  reinstall) → set that user's `push.enabled = false` so we stop sending;
  the user re-enables from the Me view.
- Other send errors: log and move on; `lastMorning`/`lastEvening` still
  advance if at least the copy step succeeded and sends were attempted
  (a single flaky endpoint must not re-spam everyone else next hour).
- Claude call fails: nothing advances; next tick retries (same as today's
  banter behaviour).

### Keys

- VAPID keypair generated once (`npx web-push generate-vapid-keys`).
  Private key: `~/.config/teamlift/vapid-private.key` (chmod 600, beside the
  Claude token). Public key: committed client constant.

## Copy rules (both messages)

Same voice as `js/lib/banter.js` and the refresh-banter skill: over-the-top
Aussie gym banter, swearing intended, brutal but success-focused. No
em-dashes anywhere. No persistent nicknames. "workout", never "gym".
Morning message must name today's challenge exercise and rep count and say
something true about the user's recent work (or lack of it). Evening message
must make clear nothing is logged yet today.

## Testing

- Pure logic in `js/lib/` (or `scripts/lib/`) with `node --test` coverage:
  due-window decisions (time + state doc), "no entry today" detection,
  message-context assembly, dead-subscription classification.
- `--dry-run` flag: full tick, prints intended PATCHes and pushes, writes
  and sends nothing.
- `--send-test <userId>` flag: real push to one phone for end-to-end
  verification.
- Client toggle verified with the existing headless `verify` skill plus a
  manual on-phone check (permission prompts can't be fully automated).

## Out of scope (v1)

- Per-user notification times.
- Quiet days / holiday mode.
- Any additional notification types (PR celebrations, streak milestones).
