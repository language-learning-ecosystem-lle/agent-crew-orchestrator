import { describe, expect, it } from "vitest";

import {
  agentBinaryVerdict,
  type CheckoutFacts,
  environmentVerdict,
  machineConfigVerdict,
  mailCheckoutVerdict,
  type PreflightCheck,
  preflightPassed,
  renderPreflight,
  workdirVerdict,
} from "./preflight.js";

const facts = (over: Partial<CheckoutFacts> = {}): CheckoutFacts => ({
  branch: "comms",
  expectedBranch: "comms",
  dirty: false,
  behind: 0,
  ahead: 0,
  ...over,
});

describe("mailCheckoutVerdict", () => {
  it("a fresh checkout on the right branch → ok", () => {
    expect(mailCheckoutVerdict(facts()).status).toBe("ok");
  });

  it("lagging behind is a REFUSAL: working on yesterday's mail is worse than refusing", () => {
    const verdict = mailCheckoutVerdict(facts({ behind: 3 }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("behind");
    expect(verdict.detail).toContain("3");
  });

  it("a dirty tree is a refusal, NOT an auto-repair: a role may be writing a message", () => {
    const verdict = mailCheckoutVerdict(facts({ dirty: true }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("leaving them alone");
  });

  it("unpushed commits are a refusal: the circuit would read mail nobody else has", () => {
    expect(mailCheckoutVerdict(facts({ ahead: 2 })).status).toBe("fail");
  });

  it("a foreign branch is a refusal naming both, so the divergence is visible", () => {
    const verdict = mailCheckoutVerdict(facts({ branch: "main" }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("main");
    expect(verdict.detail).toContain("comms");
  });

  it("the branch is checked FIRST: on a foreign branch the other facts are beside the point", () => {
    const verdict = mailCheckoutVerdict(facts({ branch: "main", dirty: true, behind: 5 }));
    expect(verdict.detail).toContain("the mail lives in");
  });
});

describe("agentBinaryVerdict", () => {
  it("the binary is found → ok with the path, the tool and the layer that named it", () => {
    expect(
      agentBinaryVerdict({
        worker: "claude-code",
        exec: "claude",
        source: "machine",
        resolved: "/usr/bin/claude",
      }),
    ).toEqual({
      name: "agent: binary (claude-code)",
      status: "ok",
      detail: "/usr/bin/claude (machine)",
    });
  });

  it("not found → a refusal, and it says WHY that matters before the lease", () => {
    const verdict = agentBinaryVerdict({
      worker: "claude-code",
      exec: "claude",
      source: "flag",
      resolved: null,
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("lease");
  });

  it("nobody named the path → the refusal points at the machine config (R14)", () => {
    // The whole hole R14 closes: on a box where the binary sits under a version
    // manager, "'claude' not found" is true and leaves the reader with nothing to do.
    const verdict = agentBinaryVerdict({
      worker: "claude-code",
      exec: "claude",
      source: "default",
      resolved: null,
    });
    expect(verdict.detail).toContain("agents['claude-code'].exec");
  });
});

describe("machineConfigVerdict (R14)", () => {
  it("is a FACT and never a verdict: an absent machine config is a legitimate state", () => {
    // A machine with the agent on PATH says nothing and is right to. A tick here
    // would claim something was compared; a cross would refuse a working circuit.
    expect(
      machineConfigVerdict("/home/x/.config/agent-protocol/local.json — absent"),
    ).toMatchObject({ name: "machine config", status: "info" });
  });
});

describe("environmentVerdict", () => {
  it("shows the node version the child will inherit", () => {
    const verdict = environmentVerdict({ nodeVersion: "v24.18.0", appliedKeys: [] });
    expect(verdict.detail).toContain("v24.18.0");
    expect(verdict.detail).toContain("no environment preamble");
  });

  it("names the applied preamble keys", () => {
    const verdict = environmentVerdict({ nodeVersion: "v24.18.0", appliedKeys: ["PATH"] });
    expect(verdict.detail).toContain("preamble: PATH");
  });

  it("nothing here is a verdict: with no 'right' version to compare against the line is info, not ok", () => {
    // R12: the environment check never compared anything, so it never earned a
    // tick. Its status says so now.
    expect(environmentVerdict({ nodeVersion: null, appliedKeys: [] }).status).toBe("info");
  });
});

describe("the verdict and the display", () => {
  const ok: PreflightCheck = { name: "a", status: "ok", detail: "d" };
  const bad: PreflightCheck = { name: "b", status: "fail", detail: "why" };
  const fact: PreflightCheck = { name: "c", status: "info", detail: "as it is" };

  it("a single failure fails the whole preflight", () => {
    expect(preflightPassed([ok, ok])).toBe(true);
    expect(preflightPassed([ok, bad])).toBe(false);
  });

  it("a fact does not stop the circuit — only a refusal does", () => {
    // Otherwise the new status would silently become a third way to fail, and every
    // run without a declared workdir branch would stop starting.
    expect(preflightPassed([ok, fact])).toBe(true);
    expect(preflightPassed([fact, bad])).toBe(false);
  });

  it("printed IN FULL: what has been checked is an answer in itself", () => {
    const rendered = renderPreflight([ok, bad]);
    expect(rendered.split("\n")).toHaveLength(2);
    expect(rendered).toContain("✓ a");
    expect(rendered).toContain("✗ b: why");
  });

  it("THE MARKS DIFFER: a tick is a passed comparison, a dot is a fact (R12)", () => {
    // The reason for the whole status: `✓ working tree: agent-protocol/tails-readme`
    // was printed before two runs that then worked from the wrong branch. The tick
    // was read as confirmation of something nobody had checked.
    const rendered = renderPreflight([ok, fact, bad]);
    expect(rendered).toContain("✓ a");
    expect(rendered).toContain("· c: as it is");
    expect(rendered).toContain("✗ b: why");
    expect(rendered).not.toContain("✓ c");
  });
});

describe("workdirVerdict — the session lands in the working repository as it is", () => {
  it("with no declared branch it is a FACT and not a tick: nothing was compared (R12)", () => {
    const verdict = workdirVerdict({ branch: "feature/x", dirty: false });
    expect(verdict.status).toBe("info");
    expect(verdict.detail).toContain("feature/x");
    // And it says what to write to make the check bite, rather than leaving the
    // operator to find the field in the README.
    expect(verdict.detail).toContain("orchestrator.workdir.branch");
  });

  it("dirtiness is shown as a fact, but does not fail on its own", () => {
    expect(workdirVerdict({ branch: "main", dirty: true })).toMatchObject({
      status: "info",
    });
    expect(workdirVerdict({ branch: "main", dirty: true }).detail).toContain("unsaved");
  });

  it("the project declared a branch and it is the wrong one → a refusal naming both", () => {
    const verdict = workdirVerdict({ branch: "feature/x", dirty: false, expectedBranch: "main" });
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("feature/x");
    expect(verdict.detail).toContain("main");
  });

  it("the declared branch matched → ok", () => {
    expect(workdirVerdict({ branch: "main", dirty: false, expectedBranch: "main" }).status).toBe(
      "ok",
    );
  });
});
