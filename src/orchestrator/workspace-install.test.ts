/**
 * THE THREE BORDERS OF JOHN'S GRANT, ONE CASE EACH (thread
 * `180-selfheal-leaves-the-workspaces-behind`, half (а)) — and the two silences, which
 * carry the same weight: this decision is taken at EVERY launch of every role, and a
 * circuit that wrote into somebody's tree on the wrong tick would be worse than the
 * standstill it was given the right to end.
 */
import { describe, expect, it } from "vitest";

import { describeWorkspaceInstall, planWorkspaceInstall } from "./workspace-install.js";

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
