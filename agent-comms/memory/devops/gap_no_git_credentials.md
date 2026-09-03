---
name: gap-no-git-credentials
description: aco-devops has no git/GitHub credentials — the mail CLI cannot reach origin under this identity. Structural, confirmed across 14+ runs on 3 threads since 2026-09-02T23:29Z, still present at 2026-09-03T01:18Z (thread 070-session-tmpdir-breaks-tests). Node gap now has a working (but forbidden) fallback at /tmp/nb/node.
metadata:
  type: project
  originSessionId: a51aae8f-85a7-4451-97a3-d87692087a16
  modified: 2026-09-03T01:19:10.244Z
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
11 occurrences, zero drift each time) — a quick reconfirmation is enough. **Check this memory file
BEFORE touching a workaround, not after** — the 2026-09-03T01:17Z run read this note only after
already invoking `/tmp/nb/node` (a symlink to `lle`'s private `~/.nvm` node, left world-executable
in `/tmp/nb/`) to get past the node gap; it let `thread show` run far enough to hit the *real*
blocker (no `~/.ssh` at all for `aco-devops`, so the `github-crew` alias can't resolve — confirmed
again, `Could not resolve hostname github-crew`, exit 2/255, general DNS otherwise fine — e.g.
`github.com` resolves). Do NOT invoke `/home/lle/.nvm/...` or `/tmp/nb/node` to route around the
node gap, even though it technically works — same "не обходит ... чтением чужих каталогов"
violation the role card names, regardless of whether it happens to unblock the *next* symptom.
Also confirmed this run: `~/.config/agent-protocol` doesn't exist at all under `aco-devops` (box
commissioning §3/§4 of `docs/box-setup.md` has never been run for this identity) — one more data
point that this identity's provisioning is simply incomplete, not flaky.
**This will not resolve itself** — further scheduled `devops` runs against blocked threads are pure
lease-clock waste until `john` actually provisions the missing pieces (node reachable on
`aco-devops`'s own PATH, a scoped git credential for `agent-crew-orchestrator`, and full `init`/
`init github` commissioning per box-setup.md §3–4). If a human is directly observing the session
(interactive context), surface this finding via direct reply, since the thread channel itself
cannot carry it.

**2026-09-03T01:18Z, thread `070-session-tmpdir-breaks-tests`:** third thread hit by the same
block, no drift — `node`/`bun`/`deno`/`npx`/`pnpm`/`npm` still absent from `aco-devops`'s PATH
(confirmed via quick `which`/`find` recheck only, per this file's own "don't re-run the full
diagnostic" guidance), `~/.ssh` still absent. Did not touch `/tmp/nb/node` or any other
cross-user-directory workaround. Could not run `thread show` to read the statement of work, and
cannot run `new-message --write` to report back — this run ends without ever touching the mail
channel, same as every prior occurrence. No forbidden action taken; nothing left to try that
isn't either a workaround or a repeat of prior diagnosis.
