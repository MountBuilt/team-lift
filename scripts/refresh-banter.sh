#!/bin/bash
# Team Lift tick, run every 60s by launchd (com.teamlift.banter). Thin wrapper:
# all logic lives in scripts/orchestrator.mjs.
#
# QUIET BY DEFAULT. Most ticks have nothing to do; the orchestrator prints just
# "idle" and this script logs nothing for those. Only ticks that did something
# (or failed) get a log block, so the log stays readable at 1440 runs a day.
# A hand run in a terminal always streams its output.
#
# Copy backend, picked by scripts/lib/copywriter.mjs (override with
# TEAM_LIFT_COPY_BACKEND=grok|claude|api):
#   grok-cli  (default)  SuperGrok via `grok -p` + ~/.grok/auth.json
#   cli                  `claude -p` on Claude Pro (fallback)
#   api                  Anthropic Messages API if ~/.config/teamlift/anthropic-key
#
# Safe to run by hand; pass --dry-run or --send-test <userId> straight through.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/teamlift-banter.log"
API_KEY_FILE="$HOME/.config/teamlift/anthropic-key"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"
GROK_AUTH="$HOME/.grok/auth.json"

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

# grok binary often lives in ~/.grok/bin (install path), not homebrew.
export PATH="$HOME/.grok/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

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

  has_grok=0
  has_claude=0
  has_api=0
  if command -v grok >/dev/null 2>&1 && [ -s "$GROK_AUTH" ]; then
    has_grok=1
  fi
  if command -v claude >/dev/null 2>&1 && [ -s "$TOKEN_FILE" ]; then
    has_claude=1
  fi
  if [ -s "$API_KEY_FILE" ]; then
    has_api=1
  fi

  force="${TEAM_LIFT_COPY_BACKEND:-}"
  case "$force" in
    grok|grok-cli)
      if [ "$has_grok" -ne 1 ]; then
        echo "ERROR: TEAM_LIFT_COPY_BACKEND=$force but grok/auth missing"
        exit 1
      fi
      echo "backend=grok-cli (forced SuperGrok; expect ~5-25s per call)"
      ;;
    claude|cli)
      if [ "$has_claude" -ne 1 ]; then
        echo "ERROR: TEAM_LIFT_COPY_BACKEND=$force but claude/token missing"
        exit 1
      fi
      echo "backend=cli (forced Claude Pro)"
      export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
      ;;
    api|anthropic)
      if [ "$has_api" -ne 1 ]; then
        echo "ERROR: TEAM_LIFT_COPY_BACKEND=$force but no key at $API_KEY_FILE"
        exit 1
      fi
      echo "backend=api (forced Anthropic Messages API)"
      ;;
    "")
      if [ "$has_grok" -eq 1 ]; then
        echo "backend=grok-cli (SuperGrok via grok -p; expect ~5-25s per call)"
      elif [ "$has_api" -eq 1 ]; then
        echo "backend=api (key at $API_KEY_FILE)"
      elif [ "$has_claude" -eq 1 ]; then
        echo "backend=cli (Claude Pro fallback; expect 30s-3min per call)"
        export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
      else
        echo "ERROR: no copy backend configured. Prefer SuperGrok:"
        echo "  grok login   # writes $GROK_AUTH"
        echo "Fallbacks:"
        echo "  printf 'sk-ant-...' > $API_KEY_FILE"
        echo "  claude setup-token, paste into $TOKEN_FILE"
        exit 1
      fi
      ;;
    *)
      echo "ERROR: unknown TEAM_LIFT_COPY_BACKEND=$force (use grok|claude|api)"
      exit 1
      ;;
  esac

  # Claude token is still exported when present so a mid-run grok failure can
  # be re-tried by hand with TEAM_LIFT_COPY_BACKEND=claude without re-running
  # setup. Harmless when grok is the selected backend.
  if [ "$has_claude" -eq 1 ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
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
