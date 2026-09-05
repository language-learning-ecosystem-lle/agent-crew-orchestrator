/**
 * The workspace decision (R17). Two branches here touch work nobody committed —
 * `rebase` moves somebody's tree, `stash` parks what is standing in it — so the tests
 * are mostly about the states in which each of them must NOT be reached.
 */
import { describe, expect, it } from "vitest";

import {
  checkWorkspaceSignature,
  classifyWorkspaceHead,
  createWorkspaceLocks,
  describeDirtyWorkspaceRepair,
  describeFailedTidyUp,
  describeFailedTidyUpOnItsBranch,
  describeFinishDirt,
  describeStrandedWorkspace,
  describeWorkspaceDirt,
  describeWorkspaceIdentity,
  describeWorkspacePlan,
  dirtLeftByFinish,
  lockHolderPid,
  lockReason,
  mainCheckoutVerdict,
  planWorkspace,
  planWorkspaceIdentity,
  serviceBranchName,
  workspacePath,
  workspaceRoleOf,
  workspaceVerdict,
} from "./workspace.js";

const BASE = "1111111111111111111111111111111111111111";
const ROLE = "dev-core";
/** The contour's role ids, as the daemon hands them in (`settleRun`'s `ids`). */
const ROLES = ["dev-core", "curator", "reviewer-pr"];
const WORKSPACE = "/repo/.worktrees/dev-core";
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

describe("whose workspace a checkout is", () => {
  const ROLES = ["dev-core", "curator"];
  const ask = (checkout: string, worktrees: string | undefined = ".worktrees") =>
    workspaceRoleOf({
      checkout,
      repo: "/repo",
      ...(worktrees === undefined ? {} : { worktrees }),
      roles: ROLES,
    });

  it("the inverse of workspacePath — the last segment names the role", () => {
    expect(ask("/repo/.worktrees/dev-core")).toBe("dev-core");
    expect(ask("/repo/.worktrees/dev-core/")).toBe("dev-core");
  });

  it("a directory named after a NON-role is nobody's workspace", () => {
    // The mail checkout lives beside the workspaces and is not one: the circuit does not
    // reset, lock or remove it, and a guard that treats it as a role's tree lies.
    expect(ask("/repo/.worktrees/comms")).toBeUndefined();
  });

  it("the same role name somewhere else is not the workspace either", () => {
    expect(ask("/tmp/dev-core")).toBeUndefined();
    expect(ask("/repo/apps/dev-core")).toBeUndefined();
  });

  it("the home checkout is nobody's workspace", () => {
    expect(ask("/repo")).toBeUndefined();
  });

  it("no declared workspaces — no role can be inferred from any path", () => {
    expect(
      workspaceRoleOf({ checkout: "/repo/.worktrees/dev-core", repo: "/repo", roles: ROLES }),
    ).toBeUndefined();
  });
});

describe("the plan for a fresh package", () => {
  it("no worktree yet → create it", () => {
    expect(
      planWorkspace({
        role: ROLE,
        path: WORKSPACE,
        facts: { exists: false },
        base: BASE,
        resuming: false,
      }),
    ).toEqual({
      action: "create",
    });
  });

  it("already detached at the base → nothing to do", () => {
    expect(
      planWorkspace({
        role: ROLE,
        path: WORKSPACE,
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
        role: ROLE,
        path: WORKSPACE,
        facts: { exists: true, branch: "agent-protocol/english", head: OTHER, dirty: false },
        base: BASE,
        resuming: false,
      }),
    ).toEqual({ action: "rebase" });
  });

  it("DIRTY with nobody to attribute it to → a refusal, never a move", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: { exists: true, branch: "HEAD", head: BASE, dirty: true },
      base: BASE,
      resuming: false,
    });

    expect(plan.action).toBe("refuse");
    // The repair is a judgement call (commit, stash, or read and discard) and the
    // package does not make it for the human — there is no run to blame the dirt on,
    // so it may be the human's own. Which is why both gestures are OFFERED and neither
    // is taken (thread 099).
    expect(plan.action === "refuse" && plan.reason).toContain("no finished run");
    expect(plan.action === "refuse" && plan.reason).toContain(`git -C ${WORKSPACE} stash push -u`);
  });
});

/**
 * A REFUSAL THAT CAN BE ACTED ON FROM WHERE IT IS READ (thread 099). The door was right
 * and useless in the same breath: sixteen minutes of a stopped contour on 2026-09-03
 * went on finding out what was in the tree and inventing the commands that clear it,
 * both of which the refusal already had the facts for.
 */
describe("what the dirty-tree refusal has to say", () => {
  const DIRT = {
    files: [
      {
        path: ".github/workflows/claude-review.yml",
        what: "modified",
        added: 12,
        removed: 3,
      },
      { path: "notes.md", what: "untracked" },
    ],
  };

  it("names the paths, the change in each, and counts the ones it does not list", () => {
    expect(describeWorkspaceDirt(DIRT)).toBe(
      "2 path(s) — .github/workflows/claude-review.yml (modified, +12/-3), notes.md (untracked, not counted)",
    );
    // AN UNCOUNTED FILE SAYS SO rather than reading as an empty change: git has never
    // seen it, and a zero there would be a number nobody measured.
    expect(describeWorkspaceDirt(DIRT)).toContain("not counted");
  });

  it("a long list is cut, and the cut is announced with its own number", () => {
    const many = {
      files: Array.from({ length: 9 }, (_, index) => ({
        path: `file-${index}.ts`,
        what: "untracked",
      })),
    };
    const text = describeWorkspaceDirt(many);

    expect(text).toContain("9 path(s)");
    expect(text).toContain("file-4.ts");
    expect(text).not.toContain("file-5.ts");
    // The silent cap is the defect this avoids: five listed paths and no remainder read
    // as "five paths changed".
    expect(text).toContain("and 4 more not listed here");
  });

  it("the refusal carries the composition, both repairs, and the reach of the lock", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: { exists: true, branch: "HEAD", head: OTHER, dirty: true, dirt: DIRT },
      base: BASE,
      resuming: false,
      thread: "099-dirty-tree-locks-the-role",
      previousReason: "exited-without-handoff",
    });
    const reason = plan.action === "refuse" ? plan.reason : "";

    expect(plan.action).toBe("refuse");
    // (1) WHAT lies there — decidable without going to the box.
    expect(reason).toContain(".github/workflows/claude-review.yml");
    expect(reason).toContain("+12/-3");
    // (2) THE REACH — the field case's real surprise: three pairs of one role skipped in
    // one tick, and only the daemon's journal said why.
    expect(reason).toContain("EVERY thread it holds a turn on");
    // (3) TWO REPAIRS, as commands, in THIS tree, on a branch named after THIS thread.
    expect(reason).toContain(
      `git -C ${WORKSPACE} checkout -b dev-core/099-dirty-tree-locks-the-role`,
    );
    expect(reason).toContain(
      `git -C ${WORKSPACE} push -u origin dev-core/099-dirty-tree-locks-the-role`,
    );
    expect(reason).toContain(`git -C ${WORKSPACE} stash push -u -m`);
    // And the diagnosis it already had is not traded away for the repair.
    expect(reason).toContain("ENDED ITS OWN TURN ('exited-without-handoff')");
  });

  it("dirt that did not read degrades to the command that reads it, never to silence", () => {
    const text = describeDirtyWorkspaceRepair({ role: ROLE, path: WORKSPACE, thread: "099-x" });

    expect(text).toContain(`git -C ${WORKSPACE} status --porcelain`);
    expect(text).toContain(`git -C ${WORKSPACE} stash push -u`);
  });

  it("preflight names the composition on the line a human reads before the tick", () => {
    const check = workspaceVerdict({
      role: ROLE,
      path: WORKSPACE,
      facts: { exists: true, branch: "HEAD", head: BASE, dirty: true, dirt: DIRT },
      base: BASE,
      baseRef: "origin/main",
    });

    expect(check.status).toBe("info");
    expect(check.detail).toContain("has unsaved changes: 2 path(s)");
    expect(check.detail).toContain("notes.md");
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
      role: ROLE,
      path: WORKSPACE,
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
      role: ROLE,
      path: WORKSPACE,
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
        role: ROLE,
        path: WORKSPACE,
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
      role: ROLE,
      path: WORKSPACE,
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
        role: ROLE,
        path: WORKSPACE,
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
        role: ROLE,
        path: WORKSPACE,
        facts: { exists: true, branch: "pkg/x", head: OTHER, dirty: true },
        base: BASE,
        resuming: true,
      }),
    ).toEqual({ action: "keep" });
  });

  it("a resume into a workspace that no longer exists is a loud refusal", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: { exists: false },
      base: BASE,
      resuming: true,
    });

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

  it("says who the tree signs as when the signature was measured", () => {
    const check = workspaceVerdict({
      role: "dev-core",
      path: "/repo/.worktrees/dev-core",
      facts: {
        exists: true,
        branch: "HEAD",
        head: BASE,
        dirty: false,
        signature: { name: "dev-core", email: "dev-core@agents.invalid" },
      },
      base: BASE,
      baseRef: "origin/main",
    });

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("signed by dev-core");
  });

  it("demotes the tick when the tree signs as somebody else — the launch refuses there", () => {
    const check = workspaceVerdict({
      role: "dev-core",
      path: "/repo/.worktrees/dev-core",
      facts: {
        exists: true,
        branch: "HEAD",
        head: BASE,
        dirty: false,
        signature: { name: "John", email: "john@example.com" },
      },
      base: BASE,
      baseRef: "origin/main",
    });

    expect(check.status).toBe("info");
    expect(check.detail).toContain("John <john@example.com>");
    expect(check.detail).toContain("'dev-core'");
    expect(check.detail).toContain("a run refuses here");
  });

  it("the operator's own checkout on the project's branch is a PASSED comparison, and still nobody's workplace", () => {
    const check = mainCheckoutVerdict({
      repo: "/repo",
      branch: "main",
      dirty: true,
      expectedBranch: "main",
      behind: 0,
    });

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("not a workplace of any role");
    expect(check.detail).toContain("has unsaved changes");
  });

  it("a foreign branch under the daemon is a REFUSAL that names the branch, the distance and the cure (078)", () => {
    // The field case: five hours and fifty-four minutes of a contour executing a commit
    // that was never merged, under a line of even inventory tone.
    const check = mainCheckoutVerdict({
      repo: "/repo",
      branch: "core/gate-checks-from-actions",
      dirty: false,
      expectedBranch: "main",
      behind: 11,
    });

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("'core/gate-checks-from-actions'");
    expect(check.detail).toContain("11 commit(s) of 'origin/main' are missing");
    expect(check.detail).toContain("git -C /repo checkout main");
  });

  it("the distance is to the PROJECT'S branch on every branch — a match still names the number", () => {
    // "I match my own origin" was the sentence that let the field case through. The one
    // printed here is true whichever branch the tree is on.
    const behind = (branch: string): string =>
      mainCheckoutVerdict({
        repo: "/repo",
        branch,
        dirty: false,
        expectedBranch: "main",
        behind: 4,
      }).detail;

    expect(behind("main")).toContain("4 commit(s) of 'origin/main' are missing");
    expect(behind("some-branch")).toContain("4 commit(s) of 'origin/main' are missing");
  });

  it("an uncountable distance costs the number and never the verdict", () => {
    const check = mainCheckoutVerdict({
      repo: "/repo",
      branch: "some-branch",
      dirty: false,
      expectedBranch: "main",
    });

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("the distance to 'origin/main' did not read");
  });

  it("a detached main checkout is named as detached, not as a branch called HEAD", () => {
    const check = mainCheckoutVerdict({
      repo: "/repo",
      branch: "HEAD",
      dirty: false,
      expectedBranch: "main",
      behind: 2,
    });

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("is DETACHED (on no branch)");
    expect(check.detail).not.toContain("is on 'HEAD'");
  });
});

describe("a workspace somebody else has locked", () => {
  const LIVE =
    "agent-protocol: dev-core is running on 012-x (supervisor pid 4242, since 2026-07-25T21:00:00Z)";

  it("a MUTATING plan under a foreign lock is refused, exactly like a dirty tree", () => {
    // john, 2026-07-25 22:20: the lock guards the tree from a second mutator — a
    // manual run racing the daemon, or a human moving the worktree under a session.
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
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
      role: ROLE,
      path: WORKSPACE,
      facts: { exists: true, branch: "pkg/x", head: OTHER, dirty: true, locked: LIVE },
      base: BASE,
      resuming: true,
    });

    expect(plan.action).toBe("refuse");
  });

  it("a lock whose process is gone reads as LEFT BEHIND and asks for a hand, not for a wait", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
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
    locks.release("/repo/.worktrees/dev-acme");
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

/**
 * REQUIREMENT 5, SECOND HALF (thread 023): the run's OWN ending is judged, not the next
 * launch's inheritance. The fork is held here on the whole release vocabulary rather
 * than on a representative of each side, because the two sides mean opposite things and
 * the list they are cut by lives in the module under test.
 */
describe("the dirt a run leaves at its own ending", () => {
  it("a turn that ENDED and left uncommitted changes is a failure to finish", () => {
    for (const reason of [
      "completed",
      "exited-without-handoff",
      "input-timeout",
      "exited-while-waiting",
      "forced",
    ]) {
      expect(dirtLeftByFinish({ reason, dirty: true })).toBe(true);
    }
  });

  it("dirt after a break the CIRCUIT made is not this failure — it is the stash of the first half", () => {
    for (const reason of ["quota-exhausted", "timeout", "supervisor-gone", "stalled"]) {
      expect(dirtLeftByFinish({ reason, dirty: true })).toBe(false);
    }
  });

  it("a clean tree says nothing, whatever the run was released as", () => {
    for (const reason of ["completed", "timeout", "exited-without-handoff"]) {
      expect(dirtLeftByFinish({ reason, dirty: false })).toBe(false);
    }
  });

  it("an unknown reason from a future version falls on the LOUD side, never on the disk side", () => {
    expect(dirtLeftByFinish({ reason: "something-new", dirty: true })).toBe(true);
  });

  it("the sentence names the run, the tree and what it costs the NEXT package", () => {
    const line = describeFinishDirt({ reason: "completed", path: "/repo/.worktrees/dev-core" });
    expect(line).toContain("completed");
    expect(line).toContain("/repo/.worktrees/dev-core");
    expect(line).toContain("next package");
  });
});

describe("the workspace is signed by the role whose name it bears (thread 052)", () => {
  const path = "/repo/.worktrees/dev-core";

  it("passes when git in that tree answers with the role's own identity", () => {
    expect(
      checkWorkspaceSignature({
        role: "dev-core",
        path,
        signature: { name: "dev-core", email: "dev-core@agents.invalid" },
      }),
    ).toEqual({ ok: true });
  });

  it("refuses on a foreign signature, naming BOTH sides and the tree that has the problem", () => {
    const verdict = checkWorkspaceSignature({
      role: "dev-core",
      path,
      signature: { name: "John", email: "john@example.com" },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("John <john@example.com>");
    expect(verdict.reason).toContain("dev-core <dev-core@agents.invalid>");
    expect(verdict.reason).toContain(path);
    // The repair, not a diagnosis: the commands to type and the setting to look at.
    expect(verdict.reason).toContain("extensions.worktreeConfig");
    expect(verdict.reason).toContain("config --worktree user.email");
  });

  it("half a signature is a mismatch — the email is what a history is read by", () => {
    expect(
      checkWorkspaceSignature({ role: "dev-core", path, signature: { name: "dev-core" } }).ok,
    ).toBe(false);
    expect(
      checkWorkspaceSignature({
        role: "dev-core",
        path,
        signature: { name: "John", email: "dev-core@agents.invalid" },
      }).ok,
    ).toBe(false);
  });

  it("a tree nothing is set in refuses too, and says the signature is nobody's", () => {
    const verdict = checkWorkspaceSignature({ role: "dev-core", path, signature: {} });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("nobody (nothing set)");
  });

  it("the role's name is taken from the role, not from the path — a renamed role is caught", () => {
    expect(
      checkWorkspaceSignature({
        role: "curator",
        path,
        signature: { name: "dev-core", email: "dev-core@agents.invalid" },
      }).ok,
    ).toBe(false);
  });
});

/**
 * THE RIGHT TO COMMIT A ROLE'S LEFTOVERS (thread 099, john of 2026-09-05). Every test
 * here is about a BORDER of that right: whose dirt it is, and whose head it sits on.
 * The right is narrow on purpose, and the tests that keep it narrow are the ones that
 * matter — a wrong `commit` writes somebody else's unsaved work under a role's name.
 */
describe("planWorkspace — committing what an ended run left", () => {
  const AT = "2026-09-05T12:31:07Z";
  const dirty = (branch: string, extra: Record<string, unknown> = {}) => ({
    exists: true,
    branch,
    head: OTHER,
    dirty: true,
    ...extra,
  });

  it("a detached dirty tree lands on a service branch named role, thread and time", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("HEAD"),
      base: BASE,
      resuming: false,
      thread: "099-dirty-tree-locks-the-role",
      previousReason: "exited-without-handoff",
      baseRef: "origin/main",
      at: AT,
    });
    expect(plan).toEqual({
      action: "commit",
      branch: "wip/dev-core/099-dirty-tree-locks-the-role-20260905T1231Z",
      create: true,
      message:
        "wip(099-dirty-tree-locks-the-role): what the 'exited-without-handoff' run of 'dev-core' left uncommitted",
      from: "exited-without-handoff",
    });
  });

  it("a dirty tree on the role's own branch commits THERE, and starts no branch", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("dev-core/128-delivery-suite-in-checks"),
      base: BASE,
      resuming: false,
      thread: "128-delivery-suite-in-checks",
      previousReason: "completed",
      baseRef: "origin/main",
      at: AT,
    });
    expect(plan).toMatchObject({
      action: "commit",
      branch: "dev-core/128-delivery-suite-in-checks",
      create: false,
    });
  });

  it("a branch that carries no role is the role's when the head is SIGNED by it", () => {
    expect(
      planWorkspace({
        role: ROLE,
        path: WORKSPACE,
        facts: dirty("feat/042-usage-four-doorless-commands", {
          headAuthor: "dev-core@agents.invalid",
        }),
        base: BASE,
        resuming: false,
        previousReason: "completed",
        baseRef: "origin/main",
        at: AT,
        roles: ROLES,
      }),
    ).toMatchObject({ action: "commit", branch: "feat/042-usage-four-doorless-commands" });
  });

  it("and the same branch signed by somebody else is refused, by name", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("feat/042-usage-four-doorless-commands", {
        headAuthor: "curator@agents.invalid",
      }),
      base: BASE,
      resuming: false,
      previousReason: "completed",
      baseRef: "origin/main",
      at: AT,
      roles: ROLES,
    });
    expect(plan.action).toBe("refuse");
    if (plan.action !== "refuse") return;
    expect(plan.reason).toContain("feat/042-usage-four-doorless-commands");
    expect(plan.reason).toContain("not 'dev-core's to write to");
    expect(plan.reason).toContain("git -C /repo/.worktrees/dev-core status --porcelain");
  });

  it("A BRANCH NAMED FOR ANOTHER ROLE IS REFUSED EVEN WHEN THIS ROLE SIGNED THE HEAD", () => {
    // curator's ruling of 2026-09-05 in this thread, at the plan level: the refusal
    // names the role the branch belongs to and says out loud that the signature did not
    // buy the right, so a reader is not left comparing `git log` with the door.
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("curator/017-schema-numbers", { headAuthor: "dev-core@agents.invalid" }),
      base: BASE,
      resuming: false,
      previousReason: "completed",
      baseRef: "origin/main",
      at: AT,
      roles: ROLES,
    });
    expect(plan.action).toBe("refuse");
    if (plan.action !== "refuse") return;
    expect(plan.reason).toContain("a branch named for 'curator', another role of this contour");
    expect(plan.reason).toContain("does NOT make it this role's to write to");
    expect(plan.reason).toContain("git -C /repo/.worktrees/dev-core status --porcelain");
  });

  it("WITHOUT THE ROLE LIST the plan refuses and names the missing fact, not the head", () => {
    // The degradation must be loud: a caller that forgets `roles` gets a refusal that
    // blames the caller, never a silent `commit` under the pre-ruling rule.
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("feat/042-usage-four-doorless-commands", {
        headAuthor: "dev-core@agents.invalid",
      }),
      base: BASE,
      resuming: false,
      previousReason: "completed",
      baseRef: "origin/main",
      at: AT,
    });
    expect(plan.action).toBe("refuse");
    if (plan.action !== "refuse") return;
    expect(plan.reason).toContain("the contour's roles were not handed to it");
    expect(plan.reason).toContain("the caller owes the plan its role ids");
  });

  it("THE BASE BRANCH IS NEVER COMMITTED ONTO — it is shared, and it is named as shared", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("main", { headAuthor: "dev-core@agents.invalid" }),
      base: BASE,
      resuming: false,
      previousReason: "completed",
      baseRef: "origin/main",
      at: AT,
    });
    expect(plan.action).toBe("refuse");
    if (plan.action !== "refuse") return;
    expect(plan.reason).toContain("the BASE branch, which every role shares");
  });

  it("DIRT WITH NO KNOWN RUN IS STILL REFUSED — the border of the right john drew", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("HEAD"),
      base: BASE,
      resuming: false,
      thread: "099-dirty-tree-locks-the-role",
      baseRef: "origin/main",
      at: AT,
    });
    expect(plan.action).toBe("refuse");
    if (plan.action !== "refuse") return;
    expect(plan.reason).toContain("no finished run of this pair to attribute them to");
  });

  it("dirt of a CUT-OFF run still stashes — this package did not touch that branch", () => {
    expect(
      planWorkspace({
        role: ROLE,
        path: WORKSPACE,
        facts: dirty("HEAD"),
        base: BASE,
        resuming: false,
        thread: "099-dirty-tree-locks-the-role",
        previousReason: "quota-exhausted",
        previousSession: "s-1",
        baseRef: "origin/main",
        at: AT,
      }),
    ).toEqual({
      action: "stash",
      from: "quota-exhausted",
      label: "wip 099-dirty-tree-locks-the-role s-1 quota-exhausted",
    });
  });

  it("no timestamp — no invented branch name: it refuses and says why", () => {
    const plan = planWorkspace({
      role: ROLE,
      path: WORKSPACE,
      facts: dirty("HEAD"),
      base: BASE,
      resuming: false,
      previousReason: "completed",
      baseRef: "origin/main",
    });
    expect(plan.action).toBe("refuse");
    if (plan.action !== "refuse") return;
    expect(plan.reason).toContain("no timestamp to name a service branch with");
  });

  it("the line printed before it is carried out names the branch and what made the dirt", () => {
    expect(
      describeWorkspacePlan({
        role: ROLE,
        path: WORKSPACE,
        plan: {
          action: "commit",
          branch: "wip/dev-core/099-x-20260905T1231Z",
          create: true,
          message: "wip(099-x): …",
          from: "exited-without-handoff",
        },
        base: BASE,
        baseRef: "origin/main",
      }),
    ).toContain(
      "committing what the 'exited-without-handoff' run left uncommitted onto a new service branch 'wip/dev-core/099-x-20260905T1231Z'",
    );
  });
});

describe("classifyWorkspaceHead — the four states a role's tree is found in", () => {
  it("the literal HEAD, an empty answer and no answer at all are all 'detached'", () => {
    for (const branch of ["HEAD", "", undefined])
      expect(
        classifyWorkspaceHead({ role: ROLE, ...(branch === undefined ? {} : { branch }) }),
      ).toEqual({ kind: "detached" });
  });

  it("the base is recognised under both spellings — 'main' and 'origin/main'", () => {
    expect(classifyWorkspaceHead({ role: ROLE, branch: "main", baseRef: "origin/main" })).toEqual({
      kind: "base",
      branch: "main",
    });
    expect(classifyWorkspaceHead({ role: ROLE, branch: "main", baseRef: "main" }).kind).toBe(
      "base",
    );
  });

  it("ANOTHER ROLE'S NAME OUTRANKS THIS ROLE'S SIGNATURE — the fork curator ruled on", () => {
    // The one place the two proofs disagree, and the ruling of 2026-09-05 (thread 099)
    // decides it by the cost of being wrong: a false `own` commits — and pushes — into a
    // branch carrying another role's name, moving a head that may have a PR and a
    // verdict on it, while a false `foreign` is only the refusal that stood here before
    // the right existed. The name is also the address a human reads.
    expect(
      classifyWorkspaceHead({
        role: ROLE,
        branch: "curator/017-something",
        headAuthor: "dev-core@agents.invalid",
        roles: ["dev-core", "curator", "reviewer-pr"],
      }),
    ).toEqual({
      kind: "foreign",
      branch: "curator/017-something",
      why: "another-role",
      owner: "curator",
    });
  });

  it("a name carrying NO role of the contour is still decided by the signature", () => {
    // The other half of the ruling, and the reason the signature stays: the contour's
    // branches are `feat/…`/`fix/…` almost to the last one, and a right that only
    // recognised `dev-core/…` would cover next to nothing.
    expect(
      classifyWorkspaceHead({
        role: ROLE,
        branch: "feat/042-something",
        headAuthor: "dev-core@agents.invalid",
        roles: ["dev-core", "curator"],
      }),
    ).toEqual({ kind: "own", branch: "feat/042-something" });
  });

  it("a branch nobody proved is neither refused silently nor taken: it is 'foreign'", () => {
    expect(
      classifyWorkspaceHead({
        role: ROLE,
        branch: "release/agent-protocol-v0.2.5",
        roles: ["dev-core", "curator"],
      }),
    ).toEqual({
      kind: "foreign",
      branch: "release/agent-protocol-v0.2.5",
      why: "not-signed",
    });
  });

  it("WITHOUT THE ROLE LIST the signature is not consulted at all, and the answer says so", () => {
    // The degradation is named rather than silent (curator's requirement in the same
    // ruling): with no list, "carries no role's name" cannot be told from "carries
    // another role's name", so a forgotten argument must NOT quietly hand back the
    // behaviour the ruling replaced. It refuses, and it says which fact it lacked.
    expect(
      classifyWorkspaceHead({
        role: ROLE,
        branch: "feat/042-something",
        headAuthor: "dev-core@agents.invalid",
      }),
    ).toEqual({ kind: "foreign", branch: "feat/042-something", why: "roles-unknown" });
  });
});

describe("serviceBranchName — a name that answers role, thread and time (john's §3.2)", () => {
  it("groups every one of them under 'wip/' and cuts the instant to the minute", () => {
    expect(serviceBranchName({ role: ROLE, thread: "099-dirty", at: "2026-09-05T12:31:07Z" })).toBe(
      "wip/dev-core/099-dirty-20260905T1231Z",
    );
  });

  it("a run with no thread still gets a name, and the name says which part is missing", () => {
    expect(serviceBranchName({ role: ROLE, at: "2026-09-05T12:31:07Z" })).toBe(
      "wip/dev-core/no-thread-20260905T1231Z",
    );
  });
});

describe("describeFailedTidyUp — the tidy-up that did not work (john's §4 exception)", () => {
  const text = describeFailedTidyUp({
    role: ROLE,
    path: WORKSPACE,
    branch: "wip/dev-core/099-x-20260905T1231Z",
    cause: "git commit --quiet -m … — nothing to commit, working tree clean",
    thread: "099-x",
    dirt: {
      files: [{ path: "CARD.md", what: "modified", added: 1, removed: 0 }],
    },
  });

  it("names what was tried and how git answered — not only that something is wrong", () => {
    expect(text).toContain("the commit FAILED");
    expect(text).toContain("nothing to commit, working tree clean");
    expect(text).toContain("wip/dev-core/099-x-20260905T1231Z");
  });

  it("and keeps everything the refusal of #261 carried: composition, scope, both repairs", () => {
    expect(text).toContain("CARD.md (modified, +1/-0)");
    expect(text).toContain("skipped on EVERY thread it holds a turn on");
    expect(text).toContain("git -C /repo/.worktrees/dev-core stash push -u");
  });

  // THE NARROWING that makes #261's repair true again: this text speaks only for the
  // failure of the FIRST step, and it says so — a `checkout -b` that never happened is
  // exactly what leaves the tree detached and the branch non-existent.
  it("says the branch was never created and the tree is still detached", () => {
    expect(text).toContain("was never created");
    expect(text).toContain("still dirty and still detached");
    expect(text).toContain("checkout -b dev-core/099-x");
  });
});

/**
 * THE REVIEWER'S FINDING ON #279 (2026-09-05), and it is the same class as the one that
 * PR had already fixed one step further along: the attempt mutates the tree before it
 * fails, and the refusal goes on describing the tree as it was.
 */
describe("describeFailedTidyUpOnItsBranch — the commit failed with the tree already on a branch", () => {
  const created = describeFailedTidyUpOnItsBranch({
    role: ROLE,
    path: WORKSPACE,
    branch: "wip/dev-core/099-x-20260905T1231Z",
    created: true,
    message: "wip(099-x): what the 'exited-without-handoff' run of 'dev-core' left uncommitted",
    base: "1111111",
    cause: "git add -A — fatal: the index is broken",
    dirt: { files: [{ path: "CARD.md", what: "modified", added: 1, removed: 0 }] },
  });

  it("names the branch this attempt made, and that the tree is no longer detached", () => {
    expect(created).toContain("creating the service branch 'wip/dev-core/099-x-20260905T1231Z'");
    expect(created).toContain("NO LONGER detached");
    expect(created).toContain("fatal: the index is broken");
  });

  it("keeps composition and the scope of the hold — the refusal of #261 loses nothing", () => {
    expect(created).toContain("CARD.md (modified, +1/-0)");
    expect(created).toContain("skipped on EVERY thread it holds a turn on");
  });

  // THE DEFECT ITSELF: `checkout -b` here would branch a second time off the branch the
  // attempt just made and leave the first one behind, named nowhere.
  it("NEVER offers 'checkout -b' — it finishes the commit where the tree now stands", () => {
    expect(created).not.toContain("checkout -b");
    expect(created).toContain(
      `git -C ${WORKSPACE} add -A && git -C ${WORKSPACE} commit -m 'wip(099-x): what the 'exited-without-handoff' run of 'dev-core' left uncommitted' && git -C ${WORKSPACE} push -u origin wip/dev-core/099-x-20260905T1231Z`,
    );
  });

  it("and the PARK gesture takes the branch back, by name and from the base commit", () => {
    expect(created).toContain(`git -C ${WORKSPACE} stash push -u -m`);
    expect(created).toContain(`git -C ${WORKSPACE} checkout --detach 1111111`);
    expect(created).toContain(`git -C ${WORKSPACE} branch -D wip/dev-core/099-x-20260905T1231Z`);
  });

  // THE OTHER HALF OF THE SHAPE — nothing was created, the role was already standing on
  // its own branch. The repair is the same one; there is no branch to take back.
  const found = describeFailedTidyUpOnItsBranch({
    role: ROLE,
    path: WORKSPACE,
    branch: "dev-core/099-x",
    created: false,
    message: "wip(099-x): what the 'exited-without-handoff' run of 'dev-core' left uncommitted",
    base: "1111111",
    cause: "git commit --quiet -m … — fatal: cannot lock ref",
  });

  it("on the role's OWN branch it claims no creation and offers no deletion", () => {
    expect(found).toContain("the role's own branch, where the session left it");
    expect(found).not.toContain("creating the service branch");
    expect(found).not.toContain("branch -D");
    expect(found).not.toContain("checkout -b");
    expect(found).toContain(`git -C ${WORKSPACE} push -u origin dev-core/099-x`);
  });

  it("and with no dirt read it asks the tree instead of inventing a composition", () => {
    expect(found).toContain(`git -C ${WORKSPACE} status --porcelain`);
  });
});

describe("describeStrandedWorkspace — the commit went, the step after it did not", () => {
  // The reviewer's finding on #279: one text used to cover two opposite facts. Here the
  // work IS saved, so every word about dirt would be false — and the repair a human
  // needs is to move a head, not to rescue a file.
  const text = describeStrandedWorkspace({
    role: ROLE,
    path: WORKSPACE,
    branch: "wip/dev-core/099-x-20260905T1231Z",
    head: "abc1234",
    cause:
      "git checkout --detach --quiet 1111111 — Unable to create '.git/index.lock': File exists",
  });

  it("says where the work landed and that nothing is dirty and nothing is lost", () => {
    expect(text).toContain("commit abc1234 on 'wip/dev-core/099-x-20260905T1231Z'");
    expect(text).toContain("nothing is dirty and nothing is lost");
    expect(text).toContain("Unable to create '.git/index.lock'");
  });

  it("NEVER says the commit failed, nor that the tree is dirty, nor offers 'checkout -b'", () => {
    expect(text).not.toContain("the commit FAILED");
    expect(text).not.toContain("still dirty");
    expect(text).not.toContain("uncommitted changes the circuit");
    expect(text).not.toContain("checkout -b");
    expect(text).not.toContain("stash push");
  });

  it("carries the push outcome, because 'on this box only' is what a searcher needs", () => {
    expect(
      describeStrandedWorkspace({
        role: ROLE,
        path: WORKSPACE,
        branch: "wip/dev-core/099-x-20260905T1231Z",
        head: "abc1234",
        cause: "git checkout — busy",
        push: "git push -q -u origin … — could not read Username",
      }),
    ).toContain("NOT pushed (git push -q -u origin … — could not read Username)");
    expect(text).toContain("and pushed");
  });
});
