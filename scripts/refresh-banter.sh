#!/bin/bash
# Daily banter refresh, run by launchd (com.teamlift.banter). Uses the Pro
# subscription via a long-lived token from `claude setup-token`, stored in
# ~/.config/teamlift/claude-token (chmod 600). Safe to run by hand.
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

# Idempotent: skip if today's banter is already written (RunAtLoad + the
# calendar trigger can both fire on the same day).
TODAY=$(date +%Y-%m-%d)
CURRENT=$(curl -s --max-time 20 "$BASE/config/banter?key=$KEY" \
  | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("fields",{}).get("date",{}).get("stringValue",""))' 2>/dev/null)
if [ "$CURRENT" = "$TODAY" ]; then
  echo "Banter already fresh for $TODAY — skipping."
  exit 0
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
cd "$REPO"
claude -p "/refresh-banter" \
  --allowedTools "Bash(curl:*)" "Bash(python3:*)" "Bash(date:*)" \
  --max-turns 25
echo "exit=$?"
