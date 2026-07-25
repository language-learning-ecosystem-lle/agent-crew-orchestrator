import { describe, expect, it } from "vitest";

import {
  agentBinaryVerdict,
  type CheckoutFacts,
  environmentVerdict,
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
  it("the binary is found → ok with the path", () => {
    expect(agentBinaryVerdict("claude", "/usr/bin/claude")).toEqual({
      name: "agent: binary",
      status: "ok",
      detail: "/usr/bin/claude",
    });
  });

  it("not found → a refusal, and it says WHY that matters before the lease", () => {
    const verdict = agentBinaryVerdict("claude", null);
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("lease");
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

  it("the check is soft: the package does not know which version is 'right' for a foreign project", () => {
    expect(environmentVerdict({ nodeVersion: null, appliedKeys: [] }).status).toBe("ok");
  });
});

describe("the verdict and the display", () => {
  const ok: PreflightCheck = { name: "a", status: "ok", detail: "d" };
  const bad: PreflightCheck = { name: "b", status: "fail", detail: "why" };

  it("a single failure fails the whole preflight", () => {
    expect(preflightPassed([ok, ok])).toBe(true);
    expect(preflightPassed([ok, bad])).toBe(false);
  });

  it("printed IN FULL: what has been checked is an answer in itself", () => {
    const rendered = renderPreflight([ok, bad]);
    expect(rendered.split("\n")).toHaveLength(2);
    expect(rendered).toContain("✓ a");
    expect(rendered).toContain("✗ b: why");
  });
});

describe("workdirVerdict — the session lands in the working repository as it is", () => {
  it("with no declared branch it is only a fact, no refusal: the package does not know the 'right' one", () => {
    const verdict = workdirVerdict({ branch: "feature/x", dirty: false });
    expect(verdict.status).toBe("ok");
    expect(verdict.detail).toContain("feature/x");
  });

  it("dirtiness is shown as a fact, but does not fail on its own", () => {
    expect(workdirVerdict({ branch: "main", dirty: true })).toMatchObject({
      status: "ok",
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
