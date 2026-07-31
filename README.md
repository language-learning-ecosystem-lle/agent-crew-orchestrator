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
- the notification transport (Telegram and the like) is a **separate package** —
  since R4 that is a fact rather than an intention: the core produces events and
  renders text, delivery is taken over by the plugin named in the config, and the
  first one lives in the workspace package `transport-telegram`. The texts are not
  here either — that is the language of a particular team, and it arrives as
  templates (see "Notifications" below);
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

`zones.forbidden` GOT AN ENFORCER in thread 020 (it was the one field with no code
consumer until then): the deny rules a session is raised with, the pre-commit guard of
the role workspace and the CI step all read `roles/zones.ts`, so no two of them can
disagree about what is inside a zone. `zones.writes` is still prose with no consumer —
it says where the role's work lives, and it is deliberately NOT read as a closed
allow-list (`dev-core` declares `writes: []` and may write nearly everything), so the
only field that bans anything is `forbidden`. A role with no `zones` is restricted by
nothing, which is the stated default and not an oversight.

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
a raised session may do), since R12 `limits` — `idleSeconds`, `wallClockSeconds`,
`maxTurns` — and since R15 `agent`, which names the TOOL that raises the role and its
parameters (`kind: claude-code`, plus `model` and `effort`). They sit together because
they answer one question, "what a run of this role is allowed to be", and a role that
needs its own permissions is exactly the one that needs its own window and its own
model. Everything here is optional; anything the config leaves unsaid falls through to
the package default. `idleSeconds: 0` switches the idle detector off, as `--idle 0`
does, and an unsaid `model`/`effort` means the tool's own default rather than a value
we restate.

`agent` is keyed on the tool because the parameters are the TOOL's, not the
protocol's: `effort` is a `claude-code` flag with a `claude-code` vocabulary, and a
flat `model`/`effort` pair would quietly promise that whatever comes next takes the
same two. Keyed this way, a parameter the named tool does not understand is refused by
the schema instead of being dropped in silence, and an unknown tool is refused
outright — the general shape of "parameters of any connector" is R8's question, and
guessing at it from a repository that has never run a second tool would be inventing
an abstraction ahead of its first user.

```json
"launch": {
  "allowedTools": ["Bash", "Read", "Edit", "Write"],
  "limits": { "idleSeconds": 600, "wallClockSeconds": 3600, "maxTurns": 300 },
  "agent": { "kind": "claude-code", "model": "opus", "effort": "high" }
}
```

## The machine config (R14)

**The repository says WHAT, the machine says WHERE.** Roles, permissions, ceilings,
launch parameters, the expected branch — policy, and policy lives in
`agent-protocol.json`, in git, behind a PR. Where the agent binaries happen to sit on
one particular box — location, and location cannot be committed: it is different on
every machine and belongs to none of them.

```json
// ~/.config/agent-protocol/local.json  (or --local-config <path>)
{
  "agents": { "claude-code": { "exec": "/home/j/.nvm/versions/node/v18.20.3/bin/claude" } },
  "secrets": { "envFile": "/home/j/.config/lle/telegram.env" }
}
```

`secrets.envFile` (R4) is a PATH and only a path: the values live in that file, which
is read and never printed, while this one is printed on every preflight. Both fields
say the same kind of thing — where something on this box happens to sit.

The hole this closes was visible in every command typed by hand:
`--exec /home/…/versions/node/v18.20.3/bin/claude`. That path is not knowledge of the
project and never was — it is knowledge of one laptop, living in one shell history,
and a machine without the binary on `PATH` could not start the circuit at all while
nothing anywhere said so.

- **`XDG_CONFIG_HOME`, not a file in the repository.** The fact is a property of the
  machine, not of a checkout: this repository alone has five working trees, and a
  per-checkout copy of one fact drifts silently. `.orchestrator/` was the other
  candidate and is worse still — it is disposable state, written by the package, and a
  hand-written file has no business among files whose recovery procedure is `rm -rf`.
  R13 (remote instances) wants exactly this shape too: one delivery per machine, not
  one per clone.
- **It cannot carry policy.** `roles`, `limits`, `allowedTools`, `permissions`,
  `zones`, `workdir`, `mail`, `orchestrator`, `protocolVersion` are refused by name,
  with the rule quoted — a box quietly running with ceilings nobody reviewed is
  precisely what keeping the config in `main` was meant to prevent.
- **Absence is legitimate.** A machine with the agent on `PATH` says nothing and is
  right to; the binary then falls through to the bare name. A file the operator NAMED
  and that cannot be read IS an error — answering an explicit `--local-config` with a
  silent fallback is how a run ends up using settings nobody chose.
- **It is not versioned by `protocolVersion`.** That number covers data that TRAVELS,
  where two parties can disagree about what they are reading. This file travels
  nowhere: one box, one writer, a human, outside git. What is left of the version's job
  is the diagnosis, and the strict schema gives that directly by naming the field it
  does not know.

The tool id is the JOIN between the two files and is said once in each: the repository
says which tool raises a role (`launch.agent.kind`), the machine says where that tool
is (`agents.<id>.exec`), and a message header says which tool wrote it (`worker`).
Neither file mentions the other.

**Three resolutions, one pattern — the flag, then the standing declaration, then the
default — and each prints its source:**

| what | flag | then | then |
| ---- | ---- | ---- | ---- |
| the tool | `--worker` | `launch.agent.kind` | the package default (`claude-code`) |
| its binary | `--exec` | the machine config | the bare name on `PATH` |
| model / effort | `--model`, `--effort` | `launch.agent` | the tool's own default |

```
agent-protocol: agent — claude-code (role) · exec /home/j/…/claude (machine) · model opus (role)
```

That line is printed on every launch, and `orchestrator status` prints the same merge
for every launchable role. It is not decoration: the two files never mention each
other, so nowhere else can "what would actually be started, and who said so" be read
off in one place.

## Notifications: whom, in which words, through what (R4)

The watch wakes an AGENT. The other direction — the turn has passed to a HUMAN — used
to live in `bin/notify.sh`: a bash script in the project zone that parsed the mail
through the shared entry point but held three unrelated things in one file. They come
apart along lines the package already had:

| the question | the answer, and where it lives |
| --- | --- |
| WHOM to tell | derived from the role model: `wake.mode: self` is a human who reads notifications, `via-human` is an assistant who comes alive only through the named human. `registry.notificationTargets()` has carried that since P1 |
| WHEN | a NEW pair (role, thread) since the last run. The fact of waiting would arrive every five minutes and train its reader to ignore it |
| WHAT is said | the project's templates — `notifications.templates`, three slots |
| HOW it is delivered | a transport plugin named in the config; the first one is the workspace package `transport-telegram` |
| WHERE the credentials are | the machine's secrets file (`secrets.envFile` of the machine config), never either config |

```json
"notifications": {
  "transport": { "module": "transport-telegram", "options": {} },
  "templates": {
    "turn": "⏳ your turn: {thread}",
    "turn-with-nudge": "⏳ your turn: {thread} ({nudged} is next)",
    "nudge": "🔔 {thread} is waiting on {role} — open the chat and poke them ({via})"
  }
},
"announcements": {
  "force-stop": "The session on thread {thread} was force-stopped (by {by}): {reason}"
}
```

- **A template, not a function.** A function would have to arrive as a module path,
  turning "which words do we use" into a second plugin surface with its own contract
  and no way for `config check` to say anything about it. A template is data: it is
  validated at the door, printed, diffed and reviewed in the PR that changes it.
- **An unknown placeholder is a REFUSAL, in `config check`.** Every slot has a fixed
  vocabulary, so `{thraed}` fails in the PR that introduces it rather than at three in
  the morning, in the one message the notifier exists to deliver.
- **The conditional is a SLOT, not a branch inside a string.** A thread waiting on a
  human and on an assistant at once is a queue, not a parallel — the human moves
  first, and the script said so with an awk-glued suffix. The package knows the fact,
  so it picks `turn-with-nudge`; the project writes two plain sentences and never
  learns a template dialect.
- **`announcements` is the language of texts written INTO A THREAD** — today exactly
  one, the force-stop trace. This is R1's leftover question closed: the package's own
  prose is English, and the language of somebody's conversation is theirs.
- **The trigger is a new pair, the text is the FULL composition.** Both halves are
  carried over verbatim from the predecessor, because both were paid for: notify only
  on appearance, but list everything, since a list of one reads as "the rest is
  closed" and that would be a lie at the price of a forgotten thread.

- **The second question: what has NOT MOVED** (thread 024). Since schema v13 the turn
  is held by exactly one role and a human is outside its domain, so "who is awaited"
  can no longer produce a line for a human — `waiting-on` never names them, and the
  trigger "the target appeared in the field" never fires. What is left observable is
  the AGE OF THE HANDOFF: a thread whose turn has stood longer than
  `notifications.stalledAfterMinutes` (default 180) is itself the event. It is asked of
  EVERY open thread, not only of the ones somebody marked as a question for a human: a
  turn standing on an agent for hours is a stalled circuit, and nothing else in the
  package would say so. The age is counted from the handoff rather than from the last
  message — a session that writes into the thread without passing the turn on has not
  moved the fork. A stall is announced once and keyed by the handoff stamp, so a fork
  that moves and stalls again rings again.

- **The circuit dials it — on the daemon's tick** (thread 024). Until then nothing
  called `notify` at all: it could compose the message and deliver it, and the only
  way to make that happen was for somebody to type the command, so the bell rang
  exactly as often as a human remembered it. The daemon now calls it at the TOP of
  every tick — not at the end of a run, because the likeliest producer of a stalled
  turn is a session that died on its window and would never reach an end-of-run hook;
  and at the top rather than the bottom, because a tick blocks for the whole length of
  the session it raises. A courier failure is a loud line and never the end of the
  watch: notifications are a superstructure, and a watch that died of a broken
  transport plugin is not there when the plugin is fixed. Typing the command by hand
  still works — it is now the way to ring out of turn, not the only way to ring. Out
  of turn is not the same as at once: the age filter has no manual branch, so a hand
  dials only the forks that are already over the threshold, and gains one tick at most.

```
agent-protocol notify --ref origin/main --write
```

The order of the side effects is the design: **resolve the transport and the secrets,
send, and only then write the state — for what the transport CONFIRMED.** A setup
defect (a module that does not load, a named secrets file that cannot be read)
refuses while the state is still untouched. So does a delivery that failed: the pairs
it carried were never announced, so they are not marked announced, and the next call
rings for them again. **A failed delivery is a non-zero exit** — a transport that
tried and could not is something one goes and looks at, and a green line in a cron
mailbox would hide it. `unconfigured` stays what it always was, a legitimate silence:
zero, and the state likewise untouched. Without `--write` the command prints the
message it would send and leaves the state alone (this is what `NOTIFY_DRY_RUN=1`
used to be).

The state used to be written BEFORE sending, on the reasoning that a notification is
about a moment no retry brings back — and that reasoning cost a real notification
(thread 029, 2026-07-28): the command printed "2 of them new", the transport answered
"fetch failed", the state was already on disk, the next call said "nothing to
announce", and the human it was for never learned two threads were waiting on him.
Ringing twice is cheap. Not ringing at all is the one thing a notifier must not do.

Freshness is reported and never refused, and that is the one place this command parts
ways with preflight: the daemon refuses on stale mail because acting on yesterday's
mail is wrong work, while a notifier that refuses is a notifier that says nothing —
precisely what it exists to prevent.

**Writing a transport** is one export:

```ts
export const createTransport = ({ options, secrets }) => ({
  async send(text) {
    return { state: "sent" | "unconfigured" | "failed", detail: "one line, NO secrets" };
  },
});
```

`unconfigured` is the load-bearing one: a machine nobody set up to notify is a
legitimate machine, and reporting that as a failure would send an operator looking for
a breakage that is not there. `detail` is printed into a log that lives in a cron
mailbox, so a transport that puts a token in it leaks it for ever — `transport-telegram`
scrubs its own secrets out of every line it emits, and that is a test, not a promise.

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

**`zones check` is the second exception, and it is one for a stated reason.** Its two
doors (the pre-commit hook of a role workspace, the CI step of a PR) read the config
at the ref the change has NOT landed in yet — the base — so that a PR cannot widen
its own zone and pass by its own permission. On a PR that bumps `protocolVersion`
that base is behind the binary reading it **by construction**, and the gate used to
refuse before the zones were ever compared: the guard went red on exactly the class
of change that touches the protocol's own shape. The question this command asks —
"which paths does the BASE policy forbid this role" — does not depend on the number
at all, so it loads the config with `tolerateOlder` and **prints the skew** on every
run. The tolerance is downwards only: a config NEWER than the package still stops
the command, because there the package genuinely cannot know what it is reading.

| version | shape |
| ------- | ----- |
| 1 | the initial one: `_meta.md` + `messages/` with `from`/`date`/`expects`/`waiting-on`, the config with `roles`/`mail`/`orchestrator`, the journal of `lease-*`/`launch`/`stop` events |
| 2 | + provenance in the message header: `worker` and `session`. Optional on READ (history, legacy threads and the migration window cannot be repaired), `worker` REQUIRED on a write. The migration stated the absence outright on everything already written — `worker: unknown`, 331 files, 2026-07-25 |
| 3 | + per-role run ceilings: `roles[].launch.limits` (`idleSeconds`, `wallClockSeconds`, `maxTurns`), every field optional. NO data moves — a version-2 config is already a valid version-3 one; the number exists so an older build says "update the package" instead of "unrecognized key" |
| 4 | + the per-role launch agent: `roles[].launch.agent` (`kind`, and for `claude-code` also `model` and `effort`). NO data moves either, for the same reason. The MACHINE config that arrived with it (R14) is deliberately outside this number — it does not travel |
| 5 | + the texts and the delivery of notifications: `notifications` (a transport module with its options, the three notification templates) and `announcements` (the templates of what the package writes into a thread). NO data moves. The secrets FILE the machine config now points at is outside the number for the same reason the machine config itself is |
| 6 | + the role workspace and the continuation policy (R17, R18): `orchestrator.workdir.worktrees` in the config, and on the journal `launch.mode`/`resumes`/`world` plus `lease-released.session`/`steps`. NO data moves — the journal is not backfilled, and a run recorded before this version is simply never resumed. *(The row was missed by the PR that shipped the version and is restored here.)* |
| 7 | + the interactive turn (R19): `roles[].launch.limits.waitInputSeconds` in the config, and on the journal the `input-awaited`/`input-received` kinds. NO data moves, and the MAIL is untouched — a parked session's aliveness is a runtime file beside its log, not a field in a message header, so no thread needs migrating |
| 8 | + the graceful deadline (R20): `roles[].launch.limits.windDownSeconds` in the config. NOTHING else on disk changes — the deadline reaches a session through the environment of its own process and through its prompt, and neither is stored; `timeout` keeps its name and changes its MEANING (a session that did not land), which is not a migration |
| 9 | + the launch directive in the feed (R21): the message header field `launch` (`model=…, effort=…`) and the role permission `launch-params`. NO data moves — no message carries the field yet, and its absence keeps meaning "raise the role on its standing calibration"; where a directive was applied is PRINTED on the launch line, not stored as an event |
| 10 | + the priority of a thread in the feed (R5): the message header field `priority` (`high \| normal \| low`) and the role permission `thread-priority`. NO data moves — no message carries the field, and its absence means the thread sits at the default `normal`; the queue is recomputed every tick from the feed and PRINTED on the daemon's stream, not stored as an event |
| 11 | + the boxes that raise roles (R13): the optional config section `instances` (`id`, `roles`, `note`) — which machine raises which role. NO data moves; leave the section out and the circuit behaves exactly as before (one box, every role). The machine's half of the join (`instance` in `~/.config/agent-protocol/local.json`) is NOT versioned by this number: that file travels nowhere and has one writer |
| 12 | + the role hosted by a live process (R23-1): `wake.mode` gains `resident` — nothing brings such a role the turn, because its process never left the feed. NO data moves and no role becomes resident by migrating: the mode is a CAPABILITY, and moving a real role onto it is a separate one-line change made only once the hosting process exists. A resident is not raised, not woken and not notified, and is STILL owned — `config check` demands an instance claim it, as the box that HOSTS it |
| 13 | + the turn as a SCALAR (thread 024): `waiting-on` in the message header holds EXACTLY ONE role (`—` — the wait is lifted, no field — "I am not passing the turn"), and a role outside the domain of the turn (`wake.mode: self`) may not hold it. DATA MOVES: the step rewrites every header naming several roles, keeping the first the circuit can WAKE — 153 headers in the live feed, 76 of which name `john` first, and the letter of the statement of work would have written the very header this version rejects at its own door. Messages already naming ONE unwakeable role are NOT rewritten (a lone declaration is the turn its author meant) but are listed by name in the plan |

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

`waiting-on` is a field of the message header, not a line in the prose: EXACTLY ONE
role since v13, an absent field means "I am not passing the turn", `—` means "the
wait is lifted". A header naming two is refused rather than folded — folding is how a
role used to disappear from a declaration. An unknown role in the field **fails the check** instead of being
dropped silently: a silent drop was precisely the mechanism by which a role was
lost from a declaration.

**A role outside the domain of the turn is judged only where the turn actually is.**
`waiting-on: john` in the message that holds the thread's CURRENT turn (the last
declaration of an open thread — the same rule the index and `mail` use) fails the
check. The same value in an older message is a **note**: the feed is append-only, so
that header quotes a state that really was, under a version that allowed it. A
validator condemning history would keep `check` red forever over 48 declarations
nobody may edit, and a permanently red check stops being read — the same defect
("stale is indistinguishable from fresh") the door exists to prevent. Rewriting them
is not the alternative: that is falsifying the journal to get a green tick.

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
agent-protocol zones check  --ref <ref> [--repo <p>] (--role <id> | --role-from-workspace) \
                            (--staged | --base <ref> | --paths <a,b>)
                            # THE CHANGED PATHS AGAINST THE ROLE'S ZONE (thread 020): doors 2 and 3 in ONE
                            # command — they ask the same question and differ only in where the paths come
                            # from (the index in a pre-commit hook, the PR range in CI)
                            # --role-from-workspace: whose commit this is, read from the workspace name (R17)
                            # --ref names the config the verdict is passed with, and door 3 must point it at
                            # the BASE of the PR: a change that widens its own zone must not be judged by it
                            # door 3 itself is the step 'Зоны роли не нарушены' of the job `checks`
                            # (.github/workflows/ci.yml): the role comes from the `role:` line of the PR
                            # description — on the runner there is no role workspace to read it from, and
                            # every PR arrives from one GitHub account, so the author's login says nothing
                            # the paths are read with --no-renames, -z and no --diff-filter — a deletion, a
                            # rename OUT of the zone and a non-ASCII name are each invisible without one of them
agent-protocol mail    --root <comms> --ref <ref> --role <id>              # mail FROM THE THREADS
agent-protocol notify  --ref <ref> [--root <comms>] [--state <p>] [--env-file <p>] [--write]
                                                                           # the turn has passed to a HUMAN (R4)
agent-protocol thread show  --root <comms> --ref <ref> --thread <id> [--tail <n>]
                                                                           # THE READING HALF (R3): the conversation
                                                                           # from the MESSAGES, not from the derived
                                                                           # _thread.md, which lags a push behind
agent-protocol index build  --root <comms> --ref <ref> [--write]
agent-protocol thread build --root <comms> --ref <ref> --id <NNN-slug> [--write]
agent-protocol derive       --root <comms> --ref <ref> [--write]           # all derived files
agent-protocol check        --root <comms> --ref <ref> [--since <ref>]
agent-protocol migrate      --root <comms> --ref <ref> [--id <NNN-slug>] [--write]
agent-protocol new-message  --root <comms> --ref <ref> --thread <id> --from <role> \
                            --expects answer|ack|none [--waiting-on <role>] \
                            --worker <w> [--session <id>] --body-file <p> [--await-input] [--parked-on <person>] [--write] [--no-push]
                            # THE WRITING HALF (R3): --write means SENT — the file, the commit and the push
                            # happen inside, with the replanning retry behind them; nothing is left to type
                            # --body-file lies OUTSIDE the mail checkout: delivery refuses a dirty checkout
                            # --no-push: the file only, for the ONE caller that owns its own git (CI)
                            # --await-input: this question PARKS the run instead of ending it (R19, S13)
                            # --model <m> / --effort <e>: WITH WHAT the runs of this thread are raised from
                            # here on (R21, S15) — only from a role holding `launch-params`, and the value
                            # is checked against the tool's vocabulary at this door
                            # --priority high|normal|low: WHICH waiting thread is raised FIRST from here on
                            # (R5, S16) — only from a role holding `thread-priority`; the queue is priority,
                            # then the age of the wait, then the thread number
                            # --parked-on <person>: the turn STAYS on its holder and is FROZEN until that
                            # person decides (R27) — the pair is not raised and spends nothing; it lifts by
                            # itself with the next substantive message in the thread. Only a role the circuit
                            # cannot wake (`wake.mode: 'self'`) may be named
agent-protocol await-input  --root <comms> --ref <ref> --role <id> --thread <id> [--timeout <sec>] [--poll <sec>]
                            # blocks until the thread waits on the role again; needs a wait declared
                            # beside the question. code 0 — the answer arrived; code 3 — the wait ran out
agent-protocol new-thread   --root <comms> --ref <ref> --id <NNN-slug> --title <t> \
                            --participants <r,r> --from <role> --expects <e> \
                            [--waiting-on <role>] --worker <w> [--session <id>] --body-file <p> [--write]
                            # the NUMBER is refused if a thread already holds it (029): `NNN` is a short
                            # address, and `029` handed out twice made "тред 029" mean two things.
                            # nothing is renamed after the fact — the full id stays unique, the door changes
# the orchestrator: the paths come from the config (section `orchestrator`), operation needs only --ref;
# the path flags below are omitted — they remain an override for checks on a copy of the mail
# the agent binaries come from the MACHINE config (~/.config/agent-protocol/local.json, or --local-config <p>)
agent-protocol orchestrator preflight --ref <ref> [--exec <bin>] [--local-config <p>]   # the checks BEFORE the lease
agent-protocol orchestrator enable  --ref <ref> [--write]                  # ENABLE launches
agent-protocol orchestrator disable --ref <ref> [--write]                  # disable them
agent-protocol orchestrator status --ref <ref> [--now <iso>] [--mode-file <p>] [--max-attempts <n>] \
                            [--stop-flag <p>] [--force-flag <p>] [--pid-file <p>] \
                            [--watch] [--interval <sec>] [--frames <n>]   # the LIVE FRAME + the whole mode
                            # the frame: leases, the PARALLELISM line (how many of this box's roles are live,
                            # which pairs they are, which roles are left free — D-4), holds, the circuit
                            # (gate, stop/force flags, whether a daemon is alive), the queue with the reason
                            # for its order AND the mark on a thread frozen behind a person ('parked-on', R27),
                            # the neighbours' digests, and how old the mail on disk is; then the static half
                            # (paths, permissions, resolution)
                            # --watch redraws THE SAME frame every --interval seconds and READS ONLY
agent-protocol orchestrator record --ref <ref> --kind <k> --role <id> --thread <slug> \
                            [--deadline <iso>] [--reason <r>] [--mode <m>] [--now <iso>] [--write]
agent-protocol orchestrator run    --ref <ref> --role <id> --thread <slug> \
                            [--wall-clock <sec>] [--idle <sec>] [--wait-input <sec>] [--wind-down <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] \
                            [--max-attempts <n>] \
                            [--exec <bin>] [--worker <w>] [--model <m>] [--effort <e>] [--local-config <p>] [--now <iso>] \
                            [--roles <a,b>] [--exclude-roles <a,b>] [--fresh] [--write] [-d|--detach]
                            # attached by default (you watch what you raised); -d backgrounds the supervisor properly
                            # --roles/--exclude-roles: the SCOPE DOOR of the daemon, on the manual launch too (R13, S17) —
                            #   a --role owned by another instance or left out by these flags is REFUSED, not raised
                            # the four ceilings: the flag beats roles[].launch.limits, which beats the package default
                            # --wait-input is the ceiling of a DECLARED wait (R19) and does not come out of the wall clock
                            # --wind-down is the LANDING MARGIN (R20): how long before the deadline the session is asked to
                            #   stop digging and commit; nothing fires at it — the default is 20% of the window (2–15 min)
                            # the tool, its binary and its parameters: see "The machine config" above
                            # the role works in its OWN worktree (orchestrator.workdir.worktrees), put back at the base
                            # per fresh package; --fresh forbids resuming the previous session (S11, S12)
agent-protocol orchestrator daemon --ref <ref> [--tick <sec>] [--wall-clock <sec>] [--idle <sec>] [--wait-input <sec>] [--wind-down <sec>] [--poll <sec>] \
                            [--max-turns <n>] [--max-runs <n>] [--max-attempts <n>] [--exec <bin>] [--worker <w>] \
                            [--model <m>] [--effort <e>] [--local-config <p>] [--fresh] [--once] \
                            [--roles <a,b>] [--exclude-roles <a,b>]
                            # --roles/--exclude-roles: WHICH roles this launch raises (R13, S17), mutually exclusive,
                            #   on top of the instance filter — a role owned by another box is never raised here
                            # the two GATES: --max-attempts (failures of one pair since its last delivery)
                            # and --max-runs (launches in a row without a completed); both print their source
agent-protocol orchestrator log    --ref <ref>                             # the history of events for john
agent-protocol orchestrator stop   --mode graceful --ref <ref> [--write]
agent-protocol orchestrator stop   --mode force --ref <ref> --by <who> --reason <why> --thread <slug> [--write]
agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> --by <who> [--ttl <sec>] [--note <t>] [--write]
agent-protocol orchestrator hold   --mode release --ref <ref> --role <id> [--write]   # the role is taken by a manual session
```

**The agent's whole legal contact with the mail is TWO commands** (R3): `thread show`
to read and `new-message --write` to send. Everything below the two — the branch, the
checkout, the directory layout, the file names, the commit and the push — is storage
mechanics, and mechanics is the layer an agent must not have to carry (john's
decomposition of "what an agent knows about comms" into content / protocol semantics /
storage mechanics, 2026-07-25). It is INCAPSULATION, NOT CONCEALMENT: the agent keeps
its shell, and the claim is only that the legal path needs nothing else.

**Reading is `thread show`** — from the message FILES, never from `_thread.md`. The
assembled file is derived and lags a push of the generator behind, so a reader who
trusts it can miss precisely the message that passed it the turn. `--tail <n>` exists
because a live thread outgrows a context window (016 passed 300 KB in two days), and
the honest alternative to a bounded read is a reader who quietly reads nothing at all:
how many messages are hidden is said out loud in the output. Folder attachments are
NAMED rather than printed — the agent no longer needs a description of the layout to
know what else is in the conversation.

**Writing is `new-message`** (the single source of truth on the form of a write): it
creates the file `messages/<UTC-stamp>Z-<role>.md` and does NOT touch `_thread.md` or
`INDEX.md` — those are rebuilt by the generator, and staging them here would make every
concurrent write a conflict in a file nobody authored. The stamp is **monotonic along
the feed** (`max(now, the last one + 1s)`): an answer does not land before the message
it answers when the writers' clocks are skewed. `--waiting-on` takes ONE role — the turn is
held by exactly one since v13 (a list is refused at the door, and so is a role the
circuit cannot wake: `wake.mode: 'self'` holds no turn, and "a decision from them is
needed" is a turn for whoever carries the question).

**`--write` means SENT, not "a file on disk"** (R3): the commit and the push are inside
the command. That tail is exactly where this circuit's real losses happened — a heredoc
inside an `&&` chain silently lost the body while the chain reported success, and a
rejected push left a message that existed on one disk only. A rejected push is retried
by **REPLANNING, not rebasing**: the feed is append-only and the stamps are monotonic,
so the loser of a race has to change its NAME as well as its place — a rebase would
carry the old name across and leave two messages in an order their names deny. A dirty
mail checkout is a **REFUSAL**, never a repair (the same rule the workspace of a run
follows, R17 — there a break of the circuit's own making is parked in a stash instead,
but nothing is ever overwritten): the retry resets the checkout hard, and doing that over somebody's unfinished
message destroys work to deliver ours. Hence the body file lives outside the checkout —
an untracked draft beside the mail is dirt like any other. `--no-push` is the ONE named
exception, for a caller that legitimately owns its git: the CI workflows write from a
checkout the runner set up (where `origin/comms` does not exist at all — the mail is
fetched without a refspec), batch the commit with their own work and push under the
runner's token. A named flag is honester than a command that behaves differently
depending on where it runs.

**ONE WRITER AT A TIME INSIDE THE MAIL CHECKOUT** (D-0, thread `023-daemon-parallelism`).
The checkout is one directory per instance, not one per role, and between the write and
the commit it is DIRTY BY CONSTRUCTION — so two overlapping deliveries end either with
the second refusing on the first's dirt, or with the first's retry resetting the second's
half-written message away. Every writer therefore takes a lock on the checkout for the
whole `write → commit → push`: the lock file sits in the checkout's **git directory**
(per-checkout, and invisible to `git status`, since a lock inside the tree would be the
very dirt delivery refuses). A **live** holder is waited for up to a ceiling (2 minutes
for a message, 20 seconds for the instance digest — a status line yields to the mail) and
then refused BY NAME, saying who is inside and for how long; a holder whose **process is
gone** is taken over loudly, because a lock outliving its session would take the mail of
the whole box down until a human noticed. A local mutex is enough by R13: the roles of a
box are raised by one daemon on one machine. Two boxes with two clones are two locks —
what they race over is the remote, and the push retry already settles that.

`new-message` **REFUSES** to write into a non-migrated (legacy) thread:
a file write would cut its history down to a single file — a legacy thread is
appended to by hand as a section in `_thread.md` until it is migrated (right now
that is only 009/010).

### `merge-gate` — the guards of a merge that are facts (thread 026)

```
agent-protocol merge-gate --ref <ref> --pr <n> [--repo <path>] [--power-docs <a,b>] [--working-cards <a,b>]
```

The `curator` role merges pull requests itself, under five guards. Three of them are
facts about the pull request and this command answers them in one call: an `approve`
verdict **on the current head**, green checks **on that same head**, and no **document
of power** in the diff. Exit 0 — nothing in the facts forbids the merge; exit 1 — a
guard does not hold. The facts come from `gh pr view --json` (the tool a session
already runs to look at a PR; its authentication is the operator's), and its answer is
validated at the door — a renamed field is a refusal by name, never a silent "no
reviews, no checks", which for a merge gate would fail open.

**Two guards are never reported as passed, and that is the point.** Whether the feed
really holds a decision of john's behind this PR (guard 3), and whether the merge gets
written up with its guards afterwards (guard 5), are judgements no JSON answers. They
are printed as OBLIGATIONS. A tool that said "all five green" would be lying about two
of them, and the lie would be load-bearing: the whole purpose of guard 3 is to stop
curator merging what curator set. The one mechanical half of guard 3 that IS checked —
the `thread: NNN-slug` line of the description — is a refusal when missing, because
without it there is nothing to ascend to.

**The documents of power are derived, not listed in code:** the `instructions` paths of
every role (a card is what defines a role's authority) and the protocol config itself
(permissions and zones live there). Entries match as path prefixes, exactly as `zones`
entries do. Hard-coding `PROTOCOL.md` in the package would turn one project's file
layout into the protocol's knowledge — the line this package does not cross.

The declared side is where a project puts everything its own norm sends to a human,
whether or not the word "card" fits it: here that is `PROTOCOL.md` **and
`.github/workflows`** — a workflow is nobody's role card, but a change to one goes to
john by the same boundary, and until it was declared the gate answered a workflow PR
with "none of them a document of power", which is silence exactly where the norm
refuses.

**But a role's instructions are not always a document of power** (john's decision of
2026-07-28, on the reviewer's finding against the first version of this command): the
boundary runs by the NATURE of the document, not by the fact that a role points at it.
A role card says what a role MAY do; a WORKING card — `CLAUDE.md` in this repository —
is the instruction a session works by, updated in the same commit as the code it
describes, which under this project's rule 3 is almost every package. Derived from
`instructions` alone, guard 4 stopped every one of those, and that would have eaten the
autonomous merge as a class — the very thing the guard exists to make safe, not to
prevent. So the caller names its working cards, `--working-cards CLAUDE.md`, and they
are subtracted **from the derived side only**: a path also passed to `--power-docs`
stays a document of power, because saying it outright is the stricter statement. Both
the subtraction and any entry that matches no role's instructions are printed — a flag
that quietly hits nothing is a flag its author believes in.

What the subtraction leaves behind is a norm, not a hole, and it lives in curator's
card: a change to `CLAUDE.md` that moves authority, borders, permissions or zones goes
to john, and doubt reads as "it moves them".

**One head answers once per check name.** A rerun does not replace the attempt it
reran: both hang on the same head in `statusCheckRollup`, and read flat, the door
refused #89 for a `review=FAILURE` a rerun had overwritten fifteen minutes later. So
the runs are grouped by name and only the **last attempt** of each is judged — last by
TIME (`completedAt`, else `startedAt`), never by position in the array, which `gh` does
not promise to order. The border in the other direction is as load-bearing: a rerun
still in flight is not swallowed by an older success — the latest attempt wins, and a
latest attempt that has not finished has not ANSWERED, which is what guard 2 asks. When
no stamp tells the attempts apart, the whole group is judged: an unreadable payload
refuses rather than passes. And a flying run comes back with `conclusion: ""`, not
null — every field of a check is read as "empty text is no text", so the refusal says
`review=IN_PROGRESS` instead of the blank `review=` it used to print, blind exactly
where the reader decides whether to wait or to fix.

**One head also answers more than once per reviewer.** The same defect sat in guard 1,
one step earlier in the door: it read the PRESENCE of a `CHANGES_REQUESTED` on the head
instead of the LAST verdict on it, so a second round of review that ended in `approve`
on the very same head still refused, and two approved PRs (#74, #64) stood blocked by
it. Verdicts are therefore grouped **by reviewer** and only the last one of each is
judged, by `submittedAt`. The symmetry is what keeps this from becoming a hole: an
`approve` overtaken by a later `changes-requested` on the same head STOPS — otherwise
the fix would turn a fail-closed door into a fail-open one. Verdicts on other heads
never enter the count (that is the guard's whole point), a group whose stamps cannot
tell its verdicts apart is judged whole and refuses, and states that are not a verdict —
`COMMENTED`, `DISMISSED` — do not overtake one: a comment is not an answer.

**And a verdict can have no commit at all, which `reviews[].commit` hides.** A review
submitted without a `commit_id` — what the reviewer's action produces when it is
re-triggered by `workflow_dispatch`, because that run hangs on the head of `main` and
not on the head of the PR — comes back from `gh` carrying whatever head the pull request
has **at the moment of reading**. One and the same approve on #64 (`submittedAt`
03:46:02Z, untouched) read as "approved on `c1dc1a3`" and then, after a
`gh pr update-branch`, as "approved on `ea8572a`" — an approve granted once outliving
every later push, which is precisely what guard 1 exists to forbid.

**The field that would admit it does not exist, and this cost a round.** The first
repair read the anchor out of `latestReviews`, on the belief that `commit.oid` is empty
there only for a verdict submitted without one. Measured across #62/#64/#108/#109/#110
and #111, `latestReviews[].commit.oid` is empty for **every** review, anchored ones
included — `gh` does not resolve that field in this array at all, and a door built on it
refuses every PR there is. Neither answer of `gh`, nor `commit_id` of the REST reviews
endpoint, tells an anchored verdict from a substituted one in a single read.

**So the door asks time, which cannot be substituted:** a verdict cannot be an answer
about a commit that did not exist when it was submitted. The `committedDate` of the head
commit is read beside the reviews, and a verdict older than it STOPS the door in its own
words — what is missing is a review run on the `pull_request` event (re-label, or
`gh pr update-branch`), which is a different repair from "no approve" (a new round) and
from "the approve is on an older head" (a rebase). A `CHANGES_REQUESTED` in that state
stops it too: a verdict whose target is unknown opens no door, whichever way it points,
and a verdict with no stamp at all that claims the head is refused for the same reason —
"judge the group whole when time cannot tell it apart", as above. What this closes is
the PERMANENCE, which is the whole point of guard 1: every push makes a commit younger
than the verdict, so an approve stops travelling to code nobody answered about. What it
does not do is tell a `workflow_dispatch` verdict from a `pull_request` one while the
head has not moved — and there it need not, since such a run read the tree the head
carries now; the other half of that story is guard 2, which a dispatch run never
satisfies, its check hanging on the head of `main`. A head commit gh did not date leaves
the reading exactly as it was before this thread.

**`mergeable` is read, and it is NOT a sixth guard.** The five are a norm of the role
card and of `PROTOCOL.md`; code does not add to them. But the gate was blind to the
mergeability of the branch altogether — a PR with a conflicting tree, one clean set of
checks and an approve would have passed guards 1, 2 and 4 "by the facts" and been
refused by GitHub itself at the merge. So `mergeable`/`mergeStateStatus` are printed as
a FACT beside the guards, on their own line, and anything that is not a plain
`MERGEABLE` refuses with exit 1 like a failed guard: `CONFLICTING` names the rebase,
`UNKNOWN` says GitHub has not finished computing and to ask again, and a `gh` that did
not report the field at all is a refusal at the door — never folded into "go ahead".
GitHub computes the field lazily, though: the FIRST ask about a PR starts the job and
answers `UNKNOWN`, the next one answers for real — on every open PR here, not now and
then. A single ask would therefore refuse almost every first run, so the command asks
again itself, once, and only then reports `UNKNOWN` as an answer.

**The token needs the `checks` scope.** Guard 2 reads `statusCheckRollup`, which GitHub
serves only to a token holding `checks: read`. A personal token has it; a GitHub App
installation token (`ghs_…` — what any `gh-action` executor of this protocol runs with)
has only the scopes its job's `permissions:` block lists, and an unlisted one is zeroed
rather than defaulted. The whole `gh` call then fails with `Resource not accessible by
integration` instead of degrading, so the gate answers nothing at all rather than
answering wrongly — and the refusal names the scope, because GitHub's own message does
not. This is observed, not hypothetical: it is how the reviewer of this very PR found
that its "live run" had only ever been made from a session token.

**Why the project's extra documents come in on `--power-docs` and not from a config
section**, which is the shape one would otherwise pick: a new config field costs a
protocol version by R2, and **a version bump cannot currently be committed at all**.
The zones door reads the config at `origin/main` — still at the old number — with the
package of the working tree, which writes the new one, so `loadProtocolConfig` halts
`zones check` in the pre-commit hook and in the CI step alike. That is a defect of the
door (it is the first bump since the door was built) and not of this command; when it
is settled, moving the list into the config is a few lines.

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
  `completed|forced|exited-without-handoff|supervisor-gone|timeout|stalled|input-timeout|exited-while-waiting|exhausted|quota-exhausted`;
  a `quota-exhausted` also carries `until` when the signal named the reopening time,
  and `window` — the vendor's own word for WHICH window closed, which is the key of the
  backoff shelf),
  `launch-refused` (with a `reason`: `run-budget|quota`, S3) and `stop` (with a `mode`). The
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
  attempt ceiling on a (role, thread) pair is reached, we launch no more). Both signs
  are in the data from S0 on; the behaviour based on them (releasing on timeout,
  refusing to relaunch) arrives with S2/S3.
- **THE ATTEMPT COUNTER IS CONSECUTIVE, AND IT IS PRINTED WITH ITS CEILING**
  (`attempt 1/3`). It counts the failures of a pair SINCE ITS LAST DELIVERY — a
  `completed` release or a handoff puts it back to zero. A cumulative count was the
  defect of 2026-07-26: dev-core×016 stood at `attempt 13` with eleven completions
  behind it and had dropped out of the candidates for good, which is not a protection
  but a bomb with a counter — any long-lived thread reaches it eventually, no matter
  how well it works. A handoff resets it as well as a `completed`, because the turn
  passing IS the delivery: a supervisor that dies right after one leaves
  `supervisor-gone` on a run that did its job.

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
layers:** per (role, thread) pair — `exhausted` from S0 (`--max-attempts` failures
in a row WITHOUT a delivery, then a refusal); and global — `--max-runs` launches in a
row without a single delivery by ANY pair (aimed at the S3 auto loop). **A delivery
means the same thing to both** (one predicate, `isDelivery`): a `completed` release
**or a handoff** — the turn passing IS the delivery, the release is the observer
writing it down. So a run of "handed off, then the supervisor died before it could
write the release" resets both counters instead of walking them to their ceilings for
someone else's crash; the global gate had that defect until 2026-07-26, one day longer
than the per-pair one. **Both are flags and
both print where their number came from** (`gates — attempts-per-pair ≤ 3 (default) ·
runs-without-delivery ≤ 10 (flag)`): before 2026-07-26 the first of them was a
constant no flag could reach, so an operator raised `--max-runs` at a pair the OTHER
gate had dropped and nothing in the output could tell them so. Neither gate has a
per-role field in the config yet — the config's `launch.limits` describe a RUN, these
two describe how the orchestrator treats a PAIR and the circuit; when a project asks
for a per-role attempt ceiling it slots into the same resolution and starts printing
`(role)`. `--exec` is injected: e2e and live acceptance aim at the real binary, the
mechanics checks aim at a stub. Without the flag the binary comes from the machine
config and, failing that, from `PATH` — see "The machine config" above.

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
- **A CLOSED WINDOW IS NOT A FAILED ATTEMPT** (finding C, thread 023). A session cut
  off by the rate limit exits by itself without passing the turn, so until D-3 it was
  recorded as `exited-without-handoff` — a failed attempt — and three of those marked
  the pair `exhausted`, taking the role out of the circuit for a cause that was never
  its own. The quota now has its own reason, `quota-exhausted`, recognised from the
  session's own stream (`quota.ts`) and EXCLUDED from the attempt ceiling: the window
  is one shared resource of the whole box, so the same closure hits every role at
  once, and with parallel supervision (D-2) the misattribution arrives in a fan.
  **The source of the recognition is the stream's structured `rate_limit_event`**
  (`rate_limit_info: {status, resetsAt, rateLimitType}`) — present on every turn of
  every captured stream of this box, so the reset time comes from the vendor rather
  than out of prose. A status that PERMITS work is the whitelist (`allowed`,
  `allowed_warning` — both observed, which is why the test is on the prefix and not on
  equality: `allowed_warning` is a 76%-of-the-window warning, and refusing on it would
  close an open window), anything else is a named refusal. The two prose forms stay as
  the layer below, for the shapes the event cannot reach — a hard cut mid-run, and the
  launcher's own refusal before a session exists, which arrives on STDERR: both streams
  go through the same latch. The
  reason is checked before "the process exited" and after `handedOff`/`idle`/`overdue`
  — a run that passed the turn before the window shut succeeded, and a run that had
  already stalled is diagnosed by whatever came first.
- **THE BACKOFF: A CLOSED WINDOW STANDS THE BOX DOWN UNTIL IT REOPENS** (D-3 part 2).
  The reason above stopped a window-cut session from being blamed for the closure; this
  is what stops the tick from walking into the same closed door every tick. It is a FOLD
  OF THE JOURNAL (`openQuotaShelves`), not a state file: the journal is this box's own
  append-only file, read whole on every tick, so the shelf cannot drift from the events
  that produced it. Three properties are load-bearing:
  - **The shelf is per INSTANCE, not per role.** N parallel sessions burn ONE window, so
    a signal from any role stands every role of the box down. A per-role backoff would
    leave the other N−1 roles walking into the same door — the very thing this removes,
    in N−1 copies.
  - **One shelf per WINDOW TYPE.** `five_hour` and `seven_day` are both real here (140
    and 6 observations); one shelf for both would open the door six days early in one
    direction and freeze the circuit for a week in the other. The key is the vendor's own
    word, so a type we have never seen gets its own shelf instead of being folded into
    one of ours.
  - **A signal without a time gets a SHORT shelf (`SHORT_SHELF_MINUTES`, 5m) and says so.**
    "Closed, reopening unknown" must not be inflated into "closed for five hours": the
    cost of too short is one launch that immediately re-signals and re-shelves, the cost
    of too long is hours of a circuit that could have worked. A repeat signal extends it.
  The tick returns its own decision kind (`quota`), every candidate it stands down comes
  back as a skip with that reason, and the daemon says the shelf out loud EVERY tick —
  while the journal gets ONE `launch-refused {reason: quota}` per shelf, not one per tick.
  The shelf ends **by the clock and by nothing else**: a backoff that needed clearing by
  hand would be `exhausted` under another name. It is visible in `orchestrator status`
  (its own `quota:` panel, which also says when no window is closed) and in this box's
  **instance digest** — a box standing down has no live leases to publish, so without it
  the neighbours would read its silence as "nothing to do".
- **A TURN THAT STAYED ON THE ROLE IS STILL A DELIVERY** (thread 023, john's decision
  of 2026-07-30 — the same class as finding C above). Scalar `waiting-on` (v13) does
  not accept `john`, so "this needs a human decision" has exactly ONE legal shape: the
  role that carries the question keeps the turn on itself. Such a run writes its
  message, verifies it in `origin/comms` and exits — and `handoffDetected`, which asks
  only "does the thread still await the role?", sees no handoff: `exited-without-handoff`,
  a failed attempt. Reproduced as a controlled comparison on one thread within nine
  minutes (two curator runs of the same class; the only difference was the value of
  `waiting-on`), after five runs had already been misrecorded and four pairs had gone
  `exhausted` for following the norm — and an `exhausted` pair does not come back on
  an answer, because the reset hangs on a delivery and an answer that leaves the turn
  where it is is not one.
  **The differentiator is THE MAIL, not a new event** (`isSelfTurnDelivery` +
  `sessionsThatWrote`): a `lease-released` carrying a `session` that also signs a
  message in the mail delivered; a session that wrote nothing did not. Both halves are
  load-bearing — silence is exactly the failure the ceiling exists for. Judging by the
  mail rather than by a new outcome name is what makes the correction RETROACTIVE: the
  journal keeps its honest record of what the observer saw, and pairs already
  `exhausted` come back the moment a reader hands the fold the set — no hand rewrites
  an append-only file. Every reader that judges launchability is given it (the daemon's
  tick, `run` and its dry run, the operator frame); a caller with no mail at hand folds
  exactly as before.
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
  without a single delivery → the daemon writes `launch-refused` (reason
  `run-budget`) and does NOT launch. The "launch → break → launch" loop hits the
  ceiling and leaves a record instead of burning the quota silently.

- **Nothing drops out silently.** Every candidate the tick declines to raise is
  named in the stream with its reason (`candidate dev-core×016-protocol-roadmap
  skipped: exhausted — 13 failed attempts since its last delivery, ceiling 3
  (default)`), and "nothing to launch" is a LINE, not an absence of lines: an empty
  mailbox and an exhausted pair say so in different words. This was the other half of
  the 2026-07-26 defect — `daemon --once` printed its banner and exited without a
  word, which from a terminal is indistinguishable from "no mail arrived". The skips
  are NOT written to the journal (a hold or an exhausted pair lasts until a human
  looks at it, and a line per tick would drown the journal of the runs); the stream
  carries them, every tick. **The four reasons ask for four different things**:
  `held` — wait for the manual session; `active` — nothing, the pair is being worked
  on; `waiting` — ANSWER, the session is parked on a question of its own (R19);
  `exhausted` — read the journal. `waiting` is spelled out separately from `active`
  for the sake of the only one of them that is blocked on a human: a parked session
  reported as "running right now" gets the operator to do nothing, and the wait then
  ends in its own ceiling.

- **A dead network does not kill the watch** (R6-достройка, john's decision of
  2026-07-26). The one thing that used to end the daemon before it started was the
  cheapest failure there is: the mail fetch in preflight. A hiccup at the wrong
  second, and the watch built to outlive a broken session did not outlive the
  network — after which nobody was left to raise anyone once it came back. Now the
  daemon judges preflight differently from `run`: **a failed mail probe leaves it
  alive and launching nobody, everything else still refuses before the first lease.**
  The split is by SELF-HEALING, not by severity — a stale checkout heals the moment
  the remote answers, a missing agent binary does not, and a daemon spinning on the
  latter would print the same line forever. While degraded it says so every tick, in
  git's own words (`LAUNCHING NOBODY, the mail is not readable: …`), and re-runs THAT
  PROBE ONLY — the checks that passed are not asked a second time. **The tick is the
  retry**: no back-off, no counters. The stop and force flags are read BEFORE the
  probe, so an outage can never block the off switch, and the enable gate works as
  usual. Launching nobody is not a softening: acting on yesterday's mail is the wrong
  work preflight exists against — the daemon is a watchman with a broken gate, and it
  opens the moment the gate works (`the mail is readable again …, launches resume`).
  **Freshness is NOT re-checked inside a healthy tick** — the guarantee stands where
  S8 put it, at the start; only a probe that FAILED is re-run.

One tick = **a plan: at most one launch per free role** (D-1, thread
`023-daemon-parallelism`). The natural ceiling is the WORKSPACE — one per role (R17) —
so the degree of parallelism of a box is the number of its free roles, and `planTick`
decides in one pass, against one reading of the journal, which pair each of them gets.
A role already in the plan on an older thread comes back as the skip `role-busy`: not
lost, first in line for that role next tick. **The global budget is read ONCE per tick
and cuts the TAIL of the plan** — it counts launches, so a plan of N spends N of it —
with ONE `launch-refused` recorded against the head of what was cut, and one line
naming every pair in it. A record per cut pair would say the same sentence about one
ceiling N times.

**The plan is still RAISED head-first, one at a time** — the supervision is blocking
until D-2 (N supervisors in one daemon). The tail is not spent sequentially inside the
tick on purpose: `runOne` returns hours later, and acting on the rest of the plan then
would be raising decisions taken before the mail, the holds and the stop flag were last
read. So the daemon waits for the terminal state of the pair it raised and ticks again
on a fresh journal, with no races, and says out loud which planned launches it deferred.
**The machine-reboot
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

**`Restart=on-failure` in that unit is the SECOND echelon, not the first.** The
daemon survives what heals by itself (the mail probe above) inside its own loop; the
unit covers what it cannot survive — a crash, an OOM kill, a fatal check that was
repaired while the process was down. The two do not overlap: a restart loop on a
missing binary would be the same forever-line the in-loop split refuses, only louder,
so the fatal path deliberately exits and stays exited until a human acts.

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
  up in the PATH of the **child** process, not of our own. Since R14 the line names
  the TOOL and the layer that gave the path, and a binary nobody named at all is
  refused with the repair quoted (`agents['claude-code'].exec` in the machine
  config) instead of a bare "not found". **The binaries of EVERY launchable role are
  probed**, not one of them: the daemon raises several roles and they may name
  different tools, so probing whichever happened to be first would answer a question
  nobody asked.
- **The machine config itself** is printed as a FACT (`·`), always: which file the
  paths came from is the first thing one wants when a run started the wrong binary,
  and the second thing one wants when it started none. Its absence is a legitimate
  state, so there is nothing here to pass or fail.
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

- **Where the sessions will work.** With `orchestrator.workdir.worktrees` declared
  (R17, S11) each launchable role's own worktree is reported — where it is, at which
  commit, whether it is clean — and the operator's checkout is printed as a fact that
  is compared with nothing: comparing it would resurrect the very refusal R17 removes.
  Those lines never `fail`, because a workspace belongs to ONE role while preflight
  stops the whole circuit; the refusal happens in that role's launch instead. Without
  `worktrees` the pre-R17 line stands: the inherited checkout is shown always (the
  fact is free, while "the session started from the wrong branch" is not visible from
  the outside AT ALL), and the refusal is opt-in through `orchestrator.workdir.branch`.

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

### S11 — the workspace of a role (R17)

Until now a session worked wherever the daemon happened to be started: a spawned
process inherits its parent's working directory, and **nobody had ever chosen one**.
Three consequences, all observed rather than imagined — a package ended with the
OPERATOR'S checkout on `agent-protocol/<something>` and the next preflight refused on
`workdir.branch`; whatever the previous session left uncommitted was what the next one
started from; and two roles could not run at once by construction, for a reason
written down nowhere.

**The orchestrator hands the role a workspace**: `<worktrees>/<role id>`, a git
worktree of the same repository. The project says where those live
(`orchestrator.workdir.worktrees`), the package says that one role gets one directory
named after it. The operator's main checkout stops being anybody's workplace — which
is also what makes it safe to keep using.

```json
"orchestrator": { "workdir": { "branch": "main", "worktrees": ".worktrees" } }
```

- **Detached at the base COMMIT, not "on the base branch".** Git refuses one branch in
  two worktrees, and the base branch is normally checked out in the operator's own
  tree. A detached head is the same starting point without the collision, and it is
  honest about what a package start is: a point to branch from.
- **The base is `origin/<branch>` when it exists**, the local branch only as a
  fallback, and the ref used is printed beside every decision. A local `main` that
  nobody pulled is exactly the stale premise the circuit exists to stop, and a session
  will never notice it started from one.
- **Before every FRESH package the workspace is put back at the base**; a clean tree
  on the previous package's branch is simply moved, and nothing is lost — that branch
  still exists and still points where it did.
- **A DIRTY workspace is never OVERWRITTEN, and what happens to it depends on WHOSE
  dirt it is** (thread 023, requirement 5). `checkout --detach` over uncommitted changes
  destroys exactly the material needed to understand a break, so it never happens; but
  "always refuse" made the next package pay for the previous one's death — the role
  stood still until a human stashed the tree by hand, four times in one morning, in
  every case over dirt left by a run the circuit itself had cut off. The plan therefore
  reads the release reason of the pair's previous run, which the launch is holding
  anyway:
  - the circuit **cut the run off** (`quota-exhausted`, `timeout`, `supervisor-gone`,
    `stalled`) → the tree is **parked in a stash** labelled `wip <thread> <session>
    <reason>` and then moved to the base like any other. `git stash push -u` — the
    untracked files go in too, and it is the one gesture that is both complete and
    reversible (`git stash apply`). Nothing is lost and nothing is judged;
  - the run **ended its own turn** (`completed`, `exited-without-handoff`, the two
    interactive endings, `forced`) → a **refusal that calls the dirt what it is: an
    error of finishing.** A session that passes the turn on leaves a clean tree, so this
    is a defect to read, not leftovers to tidy;
  - **no finished run to attribute the dirt to** → a refusal as well: it may be a
    human's, and the package does not park work whose owner it does not know. An
    unknown reason from a future version falls here too — the break list is a whitelist.

  The whole fork is decided by `planWorkspace`, a pure function, and only carried out by
  the CLI: it is the one branch in the package that touches work nobody committed, so it
  is held by a test rather than by a reading of the code.
- **A run that ends its own turn and leaves the tree dirty is NAMED IN ITS OWN RELEASE**
  (the second half of requirement 5, `dirtLeftByFinish`). The bullet above decides what to
  do with such a tree at the NEXT launch, which is the wrong end of the run to learn it
  from: the failure then surfaced as a role silently skipped an hour later, and a human
  read the tree to work out which run had made it — four times in one morning. So the
  supervisor asks the question at the release, of the workspace it handed out, and the
  answer goes to two places: `dirty: true` on the `lease-released` event (rendered by
  `log` as `LEFT THE WORKSPACE DIRTY`, so the question "which run left this" is asked of
  the journal) and a sentence on stderr that names the tree and what it costs the next
  package. The condition is the COMPLEMENT of the break list, so the two halves cannot
  drift apart: dirt after `quota-exhausted`/`timeout`/`supervisor-gone`/`stalled` is the
  stash's business, everything else is an error of finishing. The flag is `true` or
  absent, never `false` — a run raised without workspaces declared works in the operator's
  own checkout, whose state the circuit never judges, and a `false` there would be a claim
  nobody made.
- **The refusal belongs to ONE role, not to the circuit.** In the daemon it is a loud
  line on every tick and that role stands still while the others keep going — the same
  treatment a hold gets, and for the same reason: it lasts until a human looks at the
  tree, and a journal entry per tick would drown the record of the runs. In the manual
  `run` it is an exit code on the terminal of whoever typed it.
- **`workdir.worktrees` is optional and its absence is the old behaviour verbatim**:
  the session inherits the checkout, and `workdir.branch` is compared against it. The
  package will not invent a directory for git worktrees inside somebody else's
  repository.
- **The workspace is LOCKED from before the tree is touched until the lease is
  released** (`git worktree lock`, john's requirements of 2026-07-25, 21:10 and 22:20).
  Two failures, one lock:
  - *cleanup under a live session* — `prune`/`remove` refuse a locked worktree; this
    part git enforces;
  - *a second mutator* — a manual `run` racing the daemon, a second thread of the same
    role, a human moving the tree. Git does not stop another process from writing into
    a locked tree; **the package refuses to start a run in a workspace somebody else
    locked**, exactly as it refuses a dirty one. The lease guards the pair
    (role, thread); the lock guards the TREE, which they share.

  The reason text names the pair, the supervisor's pid and the moment — so a lock left
  behind by a killed run is identifiable rather than merely mysterious, and
  `orchestrator status` says which of the two it is holding ("locked by a live run" vs
  "the process that locked it is gone"). **Nothing clears a stale lock automatically:**
  `git worktree unlock` is a human gesture, as with an expired hold. A SIGKILL leaving
  the lock behind is the chosen direction — a stale lock costs one command, the
  opposite failure costs a live session its working tree.

  The background mode (`--detach`) settles the workspace in the CHILD, not in the
  parent: the parent plans in report-only mode and prints it, the child prepares the
  tree and holds the lock. Preparing it twice would mean the child refusing itself over
  its own parent's lock.
- **What the package does NOT do in a new workspace: install anything.** A fresh
  worktree has no `node_modules`, and toolchain management has never been handed to
  the package (S8). The project runs its own install there, once.

### S12 — continuing a session instead of starting one (R18)

The tool has been able to do it all along (`claude --resume <session id>`), and since
R7 everything needed to ask for it is written down. What was missing was the RULE — a
resume is not "cheaper", it is a different run, one that carries a session's reasoning
into a world that may have changed underneath it.

**Fresh is always correct; resume is correct only under conditions.** So the default is
an automatic resume behind a guard, and every branch that cannot prove the conditions
falls back to fresh:

1. **The break was external, not exhaustion.** `supervisor-gone` (the observer died —
   a lid, a SIGTERM, a machine going down) and `stalled` (no traces at all: hung IO, a
   network that went away) say nothing about the session's own reasoning being stuck.
   `timeout`, a run that walked into `--max-turns`, and a forced stop say exactly that,
   or were somebody's decision.
2. **The world has not moved** (john named this one as obligatory, and NARROWED it on
   2026-07-25, after the first version had shipped). The first version compared the
   TREE of the thread directory — and that fired on the most ordinary event in the
   circuit: an answer. A message from ANOTHER participant is the INPUT the session was
   waiting for; a resumed session reads it exactly as a fresh one would. Two things are
   a shift:
   - **somebody spoke for it** — a message of the SAME ROLE from ANOTHER session
     appeared in the thread since the launch (told apart by the `session` header, R7).
     Then the work may already have been done, or redecided, by a run that shares
     nothing with this one but the role card. The launch records `mine` — the role's
     own last message at that moment — and that mark is what bounds the interval:
     without it, the role's messages from earlier packages would refuse every resume
     forever. An UNSIGNED message of the role (a human writing on its behalf) counts as
     somebody else: unknown is not innocent.
   - **the base moved** — a merge into `main` while the session was down, including the
     merge of its own pull request, puts its work on top of something that is gone.

   What this does NOT see, said plainly: a foreign push onto the feature branch the
   broken session was working on. That branch has no name anybody but that session
   knows; the local tree is defended by the workspace lock (R17), not by this policy.
3. **The previous run was young** — under `YOUNG_RUN_STEPS` (80) assistant steps of its
   stream. The number comes from this repository's own journal: the six real packages
   of 2026-07-25 took 183–302 steps, while the orientation phase of a run costs about
   58. Below the ceiling the work worth saving exists and the context is still small;
   above it, a resume brings back the very context that got tight.

`--fresh` is the explicit handle, and **every decision is printed with its reason** —
`resume <id>: nobody worked in its place, the base has not moved, and the break was
external ('stalled', 12 steps)` / `fresh: another session wrote for this role while it
was down ('2026-07-25T12-00-00Z-dev-core.md')`. A policy that decides how somebody
else's money is spent may not be silent.

- **A resumed session is sent back to the thread.** Its prompt says what the guard
  actually verified — the workspace is as it left it, the base has not moved, nobody
  wrote in its place — and then tells it to READ THE TAIL OF THE THREAD. Under the
  narrowed rule an answer may well have arrived while it was down, and a session told
  "nothing has moved" (as the first version of the prompt said, correctly for the rule
  it shipped with) would carry on straight past the message it was raised to act on.
- **The journal is what the decision is taken from**: `launch` carries `mode`,
  `resumes` and `world`; `lease-released` carries the `session` id and the `steps`
  burned. All optional — a journal written before R18 parses unchanged, and its runs
  are simply never resumed, which is the only honest answer for a run whose world
  nobody wrote down. The same holds one level down: a `world` written by the first
  version of R18 has no `mine`, so those runs are never resumed either. Journals are
  not rewritten, here or anywhere.
- **`steps` is not the vendor's `num_turns`**, and is named differently on purpose:
  `num_turns` exists only in the `result` event, which a run emits when it FINISHES —
  precisely the runs that are never candidates for a resume. The supervisor counts the
  assistant messages it is already reading.
- **The continuation decides the workspace, not the other way round.** A resume must
  find the tree exactly as its session left it, half-finished edits and all; a fresh
  package must start at the base. That coupling is why R17 and R18 are one contract:
  "where and with what a role wakes up".
- **A stable workspace is what makes a resume findable at all**: the tool keeps its
  conversations per working directory, so a role that works in a different directory
  every time has nothing to resume.
- **A run on a LEGACY thread is never resumed** (reviewer-pr's observation on PR #21,
  carried here at curator's request): condition 2a is read off message FILES, and a
  legacy `_thread.md` has neither file identity nor sessions — so no `mine` is recorded
  and the policy answers fresh. Today that is 009 and 010; migrating them removes the
  case entirely.

### S13 — the interactive turn: asking without dying (R19)

A session that runs into an unclear point in the MIDDLE of a long task used to have one
move: write the question, pass the turn, end. Everything on disk survived, but the
reasoning did not — the next run started from the thread and rebuilt what the first one
had already worked out. R19 gives that session a second move: **say you need input, and
wait alive.** The context, the environment and the uncommitted work stay; the answer
arrives the ordinary way (the thread plus the R4 notification), and THE SAME session
reads it and carries on.

**It is for the middle of a run, and that is a norm rather than a mechanism.** For a
question at the END of a package the old way is cheaper: answer, pass the turn, let the
run finish — the thread holds everything the next session needs, and a fresh context is
worth more than a preserved one. No ceiling can tell "the middle of a long task" from
"nearly done", so the threshold is stated in the launch prompt and in the role cards.

Two commands, and they are two on purpose:

```bash
# 1. the question, with the declaration written in the same gesture
#    --write delivers it (commit and push are inside the command since R3)
cli new-message --root … --ref … --thread 016-x --from dev-core \
    --expects answer --waiting-on curator --body-file q.md --await-input --write
# 2. block until the answer comes back
cli await-input --root … --ref … --role dev-core --thread 016-x
#    code 0 — the answer arrived, read the tail of the thread and carry on
#    code 3 — the wait ran out: wrap up what you have and pass the turn
```

- **The declaration goes with the QUESTION, not with the wait.** The supervisor reads
  the mail off the disk of the checkout the session writes into, so the question becomes
  visible to it the moment the file lands — a declaration made afterwards would race a
  poll that has already concluded the run was over. Hence `--await-input` on the writing
  command, and `await-input` refusing to run without a declaration: waiting undeclared
  is impossible through the legal path rather than forbidden by a rule.
- **The declaration is a runtime file, not a field in the message header.** Aliveness is
  a fact about the RUN (the same line `worker`/`session` are drawn on, with the opposite
  result — provenance stays true forever). "A session is waiting" is true for minutes;
  frozen into an append-only feed it would be a claim that is false a minute later and
  unfixable for good. It lives beside the session log, one file per run
  (`…​.waiting` next to `.log`/`.jsonl`/`.session`/`.supervisor`), and R19 therefore
  changes nothing in the shape of the mail — no thread needs migrating.
- **What the THREAD carries instead is words** (john's norm): the question names what is
  uncommitted and where exactly the session stopped, so the thread stands on its own
  even if the session dies waiting. Uncommitted work is NOT forced into a commit here —
  a commit in the middle of a thought is a lie in the history, and a diff is honester.
- **`waiting` is a lease state of its own.** It is alive for every purpose that matters:
  nothing may be launched on the pair (a parked pair becomes a candidate the instant its
  answer lands — the one tick where a second session would land on top of a live one),
  `status` shows it, an unclosed one is an orphan. The journal records `input-awaited`
  (with the limit of the wait) and `input-received`.
- **A wait is not a hang** (the concrete requirement to R6): while parked, the idle
  detector is off and its watch is restarted, so the silence of an hour spent waiting
  does not declare the session stalled in the first second after it gets back to work.
- **The wait has its own clock and its own refusal** — `--wait-input`, a per-role
  `launch.limits.waitInputSeconds`, default one hour (the answer latency of this circuit
  is 20–40 minutes; a parked session burns no tokens, it holds a lease and a lock).
  Waiting does NOT come out of the work window: the fold shifts the lease deadline by
  the time spent parked. The session is handed the same number in
  `AGENT_PROTOCOL_WAIT_SECONDS`, and since its clock starts first, its own wait always
  expires first and it gets the turn back to wrap up; the supervisor's ceiling is the
  backstop for a wait that never returns.
- **Two endings, and both are named as themselves**: `input-timeout` (nobody answered
  within the ceiling) and `exited-while-waiting` (the session died parked). `completed`
  would have said a package finished when it had stopped in the middle. Neither counts
  towards the attempt ceiling — both leave the mail CONSISTENT (the question is in the
  thread, the turn is with somebody else), which is the opposite of the gap that ceiling
  exists for; exhausting a pair there would punish a human for taking their time.
- **The way out of a wait is the declaration going away, not the mail.** `await-input`
  drops it on every exit, so both endings of a wait — an answer, or its own timeout —
  bring the run back to work the same way. Reading the mail for the way out would get
  the second case wrong: the turn had already passed before the wait began, so nothing
  in the mail changes when the session gives up and wraps up instead.
- **The one refusal worth having**: `await-input` checks that the mail checkout has
  nothing unpushed. An unpushed question exists on one disk only, and the wait for it
  could end only in a ceiling an hour later — the likeliest deadlock of the whole
  mechanism, caught by one git command.

### S14 — the graceful deadline: the session lands its own run (R20)

Two "timeouts on the last mile" in two days (R1, R19): a session works productively to
the last second and is cut off with a heap of uncommitted work, though minutes earlier
it was already clear it should be landing. The wall clock stays — it is the backstop
against a run that never converges and against an open cheque on the quota — but the
NORMAL ending of a long run should be a session winding down, not a `SIGTERM`.

- **The session is told its deadline.** `AGENT_PROTOCOL_LEASE_DEADLINE` (ISO) is set in
  the child's environment at the spawn, and the same moment is stated in words in the
  launch prompt. Until this existed a session had no channel to its own deadline at all
  — the acceptance run of 012 found `--wall-clock` being read out of a leaked
  `npm_lifecycle_script`, which is a coincidence, not a channel. A run that parks for
  input gets time ADDED, so the value handed over is a floor: `await-input` says how
  much the window moved when the answer comes back.
- **The norm lives in the prompt, because no mechanism can land a run.** There is no
  supervisor gesture that makes a session commit — a `SIGTERM` at the deadline is
  exactly what produced the failure. Only the session knows what it is in the middle of.
  So the prompt asks it, about the landing margin before the deadline, to stop digging,
  **commit what it has AS IT IS** (a partial commit beats a perfect tree that dies with
  the process), report in the thread what is done, what is not and what the next session
  should pick up, and pass the turn.
- **The margin is derived, not a constant.** `--wind-down`, a per-role
  `launch.limits.windDownSeconds`, and by default **20% of the resolved window, between
  2 and 15 minutes** — an hour lands on 12. A fixed quarter of an hour would be the
  whole of a ten-minute probe; a share follows whatever window actually won, so
  shortening a run with a flag shortens its landing with it.
- **Landing is not parking** (and the two are deliberately kept apart): parking is a
  PAUSE the same session continues, winding down is an ENDING with the turn passed on.
  They are named separately in the prompt and are different states in the journal.
- **What the wall clock means now.** It cuts off only those who ignored the norm, so
  `timeout` stops being the routine ending of a long run and becomes the record of a
  session that did NOT land — a reason to read the log rather than a statistic. The
  supervisor says the landing point out loud when it passes (once per window, re-armed
  if a park moves the deadline), so the log shows that the session was told, at which
  minute, and kept digging.

### S15 — with what a thread is raised: the directive in the feed (R21)

Different tasks want different models — reconnaissance on a cheap one, implementation
on a strong one — and until R21 the only two ways to say so were an operator's flag
(gone the moment the daemon raises the role by itself) and the role's standing
calibration in the config (the same for every thread the role touches). The missing
statement is per-THREAD and per-PHASE, and it is made **in the feed**:

```
launch: model=opus, effort=high
```

- **In a message, not in `_meta.md`** (john's decision). `_meta.md` would be a second
  source of truth outside the feed and a mutable file with two writers; a header field
  lives in the append-only feed, where the audit costs nothing — WHO changed it and
  WHEN is the message itself. **The last directive of an authorized role wins**, which
  covers both the steady case (one directive in the statement of work) and a change
  mid-thread: it takes effect from the NEXT run, and the daemon re-reads the feed on
  every launch precisely so that it does.
- **A permission, not a norm** — `launch-params` (here: john and curator). The
  directive spends money and decides the quality of the work; without a permission,
  anyone able to write a message could raise the whole thread on the strongest model,
  or quietly downgrade somebody else's implementation run to the cheapest one.
- **Refused at the writer's door, ignored out loud at the reader's.** The asymmetry is
  the point, and it follows from the feed being append-only: while the author still
  holds the flag, `new-message` refuses an effort level outside the tool's vocabulary
  and refuses an author without the permission (a directive written in the belief that
  it decides something is worse than a refusal naming who does). Once a message is
  history, nothing may be fatal — a refusal there would wedge the thread for good,
  since the message cannot be edited and the role could never be raised on it again.
  So a directive from an unauthorized role, one addressed to another tool, or one
  carrying an unknown effort level is DROPPED WITH A LINE beside the launch.
- **One more layer in the same merge** (R12/R15): `flag → thread → role → the tool's
  own default`, and every resolved value prints where it came from (`model opus
  (thread)`), with the directive itself printed in full — `thread directive — model
  opus, effort high — said by 'curator' (2026-07-26T…)`. The flag stays on top: it is
  a decision taken about THIS run, at the terminal, and a directive written into the
  thread days ago must not overrule it.

### S16 — which thread is raised first: the queue of the tick (R5)

A tick raises **at most one pair per role** (D-1), so the order of the candidates IS
the scheduling policy of the circuit — it decides which thread each free role gets, and
which pairs the global budget cuts off the end of the plan. Until R5 nobody had chosen
it: candidates came out
of `threadsWaitingOn`, that is out of the alphabet of the thread directories — an
answer that is always right with one live thread and right by accident with two.

**Three tiers, in this order, and nothing else:**

1. **the explicit priority of the thread** — `high` before `normal` before `low`;
2. **the age of the wait** — the oldest handoff first;
3. **the thread number** — a stable tiebreaker, so an equal pair does not swap places
   between ticks.

No weights, no scores, no configurable strategies: the whole value of the rule is that
a human can predict the queue without reading the code.

- **The priority is said in the feed**, by the same form as the launch directive:

  ```
  priority: high
  ```

  Importance is a property of the MOMENT, not of the thread — the same conversation is
  a background chore on Monday and the thing everything waits on by Thursday. A config
  field would be a standing declaration in a mutable file that has to be remembered and
  un-remembered by hand; a header field is append-only, its audit is free (who raised
  the thread and when IS the message), and it expires the way statements expire — by a
  later one. **The last priority of an authorized role wins.** Absence means the
  default, `normal`.
- **A permission of its own** — `thread-priority` (here: john and curator), separate
  from `launch-params`: "with what a thread is raised" and "what is raised before what"
  are different powers over somebody else's work, and a project may want to hand out
  one without the other.
- **Refused at the writer's door, ignored out loud at the reader's** — the same
  asymmetry R21 established, and for the same reason (the feed is append-only, so
  nothing read out of history may be fatal). `new-message --priority` refuses a value
  outside the vocabulary and an author without the permission; a priority that still
  got in is dropped with a line every tick it is read.
- **The age of the wait is counted from the HANDOFF** — the message that put the role
  into `waiting-on` and was never lifted since — not from the first unanswered message.
  Counting from the first unanswered message would punish a thread for being talkative:
  a conversation where three roles spoke while one was awaited would look older than
  one where the same handoff happened yesterday in silence.
- **One answer, in both places.** `mail` — the entry of a role — lists its threads in
  the same order, so "which one do I take now" is not answered differently by the role's
  own command and by the daemon. The FORM of that output is untouched (one thread id per
  line, a script reads it); only the order changed.
- **The queue is spoken, not inferred.** Before it decides, the daemon prints the whole
  ordered queue with the reason for each place — `queue 1/2: dev-core×016-… — priority
  high, waiting since 2026-07-24T…` — beside the skips it already announced. An
  unexpected order is then answerable from the log alone, without a journal
  archaeology run.

## `spike/` — P0

`headless-cycle.sh` proves that a headless agent (`claude -p`) goes through the
full protocol cycle on an isolated bench: it reads a thread, appends a section,
regenerates the index, commits and pushes, and exits with a code. The result and
the conclusions are in `spike/RESULT.md`. The spike works only in a `$TMPDIR`
sandbox and does not touch the production circuit.
### S17 — which box raises which role, and what one run raises (R13)

**The topology is open, in the repository.** `instances` in `agent-protocol.json` says which
machine raises which role (`id`, `roles`, `note`); it travels with `git pull`, so the boxes
agree about each other for free and a change to it goes through a PR like every other policy.
The other half of the join is the machine's and cannot be committed: `"instance": "<id>"` in
`~/.config/agent-protocol/local.json` (R14 — the repository says WHAT exists, the machine says
WHO it is). Note the singular: `instances` is POLICY and is refused by name in the machine
config, `instance` is identity and lives nowhere else.

**The id names the INSTANCE, not the machine — which is what makes moving one a config change
instead of a repository change.** A box that moves to other hardware (a VPS, a rebuild, a
restored backup) keeps its id: the new machine's `local.json` gets the same
`"instance": "<id>"` and `agent-protocol.json` is not touched at all. That is why an id like
`main` is worth more than one naming the laptop it happens to run on today. **Two live daemons
under one id at the same time are forbidden**, and the order of the move is what enforces it:
stop the old daemon → write the machine config on the new box → start it there. The digest is
ONE file per id (S18), so a pair of them would overwrite each other's state, and each would
read the other's leases as its own — the exact overlap ownership exists to remove.

**There is no address field, and its absence is a decision.** Instances never ask each other
anything: a box publishes a digest of its own state into the mail branch and reads the others'
from there, so no address, no key and no reachability is needed by anybody.

**A role belongs to EXACTLY ONE instance, and that is load-bearing.** Leases are local to a
machine, so a local lease protects against a second session only while no other box can raise
the same role. Ownership is what MAKES the local lease sufficient — the overlap is gone by
construction rather than by agreement. `config check` therefore refuses a launchable role that
no instance claims and one that two claim; a box that does not know its own name refuses to
start rather than falling back to "raise everything", because that fallback raises somebody
else's role.

**The scope of a run is the operator's** (`orchestrator daemon` / `run`): `--roles a,b` names
what this launch raises, `--exclude-roles c` names what it leaves out, the two are mutually
exclusive, and a name that is not a launchable role is refused at the door — otherwise a typo
is a daemon that raises nobody while reporting that it works. Saying nothing means EVERY ROLE
OF THIS INSTANCE: the safety of "nobody without being asked" is already given by the enable
gate, and a second switch of the same meaning is the one that is always forgotten.

Every role the scope removes is spoken in the daemon's banner and in `orchestrator status`,
with its reason (owned by another box / not listed / excluded by the operator) — a role missing
from the queue for an unspoken reason is indistinguishable from a role with no mail.

**A manual `run` stops at the same door.** `orchestrator run --role X` refuses when X belongs to
another instance, and when the operator's own flags leave X out (`--exclude-roles X`, or a
`--roles` list without it) — with the same words and the same exit code as the daemon's filter,
because it is the same code. A door in the daemon only would leave the hand-typed launch as the
way around the topology, and that is the launch a human types exactly when something is already
wrong: the workspace lock keeps a second session off a tree on THIS box, ownership is what keeps
this box off a role another box holds the lease on. The refusal lands BEFORE the world is
touched — no lease, no journal, no workspace — so there is nothing left held by nobody.


### S18 — what the other boxes are doing: the instance digest (R13)

S17 makes the circuit correct across machines and BLIND. Each box knows its own leases from
its own local journal, and about the others it knows only that they exist — so "the other
machine is running dev-core right now" and "the other machine has been down since Tuesday"
look like exactly the same silence, on both sides.

**The answer is published, never asked for.** Every instance writes a small state file about
itself into the mail branch — `_instances/<id>.json` — and everyone else reads it out of git.
Nothing here opens a socket: the mail branch is the only shared surface the protocol has, it
is free to audit, and an offline box degrades into a stale file instead of a hung request.
This is why there is no address field in the topology (S17) and never needs to be.

**One file per box, and the writer only ever touches its own.** Two instances never write the
same path, so conflicts are gone by construction — the same argument that made a message one
file. The `_` prefix keeps the directory outside `^\d{3}-`, so the thread walker never sees it.

**The digest is a STATE, not history**: the instance id, when it was written, the roles this
run raises (after the topology and the operator's flags) and the LIVE leases — role, thread,
state, deadline. A released pair is history and is dropped; history stays in the local journal,
because a growing file in a shared branch is paid for by every clone of the mail forever.

**It is the one mutable derived thing in an append-only branch**, and `check` therefore knows
`_instances/` as a CLASS rather than meeting it as a stray file: an unrecognised mutable path
in an append-only branch is indistinguishable from the retroactive edit the immutability check
exists to catch. (The immutability check itself never sees a digest — `messagesAtRef` matches
`/messages/*.md` only.) What `check` says out loud: a file that is not `<instance>.json`, a
digest whose file name and `instance` field disagree (the name is the identity, as it is for a
message), and a digest belonging to an instance the repository no longer declares — a box
dropped from the topology that keeps publishing reads as current state.

**A tick that changed nothing is not a commit.** `writtenAt` moves every tick, so the write is
gated on the STATE — roles and live leases — and the timestamp rides along with it. Otherwise
the mail branch becomes a heartbeat log with hundreds of empty diffs a day. The cost is stated
rather than hidden: an idle box also stops refreshing, so a busy idle box and a dead one look
alike until one of them moves. A heartbeat, if it is ever wanted, is a separate decision and
not a smaller interval here.

**Staleness is the reader's judgement, not the writer's claim.** A box that died cannot update
its own file to say so, so `orchestrator status` measures age against `writtenAt` with its own
tolerance and marks what is older. `status` shows every digest including this box's, marked as
such: its own digest is the only proof that this box is publishing at all, and a writer that
has silently stopped is precisely the failure that makes everyone else's view wrong. A file
that did not parse is shown beside the ones that did, with its reason — one broken box must
not make the other five invisible.

**Publishing never stops the daemon.** The digest is a courtesy to the other boxes and to a
human; this box's work does not depend on it. A dirty mail checkout is a refusal (delivery
resets hard on a retry, and doing that over somebody's half-written message destroys work to
publish a status line), a rejected push is a refusal — and in both cases the reason is said on
the stream and the loop goes on. A daemon that died because it could not announce itself would
be the watch failing exactly when it is most needed.

**Without a declared topology this box publishes nothing**, and says so once in the banner:
there is no id to publish under and nobody to publish to. That is the pre-R13 contour verbatim
(one box, every role), the same way an absent `workdir.worktrees` means the pre-R17 one.

### S19 — a turn that ends, ends the session (thread 018)

**THE SINGLE STATEMENT OF THIS NORM.** The operative form is one paragraph of the launch
prompt (`runEndsNorm` in `orchestrator/launch.ts`, pinned by a test); everywhere else — the
project's `PROTOCOL.md` among them — points here instead of restating it.

A session in this runtime has no way back once its turn is over: a finished turn with an empty
queue IS the end of the process, and `claude --resume` (S12) is something the SUPERVISOR does
to a run it decided to continue, not something a notification does to a session that walked
away. Nothing in the runtime ever tells a session this, and the shape of the mistake shows the
session assumed the opposite.

**The established defect, not a hypothesis.** On 2026-07-27 two autonomous runs out of two
released with `exited-without-handoff` in the same way: the thing being waited for (a reviewer
verdict, a CI job) was put into a BACKGROUND task, the session finished its turn saying it
would pick this back up when the task reported — and the notification arrived five seconds
later at a dead process. The tail of the second run's log settles the diagnosis on its own:
59 turns of 300, 755s of 3600, exit code 0. No ceiling was near; the run ended because the
session ended it.

**Two endings, and the third is named as forbidden.** Legal: block IN THE FOREGROUND on a call
that holds the turn open (`await-input` of S13, a watch, any command you run and wait out), or
report in the thread and pass the turn on, leaving the waking-up to the daemon of S3. Illegal:
finish the turn intending to come back when something reports. The prompt names the illegal one
in its own words rather than only listing the legal two, because the failing sessions had read
the legal two — what they invented reads like a blend of them.

**Why the prompt and not a role card.** It is a property of the runtime every raised session
lives in, not of one project's way of working (the same argument that put R19 in the package's
words), and a role with no card at all is exposed to it just the same. It is also the exact
inverse of a line the prompt already carried — "passing the turn is what ends the run" — true
in both directions, with only one of them ever said out loud.

**It is kept a separate paragraph from the landing norm of S14**, and a test pins that: "a
finished turn is final" and "land before your deadline" are different failures with different
remedies, and a session reading them as one would take the deadline to be the only way a run
can end badly.

**What is NOT in this section**: evidence at the moment of the break — an
`exited-without-handoff` release naming the background tasks the session left running. Priced
and declined for now (curator's item 2, "if it is cheap"): telling a background task that never
finished from one that did means matching `tool_use` → `tool_result` → the vendor's later
notification events across the stream, i.e. a schema for events the transcript reader does not
parse today, a stateful accumulator in the supervisor and its own tests. What the journal
already carries for such a release — the exit code and the path to the full session log — is
where a diagnosis starts; and with the norm in the prompt, the failure this evidence describes
is the one being removed rather than instrumented.

### S20 — the operator layer: `up`/`down`, the short parking, a typo at the door (thread 019)

The package has two users and one interface. The strictness the CLI is built on — `--ref`
everywhere, a refusal where anything else would guess — is the right property for an agent and
for CI, and it stays exactly as it is. The operator pays for it in ceremony: raising the watch
was three flags and an attached terminal, a hold was five. This section is the thin operator
layer over that core; nothing under it is loosened.

**`orchestrator up` / `orchestrator down`.** `up` composes what already existed and was never
within reach of one gesture: it clears a stop flag left by the previous `down` (without that a
fresh daemon halts on its first tick, for a reason invisible from the terminal), switches
launches on, and sends the daemon to the background the way `run -d` does it — its own session,
no controlling terminal, output to `daemon.log` in the state directory, pid in `daemon.pid`.
Switching launches ON belongs to `up` because typing `up` IS the permission the enable gate
exists to ask for; `down` does not switch it back off — that is a policy statement (`disable`),
while `down` is "stop the watch". An `up` on top of a living daemon is REFUSED: two daemons on
one journal would take the same pair twice, and the second banner would look like a healthy
start. `up` accepts every flag `daemon` does — it is the same daemon with its start-up done.

**`hold <role>` / `resume <role>`.** The same action as the strict `hold --mode take/release`
with the two answers the operator was retyping filled in: the ref from the config, `--by` from
`$USER` (checked against the roles of the config, like the strict form). They ACT rather than
plan — `--write` guards a change nobody can see, while a hold is visible in one command
(`status`) and undone in one word.

**`--ref` may be omitted, and ONLY here.** For these four commands it is not a choice at all:
the project declared it in `orchestrator.ref`. The bootstrap is the one thing to be honest
about — the pointer is read from the WORKING TREE (the exception `schema migrate` already
makes, for the same reason: there is no ref yet to read a ref at), everything after it is read
at the ref it names, and the resolved ref is printed. The working tree chooses WHICH history
governs, never WHAT is in it.

**A typo is refused at the door** (`orchestrator/argv.ts`), on every orchestrator command. The
defect that bought this: `orchestrator daemon -d` SWALLOWED the flag it does not know and
started attached, so the operator walked away believing the watch was in the background and
came back to a dead terminal. `flag()` reads argv by `indexOf`, which makes an unknown argument
not an error but nothing at all — and "nothing" is indistinguishable from a silent default. The
table of what each command accepts is THE USAGE TEXT ITSELF, parsed: a second table would
diverge from the help by exactly one forgotten flag, and a checker that disagrees with the help
refuses what the help offers. `--flag=value` is named rather than lumped in with typos — it is
the spelling half the world uses, has never been supported here, and used to be ignored in
silence.

**What that promotion cost, and what pays for it from now on.** Making the help text the table
changed its status: a usage line that has fallen behind its handler is no longer a
documentation defect, it REFUSES a call that used to work. Two lines had fallen behind long
before the guard existed — `orchestrator status` (which reads `--root`, the ceilings, the role
scope and the agent resolution, because it SHOWS what the daemon would do) and `orchestrator
preflight` (`--model`/`--effort`) — and switching the guard on turned that silence into a hard
refusal of working invocations. Both lines are corrected, and the class is closed by
`usage.test.ts`: a CORPUS of invocations, each checked against its handler by hand once, run
against the SHIPPED `USAGE` (which is why the text lives in `usage.ts` — `cli.ts` starts the
program when imported). The corpus is a regression, not a specification: a flag added to a
handler and to its usage line together is invisible to it, and that is the intended shape —
what it guards is drift in the one direction that refuses calls. Deriving the truth instead is
not available: `flag(argv, "--x")` is scattered through 4600 lines and no static reading of it
would be trustworthy.

### S21 — the live frame: one operator view, and a watch that only reads (thread 019, T-0)

`status` printed a fold of the journal and the enable gate, and that left three questions an
operator asks in front of a contour that raised nobody with no answer at all: is a daemon alive,
is a stop flag lying there, and who would be raised next. All three were on disk; none was in the
output, so answering them meant opening files by hand. They are in `status` now, and they arrive
as part of something larger.

**The frame.** The live half of the operator view is one thing with one name — `renderFrame` over
an `OperatorFrame` (`orchestrator/snapshot.ts`): leases, the parallelism of the box, holds, the
circuit (the gate, the stop and force flags, whether the daemon's pid is alive), the queue with the
reason for its order, the neighbours' digests with their age, and how old the mail on disk is.

**Two of those are D-4's** (thread 023), and both answer a question the frame used to leave to the
reader. The **parallelism line** — `2 of 5 role(s) live`, the pairs behind it, and the roles left
free by name — because the degree of parallelism was never a parameter: it is the number of roles
this box raises (a role has one workspace, R17, and a second session in it is refused at the door),
so the capacity is a fact about the config and the only live question is how much of it is spent.
Until then the frame printed every pair the journal knew, released ones included, and left the
counting to a human at 2am. And the **`parked` mark on a queue line** (R27): a queue line promises
a launch, a thread frozen behind a person will not get one until that person answers, and that
state used to be visible only as a skip line on the daemon's stream — which the person reading
`status` is by definition not watching. The mark rides in `describeOrder`, so the stream carries it
too. `status` prints the frame and
then its static sections; `status --watch` prints the frame and nothing else; the TUI will draw
the same frame. The point of the seam is that they have nowhere to differ: a watcher that computed
the attempt ceiling slightly differently from the daemon would show a human a picture the circuit
does not follow, and there would be nothing to argue with it. For the same reason the queue is
built by `rankCandidates`, the very function the daemon's tick builds it with.

**What stays out of the frame, and why one of them matters.** Paths, launch permissions, the
machine config, the scope, the launch resolution and the workspaces are the config read back, not
live facts. `workspaces` is more than static: it calls `git fetch` (through `baseCommitOf`), so a
frame containing it would fetch once a second.

**A reader never repairs the mail.** `mailCheckoutState` fetches AND fast-forwards — that is the
daemon's work, once a tick. A `--watch` forgotten in a tmux pane must never do it: it would
fast-forward the checkout under a live daemon, and two watchers would race for it. The observer's
probe is `mailCheckoutFreshness`: no network, no writes. The age it reports is TWO facts, because
one lies exactly where it matters — the mtime of `FETCH_HEAD` answers "when did anybody pull",
while the queue is computed from the WORKING TREE, and the two come apart precisely in the failing
case (the ff-merge runs under try/catch, and is not attempted at all when the checkout sits on
another branch). Then `FETCH_HEAD` is fresh, the tree is arbitrarily old, and a panel marked fresh
is lying. So the mark is "when it was pulled" plus "whether it landed" (`behind`).

The consequence is worth stating so that nobody later "fixes" it: **with the daemon down the queue
panel goes stale and nothing refreshes it — and that is the truth about the world, not a display
defect.** The honest answer to "why was nobody raised" is "the checkout has not been pulled in N
minutes, because nothing is alive to pull it", and it is more useful than a queue that merely
looks fresh. No timer and no key of any reader calls `mailCheckoutState`.

**The redraw.** On a TTY the frame is written in place — cursor home, each line clearing its own
tail, the rest of the screen cleared once, all in ONE write, so nothing blinks and no half-frame is
ever on screen; lines are truncated to the terminal width and `resize` redraws immediately, because
wrapped lines drift an in-place redraw out of alignment. Without a TTY (a pipe, `tee`, a file)
frames are appended with a separator. The terminal is restored from ONE place (`process.on("exit")`),
which catches the normal end, SIGINT and an unhandled throw alike. `--frames <n>` stops after n
frames, which is what makes the loop checkable at all. The redraw itself — the writes, the timer,
`resize` — has no test: a declared gap, the same one `up`/`down` have.

### S22 — whose commits these are: per-role git identity (thread 027)

Every commit an agent made used to be signed by the OWNER OF THE MACHINE, because that
is whose name sits in `~/.gitconfig`. The history answered "whose box was this raised
on" while the question asked of it is "who wrote this" — and in the mail the two halves
of one act openly disagreed: a message whose header says `from: dev-core` arriving in a
commit by `ivan.dettenborn`.

An identity here is the role id as the name and `<role>@agents.invalid` as the address
(`roles/identity.ts`). The domain is a constant of the PROTOCOL, not a field of the
project: nothing about a repository changes what "an agent's address does not exist"
means, and `.invalid` is reserved by RFC 2606, so the address can never resolve and
nobody can be tempted to write to it. Promoting it to config is one line, the day a
project wants its commits branded.

**It is applied in two different ways, and the difference is the design.**

*A role's workspace* has exactly one writer for its whole life, so the identity belongs
to the DIRECTORY — `git config`, set at every launch, before the session is spawned.
The trap is that linked worktrees SHARE `.git/config`: a plain `git config user.name`
in `.worktrees/dev-core` renames the human on their own checkout and signs every other
role's tree as well. So it is `git config --worktree`, which git only reads when
`extensions.worktreeConfig` is enabled — enabling it is part of the gesture, and the one
case where the package refuses to is git's own documented caveat: with the extension on,
`core.bare` and `core.worktree` become per-worktree, so a repository that has them in
the common config needs them moved BY HAND first. Then the launch says out loud that the
commits stay with the owner of the machine, and goes on.

*The mail checkout* is shared by every role on the box, so it has no identity to
configure — whoever configured it last would sign the next role's message. There the
signature travels with the one git call that makes the commit: `GIT_AUTHOR_*` and
`GIT_COMMITTER_*` in the environment of `git commit`, out of `--from` (`thread/deliver.ts`,
which is why `GitRun` takes an env). The environment rather than `git -c user.name=…`
because environment variables OUTRANK config: an operator who happens to export those
cannot silently take the signature back from the role.

Two consequences worth naming. The instance digest (R13) is written by the daemon rather
than by anybody's role, so it is signed by the machinery itself (`agent-protocol
<orchestrator@agents.invalid>`) — a role there would claim a turn nobody took. And the
old CI failure "the checkout has no `user.email`" is gone by construction: delivery no
longer needs the checkout to be configured at all.

**What is deliberately NOT fixed** (named in the statement of work): curator's writes
through the GitHub API keep the owner of the token as their author — the Contents API
has an `author` field, but the proxy in between does not pass it through. The executor's
signature already lives in the `worker:` header of the message. History is not rewritten
either: the feed is append-only, and `main` is not touched.

### S23 — the daemon degrades where it used to die (thread 023, part 2)

A watch that dies of the outage it was watching over is not a watch. Two deaths of
2026-07-28 say the same thing in two places, and both are shut here — the fix is on the
DOOR of the config, not in the daemon, because both of them killed `status` as readily
as they killed the loop.

**(a) The wire.** Reading the config at a ref means fetching, and `fetch` fails the way
the network fails. At ~23:03Z the daemon met `TLS handshake timeout` → `ssh: connect to
host github.com port 22: Connection timed out` → `git fetch --quiet origin main` → «the
protocol config at 'origin/main' was not read» → `exit(2)`, and the box stood 8.3 hours
with eleven waiting pairs. The degradation of the mail probe (S3) could not help: the
probe itself begins by reading the config, so the retry killed the process before it
could retry anything.

From here on a process that has ALREADY read the config once stands on it when the next
read cannot reach the ref: the tick is skipped over a named cause, the next tick is the
retry, no back-off is built on top (the same line as the mail probe). The memory is per
`(repo, ref, path)` and per process — `config/standing.ts` — and the two limits are the
point of it:

- **the first read stays fatal**, and no flag says so: at startup nothing has been
  remembered, so there is nothing to stand on. Without a single config ever read there
  is nothing to work by;
- **a config that was READ and then REJECTED is never stood over** — a schema complaint
  or a version verdict is a statement about the repository's own data, made by whoever
  pushed it. The wire is the only thing forgiven, and the fallback is LOUD every time it
  happens (`WARNING — the config at '<ref>' was NOT re-read: … the config read at <when>
  stays in force`). A silent fallback would be exactly the stale-config defect this
  loader was built against.

The off switch keeps its place ahead of everything (S3): stop and force are read before
the probe, so an outage can never lock the daemon in.

**(b) A config newer than the code.** The same evening a daemon raised before the merge
that bumped the shape died on `Unrecognized key: stalled` — and took every command with
it, `status` included. The order of the doors was the whole defect: the strict parse
stood in front of the version gate, so a config written by a NEWER package tripped over
a field name and never reached the verdict that names the repair. The version is now
asked of the RAW file first, and only upwards: `ahead` refuses with **`restart required:
the repository declares protocol version N, the package supports only M`**, `behind`
still goes through the parse, because that shape is one this package can describe and
`tolerateOlder` (door 3 of thread 020) needs its data.

Both are process-tested against a remote that is unreachable for real
(`daemon.config-outage.process.test.ts`): the daemon survives the wire dying mid-flight,
says so on every tick, and goes back to reading by itself when it comes back. The control
was run the way D-0's was — with the fallback disabled the test goes red on the historical
message verbatim.
