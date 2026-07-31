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
export const USAGE = `usage (--ref is required everywhere except 'schema migrate', 'doctor', 'init' and the operator's five below; --repo defaults to the repository of the current directory):
  agent-protocol config check --ref <ref> [--repo <path>] [--config-path <p>] [--no-fetch]
  agent-protocol doctor       [--ref <ref>] [--repo <p>] [--local-config <p>] [--offline] [--probe-timeout <sec>]
                              # IS THIS BOX COMMISSIONED (thread 019, the operator tail): the
                              # checklist of a machine that is supposed to raise roles unattended —
                              # both configs, which instance it is, the agent binary AND A LIVE
                              # HEADLESS RUN of it, git (origin, fetch, write access by a dry-run
                              # push of a ref the remote has never seen), the mail checkout and
                              # its freshness. Ends in one line: green, or the rows that failed
                              # it REACHES THE NETWORK and SPENDS ONE AGENT CALL, which is the
                              # point — those facts are in no file. --offline leaves them unasked
                              # and says so in the rows, never passes them
                              # --ref may be left out (the operator's set): 'orchestrator.ref'
  agent-protocol init         [--ref <ref>] [--repo <p>] [--local-config <p>] [--instance <id>] [--agent <kind>] [--exec <path>] [--operator <role>] [--secrets <path>] [--no-doctor] [--offline] [--write]
                              # COMMISSIONING A BOX, the other half of 'doctor' (thread 019): the
                              # machine config (R14) assembled from flags and from what this box
                              # already knows — the agent binary is FOUND on PATH, not typed — the
                              # mail worktree created WITH A FETCH (one made without it reads as
                              # 'never pulled' in every frame afterwards), and then 'doctor' is run:
                              # the commissioning ends in the checklist, not in a belief
                              # WITHOUT --write it decides and prints and DOES none of it; with it,
                              # it does it. One effect survives the plan and the summary line names
                              # it: on a box with no mail checkout yet, reading whether the instance
                              # id is already published FETCHES the mail branch ('origin/<branch>'
                              # moves, nothing else) — that read is why the warning about a taken id
                              # reaches you BEFORE you take it. --offline declines it and says so
                              # It never guesses an identity (--instance is refused, not
                              # invented: a guess raises another box's role), never writes the
                              # secrets file (only where it lies), never overwrites silently — a
                              # declared value and a new one are printed as a change, both sides
                              # --no-doctor: stop after writing (for a box with no network yet)
                              # --ref may be left out (the operator's set): 'orchestrator.ref'
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
                              # guard 2 reads 'statusCheckRollup' — a token without 'checks: read'
                              # (and 'actions: read', asked for inside it) is refused the whole call;
                              # the command PRINTS what gh answered and only guesses at the scope
                              # and it judges the LAST attempt of each check name, by time — a rerun
                              # replaces the run it reran, both of which hang on the same head
                              # guard 1 judges the LAST verdict of each reviewer on that head, by
                              # 'submittedAt': a second round ending in approve is an approve, and an
                              # approve overtaken by a later changes-requested still STOPS; a verdict
                              # with NO author is its own group — anonymous ones never overtake
                              # a verdict OLDER THAN THE HEAD COMMIT is not an answer about it: a
                              # review submitted with no commit of its own (a 'workflow_dispatch' run
                              # of the review) is shown against the CURRENT head, so such an approve
                              # would follow the branch forever; it STOPS, and says so in its own
                              # words: what is missing is a run on the 'pull_request' event
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
  agent-protocol tasks list   --root <mail> --ref <ref> [--status <s>] [--json]
                              # THE BOARD FOR MACHINES (thread 021): the same model as
                              # 'TASKS.md', computed FROM THE THREADS — a consumer parsing the
                              # derived file would answer "what is being done now" with yesterday
  agent-protocol metrics      --ref <ref> [--root <mail>] [--journal <p>] [--sessions <d>] [--since <ts>] [--role <id>] [--thread <id>] [--json]
                              # WHAT THE CIRCUIT BURNED (thread 029), folded out of the box's
                              # own journal — the network is not touched and nothing goes into git
                              # currency and tokens are TWO COLUMNS: a run killed before its
                              # 'result' line has no ledger, and the stream's per-message 'usage'
                              # does not reconstruct one, so those runs are reported as runs +
                              # break class + steps + wall clock, and say so out loud
                              # every boundary of the data is a ROW: the start of the 'pr:' anchor,
                              # the start of the stream era, and 'no usage block after the era began'
                              # — which is PRINTED and never called a loss, because a daemon runs
                              # the code it started with and that window reopens at every merge
  agent-protocol mail         --ref <ref> --role <id> [--root <mail>]
                              # --root defaults to the mail of THIS MACHINE (R26): the state
                              # directory and the mail root hang off the main checkout, so the
                              # command finds them from a role's workspace as well
  agent-protocol await-input  --root <mail> --ref <ref> --role <id> --thread <id> [--timeout <sec>] [--poll <sec>]
                              # THE INTERACTIVE TURN (R19): blocks until the thread waits on the role again
                              # needs a wait declared beside the question ('new-message --await-input') — it does not declare one
                              # code 0: the answer arrived · code 3: the wait ran out (wrap up and pass the turn)
  agent-protocol notify       --ref <ref> [--repo <p>] [--root <mail>] [--state <p>] [--env-file <p>] [--local-config <p>] [--write]
                              # a thread PARKED on a human rings with NO age threshold and carries
                              # its question — the first line of the parking message (023): the age
                              # answers nothing about a turn that cannot move, and a call that names
                              # a thread but not the question reads as 'the circuit is working'
                              # the turn has passed to a HUMAN: whom is derived from wake.mode,
                              # the words come from notifications.templates, delivery from the transport plugin
                              # without --write: prints what it would send and leaves the state alone
                              # only what the transport CONFIRMED is marked announced (029): a failed
                              # delivery is a NON-ZERO exit with the state untouched, so it rings again
  agent-protocol new-message  --root <mail> --ref <ref> --thread <id> --from <role> --expects <e> [--waiting-on <role>] --worker <w> [--session <id>] --body-file <p> [--await-input] [--model <m>] [--effort <e>] [--priority <p>] [--parked-on <person|pr:N>] [--merged-pr <n>] [--task <d>]... [--write] [--no-push]
                              # THE WRITING HALF (R3): --write means SENT — the commit and the push happen inside,
                              # with a replanning retry when somebody wrote into the feed first
                              # --no-push: write the file only (for a caller that owns its own git, e.g. CI)
                              # --await-input: this question PARKS the run instead of ending it (R19) — the session
                              # stays alive and reads the answer itself; block on 'await-input' after sending
                              # --model/--effort: WITH WHAT the runs of this thread are raised from here on (R21) —
                              # only from a role holding 'launch-params'; the value is checked against the tool here
                              # --task '<NNN.k> <open|in-progress|done|dropped>[ · tail]': REPEATABLE —
                              # declares or moves a task (thread 021); the board 'TASKS.md' is derived from these.
                              # a title is required on 'open', a FACT on 'done'/'dropped'; opening and dropping
                              # need 'task-declare', passing one through does not; opening only under this thread's id
                              # --priority high|normal|low: WHICH waiting thread is raised FIRST from here on (R5) —
                              # only from a role holding 'thread-priority'; the queue is priority, then age of wait, then number
                              # --parked-on <person>: the turn STAYS here and is FROZEN until that person decides
                              # (R27) — the pair is not raised and spends nothing; it lifts by itself on the
                              # next message from a PARTICIPANT (the circuit's own announcements,
                              # 'worker: gh-action', are not one — 023). Only a role the circuit cannot wake ('wake.mode: self')
                              # REFUSED together with '--expects none' (034): an informational message
                              # asks nobody for anything, and a park says the thread waits for a person
                              # --parked-on pr:<n>: the OTHER thing a turn is frozen behind (023) — a
                              # MERGE, not a person. Nobody is called about it (the decision is made,
                              # what is left is a button), and it lifts on the notifier's '--merged-pr'
                              # --merged-pr <n>: this message announces that PR as landed — every thread
                              # parked on 'pr:<n>' lifts on it, though the announcement is informational
                              # ANYWHERE IN THE MAIL (023): the notifier writes into the thread named in
                              # the PR's description, which is not the thread parked on it — the readers
                              # judge a park against the merges of the WHOLE mail, not of its own feed
  agent-protocol new-thread   --root <mail> --ref <ref> --id <NNN-slug> --title <t> --participants <r,r> --from <role> --expects <e> [--waiting-on <role>] --worker <w> [--session <id>] --body-file <p> [--write] [--no-push]
                              # THE OTHER WRITING DOOR (R3): --write means SENT here too — '_meta.md' and the
                              # first message go in ONE commit, pushed, with the same replanning retry
                              # the NNN is REFUSED if a thread already holds it (029): the number is a
                              # short address; nothing is renamed after the fact, the door is what changes
                              # --worker: what wrote it, REQUIRED on a write; --session: the id of the run, optional
                              # a raised session passes neither — the launch environment carries both
                              # --no-push: write the files only (for a caller that owns its own git, e.g. CI)

WHICH '--write' DELIVERS (thread 033). Two commands SEND — 'new-message' and 'new-thread':
the file, the commit and the push are one action. Everything else writes and stops, and
each for a stated reason:
  · 'index build', 'thread build', 'derive' — DERIVED files, committed by the generator
    workflow ('chore(comms): rebuild derived') on the push that produced them;
  · 'migrate', 'schema migrate' — bulk rewrites read by a human before they are committed
    (the config half goes through a PR by rule);
  · 'orchestrator record/enable/disable/hold/stop' and the state of 'notify' — machine-local
    operational state under 'orchestrator.state', outside git by construction: there is
    nothing to deliver, and 'notify' delivers through its transport, not through a commit;
  · 'init' — the machine config of THIS BOX and its mail worktree: machine-local by
    the same reason as the state above, and the word means what it means for
    'orchestrator run' — not "write the file" but "do it". Without it the command
    decides, prints the plan and DOES none of it — except the one read its own block
    above names: on a box with no mail checkout yet, asking whether the instance id is
    already published FETCHES the mail branch ('origin/<branch>' moves on this disk,
    nothing else does), and the summary line says so; '--offline' declines the read;
  · 'orchestrator systemd install' — the unit FILE of this box, written under the
    operator's systemd directory: there is nothing to deliver and nothing to enable
    either. The two commands that would ('systemctl --user enable', 'loginctl
    enable-linger') are PRINTED for a human to run, because they are the human's;
  · 'orchestrator run' — machine-local by the same reason, but the word means something else
    there: '--write' is not 'write the file', it is 'do it'. Without it the command prints
    the plan and touches nothing (not the workdir, not its lock, not the journal); with it
    the workdir is put on the base and locked, the events are appended, the agent is raised.

ORCHESTRATOR: the paths (journal, flags, holds, mail root) are taken FROM THE
CONFIG, section 'orchestrator'. The path flags below are an override for checks
and are not needed in operation; only --ref is required.
The agent BINARIES come from the machine config (~/.config/agent-protocol/local.json,
or --local-config <p>): the repository says WHAT is raised, the machine says WHERE it is.
THE OPERATOR'S FIVE (thread 019): the same circuit without the ceremony — the daemon
in the background with one command, the parking with one word, the picture without a
ref. --ref may be left out in these five (up/down/hold/resume/status) and in the two
commissioning commands above ('doctor' and 'init'), and nowhere else: it is taken from
'orchestrator.ref' of the config in the working tree, and which ref was used is printed.
The strict forms below keep every flag they had.
  agent-protocol orchestrator up     [--ref <ref>] [--repo <p>] [--daemon-log <p>] [--log-max-bytes <n>] [--pid-file <p>] [--foreground] [--clear-force]   # plus every 'daemon' flag
                              # THE LOG IS BOUNDED AND ITS EPOCHS ARE LEGIBLE: every start puts
                              # a banner line into the daemon log, and a log over --log-max-bytes
                              # (8 MB by default) is rotated to '<log>.1' — one generation, so the
                              # footprint is bounded by construction rather than by a cron job
                              # --foreground: the daemon runs AS THIS PROCESS instead of being
                              # backgrounded — what a systemd unit has to be given (it supervises
                              # the process it started). The stream goes to stdout/stderr AND to
                              # the daemon log, so 'journalctl' and 'orchestrator log' agree
                              # under a unit a force flag on the floor is refused CLEANLY (exit
                              # 0): the flag is doing its job, and 'Restart=on-failure' must not
                              # fight it — in a terminal the same refusal keeps its code 2
                              # a force flag on the floor REFUSES the start, by name and
                              # reason: a daemon raised over it exits on its first tick and
                              # says so only in its log. --clear-force removes it deliberately
  agent-protocol orchestrator down   [--ref <ref>] [--repo <p>] [--stop-flag <p>] [--pid-file <p>]
  agent-protocol orchestrator restart [--ref <ref>] [--repo <p>] [--pull] [--wait <sec>] [--pid-file <p>] [--daemon-log <p>] [--mode <m>] [--thread <slug>] [--reason <why>] [--by <who>]   # plus every 'daemon' flag
                              # PICKING UP FRESH CODE AS ONE GESTURE: down, wait out the
                              # live sessions, (--pull: git pull --ff-only + pnpm install),
                              # up again WITH THE FLAGS OF THE DAEMON THAT WAS STOPPED —
                              # read from beside its pid, never retyped from memory
                              # --mode force: the force stop's own semantics (the trace to
                              # --thread signed by --by goes FIRST), then both flags are
                              # cleared without hands and the daemon comes back up
                              # the process waits itself and prints the phases; a wait that
                              # runs out, a failed pull or install raises NOTHING and says so
  agent-protocol orchestrator hold   <role> [--by <who>] [--ttl <sec>] [--note <t>] [--ref <ref>] [--now <iso>] [--holds <d>] [--local-config <p>]
  agent-protocol orchestrator resume <role> [--ref <ref>] [--holds <d>]
                              # the short forms ACT (no --write): typing them IS the decision
                              # --by: the flag, then 'operator' of the machine config (who sits
                              # at this box), then $USER; the value must be a role of the config
  agent-protocol orchestrator preflight --ref <ref> [--repo <p>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>]
  agent-protocol orchestrator enable  --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator disable --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator status [--ref <ref>] [--now <iso>] [--mode-file <path>] [--journal <p>] [--holds <d>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--pid-file <p>] [--local-config <p>] [--max-attempts <n>] [--max-runs <n>] [--root <mail>] [--roles <a,b>] [--exclude-roles <a,b>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--watch] [--interval <sec>] [--frames <n>]
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
                              # the config is resolved ONCE at the start (the network is not
                              # touched again), and a failed collection draws the LAST KNOWN
                              # frame under 'frame: unavailable since HH:MM (why)' — the watch
                              # dies of Ctrl+C and of nothing else
                              # --frames <n>: stop after n frames (for checks)
  agent-protocol orchestrator tui    [--ref <ref>] [--interval <sec>] [--journal <p>] [--holds <d>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--pid-file <p>] [--local-config <p>] [--max-attempts <n>] [--max-runs <n>] [--root <mail>] [--roles <a,b>] [--exclude-roles <a,b>] [--now <iso>] [--mode-file <path>]
                              # THE OBSERVER (T-1): the SAME frame as a screen — pairs on top,
                              # the circuit in the middle, the selected session's transcript below
                              # five keys READ: arrows pick the pair, tab switches .log/.supervisor,
                              # 'l' overlays the journal, 'r' collects now, 'q' leaves
                              # THREE ACT (T-2), and each is an existing command, run as a child of
                              # this CLI and ECHOED into the status line as the words you would type:
                              # 'h' parks/unparks the selected pair's role ('hold'/'resume'), 's'
                              # stops the daemon ('down'), 'u' raises it ('up'). 's' and 'u' need a
                              # SECOND press — any other key cancels; 'h' acts at once, being cheap
                              # and undone in one word. A key with nothing to do (no daemon for 's',
                              # a live one for 'u') refuses in the status line and names the other key
                              # a PASTE EXECUTES NOTHING: everything between the bracketed-paste
                              # markers is dropped, so a pasted block holding a 'q' does not close it
                              # it needs a real terminal and REFUSES in words without one — for a
                              # dumb terminal, a tmux pane or 'tee' the answer is 'status --watch'
                              # it takes the alt-screen and gives it back: the scrollback is untouched
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
                              # THE TRACE IS DELIVERED FIRST (committed and pushed), the flag
                              # second: with the flag first the force killed the delivery and
                              # the only explanation of the interruption stayed on one disk.
                              # An undeliverable trace is written into the checkout and said
                              # out loud — the stop still happens, silently it does not
  agent-protocol orchestrator systemd-unit --exec-start <cmd> [--working-dir <dir>] [--description <d>]
  agent-protocol orchestrator systemd install [--ref <ref>] [--repo <p>] [--unit-name <n>] [--unit-dir <d>] [--description <t>] [--daemon-args <a>] [--write]
                              # THE DAEMON AS A RESIDENT UNIT: the file is GENERATED from this
                              # box (the repo, this interpreter, the CLI path) — a unit typed
                              # per box is the first path to go stale. Without --write it prints
                              # the unit and the path it would write and touches nothing
                              # user-level + linger, NOT root: the sessions read the operator's
                              # machine config (R14) and credentials — 'systemctl --user enable'
                              # and 'loginctl enable-linger' stay HUMAN actions, as they were
                              # --daemon-args '<a b c>': the daemon's own flags, baked into ExecStart`;
