---
name: gap-no-git-credentials
description: aco-devops has no git/GitHub credentials and no node anywhere reachable (not even system-wide) — the mail CLI cannot run at all under this identity. Structural, confirmed across 12+ runs on 2 threads since 2026-09-02T23:29Z, still present at 2026-09-03T01:12Z.
metadata:
  type: project
  originSessionId: a51aae8f-85a7-4451-97a3-d87692087a16
  modified: 2026-09-03T01:12:17.952Z
---

**Standing structural block, not a one-off.** Under `sudo -u aco-devops` (the role's own
`systemUser`, per [[role-devops-identity]] docs/roles/devops.md, box-setup.md §0.1/§0.1a), two
things are missing simultaneously, and both are required for R3 (the mail CLI, the role's *only*
interface to the thread channel):

1. **No `node`/`bun`/`deno`/`npx`/`pnpm`/`npm` anywhere on PATH.** `sudo -u aco-devops` resets PATH
   to sudo's bare `secure_path` (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`).
   No system-wide node package exists either (checked via `apt`, `/opt`, `/snap/bin`, `find /`).
   `aco-devops`'s own `$HOME` has no `.nvm`. The only node binaries reachable are inside `lle`'s
   private `~/.nvm` (absolute path or via a stray `/tmp/nb/node` symlink someone left pointing at
   it) — **deliberately never invoked**, since executing another user's private install directory
   is exactly the "не обходит ... чтением чужих каталогов" workaround the role card forbids, even
   though it would technically work.
2. **No git/GitHub credentials for `aco-devops`** — no `~/.ssh`, no `gh auth login`, no `~/.netrc`,
   no `~/.config/gh`, no ambient token in env. Both worktree remotes
   (`.worktrees/comms/agent-comms`, `.worktrees/devops`) point at `git@github-crew:...`, an SSH
   `Host` alias that only exists in `lle`'s own `~/.ssh/config` (correctly unreadable to
   `aco-devops` per box-setup.md §0.1's `chmod o-rwx`). Network egress itself is fine (confirmed via
   `ssh git@github.com` → clean "no identity" failure, not a DNS/network block) — this is purely a
   credential-provisioning gap.

**Consequence:** the role cannot run `thread show` (needs node) or `new-message --write` (needs
node + git push) at all. Every `047-devops-role` run since 2026-09-02T23:29Z has hit this on the
very first command, before any statement-of-work content is ever visible — silence from this role
on that thread means "channel was blocked," not "task unclear" or "nothing to do." `ListAgents` was
also tried repeatedly as a harness-level fallback channel — always "No reachable agents," so there
is no working channel of any kind for this identity right now.

**Why this matters / who fixes it:** the role card and `agent-protocol.json` both say `devops` is
`status: active` as of john's 2026-09-02 decision, but nobody has provisioned `aco-devops` with (a)
a node runtime reachable from its own PATH, and (b) a scoped git credential (deploy key or token,
`agent-crew-orchestrator` only). Per the role card, "порождение ключей" / credential provisioning is
explicitly a `john`-only matter — not something `devops` or `curator` can do unilaterally, and not
something to route around (root/sudo install is also out of scope for this role).

**How to apply:** if picking up a `devops` thread and the mail CLI fails with `node: command not
found` or an SSH/DNS error on `github-crew`, this is not a one-off fluke — check `id` / `PATH` /
`~/.ssh` first (30 seconds) to confirm the block is still present, then stop. Do NOT re-run the
full diagnostic every time (that was done exhaustively across 2026-09-02T23:29Z–2026-09-03T01:10Z,
11 occurrences, zero drift each time) — a quick reconfirmation is enough. Do NOT invoke
`/home/lle/.nvm/...` or `/tmp/nb/node` to route around it, even though they technically work.
**This will not resolve itself** — further scheduled `devops` runs against blocked threads are pure
lease-clock waste until `john` actually provisions the two missing pieces. If a human is directly
observing the session (interactive context), surface this finding via direct reply, since the
thread channel itself cannot carry it.
