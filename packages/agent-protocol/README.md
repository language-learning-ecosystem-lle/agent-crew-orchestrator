# agent-protocol

A file-based protocol for coordinating autonomous agents on top of git: roles and
permissions, operations over threads and the index, watch/wake-up/notifications,
and initialisation on a new project.

**Status: phase P3 is done, thread `012-agent-protocol-package`.** Delivered: the
skeleton, the role model as data (P1), the "one message — one file" thread model
with a generator of derived files, a validator and a migration (P2, the core), and
the execution layer S0–S9 (P3) — accepted by the 2026-07-25 run, in which the
circuit raised a session on a waiting thread by itself, that session wrote an
answer, and the observer lived to the outcome and recorded it. Next: init on a new
project (P4) and the queue after 012 is closed.

## The discipline of portability

The package lives in a monorepo but is **designed as a foreign one**: it will move
into a separate repository and be reused. Hence the rules from the very first
commit:

- the neutral name `agent-protocol` — **without the project scope**. In this
  repository all workspace packages live under `@lle/`; here the scope is
  deliberately omitted, otherwise the move would start with a rename, and the name
  of a package is the most-referenced thing about it;
- **zero knowledge of the project**: not one import from `apps/*`, no domain
  concepts, no paths of a particular repository in the code. Everything
  project-specific arrives from the outside — through the config and the command
  arguments;
- the notification transport (Telegram and the like) is a **separate package**:
  the core produces events, delivery is taken over by a pluggable plugin. The
  texts of the notifications are not here either — that is the language of a
  particular team;
- the move must be mechanical (`git subtree split` plus replacing the workspace
  dependency with a version from a registry).

The storage abstraction (`git-local` / `github-api`), the package's MCP server and
the requirement of a runtime-agnostic core were **dropped** by john's decision of
2026-07-23 together with the switch to the "one message — one file" model: writing
stopped being an operation of the package, and generating derived files always
happens in Node with a checkout.

## The role model as data (P1)

Before this, roles lived as prose in `ROLES.md`, and behaviour was derived from it
by eye and by bash scripts: the list of roles was cut out of a markdown table with
awk, the set of those to notify was hard-coded as a string, the session name was
assembled from a template, and "who to poke so that the assistant comes alive"
lived in a comment inside an awk program.

Now roles are config, and behaviour is **derived** from it:

| data | what follows from it |
|---|---|
| `wake.mode = self` | a human: notify directly, there is nobody to wake |
| `wake.mode = via-human`, `via` | an assistant without a process of its own: we call the named human ("poke them") |
| `wake.mode = watch`, `session` | an agent with a session: the keeper wakes it, the session name comes from the same place |
| `wake.mode = event` | woken by a platform event: neither wake nor notify |
| `permissions` | who may change the `status` of a thread (enforcement — P2) |
| `status` | the active roles; those who left stay in the registry, otherwise old threads stop parsing |

The schema rejects unknown fields: a typo in a field name would otherwise mean a
silent default — exactly the class of quiet defects this package is written for.

The consistency checks live in `createRoleRegistry` and every one of them is about
a real failure: a duplicated role, a `via` pointing nowhere or at a role that
itself has nobody to wake it, two roles on one tmux session (the wake-up would go
to the wrong place).

`zones` is the only field with no code consumer at P1: it exists so that the config
can in time become the source of the role card (P4). Noted deliberately, so that it
does not look forgotten.

## The protocol config

One file at the root of the repository where the protocol is used
(`agent-protocol.json` by default): roles, permissions, zones, the branch and the
directory of the mail. There is no separate document with a table of roles — two
descriptions of one set drift apart by construction.

```
pnpm -F agent-protocol cli config check --ref origin/main
pnpm -F agent-protocol cli roles list   --ref origin/main
pnpm -F agent-protocol cli role exists  --ref HEAD --role dev-core
```

**It is read only through the package and only at an explicit `ref`.** Reading the
file from the disk of the working copy would show an edit from ONE'S OWN feature
branch as being in force — the same class as cwd blindness, only about
permissions. `ref` deliberately has no default: a check in CI must look at the head
of the PR branch, the circuit must look at `origin/main`.

Freshness is part of the operation: `origin/*` goes stale silently without a
`fetch`, so the command does the update itself, and `--no-fetch` prints a warning.

A role's `launch` section is the LAUNCH CONTRACT of that role: `allowedTools` (what
a raised session may do) and, since R12, `limits` — `idleSeconds`,
`wallClockSeconds`, `maxTurns`, all optional. They sit together because they answer
one question, "what a run of this role is allowed to be", and a role that needs its
own permissions is exactly the one that needs its own window. Anything the config
leaves unsaid falls through to the package default; `idleSeconds: 0` switches the
idle detector off, as `--idle 0` does.

A role's `instructions` is an array, and the order is the reading order (the
general rules of the project first, then the role card). `kind: external` means the
text lies in the repository but is EXECUTED outside (a skill on the chat side) —
the only place where there is no machine guarantee, and we do not promise one. A
file that is declared but missing at this ref fails `config check`.

Exit codes: `0` — it all matched, `1` — a divergence (listed line by line), `2` —
the file was not read, is not JSON, or the config is invalid. Every refusal is
loud: the lesson of the P0 spike — a command that silently depends on the
environment produces a result indistinguishable from a defect in the thing under
test.

## Compatibility and breaking changes (R2)

The protocol keeps its data as files in a live repository, so a change of shape has
to reach data somebody has already written. **One number covers the whole shape** —
the config, the thread layout, the message header, the journal event:

- the repository declares which shape its data is at — `protocolVersion` in
  `agent-protocol.json`;
- the package declares which shape it writes — `CURRENT_PROTOCOL_VERSION`
  (`src/schema/version.ts`).

The two live in different places on purpose: only the repository knows about its
data, only the package knows about its code, and a mismatch between them is exactly
what is worth catching. It is caught **on the reading path**: `loadProtocolConfig`
compares the numbers and stops the circuit, naming the repair — a repository behind
the package is migrated, a package behind the repository is updated, **and a
downgrade is never performed** (the older shape cannot re-derive what the newer one
wrote). The consequence is deliberate: once the numbers diverge, every command
refuses, and the only one still working is `schema migrate` — it reads the raw file
rather than going through that door.

| version | shape |
| ------- | ----- |
| 1 | the initial one: `_meta.md` + `messages/` with `from`/`date`/`expects`/`waiting-on`, the config with `roles`/`mail`/`orchestrator`, the journal of `lease-*`/`launch`/`stop` events |
| 2 | + provenance in the message header: `worker` and `session`. Optional on READ (history, legacy threads and the migration window cannot be repaired), `worker` REQUIRED on a write. The migration stated the absence outright on everything already written — `worker: unknown`, 331 files, 2026-07-25 |
| 3 | + per-role run ceilings: `roles[].launch.limits` (`idleSeconds`, `wallClockSeconds`, `maxTurns`), every field optional. NO data moves — a version-2 config is already a valid version-3 one; the number exists so an older build says "update the package" instead of "unrecognized key" |

```
agent-protocol schema migrate [--repo <p>] [--root <mail>] [--to <n>] [--write]
```

**This is the one command with no `--ref`, and it prints the file it read every
time.** All the others read the config at an explicit point in history, because an
edit in one's own feature branch must not look effective to the circuit. This one
is the reverse case: it exists to PRODUCE an edit of the working tree, and planning
against a different version of the file than the one it is about to overwrite would
mean writing a result that is not a function of its input. On top of that, the
version has to be readable before validation — a config one version behind is a
config the current schema may legitimately reject, and going through the loader
would turn "run the migration" into "invalid config".

**What counts as a breaking change here.** The schemas are strict by design, so the
bar is lower than usual:

- **the config** — any field added, renamed or removed. `strictObject` rejects
  unknown fields (a typo must not become a silent default), which means an old
  package refuses a new config and a new package refuses an old one. Both
  directions, always;
- **the message header** — an added field breaks nothing loudly, and that is worse.
  Unknown keys are tolerated on read but DROPPED on render, so two versions disagree
  about the derived `_thread.md`: each `derive` run rewrites what the other one
  wrote. A silent rewrite war on an append-only feed;
- **the file name of a message** — it is the identity of the message, not a display;
- **the layout of a thread directory**, the journal event kinds and their fields,
  the format of the hold and flag files.

**One carve-out, named after R6 raised it: a NEW VALUE of an existing journal enum**
(a release reason such as `stalled`) **is not a versioned change.** Every argument
the list rests on is about data that TRAVELS — merged by two parties, or derived into
a file both of them rewrite. The journal is neither: it is local operational state,
outside git, with a single writer, and nothing is derived from it. What is left is
one direction — an OLD package reading a journal a new one wrote — and that fails
loudly on the line, naming the repair, which is what the version gate would have said
anyway. A new event KIND or a new FIELD stays in the list above: those change the
shape of what is written, not the vocabulary of one field.

Not breaking: prose, help texts, a new command, a new optional flag, a new
_optional_ config field the old package would nevertheless reject — that last one is
the point of the list, it looks additive and is not.

**What a PR that introduces one must attach.** All four:

1. a migration step registered for `from` = the previous version, with a test on
   REAL data (a fixture taken from the threads of this repository, not a synthetic
   one — the live feed is where every surprise of the previous migration came from);
2. the bump of both numbers — `CURRENT_PROTOCOL_VERSION` and `protocolVersion` in
   the config. They are one statement ("the package writes this shape and the
   repository is at it") and they must not be split across PRs: that would leave a
   window in which the circuit refuses to start;
3. a row in the table above;
4. the landing order below, carried out and reported in the thread of the package.

Items 1 and 2 land in DIFFERENT PRs and 3 goes with whichever states the shape: the
step must be merged before the migration can be run by a reviewed package, and the
two numbers must move together, in the PR after it. What must never be split is the
PAIR of numbers — not the step from them.

**The landing order — expand, migrate, contract.** The mail lives in one branch and
the config in another, so a breaking change lands in at least two commits, and
between them the circuit has to keep running:

1. **expand** — teach the READER to accept both shapes and merge that first;
2. **migrate** — run `schema migrate --write` and commit the data (the mail goes
   straight into its branch, as all mail does);
3. **contract** — merge the PR that bumps both numbers and starts WRITING the new
   shape.

**A step that moves NO DATA lands in ONE PR, and that is not an exception to the
order but the order with an empty middle (R12).** The three landings exist because
the middle one — running `schema migrate --write` over committed mail — must be
performed by a merged package, and because the mail and the config live in
different branches, so they cannot move in one commit. A version that only widens a
schema has nothing in that middle: no message, no thread, no journal line changes,
and the only file the step would touch is the config, whose number is carried by
hand anyway. What is left is the reader and the pair of numbers, and those may not
be split — they are one statement. Splitting them here would buy a second review
cycle and pay for it with a window in which the package accepts a field the config
is not allowed to carry yet. The registered step still earns its place: for a
repository that carries this package and is not this one, it IS the answer to "my
config is at 2, what now".

**Why the order is not negotiable, learned on R7 — the migration is run by the
MERGED package, never by the branch under review.** Compressing all three into one PR
looks tempting when the new shape does not reach a derived file (R7's fields do not,
so no two versions would rewrite each other's `_thread.md`). It is still wrong, and
for a reason that has nothing to do with readers: the migration rewrites a hundred
committed messages of a live conversation, and code that has not passed review must
not be the thing that does it. The same rule the roles follow when writing mail —
write with the version that is IN FORCE, not with the one on review.

The version gate also fixes the order from the other side: `schema migrate` keys off
the version the config DECLARES, so once the bump is merged the migration has nothing
left to do. And the config written by `--write` is carried into the contract PR
rather than committed on the spot — a repository declaring a version its package does
not support refuses every command, so a config bump committed early would take the
whole circuit down until the merge.

**Carry the NUMBER, not the file.** The runner re-renders the config as canonical
two-space JSON, so a config that carries hand-written compact objects
(`"wake": { "mode": "self" }` on one line) comes back reflowed — on this repository
the one-line bump arrived as a 60-line diff. The reflow is harmless to every reader
and pure noise to every reviewer, so the contract PR edits `protocolVersion` by hand
and the file `--write` produced is thrown away. The step for the DATA is held to a
stricter standard on purpose (a textual insertion with a byte-exact proof) — the mail
is somebody's committed words, the config is not.

`schema migrate` writes files and does NOT commit them: which commit goes to which
branch is a decision of the protocol, not of the runner. The plan prints absolute
paths, so the split between the two trees is visible before anything happens.

**A step that rewrites already-committed messages must carry its own guard.** The
feed is append-only without exceptions (john's rule, 2026-07-22), and a migration is
the only admissible rewrite of it — admissible for exactly one reason, provability.
The precedent is the thread migration: it is accepted only if gluing the result back
together reproduces the original byte for byte, and refused otherwise. A step that
touches somebody's committed message and cannot state a comparable proof is not a
migration but an edit.

**The three boundaries of that carve-out** (curator, 2026-07-25 — append-only
protects the HISTORY OF THE CONVERSATION, who said what and when; a migration changes
the FORM of the record, not its content or its authorship):

- **(a)** a migration does not change or delete the substantive text of messages, nor
  their authorship — form and metadata only;
- **(b)** it runs only through the `MIGRATIONS` registry with its own guard; editing
  history by hand stays forbidden exactly as before;
- **(c)** byte-exact tails inherited from history (the `[СВЕРХПИСАНО msg-002]` class)
  are part of the content — a migration does not touch them.

With those three, "new fields only on new messages" is NOT required, and R7 landed as
designed: a migration over the live threads.

**The thread migration (`migrate`) is deliberately outside this chain.** It moves
ONE directory from `_thread.md` into `messages/`, thread by thread, and both forms
are read at the same time — the gradualness is the design (009 and 010 move when
their fronts wake up). A versioned migration is the opposite: repository-wide and in
one go. One number over per-thread progress would have to lie about one of them.

## A thread as message files (P2)

```
NNN-slug/
  _meta.md            ← the source: title, participants, status
  messages/
    2026-07-23T13-45-12Z-curator.md   ← a new message
    2026-07-21-003-curator.md         ← a migrated one (history has no time of day)
  _thread.md          ← DERIVED: the messages glued together, for a human to read
```

A writer creates their own file and does not touch anybody else's — retyping a
body, spoiling placeholders and races over a shared file disappear by
construction. In exchange another risk appears: a retroactive edit becomes cheap
and unnoticeable. Two rules hold it in check — **the identifier of a message is its
file name, not its number** (the number is merely a display in the assembled
thread) and **a file is immutable after the commit**: `check --since <ref>` lifts
the state of the feed out of git and fails on any edit of something committed
earlier. Without `--since` the immutability check is not performed and **says so
out loud** — silence would read as "checked and intact".

`waiting-on` is a field of the message header, not a line in the prose: the full
remaining set, an absent field means "I am not passing the turn", `—` means "the
wait is lifted". An unknown role in the field **fails the check** instead of being
dropped silently: a silent drop was precisely the mechanism by which a role was
lost from a declaration.

Both forms (the files and the old single `_thread.md`) are read at the same time,
so threads move one by one and there is no "switch-over day".

### One broken thread does not blind the circuit

`loadThreads` returns a pair of "the ones read plus the broken ones" rather than an
array: the type forces every caller to decide what it does with a broken thread.
Before that, the very first exception took the whole call down — that is, `mail`,
the watch and the daemon tick for ALL roles at once; this is exactly how one
message file put by hand into a legacy thread without `_meta.md` took down the mail
of the whole circuit.

- **Readers keep working**: `mail` gives out the mail of the readable threads and
  LOUDLY names the unreadable ones (id plus what exactly is wrong) on stderr; the
  daemon throws a broken thread out of the candidates and repeats the complaint
  **every tick** (a single line at startup is the one nobody sees).
- **The exit code of `mail` solves exactly one problem — it must not let an empty
  mailbox be declared when we did not actually check it.** Mail was found, some
  threads are broken → **0**: a non-zero code would make the entry wrapper throw
  away the mail we found, that is, bring back the very blindness. No mail was
  found while something is unreadable → "there is no mail" is NOT proven, code
  **2**.
- **Those who assemble a display refuse**: `index build` and `derive` write nothing
  when a thread is broken. Assembling the index from part of the threads means
  publishing the incomplete as complete. `check` reports broken threads in a
  separate block.
- **The most dangerous place is the run observer.** Should the thread the lease was
  taken for break, it would not be among those being waited on, and "the turn was
  passed" would evaluate to TRUE: the run would close as `completed` although the
  role never answered. Hence the unreadability of ONE'S OWN thread is treated as
  ignorance rather than as a passed turn: the observation continues, and the limit
  is set by the deadline (`timeout`).
- **A state is called by its own name**: `messages/` without `_meta.md` is a
  "half-migrated thread" (plus a hint about what to do with it), not a raw ENOENT
  on a file path.

### Commands

`--ref` (which version of the config to read) is required and has no default;
`--repo` defaults to the repository of the current directory. Without `--write`
nothing is written.

The entry point in this repository is `pnpm protocol <command>` (the package is
declared as a dependency of the root); below the commands are written by the
binary name.

```
agent-protocol config check --ref <ref> [--repo <p>]                       # the config is intact
agent-protocol roles list   --ref <ref>                                    # the list of roles
agent-protocol schema migrate [--repo <p>] [--root <comms>] [--to <n>] [--write]   # protocol version → version
                                                                           # (no --ref: it plans against the tree it rewrites)
agent-protocol role exists  --ref <ref> --role <id>                        # is the role known?
agent-protocol mail    --root <comms> --ref <ref> --role <id>              # mail FROM THE THREADS
agent-protocol index build  --root <comms> --ref <ref> [--write]
agent-protocol thread build --root <comms> --ref <ref> --id <NNN-slug> [--write]
agent-protocol derive       --root <comms> --ref <ref> [--write]           # all derived files
agent-protocol check        --root <comms> --ref <ref> [--since <ref>]
agent-protocol migrate      --root <comms> --ref <ref> [--id <NNN-slug>] [--write]
agent-protocol new-message  --root <comms> --ref <ref> --thread <id> --from <role> \
                            --expects answer|ack|none [--waiting-on <r,r>] \
                            --worker <w> [--session <id>] --body-file <p> [--write]
agent-protocol new-thread   --root <comms> --ref <ref> --id <NNN-slug> --title <t> \
                            --participants <r,r> --from <role> --expects <e> \
                            [--waiting-on <r,r>] --worker <w> [--session <id>] --body-file <p> [--write]
# the orchestrator: the paths come from the config (section `orchestrator`), operation needs only --ref;
# the path flags below are omitted — they remain an override for checks on a copy of the mail
agent-protocol orchestrator preflight --ref <ref> [--exec <bin>]            # the checks BEFORE the lease
agent-protocol orchestrator enable  --ref <ref> [--write]                  # ENABLE launches
agent-protocol orchestrator disable --ref <ref> [--write]                  # disable them
agent-protocol orchestrator status --ref <ref> [--now <iso>] [--mode-file <p>]   # the whole mode
agent-protocol orchestrator record --ref <ref> --kind <k> --role <id> --thread <slug> \
                            [--deadline <iso>] [--reason <r>] [--mode <m>] [--now <iso>] [--write]
agent-protocol orchestrator run    --ref <ref> --role <id> --thread <slug> \
                            [--wall-clock <sec>] [--idle <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--exec <bin>] [--worker <w>] [--now <iso>] [--write] [-d|--detach]
                            # attached by default (you watch what you raised); -d backgrounds the supervisor properly
                            # the three ceilings: the flag beats roles[].launch.limits, which beats the package default
agent-protocol orchestrator daemon --ref <ref> [--tick <sec>] [--wall-clock <sec>] [--idle <sec>] [--poll <sec>] \
                            [--max-turns <n>] [--max-runs <n>] [--exec <bin>] [--worker <w>] [--once]
agent-protocol orchestrator log    --ref <ref>                             # the history of events for john
agent-protocol orchestrator stop   --mode graceful --ref <ref> [--write]
agent-protocol orchestrator stop   --mode force --ref <ref> --by <who> --reason <why> --thread <slug> [--write]
agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> --by <who> [--ttl <sec>] [--note <t>] [--write]
agent-protocol orchestrator hold   --mode release --ref <ref> --role <id> [--write]   # the role is taken by a manual session
```

**Writing a message is `new-message`** (the single source of truth on the form of a
write): it creates the file `messages/<UTC-stamp>Z-<role>.md` and does NOT touch
`_thread.md` or `INDEX.md` — those are rebuilt by the generator. The stamp is
**monotonic along the feed** (`max(now, the last one + 1s)`): an answer does not
land before the message it answers when the writers' clocks are skewed.
`--waiting-on` is the FULL remaining set, not a delta. A rejected push (a
concurrent write) means refreshing the mail (`reset --hard origin/comms`) and
retrying on top of the fresh state; the feed is append-only and force-push is
forbidden. `new-message` **REFUSES** to write into a non-migrated (legacy) thread:
a file write would cut its history down to a single file — a legacy thread is
appended to by hand as a section in `_thread.md` until it is migrated (right now
that is only 009/010).

### Who said it, and what wrote it down (R7)

`from` names the ROLE. Two more header fields name the RUN:

```
---
from: dev-core
worker: claude-code
session: 8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b
date: 2026-07-25T18:00:00Z
expects: answer
waiting-on: curator
---
```

**The norm they make legible: one role writes into one thread from MANY sessions.**
Two adjacent `dev-core` messages are as likely as not to come from two runs sharing
nothing but the role card — the second one knows what is in the thread and nothing
else. Read without that, a feed looks like one continuous interlocutor, and "as I
said above" starts to mean something it does not.

- **`worker`** — an OPEN vocabulary, validated by shape (a role-id-looking token) and
  not by a list: `claude-code`, `claude-ai`, `gh-action`, `human`, `agent-protocol`
  (a message the package composed itself), `unknown` (provenance was not recorded).
  A closed enum would turn every new tool in the ecosystem into a schema migration of
  the protocol, and which tools exist is not the protocol's business.
- **`session`** — the id of the run. A raised session does not have to know it:
  `claude -p --output-format stream-json` opens with an init event carrying
  `session_id`, the supervisor reads it off the stream it is already logging and
  writes it into `<state>/sessions/<run>.session`. The session is handed the PATH in
  its environment at spawn (`AGENT_PROTOCOL_SESSION_FILE`), because the value does
  not exist yet at that moment; `AGENT_PROTOCOL_WORKER` beside it carries the value.
  So `new-message` inside a raised session records both with no flags at all.
- **`worker` is REQUIRED on a write and optional on a read**, and the asymmetry is
  the whole design. At the door the value is always obtainable — a raised session has
  it in its environment, everybody else knows what they are — and a message written
  without it can never be repaired, because the feed is append-only. On the read there
  are messages nobody can fix by construction: legacy threads carry no header at all,
  history predates the field, and between the migration of the mail and the merge of
  the version bump there is a window in which somebody legitimately wrote with a
  package that did not know it. So `check` does NOT require the field: a rule that
  cannot be met makes the validator permanently red, and a red everybody has learned
  to ignore is worse than no rule at all. A missing field means "this writer did not
  record it"; a WRONG one would be permanent, which is why a malformed `--worker` is
  refused at the door rather than discovered by a reader who cannot repair it.
- **`session` stays optional on both sides**: it is minted by a runtime a human or a
  chat simply does not have.
- **The price, and it is on the human side:** writing by hand now costs one more flag
  (`--worker human`). That is the trade the door makes — discipline forgets, a door
  does not.
- **They are deliberately absent from the assembled `_thread.md`.** That file is the
  conversation; provenance is a fact about the run, and its reader is the analysis of
  runs, which reads the message files.

`mail` computes mail **from the threads** rather than from `INDEX.md`: a derived
index may lag or fail to build, and tying the watch to it means blinding the
circuit exactly the way that has already happened.

A migration is accepted only with a byte-level guard: gluing the migrated files
back together must reproduce the original `_thread.md` bit for bit, otherwise the
thread is not moved. That is what makes rewriting an append-only feed permissible.

The second reason to refuse a migration is a **name collision**: two messages with
the same role, date and historical number would produce one file. The byte-level
guard does not catch such a pair by construction (it compares the assembly of the
parsed messages, not what would be left on disk), so it is checked separately and
also blocks the write: otherwise one message would silently overwrite another, and
the loss would only surface at the next regeneration.

## The orchestrator (P3)

The orchestrator launches roles as `claude -p` sessions built from their
`instructions`. It is built in steps: **S0** — the data (journal/lease/`status`)
with no spawn; **S1** — launching one role on one thread; **S2** — stopping on
completion (an observer of the passing of the turn); **S3** — launching by mail
with no human in the loop (the daemon); **S4** — a forced stop and printing the
journal.

### S0 — data before behaviour

The order is the same one the whole package was built in: observability first, the
risky action after — not a single spawn.

- **The journal** is append-only JSONL, **LOCAL, not in git** (transient state has
  no place in the history of `comms`). One event per line; the order is the order
  of the lines of a single writer, so the seq comparator of migrated messages is
  not needed here. Kinds of events: `lease-acquired` (with a `deadline`),
  `launch`, `handoff-detected`, `lease-released` (with a `reason`:
  `completed|forced|exited-without-handoff|supervisor-gone|timeout|exhausted`),
  `launch-refused` (with `reason: run-budget`, S3) and `stop` (with a `mode`). The
  shape is held by the schema: `lease-acquired` without `--deadline` and
  `lease-released` without `--reason` are a loud refusal.
- **`record`** is a manual write of an event by the same path the daemon writes
  through. It is needed exactly where the supervisor guarantee does not hold:
  `supervisor-gone` covers an exit, an exception, `SIGINT` and `SIGTERM`, but not
  SIGKILL and not a machine crash (S9) — and the live lease left behind by those is
  closed by a human with an honest reason (`--kind lease-released --reason
  supervisor-gone`). It only writes forward: a line is appended at the end, earlier
  ones are not touched. **`record` also allows forging a `completed` on behalf of
  an observer that never existed** — what holds that back is discipline, not the
  schema, and it is better to know it than to consider it protected.
- **A lease** is not a separate file but a FOLD of the journal (`status`): the
  source is append-only, the state sits on top of it, and there is nothing for two
  writers to drift on; it survives a daemon restart for free.
- **`status` calls out the two broken states with explicit marks** instead of
  hiding them in a column: **`OVERDUE`** (`overdue` — the lease is alive, the
  `deadline` has passed: "stuck vs working") and **`EXHAUSTED`** (`exhausted` — the
  `MAX_ATTEMPTS` ceiling of unsuccessful attempts on a (role, thread) pair is
  reached, we launch no more). Both signs are in the data from S0 on; the behaviour
  based on them (releasing on timeout, refusing to relaunch) arrives with S2/S3.

**Every outcome leaves a trace**: releasing a lease for any reason, timeout and
exhaustion included, is a `lease-released` event with a `reason`. Hanging quietly
or quietly giving up is not allowed — otherwise a role drops out of the system
unnoticed.

### S1 — launching one role on one thread

`orchestrator run` assembles the prompt from the role's `instructions` (not from a
hard-coded list) and spawns `claude -p` on ONE thread. Three rules keep it honest:

- **Who to launch comes from machine-meaningful fields, not from `role.kind`.** A
  role is launchable when it is `status: active` + `wake: watch` (it has a session
  of its own) + has non-empty `in-repo` instructions. A human (`self`), an
  assistant-through-a-human (`via-human`), a platform role (`event`), a role with
  `external` instructions (executed outside) and a role with no instructions
  (nothing to build a prompt from) are an **explicit refusal, not a crash**.
- **The journal write happens BEFORE the spawn.** `lease-acquired`+`launch` are
  written before the process starts; should it die at startup, from the outside it
  reads as "an attempt happened and broke off" rather than "nothing was going on".
  On the outcome the lease is released leaving a trace (in S1 — by the exit code;
  S2 refines `completed` into "the turn was passed", see below).
- **One thread per run.** The prompt strictly forbids handling the rest of the
  mail: the completion signal of S2 is tied to the turn being passed on that
  thread.

**The ceiling against "launch → break → launch ate the quota" comes in two
layers:** per (role, thread) pair — `exhausted` from S0 (`MAX_ATTEMPTS` breaks,
then a refusal); and global — `MAX_CONSECUTIVE_RUNS` launches in a row without a
single `completed` (aimed at the S3 auto loop). `--exec` (default `claude`) is
injected: e2e and live acceptance aim at the real binary, the mechanics checks aim
at a stub.

**ATTACHED BY DEFAULT, `-d`/`--detach` FOR THE BACKGROUND (R12).** Raising one
agent by hand is something you watch, so `run` holds the terminal and relays the
session's lines to it. The background mode is a flag rather than a shell trick, and
not out of politeness: `run … &` leaves the supervisor attached to that terminal,
and closing it delivers SIGHUP, whose DEFAULT action ends the process without
running a single exit handler — the lease stays `running` for ever and the journal
starts lying "it is working" about something long dead. That is the S9 failure,
reachable by shutting a laptop lid. So `-d` does it properly: the supervisor gets
its own session with no controlling terminal to be hung up on, its output goes to
`<run>.supervisor` beside the session log, and the parent prints the pid and both
paths before returning the prompt. `--detach` without `--write` is REFUSED — a dry
run prints its plan and exits, and backgrounding it would return a prompt and no
process. SIGHUP is handled in the attached case too, for the same reason it had to
be named at all.

**THE THREE CEILINGS ARE PER ROLE (R12).** `--idle`, `--wall-clock` and
`--max-turns` are resolved as **the flag, then the role's `launch.limits`, then the
package default**, field by field and independently — naming one flag does not
return the other two to their defaults. The flag wins because it is the most
specific statement there is: a human typed it for THIS run. Every launch prints the
line `ceilings — idle 600s (role) · wall-clock 3600s (role) · max-turns 300
(role)`, the source included: a run cut short is a different fact depending on
whether the project asked for that window or the package did, and until R12 the
output said only "timeout". The daemon resolves them PER ROLE inside its loop, not
once at startup — it raises different roles, and hoisting the resolution would give
every one of them the ceilings of whichever came first.

### S2 — stopping on completion

After the spawn, `orchestrator run` does not block but OBSERVES, moving the lease
`running → draining → stopped`. The pure core is the `observeStep` reducer.

- **The orchestrator does NOT stop the agent.** The agent finishes by itself, having
  written its answer; the observer merely recognises the outcome. Neither a message
  nor a signal is sent to the agent to stop it — and none can be: there is no such
  path in the model.
- **The completion signal is THE PASSING OF THE TURN on the thread** the lease was
  taken for (from `threadsWaitingOn`, the same source as `mail`). NOT "code 0" (a
  process may exit without writing an answer → `exited-without-handoff`) and NOT
  "the mail went empty" (it could have gone empty through somebody else's edit).
- **A crashed session and a force are DIFFERENT reasons.** A process that exited by
  itself without passing the turn releases the lease with
  `exited-without-handoff`; `forced` means exactly one thing — there was a force,
  and it has a `by` (the event `stop {mode: forced, by, note}`). Previously
  `forced` was written for both cases, that is, a crashed role was
  indistinguishable in the journal from a stop by john — and the acceptance
  scenario "`force` leaves a who/when/why trace" would pass identically on a
  working circuit and on a collapsed role. For the attempt ceiling both reasons are
  equal (the turn was not passed — the pair is `launchable` up to `MAX_ATTEMPTS`).
  The value `forced` has not been removed from the list of reasons even though the
  `lease-released` path no longer writes it: journals are append-only files on
  disk, and removing it would make old lines unreadable under a loud parse.
- **`draining` has a limit — the lease deadline (`overdue`).** The turn was passed →
  we wait for the process to exit naturally → `completed`. The deadline without a
  passed turn → `timeout`, and the role does not hang forever. `handedOff`
  outweighs `overdue`: a success noticed at the deadline is still a success.
- **Putting things down covers the whole process group (`-pid`), not just the direct
  child.** A SIGTERM to a launcher does not reach its children (`claude` → its
  subprocesses), and they would be orphaned; the spawn is `detached` and the
  release hits the group. The observer reads the file feed at `--root`; freshness is
  held by the caller (in S3 — by the daemon).

### S3 — launching by mail (the daemon)

`orchestrator daemon` removes the human from the loop: every tick it reads the mail
(the thread source), finds pairs of "a launchable role is being waited on in a
thread", and through `planTick` executes ONE decision — it raises the pair with a
`run` (S1+S2) and ticks again. From this moment on a defect is not an inconvenience
but **unsupervised spending**, so three guards against it are built in by
construction:

- **The starting state is OFF.** Without the `--enable-flag` file on disk the daemon
  launches nothing; a human enables it by creating the file. The first autonomous
  launch will not happen by accident.
- **The emergency brake is `--stop-flag`.** It is checked BEFORE every tick and
  overrides the enable: one `touch` stops the circuit with no knowledge of states
  and no `kill`. The simplest form of S4 is already here, so that there is no window
  between the steps.
- **The global ceiling leaves a trace.** `MAX_CONSECUTIVE_RUNS` launches in a row
  without a single `completed` → the daemon writes `launch-refused` (reason
  `run-budget`) and does NOT launch. The "launch → break → launch" loop hits the
  ceiling and leaves a record instead of burning the quota silently.

One tick = at most one launch: the daemon waits for the terminal state of the pair
it raised and ticks again on a fresh journal, with no races. **The machine-reboot
role** (whether the daemon comes up by itself through systemd or by hand) is john's
ownership fork and lies outside the daemon code: the daemon is the same, only the
way it is STARTED differs. For now the start is manual; the daemon travels into
main disabled, so a merge creates no autonomous spending.

### S4 — a forced stop and printing the journal

Two stops of different strength, plus `log` for john.

- **graceful (`stop --mode graceful`)** creates the `--stop-flag`. The daemon lets
  the CURRENT session run to its natural terminal state (through `draining`) and
  goes dark, taking nothing new. The session is not cut off.
- **force (`stop --mode force`)** creates the `--force-flag` with `by`/`note` and
  announces it in the thread. The observer checks the flag FIRST in every tick (at a
  safe point — between polls, not in the middle of our own write) and puts the
  group down with **SIGTERM** (not KILL: `claude` is given the chance to finish
  writing/committing). The trace is **in two places**: the event `stop {mode:
  forced, by, note}` in the journal (`by`/`note`/`ts` = who/why/when,
  self-sufficient) and a message in the thread (who is forcing and what for). The
  force flag also stops the daemon — otherwise the next tick would raise a role
  right under the force.
- **`orchestrator log`** is the history of events in order, readably (unlike
  `status`, which shows the current state of the leases): what, when and with whom.

**A machine reboot (john's decision — both modes, the choice is made at
installation).** The package does NOT register itself with the system:
`systemd-unit` prints a ready unit, but `systemctl enable` is performed by a human
— a daemon that makes itself permanent would be exactly the surprise that starting
in `disabled` protects against.

- **The enable state survives a reboot by construction.** `--enable-flag` is a file
  on disk, read every tick; after a reboot it is in the position john left it in.
  Autostart (systemd) brings up the DAEMON but does not enable LAUNCHES: disabled
  they stay disabled, enabled they stay enabled (otherwise autonomy would be
  cancelled by every kernel update). **The flags must lie on persistent storage**
  (not tmpfs), otherwise the state will not survive a restart.
- **`status` reflects the mode** (`--mode-file` + `--enable-flag`): how the daemon
  is brought up (autostart/by hand), whether launches are enabled and what will
  happen after a reboot — so that this does not live in somebody's memory.
- **Our installation** (john's machine; john's decision of 2026-07-25, **not part of
  the package** — it is written down here so that it does not live in memory). The
  transitional period: **systemd is NOT enabled**, john starts the daemon by hand —
  `--once` for a single run, without it for a watch. The threshold for autostart is
  named in advance: a week of manual runs without surprises. **The consequence for a
  reboot:** after a restart the circuit will not come up by itself because nobody
  starts the daemon; the `enable` flag survives the reboot and stays in the position
  it was left in, but an enabled flag without a daemon launches nothing. The
  emergency entry for all this time is waking a role by hand (in this repository —
  `wake`); the same way roles the circuit does not launch itself are raised.

### S5 — a hold: the role is taken by a human

A live manual session of a role and the daemon are two claimants to ONE lease: the
mail is waiting on `dev-core`, the daemon sees a candidate and raises a second
session on top of a working one. Of the two forms of coexistence the chosen one is
**"the lease refuses the daemon while a manual session is alive"** (not "the
session is parked forever") — for the transitional period, while the autonomous
circuit is being accepted.

- **`hold --mode take`** — the file `<holds>/<role>`, in the same file pattern as
  enable/stop/force. `--role` and `--by` are checked against the config: a hold on a
  role that does not exist is one the daemon will never match to a candidate — a
  protection that quietly fails to fire is worse than none. A repeated `take` is an
  extension.
- **The deadline lives IN THE FILE** (`expires`), like the `deadline` of
  `lease-acquired`: the holder declares until when the role is taken, and the daemon
  merely compares that with `now`. Otherwise the TTL would have to live in the
  daemon config, and the agreement of two settings would become a condition of
  correctness. The default is an hour, `--ttl` calibrates it.
- **Why not a heartbeat.** The first form (a stamp refreshed by a beating process)
  was rejected during implementation: the beating would be done by a child process
  of the session, and an orphaned child outlives its death and keeps beating — the
  hold stays forever fresh and blocks the circuit forever. That is exactly the
  "hanging while looking normal" class the TTL was introduced against. A deadline
  declared in advance does not have that hole.
- **A hold holds the ROLE, not the pair**: a manual session occupies itself on any
  thread. The daemon launches the other roles as usual.
- **The skip is not silent.** The tick decision `held` is separate from `idle`
  ("there is nothing to do" and "there is something to do, but the role is with a
  human" are different states of the circuit) and is printed as a line every tick.
  It is NOT written into the journal: a hold lives for hours, and a record on every
  tick would drown the session journal in noise.
- **An expired hold is not deleted automatically** — it stays as a trace of "there
  was a manual session here and it did not clean up after itself"; the daemon
  ignores it (otherwise a dead session would block the circuit forever), and
  `status --holds` marks it explicitly.
- **`hold --mode release`** removes it; a clean exit of a session must call it.

### S6 — operation without paths in the commands

john's decision: the package is used as a DEPENDENCY of the repository, and all
actions go through its CLI; there must be no manual `touch`, `mkdir` or
path-arguments in operation. The occasion: preparing the directories, the journal
path, the holds folder and the exact daemon command were rolled out to a human as a
list in a chat — the paths lived in the correspondence, and the second time the
thing was operated it started with reconstructing the command from memory.

- **The `orchestrator` section of the config** — `state` (the directory of the
  operational state), `mailCheckout`, `ref`. **The project says WHERE, the package
  says WHAT is inside**: the names of the journal, the three flags and the holds
  directory remain a convention of the package and are not exposed. Otherwise the
  project would get six ways to lay out something it does not manage.
- **The section is optional** — the package is designed as a foreign one, and a
  repository that carries mail without an orchestrator is legitimate. Its absence is
  caught at the moment an orchestrator command is called, loudly: a silent default
  such as `.orchestrator` would mean a journal where nobody looks for it.
- **`enable` / `disable` instead of `touch`.** The command owns the state directory
  and creates it itself; it prints what the state was BEFORE, what it became and
  where the files lie. Enabling twice gives "already enabled, changing nothing"
  rather than a silent overwrite.
- **The path flags remain an override** (`--journal`, `--root`, `--holds`,
  `--enable-flag`, …) — checks and one-off runs on a copy of the mail use them. In
  operation only `--ref` is required.
- **`status` shows the whole mode**: leases, holds, whether launches are enabled,
  what will happen after a reboot and where every file lies. The README had demanded
  this since S4, but the command could show the mode only to someone who remembered
  the paths.
- **The entry point is `pnpm protocol …`** (the package is in the root
  devDependencies), not a path to the package directory.

**Honestly about the guarantor.** Neither `touch` nor `orchestrator enable` tells
john apart from an agent: "a human enables it" is a PROCEDURAL guarantee and always
has been. The CLI neither strengthens nor weakens it, it removes from the procedure
the places where anyone can go wrong. A technical guarantee (a secret held by the
owner, a signature) is a separate fork.

### S7 — the session permissions in the launch contract

**Found by the first production acceptance run.** The circuit raised a real
session, it lived for five minutes and exited having written nothing: the spawn did
not pass `--allowedTools`, and a default `claude -p` does not write — the role was
physically unable to do the single thing it is raised for. The notion of
permissions was not in the contract at all: S1 was built around "whom and with
which prompt". The P0 spike called the agent with `--allowedTools` and stayed green
all that time, because argv was pinned by nothing.

- **A per-role profile** — `launch.allowedTools` in the config: the permissions of
  different roles will diverge, and they must be read from the role card rather than
  from the code of whoever launches it.
- **A role without a profile is NOT launched** (`no-launch-profile`). A default
  would mean "raised with permissions nobody assigned" — the same class as the
  silent paths before S6.
- **`buildLaunchArgv` is the single place where the arguments are assembled, and it
  is nailed down by a test.** While argv lived as an expression inside the spawn,
  the permissions dropped out unnoticed; without a pinned shape they will drop out
  again the same way.
- **`status` shows the launch permissions** next to the paths.
- **The session output is saved to disk** (`<state>/sessions/`), `lease-released`
  carries the exit code and the path to it, and a run without a passed turn prints
  where to look. Before that, "could not write" and "just exited" produced one and
  the same record, while the reason stayed in the terminal of whoever was watching.

**The set is john's decision: `Bash,Read,Edit,Write`;
`--dangerously-skip-permissions` is not applied under any circumstances.** The
boundary does NOT run along the list of tools: a role needs `Bash` (to run the
tests, commit and push), and once `Bash` is granted, restricting the rest adds
little. The real protections are structural and stand outside — code only through a
PR, the reviewer, branch protection on `main`, the lease deadline, the ceiling of
runs without a completion, and the stop and the force in john's hands.

### S8 — preflight: zero "do not forget" items

The rule named after the third case of one class within a day: **whatever a human
is obliged to remember before a run, the machine either does itself or loudly
refuses.** The paths lived in the correspondence (S6), the permissions nowhere
(S7), the environment and the freshness of the mail in hints in a chat. The price
is the same every time: the circuit looks like it is working and works wrongly.

`orchestrator preflight` checks three things, and `daemon`/`run` call it
themselves, refusing to start on a failure — otherwise it would be yet another "do
not forget" item.

- **The agent binary — BEFORE the lease is taken.** Otherwise the absence of
  `claude` would be discovered by the fact of the spawn, with the lease already
  taken: the journal would be left with an attempt that never happened. It is looked
  up in the PATH of the **child** process, not of our own.
- **The freshness of the mail checkout.** The daemon reads the mail off the disk; a
  stale checkout means "read yesterday's mail and silently worked on it" — in an
  autonomous mode that is not a failure but WRONG WORK: there is a result, it is
  incorrect, and nobody sees it. The package does a `fetch` and a **fast-forward**;
  a divergence remains a REFUSAL. A `reset --hard` would fix the lag and at the same
  time wipe the message a role is writing right this moment — repairing at somebody
  else's expense is not something we do.
- **The environment through the child's eyes** — what the child process will really
  inherit is printed (the node version, the applied preamble) rather than what
  "ought to be". The check is soft: the package does not know which version is right
  for a foreign project, its job is to show the fact.

- **The working repository the session lands in** is always shown (the branch, the
  cleanliness), because the fact is free while "the session started working from
  the wrong branch" is not visible from the outside AT ALL: unlike stale mail, there
  is nothing for it to diverge from. The refusal is opt-in through
  `orchestrator.workdir.branch`: which branch is "right" is knowledge of the
  project, not of the package.

**A LINE THAT COMPARED NOTHING NO LONGER WEARS A TICK (R12).** A check has three
outcomes, not two: `✓` is a passed COMPARISON, `·` is a fact nobody promised
anything about, `✗` stops the circuit. The distinction was paid for twice — twice a
run began from the previous package's branch under `✓ working tree:
agent-protocol/tails-readme`. The line was true, the branch name was right there,
and the tick was read as confirmation of something that had never been checked,
because the project had declared nothing to check against. The working tree with no
declared branch and the environment probe are `info` now; only `fail` refuses, so
nothing that used to start stopped starting.

**Toolchain management (`nvm use` and the like) is not handed to the package** —
that is knowledge about the project, and the package has none of it. The project
declares what its agent needs, in data: `orchestrator.env` — variables on top of
the inherited ones; the package applies them to the child process and shows the
result in preflight.

**The boundary of the mail-freshness guarantee:** it is checked at the START of the
supervisor, not inside every tick. A long-running daemon may read mail that went
stale after it was started; today that is covered by the cycle being short rather
than by a mechanism.

### S9 — the outcome is recorded even by a dead supervisor

The 2026-07-25 acceptance passed on the substance (the circuit raised a session by
itself, and that session wrote an answer) but failed on a formal criterion: the
supervisor stopped existing between the spawn and the terminal state. The session
was left an orphan and finished the job, while the lease stayed `running` forever —
**the journal started lying "it is working" about something long done**. That is
the worst of the outcomes: from the outside it is indistinguishable from normal
work.

- **`supervisor-gone`** is a separate reason for releasing a lease: it is the
  OBSERVER that died, not the session. It is written from the `exit`/`SIGINT`/
  `SIGTERM` handlers, so it survives a normal exit, an unhandled exception and a
  stop from the keyboard alike. **SIGKILL cannot be intercepted, and we do not
  promise that.**
- **A live lease is reported at the supervisor's start** — a new daemon says so out
  loud and hints what to close it with instead of quietly carrying on.
- **The banner states the fact** rather than always "DISABLED": help text that lies
  about the state cost a separate hypothesis about the cause of a failure during the
  analysis.
- Closing an orphaned lease **by forging a `completed` is not allowed**: the work
  was done by the session, but nobody observed the outcome, and the record must say
  exactly that.

### S10 — the session log, and a hang told apart from a long run (R6)

Two failures of 2026-07-25, one package: **every session log was empty**, and **both
breaks recorded as `timeout` were false in meaning** — those sessions were not
stuck, they were working longer than the window. The second could only be analysed
through the first, which is why they land together.

**Why the logs were empty — two causes stacked, and only fixing both makes the file
real.** The supervisor collected **stderr** while `claude -p` says what it did on
**stdout**; and with the default `--output-format text` the agent speaks **once, at
the end of a run** — so a session cut by a deadline or a turn ceiling produces zero
bytes by construction, which is exactly the run whose analysis the log exists for.
Hence `--output-format stream-json --verbose` in the launch contract (an event per
step, as the work happens) and both streams piped through the supervisor.

- **Two files per run.** `<stamp>-<role>-<thread>.jsonl` — the raw stream as it came,
  the primary source; `.log` beside it — a human reading of the same events, stamped
  per line, and the file the journal keeps pointing at. A rendering is lossy, and its
  blind spots are precisely what one needs when the rendering failed to explain the
  break.
- **The rendering never drops a line.** An unknown event kind, a line that is not
  JSON at all (a launcher's complaint, a stack trace) — everything reaches the log
  as it was. The operator keeps the live view: the supervisor relays the same lines
  to its own stdout.
- **The `init` line carries the session id** — the identity a break analysis starts
  from, and the answer R7 will need for the message header.

**Idle detection — by traces, not by content.** A hang and a long piece of work are
indistinguishable by the clock: both spend time. They differ by **side effects**. The
observer samples them every poll — the growth of the session output, a signature of
the working tree (the dirty set plus the head commit), the cumulative CPU time of the
process group — and **any one of them moving means life**. Nothing moving for longer
than the idle ceiling is a new terminal reason, **`stalled`**, distinct from
`timeout`: the first says "it stopped doing anything" and calls for an
investigation, the second says "it was working and did not fit" and calls for a wider
window.

- **Heuristics over the CONTENT of the output are deliberately not done** (curator's
  statement of work): judging meaningfulness by the text means a heuristic over a
  language model's output, and both of its errors are expensive. A trace is
  objective — bytes either appeared or they did not.
- **An unmeasurable trace is not evidence of death**: CPU time is absent without
  /proc, and absence must not read as silence.
- **The verdict does not depend on `--poll`**: the watch keeps the moment of the last
  change, not a count of quiet ticks.

**The three ceilings after this, and their roles.** `stalled` (`--idle`, default 600
s) is the main catcher of a hang; **`--wall-clock` becomes the backstop against the
opposite failure** — a session busy forever, circling and burning quota — and its
default is raised **15 → 60 minutes**, because it is no longer the instrument that
notices a hang and at 15 minutes it was cutting live work. **`--max-turns` is raised
60 → 300**: it limits the length of the dialogue, not time, and the default
calibrated for short packages killed a mechanically large one mid-work (`Reached max
turns (60)`). `--idle 0` switches the detector off. Per-role ceilings in the config
are R12's question — the shape of that section is decided there, once, rather than
twice.

## `spike/` — P0

`headless-cycle.sh` proves that a headless agent (`claude -p`) goes through the
full protocol cycle on an isolated bench: it reads a thread, appends a section,
regenerates the index, commits and pushes, and exits with a code. The result and
the conclusions are in `spike/RESULT.md`. The spike works only in a `$TMPDIR`
sandbox and does not touch the production circuit.
