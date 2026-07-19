#!/bin/bash
# Hourly Team Lift tick, run by launchd (com.teamlift.banter). Thin wrapper:
# all logic lives in scripts/orchestrator.mjs (banter refresh + push sends).
# Uses the Pro subscription via a long-lived token from `claude setup-token`,
# stored in ~/.config/teamlift/claude-token (chmod 600). Safe to run by hand;
# pass --dry-run or --send-test <userId> straight through.
#
# All output is teed to ~/Library/Logs/teamlift-banter.log AND stdout, so a
# hand run in Terminal, Cursor, or iTerm always shows progress. Claude copy
# often takes 1-3 minutes — wait for "tick complete" / "orchestrator exit=0".
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

{
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

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node not found on PATH=$PATH"
    exit 1
  fi
  if ! command -v claude >/dev/null 2>&1; then
    echo "ERROR: claude CLI not found on PATH=$PATH"
    exit 1
  fi

  echo "node=$(command -v node) ($(node -v))"
  echo "claude=$(command -v claude)"
  echo "starting orchestrator (Claude may take 1-3 min when copy is needed)…"
  node "$REPO/scripts/orchestrator.mjs" "$@"
  code=$?
  echo "orchestrator exit=$code"
  exit "$code"
} 2>&1 | tee -a "$LOG"
# pipeline exit status: prefer node/orchestrator, not tee
exit "${PIPESTATUS[0]}"
