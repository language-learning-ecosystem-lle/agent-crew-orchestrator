/**
 * THE CONTOUR BOUNDARY, clause by clause. The readers are injected: the verdict is a
 * judgement about two facts (`origin` and the claims of this box), and reading those
 * facts from a real git and a real `~/.config` is the seam — proved in
 * `merge/gate.process.test.ts`, where the command refuses a foreign checkout as a
 * process, before `gh` is asked anything.
 */
import { describe, expect, it } from "vitest";

import { type ContourReaders, checkContour, normalizeOrigin } from "./contour.js";

const readers = (input: {
  origins: Record<string, string>;
  circuits?: readonly { name: string; repo?: string }[];
}): ContourReaders => ({
  originOf: (tree) => input.origins[tree],
  circuits: () => input.circuits ?? [],
});

describe("normalizeOrigin", () => {
  it("reads the four ways of writing one GitHub remote as one repository", () => {
    const forms = [
      "git@github.com:owner/repo.git",
      "https://github.com/owner/repo.git",
      "https://github.com/owner/repo",
      "ssh://git@github.com/owner/repo/",
    ];
    expect(new Set(forms.map(normalizeOrigin)).size).toBe(1);
  });

  it("keeps two different repositories different", () => {
    expect(normalizeOrigin("git@github.com:o/agent-crew-orchestrator.git")).not.toBe(
      normalizeOrigin("git@github.com:o/language-learning-ecosystem.git"),
    );
  });
});

describe("checkContour — the target", () => {
  it("passes a target that is the same repository as the circuit's checkout", () => {
    const verdict = checkContour({
      ground: "/home/lle/projects/aco/.worktrees/dev-core",
      target: "/home/lle/projects/aco",
      readers: readers({
        origins: {
          "/home/lle/projects/aco": "https://github.com/o/aco.git",
          "/home/lle/projects/aco/.worktrees/dev-core": "git@github.com:o/aco.git",
        },
        circuits: [{ name: "hetzner", repo: "/home/lle/projects/aco" }],
      }),
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses a checkout of another circuit BY NAME — the shape of #453/#454", () => {
    const verdict = checkContour({
      ground: "/home/lle/projects/aco/.worktrees/curator",
      target: "/tmp/lle-clone",
      readers: readers({
        origins: {
          "/home/lle/projects/aco": "https://github.com/o/aco.git",
          "/tmp/lle-clone": "https://github.com/o/language-learning-ecosystem.git",
        },
        circuits: [{ name: "hetzner", repo: "/home/lle/projects/aco" }],
      }),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toContain("/tmp/lle-clone");
    expect(verdict.refusal).toContain("language-learning-ecosystem");
    expect(verdict.refusal).toContain("hetzner");
  });

  it("refuses a target with no 'origin' that lies outside the circuit's checkout", () => {
    const verdict = checkContour({
      ground: "/home/lle/projects/aco",
      target: "/tmp/scratch",
      readers: readers({
        origins: { "/home/lle/projects/aco": "https://github.com/o/aco.git" },
        circuits: [{ name: "hetzner", repo: "/home/lle/projects/aco" }],
      }),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toContain("no 'origin'");
  });

  it("passes a target with no 'origin' that lies INSIDE the circuit's checkout", () => {
    const verdict = checkContour({
      ground: "/home/lle/projects/aco",
      target: "/home/lle/projects/aco/packages",
      readers: readers({
        origins: { "/home/lle/projects/aco": "https://github.com/o/aco.git" },
        circuits: [{ name: "hetzner", repo: "/home/lle/projects/aco" }],
      }),
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("checkContour — the ground", () => {
  it("refuses a command run from a tree no circuit of this box claims", () => {
    const verdict = checkContour({
      ground: "/tmp/lle-clone",
      target: "/tmp/lle-clone",
      readers: readers({
        origins: { "/tmp/lle-clone": "https://github.com/o/language-learning-ecosystem.git" },
        circuits: [{ name: "hetzner", repo: "/home/lle/projects/aco" }],
      }),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toContain("no circuit declared on this box");
    expect(verdict.refusal).toContain("hetzner");
  });

  it("picks the longest claim when one checkout is nested under another", () => {
    const verdict = checkContour({
      ground: "/srv/projects/aco/.worktrees/dev-core",
      target: "/srv/projects/aco",
      readers: readers({
        origins: {
          "/srv/projects": "https://github.com/o/other.git",
          "/srv/projects/aco": "https://github.com/o/aco.git",
        },
        circuits: [
          { name: "outer", repo: "/srv/projects" },
          { name: "hetzner", repo: "/srv/projects/aco" },
        ],
      }),
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("hetzner");
  });

  it("does not invent a boundary on a box that declares no 'repo' — and says so", () => {
    const verdict = checkContour({
      ground: "/tmp/fresh",
      target: "/tmp/fresh",
      readers: readers({
        origins: { "/tmp/fresh": "https://github.com/o/aco.git" },
        circuits: [{ name: "unnamed" }],
      }),
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("no instance with 'repo'");
  });

  it("still compares against the invoking tree when the box declares nothing", () => {
    const verdict = checkContour({
      ground: "/tmp/fresh",
      target: "/tmp/foreign",
      readers: readers({
        origins: {
          "/tmp/fresh": "https://github.com/o/aco.git",
          "/tmp/foreign": "https://github.com/o/language-learning-ecosystem.git",
        },
      }),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toContain("the invoking tree");
  });
});
