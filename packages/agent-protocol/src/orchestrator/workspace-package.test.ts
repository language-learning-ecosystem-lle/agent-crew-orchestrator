/**
 * THE FOUR ANSWERS OF THE PACKAGE CHECK (thread `085-stale-workspace-package`) — and the
 * two that say nothing are as load-bearing as the two that refuse: this door stands on
 * every launch of every role, so a false refusal takes the whole circuit down, and the
 * contour it lives in (the protocol's own, which installs no copy of itself) is precisely
 * the one where there is nothing to compare.
 */
import { describe, expect, it } from "vitest";

import {
  checkWorkspacePackage,
  isStaleWorkspaceBuild,
  WORKSPACE_PACKAGE,
} from "./workspace-package.js";

const at = { role: "dev-acme", path: "/home/x/repo/.worktrees/dev-acme", repo: "/home/x/repo" };

describe("the workspace runs the build the circuit runs", () => {
  it("the field case: an older package in the tree, the same schema in both → refused BY NAME", () => {
    const verdict = checkWorkspacePackage({
      ...at,
      facts: {
        installed: "0.2.7",
        reference: "0.2.9",
        pin: "github:language-learning-ecosystem-lle/agent-crew-orchestrator#agent-protocol-v0.2.9",
      },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // The four things the session of 2026-09-02 had to derive from an `exit 2`: whose
    // tree, which version is there, which is expected, and the command that repairs it.
    expect(verdict.reason).toContain("dev-acme");
    expect(verdict.reason).toContain("/home/x/repo/.worktrees/dev-acme");
    expect(verdict.reason).toContain("0.2.7");
    expect(verdict.reason).toContain("0.2.9");
    expect(verdict.reason).toContain("install --frozen-lockfile");
    // The pin is quoted for whoever greps for it — it is never the thing compared.
    expect(verdict.reason).toContain("agent-protocol-v0.2.9");
    // And the reason says why the OTHER door let this through, because that is the first
    // thing a reader of the line will ask.
    expect(verdict.reason).toContain("schema version");
  });

  it("a tree that was never installed → refused, and the refusal names the missing path", () => {
    const verdict = checkWorkspacePackage({ ...at, facts: { reference: "0.2.9" } });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain(`node_modules/${WORKSPACE_PACKAGE}`);
    expect(verdict.reason).toContain("install --frozen-lockfile");
  });

  it("the versions agree → passes, and says which build it is standing on", () => {
    const verdict = checkWorkspacePackage({
      ...at,
      facts: { installed: "0.2.9", reference: "0.2.9" },
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("0.2.9");
  });

  it("the home checkout installs no copy of the package → SILENCE, not a refusal", () => {
    // The protocol's own contour: the package is the repository, the sessions run it from
    // source, and `node_modules/agent-protocol` exists nowhere. A door that invented an
    // expectation here would refuse every role of the repository it is written in.
    const verdict = checkWorkspacePackage({ ...at, facts: {} });

    expect(verdict).toEqual({ ok: true });
    // Not even a line: a comparison that did not happen is not reported as one that did.
    expect(checkWorkspacePackage({ ...at, facts: { installed: "0.2.7" } })).toEqual({ ok: true });
  });
});

/**
 * WHOEVER CARRIES THIS REFUSAL ONWARD CARRIES ONLY ITS TEXT (thread 212), so the text has
 * to be recognisable — and the recogniser is asked of what the door ACTUALLY RETURNS here,
 * never of a literal restated in this file: a test that pinned its own copy of the sentence
 * would keep passing while the door and the letter drifted apart.
 */
describe("the stale build is told apart from every other refusal by its own mark", () => {
  it("holds on the refusal the door writes about a tree on another build", () => {
    const verdict = checkWorkspacePackage({
      ...at,
      facts: { installed: "0.2.7", reference: "0.2.9" },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(isStaleWorkspaceBuild(verdict.reason)).toBe(true);
  });

  it("does NOT hold on the refusal about a tree that was never installed", () => {
    const verdict = checkWorkspacePackage({ ...at, facts: { reference: "0.2.9" } });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Its cure is the command the sentence itself prints, so the letter must not talk over
    // it with the pin — the same answer as for a dirty tree or a foreign head.
    expect(isStaleWorkspaceBuild(verdict.reason)).toBe(false);
  });

  it("does NOT hold on a refusal about the STATE of the tree", () => {
    expect(
      isStaleWorkspaceBuild(
        "the workspace has uncommitted changes left by the 'exited-without-handoff' run of this pair",
      ),
    ).toBe(false);
    expect(isStaleWorkspaceBuild("the workspace '/w/dev-acme' was locked as it was created")).toBe(
      false,
    );
  });
});
