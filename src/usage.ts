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
export const USAGE = `usage (--ref is required everywhere except 'schema migrate', 'doctor', 'init', 'config set' and the operator's five below; --repo defaults to the repository of the current directory):
  agent-protocol config check --ref <ref> [--repo <path>] [--config-path <p>] [--no-fetch]
  agent-protocol config set   <key> <value> [--exec <path>] [--config-dir <path>] [--ref <ref>] [--local-config <p>] [--instance <name>] [--write]
                              # ONE FACT OF THE MACHINE CONFIG, CHANGED (thread 019): the
                              # commissioned box whose agent binary moved, whose operator is
                              # somebody else now, whose secrets file was moved off /root —
                              # without opening the JSON by hand
                              # <key>: 'instance <id>', 'operator <role>', 'secrets <path>',
                              # 'agent <kind> --exec <path>', 'account <id> --config-dir <path>'.
                              # A POLICY key ('roles', 'limits', 'instances', …) is refused BY
                              # THE RULE, not as a typo: it lives in the repository config,
                              # behind a PR — and so does WHICH ROLE sits on which account
                              # ('launch.account'); this key says only WHERE that account's
                              # directory is on this disk
                              # AN ACCOUNT DIRECTORY THAT IS NOT THERE YET is the ordinary case
                              # and not a refusal (055): the login is what creates it, so the
                              # step prints the command that does, with the path already in it
                              # ('CLAUDE_CONFIG_DIR=<path> claude login'). Whether the token in
                              # it is LIVE is 'doctor's question, per account, and it asks it
                              # THE CHECK RUNS BEFORE THE WRITE, which is the whole of it: the
                              # value is judged in the words 'init' uses (an undeclared instance
                              # is a bench, an operator that is no role signs no hold), and the
                              # RESULT is re-parsed by the strict schema — a file this command
                              # writes cannot be one this package refuses to read afterwards
                              # WITHOUT --write it decides and prints and touches nothing; a
                              # value already there is a 'keep' and is not rewritten even with it
                              # '--instance <name>' and the KEY 'instance <id>' are two different
                              # questions (055): the flag says WHICH FILE is being edited, the key
                              # says what identity that file claims — one picks the box, the other
                              # writes into it
                              # --ref may be left out (the operator's set): 'orchestrator.ref'
  agent-protocol doctor       [--ref <ref>] [--repo <p>] [--local-config <p>] [--instance <name>] [--offline] [--probe-timeout <sec>] [--identity-window <days>] [--identity-all]
                              # IS THIS BOX COMMISSIONED (thread 019, the operator tail): the
                              # checklist of a machine that is supposed to raise roles unattended —
                              # both configs, which instance it is, the agent binary AND A LIVE
                              # HEADLESS RUN of it, git (origin, fetch, write access by a dry-run
                              # push of a ref the remote has never seen), the mail checkout and
                              # its freshness. Ends in one line: green, or the rows that failed
                              # it REACHES THE NETWORK and SPENDS ONE AGENT CALL, which is the
                              # point — those facts are in no file. --offline leaves them unasked
                              # and says so in the rows, never passes them
                              # WHO SIGNED THE COMMITS is asked too, of this disk and for free:
                              # roles sign '<role>@agents.invalid', the machinery
                              # 'orchestrator@agents.invalid', GitHub its own — anything else is
                              # NAMED with its count, and a name inside '@agents.invalid' that
                              # answers to no declared role is a cross, not a note
                              # --identity-window <days>: how far back (7 by default); --identity-all:
                              # the whole history, which is the archaeology rather than the checklist
                              # THE SECOND HALF IS THE CAUSE, not the consequence: what
                              # 'user.email' answers HERE — in the checkout, in the mail
                              # checkout and in each role's workspace — because a fresh box
                              # has signed nothing yet and the history row would call it green
                              # an UNSET key is the cross: git derives '<user>@<hostname>'
                              # silently, and that is where every '@*.local' address came from
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
                              # --instance NAMES THE FILE TOO on a box hosting several projects
                              # (055): the config goes to 'instances/<id>.json' and records the
                              # checkout it serves, which is what lets every later command typed
                              # in that tree find it without naming anything
                              # --ref may be left out (the operator's set): 'orchestrator.ref'
  agent-protocol init github  [--ref <ref>] [--local-config <p>] [--instance <name>] [--key <path>] [--host <h>] [--alias <a>] [--comment <c>] [--no-probe] [--write]
                              # THE BOX'S IDENTITY FOR GITHUB (thread 019, п.4): the one step of
                              # the commissioning that makes material OUTSIDE the repository and
                              # outside both configs — an ed25519 pair in ~/.ssh, a 'Host' block
                              # beside it, and an answer from GitHub about who this box is
                              # --host IS THE GITHUB HOST and --alias IS THE NAME THIS BOX TYPES
                              # (thread 004): 'HostName <host>' is where the name resolves,
                              # 'Host <alias>' is what goes into 'git@<alias>', into the remote of
                              # a checkout and into the probe. --alias defaults to --host, which is
                              # right BY MEANING (with nothing to distinguish, the name you type is
                              # the host) — until 2026-08-18 ONE value wrote both lines, correct on
                              # '--host github.com' and unresolvable on the second identity the flag
                              # exists for ('Could not resolve hostname github-crew', measured)
                              # A --host WITH NO DOT IS REFUSED BY NAME and the refusal names both
                              # exits: '--alias <that>' for a local alias, a full domain for GHES
                              # THE FORM IS DECIDED (john, 2026-08-01): the key goes on the
                              # repository as a DEPLOY KEY with write access. No separate account
                              # and no machine user — a machine user is the answer only when one
                              # box serves several repositories, and it is a line in the doc
                              # IT NEVER OVERWRITES A KEY (hosts that trust it are not known
                              # here — rotation is a human act), never grants itself access (the
                              # public half and the four clicks are PRINTED), and never reads the
                              # probe's EXIT CODE: 'ssh -T git@github.com' exits 1 on a working
                              # key, so the verdict is read from what GitHub SAID — and what it
                              # says names the REPOSITORY a deploy key opens, which is the fact
                              # worth having. An account name where a repository belongs is
                              # reported as a mismatch, not as success
                              # WITHOUT --write it decides and prints and touches nothing —
                              # ~/.ssh included, and GitHub is not asked anything either
                              # --no-probe: stop after the identity is on disk (a box with no
                              # network yet); the summary then says it proves nothing
  agent-protocol roles list   --ref <ref> [--repo <path>]
  agent-protocol schema migrate [--repo <path>] [--config-path <p>] [--root <mail>] [--to <n>] [--write]
                              # the ONE command with no --ref: it plans against the working tree it rewrites
  agent-protocol schema version [--package-ref <ref>] [--package-repo <path>] [--repo <path>] [--ref <ref>]
                              [--config-path <p>]
                              # THE TWO NUMBERS OF A PIN, BEFORE IT MOVES (thread 028): what the package
                              # writes and what the consumer declares, with the verdict between them
                              # --package-ref names the CANDIDATE (a tag): the number is read out of its
                              # source, nothing installed and nothing checked out — 'config check' can only
                              # ask the package that IS installed, which during a bump is the old one
                              # --repo/--ref name the consumer's config; it is read RAW, without the loader,
                              # whose version gate would refuse the very mismatch this command shows
                              # a mismatch exits 0: this is a measurement taken BEFORE the pin moves (the
                              # migration then rides in the same PR as the pin), not a door over somebody
                              # else's repository. Exit 2 means a number could not be READ
  agent-protocol role exists  --ref <ref> --role <id> [--repo <path>]
  agent-protocol zones check  --ref <ref> [--repo <path>] (--role <id> | --role-from-workspace)
                              (--staged | --base <ref> | --paths <a,b> | --paths a b)
                              # --paths takes BOTH forms and judges EVERY path named (thread 033): the
                              # space form used to be read as ONE path and answered green about the rest
                              # ZONES WITH AN ENFORCER (thread 020): the changed paths against the
                              # role's 'zones.forbidden' — the pre-commit hook of a role workspace
                              # (--staged --role-from-workspace) and the CI step of a PR (--base)
                              # a checkout that is not a role workspace passes with a note, not a refusal
                              # 'zones.writes' NARROWS NOTHING and is not read by this command at all:
                              # a path outside 'writes' and outside 'forbidden' is GREEN, and the green
                              # line says so. 'writes' states where the role's work lives, for humans —
                              # reading it as a closed allow-list would deny 'dev-core' (writes: [])
                              # every file in the repository. 'forbidden' is the whole verdict
  agent-protocol merge-gate   --ref <ref> --pr <n> [--repo <path>] [--power-docs <a,b>] [--working-cards <a,b>] [--review-workflow <name>] [--d1 <thread/message.md>]
                              # THE MERGE DOOR OF 'curator' (thread 026): the three guards that are
                              # FACTS — approve on the CURRENT head, green checks on it, and no
                              # document of power in the diff (the role cards and the config are
                              # DERIVED; --power-docs adds this project's own, e.g. PROTOCOL.md)
                              # --working-cards: instruction paths that are NOT documents of power
                              # (CLAUDE.md — a working card rides with the code, john 2026-07-28);
                              # subtracted from the DERIVED side only, and always printed
                              # guards 3 and 5 (a decision of john's behind the thread, a trace after
                              # the merge) are judgements and are printed as obligations, never as a pass
                              # --d1 <NNN-slug/<stamp>-<role>.md>: CLASS Д-1, DECLARED (john's decision
                              # of 2026-08-14, thread 068) — a diff that ONLY encodes a decision john
                              # already took. With it, guard 4 stops being a STOP on the documents of
                              # power and becomes a named obligation of the same kind as guard 3: the
                              # diff is obliged to encode THAT message and nothing else, and the class
                              # and the reference go into the trace. WITHOUT IT THE STOP STANDS, word
                              # for word — that is the other half of the repair: the door printed STOP
                              # on every merge of the class by construction, and a guard that is always
                              # wrong about a class is a guard nobody reads on the day it is right
                              # condition (a) of the class ('the diff adds no new norm') is NOT measured
                              # and no heuristic stands in for it — that is exactly why the state is
                              # 'you ' and never 'ok  '
                              # the FORM of the value is checked, and refused by name with exit 2: a
                              # bare thread ('066-test-gaps') and an ordinal ('msg-003') name no
                              # message — ordinals travel (norm 024), file names do not. The full path
                              # ('agent-comms/NNN-slug/messages/<stamp>-<role>.md') is accepted too;
                              # whether the file EXISTS is not checked (the door has no mail checkout)
                              # a thread in --d1 that differs from the PR's own 'thread:' is NOT a
                              # refusal — a decision is fixed where it was taken; it is printed
                              # a --d1 on a diff that touches NO document of power leaves guard 4 the
                              # pass it was and SAYS the flag changed nothing (never silent either way)
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
                              # --review-workflow <name>: WHICH ROUND PRODUCED THE VERDICT (thread
                              # 027) — GitHub hangs a review on the head the PR has WHEN THE VERDICT
                              # IS SENT, so a round that read an older tree and answered after a push
                              # is credited against a tree it never saw. With the name (the 'name:'
                              # of the reviewer's workflow, e.g. 'Claude PR Review'), the approve is
                              # counted only inside the window of a CLOSED successful round of THAT
                              # workflow on THIS head — otherwise STOP, and the round is named
                              # WITHOUT THE FLAG guard 1 answers 'by-hand', not 'ok': the anchor
                              # could not be measured, so the check is owed by hand. The name is a
                              # fact of the served project and is never guessed here
                              # 'mergeable' is read too and printed BESIDE the guards, not as a sixth:
                              # the door refuses what GitHub itself would refuse, UNKNOWN included
                              # WHAT GUARD 2 DOES NOT ASK, said under it as 'note · base' (023.3): a
                              # 'pull_request' check measures the head MERGED WITH THE BASE OF ITS OWN
                              # MOMENT, and a base that moves afterwards reruns nothing — the green
                              # stays on the head and the guard goes on crediting it. The note dates
                              # the base's head commit against the START of the credited checks and
                              # NEVER changes the verdict or the exit code: that half is john's
                              # the measurement is CONSERVATIVE (the merge-ref a check really read is
                              # not in the API) and assumes squash-only merges, where the commit date
                              # of the base head is the moment it landed — a base move that could not
                              # change the merge is named too, and one line of text is its whole price
                              # silence is earned by ONE state: a base read, dated, and older than
                              # every credited check. No base, no date, no start stamp, nothing green
                              # credited — each is SAID. The base costs a second ask ('gh api
                              # …/commits/<baseRefName>'), whose refusal is a note and not an error
                              # it asks about the BRANCH BY NAME (023.4): the payload's 'baseRefOid'
                              # is the base this branch was CUT from and stands still while the base
                              # moves — dating it made the note a no-op that printed 'current' about
                              # a measurement nobody took, with every guard and every test green
                              # exit 0: nothing in the facts forbids it · exit 1: a guard does not hold
  agent-protocol index build  --root <mail> --ref <ref> [--write]
  agent-protocol thread show  --root <mail> --ref <ref> --thread <NNN-slug> [--id <NNN-slug>] [--tail <n>] [--repo <p>] [--no-fetch]
                              # --repo/--no-fetch: accepted here as everywhere the config is read at a ref,
                              # and left out of this line until 026. --no-fetch reads the ref WITHOUT
                              # updating it — the shape a box with no network needs — and it WARNS that it
                              # did not, which is the whole difference from naming a local branch instead:
                              # a stale thread printed as a fresh one is the failure this half exists against
                              # --id: THE SAME THREAD, THE OTHER SPELLING — accepted since before the
                              # usage line was written and left out of it; named here because the door
                              # reads THIS TEXT as the list of flags (075), so an alias missing from it
                              # would stop being accepted the moment the command got a door
                              # THE READING HALF OF THE AGENT'S INTERFACE (R3): the conversation, in order,
                              # from the MESSAGES (not from the derived _thread.md, which lags a push behind)
                              # A STAMP WRITTEN AS THE FILE NAME WRITES IT ('2026-08-13T17-28-50Z') IS
                              # READ, NOT REFUSED (065, (iv)) — the same moment, other spelling; it is
                              # normalized IN MEMORY and the file keeps every byte. The spelling is
                              # NAMED on stderr, here and by 'derive' and 'check', on green runs too:
                              # the off-canon byte stays in git forever, so the reader is the only
                              # thing that can ever say so. A value that is not that same moment
                              # written differently still refuses the thread, quoting the raw bytes
  agent-protocol thread build --root <mail> --ref <ref> --id <NNN-slug> [--write]
  agent-protocol thread status --root <mail> --ref <ref> --thread <NNN-slug> --from <role> --status <open|closed> [--write]
                              # CLOSING A THREAD IS AN ACCEPTANCE, AND IT NEEDS A DOOR (065.1): the
                              # permission 'thread-status' was declared in the config and checked by
                              # nobody — the only way to close a thread was to edit '_meta.md' by hand,
                              # which a raised session cannot do (the mail is behind two commands, R3).
                              # Threads therefore piled up 'open' while being finished and empty
                              # a role WITHOUT the permission is refused BY NAME, not by silence, and
                              # '_meta.md' is the one authored file of a thread that may be rewritten
                              # (title/participants/status live there; the messages stay append-only)
                              # --write means DELIVERED, as everywhere else: the file, the commit and the
                              # push are one action, and the derived files stay the generator's business
                              # a status ALREADY set is not an error and not an empty commit: it is said
                              # and nothing is written — closing twice is a no-op, not a conflict
                              # AND THE FEED ANSWERS THAT, NOT THE LOCAL DISK (the verdict on #266): a
                              # box that has not seen the other closer's push used to pass the local
                              # check and die on 'git commit' with an empty index — a raw git failure in
                              # the one scenario the no-op was written for. Delivery now reports the
                              # sameness; the local read survives only in the dry run, which says so
  agent-protocol thread status --root <mail> --ref <ref> --thread <NNN-slug> --from <role> --turn <explicit|—> [--write]
                              # MODE (c): THE FORM THIS THREAD REQUIRES OF ITS ANSWERS (079).
                              # 'explicit' — every message in the thread must carry '--waiting-on'
                              # (either a role or '—'); '—' withdraws the declaration. Two states,
                              # no space of values and no per-role variants: a second mode invented
                              # before it is needed would be invented wrong
                              # WHY A DECLARATION AND NOT A PREDICATE: a fieldless answer on a
                              # RECEIVING thread (the notifier writes, the role reads and leaves) and
                              # one on a WORKING thread (the role reads its own CI and carries on) are
                              # byte-identical. Three candidates were counted on the live mail (2875
                              # messages): the narrowest refused 32 messages to catch 3-4 defects.
                              # A thread that declares nothing is not touched by any of this
                              # THE SAME PERMISSION AS THE STATUS ('thread-status'), because the form
                              # of a conversation belongs to whoever owns its closing — and without a
                              # door the key would be reachable only by editing '_meta.md' by hand,
                              # the hole 065.1 closed for the status itself
                              # neither mode requires the other: '--turn' takes no '--status', and a
                              # status flip says nothing about the form. Given together they are refused
  agent-protocol thread status --root <mail> --ref <ref> --thread <NNN-slug> --from <role> --repair [--title <t>] [--write]
                              # MODE (b) OF THE SAME DOOR (065): a thread whose 'messages/' is on disk
                              # and whose '_meta.md' is NOT is unreadable WHOLE — and with it every
                              # statement of work inside (066 stood like that for an afternoon on
                              # 2026-08-13 with six of them, invisible to the queue). The head is
                              # SYNTHESISED from the messages: title from the first thing said in the
                              # earliest one (or --title), participants from their authors, status
                              # always 'open' — closing is an acceptance and a machine does not make one
                              # it REFUSES on a thread that already has a head, under any flag: a repair
                              # never overwrites somebody's title, participants or acceptance
                              # the same permission as the flip ('thread-status'), because it is the
                              # same power over the same file; --repair and --status are two modes and
                              # never one call
                              # WHAT IT DOES NOT FIX AND SAYS SO: a message whose OWN header is broken.
                              # That is another file, and editing a committed message is forbidden by
                              # the norm of the mail — on 066 it was invisible until the head was back
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
  agent-protocol metrics      --ref <ref> [--root <mail>] [--journal <p>] [--sessions <d>] [--metrics-cache <p>] [--no-streams] [--since <ts>] [--role <id>] [--thread <id>] [--json]
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
                              # the runs OLDER than the 'usage' block are priced out of their own
                              # streams LAZILY: one read per stream, remembered in
                              # '.orchestrator/metrics.cache.jsonl' (key: name + size), and the
                              # recovery is its own printed row. '--no-streams' asks the
                              # journal-only question on a box whose sessions/ is slow
  agent-protocol mail         --ref <ref> --role <id> [--root <mail>]
                              # --root defaults to the mail of THIS MACHINE (R26): the state
                              # directory and the mail root hang off the main checkout, so the
                              # command finds them from a role's workspace as well
                              # WHAT IT COULD NOT READ IS NAMED AND COUNTED (065.4): the ids go
                              # to stdout, and an unreadable thread puts on stderr both its own
                              # cause and HOW MANY were lost — the per-thread line existed, the
                              # count did not, and a narrowed selection without one reads like a
                              # complete one (thread 066 held six statements waiting on dev-core
                              # and the queue never saw it, twice on 2026-08-13). The input does
                              # not BREAK on it: the readable threads are still printed, exit 0
  agent-protocol wake         <role> --ref <ref> [--root <mail>] [--as <invocation>] [--repo <p>]
                              # THE ENTRY OF A ROLE, SAID BY THE PACKAGE (thread 087 of the LLE
                              # mail): the text that explains the mail, the watch and the writing
                              # rules must change in the SAME move as the commands it names. Kept
                              # as a copy in the served project it drifted three ways at once — it
                              # pointed at a checkout that box no longer has, named a holder of
                              # merge who had lost it three weeks earlier, and sent the role to
                              # read its input from the DERIVED file on the page where it declares
                              # the opposite. None of the three is inventable here: the values come
                              # from the config and the disk, and the text itself has a unit test
                              # '--as <invocation>': HOW THIS CLI IS TYPED at the consumer ('pnpm -w
                              # protocol', a binary on PATH, 'tsx …/cli.ts'). It is a fact of the
                              # other repository, so it is a flag: a package printing its own form
                              # as the only one would be lying to every box but one
                              # the mail is counted FROM THE THREADS, in queue order, exactly as
                              # 'mail' counts it — and what it could not read it names, so the
                              # entry is never silently narrowed
  agent-protocol await-input  --root <mail> --ref <ref> --role <id> --thread <id> [--timeout <sec>] [--poll <sec>]
                              # THE INTERACTIVE TURN (R19): blocks until the thread waits on the role again
                              # needs a wait declared beside the question ('new-message --await-input') — it does not declare one
                              # code 0: the answer arrived · code 3: the wait ran out (wrap up and pass the turn)
  agent-protocol notify       --ref <ref> [--repo <p>] [--root <mail>] [--state <p>] [--env-file <p>] [--local-config <p>] [--instance <name>] [--write]
                              # a thread PARKED on a human rings with NO age threshold and carries
                              # its question — the first line of the parking message (023): the age
                              # answers nothing about a turn that cannot move, and a call that names
                              # a thread but not the question reads as 'the circuit is working'
                              # and it rings ONCE, on the message that ASKED (051): a park already
                              # announced gets NO line in later digests, and one declared by an
                              # INFORMATIONAL message ('expects: none') gets none at all — the park
                              # still freezes the thread, it just calls nobody. 'ack' DOES call:
                              # the door leaves exactly two legal parks and both need the person
                              # the turn has passed to a HUMAN: whom is derived from wake.mode,
                              # the words come from notifications.templates, delivery from the transport plugin
                              # without --write: prints what it would send and leaves the state alone
                              # only what the transport CONFIRMED is marked announced (029): a failed
                              # delivery is a NON-ZERO exit with the state untouched, so it rings again
  agent-protocol new-message  --root <mail> --ref <ref> --thread <id> --from <role> --expects <e> [--waiting-on <role>] --worker <w> [--session <id>] --body-file <p> [--await-input] [--model <m>] [--effort <e>] [--priority <p>] [--parked-on <person|pr:N|run:N>] [--delivers <person>] [--merged-pr <n>] [--task <d>]... [--write] [--no-push]
                              # THE WRITING HALF (R3): --write means SENT — the commit and the push happen inside,
                              # with a replanning retry when somebody wrote into the feed first
                              # --no-push: write the file only (for a caller that owns its own git, e.g. CI)
                              # ON A THREAD DECLARING 'turn: explicit' (079) --waiting-on is OBLIGATORY:
                              # the door refuses a message without it and names both exits (a role, or '—'
                              # for nobody). On every other thread nothing changes — a fieldless message is
                              # the ordinary middle of a working thread and stays legal
                              # --await-input: this question PARKS the run instead of ending it (R19) — the session
                              # stays alive and reads the answer itself; block on 'await-input' after sending
                              # --model/--effort: WITH WHAT the runs of this thread are raised from here on (R21) —
                              # only from a role holding 'launch-params'; the value is checked against the tool here
                              # --task '<NNN.k> <open|in-progress|done|dropped>[ · tail]': REPEATABLE —
                              # declares or moves a task (thread 021); the board 'TASKS.md' is derived from these.
                              # a title is required on 'open', a FACT on 'done'/'dropped'; opening and dropping
                              # need 'task-declare', passing one through does not; opening only under this thread's id
                              # --priority high|normal|low: WHICH waiting thread is raised FIRST from here on (R5) —
                              # only from a role holding 'thread-priority'; the queue is priority, then a merge
                              # held by the thread (guards 1-2 of the door, measured), then age of wait, then number
                              # --parked-on <person>: the turn STAYS here and is FROZEN until that person decides
                              # (R27) — the pair is not raised and spends nothing; it lifts by itself, by the
                              # SAME NARROW WALK as the event parks below (023, 2026-08-04): the first
                              # message that MOVES somebody. The human's own word lifts it as it always
                              # did — a courier delivering a decision either names who acts on it
                              # ('waiting-on: <role>') or asks for something ('expects' != none)
                              # Only a role the circuit cannot wake ('wake.mode: self') may be named
                              # LEGAL together with '--expects none': the PARK AS A MODE — a line of
                              # state that calls nobody (016, 052). Refused from 034 until 2026-08-04,
                              # when the narrow lift removed the reason (such a park is no longer thawed
                              # by informational traffic, and #186 stopped it ringing every digest)
                              # --parked-on pr:<n>: the OTHER thing a turn is frozen behind (023) — a
                              # MERGE, not a person. Nobody is called about it (the decision is made,
                              # what is left is a button)
                              # --parked-on run:<n>: the THIRD (019) — the round RUNNING on PR n.
                              # The one line that tells the two apart: 'pr:' waits for the BUTTON,
                              # 'run:' waits for the VERDICT. Nobody is called about it either (no
                              # decision of anybody's is pending — a machine is judging)
                              # THE ONLY PARK WHOSE SOURCE THE DOOR CHECKS (062): one 'gh' call —
                              # a park is REFUSED on a head with no runs on it, and refused by a
                              # different name on a CONFLICTING PR (GitHub assembles no merge ref
                              # there, so no run will ever be born and the awaited message has no
                              # author). Live on 2026-08-08: a pair stood 2h10m on 'run:243' whose
                              # head never had one run. A 'gh' that could not be asked does NOT
                              # refuse — the park stands with the reason printed, and the age
                              # ceiling below is what catches it then
                              # ALL THREE PARKS LIFT NARROWLY, by one walk (023; the event ones
                              # 2026-08-03, the person one 2026-08-04): a message that MOVES
                              # somebody, plus — for the event ones — the merge of that PR
                              # announced anywhere in the mail. Two header facts move somebody,
                              # and the trace class of the circuit carries neither:
                              #   * 'expects' != none — it asks somebody for something (the verdict);
                              #   * 'waiting-on: <role>' — it hands the turn over without asking.
                              # The second IS the actionable CI outcome (048): the notifier names
                              # the role on 'failure'/'timed_out'/… and leaves the field out on
                              # 'success'/'cancelled'/… The trace class has EXACTLY ONE exception,
                              # and it is about an ACTION rather than an outcome (023, 2026-08-03):
                              # a green 'checks' on a PR that does NOT yet carry the 'review' label
                              # names the AUTHOR's role — the norm of 03.08 puts the label up AFTER
                              # a green 'checks' on the same head, so the author has exactly one
                              # move there and it is theirs. Everything else green stays silent: a
                              # PR that ALREADY carries the label (the round is running — that is
                              # case 048), the outcome of a PREVIOUS head, and a run without the
                              # 'checks' job. So the trace of a round ALREADY RUNNING still lifts
                              # nothing — that is the case the narrow form was built for; a red one
                              # that froze a pair for 3.5 hours with work in front of it is what
                              # widened it
                              # --delivers <person>: this message carries the WORD OF THAT PERSON (030) —
                              # the one thing that lifts a park on them, together with 'status: closed'.
                              # Since 2026-08-22 nothing else does: a turn of somebody else's, a report
                              # of a role, the circuit's own trace leave the park standing. The name is
                              # the one '--parked-on' takes (wake.mode='self'); it lifts the park on THAT
                              # person only, raises nobody, and leaves the message ordinary
                              # --merged-pr <n>: this message announces that PR as landed — every thread
                              # parked on 'pr:<n>' lifts on it, though the announcement is informational
                              # ANYWHERE IN THE MAIL (023): the notifier writes into the thread named in
                              # the PR's description, which is not the thread parked on it — the readers
                              # judge a park against the merges of the WHOLE mail, not of its own feed
  agent-protocol new-thread   --root <mail> --ref <ref> --id <NNN-slug> --title <t> --participants <r,r> --from <role> --expects <e> [--waiting-on <role>] [--parked-on <who>] [--delivers <person>] [--turn <explicit>] --worker <w> [--session <id>] --body-file <p> [--write] [--no-push]
                              # THE OTHER WRITING DOOR (R3): --write means SENT here too — '_meta.md' and the
                              # first message go in ONE commit, pushed, with the same replanning retry
                              # --parked-on: THE SAME FIELD AS 'new-message''s, same values, same refusals
                              # --delivers: THE SAME FIELD TOO (030) — a thread is often OPENED by the
                              # courier of a decision, and the park it lifts stands in another thread
                              # --turn explicit: THE FORM DECLARED AT BIRTH (079) — the same key as
                              # 'thread status --turn', behind the same permission ('thread-status'),
                              # and the first message obeys it at once: without '--waiting-on' the
                              # opening call is refused, naming both exits
                              # (074) — a question to the owner of a decision often IS the opening of a
                              # thread, and 074 is the live example. It was accepted and SWALLOWED here
                              # until 2026-08-14: the flag parsed for one command only, the header went
                              # out without the park, and the pair was raised empty by the next tick
                              # the NNN is REFUSED if a thread already holds it (029): the number is a
                              # short address; nothing is renamed after the fact, the door is what changes
                              # --worker: what wrote it, REQUIRED on a write; --session: the id of the run, optional
                              # a raised session passes neither — the launch environment carries both
                              # --no-push: write the files only (for a caller that owns its own git, e.g. CI)

WHICH '--write' DELIVERS (thread 033). Three commands SEND — 'new-message', 'new-thread'
and 'thread status': the file, the commit and the push are one action. The third joined
them by the same argument (065.1) — a status moved on one disk is a thread still open for
everybody who reads the feed. Everything else writes and stops, and each for a stated
reason:
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
  · 'init github' — the identity of THIS BOX, and the only material of the whole
    commissioning that lies outside git and outside both configs: a key pair in ~/.ssh
    and a 'Host' block. Machine-local for that reason, and the word means "do it" here
    too — without it nothing is generated, ~/.ssh is not opened and GitHub is not asked
    anything. The one thing '--write' still does NOT do is the grant: the public half is
    printed for a human to paste, because that step hands out power;
  · 'config set' — the same file as 'init', one key of it, and the word means the same
    thing: without it the change is decided, judged against the repository config and
    printed, and the file keeps every byte it had;
  · 'orchestrator systemd install' — the unit FILE of this box, written under the
    operator's systemd directory: there is nothing to deliver and nothing to enable
    either. The two commands that would ('systemctl --user enable', 'loginctl
    enable-linger') are PRINTED for a human to run, because they are the human's;
  · 'orchestrator run' — machine-local by the same reason, but the word means something else
    there: '--write' is not 'write the file', it is 'do it'. Without it the command prints
    the plan and touches nothing (not the workdir, not its lock, not the journal); with it
    the workdir is put on the base and locked, the events are appended, the agent is raised.

WHICH INSTANCE A COMMAND IS ABOUT (thread 055). A box may host several projects, one
instance per repository, and each has its OWN machine config:
'~/.config/agent-protocol/instances/<name>.json'. Which one answers is resolved in
layers, and the layer that answered is PRINTED ('doctor', 'preflight'):
  '--local-config <p>' (a path, answering for itself) → '--instance <name>' →
  $AGENT_PROTOCOL_INSTANCE → the CHECKOUT the command is about (each named config
  declares the 'repo' it serves; a role's worktree answers with its home checkout) →
  'local.json', the unnamed config of a box that hosts one instance.
A box with no 'instances/' directory behaves exactly as it did before. Two layers that
DISAGREE are a refusal by name — a name saying 'crew' inside the 'lle' checkout is the
case where a quiet pick raises one project's roles with another project's binaries.
'--instance <name>' stands on the usage line of every command that reads the machine
config, and this text is the argument checker itself: a command whose line does not
spell the flag REFUSES it, whatever the loader behind it understands.

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
  agent-protocol orchestrator up     [--ref <ref>] [--repo <p>] [--instance <name>] [--daemon-log <p>] [--log-max-bytes <n>] [--pid-file <p>] [--foreground] [--clear-force]   # plus every 'daemon' flag
                              # THE LOG IS BOUNDED AND ITS EPOCHS ARE LEGIBLE: every start puts
                              # a banner line into the daemon log, and a log over --log-max-bytes
                              # (8 MB by default) is rotated to '<log>.1' — one generation, so the
                              # footprint is bounded by construction rather than by a cron job
                              # THE BANNER SAYS WHICH CODE WAS LOADED (023.2): the SHA of the
                              # checkout node resolved the modules from, and the moment of the
                              # start. From then on every tick compares it with --ref ON DISK
                              # (no fetch) and speaks beside the skips when they differ
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
  agent-protocol orchestrator restart [--ref <ref>] [--repo <p>] [--instance <name>] [--local-config <p>] [--pull] [--self] [--wait <sec>] [--pid-file <p>] [--daemon-log <p>] [--mode <m>] [--thread <slug>] [--reason <why>] [--by <who>]   # plus every 'daemon' flag
                              # --self: THE BOX TYPED THIS, NOT A HAND (055.2) — it changes
                              # one thing, the label the phases are said under ('self-restart'),
                              # so the log of an unattended repair reads as one. It stands on
                              # this line because this text IS the argument door: the daemon
                              # spawned exactly this command on 2026-08-05 and the door
                              # refused '--self' as unknown — the repair died at the door,
                              # silently (the child spoke into 'ignore'), twice, and the
                              # attempt ceiling then closed the mechanism for that target
                              # THE CHILD IS NO LONGER MUTE (055): its streams go to the
                              # daemon's own log, the way 'up' gives its daemon that file —
                              # a refusal at the door or a failure before the phases start
                              # would otherwise leave 'attempted N/2' with no cause, which
                              # is what made the case above cost a hand-run to diagnose
                              # THE REPAIR IS TYPED WITH THE DAEMON'S OWN IDENTITY (055):
                              # '--instance'/'--local-config' of the daemon are passed into
                              # it verbatim. No layer reproduces them — the env one is only
                              # read here, and the checkout one answers about '--repo', the
                              # served tree. Without them a repair on a multi-instance box
                              # (whose unit's ExecStart carries '--instance') resolves
                              # ANOTHER config, hence another state directory, quietly
                              # PICKING UP FRESH CODE AS ONE GESTURE: down, wait out the
                              # live sessions, (--pull: git pull --ff-only + pnpm install),
                              # up again WITH THE FLAGS OF THE DAEMON THAT WAS STOPPED —
                              # read from beside its pid, never retyped from memory
                              # --mode force: the force stop's own semantics (the trace to
                              # --thread signed by --by goes FIRST), then both flags are
                              # cleared without hands and the daemon comes back up
                              # the process waits itself and prints the phases; a wait that
                              # runs out, a failed pull or install raises NOTHING and says so
                              # THE VERSION GATE IS NOT THIS COMMAND'S (055.3): a repository
                              # AHEAD of the package refused the very command that ends the
                              # mismatch ('restart required: … pull and restart what is
                              # running on it' — exit 2, live on 2026-08-05). A graceful
                              # restart reads only WHERE this box keeps its state, loosely,
                              # and prints the skew. '--mode force' keeps the gate: it writes
                              # a message into the mail first, and that is protocol data
  agent-protocol orchestrator hold   <role> [--by <who>] [--ttl <sec>] [--note <t>] [--ref <ref>] [--now <iso>] [--holds <d>] [--local-config <p>] [--instance <name>]
  agent-protocol orchestrator resume <role> [--ref <ref>] [--holds <d>]
                              # the short forms ACT (no --write): typing them IS the decision
                              # --by: the flag, then 'operator' of the machine config (who sits
                              # at this box), then $USER; the value must be a role of the config
  agent-protocol orchestrator preflight --ref <ref> [--repo <p>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>] [--instance <name>]
  agent-protocol orchestrator enable  --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator disable --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator status [--ref <ref>] [--now <iso>] [--mode-file <path>] [--journal <p>] [--holds <d>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--pid-file <p>] [--local-config <p>] [--instance <name>] [--max-attempts <n>] [--max-runs <n>] [--root <mail>] [--roles <a,b>] [--exclude-roles <a,b>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--run-park-ttl <sec>] [--watch] [--interval <sec>] [--frames <n>]
                              # it SHOWS what the daemon would do, so it reads the same
                              # answers the daemon reads: the ceilings, the scope of roles,
                              # the mail root and the agent resolution ('launch resolution')
                              # THE LIVE FRAME first (T-0): leases, holds, the circuit
                              # (gate, stop/force flags, whether a daemon is alive), the CLOSED
                              # rate-limit windows with the time each reopens, the queue
                              # with the reason for its order, the neighbours' digests, and how
                              # old the mail on disk is; then the static sections
                              # HOW OLD THE CODE IN THE LIVE DAEMON IS (023.2), and ONLY when
                              # it is not the ref: the config is re-read every tick, the code
                              # is loaded once by node at start, and on 2026-08-03 those two
                              # tempos were six hours apart in silence. The line names facts —
                              # the loaded SHA, the ref's SHA, the distance, since when the
                              # process is up — never a command to run. A daemon on the ref
                              # gets no line: good news every frame is the noise that hides it
                              # the vintage is believed only from the LIVE pid: the file
                              # outlives its writer, and a daemon too old to publish one
                              # leaves the predecessor's behind — trusted, that reads as
                              # 'current' about code nobody measured. A live daemon that
                              # published none is NAMED, which is the whole point
                              # a reading that could NOT BE TAKEN (the ref does not resolve
                              # on disk) is named too, in the same words the tick uses —
                              # silence is earned by one state only: a measurement that
                              # happened and came back on the ref
                              # --watch: THE SAME FRAME, redrawn every --interval seconds (2 by
                              # default) — for a dumb terminal, a tmux pane or a pipe into tee;
                              # it CHANGES NOTHING: the mail checkout is never fetched or repaired
                              # (its age is shown instead), and the one thing it does ask the
                              # network is the merge-ready tier of the queue — the same guards
                              # 1-2 the tick measures, at most once a minute however fast the
                              # frame redraws, and silence from GitHub leaves the frame identical
                              # the config is resolved ONCE at the start (the network is not
                              # touched again), and a failed collection draws the LAST KNOWN
                              # frame under 'frame: unavailable since HH:MM (why)' — the watch
                              # dies of Ctrl+C and of nothing else
                              # --frames <n>: stop after n frames (for checks)
  agent-protocol orchestrator tui    [--ref <ref>] [--interval <sec>] [--journal <p>] [--holds <d>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--pid-file <p>] [--local-config <p>] [--instance <name>] [--max-attempts <n>] [--max-runs <n>] [--root <mail>] [--roles <a,b>] [--exclude-roles <a,b>] [--now <iso>] [--mode-file <path>]
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
  agent-protocol orchestrator run    --ref <ref> --role <id> --thread <slug> [--repo <p>] [--wall-clock <sec>] [--idle <sec>] [--wait-input <sec>] [--wind-down <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--max-attempts <n>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>] [--instance <name>] [--journal <p>] [--root <mail>] [--force-flag <p>] [--now <iso>] [--roles <a,b>] [--exclude-roles <a,b>] [--fresh] [--write] [-d|--detach]
                              # attached by default: you watch what you raised. -d puts the supervisor in the background
                              # ceilings: the flag wins over the role's launch.limits, which wins over the package default
                              # tool/model/effort: the flag wins over the role's launch.agent; the binary: the flag, then the
                              # machine config, then the name the role's own kind declares (never one tool's binary for all)
                              # the role works in its own worktree (orchestrator.workdir.worktrees), put at the base per package
                              # --fresh: never resume the previous session, whatever the continuation policy says
                              # --wait-input: the ceiling of a DECLARED wait for input (R19); waiting does not eat the wall clock
                              # --wind-down: how long before the deadline the session is asked to land its work (R20); default 20% of the window, 2-15 min
                              # --roles/--exclude-roles: the same scope door as the daemon's (R13) — a --role
                              # owned by another instance, or left out by these flags, is REFUSED here, not raised
  agent-protocol orchestrator daemon --ref <ref> [--repo <p>] [--tick <sec>] [--wall-clock <sec>] [--idle <sec>] [--wait-input <sec>] [--wind-down <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--max-attempts <n>] [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>] [--instance <name>] [--fresh] [--once] [--journal <p>] [--root <mail>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--holds <d>] [--roles <a,b>] [--exclude-roles <a,b>] [--run-park-ttl <sec>]
                              # --roles/--exclude-roles: WHICH roles THIS run raises (R13), mutually exclusive;
                              # on top of the instance filter — a role owned by another box is never raised here
                              # WHAT THE TICK COULD NOT READ IS NAMED AND COUNTED (065.4), every
                              # tick and beside the skips: the per-thread line is older than the
                              # count, and what a night of ticks never said is that the queue it
                              # raised from was narrowed by those threads. The tick does not break
                              # on them — a broken thread drops out of the candidates, the rest run
                              # --run-park-ttl <sec>: HOW LONG A 'run:' PARK MAY STAND (062, layer 2)
                              # before it stops freezing the pair and the role is raised to check the
                              # outcome of that round itself. Default 1800 (30 min) — 3x the measured
                              # median of 'checks' on this pool (9m32s, 9m29s, 9m35s on 2026-08-08), so
                              # it does not argue with an honestly long round. It catches what the door
                              # check cannot see: a run that EXISTED and was lost in flight (a dead
                              # runner, a workflow that never reported, a silent notifier). 0 switches
                              # the ceiling off; the refusal at the door cannot be switched off
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
  agent-protocol orchestrator systemd install [--ref <ref>] [--repo <p>] [--instance <name>] [--local-config <p>] [--unit-name <n>] [--unit-dir <d>] [--description <t>] [--daemon-args <a>] [--write]
                              # THE DAEMON AS A RESIDENT UNIT: the file is GENERATED from this
                              # box (the repo, this interpreter, the CLI path) — a unit typed
                              # per box is the first path to go stale. Without --write it prints
                              # the unit and the path it would write and touches nothing
                              # THE INTERPRETER IS NODE PLUS THE TSX LOADER, by absolute path,
                              # and the command says which one it wrote: this CLI is TypeScript,
                              # and bare node in front of a '.ts' entry dies on its first import
                              # (the live unit of 2026-08-02). A '.js' entry takes no loader
                              # the FIRST human step printed is 'systemd-analyze --user verify':
                              # a key in the wrong section is not refused by systemd, it is
                              # ignored with a journal line — a guarantee silently missing
                              # user-level + linger, NOT root: the sessions read the operator's
                              # machine config (R14) and credentials — 'systemctl --user enable'
                              # and 'loginctl enable-linger' stay HUMAN actions, as they were
                              # IT REFUSES IN A ROLE'S WORKSPACE ('orchestrator.workdir.worktrees',
                              # the same sign 'zones check --role-from-workspace' reads):
                              # WorkingDirectory resolves to the home checkout from anywhere,
                              # but ExecStart would name the entry point of the tree you typed
                              # in — and a role's tree is reset, locked and removed by the
                              # circuit itself (R17). Type it in the home checkout
                              # ANY OTHER linked worktree (the mail checkout, your own) is
                              # passed with a NOTE: R17 does not govern it, and a refusal there
                              # would name a reason that is not true
                              # ON A BOX HOSTING SEVERAL INSTANCES the unit is NAMED AFTER
                              # ONE (055): 'agent-protocol@<instance>.service', and its
                              # ExecStart carries '--instance <name>' — one name on the whole
                              # user is the collision two daemons would enable into. Not a real
                              # systemd template: a template shares ONE ExecStart, and this one
                              # is generated per box (its repo, its interpreter, its PATH)
                              # --daemon-args '<a b c>': the daemon's own flags, baked into ExecStart`;
