/**
 * The three outcomes of the choice, the two of the probe, and one measurement of the live box.
 *
 * The probe is injected, so the branches are stated rather than reproduced — a box whose
 * `TMPDIR` happens to be neutral could not otherwise exercise the moving branch at all,
 * and a runner is exactly such a box. The same holds one level down for the probe's own
 * launch (thread `120`): a box that runs this suite has git, so «git never ran» is asserted
 * from a launch record, plus one modelled spawn with `PATH` pointing at nothing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  enclosingRepository,
  enclosingRepositoryOfLaunch,
  neutralTmpBase,
  TmpBaseError,
} from "./tmp-base.js";

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

describe("a probe that could not run does not answer 'no repository' (thread 120)", () => {
  // The reading of one launch is separated from the launch itself, so these four branches
  // are STATED here rather than reproduced: the box that runs this suite has git — the
  // contour that raised the suite is a checkout — and a box without it is not a box this
  // suite is asked to survive on.

  it("names the work tree when git answered with one", () => {
    expect(
      enclosingRepositoryOfLaunch("/some/dir", { status: 0, stdout: "/home/lle/circuit\n" }),
    ).toBe("/home/lle/circuit");
  });

  it("reads git's OWN 'no' as 'no' — exit 128 outside a work tree is an answer", () => {
    expect(enclosingRepositoryOfLaunch("/some/dir", { status: 128, stdout: "" })).toBeUndefined();
  });

  it("refuses BY NAME when the launch never happened, and says what could not be asked", () => {
    let thrown: unknown;
    try {
      enclosingRepositoryOfLaunch("/some/dir", {
        status: null,
        error: Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" }),
      });
    } catch (error) {
      thrown = error;
    }

    // The whole point of the case: the same shape of return as the honest 'no' above, and
    // a different word out of it.
    expect(thrown).toBeInstanceOf(TmpBaseError);
    const said = (thrown as Error).message;
    expect(said).toContain("'/some/dir'");
    expect(said).toContain("spawnSync git ENOENT");
    expect(said).toContain("NOT the answer 'no repository'");
    expect(said).toContain("PATH");
  });

  it("refuses when the probe was killed instead of answering, and names the signal", () => {
    let thrown: unknown;
    try {
      enclosingRepositoryOfLaunch("/some/dir", { status: null, signal: "SIGKILL", stdout: "" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TmpBaseError);
    expect((thrown as Error).message).toContain("SIGKILL");
  });

  it("carries through the real spawn: with no git on PATH the probe refuses, not 'none'", () => {
    // The one modelled measurement — `PATH` of a single spawn, not a box without git. The
    // control is the case above it in this file: the same call under the box's own `PATH`
    // answers `undefined` for exactly this directory.
    const noGitHere = mkdtempSync(join(tmpdir(), "tmp-base-no-git-"));
    const restore = process.env.PATH;
    let thrown: unknown;
    try {
      process.env.PATH = noGitHere;
      enclosingRepository(tmpdir());
    } catch (error) {
      thrown = error;
    } finally {
      process.env.PATH = restore;
    }

    expect(thrown).toBeInstanceOf(TmpBaseError);
    expect((thrown as Error).message).toContain(tmpdir());
  });
});
