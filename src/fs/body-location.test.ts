/**
 * THE WIRING OF THE BODY LOCATION DOOR — against a real git, which is the half
 * `merge/pr-open.test.ts` cannot cover (thread `170-mail-body-inside-checkout`).
 *
 * The predicate's own table of cases lives there and is not copied here: what is on trial
 * in this file is that the two git calls answer the predicate's two questions correctly on
 * a real repository — including the two edges where a wrong reading opens the door
 * silently, the ignored path (must PASS, or every role's `mktemp -d` starts refusing) and
 * git's inability to answer at all (must REFUSE, or a broken git disarms the guard).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { bodyFileLocation } from "./body-location.js";

/** A directory outside every checkout — `/tmp` is where a body file belongs. */
const outside = (): string => mkdtempSync(join(tmpdir(), "agent-protocol-bodyloc-"));

/** A repository with one commit, so that `.gitignore` is a tracked fact of it. */
const repoWith = (ignores?: string): string => {
  const repo = outside();
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  if (ignores !== undefined) writeFileSync(join(repo, ".gitignore"), `${ignores}\n`);
  writeFileSync(join(repo, "README.md"), "base\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "base",
  ]);
  return repo;
};

describe("bodyFileLocation — the shared wiring of the door (thread 170)", () => {
  it("REFUSES a body inside a checkout that nothing ignores, naming the path and the way out", () => {
    const repo = repoWith();
    const path = join(repo, ".body.md");
    writeFileSync(path, "the body\n");

    const verdict = bodyFileLocation(path);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toContain(path);
    expect(verdict.refusal).toContain("lies inside the git checkout");
    expect(verdict.refusal).toContain("mktemp -d -p /tmp");
  });

  it("PASSES a body the checkout ignores — the session's own temp directory is one", () => {
    // `.orchestrator/` is what the served repository ignores in the field, and the run's
    // `TMPDIR` lives under it. The fault is not «a file in a tree», it is «a file `git
    // pull --ff-only` refuses to write over», and git does not refuse over an ignored one.
    const repo = repoWith(".orchestrator/");
    const dir = join(repo, ".orchestrator", "sessions", "r.tmp");
    execFileSync("mkdir", ["-p", dir]);
    const path = join(dir, "body.md");
    writeFileSync(path, "the body\n");

    expect(bodyFileLocation(path)).toEqual({ ok: true });
  });

  it("PASSES a body outside every checkout — the normal path of every writer", () => {
    const path = join(outside(), "body.md");
    writeFileSync(path, "the body\n");

    expect(bodyFileLocation(path)).toEqual({ ok: true });
  });

  it("REFUSES when git could not answer at all — trouble is not a synonym for 'no checkout'", () => {
    // The directory does not exist, so git fails without ever saying «not a git
    // repository»: the one failure the door must not read as PASS.
    const path = join(outside(), "no-such-dir", "body.md");

    const verdict = bodyFileLocation(path);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toContain("git could not say");
    expect(verdict.refusal).toContain(path);
  });
});
