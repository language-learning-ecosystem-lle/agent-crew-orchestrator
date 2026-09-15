/**
 * THE SCRUB MEASURED THE ONLY WAY IT CAN BE (thread `180-selfheal-leaves-the-workspaces-behind`).
 *
 * The premise this file is about — `GIT_DIR` and a `GIT_CONFIG_*` pair standing in the
 * environment OF THE PROCESS — cannot be set from inside a test that then checks the fix:
 * `setupFiles` has already run by the time a test module is loaded, so a test that sets
 * `process.env.GIT_DIR` itself would rewrite the victim with the fix perfectly in place and
 * report the fix as broken. So the poisoned environment is handed to a CHILD at launch, and
 * the child does what a process test of this package does: `git -C <its own tree> …`.
 *
 * Three facts on disk, not "no error was thrown":
 *
 *   (i)   the victim repository's `remote.origin.url` is untouched;
 *   (ii)  the tree the child NAMED with `-C` got the remote — without this, a git that never
 *         ran at all would read as a pass;
 *   (iii) the config pair injected through the environment is in no answer git gives the
 *         child.
 *
 * And a control in the same shape: the same child with the scrub NOT imported writes into
 * the victim. It is there so that (i) cannot go green because the mechanism stopped
 * reproducing on a newer git — a test of a defence is worth what its defeat costs to
 * demonstrate.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));
const SETUP = pathToFileURL(fileURLToPath(new URL("./git-env.setup.ts", import.meta.url))).href;

const ORIGINAL = "https://original.example/victim.git";
const PLACEHOLDER = "https://placeholder.example/target.git";
const NAMED = "https://named.example/target.git";
const INJECTED_KEY = "test.injectedbytheenvironment";
const INJECTED_VALUE = "the launcher's own config";

/**
 * A repository with a remote already set. Both fixtures are built this way and the child
 * only ever RE-POINTS one (`remote set-url`, never `remote add`): with `remote add` the
 * hijacked call would die on "remote origin already exists" instead of writing, and the
 * control would then be measuring git's refusal rather than the redirection the scrub
 * exists to stop.
 */
const repositoryWithRemote = (at: string, url: string): string => {
  mkdirSync(at, { recursive: true });
  execFileSync("git", ["-C", at, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", at, "remote", "add", "origin", url]);
  return at;
};

const remoteOf = (repo: string): string =>
  execFileSync("git", ["-C", repo, "config", "--get", "remote.origin.url"], {
    encoding: "utf8",
  }).trim();

/**
 * A child that calls git about a tree it names itself, with the suite's scrub loaded the
 * way `vitest.config.ts` loads it — as a module imported before anything else runs.
 */
const childSource = (withScrub: boolean): string =>
  [
    `${withScrub ? `import ${JSON.stringify(SETUP)};` : "// the control: no scrub"}`,
    'import { execFileSync } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    "const [target, report] = process.argv.slice(2);",
    `execFileSync("git", ["-C", target, "remote", "set-url", "origin", ${JSON.stringify(NAMED)}]);`,
    'const list = execFileSync("git", ["-C", target, "config", "--list"], { encoding: "utf8" });',
    "writeFileSync(report, list);",
  ].join("\n");

type Launch = { readonly victim: string; readonly target: string; readonly seen: string };

/** One launch of the child under a poisoned environment; returns where to look afterwards. */
const launch = (withScrub: boolean): Launch => {
  const base = mkdtempSync(join(tmpdir(), "git-env-"));
  const victim = repositoryWithRemote(join(base, "victim"), ORIGINAL);
  const target = repositoryWithRemote(join(base, "target"), PLACEHOLDER);

  const script = join(base, "child.ts");
  writeFileSync(script, childSource(withScrub));
  const report = join(base, "seen.txt");

  execFileSync(TSX, [script, target, report], {
    env: {
      ...process.env,
      GIT_DIR: join(victim, ".git"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: INJECTED_KEY,
      GIT_CONFIG_VALUE_0: INJECTED_VALUE,
    },
    encoding: "utf8",
  });

  return { victim, target, seen: readFileSync(report, "utf8") };
};

describe("a git call of this suite against the tree it named", () => {
  it("writes into the named tree and not into the GIT_DIR of whoever launched the run", () => {
    const { victim, target, seen } = launch(true);

    expect(remoteOf(victim)).toBe(ORIGINAL);
    expect(remoteOf(target)).toBe(NAMED);
    expect(seen).not.toContain(INJECTED_KEY);
  });

  it("CONTROL: the same child without the scrub writes into the launcher's GIT_DIR", () => {
    const { victim, target, seen } = launch(false);

    expect(remoteOf(victim)).toBe(NAMED);
    expect(remoteOf(target)).toBe(PLACEHOLDER);
    expect(seen).toContain(INJECTED_KEY);
  });
});
