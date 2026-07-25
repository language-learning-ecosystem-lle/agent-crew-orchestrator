/**
 * The workspace decision (R17). The one branch here that can destroy work is
 * `rebase` — it moves somebody's tree — so the tests are mostly about the states in
 * which it must NOT be reached.
 */
import { describe, expect, it } from "vitest";

import {
  describeWorkspacePlan,
  lockHolderPid,
  lockReason,
  mainCheckoutVerdict,
  planWorkspace,
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

  it("DIRTY → a refusal, never a move: those are the leftovers of a broken session", () => {
    const plan = planWorkspace({
      facts: { exists: true, branch: "HEAD", head: BASE, dirty: true },
      base: BASE,
      resuming: false,
    });

    expect(plan.action).toBe("refuse");
    // The repair is a judgement call (commit, stash, or read and discard) and the
    // package does not make it for the human.
    expect(plan.action === "refuse" && plan.reason).toContain("by hand");
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
