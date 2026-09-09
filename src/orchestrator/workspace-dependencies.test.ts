/**
 * THE ANSWERS OF THE DEPENDENCY CHECK (thread `161-daemon-self-restart`) — the two states
 * of a tree that the field produced within ten minutes of each other on 2026-09-09, and the
 * silences, which carry as much weight as the note: this runs at every launch of every
 * role, and a note on a healthy tree is a sentence every session pays for and none can act
 * on.
 */
import { describe, expect, it } from "vitest";

import { checkWorkspaceDependencies, dependenciesRepair } from "./workspace-dependencies.js";

const at = {
  role: "dev-core",
  path: "/home/x/repo/.worktrees/dev-core@161-daemon-self-restart",
  repo: "/home/x/repo",
};

/** What a pnpm monorepo of two packages looks like once a hand has installed it. */
const INSTALLED = [".", "packages/agent-protocol", "packages/transport-telegram"];

describe("the tree a session is put in can run a command (thread 161)", () => {
  it("the field case: a worktree made a moment ago, nothing installed → the fact and ONE repair line", () => {
    const verdict = checkWorkspaceDependencies({ ...at, home: INSTALLED, tree: [] });

    expect(verdict.installed).toBe(false);
    if (verdict.installed) return;
    // Whose tree, and the directories that are actually not there — the two things the
    // session of 21:37:09Z had to derive from `Cannot find package 'zod'`.
    expect(verdict.note).toContain("dev-core");
    expect(verdict.note).toContain(`${at.path}/node_modules`);
    expect(verdict.note).toContain(`${at.path}/packages/agent-protocol/node_modules`);
    expect(verdict.note).toContain("/home/x/repo");
    // The error the session will otherwise meet is named, because the note has to be
    // recognisable from the failure it prevents and not only from the state it describes.
    expect(verdict.note).toContain("ERR_MODULE_NOT_FOUND");
    // And exactly one line of repair, in the form that is correct from any cwd.
    expect(verdict.note).toContain(dependenciesRepair(at.path));
    expect(verdict.note.match(/pnpm /g)).toHaveLength(1);
  });

  it("the package's own dependencies missing while the root is installed → still the note", () => {
    // The half-state, and it is not a corner: `tsx` resolves upwards into the root
    // `node_modules` of the home checkout, so a tree missing only the package-level
    // install fails exactly the same way and looks, from the root, installed.
    const verdict = checkWorkspaceDependencies({ ...at, home: INSTALLED, tree: ["."] });

    expect(verdict.installed).toBe(false);
    if (verdict.installed) return;
    expect(verdict.note).toContain(`${at.path}/packages/agent-protocol/node_modules`);
    // The one that IS there is not named — a note that lists healthy directories is a note
    // whose reader has to work out which half of it to act on.
    expect(verdict.note).not.toContain(`${at.path}/node_modules'`);
  });

  it("a healthy tree → SILENCE, and not a line saying so", () => {
    expect(checkWorkspaceDependencies({ ...at, home: INSTALLED, tree: INSTALLED })).toEqual({
      installed: true,
    });
    // More installed than the home checkout has is not a fault either: the question asked
    // is "can this tree run what the circuit runs", never "are the two trees identical".
    expect(
      checkWorkspaceDependencies({ ...at, home: ["."], tree: [".", "packages/agent-protocol"] }),
    ).toEqual({ installed: true });
  });

  it("a home checkout with no install anywhere → SILENCE: no measurement, no expectation", () => {
    // A contour that does not install at all — there is nothing here this module knows to
    // be true, and a requirement invented from an empty measurement would put a false
    // sentence into every prompt of that contour.
    expect(checkWorkspaceDependencies({ ...at, home: [], tree: [] })).toEqual({ installed: true });
  });

  it("many missing roots → the first four are named and the rest are COUNTED, not dropped", () => {
    const home = ["a", "b", "c", "d", "e", "f"];
    const verdict = checkWorkspaceDependencies({ ...at, home, tree: [] });

    expect(verdict.installed).toBe(false);
    if (verdict.installed) return;
    expect(verdict.note).toContain(`${at.path}/a/node_modules`);
    expect(verdict.note).toContain(`${at.path}/d/node_modules`);
    expect(verdict.note).not.toContain(`${at.path}/e/node_modules`);
    // The truncation SAYS it truncated — a list that silently ends reads as a complete one.
    expect(verdict.note).toContain("2 more");
  });
});
