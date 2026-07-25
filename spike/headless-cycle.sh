#!/usr/bin/env bash
# The P0 spike: prove that a headless agent goes through the FULL cycle of the
# agent-comms protocol rather than merely answering like a command (thread 012,
# phase P0).
#
# What one run proves:
#   mail (has-mail) → `claude -p` with the role prompt → the agent reads the
#   thread, appends a section, regenerates the index, commits and pushes → the
#   process exits with a code. No tmux, no live watch, no /wake.
#
# If this works, a whole layer disappears from the execution model (the tmux
# session, `wait-for-mail`, the keeper-as-alarm-clock), and with it a class of
# bugs, "the session is alive ≠ the agent sees mail" (pain 5, thread 008): in the
# "waking = a new process" model it simply does not exist.
#
# SAFETY. The spike works ONLY inside an isolated sandbox (its own bare origin in
# $TMPDIR, its own copy of the comms branch) and does NOT touch the production
# circuit. It is an honest proof of the mechanics (the real section format, a real
# git push, a real rebuild-index), but on throw-away data.
#
# usage: bash headless-cycle.sh
# requires: git, the claude CLI (checked on 2.1.218), access to the model.

set -uo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SPIKE_DIR/../../.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

log() { printf '\n=== %s\n' "$*"; }

# The production protocol lives in a separate checkout, `.worktrees/comms`, from
# which the spike takes rebuild-index.sh and ROLES.md. The path is looked up
# EXPLICITLY and we crash LOUDLY if it is not found: a silent degradation of the
# bench setup (`cp … 2>/dev/null`) has already produced a false picture once — the
# agent saw an empty bin/, could not pass the turn through the generator and
# improvised, and the failure would have been blamed on "the agent is
# non-deterministic". The cwd/has-mail lesson (thread 008): the bench shouts, it
# does not stay silent.
COMMS_DIR=""
for cand in "$REPO_ROOT/.worktrees/comms/agent-comms" "$REPO_ROOT/../comms/agent-comms"; do
  [ -f "$cand/bin/rebuild-index.sh" ] && { COMMS_DIR="$cand"; break; }
done
if [ -z "$COMMS_DIR" ]; then
  echo "ERROR: production agent-comms with bin/rebuild-index.sh not found (looked in .worktrees/comms and ../comms)" >&2
  exit 2
fi
log "Production protocol: $COMMS_DIR"

# The claude binary is RESOLVED EXPLICITLY instead of being called by name. The
# PATH of a sub-shell is unstable between calls (the nvm bin directory is there or
# it is not), and a bare `claude` gave exit 127 in the middle of a run — the same
# class of "a silent dependency on the environment" as the cwd of has-mail. We look
# in PATH, then in the known nvm path; not there at all — we crash LOUDLY BEFORE
# the cycle starts rather than with an obscure 127 halfway through.
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for cand in "$HOME"/.nvm/versions/node/*/bin/claude; do
    [ -x "$cand" ] && { CLAUDE_BIN="$cand"; break; }
  done
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "ERROR: the claude binary was found neither in PATH nor in ~/.nvm/versions/node/*/bin" >&2
  exit 3
fi
log "claude: $CLAUDE_BIN"

# --- 1. An isolated bench with a thread waiting on dev-core ---
log "Building the sandbox: $SANDBOX"
git init -q --bare "$SANDBOX/origin.git"
git clone -q "$SANDBOX/origin.git" "$SANDBOX/work"
cd "$SANDBOX/work"
git config user.email spike@test
git config user.name spike

mkdir -p agent-comms/900-spike agent-comms/bin
cp "$COMMS_DIR/bin/rebuild-index.sh" agent-comms/bin/
cp "$COMMS_DIR/ROLES.md" agent-comms/

# The heading stays in the language of the project zone on purpose: the index in
# the sandbox is rebuilt by the PROJECT's generator (`bin/rebuild-index.sh` copied
# above), and its output is what the check compares against.
cat > agent-comms/INDEX.md <<'IDX'
# Реестр разговоров

| id | participants | status | waiting-on | updated |
|---|---|---|---|---|
| 900-spike | curator, dev-core | open | dev-core | 2026-07-23 |
IDX

cat > agent-comms/900-spike/_thread.md <<'THR'
# 900-spike · A check of the headless cycle

participants: curator, dev-core · status: open

## msg-001 · from: curator · 2026-07-23 · expects: answer

dev-core, this is a spike check. Answer with an msg-002 section at the end of this
thread: confirm that you have read the statement of work, and write the number 42.
Then pass the turn back to the curator with a waiting-on line.
THR

git checkout -q -b comms
git add -A
git commit -qm "spike stand init"
# The exit code is checked and the output is NOT muted (the reviewer's remark on
# PR #17): staying silent on the bench push is the same `… 2>/dev/null` pattern the
# spike itself names as the cause of one of the harness defects. The "the bench
# shouts, it does not stay silent" principle holds here too, not only in the
# resolution of COMMS_DIR/CLAUDE_BIN.
if ! git push -q -u origin comms; then
  echo "ERROR: the bench push into the bare origin failed — there is nothing left to check the cycle on" >&2
  exit 4
fi

# --- 2. A mail check by the same parsing the production circuit uses ---
# (has-mail is not dragged in here: the thread obviously waits on dev-core. In
#  production the wrapper starts claude ONLY when has-mail is non-empty — that is
#  the trigger.)
log "Mail: 900-spike is waiting on dev-core"

# --- 3. The headless agent goes through the cycle ---
PROMPT='You are the dev-core role in the file-based agent-comms protocol. The working directory is a git repository, branch comms.

The task of one cycle:
1. Read agent-comms/900-spike/_thread.md — the statement of work from curator is there.
2. Carry it out: append to the END of the file a section in exactly this format
   ## msg-002 · from: dev-core · 2026-07-23 · expects: answer
   with the text of the answer to the statement of work. Threads are append-only — do not touch what exists, append to the end.
3. Run bash agent-comms/bin/rebuild-index.sh to update agent-comms/INDEX.md (pass the turn back: in your own section, with the line "waiting-on → curator").
4. Commit and push: git add -A && git commit -m "docs(agent-comms): msg-002 in 900-spike — the dev-core answer" && git push origin HEAD:comms
5. Briefly confirm that the cycle is done.'

log "Starting the headless agent (claude -p, 180s limit)"
timeout 180 "$CLAUDE_BIN" -p "$PROMPT" \
  --output-format json \
  --allowedTools "Bash,Read,Edit,Write" \
  --max-turns 25 > "$SANDBOX/run.json" 2>"$SANDBOX/run.err"
CLAUDE_EXIT=$?

# --- 4. A check BY FACT (not by the agent's report) ---
log "Checking the result in origin"
git fetch -q origin comms
THREAD="$(git show origin/comms:agent-comms/900-spike/_thread.md)"
INDEX="$(git show origin/comms:agent-comms/INDEX.md)"

pass=0 fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1 (expected '$3', got '$2')"; fail=$((fail+1)); fi; }

check "the process exited with code 0"       "$CLAUDE_EXIT" "0"
check "msg-002 was written by the agent"     "$(printf '%s' "$THREAD" | grep -c 'msg-002 · from: dev-core')" "1"
check "msg-001 is preserved (append-only)"   "$(printf '%s' "$THREAD" | grep -c 'msg-001 · from: curator')" "1"
check "the turn was passed to curator in INDEX" "$(printf '%s' "$INDEX" | awk -F'|' '/900-spike/{gsub(/ /,"",$5);print $5}')" "curator"

python3 - "$SANDBOX/run.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"  · is_error={d['is_error']} subtype={d.get('subtype')} turns={d.get('num_turns')}")
print(f"  · session_id={d.get('session_id')}")
print(f"  · cost_usd={d.get('total_cost_usd')} duration_ms={d.get('duration_ms')}")
PY

log "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && echo "P0 PROVEN: the headless agent goes through the full protocol cycle." || echo "P0 NOT proven — see the failures above."
exit "$fail"
