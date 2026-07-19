#!/bin/bash
# Hourly Team Lift tick, run by launchd (com.teamlift.banter). Thin wrapper:
# all logic lives in scripts/orchestrator.mjs (banter refresh + push sends).
# Uses the Pro subscription via a long-lived token from `claude setup-token`,
# stored in ~/.config/teamlift/claude-token (chmod 600). Safe to run by hand;
# pass --dry-run or --send-test <userId> straight through.
#
# Output always goes to ~/Library/Logs/teamlift-banter.log. When you run this
# in a terminal, the same lines also print so it does not look like a no-op.
# Claude copy can take 1-3 minutes — wait for "tick complete".
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

# launchd: log only. Interactive: log + terminal.
if [ -t 1 ]; then
  exec > >(tee -a "$LOG") 2>&1
else
  exec >>"$LOG" 2>&1
fi

echo "--- $(date) ---"
echo "repo=$REPO"
echo "args=${*:-"(none)"}"
echo "log=$LOG"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "No token at $TOKEN_FILE - run: claude setup-token, then paste the token into that file."
  exit 0
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# shellcheck disable=SC2155
export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"

echo "starting orchestrator (Claude may take 1-3 min when copy is needed)…"
node "$REPO/scripts/orchestrator.mjs" "$@"
code=$?
echo "orchestrator exit=$code"
exit "$code"
