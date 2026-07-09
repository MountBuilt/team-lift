#!/bin/bash
# Six-hourly banter refresh, run by launchd (com.teamlift.banter) at
# 00:47 / 06:47 / 12:47 / 18:47, plus RunAtLoad. Uses the Pro subscription
# via a long-lived token from `claude setup-token`, stored in
# ~/.config/teamlift/claude-token (chmod 600). Safe to run by hand.
#
# Change detection: hashes exactly the data each dashboard section reads
# (weight / steps / workouts / feed) and compares against the hashes stored
# on config/banter. If every section is unchanged since the last run, this
# script only bumps `date` (no AI call — keeps banterFresh() in
# js/lib/banter.js satisfied so the app never falls back to templates just
# because it was a quiet day). If anything changed, `claude -p
# "/refresh-banter <sections>"` runs, and only on a clean exit does this
# script write the new `date` + `hashes.*` — the agent itself never
# computes or writes hashes; that logic lives here, in one place.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"
KEY=AIzaSyAWOzfMn7YjxaqSr2qx6zTLRE0_xs9VpZI
BASE="https://firestore.googleapis.com/v1/projects/team-lift-app/databases/(default)/documents"

exec >>"$LOG" 2>&1
echo "--- $(date) ---"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "No token at $TOKEN_FILE — run: claude setup-token, then paste the token into that file."
  exit 0
fi

TODAY=$(date +%Y-%m-%d)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

curl -s --max-time 20 "$BASE/users?key=$KEY" -o "$WORKDIR/users.json"
curl -s --max-time 20 "$BASE/entries?key=$KEY" -o "$WORKDIR/entries.json"
curl -s --max-time 20 "$BASE/config/banter?key=$KEY" -o "$WORKDIR/banter.json"

# Compute the four section hashes from users + entries, fold the users list
# into every hash (so a new member or a rename invalidates all four), then
# diff against the hashes already stored on config/banter. Prints
# HASH_WEIGHT=/HASH_STEPS=/HASH_WORKOUTS=/HASH_FEED=/CHANGED= lines.
OUT=$(/usr/bin/python3 - "$WORKDIR/users.json" "$WORKDIR/entries.json" "$WORKDIR/banter.json" "$TODAY" <<'PYEOF'
import hashlib
import json
import sys
from datetime import date, timedelta

users_path, entries_path, banter_path, today = sys.argv[1:5]


def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def scalar(value):
    if value is None:
        return None
    if 'stringValue' in value:
        return value['stringValue']
    if 'integerValue' in value:
        return int(value['integerValue'])
    if 'doubleValue' in value:
        return float(value['doubleValue'])
    if 'timestampValue' in value:
        return value['timestampValue']
    if 'nullValue' in value:
        return None
    if 'arrayValue' in value:
        return [scalar(v) for v in value['arrayValue'].get('values', [])]
    return None


def field(fields, key):
    return scalar(fields.get(key)) if key in fields else None


def doc_id(doc):
    return doc['name'].rsplit('/', 1)[-1]


def docs_of(payload):
    return payload.get('documents', [])


users_docs = docs_of(load_json(users_path))
entries_docs = docs_of(load_json(entries_path))
banter_doc = load_json(banter_path)

# A failed curl (network down, HTTP error body) parses to no documents, which
# would hash as "every section emptied" — burning an AI call and then storing
# hashes for data that doesn't exist. The roster is never legitimately empty,
# so treat that as a fetch failure and bail before anything is written.
if not users_docs:
    sys.exit(1)

# (id, name) so both a new member and a rename invalidate every section.
users_key = sorted(
    (doc_id(d), field(d.get('fields', {}), 'name'))
    for d in users_docs
)

y, m, d = (int(p) for p in today.split('-'))
feed_start = (date(y, m, d) - timedelta(days=6)).isoformat()

weight_rows, steps_rows, workout_rows, feed_rows = [], [], [], []

for doc in entries_docs:
    f = doc.get('fields', {})
    user_id = field(f, 'userId')
    entry_date = field(f, 'date')
    weight = field(f, 'weight')
    steps = field(f, 'steps')
    workout_parts = field(f, 'workoutParts')
    updated_at = field(f, 'updatedAt')

    if isinstance(weight, (int, float)):
        weight_rows.append([user_id, entry_date, float(weight)])
    if isinstance(steps, (int, float)):
        steps_rows.append([user_id, entry_date, float(steps)])
    if workout_parts:
        workout_rows.append([user_id, entry_date, workout_parts])
    if entry_date and entry_date >= feed_start:
        feed_rows.append([doc_id(doc), updated_at])

weight_rows.sort(key=lambda r: (r[0], r[1]))
steps_rows.sort(key=lambda r: (r[0], r[1]))
workout_rows.sort(key=lambda r: (r[0], r[1]))
feed_rows.sort(key=lambda r: (r[0], r[1] or ''))


def stable_hash(rows):
    blob = json.dumps([users_key, rows], sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(blob.encode('utf-8')).hexdigest()


computed = {
    'weight': stable_hash(weight_rows),
    'steps': stable_hash(steps_rows),
    'workouts': stable_hash(workout_rows),
    'feed': stable_hash(feed_rows),
}

stored_hashes_field = banter_doc.get('fields', {}).get('hashes', {}).get('mapValue', {}).get('fields', {})
stored = {k: field(stored_hashes_field, k) or '' for k in computed}

changed = [name for name in ('weight', 'steps', 'workouts', 'feed') if computed[name] != stored.get(name, '')]

print(f"HASH_WEIGHT={computed['weight']}")
print(f"HASH_STEPS={computed['steps']}")
print(f"HASH_WORKOUTS={computed['workouts']}")
print(f"HASH_FEED={computed['feed']}")
print(f"CHANGED={','.join(changed)}")
PYEOF
)

field() { printf '%s\n' "$OUT" | grep "^$1=" | head -1 | cut -d'=' -f2-; }
HASH_WEIGHT=$(field HASH_WEIGHT)
HASH_STEPS=$(field HASH_STEPS)
HASH_WORKOUTS=$(field HASH_WORKOUTS)
HASH_FEED=$(field HASH_FEED)
CHANGED=$(field CHANGED)

if [ -z "$HASH_WEIGHT" ] || [ -z "$HASH_STEPS" ] || [ -z "$HASH_WORKOUTS" ] || [ -z "$HASH_FEED" ]; then
  echo "Failed to compute section hashes (bad curl/python output) — aborting."
  exit 1
fi

if [ -z "$CHANGED" ]; then
  echo "No section changed since last run — bumping date only, no AI call."
  curl -s -X PATCH "$BASE/config/banter?key=$KEY&updateMask.fieldPaths=date" \
    -H 'Content-Type: application/json' -d @- <<EOF >/dev/null
{"fields": {"date": {"stringValue": "$TODAY"}}}
EOF
  echo "exit=0"
  exit 0
fi

echo "Changed sections: $CHANGED"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
cd "$REPO"
claude -p "/refresh-banter $CHANGED" \
  --allowedTools "Bash(curl:*)" "Bash(python3:*)" "Bash(date:*)" \
  --max-turns 25
CLAUDE_EXIT=$?
echo "claude exit=$CLAUDE_EXIT"

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  echo "claude run failed — leaving date/hashes untouched so the next run retries the same sections."
  exit "$CLAUDE_EXIT"
fi

# Only on a clean claude exit do we advance date + hashes, and only for the
# fields we're actually writing (a bare PATCH with no updateMask would wipe
# every field this script and the agent didn't just touch).
curl -s -X PATCH "$BASE/config/banter?key=$KEY&updateMask.fieldPaths=date&updateMask.fieldPaths=hashes.weight&updateMask.fieldPaths=hashes.steps&updateMask.fieldPaths=hashes.workouts&updateMask.fieldPaths=hashes.feed" \
  -H 'Content-Type: application/json' -d @- <<EOF >/dev/null
{"fields": {
  "date": {"stringValue": "$TODAY"},
  "hashes": {"mapValue": {"fields": {
    "weight":   {"stringValue": "$HASH_WEIGHT"},
    "steps":    {"stringValue": "$HASH_STEPS"},
    "workouts": {"stringValue": "$HASH_WORKOUTS"},
    "feed":     {"stringValue": "$HASH_FEED"}
  }}}
}}
EOF
echo "date + hashes updated"
exit 0
