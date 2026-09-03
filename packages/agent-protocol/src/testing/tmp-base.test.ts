/**
 * The three outcomes of the choice, and one measurement of the live box.
 *
 * The probe is injected, so the branches are stated rather than reproduced — a box whose
 * `TMPDIR` happens to be neutral could not otherwise exercise the moving branch at all,
 * and a runner is exactly such a box.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { enclosingRepository, neutralTmpBase, TmpBaseError } from "./tmp-base.js";

describe("the temp base of this suite is outside a git repository (thread 098)", () => {
  it("leaves a neutral base exactly where it is — a runner keeps running what it ran", () => {
    const choice = neutralTmpBase({
      current: "/tmp",
      fallback: "/tmp",
      probe: () => undefined,
    });

    expect(choice.base).toBe("/tmp");
    expect(choice.movedFrom).toBeUndefined();
  });

  it("moves off a base that stands inside a repository, and says which one it was", () => {
    // The shape of this box: `TMPDIR` is a symlink into the contour's own checkout.
    const choice = neutralTmpBase({
      current: "/tmp/aco-1234",
      fallback: "/tmp",
      probe: (dir) => (dir === "/tmp/aco-1234" ? "/home/lle/projects/circuit" : undefined),
    });

    expect(choice.base).toBe("/tmp");
    expect(choice.movedFrom).toEqual({
      base: "/tmp/aco-1234",
      repository: "/home/lle/projects/circuit",
    });
  });

  it("refuses BY NAME when the fallback is inside a repository too, instead of going red", () => {
    // The one case where no base is honest. A silent pick here would put every fixture
    // that must not be a repository inside one — which is the whole defect of thread 098,
    // reintroduced by the fix for it.
    let thrown: unknown;
    try {
      neutralTmpBase({
        current: "/a/tmp",
        fallback: "/b/tmp",
        probe: (dir) => (dir === "/a/tmp" ? "/a" : "/b"),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TmpBaseError);
    const said = (thrown as Error).message;
    expect(said).toContain("'/a/tmp' is inside '/a'");
    expect(said).toContain("the fallback '/b/tmp' is inside '/b'");
    expect(said).toContain("TMPDIR");
  });
});

describe("the probe answers about the tree git itself would answer about", () => {
  it("names the work tree of a directory inside a repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "tmp-base-repo-"));
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const nested = join(repo, "deep", "deeper");
    mkdirSync(nested, { recursive: true });

    // Compared against git's own answer rather than against `repo`: on a box whose temp
    // base is a symlink the two spellings differ, and it is git's that the code under
    // test lives with.
    const said = spawnSync("git", ["-C", nested, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    });
    expect(enclosingRepository(nested)).toBe(said.stdout.trim());
  });

  it("answers 'none' for a directory that stands in no repository", () => {
    // AND THIS IS THE LIVE MEASUREMENT OF THE BOX: the base the setup file chose is the
    // one every fixture of this suite is built under, so if it were inside a repository
    // the eight files of thread 098 would be red again — this case names the reason once
    // instead of letting fifteen assertions guess at it.
    expect(enclosingRepository(tmpdir())).toBeUndefined();
  });
});
