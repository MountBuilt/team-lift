#!/bin/bash
# Team Lift tick, run every 60s by launchd (com.teamlift.banter). Thin wrapper:
# all logic lives in scripts/orchestrator.mjs.
#
# QUIET BY DEFAULT. Most ticks have nothing to do; the orchestrator prints just
# "idle" and this script logs nothing for those. Only ticks that did something
# (or failed) get a log block, so the log stays readable at 1440 runs a day.
# A hand run in a terminal always streams its output.
#
# Copy backend, picked by scripts/lib/copywriter.mjs:
#   ~/.config/teamlift/anthropic-key  -> Messages API (fast, ~3-6s, metered)
#   otherwise                         -> `claude -p` on the Pro subscription via
#                                        ~/.config/teamlift/claude-token
#                                        (slower, no per-token bill)
#
# Safe to run by hand; pass --dry-run or --send-test <userId> straight through.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
API_KEY_FILE="$HOME/.config/teamlift/anthropic-key"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

OUT="$(mktemp -t teamlift-tick)"
trap 'rm -f "$OUT"' EXIT

# Subshell, not a brace group: the `exit` calls below must end this block
# only, not the whole script (a brace group with a redirect is not a subshell).
(
  echo "--- $(date) ---"
  echo "repo=$REPO"
  echo "args=${*:-"(none)"}"

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node not found on PATH=$PATH"
    exit 1
  fi

  if [ -s "$API_KEY_FILE" ]; then
    echo "backend=api (key at $API_KEY_FILE)"
  elif [ -s "$TOKEN_FILE" ]; then
    echo "backend=cli (Pro subscription token; expect 30s-3min per call)"
    if ! command -v claude >/dev/null 2>&1; then
      echo "ERROR: claude CLI not found on PATH=$PATH and no API key present"
      exit 1
    fi
    # shellcheck disable=SC2155
    export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
  else
    echo "ERROR: no copy backend configured. Either:"
    echo "  printf 'sk-ant-...' > $API_KEY_FILE   # Messages API, fast"
    echo "  claude setup-token, paste into $TOKEN_FILE   # Pro subscription"
    exit 1
  fi

  node "$REPO/scripts/orchestrator.mjs" "$@"
  code=$?
  echo "orchestrator exit=$code"
  exit "$code"
) >"$OUT" 2>&1
code=$?

# Always show the run (launchd discards stdout; a hand run wants to see it,
# whether it is a terminal or a pipe).
cat "$OUT"

# An idle tick prints only the header block, "idle", and "exit=0". Don't log it.
if [ "$code" -eq 0 ] && grep -qx "idle" "$OUT"; then
  exit 0
fi
cat "$OUT" >>"$LOG"
exit "$code"
