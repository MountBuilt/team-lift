#!/bin/bash
# Team Lift tick. Production host is the NUC:
#   - teamlift-banter-watch.service  event wake (Firestore onSnapshot on pendingAt)
#   - teamlift-banter.timer          30s safety net (clock jobs + missed events)
# Mac launchd (com.teamlift.banter) is deprecated — keep it unloaded.
# Thin wrapper: all logic lives in scripts/orchestrator.mjs.
#
# QUIET BY DEFAULT. Most ticks have nothing to do; the orchestrator prints just
# "idle" and this script logs nothing for those. Only ticks that did something
# (or failed) get a log block. Hand runs always stream output.
#
# SINGLE-FLIGHT: event watcher + timer share one lock. If a tick is already
# running, a second caller sets a rerun flag and exits 0; the lock holder loops
# once more after finishing so a mid-call comment is not dropped.
#
# Copy backend, picked by scripts/lib/copywriter.mjs (override with
# TEAM_LIFT_COPY_BACKEND=grok|claude|api):
#   grok-cli  (default)  SuperGrok via `grok -p` + ~/.grok/auth.json
#   cli                  `claude -p` on Claude Pro (fallback)
#   api                  Anthropic Messages API if ~/.config/teamlift/anthropic-key
#
# Safe to run by hand; pass --dry-run or --send-test <userId> straight through.
# Ops: docs/ops-nuc.md
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# XDG-style path works on Linux NUC and Mac hand-runs. Older Mac launchd
# installs used ~/Library/Logs/teamlift-banter.log — that path is no longer
# written; tail the new path after pull.
STATE="$HOME/.local/state/teamlift"
LOG="$STATE/banter.log"
LOCK_FILE="$STATE/tick.lock"
RERUN_FILE="$STATE/tick.rerun"
API_KEY_FILE="$HOME/.config/teamlift/anthropic-key"
TOKEN_FILE="$HOME/.config/teamlift/claude-token"
GROK_AUTH="$HOME/.grok/auth.json"
WAKE="${TEAM_LIFT_WAKE:-manual}"

mkdir -p "$STATE"
touch "$LOG"

# grok binary often lives in ~/.grok/bin; node may be in ~/.local/bin (Linux)
# or homebrew (Mac). Prefer an already-active nvm node if present.
export PATH="$HOME/.grok/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
if [ -d "$HOME/.nvm/versions/node" ]; then
  # shellcheck disable=SC2012
  _nvm_bin="$(ls -1d "$HOME/.nvm/versions/node"/*/bin 2>/dev/null | tail -1)"
  if [ -n "$_nvm_bin" ] && [ -x "$_nvm_bin/node" ]; then
    export PATH="$_nvm_bin:$PATH"
  fi
  unset _nvm_bin
fi

run_tick_body() {
  # Portable temp file (GNU mktemp needs XXXXXX; macOS -t form is not portable).
  local OUT code
  OUT="$(mktemp "${TMPDIR:-/tmp}/teamlift-tick.XXXXXX")"

  # Subshell, not a brace group: the `exit` calls below must end this block
  # only, not the whole script (a brace group with a redirect is not a subshell).
  (
    echo "--- $(date) ---"
    echo "repo=$REPO"
    echo "wake=$WAKE"
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

  # Always show the run (timers discard stdout; a hand run wants to see it,
  # whether it is a terminal or a pipe).
  cat "$OUT"

  # An idle tick prints only the header block, "idle", and "exit=0". Don't log it.
  if [ "$code" -eq 0 ] && grep -qx "idle" "$OUT"; then
    rm -f "$OUT"
    return 0
  fi
  cat "$OUT" >>"$LOG"
  rm -f "$OUT"
  return "$code"
}

# ---- single-flight lock (event watcher + 30s timer share this) ------------
# flock is util-linux (NUC). Without it (rare on Mac), run unlocked.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    touch "$RERUN_FILE"
    echo "--- $(date) ---"
    echo "wake=$WAKE"
    echo "busy: another tick holds the lock; queued rerun"
    exit 0
  fi

  final=0
  while true; do
    rm -f "$RERUN_FILE"
    run_tick_body "$@"
    final=$?
    if [ ! -f "$RERUN_FILE" ]; then
      exit "$final"
    fi
    echo "--- $(date) ---"
    echo "wake=$WAKE"
    echo "rerun: work arrived while previous tick was running"
  done
fi

run_tick_body "$@"
exit $?
