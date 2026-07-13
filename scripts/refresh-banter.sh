#!/bin/bash
# Hourly Team Lift tick, run by launchd (com.teamlift.banter). Thin wrapper:
# all logic lives in scripts/orchestrator.mjs (banter refresh + push sends).
# Uses the Pro subscription via a long-lived token from `claude setup-token`,
# stored in ~/.config/teamlift/claude-token (chmod 600). Safe to run by hand;
# pass --dry-run or --send-test <userId> straight through.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"

exec >>"$LOG" 2>&1
echo "--- $(date) ---"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "No token at $TOKEN_FILE - run: claude setup-token, then paste the token into that file."
  exit 0
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
exec node "$REPO/scripts/orchestrator.mjs" "$@"
