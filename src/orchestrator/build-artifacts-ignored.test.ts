/**
 * THE REPOSITORY MEASURED AGAINST ITS OWN BUILD (049) — the sibling of
 * `runtime-ignored.test.ts`, which measures it against its own daemon. Same
 * consequence, different producer: there the untracked path is made by the orchestrator,
 * here it is made by the compiler.
 *
 * `tsc --build` writes `<tsconfig without .json>.tsbuildinfo` next to the config it built
 * — and it does so even under `noEmit: true`, which is why plain `tsc` (`pnpm typecheck`)
 * leaves the tree clean and the defect only showed on the takes where a role actually
 * BUILT. Un-ignored, that file makes the role's workspace dirty, and a dirty tree is a
 * refusal to raise the role on the next take (R17) that a human then has to clear by hand:
 * an ordinary build switched the role off until someone tidied up.
 *
 * The names are not typed here twice: every tracked `tsconfig*.json` is asked for, and its
 * artifact name is derived from it. So a package added — or a config renamed — without
 * touching `.gitignore` fails HERE, by name, instead of on the box as a role that will not
 * start.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

const git = (...args: readonly string[]): string =>
  execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });

/**
 * Every tsconfig this repository tracks, paired with the artifact `tsc --build` would write
 * beside it. The list is read from git rather than from a directory walk on purpose: an
 * untracked tsconfig produces no artifact anybody's checkout has to carry, and `node_modules`
 * is full of configs that are not ours.
 */
const buildArtifacts = (): readonly { readonly tsconfig: string; readonly artifact: string }[] =>
  git("ls-files", "--", "*tsconfig*.json")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((tsconfig) => ({ tsconfig, artifact: tsconfig.replace(/\.json$/, ".tsbuildinfo") }));

/**
 * The rule `.gitignore` matches the artifact with, or the reason there is none. Asked WITHOUT
 * a trailing slash — unlike the runtime directories of the sibling test, this is a file, and
 * `git check-ignore` answers about a path that does not exist yet only if it is spelled the
 * way `git status --porcelain` would spell it.
 */
const ignoreRuleFor = (path: string): { readonly rule: string } | { readonly problem: string } => {
  try {
    return { rule: git("check-ignore", "-v", "--", path).trim() };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return { problem: `no rule in .gitignore matches '${path}'` };
    return { problem: (error as Error).message.replace(/\s+/g, " ").trim() };
  }
};

describe("the build artifacts of this repository", () => {
  it("finds every tracked tsconfig — both packages and the shared base", () => {
    expect(buildArtifacts().map((entry) => entry.tsconfig)).toEqual([
      "packages/agent-protocol/tsconfig.json",
      "packages/transport-telegram/tsconfig.json",
      "tsconfig.base.json",
    ]);
  });

  for (const { tsconfig, artifact } of buildArtifacts()) {
    it(`is ignored by git: '${artifact}' (from ${tsconfig})`, () => {
      const verdict = ignoreRuleFor(artifact);
      // The failure names what breaks, not just which assertion failed: a bare
      // 'expected false to be true' about a .gitignore entry is a door that says nothing.
      if ("problem" in verdict) {
        throw new Error(
          `${verdict.problem} — '${artifact}' is what \`tsc --build\` writes beside ` +
            `'${tsconfig}' (even under noEmit), so un-ignored it makes the workspace of ` +
            "every role that builds this package dirty, and a dirty tree is a refusal to " +
            "raise that role on the next take (R17) which a human has to clear by hand.",
        );
      }
      expect(verdict.rule).toContain(".gitignore");
    });
  }
});
