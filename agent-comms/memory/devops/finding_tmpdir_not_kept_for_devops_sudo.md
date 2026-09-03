---
name: finding-tmpdir-not-kept-for-devops-sudo
description: "RUN_TMPDIR_ENV (TMPDIR, thread 056's own per-run mechanism) is silently stripped for every aco-devops session because it is not in the sudoers env_keep list documented in box-setup.md §0.1a — measured live, not inferred."
metadata: 
  node_type: memory
  type: project
  modified: 2026-09-03T02:11:13.680Z
  originSessionId: 2f35ab09-0435-4b8d-b49d-c7fd21531332
---

**Live measurement, thread `056-shared-tmp-mechanism`, session `2026-09-03T02-06-15Z-devops`.**
`env | grep -i tmp` inside this very devops session showed `TMPDIR=` (unset), while the
supervisor's own log line for this run says it handed `/tmp/aco-c2b1878de8fe` (an alias into
`.orchestrator/sessions/<run>.tmp`, thread `070`'s short-alias mechanism). The value never
arrived — confirmed empirically, not by reading code alone.

**Why.** `docs/box-setup.md` §0.1a's `env_keep` line (`/etc/sudoers.d/aco-devops-spawn`) lists
exactly `AGENT_PROTOCOL_WORKER AGENT_PROTOCOL_SESSION_FILE AGENT_PROTOCOL_WAIT_SECONDS
AGENT_PROTOCOL_LEASE_DEADLINE CLAUDE_CONFIG_DIR` — all five of which DID cross into this session's
env, confirming `env_keep` itself works as designed. `TMPDIR` (`RUN_TMPDIR_ENV`) is not on that
list, and per dev-core's own decision in thread `056` (PR #172) it was deliberately kept OUT of
`LAUNCH_ENV` (the contract `env_keep` is scoped to) so the package's own sandbox tests would not
strip it. That correct-for-`LAUNCH_ENV` reasoning has a side effect nobody had stated as measured
fact before: **every `aco-devops` session — spawned via `sudo -u`, which resets the environment by
default — loses `TMPDIR` entirely**, unlike every role spawned directly as `lle`. `sudo`'s
`env_reset` is the mechanism (`man 5 sudoers`), same class already named in box-setup.md §0.1a as
"NOT yet verified" for env_keep in general; this is the specific, now-measured consequence for the
one variable that thread `056` exists to protect.

**Consequence for thread `056`.** Variant 1 (`TMPDIR` per run, #172) — the mechanism the whole
thread is about — does not protect `devops` role sessions at all. Any command in a `devops` session
that relies on `mktemp`/`node`/`python` honoring `TMPDIR` falls back to the shared `/tmp`, silently,
every single run — this is a NEW instance of the exact class thread `056` measures (a role writing
into a shared place without meaning to), specific to this one role's launch path, not covered by
stage 1 (#200, supervisor-side visibility) or stage 2/3 discussion so far. Stage 1 itself is
unaffected — it runs in the supervisor's own process (as `lle`), not the child, so it still sees
whatever the `devops` session writes into the shared temp or `$HOME`.

**Who fixes it, and how — not done, needs a decision.** Two shapes on the table, neither taken:
(a) add `TMPDIR` (and generally `RUN_TMPDIR_ENV`) to the `env_keep` line in
`/etc/sudoers.d/aco-devops-spawn` — a `john`-hand change to the box, same class as the rest of
§0.1a; (b) treat this as input to the thread `056` decision on shared-place hardening generally
(the ladder in curator's `2026-09-02T14-32-59Z` message), since it's a *devops-specific* gap in
variant 1's coverage, not a new idea outside that thread's scope. **Could not deliver this to
thread `056` itself** — see [[gap-no-git-credentials]], the mail channel has no working write path
for `aco-devops` right now. Left here so the next session (or a human reading this transcript) has
it without re-deriving.
