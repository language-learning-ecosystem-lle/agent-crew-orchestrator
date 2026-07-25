# P0 — the result of the headless-cycle spike

Thread 012, phase P0. Run: `bash packages/agent-protocol/spike/headless-cycle.sh`.

## What has been proven

**A headless agent goes through the FULL protocol cycle, not merely answers like a command.** Not a hypothesis but a fact checked in origin after the run (not taken from the agent's report):

| check | result |
|---|---|
| the `claude -p` process exited with code 0 | ✓ |
| msg-002 was written into the thread by the agent | ✓ |
| msg-001 was preserved — append-only is not broken | ✓ |
| the turn was passed to curator in INDEX (the agent ran `rebuild-index.sh`) | ✓ |

**Three runs in a row — all 4/4.** Stable after three defects of the test bench were removed (below). `subtype=success`, `session_id` is returned, `num_turns` 8–13.

N=3 is enough for P0 (proof of the mechanics: "does headless go through the cycle" — yes/no). But it is NOT a measure of reliability: before the bench defects were fixed, the same setup produced 4/4 → 3/4 → 1/4. If the number is to underpin P3 decisions (polling frequency, economics, retries), run it many times more and under varied load rather than lean on N=3 (the reviewer's remark on PR #17).

Separately, outside this script, **continuity through `--resume`** was checked: a first headless run "remember forty-two" → a second run in a separate process "which number?" → `42`. The context survives the end of the process — which is what replacing a live watch rests on.

## The consequence for the execution model

If waking an agent = starting `claude -p` on non-empty mail, then **a whole layer disappears**: the tmux session, the live `wait-for-mail`, `/wake`, the keeper-as-alarm-clock. And with it a class of bugs, "the session is alive ≠ the agent sees mail" (pain 5, thread 008): in the "waking = a new process" model it does not exist.

## Economics (the answer to item 6 of the statement of work)

A real cycle (reading the thread, writing the answer, rebuild, commit, push): **~$0.32 per cycle**, ~30 s, ~6k output tokens, ~283k cache reads. This is an order of magnitude, not a precise estimate: a trivial `PONG` cost $0.068, a real reading was ~5 times more expensive. With frequent wake-ups this is a cost line, and by P3 an estimate of the polling frequency and a decision on subscription-vs-API-key are needed.

## Three defects of the bench — and why that is the main finding

The first runs produced 4/4, then 3/4, then 1/4. The temptation was to write it off as "the agent is non-deterministic". **Not one of the three failures was in the agent — all three were in the harness:**

1. **A silent copy of `rebuild-index.sh`** (`cp … 2>/dev/null || …`): in one of the versions the path did not resolve, the script never made it into the sandbox, the agent saw an empty `bin/` and improvised (editing INDEX by hand — sometimes successfully). The failure would have been blamed on the agent. Fix: an explicit lookup plus a loud crash.
2. **A non-numeric name for the test thread** (`T01-spike`): the generator takes only `[0-9][0-9][0-9]-*` and silently ignored the thread — `waiting-on` came out empty. Fix: `900-spike`.
3. **The PATH dependency of `claude`**: a bare call by name gave `exit 127` in a sub-shell without the nvm bin directory. Fix: an explicit resolution of the binary plus a loud crash before the cycle.

The lesson is exactly the one that motivates the whole package (pains 1–6): **a command that silently depends on the environment produces a result indistinguishable from a defect in the thing under test.** Three times in a row on one spike is not a coincidence but the systemic reason `agent-protocol` exists. And the rule that follows from it for the package itself: **do not confuse a defect of the harness with a defect of the thing under test — check the bench with a fact first.**

## What this does NOT prove

- That headless is reliable under load or in parallel — the runs were sequential, one at a time.
- That the agent's free text always lands in the format — on the contrary, the spike showed that it does NOT always (the agent improvised around a broken bench). This is a direct argument for P2 (operations over threads as an API with validation rather than gluing markdown together): the agent should call a command instead of reproducing the format from memory.
- Cursor headless was not checked (a door, not an implementation).
