/**
 * THE HELP TEXT, AND THE ONE PLACE THE SYNTAX IS WRITTEN DOWN.
 *
 * It lives in its own module for a reason that is not tidiness. Since thread 019 the
 * argument check of the orchestrator commands READS this text as its table of legal
 * flags (`orchestrator/argv.ts`), so a usage line that has fallen behind the code is
 * no longer a documentation defect — it REFUSES a call that used to work. That is
 * precisely what happened to `orchestrator status` and `orchestrator preflight`,
 * whose lines had been missing flags their handlers read since long before the guard
 * existed and made the silence expensive.
 *
 * A test can only catch that drift if it reads the SAME string the CLI shows, and
 * `cli.ts` calls `main()` at import time — importing it from a test would start the
 * program. Hence this module: the text is importable without the entry point coming
 * along with it (`usage.test.ts` is what reads it).
 */
export const USAGE = `usage (--ref is required everywhere except the four operator commands below; --repo defaults to the repository of the current directory):
  agent-protocol config check --ref <ref> [--repo <path>] [--config-path <p>] [--no-fetch]
  agent-protocol roles list   --ref <ref> [--repo <path>]
  agent-protocol schema migrate [--repo <path>] [--config-path <p>] [--root <mail>] [--to <n>] [--write]
                              # the ONE command with no --ref: it plans against the working tree it rewrites
  agent-protocol role exists  --ref <ref> --role <id> [--repo <path>]
  agent-protocol zones check  --ref <ref> [--repo <path>] (--role <id> | --role-from-workspace)
                              (--staged | --base <ref> | --paths <a,b>)
                              # ZONES WITH AN ENFORCER (thread 020): the changed paths against the
                              # role's 'zones.forbidden' — the pre-commit hook of a role workspace
                              # (--staged --role-from-workspace) and the CI step of a PR (--base)
                              # a checkout that is not a role workspace passes with a note, not a refusal
  agent-protocol merge-gate   --ref <ref> --pr <n> [--repo <path>] [--power-docs <a,b>] [--working-cards <a,b>]
                              # THE MERGE DOOR OF 'curator' (thread 026): the three guards that are
                              # FACTS — approve on the CURRENT head, green checks on it, and no
                              # document of power in the diff (the role cards and the config are
                              # DERIVED; --power-docs adds this project's own, e.g. PROTOCOL.md)
                              # --working-cards: instruction paths that are NOT documents of power
                              # (CLAUDE.md — a working card rides with the code, john 2026-07-28);
                              # subtracted from the DERIVED side only, and always printed
                              # guards 3 and 5 (a decision of john's behind the thread, a trace after
                              # the merge) are judgements and are printed as obligations, never as a pass
                              # guard 2 reads 'statusCheckRollup': the token needs the 'checks' scope
                              # and it judges the LAST attempt of each check name, by time — a rerun
                              # replaces the run it reran, both of which hang on the same head
                              # 'mergeable' is read too and printed BESIDE the guards, not as a sixth:
                              # the door refuses what GitHub itself would refuse, UNKNOWN included
                              # exit 0: nothing in the facts forbids it · exit 1: a guard does not hold
  agent-protocol index build  --root <mail> --ref <ref> [--write]
  agent-protocol thread show  --root <mail> --ref <ref> --thread <NNN-slug> [--tail <n>]
                              # THE READING HALF OF THE AGENT'S INTERFACE (R3): the conversation, in order,
                              # from the MESSAGES (not from the derived _thread.md, which lags a push behind)
  agent-protocol thread build --root <mail> --ref <ref> --id <NNN-slug> [--write]
  agent-protocol check        --root <mail> --ref <ref> [--since <ref>]
                              # also validates '_instances/' as a CLASS of derived state files (R13):
                              # the one MUTABLE derived thing in an append-only branch, so it is known
                              # by name rather than met as a stray path
  agent-protocol migrate      --root <mail> --ref <ref> [--id <NNN-slug>] [--write]
  agent-protocol derive       --root <mail> --ref <ref> [--write]
  agent-protocol mail         --ref <ref> --role <id> [--root <mail>]
                              # --root defaults to the mail of THIS MACHINE (R26): the state
                              # directory and the mail root hang off the main checkout, so the
                              # command finds them from a role's workspace as well
  agent-protocol await-input  --root <mail> --ref <ref> --role <id> --thread <id> [--timeout <sec>] [--poll <sec>]
                              # THE INTERACTIVE TURN (R19): blocks until the thread waits on the role again
                              # needs a wait declared beside the question ('new-message --await-input') — it does not declare one
                              # code 0: the answer arrived · code 3: the wait ran out (wrap up and pass the turn)
  agent-protocol notify       --ref <ref> [--repo <p>] [--root <mail>] [--state <p>] [--env-file <p>] [--local-config <p>] [--write]
                              # the turn has passed to a HUMAN: whom is derived from wake.mode,
                              # the words come from notifications.templates, delivery from the transport plugin
                              # without --write: prints what it would send and leaves the state alone
                              # only what the transport CONFIRMED is marked announced (029): a failed
                              # delivery is a NON-ZERO exit with the state untouched, so it rings again
  agent-protocol new-message  --root <mail> --ref <ref> --thread <id> --from <role> --expects <e> [--waiting-on <role>] --worker <w> [--session <id>] --body-file <p> [--await-input] [--model <m>] [--effort <e>] [--priority <p>] [--parked-on <person>] [--write] [--no-push]
                              # THE WRITING HALF (R3): --write means SENT — the commit and the push happen inside,
                              # with a replanning retry when somebody wrote into the feed first
                              # --no-push: write the file only (for a caller that owns its own git, e.g. CI)
                              # --await-input: this question PARKS the run instead of ending it (R19) — the session
                              # stays alive and reads the answer itself; block on 'await-input' after sending
                              # --model/--effort: WITH WHAT the runs of this thread are raised from here on (R21) —
                              # only from a role holding 'launch-params'; the value is checked against the tool here
                              # --priority high|normal|low: WHICH waiting thread is raised FIRST from here on (R5) —
                              # only from a role holding 'thread-priority'; the queue is priority, then age of wait, then number
                              # --parked-on <person>: the turn STAYS here and is FROZEN until that person decides
                              # (R27) — the pair is not raised and spends nothing; it lifts by itself with the next
                              # substantive message. Only a role the circuit cannot wake ('wake.mode: self')
  agent-protocol new-thread   --root <mail> --ref <ref> --id <NNN-slug> --title <t> --participants <r,r> --from <role> --expects <e> [--waiting-on <role>] --worker <w> [--session <id>] --body-file <p> [--write]
                              # the NNN is REFUSED if a thread already holds it (029): the number is a
                              # short address; nothing is renamed after the fact, the door is what changes
                              # --worker: what wrote it, REQUIRED on a write; --session: the id of the run, optional
                              # a raised session passes neither — the launch environment carries both

ORCHESTRATOR: the paths (journal, flags, holds, mail root) are taken FROM THE
CONFIG, section 'orchestrator'. The path flags below are an override for checks
and are not needed in operation; only --ref is required.
The agent BINARIES come from the machine config (~/.config/agent-protocol/local.json,
or --local-config <p>): the repository says WHAT is raised, the machine says WHERE it is.
THE OPERATOR'S FOUR (thread 019): the same circuit without the ceremony — the daemon
in the background with one command, the parking with one word. --ref may be left out
HERE ONLY: it is taken from 'orchestrator.ref' of the config in the working tree, and
which ref was used is printed. The strict forms below keep every flag they had.
  agent-protocol orchestrator up     [--ref <ref>] [--repo <p>] [--daemon-log <p>] [--pid-file <p>]   # plus every 'daemon' flag
  agent-protocol orchestrator down   [--ref <ref>] [--repo <p>] [--stop-flag <p>] [--pid-file <p>]
  agent-protocol orchestrator hold   <role> [--by <who>] [--ttl <sec>] [--note <t>] [--ref <ref>] [--now <iso>] [--holds <d>]
  agent-protocol orchestrator resume <role> [--ref <ref>] [--holds <d>]
                              # the short forms ACT (no --write): typing them IS the decision
                              # --by defaults to $USER and must be a role of the config
  agent-protocol orchestrator preflight --ref <ref> [--repo <p>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>]
  agent-protocol orchestrator enable  --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator disable --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator status --ref <ref> [--now <iso>] [--mode-file <path>] [--journal <p>] [--holds <d>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--pid-file <p>] [--local-config <p>] [--max-attempts <n>] [--max-runs <n>] [--root <mail>] [--roles <a,b>] [--exclude-roles <a,b>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--watch] [--interval <sec>] [--frames <n>]
                              # it SHOWS what the daemon would do, so it reads the same
                              # answers the daemon reads: the ceilings, the scope of roles,
                              # the mail root and the agent resolution ('launch resolution')
                              # THE LIVE FRAME first (T-0): leases, holds, the circuit
                              # (gate, stop/force flags, whether a daemon is alive), the CLOSED
                              # rate-limit windows with the time each reopens, the queue
                              # with the reason for its order, the neighbours' digests, and how
                              # old the mail on disk is; then the static sections
                              # --watch: THE SAME FRAME, redrawn every --interval seconds (2 by
                              # default) — for a dumb terminal, a tmux pane or a pipe into tee;
                              # it READS ONLY: no fetch, nothing repaired, the age is shown instead
                              # --frames <n>: stop after n frames (for checks)
  agent-protocol orchestrator record --ref <ref> --kind <k> --role <id> --thread <slug> [--deadline <iso>] [--reason <r>] [--mode <m>] [--now <iso>] [--journal <p>] [--write]
  agent-protocol orchestrator run    --ref <ref> --role <id> --thread <slug> [--repo <p>] [--wall-clock <sec>] [--idle <sec>] [--wait-input <sec>] [--wind-down <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--max-attempts <n>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>] [--journal <p>] [--root <mail>] [--force-flag <p>] [--now <iso>] [--roles <a,b>] [--exclude-roles <a,b>] [--fresh] [--write] [-d|--detach]
                              # attached by default: you watch what you raised. -d puts the supervisor in the background
                              # ceilings: the flag wins over the role's launch.limits, which wins over the package default
                              # tool/model/effort: the flag wins over the role's launch.agent; the binary: the flag, then the machine config
                              # the role works in its own worktree (orchestrator.workdir.worktrees), put at the base per package
                              # --fresh: never resume the previous session, whatever the continuation policy says
                              # --wait-input: the ceiling of a DECLARED wait for input (R19); waiting does not eat the wall clock
                              # --wind-down: how long before the deadline the session is asked to land its work (R20); default 20% of the window, 2-15 min
                              # --roles/--exclude-roles: the same scope door as the daemon's (R13) — a --role
                              # owned by another instance, or left out by these flags, is REFUSED here, not raised
  agent-protocol orchestrator daemon --ref <ref> [--repo <p>] [--tick <sec>] [--wall-clock <sec>] [--idle <sec>] [--wait-input <sec>] [--wind-down <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--max-attempts <n>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>] [--fresh] [--once] [--journal <p>] [--root <mail>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--holds <d>] [--roles <a,b>] [--exclude-roles <a,b>]
                              # --roles/--exclude-roles: WHICH roles THIS run raises (R13), mutually exclusive;
                              # on top of the instance filter — a role owned by another box is never raised here
  agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> --by <who> [--ttl <sec>] [--note <t>] [--now <iso>] [--holds <d>] [--write]
  agent-protocol orchestrator hold   --mode release --ref <ref> --role <id> [--holds <d>] [--write]
  agent-protocol orchestrator log    --ref <ref> [--journal <p>]
  agent-protocol orchestrator stop   --mode graceful --ref <ref> [--stop-flag <p>] [--write]
  agent-protocol orchestrator stop   --mode force --ref <ref> --by <who> --reason <why> --thread <slug> [--repo <p>] [--force-flag <p>] [--root <mail>] [--write]
  agent-protocol orchestrator systemd-unit --exec-start <cmd> [--working-dir <dir>] [--description <d>]`;
