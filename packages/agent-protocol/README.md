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

- the neutral name `agent-protocol` — **without the scope of the host project**.
  A monorepo gives its workspace packages a scope of its own; here it is
  deliberately omitted, otherwise the move would start with a rename, and the name
  of a package is the most-referenced thing about it;
- **zero knowledge of the project**: not one import from the host's application
  code, no domain concepts, no paths of a particular repository in the code.
  Everything project-specific arrives from the outside — through the config and the
  command arguments;
- the notification transport (Telegram and the like) is a **separate package** —
  since R4 that is a fact rather than an intention: the core produces events and
  renders text, delivery is taken over by the plugin named in the config, and the
  first one lives in the workspace package `transport-telegram`. The texts are not
  here either — that is the language of a particular team, and it arrives as
  templates (see "Notifications" below);
- the move must be mechanical (`git subtree split` plus replacing the workspace
  dependency with a version from a registry). Since thread 018 the first half of
  that is a script rather than an intention — `scripts/split-package.sh` in the host
  repository cuts this directory into a tag whose tree root is the package, and a
  consumer pins THAT tag, never a branch of the workspace (the host repository's
  `README.md`, "Доставка пакета наружу"). The second half — a registry — is still
  not taken: the delivery goes over `github:<owner>/<repo>#<tag>`.

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

`systemUser` (protocol 22) is a role's SYSTEM identity — which unix user its session runs
as — and it sits beside `launch` rather than inside it because it answers a different
question: `launch` says what a run is allowed to be, this says who the run IS to the
operating system. Optional and without a default: absent means what every role does today,
the session runs as the daemon's own user. **Declaring it grants nothing.** The user, its
groups and what it owns are made by hand on the box, once, outside the protocol; the
repository says which identity a role is entitled to, and the operating system is the only
thing that holds. Both doors that raise a role (`orchestrator run` and the daemon) resolve it
the same way, in three branches and no fourth:

- the declaration is absent, or IS the user the process already runs as — the session is
  spawned exactly as every session before this field existed;
- it differs, and the box grants the narrow path — the session is spawned as
  `sudo -n -u <user> <agent binary> …`. The path is asked about before it is taken
  (`sudo -n -l -u <user> <binary>`, which lists the rule rather than running it), and the
  rule itself is a hand-typed `sudoers` line for ONE target user and ONE binary
  (`docs/box-setup.md` §0.1a) — not something this package can grant itself;
- it differs and there is no such path — REFUSED by name, naming the role, the user it asks
  for, the user the process actually is, and what the probe answered.

It is never raised as the daemon's user instead: a role declared to run as a stripped-down
identity would then get everything the box has, which is the privilege-by-presence the field
exists to end. A switched run says so on its launch line and in its own session log, together
with the two boundaries this build does NOT hold: the environment crosses the switch only
through the box's `env_keep` (so adding a variable to the launch contract is also a line on
the box), and putting such a session down is unverified — a signal from the supervisor's user
to another user's process group is expected to fail with `EPERM`, which is reasoning and not
a measurement.

`capabilities` (protocol 24) is the other half of the same question: `systemUser` says who the
run IS to the operating system, this says WHAT IT MAY DO to the machine. A closed vocabulary of
three verbs — `log-tail`, `repo-refresh`, `disk-free` — and every one of them carries the closed
LIST of values its single parameter accepts (`logs` + `maxLines`, `checkouts`; `disk-free` takes
nothing and its object refuses every key). The list lives in the config and not in the package
because what may be refreshed on a given box is a fact of that project, and its entries are
ABSOLUTE paths: the run is one user and the files belong to another, so a `~` would expand
against the wrong home. There is deliberately no verb that takes a free string: a capability
whose argument is arbitrary text is a shell wearing a verb's name, and every door built above it
is decoration. An empty list is refused BY NAME for the same reason — it is not "nothing
allowed", it is a declaration that says nothing and would later be read as either. Optional and
without a default: absent means a role that does nothing to the box, which is every role that
runs today. **Declaring a capability executes nothing** — no executor reads this field in this
build; the field is the thing a review can hold before anything can act on it, and widening the
set costs a PR to a document of power.

The vocabulary carries no verb that needs root, and that is why `service-restart` and
`service-status` are not in it: a circuit's daemons are USER units of the user that owns them,
and a separate identity cannot restart or query another user's units without root, polkit, or a
move to the system level. They arrive as new members of the union, at a new version, if and when
that price is paid — a verb the operating system refuses by construction would otherwise sit in
the config looking like a right.

```json
"capabilities": [
  { "name": "log-tail", "logs": ["/home/lle/projects/x/.orchestrator/daemon.log"], "maxLines": 200 },
  { "name": "repo-refresh", "checkouts": ["/home/lle/projects/x"] },
  { "name": "disk-free" }
]
```

```json
"launch": {
  "allowedTools": ["Bash", "Read", "Edit", "Write"],
  "limits": { "idleSeconds": 600, "wallClockSeconds": 3600, "maxTurns": 300 },
  "agent": { "kind": "claude-code", "model": "opus", "effort": "high" }
}
```

`allowedTools` IS REQUIRED WHEREVER THE TOOL HAS THE LEVER, and conditionally optional
where it has none (protocol 20, thread `026`). Codex has no `--allowedTools` and no
settings-borne zone denial, so a role raised on it is confined by the vendor's read-only
sandbox and by CI — and the card has to SAY that, in one word, or the run is refused by
name as before. The word is `toolsHeldBy`, it is the only value that admits it, it has no
default, and it puts `--sandbox read-only` into the run's own argv:

```json
"launch": {
  "limits": { "wallClockSeconds": 3600 },
  "agent": {
    "kind": "codex",
    "model": "gpt-5.4-mini",
    "effort": "low",
    "toolsHeldBy": "sandbox-read-only"
  }
}
```

`effort` is the tool's own vocabulary: `claude-code` takes `low, medium, high, xhigh, max`
and codex takes `low, medium, high, xhigh, max` too (reaching its run as `-c
model_reasoning_effort=<v>`). The two lists COINCIDE as of protocol 21 and are still two:
each kind answers for its own, so the day one vendor moves its levels, one list moves and
the other tool's contract does not. `minimal` was in codex's list until 21 and is gone —
no model of the vendor's live catalogue sells it, so the word bought a dead run; `ultra` is
not taken, being carried by one model of six. A level of the wrong vendor is refused with
the right list printed — by the schema on the card path, and by `--effort` on the flag
path — instead of travelling to the tool and coming back as a dead run. `toolsHeldBy` does
NOT waive the step ceiling: nothing outside the run counts steps, so a card that sets
`limits.maxTurns` on codex is still refused by name.

### The dictionary of authorized signatures — `identityDictionary`

`doctor` judges what this box signs its commits with, and two of its rows POINT the
operator at the document where the authorized addresses are written. Which document
that is, the package cannot know: it travels, and the answer is a property of the
project it is serving. So the project declares it, as one optional top-level path
relative to its own repository:

```json
"identityDictionary": "docs/commit-identities.md"
```

**Silence is not a default.** A project that declares nothing gets rows that say so
and name the field to declare — falling back on some file name would put one
repository's document back into a tool used by others, which is the whole defect the
field removes. It stays a FACT rather than a cross in both directions: a repository
with no dictionary, and a declared path with no file behind it, are both legitimate
states of a repository, while the verdict of those rows is about the box's SIGNATURE
alone. Whether the declared file is actually there is measured when the row is built,
against the repository being asked about, and the absence is named in the same
sentence — an operator sent looking for a file that is not there reads it as the
circuit being broken.

There is no flag for it. `doctor` is typed by hand and ad hoc; an optional flag
nobody types would leave the decision with a default, wearing a door marked
"configurable".

### The documents of power this project declares — `powerDocuments`

An optional top-level list of paths, relative to the repository being served. It is the
DECLARED half of the list guard 4 of [`merge-gate`](#merge-gate--the-guards-of-a-merge-that-are-facts-thread-026)
judges by; the derived half — every role's `instructions` plus the config itself — is
computed and needs no declaration.

```json
"powerDocuments": ["PROTOCOL.md", "REVIEWER.md", ".github/workflows"]
```

Paths match as prefixes, exactly as `zones` entries do, so a directory covers everything
under it. Absence is not a default and not a refusal: a project that declares nothing gets
the behaviour of protocol version 17 unchanged. `--power-docs` still ADDS to the list, for
what the config does not know yet. The full reasoning, and why the list is read from the
BASE of a pull request, is with the command.

### How this box invokes the mail — `mailCommand`

An optional top-level string: the prefix a raised session types before `thread show` and
`new-message`. The subcommands are this package's own words and it names them itself;
what carries them — a binary on `PATH`, a package script, a `node --import tsx …` line —
is a property of one deployment, and the package has never known it.

```json
"mailCommand": "node --import tsx packages/agent-protocol/src/cli.ts"
```

The value is pasted verbatim into the launch prompt, everywhere a mail command is named
(`orchestrator/launch.ts`), and nowhere else — nothing here spawns it, which is why it is
one string and not an argv.

**Absence is silence, not a default.** Without the key the prompt names the subcommands
and says out loud that the form is not declared, and asks the session to ASK for it rather
than guess — it does not promise that a role card carries one, because nothing guarantees
that. Until protocol version 25 it wrote the literal `cli` instead — a name from no
config, and false on the box that paid for this: four raises of one role out of five ended
in `exit 127`, twice without the thread ever reaching the session.

**The prefix is not the whole line: `--root` and `--ref` are printed with it.** Every mail
subcommand requires both, and neither reaches a raised session by environment — so a
prompt that named only the prefix still handed out a line that exits 2 before reading
anything. They are not new configuration: the root is `orchestrator.mailCheckout` +
`mail.dir` **as an absolute path** (the same one the run itself is using, so a `--root`
typed at the door moves both together), and the ref is `orchestrator.ref`. A relative root
is not printed and not derived — it would resolve against whatever directory the session
stands in, and the failure of getting it wrong is a partial write into the wrong tree
rather than a refusal. A config with no `orchestrator` section declares no ref, and then
the flag is absent rather than invented, exactly as the prefix is.

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
  "secrets": { "envFile": "/home/j/.config/lle/telegram.env" },
  "operator": "john"
}
```

`secrets.envFile` (R4) is a PATH and only a path: the values live in that file, which
is read and never printed, while this one is printed on every preflight. Both fields
say the same kind of thing — where something on this box happens to sit.

**And the commands take their GitHub credentials from it themselves** (thread 065): a
command standing in the checkout of a circuit resolves that circuit's machine config the
way every other command does, reads `secrets.envFile`, and hands the variables to the
child `gh` and `git` it runs. Nothing has to be exported before the call, and no
`EnvironmentFile=` in a unit repeats what the config already says. Three rules:

- **an already-set variable is never overwritten** — a caller who exported `GH_TOKEN`
  (the debugging path, and the operator's own) wins over the file;
- **`GH_TOKEN` or `GITHUB_TOKEN`** is what counts as a login, and every other variable of
  the file is passed on too;
- **the credential is offered, never demanded** — a command whose config names no file
  still calls `gh`, because `gh` has logins this package does not manage (`gh auth login`
  on a human's box, the token an Actions job is handed). Only when the child ITSELF
  refuses does the missing credential join the reason, and there it **names the file**,
  not the variable: no `secrets.envFile` in the config / the file is absent / it cannot be
  read / it carries no token are four different messages, each quoting the path it tried
  to read. A value is never printed, anywhere.

`git` gets the same environment: a credential helper for `github.com` that reads the
token out of its own environment, and `GIT_TERMINAL_PROMPT=0` — a `Username for
'https://github.com'` on the stdin of a session nobody is watching is a hang, not a
failure.

`accounts` is the same kind of thing for the SUBSCRIPTIONS a box holds (thread 055),
and it is one half of a join that runs across the R14 line in both directions:

| the question | who answers it |
| --- | --- |
| WHICH account a role's runs spend | the repository — `launch.account: <id>` of the role, reviewed in a PR |
| …and when the role names none | the repository again — `instances[].account`, the default of the instance this box is |
| WHERE that account lives on this box | the machine — `accounts.<id>.configDir` |
| WHICH subscription stands behind the id | neither file: the id is a label, and only whoever logged in knows |

The id is policy because it decides whose quota a role burns; the directory is
location for the same reason `exec` is. The session is pointed at it with
`CLAUDE_CONFIG_DIR`, and that one directory holds the whole account — credentials,
the tool's config, the transcripts and the session store — so the isolation is
directory-deep and there is no second switch to forget. Two consequences worth
saying out loud:

  * an id the repository names and this box does not declare is a REFUSAL by name at
    the launch door. The quiet fall-back to the box's own account is the one answer
    that must not exist: it spends a subscription nobody assigned the role, and from
    the outside it looks exactly like a run that obeyed;
  * `--resume` (R18) is bound to the account, the session store living under the same
    directory. A role whose account is changed does not corrupt its resumable
    sessions, it stops seeing them — the first run after such a change is `--fresh`
    in fact, whatever the continuation policy would have decided.

Two layers name the id, in the R21 order: the ROLE's own `launch.account` wins, and
`instances[].account` is the fall-back for every role of that instance which named
none. The default exists because the unit a subscription is bought for is the PROJECT
— on a box hosting two instances the true sentence is "the crew instance runs on the
second subscription", said once; written per role it is the same sentence N times, and
the N+1st role is added without it and quietly spends the other subscription. WHICH
LAYER ANSWERED is printed on the launch line beside the model and the effort
(`account second (instance, /home/j/.claude-second)`), and the refusal above names it
too: a role's id is in `roles[].launch.account`, an instance's in `instances[].account`,
and being sent to the wrong file costs a hunt through a config that has nothing in it.

A role whose instance defaults to nothing either inherits the box's own account, which
is what every run did before the field existed; the environment variable is then not
set at all rather than set to the default path, so an operator who exported one keeps it.

#### The fall-back chain of a role (`roles[].launch.fallback`, thread 036)

A third optional field of the same dictionary, and the repository's half of the account
failover: an ORDERED list of ids the next session of this role is raised on when its own
quota window is closed. Not "any live account of the box" — accounts differ by model,
tariff, limits and owner, and "any" is how a cheap role quietly starts burning an
expensive subscription. Left out or `[]`, the field changes nothing to the line: the role
stands down until its own window reopens, exactly as before it existed, which is what
every role of this repository declares today.

**Every link is judged where it is WRITTEN — by `config check` and by the same reading in
`doctor` — and each refusal names the role, the key and the repair.** Four of them: the
role's own account (a chain falling back onto the window it is running from), an id this
machine does not declare (`accounts.<id>.configDir`), an account this machine declares as
another KIND (a different tool is not a spare key — that door is not negotiable), and the
same id twice (a chain one link shorter than its author believes). The runtime is more
forgiving on purpose: `chooseAccount` refuses a crooked link by name and CARRIES ON down
the chain, because one typo must not stand a role down while a valid link waits behind it.
The strict door is the config one, and it fires in the PR that writes the chain rather than
on the day quota runs out — which is the moment the missing spare cannot be repaired.

**Two refusals are the MACHINE's and are not made without it.** A reader that could not
open the machine config (an unreadable or absent `local.json`) does not say "this box
declares no such account" — that would be a sentence about the reader. The two that hold in
any checkout (the role's own account, the repeated id) are still made.

#### Logging an account in, and logging it in again (B.4)

The one step of the whole mechanism that no command can take: an OAuth login is a
browser and a human, and the package's part is to say exactly which directory it must
happen in and to tell you when it stopped being true.

**First login of an account.** Declare where it lives in the machine config, then log in
there. The declaration is a `config set` key like the others (`account <id>` takes its
second half as `--config-dir <path>`, the way `agent <kind>` takes `--exec <path>`), and
it MERGES into the map rather than replacing it — a box with two subscriptions declares
them one command at a time, and the second must not be how the first disappears:

```sh
agent-protocol config set account second --config-dir /home/j/.claude-second --write
# account: second — set: /home/j/.claude-second — nothing at that path yet;
#   the login creates it: CLAUDE_CONFIG_DIR=/home/j/.claude-second claude login
```

```jsonc
// what lands in ~/.config/agent-protocol/local.json — or instances/<name>.json
"accounts": { "second": { "configDir": "/home/j/.claude-second" } }
```

```sh
CLAUDE_CONFIG_DIR=/home/j/.claude-second claude   # then /login, in that session
```

The path must be absolute and is refused otherwise: it is read by a daemon started
somewhere else entirely, so a relative one would mean whatever the cwd of the shell that
typed it meant. WHICH ROLE sits on that account is not this command's business and never
becomes it — `launch.account` is policy, it lives in the repository config, and a key
from there is refused here by the rule rather than as a typo.

The directory does not have to exist first — the tool creates its whole set inside it
(`.credentials.json`, `.claude.json`, `projects/`, `sessions/`). Nothing else on the box
is touched, which is the measured fact the mechanism rests on (B.1): the isolation is
directory-deep, so a login in one home cannot disturb another. The `CLAUDE_CONFIG_DIR`
in front is not decoration and is the whole of the procedure — the same command without
it re-logs the box's own account, which is how a box ends up with two ids pointing at one
subscription and a shelf that never lifts.

**Re-login** is the identical command: a dead token is replaced in place, and there is no
"logout" step to remember.

**Is it alive.** `doctor` asks once per declared account, each in its own directory, and
prints a row per subscription:

```
ok    account: 'main' token        answered in 2.7s
fail  account: 'second' token      Invalid API key · Please run /login — log this account
                                   in on the box: CLAUDE_CONFIG_DIR=/home/j/.claude-second claude login
```

**Each account is asked in the words of ITS OWN tool** — argv, account variable, login
command and, since thread 039, THE BINARY. The kind of an account is what the machine
config declares (`accounts.<id>.kind`; unsaid means `claude-code`), and the binary is
resolved for that kind through the usual layers — the machine config's
`agents.<kind>.exec` first, the vendor's own name after it. Handing a codex account the
claude binary is not a smaller answer but a wrong one: it produced
`✗ account: 'codex-main' token: error: unknown option '--skip-git-repo-check'` on an
account that had just been logged in — red forever, and naming nothing to repair. Where
the binary of that kind is nowhere on the box, the row says so with the kind named
(`the binary of kind 'codex' ('codex', kind) was not found — there is nothing to run`)
instead of spending another vendor's.

**And the reason a probe failed is read the way the argv is spelled — by asking the kind.**
`claude-code` says why it refused on its first line (`Not logged in · Please run /login`);
`codex` opens with progress (`Reading additional input from stdin...`) and puts its
verdict last, so the row carries its final `ERROR:` line
(`unexpected status 401 Unauthorized: Missing bearer or basic authentication in header`)
rather than the first thing it happened to write.

The row above them (`agent: headless run`) is a different question and stays: it asks
whether the binary answers at all, in the environment the daemon hands a session — which
carries no `CLAUDE_CONFIG_DIR` and is therefore about the box's own login. On a one-login
box the account rows are replaced by one `info` saying so; `--offline` leaves them `info`
too, because a token nobody asked about must be reported as neither dead nor alive. A box
that raises no role of this project (a bench, or a declared instance with nothing assigned
to it) is not asked either — but it KEEPS the rows, `info`, with the reason in them: a
checklist silent about declared accounts is byte-identical to the checklist of a box that
has none, and "there is no second subscription here" is the one conclusion this section
must never leave a reader free to draw.

**When it dies unattended** the circuit says so on its own: the authorisation shelf is per
account (B.3), so the roles of the other subscription keep running, and the alarm that
reaches the operator NAMES the account whose login is wanted — an instruction to run
`claude login` without a name is unusable on a box that holds two.

`operator` is WHO SITS AT THIS BOX — the role a short-form hold is signed by when
`--by` is not typed. It was `$USER` alone, and an OS account name coincides with a
role of the config only by luck: on the box this was written on it is `cosysoft`,
which is no role, so `hold <role>` — the form that exists to take the ceremony off
the operator — refused every time until `--by` was typed anyway. WHICH roles may sign
is still stated in the repository and still checked there; which of them is at this
keyboard is true of one machine and of no other. The order is: the flag, then
`operator`, then `$USER` (kept for the box where the account name IS a role), and
every refusal names which of the three the value came from.

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
  right to; the binary then falls through to the bare name — **the name THAT KIND
  declares, and the line says whose it is** (`… (kind)`; for a `kind` this package does
  not implement, the worker id used as a guess: `… (worker-id)`). Until thread 026 the
  last layer was one constant, `claude`, for every tool: a role declaring `kind: codex`
  on a box that declares no codex path was raised by the claude binary, and preflight
  printed it as a tick — `✓ agent: binary (codex): …/claude (default)`. A file the
  operator NAMED and that cannot be read IS an error — answering an explicit
  `--local-config` with a silent fallback is how a run ends up using settings nobody
  chose.
- **It is not versioned by `protocolVersion`.** That number covers data that TRAVELS,
  where two parties can disagree about what they are reading. This file travels
  nowhere: one box, one writer, a human, outside git. What is left of the version's job
  is the diagnosis, and the strict schema gives that directly by naming the field it
  does not know.

The tool id is the JOIN between the two files and is said once in each: the repository
says which tool raises a role (`launch.agent.kind`), the machine says where that tool
is (`agents.<id>.exec`), and a message header says which tool wrote it (`worker`).

### A box that hosts several instances (thread 055)

An instance stopped being a synonym for a machine: **one box, one instance per
project**, each with its own checkout, its own machine config and its own daemon. So
the single file grew NAMED SIBLINGS, one per instance:

```json
// ~/.config/agent-protocol/instances/crew.json
{
  "instance": "crew",
  "repo": "/srv/agent-crew-orchestrator",
  "agents": { "claude-code": { "exec": "/home/j/.local/bin/claude" } }
}
```

`repo` is the checkout this instance serves — location in the plainest R14 sense, and
the field that lets a command typed inside a project find its instance without naming
it (a role's worktree, `<repo>/.worktrees/<role>`, answers with its home checkout).

**Files, not a section.** `instances` — the topology of who raises what — is POLICY
and is refused in the machine config by name (R13). A section of named instances
inside one file is the one shape that would have required weakening `POLICY_KEYS`, and
that list is the boundary itself.

**Which instance a command is about** resolves in layers, and the layer that answered
is printed (`doctor`, `orchestrator preflight`):

| | layer | how it is said |
|---|---|---|
| 0 | an outright path | `--local-config <p>` — answers for itself, skips the question |
| 1 | the flag | `--instance <name>` |
| 2 | the environment | `$AGENT_PROTOCOL_INSTANCE` |
| 3 | the checkout | the named config whose `repo` contains it (the longest claim wins) |
| 4 | the unnamed config | `local.json` — a box that hosts one instance |

`--instance` is spelled on the usage line of every command that resolves the machine
config, plus `orchestrator up` and `orchestrator restart` — which do not call the loader
themselves and carry it because the generated unit's `ExecStart` does, and an operator
reads that line rather than the merging of flag sets behind it. The usage text IS the
argument checker (`orchestrator/argv.ts`),
so a flag left off a line is refused at the door however well the loader behind it works.
That is not a hypothetical: the first version of this shipped with the resolution
unit-tested and the flag rejected by every `orchestrator` command, including the `up` that
the generated unit's own `ExecStart` runs (`orchestrator/instance-flag.process.test.ts`
now types it at a real CLI, and takes the argv out of the unit rather than retyping it).
The second version shipped the same sentence while `config set`, `init github`, `doctor`
and `notify` were still off the list — which is why the list is now READ OFF THE CODE:
the test walks the call sites of the loader and fails on a command whose line does not
carry the flag, so the sentence above cannot drift from the usage text again. Being
outside `guardArguments` is not the same as being on the list — `doctor` and `notify`
took the flag all along and said so nowhere.

Each layer alone was tried and each fails where the others do not: the flag alone is
the ceremony back (the name typed in every one of the five operator commands, exactly
where `--ref` was taken out of them); the env alone is forgotten silently and drifts
between a terminal and a systemd unit; the checkout alone cannot answer for a command
typed somewhere else. Together they give what R21 gives a model — every answer has a
source and the source is SAID.

Two refusals carry the shape, and neither is a fallback:

- **a name that disagrees with the checkout** (`--instance crew` inside the `lle`
  tree) — the case where a quiet pick raises one project's roles with another
  project's binaries, with nothing anywhere saying why;
- **a checkout claimed by nobody** on a box that has named configs and no `local.json`
  — proceeding would mean running with defaults nobody chose.

**The daemon of an instance has its own unit**: `agent-protocol@<name>.service`,
with `--instance <name>` baked into its `ExecStart`. The name was the last path in the
package that was global to the USER rather than to an instance — two projects would
have fought over one file at `systemctl --user enable`. It is a name per instance and
not a real systemd template on purpose: a template shares ONE `ExecStart`, and ours is
generated per box (its repository path, this interpreter, the PATH of the agent
binaries that instance declares), so a template would reduce to `%i` lookups of the
very facts the generator exists to write down.

**A box with no `instances/` directory behaves exactly as it did before**, to the
byte; there is no "main" instance to migrate to. The second instance is commissioned
by the same command as the first — `init --instance <name>` names the identity AND the
file it lives in, and records the checkout it serves.
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

**A role asking for a lever the resolved tool has no way to honour is REFUSED BY NAME,
with exit 2** — by `run`, `daemon`, `status` and `preflight` alike, since none of them
may carry on with a wrong answer to "what would be started". Every kind declares what
it lacks (`cannot`), and three of those names can be ASKED FOR by a role: the tool
allow-list (`launch.allowedTools`), zone denial carried into the session (`zones`) and
the step ceiling (`launch.limits.maxTurns` or `--max-turns`) — a ceiling that fell
through to the package default is not a role asking for one. The refusal names the
role, the kind, each lever and the field that asks for it:

```
agent-protocol: role 'dev-core' would be raised as 'codex', which has no lever for 3 things
the role asks for: allowed-tools ('launch.allowedTools' names 2 tool(s): Bash, Edit); … .
Raising it anyway would drop them in silence — the run would look like one that obeyed.
```

Silently dropping them is the one behaviour that must not exist: a session raised
without the permissions, the zones and the ceiling its card grants looks, from every
surface afterwards, exactly like a session that obeyed them. A kind this package does
not implement is NOT refused here — `--worker` is free-form provenance, and an unknown
id is refused at the config door instead.

**`launch.agent.kind` names either tool the package implements.** `claude-code` takes
`model` and `effort` (the levels are that tool's own: `low`, `medium`, `high`, `xhigh`,
`max`); `codex` takes `model`, which reaches its run as `-m`. `--model`/`--effort` are
passed to whichever kind is being raised — the door asks the kind, not the id — and
`--effort` is refused BY NAME to a kind that declares no lever for it. An id the
package does not implement is refused with the two it does.

`effort` is deliberately NOT a field of the `codex` member yet: codex has the lever and
spells it `-c model_reasoning_effort=`, but which levels a card may name — and whether
this package validates them at all — is a decision about the config, not a reading of
the vendor, and it is open (thread `026`). Until it is answered a card naming `effort`
on codex is refused by the key, while `--effort` on a codex run passes through as typed
and is judged by the tool that owns the list.

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
  closed" and that would be a lie at the price of a forgotten thread. **The one
  exception is a park** — see below, and it is an exception because the rule's own
  reason does not hold there: "your turn: 042" is still an instruction the reader has
  not carried out, and a question is read once.

- **The third question: WHAT IS FROZEN BEHIND A PERSON, and it rings ONCE** (thread
  023, tightened in 051). A park has no age threshold by construction — it is a
  declaration that the turn cannot move until somebody decides, so waiting it out only
  postpones the call — and it is keyed by the PAIR (person, thread), so the same question
  asked twice rings once (thread 030, defect Д-2 — see the paragraph after this one). What 051 added is the other half
  of "once": the ❓ line is rendered from the FRESH parks and not from the composition,
  so a park already announced produces **no line at all** in later digests, and a park
  declared by a message that asks nothing (`expects: none`) produces none from the
  start. The line between the two is `none` and not `answer`: `ack` is "I stand until
  you confirm", an action required of the person just the same, so a reader ringing only
  on `answer` would stay silent about a thread that freezes and tells nobody, since the
  age pass is quiet about parks by rule and the scheduler skips them; noise the reader
  filters, silence he cannot (curator, 2026-08-03). `none` stays mute, and it is a park
  like any other: the door refused it together with `--parked-on` from 034 until
  2026-08-04 (decision of john, thread 023) — "parks quietly, calls nobody" is the live
  MODE park of 016 and 052. The park itself stays in the composition and in the state — the
  scheduler still skips the thread and the age pass still says nothing about it; only
  the call is not repeated. The pain was john's, measured live on 2026-08-03: 016 (a
  park held as a MODE by his own decision, ringing for days) and 049 (a park over two
  manual operations, ringing with its questions already closed). **❓ has to mean "there
  is a question you have not read"** — a mark that means "this thread is still parked"
  teaches the reader to skip it, and the missed call that follows costs more than the
  one never made. A quieter state line was the other available form and was NOT taken:
  the digest is a courier of events, and the standing picture is what `cli mail` and the
  operator frame are for.

- **BUT A LIVE QUESTION IS SAID AGAIN, RARELY AND ON A CLOCK** (thread 043, defect Д-4).
  "Rings once" above is a rule about the CALL, and read as a rule about the whole life of a
  park it produced the neighbouring silence: the repair of Д-2 cured the noise and switched
  the reminders off with it. Measured on 2026-08-29: ten parks on john in
  `.orchestrator/notify.state`, the oldest — `002-courier-mute` — eleven days old, and not
  one of them mentioned since the tick it was declared on. A park is the one class of event
  that does not end by itself, so a park that has been **announced**, is still **asking**,
  and has stood longer than `PARK_REMINDER_AFTER_MINUTES` (**3 hours**) produces one line
  again, and after that no more often than `PARK_REMINDER_EVERY_MINUTES` (**12 hours** —
  morning and evening). The line is the project's `parked` sentence prefixed by the
  package's own `still on you after {age} —`: the age is the half the reader cannot get
  from the thread id, and the question is NOT repeated beyond the one line the slot already
  renders. From two reminders up the block opens with one header of the package's own — `N
  decisions are standing on you, the oldest for {age} — these threads move when you answer:`
  — because what a person with a queue of decisions needs first is its size, and the whole
  round rides in ONE message. **A reminder RAISES its own letter**, unlike the restatement
  and the lift below: those ride in somebody else's because a second call about a question
  already asked is Д-2, while a reminder is the only line anybody will ever write about a
  park announced eleven days ago — and the box with a queue of standing decisions is by
  construction the box where nothing else is happening. It never doubles another line: a
  park that is fresh, restated, informational, or addressed to somebody the notifier cannot
  call is never reminded. **It stops in the same tick the person answers**: a `delivers`
  lifts the park, the park leaves the composition, and the reminder clock — one
  `remind <person> <thread> <stamp>` line of the state file, holding when each standing park
  was last said — leaves with it, so the NEXT question of that pair starts its cadence over
  instead of inheriting a stamp from an answered one. The two thresholds are package
  constants and not config keys, for the reason `UNACCEPTED_AFTER_MINUTES` is: a new key in
  `notifications` is a new protocol version and a migration for every box in the field.

- **A question ASKED AGAIN is a line in somebody else's letter, never a letter of its
  own** (thread 030, defect Д-2). A park is lifted by any later message that moves
  somebody, so a role raised on a thread whose question is still unanswered re-asks it in
  a new message — and while the stamp was part of the key, every such repeat was a second
  call: two about `aco-028` and two about `LLE-102` in one day, one question each. The key
  is the pair, and the stamp is kept in the state for one purpose — telling a park
  re-declared under that key from one standing untouched. Such a park is **restated**: it
  produces a line (the project's `parked` sentence, prefixed by the package's own "still
  standing, asked again (not a new question)"), and that line rides in whatever digest is
  already going out for a fresh event. It never triggers a delivery: `notify --write` sends
  on the fresh counts, not on the message being non-empty. And a tick that sends nothing
  keeps the stamp it had ANNOUNCED, so the line stays owed rather than being consumed by a
  quiet tick — the courier runs every few minutes, and a downgrade that turns into a
  disappearance is the trade of 051 made backwards. The courier's line names it as a fourth
  number when there is one: `N parked, K of them asking, M of those new, R restated,
  P reminded, L lifted, X with nobody to call: …` (the last four clauses appear only when
  they are not zero). What
  the pair key costs is stated rather than hidden: if the person answers and a NEW question
  is parked on the same thread before the courier has ticked once, the composition was never
  empty and the new question is read as a repeat — a race in one tick window, which loses
  the ring and not the question. Everywhere else a lift empties the park out of the state
  file on the next tick and the next park of that pair rings again, because the courier's
  memory of parks is the current composition and not a journal.

- **A park that was ANNOUNCED AND LIFTED is a line too, and for the opposite reason**
  (thread 030, defect (в2), decision of john «ОБА» of 2026-08-22). The wide lift that made
  the repeat above works the other way round as well: the first message that moves anybody
  lifted the park, and the thread then left the composition ENTIRELY — not the call, all
  three numbers. The unanswered question stopped existing for the signal layer. Measured on
  2026-08-22: eight live parks of john in `.orchestrator/notify.state`, and the thread whose
  question had just been asked (030, lifted by an automatic `github` message about a merge)
  in none of them. So a key that was ANNOUNCED and is no longer in the composition produces
  a line — the project's `parked` sentence prefixed by the package's own "the park was
  lifted, the last line about the question" — on the same terms as a restatement: it
  rides in a letter somebody else's event triggered, never raises one, and stays owed
  (the key is held in the state with the stamp that was announced) until a letter actually
  carries it. The question and `asks` are re-read from the declaring message by that stamp
  (`personParksOf`), which is what makes three of the rules cheap: a park declared by
  `expects: none` asked nothing, so its lift says nothing; a CLOSED thread declares nothing,
  so closing a thread is the acceptance and no line survives it; a key nobody can read back
  is dropped rather than announced in the words of nobody. The courier's line names it as a
  fifth number when there is one (`, L lifted`). **The wording stopped claiming the answer
  was not named, and the mechanism did not move** (thread 030, (в1), the same day): the line
  used to read "the park was lifted with no answer named, the question stands", which was
  true while any move lifted a park and is false now that a person park lifts on
  `delivers: <that person>` and on nothing else — it would print the claim in the one case
  where the answer was named, and named by the very field that did the lifting. The class did
  not empty out (a park also stops standing when a LATER park is declared in the thread), so
  the line states what it measured — a key that rang and no longer stands — and leaves
  "was it answered" to the reader, who has the thread. A mark guessed from the text was NOT
  invented then and is not now: it would be the silent miss wearing the look of precision.

- **A park the courier CANNOT CALL ANYBODY ABOUT is counted apart and named, never
  dropped** (thread 031). A park is an event for the person it names, and only if that
  person is a `direct` target — which the registry gives to `wake.mode: 'self'` and to
  nothing else. That filter used to run BEFORE the counters, so a question standing on a
  person this notifier has no way to reach printed `0 parked, 0 of them asking, 0 of those
  new`: byte for byte the line of an empty mail, in the one situation where the reader most
  needs the difference. The three numbers keep their meaning — they are about the CALL, and
  there is none to make — and the line grows a sixth clause, printed only when it is not
  zero and naming the threads the way the `exhausted` clause names its pairs: `…, 1 with
  nobody to call: 031-x (on curator, asking)`. Informational parks are in that count too:
  `asks` sorts calls, and what this clause answers is whether the courier dropped a freeze
  on the floor. What is deliberately NOT done is ringing somebody else instead — who is
  called for whom is a norm and not a count. In this repository the class is empty
  (`wake.mode: 'self'` is john's alone), which is exactly why it was invisible. **The two
  rules above meet in one place and do not overlap:** a park nobody can be called about is
  never written into the state as announced, so it can never come back as a lift — the fifth
  clause is about parks that RANG and stopped standing, the sixth about parks that never
  rang at all, and no park is ever in both.

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

- **The fourth and fifth questions are not about the mail at all** (thread 051): "can
  this box still authenticate" and "is the merge-ready tier being refused". Both are
  facts about the BOX, and that is why they need their own slots rather than a thread
  to hang on — a shelved box has no ONE thread whose turn is stuck, every thread's turn
  is stuck, so `stalledAfterMinutes` is not applicable to it by construction and the
  call carries no age at all (the rule a park already lives by). The **authorisation
  shelf** rings on the predicate that produced it (`authAlarmDue`: the second run in a
  row dead on the vendor's credentials) and is keyed by the shelf's stamp — ONE
  DELIVERY PER SHELF, not one per tick, the same accounting that puts one line per
  shelf into the journal. The **merge-ready outage** (`orchestrator/outage.ts`) counts
  a RUN of identical refusals from `gh`: the identity of the outage is the text of the
  refusal, so a different message is a different fault and rings again, while the same
  one repeating stays quiet. Its threshold is a number (`GH_OUTAGE_TICKS`, 5
  consecutive ticks) and it is printed BESIDE THE COUNT everywhere the count is printed
  — the operator frame, the daemon's stream and the message itself — because a bare "3
  ticks" is a number the reader would have to go and look up. A run is counted over the
  ticks that ASKED: a tick with no candidates opens no socket, so it neither extends the
  run nor ends it — reading a lull as "the tier answered" would have restarted the count
  at every quiet stretch and an outage lasting hours might never reach the threshold. The
  operator frame speaks on the SAME predicate the phone rings on (`ghAlarmDue`) and on
  nothing weaker: below the threshold the frame is byte-identical to a circuit with no
  tier at all, which is the whole point of a section that is silent when the news is good.
  What the message quotes
  is the vendor's OWN SENTENCE, never a guess at what it means: the path and the text
  of a refusal are facts, a candidate right is a hypothesis, and the lesson is
  #108/#109/#112. **Fail-open is untouched by any of it**: the tier still degrades to
  an empty map, and nothing here may slow a tick, reorder a queue or fail a run — the
  worst this whole mechanism can do is stay quiet.

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

**Declaring a transport is a separate act from naming it, and the courier is mute
until both are done** (thread `002-courier-mute`). `notifications.transport.module` is
a module specifier and nothing more: `import()` resolves it from the file system like
any other import, so a package that the repository has not declared as a dependency
does not resolve, however correct the name is. That failure is loud (`the transport
'X' was not loaded: … — it is named in the config as notifications.transport.module
and must be a dependency of the repository`) and it costs the circuit its entire
notification channel while it lasts: "your turn", the escalation park on a human and
`stalled` all go through this one seam.

**The dependency belongs to the HOST REPOSITORY, not to this package.** A transport
declared in `packages/agent-protocol/package.json` would put a chat vendor into the
core's dependency graph, which is the thing the seam exists to prevent — and the move
into a repository of its own would carry Telegram along. Declared in the workspace
root (`"transport-telegram": "workspace:*"` in the root `package.json`), the module
resolves from `packages/agent-protocol` by ordinary upward lookup, and the core still
learns the vendor's name from the config alone. What holds this in place is a test
that reads the repository's own config, loads whatever it names and never spells the
vendor out (`src/notify/transport.test.ts`), and a seam test on the plugin's side that
goes name → resolution → the wire, with the double at the network rather than at the
module boundary (`packages/transport-telegram/src/seam.test.ts`).

One operational consequence: a merge that changes this declaration is not in force on
a box until `pnpm install` has run there — the resolution lives in `node_modules`, not
in the config the daemon re-reads every tick.

A role's `instructions` is an array, and the order is the reading order (the
general rules of the project first, then the role card). `kind: external` means the
text lies in the repository but is EXECUTED outside (a skill on the chat side) —
the only place where there is no machine guarantee, and we do not promise one. A
file that is declared but missing at this ref fails `config check`.

**The pair «model × effort», not the level alone (thread `041`).** A `launch.agent` of
kind `codex` naming both a `model` and an `effort` is checked against the vendor's own
model list — `$CODEX_HOME/models_cache.json`, default `~/.codex/models_cache.json`,
written by the vendor's CLI and carrying `supported_reasoning_levels` per model. The
vocabulary enum can only ask "is this a word codex ever accepts"; `max` is such a word and
`gpt-5.4-mini` does not carry it, so without this check the config passes and the session
dies at the vendor with the lease already spent. Three states, told apart on purpose:

- **the list is there and names the model** — a level it does not carry is a REFUSAL by
  name (exit `1`), printing both halves of the pair, the levels that model does carry, and
  the source with its `client_version` and `fetched_at`;
- **the list is there and does not name the model** — `NOT JUDGED`, on stderr, exit
  unchanged: a cache can be stale and the catalogue changes without us;
- **there is no readable list** (a CI runner has never run the vendor's CLI) — `NOT
  CHECKED`, on stderr, naming the path that was looked at, exit unchanged. Neither a
  silent pass nor a refusal "just in case".

A card naming only one half of the pair is passed over in silence: the unsaid half is the
vendor's own default and there is no pair to judge. **`claude-code` is not checked this
way** — measured, not assumed: no per-model level list exists on the box for that tool, so
the door is one-sided until one does.

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

**What forces the bump is a DOOR, not a habit** (`src/schema/shape.ts`, thread 023 for the
paths and thread 034 for the values). Two tables freeze, per version, what the config accepts:
`CONFIG_SHAPES` holds every key PATH, `CONFIG_VALUES` every pinned VALUE (`<path> = <json>`,
taken from the `enum`/`const` nodes of the same JSON-Schema projection). Add a field, add a
member to an enum, add a second member to a union — the table stops describing the schema and
the test is red until the number moves and the new entry is appended under the NEW number. Both
directions are named: a value ADDED is a config an older build cannot read, a value REMOVED is a
config already on disk the NEW build cannot read, and only the second one needs a migration step
that rewrites the file. The entries of released versions are history — appended to, never
edited. Values checked by CODE rather than by type (`superRefine` vocabularies, `refine`
domains) are outside the projection and deliberately outside the table.

**The gate is a property of the QUESTION, not of the command** (thread 037, john's
decision of 2026-07-31) — `loadProtocolConfig({ intent })`. `data` is the default and
is the gate described above: it is asked by every command that reads or writes the
protocol's own data, at its OWN ref. `policy` is asked by the two commands that read
SOMEBODY ELSE'S ref — `zones check` (the pre-commit hook of a role workspace and the
CI step of a PR, both pointed at the BASE so that a PR cannot widen its own zone and
pass by its own permission) and `merge-gate` (the base again, for the documents of
power). On a PR that moves the protocol's shape that base is at another shape than the
binary reading it **by construction**, and the strict parse used to refuse before the
zones were ever compared — the guard went red on exactly the class of change that
touches the protocol's own shape. A policy reader asks for `roles[].id`,
`roles[].zones`, `roles[].instructions[].path` and `orchestrator.workdir.worktrees`,
none of which any version has ever moved (`grep -l zones src/schema/v*.ts` is empty
across v2…v14), so it parses **only those fields** (`config/policy.ts`, built from the
same field schemas) and **prints the skew** in either direction instead of refusing. It
still refuses BY DATA: a base where the field it came for is missing is a refusal that
names the field. `tolerateOlder`, which relaxed the NUMBER alone, was the special case
of this and is gone — it could never survive a bump of the FORM, because a strict parse
of another version's config fails before the version is ever compared.

**What this does NOT promise** (curator's caveat, thread 037, accepted by john): if a
future version moves `zones.forbidden`, `roles[].id` or `orchestrator.workdir`
themselves, the narrow shape will not find them and the door refuses — honestly, by the
data rather than by the number, but refuses. Such a move is a manual event.

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

**After `--write`, whenever the config was among the files written, it also says
that the file was RE-RENDERED and asks for your project's formatter before the
commit.** The renderer's JSON shape is not necessarily the one your repository
enforces, and the note belongs to the writer rather than to the step that happened to
need it — a step author cannot be expected to remember a property of a function they
never called. It names the class of the repair and no tool: the package does not know
what you format with. On the dry run it stays silent, because nothing was written to
format ("Compatibility and breaking changes" carries the same rule for the landing).

### The two numbers of a pin, before it moves (thread 028)

```
agent-protocol schema version [--package-ref <ref>] [--package-repo <p>] [--repo <p>] [--ref <ref>] [--config-path <p>]
```

The gate above is asked by the INSTALLED package, and during a pin bump in a foreign
circuit that is the old one by construction: the consumer's `config check` stays green
right up to the merge that moves the pin and goes red on a live `main` afterwards.
Measured on 2026-08-22 in LLE — the pin went `v0.2.1` → `v0.2.3` by hand, and 37
seconds later CI was red on "the repository declares protocol version 17, the package
writes 18". The shape had moved on the step that was skipped over (`v0.2.2`), under a
title that read as a pure release bump.

So this command asks the CANDIDATE instead. `--package-ref` names a tag (or any ref of
the package repository, `--package-repo` if it is not the current one) and the number is
read out of its SOURCE — nothing installed, nothing checked out; both layouts are tried,
`src/schema/version.ts` for a cut tag and `packages/agent-protocol/src/schema/version.ts`
for a branch of the host repository. `--repo`/`--ref` name the consumer's config, read
RAW — the same exception `schema migrate` makes, and for a sharper reason: the loader's
version gate would refuse the very mismatch this command exists to show. With no `--ref`
the consumer's working tree is read and the output says so; with no `--repo` only the
package's own number is printed.

Both numbers are printed with their origins, then the verdict — the three states of the
gate itself (`renderVersionVerdict`), so a repository behind the package is told to
migrate and a repository ahead of it is told the candidate is stale and **a downgrade is
not performed**.

**A mismatch exits 0, on purpose.** This is a measurement taken BEFORE the pin moves —
where the mismatch is the expected finding and the answer is "the migration rides in the
same PR as the pin" — and not a door: the pin lives in a repository this package does not
own, so a refusal there would have nothing to stand on and could be walked around by
editing somebody else's `package.json`. A false guarantee is worse than a visible number.
Exit `2` means a number could not be READ (a ref that is not a build of the package, a
config with no `protocolVersion`) — that is the one thing here that is a defect.

`scripts/split-package.sh` prints the same number at the cut, in its final line — the one
copied into the thread as the announcement of a tag — so the number travels with the tag
instead of being looked up in the sources on each bump.

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

**Where the step changes a VALUE, the rendered file has to be taken WHOLE — and then
run through your project's formatter before the commit.** "Carry the number by hand"
holds only while nothing but the number moves; the first step that narrows an
accepted value (21, the codex effort vocabulary) ends it, because the rendered file
is the only place that value exists. What comes back is `JSON.stringify`'s shape, not
the file's — short arrays one element per line — and a repository that ENFORCES a
format will fail its own lint on it while blaming formatting rather than the runner
(measured here on 2026-08-28: 179 lines → 212, `pnpm lint` red). `schema migrate
--write` says this itself, after the write; the package names no formatter, because
it does not know yours.

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

**A body that says the turn is released while the header says nothing is REFUSED**
(`new-message` and `new-thread` alike, threads 042 and 058). The door reads that one
claim only to refuse it, never to believe it — the header stays the single source of
the turn. Both shapes are read: the markup written into the prose (`waiting-on: —`)
and the sentence that means it (`ход отсюда уходит`, `ход никому не передаю`), with
fenced blocks cut out first so documenting the form is not using it. It is refused
rather than folded to `--waiting-on —`, because the writer meant one of two different
things — release the turn, or leave the claim out — and the door must not pick. Nine
messages of the live mail carry the claim with no field; two of them cost a session
raised onto a thread where nothing had happened.

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
- **Those who assemble a display assemble the rest and SAY WHAT IS MISSING** (thread
  060). They used to write nothing at all when one thread was broken — assembling the
  index from part of the threads means publishing the incomplete as complete, and the
  refusal was the honest answer to that. The price of it was measured twice in two days:
  a directory created with a message and without `_meta.md` (`092-consent-and-deletion`
  29.08, ten red runs in a row; `055-mirror-rules-to-lle` 30.08, two more) froze
  `INDEX.md`, `TASKS.md` and every `_thread.md` OF BOTH CONTOURS while one file was
  missing in one thread. The punishment was not the crime's size. So now `index build`
  and `derive` assemble everything they could read, the unreadable thread enters the
  register as a MARKER ROW (`| <id> | — | — | не прочитан | — | — | — | тред не собран:
  <reason> |`) — the display therefore still cannot be read as complete — and the
  refusal stays: **same exit code 2, said LAST, after the write**, and it NAMES THE
  DIRECTORIES (`… — 1 unreadable thread: '092-consent-and-deletion'`) instead of
  counting them. `check` reports broken threads in a separate block.
- **The exit code being last is load-bearing for the generator's job**: a shell running
  `derive --write` under `set -e` gets its files written before the process dies, so the
  step that commits them is reachable. A caller that wants the derived files under a
  broken thread must not treat 2 as "nothing happened".
- **The most dangerous place is the run observer.** Should the thread the lease was
  taken for break, it would not be among those being waited on, and "the turn was
  passed" would evaluate to TRUE: the run would close as `completed` although the
  role never answered. Hence the unreadability of ONE'S OWN thread is treated as
  ignorance rather than as a passed turn: the observation continues, and the limit
  is set by the deadline (`timeout`).
- **A state is called by its own name**, and `messages/` without `_meta.md` is TWO
  states, not one: beside a legacy `_thread.md` it is a "half-migrated thread"
  (finish the migration or put the message back), and with no `_thread.md` at all it
  is "a thread opened without its head" — nothing was migrated there, a writer went
  around the door. Neither is a raw ENOENT on a file path, and both name the cure by
  the command that performs it (`thread status --repair`), because the reader of that
  line is usually a red `derive` job and it shows them nothing else.

### Commands

`--ref` (which version of the config to read) is required and has no default;
`--repo` defaults to the repository of the current directory. Without `--write`
nothing is written.

**A flag that takes a LIST takes it in both forms** — `--x a,b` and `--x a b` name the
same list, and a list flag reads every word up to the next `--` (thread 033). It used to
read exactly one, so `zones check --paths a b c` judged ONE path and answered green about
"1 path(s)" with the other two never looked at — a silent narrowing of the scope of a
door, and the one direction in which such a mistake is expensive. The flags that take
lists: `--paths`, `--participants`, `--power-docs`, `--working-cards`, `--roles`,
`--exclude-roles`. A list flag given nothing at all (`--paths` and end of line) refuses by
name rather than passing an empty list; `--waiting-on` stays a single role and now says so
when handed two, instead of dropping the second.

`--root` (the mail directory) is MADE ABSOLUTE AT THE DOOR, about the directory the
command was typed in — one base for every phase afterwards (thread 015). A relative
value used to be measured about the process while the message was planned and written,
and about the mail checkout while it was staged (`git -C <checkout> add`): the dry run
printed a plan and `--write` died on `fatal: … is outside repository` after the file was
already on disk. Its other half is in delivery, which now takes its own writes back —
that orphan sat in the checkout uncommitted, and a dirty checkout is refused by design,
so one mistyped path shut the mail for every role on the box until a hand cleaned it.

The entry point in this repository is `pnpm protocol <command>` (the package is
declared as a dependency of the root); below the commands are written by the
binary name.

```
agent-protocol config check --ref <ref> [--repo <p>] [--local-config <p>] [--instance <name>]
                            # the config is intact. The two local flags name the machine config whose
                            # accounts the verdict joins against (thread 036); an unreadable one costs
                            # the two refusals that quote it and nothing else

agent-protocol config set   <key> <value> [--exec <p>] [--config-dir <p>] [--ref <ref>] \
                            [--local-config <p>] [--instance <name>] [--write]
                            # ONE FACT OF THE MACHINE CONFIG, CHANGED (thread 019) — the commissioned box
                            # whose agent binary moved, whose operator is somebody else now, whose secrets
                            # file left /root: without opening that JSON by hand
                            # <key>: `instance <id>`, `operator <role>`, `secrets <path>`,
                            # `agent <kind> --exec <path>`, `account <id> --config-dir <path>`
                            # A POLICY key (`roles`, `limits`, `instances`, …) is refused BY THE RULE and
                            # not as a typo: it lives in the repository config, behind a PR — and so does
                            # WHICH ROLE sits on which account (`launch.account`). This key says only
                            # WHERE that account's directory is on this disk
                            # AN ACCOUNT DIRECTORY THAT IS NOT THERE YET is the ordinary case, not a
                            # refusal (055): the login creates it, so the command prints the line that
                            # does — `CLAUDE_CONFIG_DIR=<path> claude login`
                            # THE CHECK RUNS BEFORE THE WRITE, and the RESULT is re-parsed by the strict
                            # schema: a file this command writes cannot be one the package refuses to read
                            # `--instance <name>` (WHICH FILE is edited) and the key `instance <id>` (what
                            # identity that file claims) are two different questions
                            # a value already there is a `keep` and is not rewritten even with --write
                            # --ref may be left out (the operator's set): `orchestrator.ref` of the tree
agent-protocol doctor       [--ref <ref>] [--repo <p>] [--local-config <p>] [--instance <name>] [--offline] \
                            [--probe-timeout <sec>] [--identity-window <days>] [--identity-all] \
                            [--exec <path>] [--worker <kind>] [--model <id>] [--effort <level>]
                            # IS THIS BOX COMMISSIONED (thread 019): the checklist of a machine that is
                            # supposed to raise roles unattended — both configs, which instance it is, the
                            # agent binary AND A LIVE HEADLESS RUN of it, git (origin, fetch, write access),
                            # the mail checkout and its freshness; then one line: green, or what failed
                            # it REACHES THE NETWORK and SPENDS ONE AGENT CALL — those facts are in no file
                            # --offline leaves them unasked and SAYS so in the rows, never passes them
                            # --ref may be left out (the operator's set): `orchestrator.ref` of the tree
agent-protocol init         [--ref <ref>] [--repo <p>] [--local-config <p>] [--instance <id>] \
                            [--agent <kind>] [--exec <path>] [--operator <role>] [--secrets <path>] \
                            [--no-doctor] [--offline] [--write]
                            # COMMISSIONING A BOX, the other half of `doctor` (thread 019): the machine
                            # config (R14) assembled from flags and from what this box already knows — the
                            # agent binary is FOUND on PATH, not typed — the mail worktree created WITH A
                            # FETCH (one made without it reads as 'never pulled' in every frame
                            # afterwards), and then `doctor` is run: the commissioning ends in the
                            # checklist and not in a belief
                            # IT NEVER GUESSES AN IDENTITY: --instance is refused, not invented — a guess
                            # raises another box's role. It never writes the secrets file (only where it
                            # lies) and never overwrites silently: a declared value and a new one are
                            # printed as a change, both sides
                            # WITHOUT --write it decides and prints and DOES none of it. One effect
                            # survives the plan and the summary names it: on a box with no mail checkout
                            # yet, reading whether the instance id is already published FETCHES the mail
                            # branch — that read is why the warning about a taken id reaches you BEFORE
                            # you take it. --offline declines it and says so
                            # --instance NAMES THE FILE TOO on a box hosting several projects (055): the
                            # config goes to `instances/<id>.json` and records the checkout it serves,
                            # which is what lets every later command typed in that tree find it
                            # --no-doctor: stop after writing (a box with no network yet)
                            # --ref may be left out (the operator's set): `orchestrator.ref` of the tree
agent-protocol init github  [--ref <ref>] [--local-config <p>] [--instance <name>] [--key <path>] \
                            [--host <h>] [--alias <a>] [--comment <c>] [--no-probe] [--write]
                            # THE BOX'S IDENTITY FOR GITHUB (thread 019, п.4): the one step of the
                            # commissioning that makes material OUTSIDE the repository and outside both
                            # configs — an ed25519 pair in ~/.ssh, a `Host` block beside it, and an answer
                            # from GitHub about who this box is. It never overwrites a key, never grants
                            # itself access (the public half and the four clicks are PRINTED) and never
                            # reads the probe's EXIT CODE: `ssh -T` exits 1 on a working key
                            # `--host` IS THE GITHUB HOST, `--alias` IS THE NAME THIS BOX TYPES (thread
                            # 004). They are two values and the block carries them in two lines:
                            # `HostName <host>` is where the name resolves, `Host <alias>` is what goes
                            # into `git@<alias>`, into the remote of a checkout and into the probe
                            # `--alias` DEFAULTS TO `--host`, and that default is right BY MEANING rather
                            # than by coincidence: with nothing to distinguish, the name you type IS the
                            # host. Until 2026-08-18 ONE value wrote BOTH lines — correct on the only
                            # documented use (`--host github.com`, where the two happen to coincide) and
                            # unresolvable in the one case the flag exists for, a SECOND identity on one
                            # box: `Could not resolve hostname github-crew`, exit 2, measured on `hetzner`
                            # A `--host` WITH NO DOT IS REFUSED BY NAME, before the key is generated, and
                            # the refusal names BOTH exits — `--alias <that>` if it is this box's local
                            # alias, a full domain if it really is a GitHub Enterprise host. Splitting the
                            # values fixes the block, not the keystroke that produced the defect
agent-protocol roles list   --ref <ref>                                    # the list of roles
agent-protocol schema migrate [--repo <p>] [--root <comms>] [--to <n>] [--write]   # protocol version → version
                                                                           # (no --ref: it plans against the tree it rewrites)
agent-protocol schema version [--package-ref <ref>] [--package-repo <p>] [--repo <p>] [--ref <ref>]
                            # THE TWO NUMBERS OF A PIN, BEFORE IT MOVES (thread 028): what the CANDIDATE
                            # tag writes (read out of its source — nothing installed) against what the
                            # consumer's config declares (read raw — the loader's gate would refuse the
                            # very mismatch being measured), then the verdict of the three states
                            # a mismatch exits 0: a measurement taken before the pin moves, not a door
                            # over somebody else's repository. Exit 2 = a number could not be READ
agent-protocol role exists  --ref <ref> --role <id>                        # is the role known?
agent-protocol zones check  --ref <ref> [--repo <p>] (--role <id> | --role-from-workspace) \
                            (--staged | --base <ref> | --paths <a,b> | --paths a b c)
                            # --paths TAKES BOTH FORMS and judges every path it was named (thread 033):
                            # the space form used to be read as ONE path — a forbidden path in second
                            # position came back exit 0, "1 path(s) … none under a forbidden prefix",
                            # while the comma form refused the same pair by name (measured on 396a260)
                            # the count in the green line therefore always equals the count named, and
                            # a --paths with nothing after it refuses instead of passing an empty list
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
                            # 'zones.forbidden' IS THE WHOLE VERDICT — 'zones.writes' is not read by this
                            # command at all and narrows nothing: a path outside 'writes' and outside
                            # 'forbidden' is GREEN (measured on 2026-08-18, thread 010: 'curator', whose
                            # 'writes' lists four docs, passed on biome.json and .github/workflows/checks.yml)
                            # that is the design and not a hole: 'writes' says where the role's work lives,
                            # and read as a closed allow-list it would deny 'dev-core' — which declares
                            # writes: [] — every file in the repository. The green line names the criterion,
                            # because "inside its zone" was read as "inside writes" by a role in the field
agent-protocol capability run --ref <ref> [--repo <p>] --role <id> --capability <name> \
                            [--target <value>] [--lines <n>] [--write]
                            # A VERB OF A ROLE'S CARD, CALLED (thread 047) — the surface over the door in
                            # `roles/capability-call.ts`, and the door is answered from the config:
                            # `roles[].capabilities` of agent-protocol.json, NEVER from the caller's words
                            # --role names WHOSE CARD is read, not who is running. «я devops» is not an
                            # entitlement — the same build as `zones check`, and nothing here checks the
                            # process's user. The identity is the one the session was ALREADY spawned as
                            # (`docs/box-setup.md` §0.1a): this command raises none — no sudo, no su, no -u
                            # EVERY REFUSAL OF THE DOOR IS PRINTED WHOLE, never summarised into an exit
                            # code: a verb the role does not declare (quoting what it does declare and the
                            # protocol's vocabulary), a target outside the closed list (membership is
                            # EQUALITY — not a prefix, not a resolve: a door that argued about paths would
                            # be an access wearing a verb's name), a call whose target and verb disagree,
                            # and `log-tail` above the card's `maxLines` — REFUSED, not trimmed, because a
                            # silently shortened tail reads as a shorter journal instead of a narrower right
                            # --write is read by the one verb that changes the box (`repo-refresh`): without
                            # it the plan is printed and NOTHING runs — the checkout is not even looked at.
                            # `log-tail` and `disk-free` are reads and need no word
                            # a checkout holding uncommitted work is REFUSED BY NAME and never repaired:
                            # committing or stashing somebody else's work is the one move nobody can undo
                            # a non-zero step is a refusal naming the step, the command and the code, and
                            # the steps after it do NOT run (`pnpm install` after a failed `git pull`
                            # would report success about a tree nobody produced)
                            # a state-changing call appends ONE LINE to <state>/capabilities.log — when, by
                            # which system user, which verb at which target, every command that ran, and how
                            # it ended (a failed call too). Readable without the session transcript, which
                            # is why it is not `daemon.log`: that one interleaves every role and rotates
                            # the user is ASKED OF THE OS (`userInfo().username`), never of `USER`/`LOGNAME`:
                            # those are set by the hand that types the command, and a field the caller
                            # writes cannot answer "who carried this call" for anybody reading it later
agent-protocol mail    --root <comms> --ref <ref> --role <id>              # mail FROM THE THREADS
                            # the ids on stdout; an unreadable thread on stderr, with its own cause
                            # AND the count of what was lost (065.4) — the input is never silently
                            # narrowed, and it does not break either: the readable ones still print
agent-protocol wake    <role> --ref <ref> [--root <comms>] [--as <invocation>] [--repo <p>]
                            # THE ENTRY OF A ROLE, said by the package rather than copied into the
                            # served project (thread 087 of the LLE mail): the mail branch, the mail
                            # root of THIS machine, the role's card and the threads waiting on it —
                            # then the steps and the standing rules, in one text on stdout
                            # --as: HOW THIS CLI IS TYPED at the consumer ('pnpm -w protocol', a
                            # binary on PATH, 'tsx …/cli.ts'); it goes into every command printed
                            # it PRINTS INSTEAD OF DYING on an unreadable thread — the entry names
                            # what it could not read (065.4) rather than leaving the role textless
agent-protocol notify  --ref <ref> [--root <comms>] [--state <p>] [--env-file <p>] [--write]
                                                                           # the turn has passed to a HUMAN (R4)
                            # AND THE SIXTH CLASS: A PAIR THE CIRCUIT HAS STOPPED RAISING (thread 013).
                            # The line carries a STANDING category beside the parks, the waits and the
                            # stalls — `N exhausted, M of them new — dev-core×006 (external, thaws at …)`
                            # — printed every run, news or not, with the same sentence the `status` frame
                            # uses. Read from the journal's own fold, so it costs no extra state
                            # TWO EVENTS RING, EACH ONCE: `exhausted` — the pair entered a freeze that
                            # ends by itself (the vendor's side failed; the backoff of `thaw.ts` runs);
                            # `frozen` — the terminal, meaning a person is needed (an external freeze
                            # with its schedule spent, or a substantive one, which is terminal from its
                            # first second and therefore rings ONLY as `frozen`). Rounds 2 and 3 of a
                            # backoff are silent — no action hangs on them, and the standing category
                            # shows them to whoever looks
                            # THE MEMORY IS KEYED BY THE SERIES (`LeaseView.exhaustedSince`), not by the
                            # freeze: an external pair LEAVES the exhausted set at every thaw, so a
                            # per-freeze key is forgotten in the gap and the same pair rings on every
                            # round. The state file therefore keeps ANNOUNCED KEYS (`freeze <kind> <role>
                            # <thread> <stamp>`) for as long as their series lives; a delivery resets the
                            # counter, the series ends, the key is dropped and the next freeze rings again
                            # both texts are the package's own (`BOX_ALARM_TEMPLATES`) and not project
                            # slots: they report the ORCHESTRATOR's machinery rather than the
                            # conversation, and the template map's keys are part of the frozen config
                            # shape — a version of the protocol, which is john's call
                            # IT FOLDS WITH THE MAIL, exactly as the daemon does: the first version of
                            # the category called `foldLeases` without `deliveryMarks`, so a release
                            # of the shape thread 023 forgives (`exited-without-handoff` whose own
                            # session signed a message) counted as a failure here and as a delivery
                            # there. Six live pairs disagreed on 2026-08-19 — one broken run away from a
                            # `frozen` call about a pair the next tick raises without blinking
                            # AND THE TWO TERMINAL TEXTS NAME A HAND: the count is zeroed by a delivery
                            # EVENT OF THE PAIR, every shape of which a RUN writes, and an exhausted
                            # pair is refused before it runs — so no message into the thread lifts it.
                            # What does: `--max-attempts` above the ceiling (one run through, its
                            # handoff zeroes the count), or the retroactive shape above
                            # A CLOSED THREAD IS NOT A FROZEN PAIR (thread 016): the category counts
                            # over the fold MINUS the pairs whose thread is closed. The neighbouring
                            # categories get this at the source (`waitingOnOf`/`parkingOf` answer
                            # `undefined` on a closed thread), this one is folded from the JOURNAL,
                            # where a closure leaves no event — so it is handed the closures too.
                            # Without it the pair never left: only a delivery OF THAT PAIR zeroes the
                            # count, every shape of a delivery is written by a run, and a closed thread
                            # gets no runs — measured 2026-08-19, two accepted threads standing in the
                            # line as `2 exhausted` with advice to raise `--max-attempts` on them
                            # AND THE EIGHTH CLASS: A TURN THIS BOX NEVER TOOK (thread 042). `waiting-on`
                            # names a role THIS box raises, the role is free, and no session was ever
                            # started for the pair — the mail is impeccable and nothing happens. Measured
                            # four times on 2026-08-28/29 (1 h 52 m, 4 h 16 m, 19 m, ~7 m), every one of
                            # them found by a HUMAN. The line carries it as a standing category and NAMES
                            # the pairs: `N unaccepted over 10m, K the box cannot justify, M of those new
                            # — curator×042 (19m, no reason known)`
                            # THE THRESHOLD IS A CONSTANT, NOT A CONFIG KEY (`UNACCEPTED_AFTER_MINUTES`
                            # = 10): the daemon's tick is 30 s and a healthy raise costs under two
                            # minutes, so ten minutes is twenty ticks. A key in `notifications` would be
                            # a new protocol version and a migration on every box in the field — john's
                            # decision, not a side effect of this repair
                            # A REASON THE BOX KNOWS IS PRINTED AND DOES NOT RING (the ceiling is spent,
                            # the vendor's window is closed, the login is refused, launches are disabled,
                            # the daemon is stopped, THE ROLE IS HELD BY A MANUAL SESSION): that is the
                            # box working as its operator set it up. The hold (S5) is per ROLE and is the
                            # daemon's own reason on that same pair every tick (`candidate … skipped: held
                            # by a manual session of X`) — the line names who took it and until when. An
                            # EXPIRED hold is no reason at all: the daemon raises the role again the
                            # moment the deadline passes, so a pair still standing behind a dead hold is
                            # the standstill this class exists for and it rings
                            # What RINGS is the pair the box has nothing against — and the pair standing
                            # behind a STALE PARK: a park is declared on a TURN and written on the
                            # THREAD, so when the turn moves to another role the new pair inherits a
                            # freeze declared about somebody else. That is the 4 h 16 m of 2026-08-28
                            # (`dev-speech×010-speech-service` behind a park declared on curator's turn),
                            # and it gets its own text — the move is to lift the park, not to look at the
                            # daemon. A park whose message named no `waiting-on` keeps its whole thread
                            # A BUSY ROLE IS A LEGITIMATE QUEUE and never counts — AND THE QUEUE IS
                            # SUBTRACTED FROM THE AGE, not merely checked at the tick. The first field
                            # firing of this class was FALSE for exactly that reason (2026-08-29T02:53:11Z,
                            # `curator×042` called at `14m, no reason known` six seconds before its own
                            # raise, thirteen of the fourteen minutes being the role's own lease on `026`).
                            # The lease spans come out of the same journal, their overlap with the standing
                            # time is taken off, and only the part the role was FREE is measured against the
                            # threshold. One slot per role makes a queue longer than 10 minutes the
                            # normal shape of a working day, so without this the class would ring on it
                            # every time
                            # AND A PARK IS SUBTRACTED THE SAME WAY — the same породу with
                            # another interval, and the class's SECOND false firing (2026-08-29T10:05Z:
                            # `curator×042` called at `6h 37m, no reason known` 39 seconds before its own
                            # raise, every one of those minutes spent under a park on john the box had
                            # printed on 742 ticks). While a park stands the class is silent; the tick
                            # that LIFTS it used to announce the pair with the whole accumulated age. The
                            # freeze intervals are replayed out of the MAIL (`parkSpansOf` — the
                            # journal has no record of a park) and the two sources are UNIONED, not
                            # summed: a role can be busy on its other thread while this one is parked
                            # EVERY KIND OF PARK, not the person ones alone (measured 2026-08-30 on
                            # `curator×051`, 30 minutes behind `run:126`): the `frozen` set drops a
                            # thread only while its event park STANDS, and the age is judged on the
                            # ticks after the lift
                            # THE PRINTED AGE IS THE FREE PART (changed 2026-08-29 with the above; until
                            # then it was the whole standing time): `6h 37m` about a standstill 39 seconds
                            # old is the number the reader acts on, so the age and the threshold now say
                            # one thing — the box had this pair raisable for that long and did not raise
                            # it. The wall-clock stamp stays in the state file's `since`
                            # Parks that DO cover the
                            # pair and freezes stay with their own classes; the 180-minute stall stays
                            # silent about a pair this class already names — "nobody is moving this" is
                            # the vaguer of the two sentences. ONLY ON A BOX WITH SOMEBODY TO CALL,
                            # though: the class rings a `direct` target and nobody else, so where there
                            # is none the precedence would delete a line and put none in its place
                            # AND THE NINTH: THIS BOX IS NOT RUNNING WHAT WAS MERGED (thread 044). The
                            # daemon says at every tick that it is behind its ref and why it is not
                            # pulling (S25), and that sentence lived in `daemon.log` alone — measured
                            # 28–29.08: a repair merged at 03:24:02Z, 27 lease-free windows in the same
                            # day, and the circuit still on the old code in the morning, ringing with a
                            # false reason it had already fixed. Past `CODE_DRIFT_OVERDUE_MINUTES` (120,
                            # a constant for the reason the threshold above is one) the standoff the
                            # daemon published (`daemon-drift.json`) becomes a line: the two SHAs, the
                            # distance, how long it has stood, and the daemon's OWN refusal verbatim
                            # THE COURIER COMPOSES AND NEVER RE-DERIVES: the reason is a verdict over
                            # leases, holds, flags, a working tree and an attempt count that only the
                            # daemon holds, and a second implementation of a safety rule is the thing
                            # this package refuses everywhere. It also names NO command — what to do
                            # about a window that will not open is a judgement about live work, and a
                            # forced rollout is john's decision, not a courier's
                            # ONE CALL PER PERIOD OF BEING BEHIND, keyed by WHEN THE DRIFT BEGAN and not
                            # by the target SHA: on a repository that merges several times an hour the
                            # target changes at every merge, and a key on it would ring at each one. It
                            # is silent without a live daemon, for the reason the frame is (the standoff
                            # file outlives its writer), and silent inside the band, which is a circuit
                            # working normally
                            # AND THE TENTH CLASS: A LIVE PARK NOBODY HAS BEEN REMINDED OF (thread 043).
                            # A park rings once, on the message that asked — and until this class that
                            # was the last word ever said about it: ten parks stood on john on
                            # 2026-08-29, the oldest eleven days, none mentioned since its own tick. A
                            # park that was ANNOUNCED, is still ASKING and has stood past
                            # PARK_REMINDER_AFTER_MINUTES (180) is said again, and after that no more
                            # often than PARK_REMINDER_EVERY_MINUTES (720 — morning and evening). Both
                            # are constants and not config keys, for the reason above
                            # THE LINE NAMES THE AGE AND NOT THE BODY: the project's `parked` sentence
                            # under the package's `still on you after {age} —`, and from two reminders
                            # up one header over the block (`N decisions are standing on you, the
                            # oldest for {age} …`) — the whole round is ONE message
                            # IT RAISES ITS OWN LETTER, unlike the restatement and the lift: a line
                            # that waits for somebody else's event is owed to a letter that never
                            # comes, and the box with a queue of standing decisions is the box where
                            # nothing else happens. It never doubles a line — a park that is fresh,
                            # restated, informational or addressed to somebody unreachable is not
                            # reminded — and it STOPS IN THE SAME TICK the person answers: `delivers`
                            # lifts the park, and the clock (`remind <person> <thread> <stamp>` in the
                            # state file) is dropped with it, so the next question of that pair starts
                            # its cadence over rather than inheriting an answered one's stamp
agent-protocol thread show  --root <comms> --ref <ref> --thread <id> [--for <role>] [--tail <n>] [--repo <p>] [--no-fetch]
                                                                           # THE READING HALF (R3): the conversation
                                                                           # from the MESSAGES, not from the derived
                                                                           # _thread.md, which lags a push behind
                                                                           # --for: WHOSE READING THIS IS (058). One line
                                                                           # above the conversation: how many messages
                                                                           # arrived after THAT ROLE's own last letter
                                                                           # ("all N" when it has never written here) and
                                                                           # who wrote them — the mark is the feed's, not
                                                                           # a cursor file's, so every box reading the same
                                                                           # branch counts the same. An unknown role is
                                                                           # refused by name: it has no mark to count from
                                                                           # AND --tail MAY NOT CUT INTO THAT RUN: a
                                                                           # narrower bound is widened to it and the
                                                                           # widening is printed. Two roles legally write
                                                                           # into one thread within a minute (LLE 110,
                                                                           # 30.08) and "I read the last message" then
                                                                           # misses the one that froze the thread
                                                                           # --no-fetch: read the ref WITHOUT updating it —
                                                                           # for a box with no network, and it says so out
                                                                           # loud ("'<ref>' was not updated") rather than
                                                                           # printing a stale thread as a fresh one
agent-protocol thread status --root <comms> --ref <ref> --thread <id> --from <role> \
                            --status open|closed [--write]
                            # THE DOOR OF THE PERMISSION `thread-status` (065.1): closing a thread is an
                            # acceptance, and until this command the permission was declared in the config
                            # and called by nobody — the only way to close a thread was to edit `_meta.md`
                            # by hand, which a raised session cannot do (the mail is behind two commands).
                            # Finished, empty threads therefore stayed `open`
                            # a role without the permission is refused BY NAME, and the refusal lists who
                            # holds it: the fallback an agent reaches for otherwise is the file itself
                            # `_meta.md` is the one AUTHORED file of a thread (title/participants/status);
                            # the messages stay append-only and the derived files stay the generator's
                            # --write means DELIVERED here as everywhere; a status already set writes
                            # nothing and says so — closing twice is a no-op, not a conflict
                            # the sameness is decided by THE FEED, inside the attempt, not by the local
                            # `_meta.md`: a box that had not seen the other closer's push used to reach
                            # `git commit` with an empty index and hand out a raw git failure (#266).
                            # The local read is left in the dry run only, and the dry run says so
agent-protocol thread status --root <comms> --ref <ref> --thread <id> --from <role> \
                            --turn explicit|— [--write]
                            # MODE (c): THE FORM THIS THREAD REQUIRES OF ITS ANSWERS (079). `explicit`
                            # makes `--waiting-on` obligatory for every message written into the thread;
                            # `—` withdraws the declaration. Two states, no space of values
                            # WHY A DECLARATION AND NOT A PREDICATE. The defect — an answer that leaves the
                            # turn where it was, so the circuit raises a pair on a thread where nothing
                            # happened — is invisible in the messages: on a RECEIVING thread a fieldless
                            # answer is always terminal, on a WORKING one the same bytes are the legal
                            # middle of the work (rule 11). Three candidate predicates were counted over
                            # the live mail (2875 messages) and the narrowest refused 32 legal messages to
                            # catch three or four defects. So the thread declares it, exactly as
                            # `waiting-on: —` declares a release and `parked-on` declares a freeze
                            # THE SAME PERMISSION AS THE STATUS: the form of a conversation belongs to
                            # whoever owns its closing, and a key without a door would be reachable only by
                            # editing `_meta.md` by hand — the hole 065.1 closed for the status itself
                            # the refusal at `new-message` names BOTH exits (`--waiting-on <role>` and
                            # `--waiting-on —`): they are two different statements and the door picks
                            # neither. A thread that declared nothing sees no door at all
agent-protocol thread status --root <comms> --ref <ref> --thread <id> --from <role> \
                            --repair [--title <t>] [--write]
                            # MODE (b) OF THE SAME DOOR (065): a thread with `messages/` and NO `_meta.md`
                            # is unreadable whole, and with it every statement of work inside — thread 066
                            # stood like that for an afternoon on 2026-08-13 holding six of them. The head
                            # is SYNTHESISED from the messages: the title from the first thing said in the
                            # earliest one (or `--title`), the participants from their authors, the status
                            # always `open` — closing is an acceptance and a machine does not make one
                            # it REFUSES on a thread that already has a head, under any flag, and takes the
                            # same permission as the flip: it is the same power over the same file
                            # what it does NOT fix, and says: a message whose own header is broken. That is
                            # another file, and a committed message is never edited (the norm of the mail)
agent-protocol index build  --root <comms> --ref <ref> [--write]
                            # THE COLUMNS (051): id | participants | priority | status | waiting-on |
                            # parked-on | updated | subject. `waiting-on` is WHOSE TURN it is,
                            # `parked-on` is WHAT FREEZES it — `<person>`, `pr:N` or `run:N`, with the
                            # DAY it was declared on and a leading ❓ when the parking message asks the
                            # person for a word (`expects` other than `none`). The ❓ rows are exactly
                            # the parks the courier rings about (`N parked, K of them asking`): one
                            # reading (`parkingOf`), so the register and the box cannot disagree
                            # THE DAY, NOT AN AGE ("11 сут"): the index is derived and rebuilt on every
                            # push into the mail, so an age would change every row on every push and
                            # stand still exactly in the contour nobody pushes into
                            # `priority` is the one IN FORCE (R5) — a directive from a role without
                            # `thread-priority` reads `normal` here, as it does in the queue
                            # `subject` is one line up to 100 characters: the question of the PARK while
                            # one stands, otherwise the first line of the last message. A closed thread
                            # says `—` in all three: closing is the acceptance
                            # A THREAD THAT COULD NOT BE READ gets a MARKER ROW in id order among the rest
                            # (060): `не прочитан` in `status`, the reason in `subject`, `—` in every
                            # column that would have been read from the thread. The register is written,
                            # the exit code is 2 and the LAST line names the directory
agent-protocol thread build --root <comms> --ref <ref> --id <NNN-slug> [--write]
agent-protocol derive       --root <comms> --ref <ref> [--write]           # all derived files
                            # ONE BROKEN THREAD COSTS ITS OWN ROW, NOT THE BRANCH (060): the readable
                            # threads are assembled and WRITTEN, the unreadable ones become marker rows
                            # in `INDEX.md`, and the refusal (exit 2, naming the directories) comes AFTER
                            # the write — a `set -e` shell still reaches its commit step
agent-protocol check        --root <comms> --ref <ref> [--since <ref>]
agent-protocol migrate      --root <comms> --ref <ref> [--id <NNN-slug>] [--write]
agent-protocol new-message  --root <comms> --ref <ref> --thread <id> --from <role> \
                            --expects answer|ack|none [--waiting-on <role>] \
                            --worker <w> [--session <id>] --body-file <p> [--await-input] [--parked-on <person|pr:N|run:N>] [--park-lifted <person|pr:N|run:N>] [--delivers <person>] [--merged-pr <n>] [--verdict <approve|needs-fixes> --pr <n>] [--write] [--no-push]
                            # A LETTER INTO A THREAD THAT IS ALREADY PARKED IS REFUSED UNLESS IT SAYS WHAT IT
                            # DOES ABOUT THE PARK (thread 058, (B.3)): the refusal names the park in full —
                            # what it waits for, since when, whose turn it was declared on, and the question
                            # in its own words. It fires at most once per park (the next letter lifts it), it
                            # changes NOTHING about what lifts a park, and it is a REFUSAL and not a warning
                            # because `--write` is one action: a warning would be a remark about a letter
                            # already lying in an append-only feed. Three ways to pass — carry what the park
                            # waits for (`--delivers` / `--merged-pr` / `--verdict --pr`), carry the park
                            # forward (`--parked-on <the same value>`), or name the lift:
                            # --park-lifted <person|pr:N|run:N>: THE PARK IS OVER AND THIS LETTER SAYS WHICH
                            # ONE IT ENDS. The value must MATCH the standing park; nothing is written to the
                            # header by it. A stale value — the park was lifted by somebody else between the
                            # read and the write, which is the very subject of 058 — is a NOTE, not a refusal
                            # AND IF THE FEED OF THE THREAD DOES NOT READ AT ALL (half a migration, a message
                            # file that does not parse), the door SAYS SO instead of passing its own blindness
                            # off as "nothing is parked": a note naming the failed read and its reason. It does
                            # not refuse — a refusal built on a feed nobody could parse names the writer
                            # nothing they can fix — but it never stays silent about a check that did not run.
                            # The dating of the letter reads the same files and REFUSES by name when one of
                            # them is unparsable (the stamp must stand strictly after the last in the feed)
                            # THE WRITING HALF (R3): --write means SENT — the file, the commit and the push
                            # happen inside, with the replanning retry behind them; nothing is left to type
                            # --body-file lies OUTSIDE the mail checkout: delivery refuses a dirty checkout
                            # --no-push: the file only, for the ONE caller that owns its own git (CI)
                            # --await-input: this question PARKS the run instead of ending it (R19, S13)
                            # ON A THREAD DECLARING `turn: explicit` (079) `--waiting-on` is OBLIGATORY and
                            # the refusal names both exits; everywhere else a fieldless message stays legal
                            # --model <m> / --effort <e>: WITH WHAT the runs of this thread are raised from
                            # here on (R21, S15) — only from a role holding `launch-params`, and the value
                            # is checked against the tool's vocabulary at this door
                            # --priority high|normal|low: WHICH waiting thread is raised FIRST from here on
                            # (R5, S16) — only from a role holding `thread-priority`; the queue is priority,
                            # then the age of the wait, then the thread number
                            # --parked-on <person>: the turn STAYS on its holder and is FROZEN until that
                            # person decides (R27) — the pair is not raised and spends nothing; it lifts on
                            # THE WORD OF THAT PERSON and on nothing else (thread 030, decision of john
                            # 2026-08-22): a message declaring `delivers: <that person>`, by whichever role
                            # relays it, and `status: closed`, which outranks a park as it outranks a turn.
                            # A turn of somebody else's, a counter-report of a role, the circuit's own
                            # trace leave it STANDING — until 2026-08-22 all of them lifted it, and that
                            # is the class it is set against. The event parks below keep the wide walk
                            # (the first message that MOVES somebody): they wait for a machine event.
                            # Only a role the circuit cannot wake (`wake.mode: 'self'`) may be named
                            # LEGAL together with `--expects none`: the PARK AS A MODE — a line of state
                            # that calls nobody (016, 052). The door refused it from 034 until 2026-08-04
                            # --delivers <person>: THIS MESSAGE CARRIES THE WORD OF THAT PERSON (thread 030,
                            # decision of john 2026-08-22) — the one lift of a park on them, beside
                            # `status: closed`. A person does not write into the mail: the decision arrives
                            # in a letter of a courier role, and by the header such a letter is
                            # indistinguishable from any other message with a turn in it — so the courier
                            # SAYS it, in the one field a reader can trust (reading the body is forbidden
                            # to this net by the norm of 020). It lifts the park on the person NAMED and no
                            # other, raises nobody, spends nothing, and leaves the message ordinary:
                            # `--waiting-on` and `--expects` are declared and judged in it as always. No
                            # permission gates it — the courier is whichever role the human spoke to.
                            # The value is the list `--parked-on <person>` takes (`wake.mode: 'self'`), and
                            # the two refusals are the same: a name no config knows, and a role the circuit
                            # CAN wake (nothing is ever parked behind it — the refusal says `--waiting-on`)
                            # THE PRICE, NAMED: a courier who forgets the flag leaves the park standing,
                            # and the human reads it in the NEXT digest (`N parked, K of them asking`) —
                            # which is what made the narrowing affordable at all (thread 030)
                            # --parked-on pr:<n>: the OTHER thing a turn is frozen behind (thread 023) — the
                            # MERGE of a pull request rather than a person's decision. The courier says
                            # NOTHING about such a thread (neither a call nor a stall: the decision has been
                            # made, what is left is somebody's hand on a button)
                            # THE DOOR PRINTS THE CONDITION OF THE LIFT (thread 030): this park lifts on
                            # ONE thing — a message carrying `merged-pr: <n>` in its header, anywhere in
                            # the mail. NOTHING WATCHES THE PULL REQUEST: closing or merging it in GitHub
                            # does not unfreeze the thread, and a merge announced in prose does not
                            # either. Live on 2026-08-21: a thread frozen on `pr:366` at 08:23Z with "it
                            # will thaw itself when #366 closes" in its body; #366 merged at 08:31Z, the
                            # event landed in another thread as prose, the park stood 8 hours over a
                            # ready head until a human lifted it. The form is legal and unchanged — the
                            # silence about what will NOT lift it is what was the defect
                            # AND THAT MESSAGE LIFTS IT WHEREVER IT LIES IN THE FEED (thread 032): the
                            # mail-wide read has compared no dates since 023, and since 2026-08-23 the
                            # single-thread read compares none either — an announcement of the merge
                            # written BEFORE the park lifts it too. It used to be the one place where
                            # one question got two answers depending on which feed the caller held
                            # --parked-on run:<n>: the THIRD (thread 019) — the ROUND running on that PR.
                            # `pr:` waits for the BUTTON, `run:` waits for the VERDICT; the courier is
                            # silent about this one too (a machine is judging, no decision is pending)
                            # AND IT IS THE ONLY PARK WHOSE SOURCE THE DOOR VERIFIES (thread 062): one
                            # `gh pr view` — the park is REFUSED on a head that carries no run at all,
                            # and refused by a different name on a CONFLICTING pull request (GitHub
                            # assembles no merge ref there, so no run will ever be born and the message
                            # that would lift the park has no author). Live on 2026-08-08: a pair stood
                            # 2h10m on `run:243` whose head never had one run, and nothing said so —
                            # the park has EXACTLY ONE lift, so an event with no source is silence
                            # without a ceiling. A `gh` that could not be asked does NOT refuse: the
                            # park stands with the reason printed, and the AGE CEILING is the second
                            # layer (`--run-park-ttl`, 30 min by default = 3x the measured median of
                            # `checks` on this pool) — past it the park stops freezing the pair and the
                            # role is raised to check the outcome of that round itself. Only `run:` is
                            # aged: a person thinks for as long as they think, and a merge button
                            # legitimately waits for days
                            # THE SAME DOOR REFUSES A ROUND THAT IS ALREADY OVER (thread 032): if every
                            # run on the head has finished — none queued, none in progress — the outcome
                            # this park waits for has ALREADY happened, its message lies in the feed
                            # BEHIND the park, and the lift only ever looks forward. Live on 2026-08-23:
                            # the outcome of the round on #386 was committed at 05:41:46Z and the letter
                            # parking on `run:386` at 05:42:06Z — twenty seconds behind its own
                            # condition, and the pair slept 22 minutes until a human woke it. The window
                            # between the state a session reads and the commit of the letter it writes
                            # from that state closes for nobody, so the condition is read at the door
                            # from the CURRENT state instead of being subscribed to in the future. The
                            # refusal is said apart from "no run at all" because the repair differs:
                            # there the round has not been born (wait seconds, park then), here it has
                            # already died (read the outcome and report it)
                            # ALL THREE PARKS LIFT NARROWLY, by one walk (thread 023; the event ones on
                            # 2026-08-03, the person one on 2026-08-04): the first message that MOVES
                            # somebody, plus — for the event ones only — the merge of that PR announced
                            # anywhere in the mail. Two header facts move somebody, and the circuit's trace class
                            # carries neither: `expects` != none (it asks — the verdict, and every other
                            # answer) and `waiting-on: <role>` (it hands the turn over without asking).
                            # The second IS the actionable CI outcome (thread 048): the notifier names the
                            # role on `failure`/`timed_out`/`startup_failure`/`action_required` and leaves
                            # the field out entirely on `success`/`cancelled`/`skipped`/… The trace class
                            # has EXACTLY ONE exception, and it is about an ACTION rather than an outcome
                            # (thread 023, 2026-08-03): a green `checks` on a PR that does NOT yet carry
                            # the `review` label names the AUTHOR's role, because the norm of 03.08 puts
                            # that label up AFTER a green `checks` on the same head — the author has
                            # exactly one move there and it is theirs. It was built because that wait was
                            # parked by no form at all and the lift closed on itself (no green, no label;
                            # no label, no round; no round, no verdict). Everything else green stays
                            # silent: a PR that ALREADY carries the label (the round is running — that is
                            # case 048), the outcome of a PREVIOUS head, and a run without the `checks`
                            # job. So the trace of a round ALREADY RUNNING lifts nothing (the case the
                            # narrow form was built for, thread 019) and a red one lifts (thread 023: a
                            # `failure` delivered into a thread parked on the very round left the pair
                            # dead for 3.5 hours with the work already in front of it).
                            # A declared NULL (`waiting-on: —`) is not a handover: it moves the turn to
                            # nobody — for the person park just as for the event ones
                            # A PARK BY MEANING IS NOT A PARK BY FIELD, and this door says so (thread 022):
                            # `--expects ack` + `--waiting-on <the author itself>` + NO `--parked-on` is
                            # REFUSED, and the refusal names all the exits (`--parked-on <person>`,
                            # `--parked-on pr:N`/`run:N`, `--waiting-on <role>`, `--expects none`). That
                            # state has no lawful outcome: the turn is the author's, so nobody can answer,
                            # and the only thing that wakes the author is the circuit — which does, every
                            # tick, until the ceiling of the pair is spent. Live on 2026-08-21: six such
                            # headers in `010-speech-service` and the pair went `exhausted`; the net of 020
                            # reads the FIELD and cannot catch it, so it is caught where it is written
                            # THE SAME SHAPE WITH `--expects answer` IS WARNED ABOUT AND WRITTEN, on a
                            # measurement rather than a taste (both mails, 2026-08-21): the `ack` class is
                            # 17 headers in all of history and has no lawful member, the `answer` class is
                            # 173 and is the everyday middle of a working thread
                            # `--expects none` + a self-named turn passes IN SILENCE — that is the lawful
                            # "I am carrying on", and a message that already carries `--parked-on` passes
                            # in silence too, whatever it expects (the net of 020 does not move)
                            # --merged-pr <n>: this message announces that PR as landed — every thread parked
                            # on `pr:<n>` lifts on it, though the announcement is `expects: none`
                            # ANYWHERE IN THE MAIL (thread 023): the notifier writes into the thread named
                            # in the PR's description, and the thread parked on that PR is another one —
                            # so a park is judged against the merges of the WHOLE mail (`mergedPrs`), not
                            # against the feed it happens to lie in
                            # --verdict approve|needs-fixes WITH --pr <n>: THE VERDICT OF A REVIEW ROUND,
                            # declared in the HEADER (thread 042, decision of john 2026-08-29). The two
                            # lines `REVIEWER.md` already asks for in the BODY, said where the R27 net is
                            # allowed to read them — the norm of 020 forbids it the body, so until these
                            # fields existed the third member of the norm's list was unreadable and the
                            # verdict of LLE 17:40:11Z landed in a parked thread and was eaten (19 minutes)
                            # A PAIR, and the door refuses a half: `--verdict` without `--pr` is an outcome
                            # with no address, `--pr` without `--verdict` says nothing happened. The reader
                            # of the feed drops a half too, so writing one would be writing to nobody
                            # WHAT IT DOES: opens a NEW TURN at the SAME holder (the norm of 29.08, point
                            # (ii)) — a park on a person declared on the previous turn stops reaching this
                            # one. WHAT IT DOES NOT: it lifts no park on a person (that is `--delivers` and
                            # `status: closed`), it touches neither `pr:` nor `run:` parks, it raises nobody
                            # and spends nothing, and it replaces no line of the body — the header is a
                            # machine-readable duplicate, not a new genre of letter
                            # NO PERMISSION GATES IT and the sender's ROLE IS NOT CHECKED against the config:
                            # the source of truth is the DECLARATION, as it is for `--delivers`. Reading the
                            # reviewer's `kind`/`wake.mode` instead was the alternative john rejected by
                            # name — it breaks the day the reviewer's tool changes, and a second `kind`
                            # (`codex`) exists in this circuit already
agent-protocol await-input  --root <comms> --ref <ref> --role <id> --thread <id> [--timeout <sec>] [--poll <sec>]
                            # blocks until the thread waits on the role again; needs a wait declared
                            # beside the question. code 0 — the answer arrived; code 3 — the wait ran out
agent-protocol new-thread   --root <comms> --ref <ref> --id <NNN-slug> --title <t> \
                            --participants <r,r> --from <role> --expects <e> \
                            [--waiting-on <role>] [--parked-on <person|pr:N|run:N>] [--delivers <person>] [--verdict <approve|needs-fixes> --pr <n>] --worker <w> [--session <id>] --body-file <p> [--write] [--no-push]
                            # --delivers: THE SAME FIELD TOO (thread 030), by the same door and with the
                            # same two refusals — a thread is often OPENED by the courier of a decision,
                            # and the park that word lifts stands in ANOTHER thread. Written here on the
                            # day the field is born, because 075 is what a flag parsed by one command of
                            # the pair and swallowed by the other costs in an append-only feed
                            # --verdict/--pr: THE SAME PAIR TOO (thread 042), by the same door and the same
                            # refusal on a half. In an OPENING message the pair opens no turn — the walk of
                            # `standingParkOf` looks for a park EARLIER in the same thread and a first
                            # message has none — but it is WRITTEN rather than eaten, for the reason 075
                            # was paid for; the alternative is a flag one command of the pair swallows
                            # --parked-on: THE SAME FIELD AS `new-message`'s, same values and same refusals
                            # (thread 075) — an opening message is a message, and a question to the owner of
                            # a decision is very often what opens a thread (074 is the live case). It was
                            # ACCEPTED AND SWALLOWED here until 2026-08-14: the flag parsed for one command
                            # only, the header went out without the park, and the tick raised the pair empty
                            # AND THE SAME MISSING PARK (thread 022): `--expects ack` + a turn named as the
                            # author's own + no `--parked-on` is refused here by the SAME wording, for the
                            # same reason 075 gives — a door standing on one command of the pair is a rule
                            # nobody can hold in their head
                            # THE ARGUMENTS ARE CHECKED (075): an unknown flag on this command and on the
                            # mail commands beside it (`new-message`, `thread show`, `thread status`, `mail`,
                            # `await-input`, `notify`) is refused BY NAME instead of being ignored — what a
                            # mail command swallows, it swallows into an append-only feed
                            # THE OTHER WRITING DOOR (R3, thread 033): --write means SENT here too —
                            # `_meta.md` and the first message go in ONE commit, pushed, with the same
                            # replanning retry and the same refusal on a dirty checkout
                            # --no-push: the files only, for the caller that owns its own git (CI)
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
                            # AND, only when it is true, HOW OLD THE CODE IN THE LIVE DAEMON IS (023.2):
                            # the SHA it loaded, the SHA of --ref on disk, the distance, since when it
                            # is up. A daemon on the ref gets no line at all
                            # --watch redraws THE SAME frame every --interval seconds and READS ONLY
agent-protocol orchestrator tui    [--ref <ref>] [--interval <sec>]        # THE OBSERVER (T-1)
                            # the same frame as a SCREEN: pairs on top, the circuit in the middle,
                            # the selected session's transcript below (tab: .log / .supervisor)
                            # five keys and all five READ — arrows pick the pair, 'l' overlays the
                            # journal, 'r' collects a frame now, 'q' leaves. The mutating three
                            # ('h'/'s'/'u') belong to T-2, together with their confirmation press
                            # A PASTE EXECUTES NOTHING: bracketed paste is on for the whole session
                            # and everything between its markers is dropped, so a pasted block
                            # holding a 'q' does not close the window (this thread exists because
                            # an accidental paste killed a watch)
                            # it needs a REAL TERMINAL and refuses in words without one — for a dumb
                            # terminal, a tmux pane or 'tee' the answer is 'status --watch', which is
                            # why that was built first and is not a poor substitute for this
                            # the alt-screen is taken and given back: the scrollback is untouched
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
                            # an unreadable thread is NAMED AND COUNTED every tick, beside the skips (065.4):
                            # the queue this tick raises from is narrowed by it, and the tick keeps working
agent-protocol orchestrator log    --ref <ref>                             # the history of events for the owner of the decision (here: john)
agent-protocol orchestrator stop   --mode graceful --ref <ref> [--write]
agent-protocol orchestrator stop   --mode force --ref <ref> --by <who> --reason <why> --thread <slug> [--write]
agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> --by <who> [--ttl <sec>] [--note <t>] [--write]
agent-protocol orchestrator hold   --mode release --ref <ref> --role <id> [--write]   # the role is taken by a manual session
agent-protocol metrics      [--ref <ref>] [--root <comms>] [--journal <p>] [--sessions <p>] \
                            [--since <iso>] [--now <iso>] [--role <id>] [--thread <slug>] \
                            [--no-streams] [--metrics-cache <p>] [--json]
                            # WHAT THE CIRCUIT BURNED, HOW MANY ROUNDS A PACKAGE COSTS, AND HOW THE DAY WENT
                            # — folded out of what is already on the box (the journal and the mail), nothing
                            # written and nothing reaching the network
                            # THE DAY REPORT (thread 042) is the last section, and it prints TWO shares side
                            # by side, because neither is interpretable alone:
                            #   `role <id> busy <n> %` — the sum of the role's lease spans over the window;
                            #   `standing <role>×<thread> <t> in all free <t>` — for every pair standing at
                            #   the right edge, the whole standing time AND its uninterrupted free tail,
                            #   explicitly `0.0m` where there is none
                            # THE FREE PART IS THE COURIER'S OWN ARITHMETIC (`freeTailMinutes`, notify.ts),
                            # called and not copied: two instruments disagreeing on one input turn every
                            # later reading into "which of them do we believe"
                            # THE WINDOW NAMES ITS OWN LEFT EDGE AND WHERE IT CAME FROM — `--since`, or the
                            # earliest event in the journal (the daemon's clock: a live process runs the code
                            # it started with, so the day begins at the restart, not at the merge)
                            # `--now <iso>` pins the right edge, so a window measured by hand hours ago can
                            # be re-measured by the command
                            # `--role`/`--thread` filter the ROWS, never the arithmetic: a free tail is a
                            # statement about the role's OTHER threads, and folding a filtered journal would
                            # be wrong in the direction of the alarm
                            # NOTHING IS COLOURED AND NO THRESHOLD IS APPLIED: what counts as a significant
                            # free share is john's to set and is not decided by this command
                            # A `lease-released` with no `lease-acquired` (a rotated journal) names NO span,
                            # and their count is a printed row: the busy shares are a lower bound, said out
                            # loud rather than left to be discovered
```

**The agent's whole legal contact with the mail is TWO commands** (R3): `thread show`
to read and `new-message --write` to send. Everything below the two — the branch, the
checkout, the directory layout, the file names, the commit and the push — is storage
mechanics, and mechanics is the layer an agent must not have to carry. It is
INCAPSULATION, NOT CONCEALMENT: the agent keeps its shell, and the claim is only that
the legal path needs nothing else.

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

**AND `new-thread` IS THE SAME DOOR** (thread 033). It was not: it wrote `_meta.md` and
the first message, printed "thread created" and returned — no `add`, no commit, no push —
while the README, CLAUDE.md and every role card promised that `--write` delivers. The
promise was true for one command of the two, so the tool reported success on a delivery it
had never made: exactly the class of "the tool's answer is not the fact" that a role is
supposed to be insured against, and here the insurance (control-reading the feed after a
write) was load-bearing instead of a safety net. A NEW THREAD IS ONE DELIVERY, NOT TWO:
the meta and the first message land in a single commit, because a meta pushed without its
message is a conversation nobody can read or answer, and the retry would then be replanning
the message beside a meta already in the feed. The thread id is re-checked AFTER the
refresh, inside the attempt: the pre-flight check only knows this disk, and if somebody
took the number in between, writing it again would overwrite their meta.

#### `wake` — вход роли говорит пакет, а не копия в обслуживаемом проекте (тред 087 почты LLE)

Инструкция «ты — роль X, вот почта, вот как читают и как отвечают» жила текстом в
обслуживаемом проекте и **разошлась с кодом по трём пунктам сразу** (замер curator,
тред 087 §2): велела исполнять пакет из чекаута, которого на ящике нет; называла
держателем merge роль, у которой его отобрали тремя неделями раньше; и посылала
читать вход из ПРОИЗВОДНОГО `_thread.md` на той же странице, где объявляла принцип
«вход считается из источника». Причина одна и она структурная: текст, описывающий
команды, сопровождался не там, где эти команды меняются.

**Почему команда, а не файл в тарболе** (кандидаты (а) и (в) постановки). Файл — это
текст, который потребитель цитирует: он не знает ни ветки почты, ни корня чекаута на
этом ящике, ни того, ждут ли роль треды прямо сейчас. Всё перечисленное — факты
конфига и диска, то есть ровно тот класс, расхождением с которым предыдущая копия и
умерла; а вход всё равно пришлось бы дочитывать вторым вызовом. Команда подставляет
их из тех же источников, которыми живёт `mail` (одна функция на двоих — `mail`
печатает ids для скрипта, `wake` называет их внутри текста), и попадает под CI
дома: слова собирает чистая `renderWake`, у неё юнит.

**Форма вызова CLI — чужой факт и потому флаг.** `--as 'pnpm -w protocol'` уезжает в
каждую печатаемую команду. Пакет, печатающий свою форму вызова как единственную,
врал бы всем ящикам, кроме одного.

**Обёртка у потребителя после этого — одна строка.** Для Claude Code это
`.claude/commands/wake.md`, чьё тело —
`` !`pnpm -w protocol wake $ARGUMENTS --ref origin/main --as 'pnpm -w protocol'` ``;
`allowed-tools` и права остаются вопросом того проекта, а не пакета.

#### Which `--write` delivers, and which only writes (thread 033)

`--write` is one word for two different things across this CLI, so here is the whole list
as a fact rather than as an impression. **Two commands SEND** — the file, the commit and
the push are one action:

| command | `--write` does |
| --- | --- |
| `new-message` | **delivers** — writes, commits, pushes (retry, `--no-push` for CI) |
| `new-thread` | **delivers** — both files in one commit, pushes (retry, `--no-push` for CI) |
| `index build` | writes `INDEX.md` — **not committed**: derived |
| `thread build` | writes `_thread.md` — **not committed**: derived |
| `derive` | writes all derived files — **not committed**: derived |
| `migrate` | rewrites threads into the file form — **not committed**: read before it is |
| `schema migrate` | rewrites config and mail to the next version — **not committed**: says so in its own output |
| `orchestrator record` | appends to the journal — **no git**: machine-local state |
| `orchestrator enable`/`disable` | the gate flag — **no git**: machine-local state |
| `orchestrator hold` (take/release) | the hold file — **no git**: machine-local state |
| `orchestrator stop` (graceful/force) | the stop/force flag — **no git**: machine-local state |
| `orchestrator run` | **acts** — prepares and locks the workdir, appends the launch events, raises the agent; **no git**: all of it machine-local |
| `notify` | the notify state + the message — **no git**: delivery is the transport (R4) |

The three reasons behind the "not committed" column, in full:

- **the derived files are the generator's** (`index build`, `thread build`, `derive`).
  They are rebuilt by `comms-derived.yml` on the push that produced them and committed
  there as `chore(comms): rebuild derived`. A command that committed them itself would
  race that workflow and make every concurrent write a conflict in a file nobody authored
  — which is also why delivery never stages them;
- **a bulk rewrite is read before it is committed** (`migrate`, `schema migrate`). These
  touch many files at once and the config half goes through a PR by rule, so the commit is
  the human's decision, not the tool's. `schema migrate` says this in its own output;
- **the operational state is not in git at all** (`orchestrator record/enable/disable/
  hold/stop/run`, the state file of `notify`). It lives under `orchestrator.state`
  (`.orchestrator/` here, gitignored) because it is a fact about THIS machine — there is
  nothing to deliver. `notify` does deliver, through its transport plugin; a commit is not
  its channel.

`orchestrator run` is in that last class by its state, and it is the one entry where the
word means something else: **`--write` there is not "write the file", it is "do it"**.
Without it nothing at all happens — the command prints the plan it would execute and
touches neither the role's worktree, nor its lock, nor the journal; with it the worktree is
put on the base and locked, the launch events are appended and the agent is raised. It is
listed here because the question this list answers is "what does typing `--write` cost me",
and for `run` the answer is the largest of the lot. What the raised session then delivers
is the session's own doing, through the two writing doors above.

#### The type of a hand-made commit into the mail

Sending by hand is no longer a step of the normal path — both writing doors deliver. It
survives as an EMERGENCY path (a legacy thread that `new-message` refuses, a delivery
interrupted midway), and when it is taken the commit is written as
**`docs(<mail.dir>): <role> → <thread>`** — the exact subject `deliverySubject` produces,
with the scope taken from the mail directory of the config (`agent-comms` in the project
this package grew in, whatever `mail.dir` says in yours).
Two reasons: `comms(...)` is not in the `@commitlint/config-conventional` enum and the
commit-msg hook of the mail checkout rejects it (this is how the question arose — curator's
first hand-made commit was bounced), and the feed's history should not record HOW a
message got in. Machine bookkeeping in the same branch keeps `chore(...)`
(`chore(comms): rebuild derived`, `chore(protocol): instance <id> state`): it is not a turn
in a conversation.

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
appended to by hand as a section in `_thread.md` until it is migrated. WHICH threads
those are is not a list to be remembered but a fact of the mail, and it is measured
with one command from the root of the `comms` branch:

```
for d in agent-comms/[0-9][0-9][0-9]-*/; do [ -d "${d}messages" ] || echo "$d"; done
```

Empty output — there are no non-migrated threads and this refusal is unreachable
(measured 2026-08-19, thread `014-merge-model`: empty, all 16 threads carry
`messages/`).

### `doctor` — is this box commissioned (thread 019, the operator tail)

```
agent-protocol doctor [--ref <ref>] [--repo <p>] [--local-config <p>] [--instance <name>] [--offline]
                      [--probe-timeout <sec>] [--identity-window <days>] [--identity-all]
                      [--exec <path>] [--worker <kind>] [--model <id>] [--effort <level>]
```

The measurement behind the command: bringing one VPS into service took an evening and
about a dozen hand steps typed out of a chat. Each of them was a yes/no question — is
the binary there, does the headless token still work, can this box push, has the mail
checkout ever been fetched — and none of them was asked by anything but a human's
memory. `preflight` made that argument for a RUN; this is the same argument for a BOX.

It is not `preflight` under another name, and the difference is what each may do.
Preflight is on the way into every launch, so everything it asks has to be cheap,
local and safe on every tick. Doctor is asked by a human twice in the life of a
machine — the day it is set up, and the day something stopped working — so it may
reach the network, spend one agent call, and ask the remote for permission to write.

```
✓ config: repository: 'agent-protocol.json' at origin/main — 6 roles, holds together
✓ config: machine: ~/.config/agent-protocol/local.json — claude-code → …/bin/claude; secrets ← …
✓ config: instance: 'main' — raises role-a, role-b, role-c
✓ agent: binary (claude-code): …/bin/claude (machine)
✓ agent: headless run (claude-code): answered in 3.7s
· git: origin: git@github.com:org/repo.git
✓ git: fetch: ok
✓ git: write access (dry-run push): ok
✓ mail: checkout: …/.worktrees/mail
✓ mail: checkout freshness: on 'mail-branch', matches origin
doctor: green — 9 checks passed, 1 facts, nothing failed
```

The marks are preflight's, deliberately (R12): a tick is a comparison that MATCHED, a
dot is a fact nobody promised anything about, a cross is what stops the box being
ready. **What is a cross and what is a dot** is the whole judgement of the module: a
cross is a state in which the circuit of this project would do something wrong or
nothing at all on this box (no binary, a dead token, a mail checkout the daemon
refuses to read); a dot is a state that is merely not the commissioned one — a laptop
that raises nobody is a legitimate machine, and telling its operator that their box is
broken teaches them to read past the crosses. Hence the split curator named in the
statement: an instance name the repository does not declare is **a bench**, not an
error, while a box with no name at all while instances ARE declared is a cross — the
daemon there raises nobody and says so only when somebody starts it.

Three probes are worth the words they cost:

- **the headless run** is the fact no file can carry. Path and version are readable
  from disk; whether the credentials in this operator's home directory are still good
  for a `-p` run is readable from nothing, and it is the failure that looks most like
  success from outside — the daemon raises sessions, each dies on its first call, the
  journal fills with attempts. The answer is discarded; what doctor takes from the run
  is that there was one, and on a failure the tool's own words, unedited;
- **write access** is probed with a `--dry-run` push of a ref the remote has never
  seen. A dry-run push of an up-to-date branch is answered locally ("Everything
  up-to-date") and proves nothing about credentials. Nothing is created — that is what
  `--dry-run` means;
- **mail freshness** is not restated here: the row is `mailCheckoutVerdict`, the
  daemon's own judgement, passed through. A green doctor beside a daemon that refuses
  to read its mail would be worse than no doctor.

`--offline` leaves the three network probes unasked and says so in the rows (`· not
asked — --offline`). It never passes them: a flag that turned rows green would report
a live token on a box nobody asked.

`--ref` may be left out — doctor joins the operator's set (`orchestrator.ref` of the
working tree, printed when it is used).

### `merge-gate` — the guards of a merge that are facts (thread 026)

```
agent-protocol merge-gate --ref <ref> --pr <n> [--repo <path>] [--power-docs <a,b>] [--working-cards <a,b>]
                          [--review-workflow <name>] [--d1 <thread>/<message file>]
```

The `curator` role merges pull requests itself, under five guards. Three of them are
facts about the pull request and this command answers them in one call: an `approve`
verdict **on the current head**, green checks **on that same head**, and no **document
of power** in the diff. Exit 0 — nothing in the facts forbids the merge; exit 1 — a
guard does not hold. The facts come from `gh pr view --json` (the tool a session
already runs to look at a PR; **the token is taken from the `secrets.envFile` of this
circuit's machine config** unless the caller already exported one — the first line of the
output says which file and which variable won, never a value), and its answer is
validated at the door — a renamed field is a refusal by name, never a silent "no
reviews, no checks", which for a merge gate would fail open.

**Two guards are never reported as passed, and that is the point.** Whether the feed
really holds a decision of the owner of the decision (here: john) behind this PR (guard 3), and whether the merge gets
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
whether or not the word "card" fits it — the normative texts of the protocol, the
CI workflows, the settings of the agent tooling. A workflow is nobody's role card,
but a change to one goes to the owner of the decision by the same boundary, and
until such a path was declared the gate answered a workflow PR with "none of them a
document of power", which is silence exactly where the norm refuses.

**The declared side lives in the config, `powerDocuments`** (protocol version 18), and
`--power-docs` ADDS to it rather than replacing it. It was a flag alone until then, which
made the completeness of guard 4 equal to the memory of whoever typed the invocation: the
string sits in a role card and is copied by hand, and the measurement of thread 024 says 4
of 17 pull requests touched documents of power while derivation would have caught one. The
flag stays for what the config does not know yet — a document that became one this
morning, named without a commit.

```json
{ "powerDocuments": ["PROTOCOL.md", "REVIEWER.md", ".github/workflows"] }
```

The key is OPTIONAL, and a config without it behaves exactly as before: the derived side
and the flag are untouched, and nothing refuses. Which documents carry authority is a
judgement about one repository, so no default is supplied and no migration fills it in.

**The list is read from the BASE of the pull request**, like every other policy field this
command asks about (`config/policy.ts`) — so a pull request that adds a path to
`powerDocuments` is judged by the list *without* that path. That is right by construction:
what a change proposes about its own authority is not authority yet. It is also why the
door prints **the source of every path** — derived from a role's instructions, the config
itself, declared by `powerDocuments`, or named by `--power-docs` — and says out loud when
the config declares nothing at all:

```
merge-gate: documents of power judged by (3):
merge-gate:   agent-protocol.json — the protocol config itself
merge-gate:   docs/roles/curator.md — derived from a role's instructions
merge-gate:   PROTOCOL.md — declared by 'powerDocuments' of the config
```

A trace that showed only the verdict could not tell a full list from a short one, and a
short one is exactly what a forgotten flag produced.

**And the door names the work a merge leaves on the boxes** (thread 040). When the diff
touches the protocol config, the last two lines the command prints are not a guard and
change no verdict — they say that IF this diff moves `protocolVersion`, the button is not
the end: every box running the circuit refuses every command until its build is pulled.

```
merge-gate: this diff touches 'agent-protocol.json' — IF it moves 'protocolVersion', THE
BUTTON IS NOT THE END: every box running the circuit refuses every command until its build
is pulled. After the merge, on each box: git pull --ff-only && pnpm install && systemctl
--user restart agent-protocol@<instance>
```

The wording is conditional on purpose: the gate reads the NAMES of the changed files and
not their content, so what it knows is that the file carrying the number was touched. An
"if" a reader can check beats a claim they cannot.

**But a role's instructions are not always a document of power** (john's decision of
2026-07-28, on the reviewer's finding against the first version of this command): the
boundary runs by the NATURE of the document, not by the fact that a role points at it.
A role card says what a role MAY do; a WORKING card is the instruction a session
works by, updated in the same commit as the code it describes — under a project rule
that keeps documentation with its code that is almost every package. Derived from
`instructions` alone, guard 4 stopped every one of those, and that would have eaten the
autonomous merge as a class — the very thing the guard exists to make safe, not to
prevent. So the caller names its working cards, `--working-cards <path>`, and they
are subtracted **from the derived side only**: a path also passed to `--power-docs`
stays a document of power, because saying it outright is the stricter statement. Both
the subtraction and any entry that matches no role's instructions are printed — a flag
that quietly hits nothing is a flag its author believes in.

What the subtraction leaves behind is a norm, not a hole, and it lives in the card of
the role that merges: a change to a working card that moves authority, borders,
permissions or zones goes to the owner of the decision, and doubt reads as "it moves
them".

**And a verdict younger than the head can still be about another tree — so the anchor of
guard 1 is the RUN** (thread 027, measured twice on the served project's PR #347 of
2026-08-21). The round of review started on head `34716450`; a push landed mid-round and the
head became `e7386435`; the round went on judging the old tree and sent its verdict at
22:54:33Z. GitHub anchors a review to the head the pull request has **when `gh pr review` is
called**, not to the head the text answered about, so the formal status said "approved on
`e7386435`" and this door printed `ok guard 1` about an analysis of somebody else's tree. The
age test above cannot see it: the verdict is YOUNGER than the head, which is the one thing
that test reads as healthy. It cost nothing that day only because guard 2 happened to STOP the
same PR for its own reason — two refusals coinciding is luck, not a door.

The review object cannot be made to give up the commit it analysed: `commit_id` of REST and
`reviews[].commit.oid` of GraphQL both answer the current head for the orphan exactly as they
do for a healthy verdict. What does answer honestly is the run — a round on the `pull_request`
event carries the head it read in its own `head_sha`, and nobody substitutes that. So an
approve is credited when a **closed round of the reviewer's workflow exists on this head** and
the verdict lies **inside its window** (`created_at` … `updated_at`):

```
agent-protocol merge-gate --ref origin/main --pr 61 --review-workflow 'Claude PR Review'
  ok   guard 1 · approve on the current head: approved on 7ba1d22 by reviewer-pr — inside the round 32535411165 of 'Claude PR Review' on this head (…)
```

**The workflow is NAMED by the caller and never guessed** — the reviewer's workflow is a fact
of the served project, the same line the documents of power do not cross. And the reading has
**three** states, not two, because `actions/runs` is an ACTIONS resource: an installation token
(`ghs_…`, what every `gh-action` executor of this protocol runs with) answers `Resource not
accessible by integration` unless its job lists `actions: read`. A door that read that refusal
as `ok` would put the defect straight back, and one that read it as STOP would refuse every
caller that never had the scope — so guard 1 answers `by-hand`, with GitHub's refusal quoted
word for word and the manual form of the check (`gh api "repos/{owner}/{repo}/actions/runs?head_sha=<head>"`)
named beside it. It answers the same way when no `--review-workflow` was given at all, and when
the approve carries no `submittedAt` to place inside a window: `by-hand` means the anchor could
not be MEASURED, STOP means it was measured and does not hold, and neither is ever a pass.

Nothing new is let through by any of this — the guard only stops crediting an approve it used
to credit blindly, which is why the change is a defect of the tooling and not a move of the
norm. The scheduler's merge-ready reader (`orchestrator status`, the queue) does not ask
Actions at all, one call per PR per tick being too much for a hint: it treats an obligation as
"nothing refuses" and raises the pair, and the anchor is answered at the door, where it belongs.

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

**A verdict with no author is its own group**, for the same fail-closed reason and not as
a detail of keying. Grouping the unnamed ones together would let the later verdict of one
anonymous reviewer silently overtake the earlier verdict of a DIFFERENT one — a
`CHANGES_REQUESTED` swallowed by somebody else's `APPROVED`, which is precisely what the
grouping-by-reviewer exists to prevent. It does not reproduce against today's GitHub (the
one reviewer is `github-actions` and always carries a login), and that is the argument for
pinning it rather than against: the payload without an author arrives when nobody is
watching for it.

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

**The age is asked of the last verdict of each author, not of the history** — and this
was the second round of the same thread. Asked of the whole `reviews` array, the age test
locked the door FOREVER on any PR a `workflow_dispatch` run had ever reviewed: that
record never leaves the array, `gh` keeps showing it against the current head, and the
repair the refusal itself names — a run on the `pull_request` event — only adds a verdict
beside it. The refusal outlived its own remedy, which is the one thing a refusal must not
do. So D4 runs first: the verdicts on the head are grouped by author, and only what
survives the grouping is asked its age. An author whose LAST word is anchorless still
stops the door, and another author's approve does not clear it — being overtaken by the
same reviewer is what clears a verdict, and nothing else is.

**What guard 2 does not ask, said under it — `note · base` (023.3).** A green check hangs
on the head and the guard credits it there. But a `pull_request` run does not measure the
head: it measures `refs/pull/N/merge` — **the head merged with the base as the base was
when the run started**. Move the base afterwards and GitHub rebuilds that ref, but nobody
reruns a check that has already answered: it stays green, stays on the same head, and the
guard goes on crediting a reading of a tree that is no longer the result of this merge.
Measured in thread 023: run `30819577162` started 13:47:19Z on head `92b2c612` over base
`951b7551`, #189 landed at 14:00:28Z, and until the next push the door would have counted
that reading for fifteen minutes. `mergeStateStatus` does not cover it — it says `BEHIND`
only under a "branch must be up to date" protection, which this repository does not have.
The symmetry that makes it one class: guard 1 already asks this question on the other
axis (a verdict older than the head commit is not about it); the time of a CHECK against
the BASE was asked by nobody.

**It only speaks.** The verdict and the exit code are identical with a drift and without
one, in every branch, and that is locked by test rather than by intention: a door that
began refusing what it used to pass would be a change of the norm, and the norm belongs
to the owner of the decision (here: john). The note is printed under guard 2 and marked `note`, never as a guard.

**The measurement is conservative, and that is its honest name.** The API does not hand
back the merge-ref a check actually read, so the comparison is the base head's
`committedDate` against the **start** of the credited attempts — the earliest of them,
because guard 2 credits them all. It will therefore name a base move that could not
change the merge at all (#189, one new test, is exactly such a move), which is admissible
precisely because the verdict does not move: the price of a false positive is one line of
text. It rests on one assumption, said rather than implied: **the commit date of the base
head is the moment it landed** — true while merges are squash-only, as they are here.

**Silence is earned by one state only:** a base read, dated, and older than every credited
check. No branch name in the payload, no readable answer, no start stamp on a credited
check, nothing green credited at all — every one of those is SAID, in its own words. This
is the false-silence class the daemon's vintage line repaired twice (`unpublished`,
`unreadable`), and there is nowhere left to repeat it. The base costs a second ask —
`gh api repos/{owner}/{repo}/commits/<baseRefName>`, since `gh pr view` dates the PR's
commits and never the base's — and a refusal of that ask is a note, not an error: nothing
is computed from it. For the same reason `baseRefName` is the one field of the payload that
is NOT pinned: a `gh` that stops answering it makes the door say it cannot tell, where a
`gh` that stops answering `mergeable` makes it refuse.

**The ask names the BRANCH, and this is the whole of the repair of 023.4.** The first
shipped form of the note asked about `baseRefOid` — the head of the base as recorded when
the branch was CUT. That SHA does not move when the base does, so it dated a commit nobody
was asking about, `drift` was unreachable and `current` was printed about a measurement
that never happened. Measured on the live circuit minutes after the merge: `main` moved to
`6b87776f` at 15:42:33Z while PR #192, whose credited `checks` started at 15:25:28Z, still
reported `baseRefOid: 44471804`; PR #3, opened 24.07, reports a July commit to this day.
Every guard held and every test passed while it was wrong — the states were honest about
the answer and nothing checked the question. The second ask is now pinned to the branch by
test, and both halves of the reading (which commit, and when it landed) travel together:
half an answer is treated as no answer, because a SHA with no date would print as silence.

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

**The token needs scopes, and the gate does not say WHICH.** Guard 2 reads
`statusCheckRollup`, which GitHub serves only to a token holding `checks: read` — and
`gh` asks inside it for `checkSuite.workflowRun`, which is Actions and wants
`actions: read`. A personal token has both; a GitHub App installation token (`ghs_…` —
what any `gh-action` executor of this protocol runs with) has only the scopes its job's
`permissions:` block lists and, through `claude-code-action`, only what the token
exchange asked for in `additional_permissions`; an unlisted one is zeroed rather than
defaulted. The whole `gh` call then fails with `Resource not accessible by integration`
instead of degrading, so the gate answers nothing at all rather than answering wrongly.

That much is observed, not hypothetical — it is how the reviewer of this very PR found
that its "live run" had only ever been made from a session token. What the refusal path
does NOT do any more is **declare the cause**. It used to answer "`statusCheckRollup`
needs a token with the `checks: read` scope" to every failure, and it was wrong twice
over: `checks` was already granted through three rounds of diagnosis (#108, #109, #112 —
the field actually refused was the Actions one), and the test that fired the note matched
the word `statusCheckRollup` in the ECHOED COMMAND LINE, so a plain 404 from a `gh`
account without access to the repository was explained by a missing scope too — six of
them in one round. Now the reason `gh` returned is printed whole as the fact, and a hint
is added only on a refusal that is scope-shaped, naming the path GitHub itself refused and
offering a candidate as a guess (`merge/gh.ts` → `ghRefusalHint`).

**Why the project's extra documents came in on `--power-docs` alone for as long as they
did**, a config section being the shape one would otherwise pick from the start: a new
config field costs a protocol version by R2, and a version bump used to be uncommittable —
the zones door read the config at `origin/main`, still at the old number, with the package
of the working tree, which writes the new one, so `loadProtocolConfig` halted the door on
the mismatch. That was a defect of the door and not of this command, it was settled in
thread 037 (both doors ask a POLICY question about a foreign ref and tolerate the skew),
and the list moved into the config at version 18 — measured first: on a head carrying code
18, `config check --ref HEAD` refuses a config still at 17 and passes one bumped in the
same commit, so the number rides in the same pull request as the field.

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
  no place in the history of the mail branch). One event per line; the order is the order
  of the lines of a single writer, so the seq comparator of migrated messages is
  not needed here. Kinds of events: `lease-acquired` (with a `deadline`),
  `launch`, `handoff-detected`, `lease-released` (with a `reason`:
  `completed|forced|exited-without-handoff|supervisor-gone|timeout|stalled|input-timeout|exited-while-waiting|exhausted|quota-exhausted|auth-failed`;
  a `quota-exhausted` also carries `until` when the signal named the reopening time,
  and `window` — the vendor's own word for WHICH window closed, which is the key of the
  backoff shelf),
  an `auth-failed` says THIS BOX COULD NOT AUTHENTICATE to the vendor (thread 023, the
  OAuth episode of 2026-08-01) — the same class as the closed window and deliberately a
  different name: a window reopens by the vendor's clock, dead credentials reopen when a
  human runs `claude login` here. Like `quota-exhausted` it counts towards neither the
  pair's attempt ceiling nor the global run budget, and while it stands the tick raises
  nobody, knocking once every `AUTH_SHELF_MINUTES` — that knock IS the probe, because such
  a death costs 0 seconds and $0;
  `launch-refused` (with a `reason`: `run-budget|quota|auth`, S3) and `stop` (with a `mode`). The
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
- **A MARK IS A CALL TO A HAND, AND A CLOSED THREAD HAS NOTHING TO CALL ONE FOR**
  (thread 016). A pair whose thread is closed keeps its ROW — the frame prints the
  history of the journal, and that history happened — and loses `⚠ EXHAUSTED` with the
  advice attached to it; the line then reads `· exhausted (substantive, and the THREAD
  IS CLOSED — …)`. The frame learns the closures from the same mail scan the queue is
  built from (`closedThreads`); a reader with no mail in its hands prints the frame it
  always did. **The word "until then" is conditional with it**: the term is named only
  where one exists (an external freeze with a live backoff) and left out where the
  sentence names a hand instead — a half-sentence promising a deadline the other half
  had stopped naming was what #23 left behind in the same sentence.
- **THE ATTEMPT COUNTER IS CONSECUTIVE, AND IT IS PRINTED WITH ITS CEILING**
  (`attempt 1/3`). It counts the failures of a pair SINCE ITS LAST DELIVERY — a
  `completed` release or a handoff puts it back to zero. A cumulative count was the
  defect of 2026-07-26: dev-core×016 stood at `attempt 13` with eleven completions
  behind it and had dropped out of the candidates for good, which is not a protection
  but a bomb with a counter — any long-lived thread reaches it eventually, no matter
  how well it works. A handoff resets it as well as a `completed`, because the turn
  passing IS the delivery: a supervisor that dies right after one leaves
  `supervisor-gone` on a run that did its job.
- **AND IT COUNTS ONLY THE ROUNDS THE PAIR ACTUALLY GOT** (thread 023). Which endings
  spend an attempt is ONE table in `lease.ts` (`SPENDS_ATTEMPT`), one row per class of
  `RELEASE_REASONS`, each decided by one question — *did the pair have its own chance to
  do the work in this round?* Spent: `completed`, `timeout`, `forced`,
  `exited-without-handoff`, `stalled`. **Not spent, and the acquire that opened the round
  is undone**: `quota-exhausted` and `auth-failed` (one resource of the whole box — one
  closure hits every role at once), `input-timeout` and `exited-while-waiting` (the round
  went to a wait for a human, R19), `supervisor-gone` (the box killed its own sessions on
  the way out), `exhausted` (the ceiling was already reached). It is an UNDO, not an
  amnesty: two own breaks, then a round nobody gave the pair, then a third own break still
  reads `3/3 ⚠ EXHAUSTED`.
- **A COUNT PAST ITS CEILING SAYS WHY.** `attempt 4/3` is a real state — a thaw raises a
  frozen pair once more — and the frame no longer prints it bare: past the ceiling the
  column reads `attempt 4/3 (past the ceiling — raised again by a thaw)`, unless the pair
  is exhausted, where the `⚠ EXHAUSTED` mark already carries the whole sentence.

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
  - **A signal without a time ends at the boundary the vendor already stated** (thread
    019, `windowBoundaryOf` + `shelfEndOfRefusal`), and only falls back to the SHORT shelf
    (`SHORT_SHELF_MINUTES`, 5m) when there is none. The stream carries a `rate_limit_event`
    in the first frames of every session and it carries `resetsAt` **whatever the status**
    (measured on the live LLE box, 2026-08-21: every observation is `status: allowed` with
    a `resetsAt` and a `rateLimitType`) — so the moment the window reopens is known before
    it ever closes, and a refusal that named no time no longer has to be guessed at. The
    refusal's own time still wins; a refusal that named its window takes that window's
    boundary; a prose refusal that named none takes the EARLIEST future boundary, never
    the longest — a seven-day number must not stand the box down for a week on a signal
    that never said which window it was. **A permitting event is a boundary and never a
    closure:** it opens no shelf, and the two readings are separate functions so that no
    later edit can turn `status: allowed` into a stand-down. "Closed, reopening unknown"
    must still not be inflated into "closed for five hours": the cost of too short is one
    launch that immediately re-signals and re-shelves, the cost of too long is hours of a
    circuit that could have worked. A repeat signal extends the shelf.
  The tick returns its own decision kind (`quota`), every candidate it stands down comes
  back as a skip with that reason, and the daemon says the shelf out loud EVERY tick —
  while the journal gets ONE `launch-refused {reason: quota}` per shelf, not one per tick.
  The shelf ends **by the clock and by nothing else**: a backoff that needed clearing by
  hand would be `exhausted` under another name. It is visible in `orchestrator status`
  (its own `quota:` panel, which also says when no window is closed) and in this box's
  **instance digest** — a box standing down has no live leases to publish, so without it
  the neighbours would read its silence as "nothing to do".
  - **Every surface opens on the word `quota-paused`** (thread 019, §4): the daemon's
    stream, the `status` panel, the TUI and a neighbour's digest all print
    `quota-paused until <ISO> (<Nm> left) — <window> window of <account>; …`, and
    `notify` carries the same fact as a STANDING category of its one-line digest —
    `quota-paused, resumes HH:MMZ (Nm left) — …`, printed every tick while a window is
    closed. The minutes are rounded UP (a shelf with forty seconds left says `1m`, never
    `0m`) and a shelf whose end we GUESSED says so in both shapes, so the short default
    is never read as the vendor's word. The courier's category does **not ring**: a quota
    pause ends by a clock the box already holds and there is no action behind it, so it
    is printed, not delivered.
  - **The round the vendor ended is UNDONE, not merely forgiven** (thread 019, §4). A
    `quota-exhausted` release has never counted as a failed attempt, but the
    `lease-acquired` that opened the round moved the counter and nothing moved it back:
    a pair at 2/3 came out of a closed window reading 3/3, and after its next real break
    the frame printed `attempt 4/3` with no `⚠ EXHAUSTED` — a line contradicting itself
    and claiming one attempt left where two remained. The release now decrements what the
    acquire added, exactly as `consecutiveLaunchesWithoutDelivery` already did for the run
    budget. It is an undo and not an amnesty: the pair's own failures before the window
    are still its own, so it still exhausts on its third real break.
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
  `deliveryMarks`): a `lease-released` carrying a `session` that also signs a
  message in the mail delivered; a session that wrote nothing did not. Both halves are
  load-bearing — silence is exactly the failure the ceiling exists for.
  **The mail answers in TWO signs, because the first one has a window it cannot cover**
  (thread 021). `session:` is minted by the vendor and reaches the writing command through
  a file the supervisor fills once it has parsed the id off the session's stream; a message
  written before that goes out with `worker` and no `session`, on purpose — a run that
  cannot name its run still has a turn to pass. The second sign takes such a release as a
  delivery when a message written by a RUN's worker, by the pair's own role, into the pair's
  own thread, is stamped INSIDE that run's lease window (both edges come from the journal —
  the acquire and this release). It is narrow by all four at once: a session that died
  silently still spends its attempt, and a reader with no acquire behind it does not use the
  second sign at all. What it cannot tell apart, said out loud: a person writing by hand as
  the role, into that thread, with `--worker claude-code`, inside that window. Measured on
  2026-08-21: the window at the door is reachable (13 messages of the current header form
  carry a worker and no session), while on the live journals the second sign changes nothing
  yet — LLE's 18 self-exits of that day still read 15 deliveries, exactly as before. Judging by the
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
  **In every frame a human reads, that state is printed `working on — already reported,
  turn passed`** (thread 019, widened by thread 063): `draining` is the machine's word and
  reads as "shutting down", while the session is in fact still working inside the same
  window — john read the frame three times and asked all three. The translation lives in
  the renderer only; `state` stays `draining` wherever it is data (the journal, the digest
  a box publishes), and the deadline column beside it is the "until when".
- **One vocabulary for every state a human reads — `orchestrator/state-word.ts`** (thread
  063). The translation of thread 019 covered `draining` in `status` alone, and the two
  OTHER renderers of the same fact — the parallelism block of the frame and the line about
  a neighbouring box — kept printing the raw machine word beside it; that is the list john
  read `draining` in on 2026-08-30. Now `stateWord(state, reason)` is the single source of
  the display phrase for all three, each of the eleven release reasons has its own sentence
  instead of a bare enum in brackets, and an unknown state (a neighbour on another version)
  is printed as it came rather than guessed at. `timeLeftWord(view, now)` adds the second
  half — `40m left of its window`, `18m left of the wait`, `12m past the end of its window`
  — on the clock the fold itself judges by, and nothing at all on a terminal lease. It stands
  BEFORE the deadline stamp on purpose: the observer's top panel cuts the line to the
  terminal's width and the cut eats the END, so what survives is the half a reader READS and
  what is lost is the stamp they COPY. Every human frame carries it, the observer's top panel
  included — `tui` calls the same `renderLeaseLine` with the frame's `now`, because `status`
  saying "60m left" about a pair while the observer showed only a stamp is the same
  two-renderers defect one layer up. The inventory the vocabulary was derived from, including
  the states still MISSING, is [`docs/state-model.md`](../../docs/state-model.md).
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

- **Every tick sends a dead-man ping, and silence is the alarm** (thread 017, john's
  decision of 2026-08-19). The daemon has a watch of its own, and it is a SECOND monitor
  beside the box's cron ping: on 2026-08-18 the circuit stood dead for 2 h 50 min behind a
  fully green dashboard, because the box's ping answers "is the box alive" (it was) and CI
  answers "does the code build" (it did), and nobody was asking whether the daemon was
  ticking. The URL lives in the secrets file the machine config names (`secrets.envFile`,
  R14) under `HEALTHCHECKS_CIRCUIT_URL` — never in `agent-protocol.json`; it is a
  credential (whoever knows it can silence the alarm), so only the NAME of the key is ever
  printed. **The box's own `HEALTHCHECKS_URL` is refused as the value, by name**: one
  monitor beaten by two senders stays green while either of them lives, which reproduces
  the 2 h 50 min by construction. **On a box that hosts several instances the key carries
  the instance's name** — `HEALTHCHECKS_CIRCUIT_URL_<INSTANCE>`, UPPER_SNAKE with `-` → `_`
  (`lle-hetzner` → `HEALTHCHECKS_CIRCUIT_URL_LLE_HETZNER`), because both machine configs of
  such a box name ONE secrets file and one key there would mean one monitor for two
  daemons: the same refusal one level up. A named instance does NOT fall back on the bare
  key — the bare key with several instances IS that collision, so the watchdog is off and
  the banner names the key it wanted; an unnamed `local.json` box reads the bare key and
  behaves exactly as before; both keys present is the MIGRATION (lay the keys down, restart,
  then delete the bare one) — the suffixed one wins and the bare one is named as ignored in
  one line. An instance name that is not a legal key suffix is refused rather than mangled.
  **And the box-URL refusal has a general form**: the value already present in the same
  secrets file under ANY other name is refused by both NAMES (never the values) — that is
  what catches one URL pasted under two instances. **The key absent is the ordinary case** — no ping, the
  daemon works exactly as before, and it says so ONCE in the banner rather than every tick.
  **What a beat proves is narrow and is said in the code**: this process is ticking. A
  daemon spinning without raising anybody beats too — the class this catches is "the
  process is dead or was never started", which is the class that cost the 2 h 50 min.
  **The degradation is one-way**: the ping is issued at the top of the tick and waited out
  at the bottom (so its latency runs alongside the tick's work, never in front of a
  launch), it is bounded by a budget, and a dead network, a 5xx or a timeout can never
  become the reason a role was not raised. **"At the bottom" is every way out of the tick,
  including the one that leaves by `process.exit`** — the handback of a supervised daemon
  that repaired its own tree waits the beat out like the rest, because a request nobody
  waits for does not leave the box, and the tick before a repair is the one whose beat
  says the process reached its handover rather than died on the way. The failure is said
  on the stream when it STARTS and when it ends, not on every tick. **Creating the monitor is john's hand**
  (an external account, money) — see §7 of `docs/box-setup.md`.

- **One beat is up to three attempts, and a slow answer is not a dead monitor** (thread
  `057-circuit-ping-flaps`, measured 2026-08-30). The beat used to be a single 5 s attempt
  with no retry, and it FLAPPED: 182 lines in one daemon log, `NOT delivered` and `answers
  again` strictly alternating — every one of them a false alarm that sent a human to a
  healthy box. **The measurement refuses the obvious reading**: 40 requests from that box to
  the monitor host answered in 0.49 s median, 1.18 s worst, DNS 0.5 ms warm — the network was
  never near the threshold. What the journal shows is the daemon starving its own watch: the
  beat is issued at the top of the tick, the tick then runs SYNCHRONOUS git, and a blocked
  event loop delivers no socket callback and runs no timer, so the 5 s abort fired on a
  request whose half-second of network had nowhere to be noticed. So the beat now takes the
  form of the box cron that never flapped (`curl -fsS -m 10 --retry 3`, §7 of
  `docs/box-setup.md`): **10 s an attempt, up to 3 attempts, a 1 s pause between them** — the
  retry runs after the first attempt is settled, i.e. with the loop free again. **The whole
  beat is bounded by a budget** (20 s, and never more than one tick: the beat is waited out
  in front of the sleep, so what it spends is delay before the next launch), the last
  attempt's timeout is clipped to what is left of that budget, and a box that ticks faster
  than one attempt makes one attempt and no retries. **The threshold moved, the class did
  not**: a monitor that answers no attempt still gets its line, once, and the line now names
  how many attempts were spent — and when the beat outran its own timeouts on the wall clock,
  it says the wait was THIS PROCESS and not the monitor, because a watch that reports "the
  monitor is silent" when the truth is "I was too busy to listen" sends the operator to the
  wrong box.

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
role** (whether the daemon comes up by itself through systemd or by hand) is the fork of
the owner of the decision (here: john) and lies outside the daemon code: the daemon is the same, only the
way it is STARTED differs. For now the start is manual; the daemon travels into
main disabled, so a merge creates no autonomous spending.

### S4 — a forced stop and printing the journal

Two stops of different strength, plus `log` for the owner of the decision (here: john).

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

**The generated unit runs node PLUS the tsx loader, by absolute path** (both named
from the box `systemd install` ran on). This CLI is TypeScript: bare `process.execPath`
in front of a `.ts` entry point produces a unit that fails on its first import
(`ERR_MODULE_NOT_FOUND` — the live one of 2026-08-02), and a `.bin/tsx` shim would put
a second process between systemd and the daemon. A built `.js` entry takes no loader —
the suffix decides. For the same reason the first human step the command prints is
`systemd-analyze --user verify`: systemd does not refuse a key in the wrong section,
it ignores it with a journal line, so a unit can look installed with half of its
guarantees quietly absent.

**`Restart=on-failure` in that unit is the SECOND echelon, not the first.** The
daemon survives what heals by itself (the mail probe above) inside its own loop; the
unit covers what it cannot survive — a crash, an OOM kill, a fatal check that was
repaired while the process was down. The two do not overlap: a restart loop on a
missing binary would be the same forever-line the in-loop split refuses, only louder,
so the fatal path deliberately exits and stays exited until a human acts.

- **The enable state survives a reboot by construction.** `--enable-flag` is a file
  on disk, read every tick; after a reboot it is in the position the operator left
  it in. Autostart (systemd) brings up the DAEMON but does not enable LAUNCHES:
  disabled they stay disabled, enabled they stay enabled (otherwise autonomy would
  be cancelled by every kernel update). **The flags must lie on persistent storage**
  (not tmpfs), otherwise the state will not survive a restart.
- **`status` reflects the mode** (`--mode-file` + `--enable-flag`): how the daemon
  is brought up (autostart/by hand), whether launches are enabled and what will
  happen after a reboot — so that this does not live in somebody's memory.

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

**Honestly about the guarantor.** Neither `touch` nor `orchestrator enable` tells the
owner of the decision (here: john) apart from an agent: "a human enables it" is a PROCEDURAL guarantee and always
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
runs without a completion, and the stop and the force in the hands of the owner of the
decision (here: john).

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
  config) instead of a bare "not found". Since thread 026 that layer is named
  precisely — `kind` (the name the tool's own kind declares) or `worker-id` (a guess
  from an id this package does not implement) rather than one nameless `default`, and
  the row is about the RIGHT binary: a box with no `codex` installed now reads
  `✗ agent: binary (codex): 'codex' (kind) not found …` instead of a tick on the
  claude binary. **The binaries of EVERY launchable role are
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
box ANSWERS FOR (the topology of this instance, verbatim) and the LIVE leases — role, thread,
state, deadline. A released pair is history and is dropped; history stays in the local journal,
because a growing file in a shared branch is paid for by every clone of the mail forever.

**`roles` is a property of the BOX, not of a launch** (thread `025-stale-instance-digest`,
second half — a deliberate change of contract). It used to mean "the roles this run raises,
after the topology and the operator's flags", which made one file say different things
depending on which command wrote it last: `run --roles dev-core` on a box that also answers
for curator published `["dev-core"]` over the daemon's `["curator","dev-core"]`, and a reader
on another machine saw the box shrink with no way to tell that from a topology change. It is
now read off the topology by one function (`rolesOfInstance`) that both writers call, and it is
NOT filtered by launchability: a role of this box that nothing can raise today (no
instructions, no launch profile, a resident that is hosted rather than launched) is still this
box's role, and hiding it would make "not ours" and "ours but quiet" the same silence. What a
particular launch raises is not lost — `leases` carries it, and carries it as a fact rather
than an intention. Why a listed role never appears among the leases is content the digest does
not carry yet; it belongs to D-4 of thread 023, where the digest gains a live perspective.

**Both holders of a lease publish, through ONE publisher.** The moment matters more than the
content (that was the first half of thread 025: a publisher called once per tick, at the end,
by which time the session raised in that tick had already released its lease — so every tick
computed `leases: []`, the change gate said "unchanged", and a digest whose whole purpose is to
say what the box is doing never once said it). The rule is: publish when the LEASE MOVES, not
when the loop comes round — a hook on every lifecycle write (`onLeaseChange`), plus the
end-of-tick call for state that changes without a run (a lease released by hand, an orphan
folded away by the clock, a ceiling that made a pair terminal). And `orchestrator run` — the
launch a human types, `-d` included — publishes on the same events, from the same factory
(`digestPublisherFor`). "A human is watching that box anyway" is not an argument for leaving it
out: that human is the one reader who does not need the file. It exists for the reader who is
not there, and to them a fresh `writtenAt` with `leases: []` is indistinguishable from an idle
box — a lie made worse than the original by being uneven, since its truthfulness would depend
on which command raised the session. A second copy of the publisher in the `run` path was the
wrong answer for the reason the first defect teaches: two publishers of one file drift, and the
drift is invisible until somebody reads the file at the wrong moment. A dry run publishes
nothing (it holds no lease), and neither does the parent of a `--detach` run — its child does.

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

**A BENCH is not a stale box** (thread 055). An instance the repository declares with NO roles
raises nobody, so no daemon of its own ever rewrites its digest and the age of that file grows
forever: on this box `main` — john's laptop, kept declared so the id stays taken — carried a ⚠
for four days, and a warning that is always on is how an operator's frame stops being read. Its
line says `· bench — the repository declares it with no roles, so nothing rewrites this file`
instead, and the old `writtenAt` stays on screen: an unexplained ancient timestamp is the other
way to lose the reader. The verdict is read off the TOPOLOGY, never off the digest's own
`roles` — a bench that has SINCE been given roles is exactly the box whose silence is news, and
its file (which only a running daemon rewrites) would keep claiming zero roles and suppress the
one warning that case needs. With no topology declared there is nothing to judge against, and
every digest is measured by age alone — the same rule `check` follows.

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
that holds the turn open (`await-input` of S13, or any command of the session's OWN work it runs
and waits out), or report in the thread and pass the turn on, leaving the waking-up to the daemon
of S3. Illegal: finish the turn intending to come back when something reports. The prompt names
the illegal one in its own words rather than only listing the legal two, because the failing
sessions had read the legal two — what they invented reads like a blend of them.

**The foreground ending is never for SOMEONE ELSE'S run** (john's hard rule, 2026-08-28, thread
`037-no-foreground-waiting`: "no role should ever wait for any run that is going to write into
the thread anyway"; the norm itself lives in the project's `PROTOCOL.md`, «Ожидание чужого
прогона — не действие»). A CI job, a review round, a verdict on a PR the session opened or
labelled all report into the thread on their own, and a role has ONE slot: a session waiting one
out holds the queue behind it. The paragraph used to list "a watch, a command you run and wait
out" without asking WHOSE job was being waited on — that is, the prompt authorised the very thing
the rule forbids, and it is narrowed here rather than left to the role cards to contradict. The
field case that produced the rule: on 2026-08-28 a session labelled one PR and stayed in the run
while two other green PRs waited for their labels behind it. The prompt states the ban as its own
sentence and names the exit in the same breath — say what was started, park on it
(`--parked-on run:<N>` / `pr:<N>`) when nothing else can move, pass the turn. Pinned by a test.

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

**`orchestrator restart`.** Picking up fresh code as ONE gesture, because until now it was a
hand-run pipeline: `down`, then waiting out the live sessions (unpredictably long — once it
ended in a force stop), then `git pull --ff-only`, then `pnpm install`, then `up` with the
stopped daemon's flags reconstructed from memory. Four runs of that in two days, two with a
stumble. `restart` is a COMPOSITION of the three commands, whose semantics it leaves untouched:
the stop (`down`, or `stop --mode force` with `--thread`/`--reason` — the trace still goes to
the thread BEFORE the flag), the wait, `--pull` when asked, then `up`.

Three things it decides, and each is a promise:

- **The new daemon is raised with the flags of the one that was stopped**, read from
  `daemon.pid.args` — written by `up` beside the pid. Flags retyped from memory are exactly the
  stumble the command removes, and one silently dropped produces a circuit that looks restarted
  and behaves differently. A daemon raised before this existed leaves nothing to read: then the
  flags typed here are used and the SOURCE IS PRINTED — "the same flags" and "the flags you just
  typed" are different promises. Changing the settings is `down` plus `up <flags>`, deliberately
  not this command.
- **This process does the waiting** (the design fork the statement left open — process or
  successor daemon). A successor would have to be raised while the predecessor is still draining,
  i.e. two daemons on one journal, which is the state `up` refuses at its door. It prints its
  phases and says once a minute that it is still waiting, because a silent wait reads as a hang.
- **A refusal anywhere raises nothing.** Wait ran out, `pull` failed, `install` failed — the
  circuit stays down, the reason goes to the terminal AND to `daemon.log` (a restart that refused
  at 04:00 has to be readable at 09:00), and `up` by hand is one word away. Raising the OLD code
  instead would answer a question nobody asked while looking exactly like success.
- **But the STOP FLAG does not outlive that refusal** (thread 003, 2026-08-18). A `--pull` that
  fails in phase 3 has already stopped the daemon in phase 1, and the flag that stopped it is
  from then on aimed at whoever types `up` next: one failed repair becomes a box that stays dark
  through every attempt to revive it, which is what a hand met on 17.08. So a failing pull or
  install CLEARS the flag it set itself, by name and out loud, and says the circuit is down. That
  is not the silent clearing `up` refuses — it is the same command taking back, in the same
  breath, something it put down thirty seconds ago. The wait that runs out is the other case and
  keeps the flag: there the daemon is still ALIVE and still draining, and clearing it would
  quietly cancel a stop the operator asked for.

`--mode force` also clears both flags on the way up, so `rm` on a flag file leaves the operator's
cycle; `up --clear-force` is passed by the same command that put the force there a minute ago,
which is why that is not the silent clearing `up` refuses.

**And the fourth promise, bought live: the version gate is not this command's** (thread 055,
task 055.3). With `protocolVersion 15` on `origin/main` and a package that knows 14,
`restart --pull` died at the door — `restart required: … this build is behind the data (pull
and restart what is running on it)`, exit 2, nothing restarted. The message names the repair
and kills the command that performs it: the gate stands before the dispatch and cannot tell a
reader of the canon from its healer. A graceful restart therefore asks the config the third
question of `config/repair.ts` — *where does this box keep its state* (`orchestrator.state`,
`orchestrator.mailCheckout`, `mail.dir`) — parsed loosely, with the skew PRINTED on every read
that finds one. Loosely and not merely gate-free, for the reason `tolerateOlder` was deleted
over: a bump that adds a field trips the strict parse before any number is compared, and the
repro of 05.08 (a one-line `protocolVersion` bump) was the only shape a gate-only exemption
would have closed. `--mode force` keeps the gate — it writes a message into the mail before it
kills anything, and a message is protocol data.

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
then its static sections; `status --watch` prints the frame and nothing else; `orchestrator tui`
lays out the same frame as three panels (T-1). The observer computes nothing and reads no file of
its own: it draws `renderLeaseLine` for the pairs and slices `renderFrame` for the middle, which is
why two facts had to move INTO the frame before it could exist — the **resident waits** (a thread
waiting on a role the circuit never raises, R23-1, printed until then BESIDE the frame by `status`
alone, and therefore invisible to any other reader) and the **path of each pair's transcript**
(derived in the lease fold from the acquire moment by the same `sessionLogPath` the supervisor
writes by, rather than by scanning `sessions/` — a second answer to a question that already has
one). The single visible consequence, named before the code: the resident section of `status` now
stands one position higher, beside the queue. The point of the seam is that they have nowhere to differ: a watcher that computed
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
in `.worktrees/<role>` renames the human on their own checkout and signs every other
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

Two consequences worth naming. The instance digest (R13) is written by the machinery — the
daemon, or a manual `run` — rather than by anybody's role, so it is signed by the
machinery itself (`agent-protocol <orchestrator@agents.invalid>`) — a role there would
claim a turn nobody took. And the
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
deserves the refusal that names the migration rather than a complaint about a field.

Both are process-tested against a remote that is unreachable for real
(`daemon.config-outage.process.test.ts`): the daemon survives the wire dying mid-flight,
says so on every tick, and goes back to reading by itself when it comes back. The control
was run the way D-0's was — with the fallback disabled the test goes red on the historical
message verbatim.

**(c) A field newer than the code.** The third death of the same evening was a message,
not a config: a daemon raised at 15:15Z met `parked-on: pr:133` (the field's code landed
at 16:10Z) and dropped THE WHOLE THREAD out of the mail. The class is permanent — the
readers of a live circuit are processes started at different times — so the line is drawn
by the MEANING of a field rather than by tolerating errors:

- the four fields that answer WHOSE TURN IT IS (`from`, `date`, `expects`, `waiting-on`)
  still refuse their file. A thread that answers "whose turn" out of a message read
  without one of them is the silent staleness this package exists against;
- everything else — provenance, parking, priority, the launch directive, a task line — is
  read `soft`: the field is dropped, the reason is recorded in `Message.warnings`, the
  message is read. `loadThreads` returns those `warnings` (thread + FILE + reason) beside
  its `failures`.

**The two are said under separate headings, and that is load-bearing.** They state
opposite things about the same mail — "the conversation is not in the answer" against "it
is, minus one field" — so `check` prints `threads were not read:` and `fields were
dropped (the threads WERE read):` as two lists (`check.process.test.ts` asserts which
heading a line lands under; the first version appended the warnings to the failures and
every warning line contradicted the heading above it).

**Only `check` prints the warnings, and the narrowing is deliberate**: `mail`, `status`
and the daemon print failures alone. To a reader of a live circuit a dropped field
usually means "this process is older than the field it just met", which is not the
daemon's business to shout about; `check` runs the current code over the mail on purpose,
so there a field it cannot make sense of is a malformed field and gets a red exit.

**(d) A value written the way the FILE NAME writes it** (thread 065, variant (iv) of
curator's decision). On 2026-08-13 a thread opened by hand carried
`date: 2026-08-13T17-28-50Z` — the stamp with the colons `messageFileName` replaces,
copied back out of the name — and the whole conversation became unreadable to every
reader of the circuit. It was the SECOND refusal on that thread and invisible until the
first one (a missing `_meta.md`) was repaired by hand, which is the shape of the class:
one hand-made defect hides the next.

That form is not another value, it is another spelling of the same moment, so the reader
takes it and normalizes it **in memory**: `Message.fields.date` carries the canon, the
file on disk keeps every byte (it is somebody else's committed message — those are never
rewritten, and repairing them in place would move a norm rather than fix a defect), and
`messageFileName` rebuilds the same name it came from. Strictness is not traded away:
anything that is not the same moment written differently still refuses its file, quoting
the raw value rather than a normalized guess.

**Tolerance without a voice was refused, so it has a third channel**: `Message.notices`,
carried by `loadThreads` as `notices` beside `failures` and `warnings`, and rendered by
`renderThreadNotices` under its own words — *read in an OFF-CANON spelling*. It is a
third channel and not a warning because the three say different things about one mail
("not in your answer" / "in it, minus a field" / "in it whole, and the file is written
another way"), and it is printed by `derive`, `thread show` and `check` — including on
runs that end green, since the off-canon byte stays in git forever and a line only shown
on a red run is a line nobody would ever see. In `check` it does NOT colour the exit
code: the reader accepts the spelling by decision, and a command that called it a
violation would argue with the reader it checks.

### S24 — the code in the live daemon has an age, and it says it (thread 023, 023.2)

The config is re-read at `--ref` every tick; the CODE is loaded once, by node, when the
process starts. Nothing said so, and on 2026-08-03 the gap between those two tempos was
six hours wide: the daemon raised at 05:13Z carried modules from `a830761a`, the lift of
a `run:` park landed in `main` at 11:15Z, and two pairs stood behind a park the running
process had no code to lift. The stalls were read first as two defects of one predicate
and were not — the predicate on disk was correct both times. A fix that has landed and a
fix that is RUNNING are different facts, and only the first of them was visible.

**What was built is the smallest of the three variants on the table, deliberately.** The
daemon SPEAKS; it does not refuse to raise pairs on a divergence (that turns every merge
into a stop of the circuit) and it does not restart itself (a daemon killing itself among
live sessions). Those are variants (2) and (3): they change what the circuit costs and
they need a conversation about live sessions that has not happened. The cheapest cure for
silence is that it stops being silence — and the first measurement to take is how often
the line lights up at all.

- **at start** the daemon dates itself: `git rev-parse HEAD` in the checkout its own
  module lies in (the one thing that cannot lie about where node resolved from), plus the
  moment. Both go into the banner, and the pair is published to `daemon-code.json` in the
  state directory;
- **every tick** it compares that SHA with `--ref` **as the ref lies on disk** — no fetch,
  ever: a frame redraws every two seconds and a tick has one network read already;
- **a divergence** is one line beside the skips, and one line in the operator frame. It
  names FACTS — the loaded SHA, the ref's SHA, the distance in commits, since when the
  process is up — and no command to run: a line that ends in advice gets skimmed;
- **a match is silence**, in both places. This is the same rule the merge-ready tier
  follows (S21) and for a stronger reason here: a line every thirty seconds saying the
  code is current is exactly the noise that hid this failure for six hours;
- **the frame reads the DAEMON's vintage, never its own modules.** `status` is typed in a
  terminal that may be standing in any checkout; asked about staleness it would answer
  about itself. Hence the published file, read only while the daemon's pid is alive — a
  vintage left by a process that is gone describes nothing that is running, and the
  circuit section already says the daemon is not there;
- **and the vintage is believed only from the LIVE pid**, which is where the one asymmetry
  of this check sits. The file outlives its writer. A daemon raised from a checkout so old
  it has no idea this check exists publishes NOTHING and leaves its newer predecessor's
  file lying in the state directory — and a reader trusting that file would compare the
  ref against code nobody is running, find a MATCH, and say nothing. Silence about a stale
  daemon is this feature failing in the exact shape of the incident it was built for. So
  the vintage carries the pid that wrote it, and a live daemon that published none under
  its own pid is NAMED (`the live daemon (pid N) published no vintage…`) instead of
  passing for current. Why it published none is not knowable from here — code older than
  the check, an unwritable state directory, a process seconds from writing it — and the
  line says what is true rather than picking one;
- **and a reading that could not be TAKEN is a fourth state, not silence** (the reviewer's
  finding on #190). The ref may not resolve on disk at all: a checkout that was never
  fetched, a typo in `--ref`, a state directory that went away. That is a measurement that
  did not happen, and folding it into the same `undefined` as a match made the frame draw
  silence while the tick was naming the fault in the stream — the two disagreeing about
  the one subject this check exists to keep them honest about. Both now print the SAME
  sentence, from the same function: `the age of the loaded code is unreadable: <git's own
  words>`. Silence is earned by exactly one state — a measurement that happened and came
  back clean.

The core is pure and the repro is a test (`code-age.test.ts`): code at SHA A with the ref
at SHA B gives a line carrying both and the distance; code at the ref gives `match` and
nothing is printed anywhere; a CURRENT vintage signed by a dead predecessor, read beside a
different live pid, gives `unpublished` rather than the silence it would earn on its own
SHA; and a reading of `unknown` gives `unreadable` in the frame (`snapshot.test.ts`) rather
than the silence of a match.

### S25 — the box picks up its own new code, in the form its supervisor allows (055.2, thread 003)

Variant (3) of S24 — the daemon repairing its own drift — was built in 055.2 and is
described by the rule it runs on (`self-restart.ts`): on a drift, and only on a box with
zero leases, no stop/force flag, no operator hold, a clean tree and a checkout the daemon
actually serves, the process repairs itself; anything unmet is S24 verbatim (stand, and say
why, every tick). The attempt ceiling is keyed by the TARGET SHA, which is what makes it
self-clearing: a new commit on the ref is a new target with a fresh count.

**A version verdict is that same repair asked for in words, and until thread 040 it killed
the box instead** (measured on this repository 2026-08-28 19:45Z, the third outage of the
class in a week). A config declaring a `protocolVersion` this build does not know is a
refusal on EVERY read, and the daemon's first read of a tick is the courier's — thirty
lines before the drift block that owns the repair. `configFrom` answered it the way every
one-shot command does, with `fail(message, 2)`; 2 is this CLI's argument door, and the unit
of this box carries `RestartPreventExitStatus=2` (`systemctl --user show`, john, 20:05Z),
because an invocation that is wrong stays wrong however often it is raised. So the daemon
left once, no replacement was ever raised, the tree never moved, and the circuit lay dead
until a hand typed `git pull`. The watchdog was the detector, three times.

So the daemon — and only the daemon, every one-shot command keeps the refusal verbatim — now
carries that verdict out of its tick to `repairOnVersionVerdict`, which decides between
exactly two endings and neither of them loops:

- **the loaded code is behind the ref, the tree is clean** — pull, install if the pull moved
  what the installer reads, then leave with `75`, exactly as a drift is repaired. The
  successor is a fresh process over the pulled code, which is the build the config asked for;
- **anything else** — the code IS the ref (a pull would move nothing: what fixes it is a
  NEWER BUILD, not another process over the same one), the tree is dirty, the code cannot be
  dated, or the pull itself failed — leave with `2`, ONCE, printing the command a hand must
  type. The argument door is chosen deliberately here: a supervisor told `2` stops instead of
  raising four more processes into the same wall, so `StartLimitBurst` stays intact.

Live sessions are deliberately NOT a condition of this path, unlike `selfRestartVerdict`'s
zero-lease rule: a box whose every config read is refusing holds no session that can do any
protocol work, and the behaviour being replaced took those same sessions down with an exit 2
that left nothing behind it. The one irreversible step — a pull over somebody's unsaved work
— IS checked.

**What thread 003 changed is not the rule but the MECHANISM, and it changed because the
mechanism could not work under a unit.** The 055.2 form spawns `restart --pull` detached and
keeps ticking; the child sets the stop flag, waits the old process out, pulls and raises the
successor. That works for a daemon nobody supervises. Under this box's systemd unit it
cannot, and the failure is measured rather than argued:

- **the field trace** (`lle-hetzner`, 17–18.08.2026): the child printed `stopping pid …
  gracefully` and `the stop flag is set` and stopped mid-phase. The daemon exited **0**.
  `Restart=on-failure` is by construction blind to a clean exit, so nothing was raised, and
  the stop flag the child had already set was still on the floor to kill anything raised by
  hand. The box stood without a daemon for about eleven and a half hours;
- **the unit** (`systemctl --user show`, 18.08.2026): `Type=simple`, `Restart=on-failure`,
  `KillMode=control-group`;
- **the reproduction** (18.08.2026, a stand of two units differing in that one key): a
  parent that spawns a `setsid` child and exits 0. Under `control-group` the child took
  SIGTERM within a second of the parent's exit — one loop iteration in; under `process` the
  same child ran every phase to the end. `detached: true` makes a new SESSION, not a new
  cgroup, so the child is killed by exactly the exit it is waiting for.

**The repair is to stop needing a survivor, not to weaken the unit.** `KillMode=process`
would let the child live, but the daemon it then raises would run inside the cgroup of a
unit systemd believes is dead: `systemctl status` inactive over a live circuit, `Restart=`
never applying to it, the next `systemctl restart` managing nothing. A supervised process
that wants a fresh copy of itself asks its supervisor, and the ask is an exit code.

So the form is chosen from the environment (`selfRestartForm`), and it is said out loud
before either form acts:

- **supervised** (`INVOCATION_ID` is set — systemd sets it for every service and nothing
  else does): the daemon runs the two steps `restart --pull` runs, IN ITS OWN PROCESS —
  `git pull --ff-only`, then `pnpm install` only when the pull moved `package.json`,
  `pnpm-lock.yaml` or `pnpm-workspace.yaml` — and then exits with **75**. Nothing is
  spawned, so nothing can be killed with the cgroup; no flag is set, so nothing is left on
  the floor to kill the successor. The supervisor raises a fresh `node` over the code that
  was just pulled;
- **detached** (no supervisor): the 055.2 form, unchanged;
- **and a failed repair cancels the exit.** A pull or install that fails leaves the daemon
  UP, behind, and loud — the attempt is already counted, so the ceiling closes it after two.
  Leaving there would hand the supervisor a process that comes straight back to the same
  drift, at restart speed, until systemd's start limit puts the unit in `failed`.

Two things follow for the operator, and both are said by the commands that touch them.
`Restart=on-failure` is now **load-bearing**: a unit edited to `Restart=no` turns the repair
into a box that stays down (`systemd install` prints this). And the exit code is deliberately
not 1 or 2 — those are this CLI's refusal and its argument door, and a journal in which the
repair is spelled like either of them is a journal that lies.

**Neither form is ever reached on a checkout whose own runtime is untracked.** The clean-tree
condition sits BEFORE the choice of form: `workingTreeState` reads `git status --porcelain`,
where untracked counts as dirt (a `pull --ff-only` refuses over an untracked file it would
overwrite, and a repair dying half-way through is worse than one that never began), and
`selfRestartVerdict` answers `stand`. The directories named by `orchestrator.state` and
`orchestrator.workdir.worktrees` are made by the circuit itself and are on every box that has
raised a role, so a served repository that does not ignore them meets EVERY merge into its ref
with a daemon that refuses to restart and calls its own workspaces dirt. Measured in this
repository on 18.08.2026 — a `.gitignore` inherited from the workspace skeleton knew three
lines and nothing about the runtime, and the live checkout stood at `?? .orchestrator/`,
`?? .worktrees/`. The rule for this repository is held by a test that reads the paths from
`agent-protocol.json` rather than keeping a second copy of the list
(`runtime-ignored.test.ts`). And the refusal itself tells the two dirty trees apart: an
untracked-only tree is no longer reported as "uncommitted work" (there is nothing there to
commit) but as untracked files, with the repair — an ignore rule in the served repository —
named in the line.

**And a refusal that nobody was reading is a silence with extra steps (thread 044).** Two
blind spots of the conjunction above were measured on 28–29.08 and neither is a bug in the
rule: (1) on an active circuit the zero-lease window may not be caught for hours — 27 windows
opened that day and the merge of `#101` (03:24:02Z) rode into none of them until a hand pulled
in the morning; (2) a role raised to ask "did the fix roll out?" holds a lease and BLOCKS the
very rollout it is measuring. What changed is what the box SAYS, and nothing about when it
pulls:

- **the refusal states its own size.** It used to name the condition only (`no self-restart
  while sessions are live (curator)`) while the distance lived one line up, in a sentence
  written by another function. Two lines are one line only while nothing separates them — and
  `grep`, a frame row and a digest all separate them. The line is now `the code is 3 commit(s)
  behind, drifting for 6h (since …) — no self-restart while …`;
- **the drift has an AGE, and it is not the process's uptime.** The clock starts at the OLDEST
  commit on the ref the loaded code lacks — the moment the box fell behind. Uptime was the
  wrong clock in the one direction that hides the fault: a daemon raised five minutes ago over
  six-hour-old code reads as young. Both numbers are now printed, side by side;
- **past two hours it becomes a DIGEST LINE** (`CODE_DRIFT_OVERDUE_MINUTES`, R4's ninth class).
  The daemon publishes the standoff it is standing on — the two SHAs, the distance, the stamp
  it began at and its own refusal verbatim — to `daemon-drift.json`, and removes that file on
  the tick that finds no drift; the courier reads it, applies the band and carries the sentence
  unchanged. It never re-derives the reason: that verdict needs leases, holds, flags, a tree and
  an attempt count that only the daemon holds;
- **and nothing was made to pull harder.** No live session is stopped, no window is forced: the
  statement of the thread reserves that for john, and the line reports rather than orders. Two
  of the named branches needed no code at all — an expired hold and a leftover stop flag were
  already answered (`up` clears the stop and force flags and says so), and the attempt ceiling
  keeps the reason it was given in thread 042.

**What is tested and what is not.** The rule, the form, the exit code and the install
question are units (`self-restart.test.ts`). The seam — went away, came back — is a process
test (`self-restart.process.test.ts`): a daemon behind its ref is raised with `INVOCATION_ID`
set, and what is asserted is that the tree ended up ON the target, that the exit was 75, that
no stop or force flag was left behind, and that the process raised afterwards (the supervisor
with the systemd taken out: see a non-zero code, raise it again) ticks with no drift left to
report. What a CI runner cannot reproduce is the other half — that THIS box's unit answers a
75 with a fresh process — because it has neither this systemd nor this unit; that half is a
live acceptance on the box and is named as one rather than assumed.
