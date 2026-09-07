/**
 * THE REPOSITORY MEASURED AGAINST ITS OWN DAEMON (003). Everything else in this package
 * is asserted on a fixture; this one asserts a fact about THIS checkout, because that is
 * where the defect lived: `selfRestartVerdict` stands on a dirty tree BEFORE it chooses a
 * form of repair — so a runtime directory of the orchestrator left un-ignored makes every
 * box serving this repository meet a merge into `main` with a daemon that calls its own
 * workspaces dirt.
 *
 * SINCE THREAD 153 THAT IS NO LONGER THE ONLY DOOR THIS RULE HOLDS OPEN, and the narrowing
 * is not a reason to relax it. `workingTreeState` now counts an untracked path as dirt only
 * when the incoming commits would write it, so an un-ignored `.orchestrator/` would usually
 * survive a tick — but "usually" is the word: the day a commit adds a tracked file under one
 * of these paths it is a refusal again, and every OTHER door over a working tree (a role's
 * workplace, R17) still reads the whole of `git status`. The rule is the same rule.
 *
 * The paths are not typed here twice: they are read from `agent-protocol.json`, so renaming
 * 'orchestrator.state' or 'orchestrator.workdir.worktrees' without touching `.gitignore`
 * fails HERE, by name, instead of on the box eleven hours later.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

const runtimePaths = (): readonly { readonly key: string; readonly path: string }[] => {
  const config = JSON.parse(readFileSync(new URL("agent-protocol.json", `file://${REPO}`), "utf8"));
  return [
    { key: "orchestrator.state", path: config.orchestrator.state },
    { key: "orchestrator.workdir.worktrees", path: config.orchestrator.workdir.worktrees },
  ];
};

/**
 * The rule `.gitignore` matches a path with, or the reason there is none. The path is asked
 * about WITH ITS TRAILING SLASH — the spelling `git status --porcelain` itself uses for an
 * untracked directory ('?? .orchestrator/'), and the only one that answers on a checkout
 * where the directory does not exist yet: a directory-only pattern matches nothing else
 * there, so asking without the slash would fail on CI and pass on a box that has run.
 */
const ignoreRuleFor = (path: string): { readonly rule: string } | { readonly problem: string } => {
  try {
    const said = execFileSync("git", ["-C", REPO, "check-ignore", "-v", "--", `${path}/`], {
      encoding: "utf8",
    });
    return { rule: said.trim() };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return { problem: `no rule in .gitignore matches '${path}'` };
    return { problem: (error as Error).message.replace(/\s+/g, " ").trim() };
  }
};

describe("the orchestrator's runtime in this repository", () => {
  it("names both runtime directories in the config", () => {
    expect(runtimePaths()).toEqual([
      { key: "orchestrator.state", path: ".orchestrator" },
      { key: "orchestrator.workdir.worktrees", path: ".worktrees" },
    ]);
  });

  for (const { key, path } of runtimePaths()) {
    it(`is ignored by git: '${path}' (${key})`, () => {
      const verdict = ignoreRuleFor(path);
      // The failure names what breaks, not just which assertion failed: a bare
      // 'expected false to be true' about a .gitignore entry is a door that says nothing.
      if ("problem" in verdict) {
        throw new Error(
          `${verdict.problem} — '${path}' is ${key} in agent-protocol.json, it exists on ` +
            "every box that raises a role here, and un-ignored it makes the daemon STAND " +
            "with 'dirty' instead of restarting itself onto the merged code (003).",
        );
      }
      expect(verdict.rule).toContain(".gitignore");
    });
  }
});
