/**
 * The picker of `testing/git-env.ts` read three ways: what it takes out, what it must NOT
 * take out, and the two things that are not about one name at all — that it stays a superset
 * of the product's own hook list, and that the suite is actually wired to it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { GIT_HOOK_ENV_KEYS } from "../fs/git-env.js";
import { gitEnvOutsideLauncher, scrubbedGitEnvNames } from "./git-env.js";

describe("the environment a git call of this suite is made in", () => {
  it("takes out the name that makes -C answer about another tree", () => {
    const env = { GIT_DIR: "/elsewhere/.git", PATH: "/usr/bin" };
    expect(scrubbedGitEnvNames(env)).toEqual(["GIT_DIR"]);
    expect(gitEnvOutsideLauncher(env)).toEqual({ PATH: "/usr/bin" });
  });

  it("takes the counted config pairs out WITH the count", () => {
    const env = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_0: "!f() { … }; f",
      GIT_CONFIG_GLOBAL: "/home/someone/.gitconfig",
    };
    expect(gitEnvOutsideLauncher(env)).toEqual({});
  });

  it("leaves a name that does not change what git answers", () => {
    const env = {
      GIT_EDITOR: "true",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "someone",
      GIT_COMMITTER_EMAIL: "someone@example.com",
      GIT_TRACE: "1",
    };
    expect(scrubbedGitEnvNames(env)).toEqual([]);
    expect(gitEnvOutsideLauncher(env)).toEqual(env);
  });

  it("names only the variables that are actually set", () => {
    expect(scrubbedGitEnvNames({ PATH: "/usr/bin" })).toEqual([]);
  });

  it("does not mutate the environment it was given", () => {
    const env = { GIT_DIR: "/elsewhere/.git" };
    gitEnvOutsideLauncher(env);
    expect(env).toEqual({ GIT_DIR: "/elsewhere/.git" });
  });

  /**
   * ONE LIST, TWO READERS. The product's door (`fs/git-env.ts`) removes the four names a
   * git hook exports; this suite removes those and more. The direction is the whole point:
   * wider is allowed and narrower is the drift — a name added to the door and forgotten
   * here would leave every process test talking to the hook's tree again.
   */
  it("removes every name the product's hook door removes", () => {
    const env = Object.fromEntries(GIT_HOOK_ENV_KEYS.map((name) => [name, "x"]));
    expect(gitEnvOutsideLauncher(env)).toEqual({});
  });

  /**
   * THE WIRING, read out of the config itself rather than restated here: a scrub that no
   * `setupFiles` entry names is a module that runs in no run at all, and every other test
   * of this file would go on passing.
   */
  it("is wired into the suite as a setup file", () => {
    const config = readFileSync(
      fileURLToPath(new URL("../../vitest.config.ts", import.meta.url)),
      "utf8",
    );
    const setup = /setupFiles:\s*\[([^\]]*)\]/.exec(config);
    expect(setup?.[1]).toContain("./src/testing/git-env.setup.ts");
  });
});
