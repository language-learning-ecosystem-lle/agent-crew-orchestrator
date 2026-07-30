/**
 * The workspace decision (R17). Two branches here touch work nobody committed —
 * `rebase` moves somebody's tree, `stash` parks what is standing in it — so the tests
 * are mostly about the states in which each of them must NOT be reached.
 */
import { describe, expect, it } from "vitest";

import {
  createWorkspaceLocks,
  describeWorkspaceIdentity,
  describeWorkspacePlan,
  lockHolderPid,
  lockReason,
  mainCheckoutVerdict,
  planWorkspace,
  planWorkspaceIdentity,
  workspacePath,
  workspaceVerdict,
} from "./workspace.js";

const BASE = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";

describe("where a role works", () => {
  it("one role — one directory named after it", () => {
    expect(workspacePath({ repo: "/repo", worktrees: ".worktrees", role: "dev-core" })).toBe(
      "/repo/.worktrees/dev-core",
    );
  });

  it("a trailing slash in the declared directory does not produce a doubled path", () => {
    expect(workspacePath({ repo: "/repo/", worktrees: ".worktrees/", role: "dev-core" })).toBe(
      "/repo/.worktrees/dev-core",
    );
  });
});

describe("the plan for a fresh package", () => {
  it("no worktree yet → create it", () => {
    expect(planWorkspace({ facts: { exists: false }, base: BASE, resuming: false })).toEqual({
      action: "create",
    });
  });

  it("already detached at the base → nothing to do", () => {
    expect(
      planWorkspace({
        facts: { exists: true, branch: "HEAD", head: BASE, dirty: false },
        base: BASE,
        resuming: false,
      }),
    ).toEqual({ action: "ready" });
  });

  it("clean and left on the previous package's branch → move it to the base", () => {
    // Nothing is lost: the branch it leaves still exists and still points where it
    // did. This is the state john met after every package of the first wave.
    expect(
      planWorkspace({
        facts: { exists: true, branch: "agent-protocol/english", head: OTHER, dirty: false },
        base: BASE,
        resuming: false,
      }),
    ).toEqual({ action: "rebase" });
  });

  it("DIRTY with nobody to attribute it to → a refusal, never a move", () => {
    const plan = planWorkspace({
      facts: { exists: true, branch: "HEAD", head: BASE, dirty: true },
      base: BASE,
      resuming: false,
    });

    expect(plan.action).toBe("refuse");
    // The repair is a judgement call (commit, stash, or read and discard) and the
    // package does not make it for the human — there is no run to blame the dirt on,
    // so it may be the human's own.
    expect(plan.action === "refuse" && plan.reason).toContain("by hand");
    expect(plan.action === "refuse" && plan.reason).toContain("no finished run");
  });
});

/**
 * THE FORK THAT DESTROYS WORK IF IT IS WRONG (thread 023, requirement 5) — dirt after a
 * break is PARKED, dirt after a finished turn is REFUSED. Every case is here rather
 * than a representative one: the cost of the wrong branch is somebody's uncommitted
 * afternoon, and the CLI is only allowed to run `git stash push -u` because this
 * function decided it.
 */
describe("dirt in the workspace, by whose it is", () => {
  const dirtyAfter = (previousReason: string) =>
    planWorkspace({
      facts: { exists: true, branch: "HEAD", head: OTHER, dirty: true },
      base: BASE,
      resuming: false,
      thread: "023-daemon-parallelism",
      previousReason,
      previousSession: "8f3a2b1c-0d4e",
    });

  it.each(["quota-exhausted", "timeout", "supervisor-gone", "stalled"])(
    "the circuit cut the previous run off ('%s') → the leftovers are stashed, not refused",
    (reason) => {
      const plan = dirtyAfter(reason);

      expect(plan.action).toBe("stash");
      // The label is the address the work is found by: thread, session, cause.
      expect(plan).toEqual({
        action: "stash",
        from: reason,
        label: `wip 023-daemon-parallelism 8f3a2b1c-0d4e ${reason}`,
      });
    },
  );

  it.each([
    "completed",
    "exited-without-handoff",
    "input-timeout",
    "exited-while-waiting",
    "forced",
  ])(
    "the previous run ENDED ITS OWN TURN ('%s') → a refusal that calls the dirt a failure to finish",
    (reason) => {
      const plan = dirtyAfter(reason);

      expect(plan.action).toBe("refuse");
      // The wording is half the requirement: a silent skip of the next launch is what
      // cost four hand-made stashes in one morning, and "leftovers of a broken session"
      // was the wrong name for a tree a session walked away from.
      expect(plan.action === "refuse" && plan.reason).toContain("ENDED ITS OWN TURN");
      expect(plan.action === "refuse" && plan.reason).toContain(reason);
    },
  );

  it("a release reason this version does not know is NOT a break — it is refused", () => {
    // The set is a whitelist on purpose: a journal line from a future version must not
    // be able to talk this branch into stashing somebody's tree.
    expect(dirtyAfter("something-invented-later").action).toBe("refuse");
  });

  it("a broken run that never announced a session still gets a labelled stash", () => {
    const plan = planWorkspace({
      facts: { exists: true, branch: "HEAD", head: OTHER, dirty: true },
      base: BASE,
      resuming: false,
      thread: "023-daemon-parallelism",
      previousReason: "supervisor-gone",
    });

    expect(plan.action === "stash" && plan.label).toBe(
      "wip 023-daemon-parallelism no-session supervisor-gone",
    );
  });

  it("a RESUME still keeps the tree — the stash rule never reaches a continued session", () => {
    // The state a resume continues from IS the dirt; parking it would be the same
    // damage as moving it, arriving through a new door.
    expect(
      planWorkspace({
        facts: { exists: true, branch: "HEAD", head: OTHER, dirty: true },
        base: BASE,
        resuming: true,
        thread: "023-daemon-parallelism",
        previousReason: "supervisor-gone",
        previousSession: "8f3a2b1c-0d4e",
      }),
    ).toEqual({ action: "keep" });
  });

  it("a LOCKED tree is refused before the dirt is even considered", () => {
    // The lock says the tree is somebody's right now; a stash there would be taken out
    // from under a live session.
    const plan = planWorkspace({
      facts: { exists: true, branch: "HEAD", head: OTHER, dirty: true, locked: "dev-core pid 4" },
      base: BASE,
      resuming: false,
      thread: "023-daemon-parallelism",
      previousReason: "supervisor-gone",
    });

    expect(plan.action).toBe("refuse");
    expect(plan.action === "refuse" && plan.reason).toContain("locked");
  });

  it("a CLEAN tree after a break is moved, not stashed — there is nothing to park", () => {
    expect(
      planWorkspace({
        facts: { exists: true, branch: "HEAD", head: OTHER, dirty: false },
        base: BASE,
        resuming: false,
        thread: "023-daemon-parallelism",
        previousReason: "timeout",
      }),
    ).toEqual({ action: "rebase" });
  });

  it("the operator is told what is being parked BEFORE it happens, with the label", () => {
    const line = describeWorkspacePlan({
      role: "dev-core",
      path: "/repo/.worktrees/dev-core",
      plan: { action: "stash", from: "timeout", label: "wip 023-x s1 timeout" },
      base: BASE,
      baseRef: "origin/main",
    });

    expect(line).toContain("wip 023-x s1 timeout");
    expect(line).toContain("timeout");
    expect(line).toContain("origin/main 11111111");
  });
});

describe("the plan for a resumed run", () => {
  it("the tree is kept EXACTLY as it was — including a dirty one", () => {
    // The half-finished edits are the state being continued; moving the tree is the
    // one thing a resume must never do.
    expect(
      planWorkspace({
        facts: { exists: true, branch: "pkg/x", head: OTHER, dirty: true },
        base: BASE,
        resuming: true,
      }),
    ).toEqual({ action: "keep" });
  });

  it("a resume into a workspace that no longer exists is a loud refusal", () => {
    const plan = planWorkspace({ facts: { exists: false }, base: BASE, resuming: true });

    expect(plan.action).toBe("refuse");
    expect(plan.action === "refuse" && plan.reason).toContain("resume");
  });
});

describe("what the operator is shown", () => {
  it("the plan names the base ref and the short commit — every time, before it happens", () => {
    const line = describeWorkspacePlan({
      role: "dev-core",
      path: "/repo/.worktrees/dev-core",
      plan: { action: "rebase" },
      base: BASE,
      baseRef: "origin/main",
    });

    expect(line).toContain("/repo/.worktrees/dev-core");
    expect(line).toContain("origin/main 11111111");
  });

  it("a workspace at the base and clean is the ONE case that earns a tick", () => {
    expect(
      workspaceVerdict({
        role: "dev-core",
        path: "/repo/.worktrees/dev-core",
        facts: { exists: true, branch: "HEAD", head: BASE, dirty: false },
        base: BASE,
        baseRef: "origin/main",
      }).status,
    ).toBe("ok");
  });

  it("everything else is a FACT and never a failure: it belongs to one role, not to the circuit", () => {
    const cases = [
      { exists: false },
      { exists: true, branch: "pkg/x", head: OTHER, dirty: false },
      { exists: true, branch: "HEAD", head: BASE, dirty: true },
    ] as const;

    for (const facts of cases) {
      expect(
        workspaceVerdict({
          role: "dev-core",
          path: "/repo/.worktrees/dev-core",
          facts,
          base: BASE,
          baseRef: "origin/main",
        }).status,
      ).toBe("info");
    }
  });

  it("the operator's own checkout is reported as nobody's workplace, and compared with nothing", () => {
    const check = mainCheckoutVerdict({ repo: "/repo", branch: "some-branch", dirty: true });

    expect(check.status).toBe("info");
    expect(check.detail).toContain("not a workplace of any role");
  });
});

describe("a workspace somebody else has locked", () => {
  const LIVE =
    "agent-protocol: dev-core is running on 012-x (supervisor pid 4242, since 2026-07-25T21:00:00Z)";

  it("a MUTATING plan under a foreign lock is refused, exactly like a dirty tree", () => {
    // john, 2026-07-25 22:20: the lock guards the tree from a second mutator — a
    // manual run racing the daemon, or a human moving the worktree under a session.
    const plan = planWorkspace({
      facts: { exists: true, branch: "pkg/x", head: OTHER, dirty: false, locked: LIVE },
      base: BASE,
      resuming: false,
    });

    expect(plan.action).toBe("refuse");
    expect(plan.action === "refuse" && plan.reason).toContain("locked by another run");
    // The refusal quotes the lock: WHOSE run it is, is the first thing a human needs.
    expect(plan.action === "refuse" && plan.reason).toContain("supervisor pid 4242");
  });

  it("a RESUME under a foreign lock is refused too — the lock is taken before the spawn", () => {
    // The lock is held from before the mutation until the lease is released, so a run
    // that would touch nothing on disk still cannot put a second session into the tree.
    const plan = planWorkspace({
      facts: { exists: true, branch: "pkg/x", head: OTHER, dirty: true, locked: LIVE },
      base: BASE,
      resuming: true,
    });

    expect(plan.action).toBe("refuse");
  });

  it("a lock whose process is gone reads as LEFT BEHIND and asks for a hand, not for a wait", () => {
    const plan = planWorkspace({
      facts: {
        exists: true,
        branch: "HEAD",
        head: BASE,
        dirty: false,
        locked: LIVE,
        lockHolderAlive: false,
      },
      base: BASE,
      resuming: false,
    });

    expect(plan.action).toBe("refuse");
    expect(plan.action === "refuse" && plan.reason).toContain("git worktree unlock");
  });

  it("status shows the lock and never clears it — a stale one is named as stale", () => {
    const live = workspaceVerdict({
      role: "dev-core",
      path: "/repo/.worktrees/dev-core",
      facts: { exists: true, branch: "HEAD", head: BASE, dirty: false, locked: LIVE },
      base: BASE,
      baseRef: "origin/main",
    });
    const stale = workspaceVerdict({
      role: "dev-core",
      path: "/repo/.worktrees/dev-core",
      facts: {
        exists: true,
        branch: "HEAD",
        head: BASE,
        dirty: false,
        locked: LIVE,
        lockHolderAlive: false,
      },
      base: BASE,
      baseRef: "origin/main",
    });

    // A locked workspace at the base is NOT a tick: "clean and ready" would be a lie
    // about a tree somebody is living in.
    expect(live.status).toBe("info");
    expect(live.detail).toContain("locked by a live run");
    expect(stale.detail).toContain("the process that locked it is gone");
    expect(stale.detail).toContain("git worktree unlock /repo/.worktrees/dev-core");
  });
});

describe("the run lock", () => {
  it("names the pair, the pid and the moment — a lock left by a dead machine is identifiable", () => {
    expect(
      lockReason({
        role: "dev-core",
        thread: "016-protocol-roadmap",
        pid: 4242,
        at: "2026-07-25T21:00:00Z",
      }),
    ).toBe(
      "agent-protocol: dev-core is running on 016-protocol-roadmap (supervisor pid 4242, since 2026-07-25T21:00:00Z)",
    );
  });

  it("the pid is readable back out of the text — that is what makes a stale lock nameable", () => {
    expect(
      lockHolderPid(
        lockReason({ role: "dev-core", thread: "012-x", pid: 4242, at: "2026-07-25T21:00:00Z" }),
      ),
    ).toBe(4242);
  });

  it("a lock a human set by hand names no pid, and that is NOT evidence of staleness", () => {
    expect(lockHolderPid("john is bisecting in here, hands off")).toBeUndefined();
  });
});

describe("the registry of held locks", () => {
  const spyGit = (options?: { readonly refuse?: readonly string[] }) => {
    const unlocked: string[] = [];
    const locked: string[] = [];
    return {
      unlocked,
      locked,
      git: {
        lock: (input: { repo: string; path: string; reason: string }) => {
          if (options?.refuse?.includes(input.path)) return false;
          locked.push(`${input.repo}:${input.path}:${input.reason}`);
          return true;
        },
        unlock: (input: { repo: string; path: string }) => {
          unlocked.push(`${input.repo}:${input.path}`);
        },
      },
    };
  };

  it("holds several trees at once — the shape a daemon with N supervisors has", () => {
    const { git } = spyGit();
    const locks = createWorkspaceLocks(git);
    expect(locks.take({ repo: "/repo", path: "/repo/.worktrees/dev-core", reason: "a" })).toBe(
      true,
    );
    expect(locks.take({ repo: "/repo", path: "/repo/.worktrees/curator", reason: "b" })).toBe(true);
    expect(locks.held()).toEqual(["/repo/.worktrees/dev-core", "/repo/.worktrees/curator"]);
  });

  // FINDING B of thread 023, in one assertion: with a single slot the second `take`
  // overwrote the first, and dev-core's tree stayed locked after its supervisor
  // released — R17 then refuses to start there, silently, forever.
  it("each holder releases ITS OWN tree and nobody else's", () => {
    const { git, unlocked } = spyGit();
    const locks = createWorkspaceLocks(git);
    locks.take({ repo: "/repo", path: "/repo/.worktrees/dev-core", reason: "a" });
    locks.take({ repo: "/repo", path: "/repo/.worktrees/curator", reason: "b" });
    locks.release("/repo/.worktrees/dev-core");
    expect(unlocked).toEqual(["/repo:/repo/.worktrees/dev-core"]);
    expect(locks.held()).toEqual(["/repo/.worktrees/curator"]);
  });

  it("releasing a path this process never took does nothing — a foreign tree is not ours to unlock", () => {
    const { git, unlocked } = spyGit();
    const locks = createWorkspaceLocks(git);
    locks.release("/repo/.worktrees/dev-speech");
    expect(unlocked).toEqual([]);
  });

  it("releasing twice unlocks once — the call sites are on several exit paths of one run", () => {
    const { git, unlocked } = spyGit();
    const locks = createWorkspaceLocks(git);
    locks.take({ repo: "/repo", path: "/repo/.worktrees/dev-core", reason: "a" });
    locks.release("/repo/.worktrees/dev-core");
    locks.release("/repo/.worktrees/dev-core");
    expect(unlocked).toEqual(["/repo:/repo/.worktrees/dev-core"]);
  });

  it("a refused lock records nothing — the caller refuses, and the tree stays its holder's", () => {
    const { git, unlocked } = spyGit({ refuse: ["/repo/.worktrees/curator"] });
    const locks = createWorkspaceLocks(git);
    expect(locks.take({ repo: "/repo", path: "/repo/.worktrees/curator", reason: "b" })).toBe(
      false,
    );
    expect(locks.held()).toEqual([]);
    locks.release("/repo/.worktrees/curator");
    expect(unlocked).toEqual([]);
  });

  it("the exit backstop releases EVERY tree still held, not the last one", () => {
    const { git, unlocked } = spyGit();
    const locks = createWorkspaceLocks(git);
    locks.take({ repo: "/repo", path: "/repo/.worktrees/dev-core", reason: "a" });
    locks.take({ repo: "/repo", path: "/repo/.worktrees/curator", reason: "b" });
    locks.releaseAll();
    expect(unlocked).toEqual(["/repo:/repo/.worktrees/dev-core", "/repo:/repo/.worktrees/curator"]);
    expect(locks.held()).toEqual([]);
  });
});

/**
 * 027: the identity of a role's workspace. The load-bearing branch is the SKIP — it is
 * the one that would otherwise have the package enable a git extension on a repository
 * whose layout depends on the settings that extension moves.
 */
describe("planWorkspaceIdentity", () => {
  it("signs the tree with the role — the id as the name, the protocol's domain as the address", () => {
    expect(planWorkspaceIdentity({ role: "dev-core" })).toEqual({
      action: "set",
      identity: { name: "dev-core", email: "dev-core@agents.invalid" },
    });
  });

  it("core.bare=false is not in the way — it is what every ordinary clone has", () => {
    expect(planWorkspaceIdentity({ role: "dev-core", bare: "false" }).action).toBe("set");
  });

  it("a bare repository is left alone, with the manual repair named", () => {
    const plan = planWorkspaceIdentity({ role: "dev-core", bare: "true" });
    expect(plan.action).toBe("skip");
    expect(plan.action === "skip" && plan.reason).toContain("core.bare");
    expect(plan.action === "skip" && plan.reason).toContain("config.worktree");
  });

  it("core.worktree in the shared config stops it too, and both are named at once", () => {
    const plan = planWorkspaceIdentity({
      role: "dev-core",
      bare: "true",
      coreWorktree: "/elsewhere",
    });
    expect(plan.action === "skip" && plan.reason).toContain("core.bare and core.worktree");
  });

  it("the skipped line says the commits keep the machine owner — never a silent pass", () => {
    expect(
      describeWorkspaceIdentity({
        path: "/repo/.worktrees/dev-core",
        plan: planWorkspaceIdentity({ role: "dev-core", bare: "true" }),
      }),
    ).toContain("stay with the owner of the machine");
  });

  it("the set line names who the tree commits as", () => {
    expect(
      describeWorkspaceIdentity({
        path: "/repo/.worktrees/dev-core",
        plan: planWorkspaceIdentity({ role: "dev-core" }),
      }),
    ).toBe("/repo/.worktrees/dev-core — commits as dev-core <dev-core@agents.invalid>");
  });
});
