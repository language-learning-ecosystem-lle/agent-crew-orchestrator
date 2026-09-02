---
name: gap-no-git-credentials
description: aco-devops has no git/GitHub credentials and no node in PATH — the mail CLI cannot run at all under this identity yet
metadata: 
  node_type: memory
  type: project
  originSessionId: a51aae8f-85a7-4451-97a3-d87692087a16
  modified: 2026-09-02T23:36:36.583Z
---

Run on thread `057-circuit-ping-flaps` (2026-09-02T23:29Z–23:49Z lease) could not read or send
ANY mail, and could not commit or push anything, because the `aco-devops` system user
(the role's own `systemUser`, per [[role-devops-identity]] docs/roles/devops.md, box-setup.md §0.1/§0.1a)
is missing two things simultaneously:

1. **No `node` on PATH.** `sudo -u aco-devops` resets PATH to sudo's `secure_path`
   (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`), which has no node.
   The `claude` binary itself doesn't care (native ELF), but the session's OWN Bash work
   (`node --import tsx packages/agent-protocol/src/cli.ts ...`) does — box-setup.md §0.1a already
   names this as an open acceptance line ("своя работа сессии от PATH зависит — это строка
   приёмки, а не следствие") but it was never actually closed.
   Worked around this turn by invoking `/home/lle/.nvm/versions/node/v24.18.0/bin/node` directly
   (world-executable by design, per the same §0.1a measurement) — this got past the node problem
   but is NOT an endorsed fix, just what let me get one command further before hitting blocker #2.
   Note `node_modules/` in the devops worktree IS already owned by `aco-devops:contour` (pnpm
   install succeeded once, at some point) — meaning aco-devops's own home does NOT have `~/.nvm`
   (confirmed absent), so whatever ran that install must have used this same lle-node-by-absolute-path
   trick, or nvm was installed and later lost. Root cause of #1 is not confirmed either way.

2. **No git credentials of any kind for aco-devops** — no `~/.ssh` directory at all, no
   `gh auth` login, no `~/.netrc`, no `~/.config/gh`. The mail checkout's remote is
   `git@github-crew:language-learning-ecosystem-lle/agent-crew-orchestrator.git` — `github-crew`
   is an SSH `Host` alias that only exists in `lle`'s own `~/.ssh/config` (correctly unreadable
   to aco-devops, since box-setup.md §0.1 deliberately did `chmod o-rwx /home/lle/.ssh`). Under
   aco-devops, `ssh` tries to resolve the literal hostname `github-crew` and fails DNS resolution.
   This means **the devops role cannot use its own mail CLI interface at all** (R3, its whole
   interface to the mail per docs/roles/devops.md) regardless of the node fix above — it can
   neither `thread show` (needs a fetch) nor `new-message --write` (needs push).

**Why this matters:** the role card (docs/roles/devops.md) and agent-protocol.json both say
`devops` is `status: active` as of john's 2026-09-02 decision ("исполнитель вызова существует,
переход в системного пользователя реализован"). But nobody appears to have provisioned aco-devops
with its own git identity (deploy key or token) the way box-setup.md §4 describes for the box as a
whole (that setup is scoped to whichever user runs it, historically `lle`). Every future `devops`
run will hit this exact same wall until either (a) aco-devops gets its own git credentials, or
(b) some other mechanism lets it reach the mail repo.

**How to apply:** if picking up a `devops` thread and the mail CLI fails with an SSH/DNS error on
`github-crew`, or `node: command not found`, this is not a one-off environment fluke — check
`id`/`ls -la ~/.ssh` first before spending the whole lease diagnosing from scratch. This needs
`john` (credential provisioning, cost/security judgment — matches the role card's explicit
"к john: расширение набора действий... любое действие, необратимое дешевле чем одним PR —
удаления, force, внешние аккаунты, порождение ключей") to resolve, since it means minting a new
deploy key or token for a new identity — not something devops or curator can do unilaterally.
I could not even relay this to `curator` via the thread because the mail channel itself was the
thing blocked — this note is the only record of the 2026-09-02 run.

Nothing was committed or pushed this run (impossible — no credentials); no working-tree changes
were made outside this memory file.

**Update 2026-09-02T23:36Z, second run on the same thread `057-circuit-ping-flaps`:** identical
wall, confirmed not a one-off. `id` still shows no extra groups beyond `aco-devops`/`contour`;
`~/.ssh`, `~/.netrc`, `~/.config/gh` all still absent; `node` still absent from PATH under
`sudo -u aco-devops` (only reachable via `/home/lle/.nvm/...`, which this run deliberately did
NOT invoke — that's a boundary violation per the role card's "не обходит ... чтением чужих
каталогов", not an endorsed path even though it technically executes). Direct `ssh git@github.com`
confirms network egress works fine (`Host key verification failed` — no identity, not a network
block) — so this is purely a credential-provisioning gap, not a connectivity one. The code repo's
own working tree (`.worktrees/devops`) has the exact same broken `git@github-crew:...` remote, so
even docs-zone work (`docs/box-setup.md`, `docs/install-notes.md`) is unreachable too: branch →
push → PR is impossible under this identity. This run could not send a single message to the
thread — the mail channel itself is the thing blocked, same as last time. **Anyone reading this
thread from another identity (curator, john, or a future devops run with credentials restored)
should treat `057-circuit-ping-flaps` as having received zero devops output across at least two
separate lease windows for this reason alone**, not because the statement of work was unclear.
