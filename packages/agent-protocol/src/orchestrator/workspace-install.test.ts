/**
 * THE THREE BORDERS OF JOHN'S GRANT, ONE CASE EACH (thread
 * `180-selfheal-leaves-the-workspaces-behind`, half (а)) — and the two silences, which
 * carry the same weight: this decision is taken at EVERY launch of every role, and a
 * circuit that wrote into somebody's tree on the wrong tick would be worse than the
 * standstill it was given the right to end.
 */
import { describe, expect, it } from "vitest";

import {
  describePlannedWorkspaceInstall,
  describeWorkspaceInstall,
  planWorkspaceInstall,
  workspaceInstallOutcome,
} from "./workspace-install.js";

const at = {
  role: "dev-core",
  path: "/home/x/repo/.worktrees/dev-core@180-selfheal-leaves-the-workspaces-behind",
};

/** A tree exactly as the orchestrator issues it: detached, clean, nobody's. */
const ISSUED = { ...at, needed: true, dirty: false, resuming: false } as const;

describe("the box levels the workspaces it issued (thread 180, john 2026-09-12)", () => {
  it("the field case: a tree the orchestrator owns, measured behind → it is levelled", () => {
    const plan = planWorkspaceInstall(ISSUED);

    expect(plan.install).toBe(true);
    if (!plan.install) return;
    expect(plan.path).toBe(at.path);
    // The line says whose tree and which one — the two things the three standstills of
    // 09.09–12.09 were diagnosed by eye for want of.
    expect(plan.note).toContain("dev-core");
    expect(plan.note).toContain(at.path);
  });

  it("border 1: a tree on the role's OWN branch is not touched, and the branch is named", () => {
    const plan = planWorkspaceInstall({ ...ISSUED, branch: "dev-core/180-selfheal-stall-alarm" });

    expect(plan.install).toBe(false);
    if (plan.install) return;
    expect(plan.why).toContain("dev-core/180-selfheal-stall-alarm");
    // Not a shrug: the reason a border stood aside has to be readable in the journal of
    // the tick it stood aside on, or the next standstill is diagnosed from scratch.
    expect(plan.why).toContain("unlanded");
  });

  it("border 2: a dirty tree goes by thread 099 and nothing is written into it", () => {
    const plan = planWorkspaceInstall({ ...ISSUED, dirty: true });

    expect(plan.install).toBe(false);
    if (plan.install) return;
    expect(plan.why).toContain("099");
    expect(plan.why).toContain("uncommitted");
  });

  it("border 3: a resumed run has a session's state in that tree — levelling stands aside", () => {
    const plan = planWorkspaceInstall({ ...ISSUED, resuming: true });

    expect(plan.install).toBe(false);
    if (plan.install) return;
    expect(plan.why).toContain(at.path);
    expect(plan.why).toContain("resumes");
  });

  it("a dirty tree ON ITS OWN BRANCH declines by the FIRST border that applies, not the last", () => {
    // Both borders hold at once — the field state of a role that was cut off mid-work.
    // What matters is that it declines and says something true; what it must NOT do is
    // fall through to an install because two reasons cancelled each other out.
    const plan = planWorkspaceInstall({
      ...ISSUED,
      dirty: true,
      branch: "dev-core/180-selfheal-stall-alarm",
    });

    expect(plan.install).toBe(false);
  });

  it("nothing measured → no install AND no reason: a healthy tick says nothing at all", () => {
    const plan = planWorkspaceInstall({ ...ISSUED, needed: false });

    expect(plan.install).toBe(false);
    if (plan.install) return;
    // The silence is the requirement (msg-027 §2.3): a line on a tick where everything is
    // in order is a sentence every session pays for and none can act on.
    expect(plan.why).toBeUndefined();
  });

  it("a tree that is behind but resumed stays silent about the INSTALL, not about the fault", () => {
    // The door's own note is printed by the caller either way; this module only ever
    // decides the write. The case exists so that a future widening of `needed` cannot
    // quietly make a resumed tree installable.
    const plan = planWorkspaceInstall({ ...ISSUED, resuming: true, dirty: true });

    expect(plan.install).toBe(false);
  });
});

describe("what is printed AFTER the install says the outcome, not the intention", () => {
  it("done → the tree is named as running the circuit's build", () => {
    const line = describeWorkspaceInstall({ ...at, outcome: { ok: true } });

    expect(line).toContain(at.path);
    expect(line).toContain("dev-core");
  });

  it("failed → the cause, and the fault stays as loud as it was before this right existed", () => {
    const line = describeWorkspaceInstall({
      ...at,
      outcome: { ok: false, cause: "ERR_PNPM_OUTDATED_LOCKFILE" },
    });

    expect(line).toContain("FAILED");
    expect(line).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
    expect(line).toContain("still behind");
  });
});

describe("what a PLAN says where the real launch would have levelled (john 2026-09-13)", () => {
  it("names both facts: that nothing was written, and what the launch that writes would do", () => {
    const line = describePlannedWorkspaceInstall(at);

    // The class john closed is a plan that says a refusal the real launch never sees, so
    // the sentence is asserted on both halves: the mode and the outcome.
    expect(line).toContain("this is a plan");
    expect(line).toContain("a real launch would level");
    expect(line).toContain("carry on");
    expect(line).toContain(at.path);
    expect(line).toContain("dev-core");
  });

  /**
   * HALF (б): the parent of a background launch is not a plan. The levelling is not skipped
   * for it — it is done by its child — so the two sentences must not be one, or the parent's
   * terminal would carry a false statement about a tree that is about to be levelled.
   */
  it("the parent of a BACKGROUND launch is told apart: the child levels, and it is not called a plan", () => {
    const line = describePlannedWorkspaceInstall({ ...at, background: true });

    expect(line).toContain("this run only forks");
    expect(line).toContain("the child of this background launch levels");
    expect(line).toContain("under its own lock");
    expect(line).toContain(at.path);
    // The plan's own words are absent: they would say nobody is going to touch that tree.
    expect(line).not.toContain("this is a plan");
    expect(line).not.toContain("a real launch would level");
  });
});

/**
 * THE TWO ENDINGS OF THE INSTALL, TOLD APART (thread 221, П-2) — the class thread 212 closed
 * and thread 219 closed on the restart path, in the third place it was still conflated. The
 * text this replaces was `pnpm did not run — spawnSync pnpm ENOENT`: it named no path, it
 * put the blame on a spawn, and a levelling that failed because the daemon's environment
 * could not see a package manager read exactly like a project that will not install.
 *
 * The resolutions below are the two the field produces: a box where the package manager sits
 * beside node, and a box where it is nowhere this process can see.
 */
describe("a levelling that failed says WHICH failure it was (thread 221)", () => {
  const BESIDE = {
    command: "/opt/node/bin/pnpm",
    source: "beside-node",
    looked: ["/opt/node/bin/pnpm"],
  } as const;
  const NOWHERE = {
    command: "pnpm",
    source: "unresolved",
    looked: ["/opt/node/bin/pnpm", "/usr/bin/pnpm", "/bin/pnpm"],
  } as const;

  it("no process ran → it says so, names the places looked at, and says it is NOT the project", () => {
    const outcome = workspaceInstallOutcome({
      name: "pnpm",
      resolution: NOWHERE,
      said: {
        status: null,
        signal: null,
        error: { code: "ENOENT", message: "spawnSync pnpm ENOENT" },
      },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.cause).toContain("NO PROCESS RAN");
    expect(outcome.cause).toContain("there is no executable 'pnpm' to start (ENOENT");
    // The diagnosis the old line cost a reader from scratch: where it was looked for, and
    // that the repair is on the box rather than in the repository.
    expect(outcome.cause).toContain("/opt/node/bin/pnpm");
    expect(outcome.cause).toContain("/usr/bin/pnpm");
    expect(outcome.cause).toContain("This is NOT a failure of the project");
    // And the line that made the two endings one word is gone.
    expect(outcome.cause).not.toContain("did not run");
    // The whole point of the sentence is that it reaches a human: it is the journal's line
    // through the door's own text.
    expect(describeWorkspaceInstall({ ...at, outcome })).toContain("NO PROCESS RAN");
  });

  it("a process ran and refused → the exit code and what it printed, with no talk of paths", () => {
    const outcome = workspaceInstallOutcome({
      name: "pnpm",
      resolution: BESIDE,
      said: {
        status: 1,
        signal: null,
        stderr: " ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile\n",
      },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.cause).toContain("'/opt/node/bin/pnpm' ran and exited 1");
    expect(outcome.cause).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
    // The repair here is the project's, so the sentence about installing a tool — which is
    // the other ending's — must not be anywhere in it.
    expect(outcome.cause).not.toContain("NO PROCESS RAN");
    expect(outcome.cause).not.toContain("Looked beside this node binary");
  });

  it("the ceiling killed it → a process that RAN and was killed, not a missing tool", () => {
    const outcome = workspaceInstallOutcome({
      name: "pnpm",
      resolution: BESIDE,
      said: {
        status: null,
        signal: "SIGTERM",
        error: { code: "ETIMEDOUT", message: "spawnSync ETIMEDOUT" },
      },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // `spawnSync` reports a timeout as an error too, and reading that error first is how a
    // hung install gets reported as "there is no pnpm on this box".
    expect(outcome.cause).toContain("ran and was killed by SIGTERM");
    expect(outcome.cause).not.toContain("NO PROCESS RAN");
  });

  it("exit 0 is the only ending that is not a failure", () => {
    expect(
      workspaceInstallOutcome({
        name: "pnpm",
        resolution: BESIDE,
        said: { status: 0, signal: null, stdout: "Already up to date" },
      }),
    ).toEqual({ ok: true });
  });
});
