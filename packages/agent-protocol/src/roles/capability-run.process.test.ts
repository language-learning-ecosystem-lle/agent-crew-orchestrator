/**
 * THE PROCESS TEST OF `capability run` — the layer BETWEEN the door and the runner, which the unit
 * tests of `capability-run.test.ts` cannot reach by construction: they hand `runCapabilityCall` a
 * world that is already built, and everything that builds it lives in `cli.ts` — the role looked up
 * by `--role`, the flags parsed into a call, `spawnSync` wired to the runner, `git status
 * --porcelain` wired to the reader of a checkout, the trace path taken from `pathsFrom`, the
 * identity the trace records, and `process.exit(1)` on a refusal.
 *
 * That gap is where this package has been bitten before (the `--paths` scope of thread 033, the
 * `GIT_DIR` of the zones door): the verdict underneath was right every time and the values handed
 * to it were not. The reviewer of #141 named it as the class rather than as a taste — every other
 * command of the CLI has a `*.process.test.ts`, and the hand-run acceptance that stood in for one
 * here closed it once, on a box, without leaving anything that fails on the next change.
 *
 * SO THE CLI IS STARTED AS A REAL PROCESS, against a real config read from a real ref, and what is
 * asserted is what only a process has: exit codes, the two streams apart from each other, the file
 * that appears on disk (or does not), and the identity written into it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";
import { resolveCapabilityCall } from "./capability-call.js";
import { type Role, roleSchema } from "./schema.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * A box laid out as three siblings: the repository the config is read from, the checkout
 * `repo-refresh` is declared to aim at, and the log `log-tail` is declared to read. The two
 * targets are TEMPORARY ABSOLUTE PATHS, so the config is written per test rather than kept as a
 * constant — a closed list is a list of values, and the values here are what the box has.
 */
const box = (): { repo: string; checkout: string; log: string; trace: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-capability-"));
  const repo = join(base, "work");
  const checkout = join(base, "checkout");
  const log = join(base, "daemon.log");

  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(log, "one\ntwo\nthree\nfour\n", "utf8");

  // The checkout is a git repository with a commit and NO REMOTE: `git pull --ff-only` there
  // fails by the box's own words, which is how the failed-step branch is reached without a
  // network and without a second step that would install a tree of packages into a temp dir.
  execFileSync("git", ["init", "-q", "-b", "main", checkout]);
  writeFileSync(join(checkout, "a.txt"), "a\n", "utf8");
  git(checkout, "add", "-A");
  git(checkout, "commit", "-qm", "base");

  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(
      {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        mail: { branch: "comms", dir: "agent-comms" },
        orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
        roles: [
          {
            id: "devops",
            kind: "claude-code",
            status: "planned",
            wake: { mode: "watch", session: "crew-devops" },
            summary: "operational role of the box",
            capabilities: [
              { name: "log-tail", logs: [log], maxLines: 200 },
              { name: "repo-refresh", checkouts: [checkout] },
              { name: "disk-free" },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "config");
  return { repo, checkout, log, trace: join(repo, ".orchestrator", "capabilities.log") };
};

/** The role as the config declares it — for building the door's own words to compare against. */
const declared = (input: { checkout: string; log: string }): Role =>
  roleSchema.parse({
    id: "devops",
    kind: "claude-code",
    status: "planned",
    wake: { mode: "watch", session: "crew-devops" },
    summary: "operational role of the box",
    capabilities: [
      { name: "log-tail", logs: [input.log], maxLines: 200 },
      { name: "repo-refresh", checkouts: [input.checkout] },
      { name: "disk-free" },
    ],
  });

/**
 * ONE LAUNCH, WITH THE STREAMS KEPT APART. The refusal of the door is a claim about stderr
 * specifically — a test that concatenated the two could not tell "printed whole on stderr" from
 * "half of it leaked into the report".
 */
const run = (
  repo: string,
  args: readonly string[],
  extra: NodeJS.ProcessEnv = {},
): { code: number; out: string; err: string } => {
  const said = spawnSync(
    TSX,
    [CLI, "capability", "run", "--ref", "HEAD", "--repo", repo, ...args],
    {
      encoding: "utf8",
      env: sandbox(configHomeInside(repo), extra),
    },
  );
  return { code: said.status ?? -1, out: said.stdout ?? "", err: said.stderr ?? "" };
};

describe("capability run — the surface as a process", () => {
  it("a role the config does not declare is refused by name, before any capability is looked at", () => {
    const { repo } = box();

    const result = run(repo, ["--role", "nobody", "--capability", "disk-free"]);

    expect(result.code).toBe(2);
    expect(`${result.out}${result.err}`).toContain("--role 'nobody'");
    expect(`${result.out}${result.err}`).toContain("there is no such role in the config");
  });

  it("a --lines that is not a number at all is refused HERE, because the door could say nothing true about NaN", () => {
    const { repo } = box();

    const result = run(repo, [
      "--role",
      "devops",
      "--capability",
      "log-tail",
      "--target",
      join(repo, "..", "daemon.log"),
      "--lines",
      "many",
    ]);

    expect(result.code).toBe(2);
    expect(`${result.out}${result.err}`).toContain("--lines 'many' is not a number");
  });

  it("a FRACTIONAL --lines travels to the door instead — the argument guard does not answer it", () => {
    // The division decided when this surface was written: a number the door can talk about is the
    // door's to refuse (it names the verb, the ceiling and the repair); only a non-number is this
    // layer's. Asserted through the process, because the split lives in the parsing layer.
    const { repo, log } = box();

    const result = run(repo, [
      "--role",
      "devops",
      "--capability",
      "log-tail",
      "--target",
      log,
      "--lines",
      "2.5",
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain("asked 'log-tail' for '2.5' lines");
    expect(result.err).toContain("a tail is a whole number of lines and at least one");
  });

  it("the door's refusal reaches stderr VERBATIM, and stdout carries nothing", () => {
    const { repo, checkout, log } = box();

    const result = run(repo, [
      "--role",
      "devops",
      "--capability",
      "log-tail",
      "--target",
      "/etc/shadow",
    ]);

    const door = resolveCapabilityCall({
      role: declared({ checkout, log }),
      call: { name: "log-tail", target: "/etc/shadow" },
    });
    expect(door.ok).toBe(false);
    if (door.ok) return;
    // Byte for byte, not "contains the important part": the worth of the door is in its words,
    // and a surface free to trim them is a surface that will.
    expect(result.err.trim()).toBe(door.refusal);
    expect(result.out).toBe("");
    expect(result.code).toBe(1);
  });

  it("a declared read runs for real, its OWN output comes first, and it leaves no trace file", () => {
    const { repo, trace } = box();

    const result = run(repo, ["--role", "devops", "--capability", "disk-free"]);

    expect(result.code).toBe(0);
    // `df -h` itself, not this command's rendering of it: a percentage column, in any locale.
    expect(result.out).toMatch(/\d+%/);
    expect(result.out).toContain("step 1 ok: df -h");
    expect(result.out.indexOf("%")).toBeLessThan(result.out.indexOf("capability 'disk-free'"));
    // A READ LEAVES NOTHING. The file does not exist at all — the surface did not create it
    // empty, and it printed no "trace: <path>" pointing at a file with nothing about this call.
    expect(existsSync(trace)).toBe(false);
    expect(result.out).not.toContain("trace:");
  });

  it("without --write the state-changing verb prints a plan, touches no tree and writes no trace", () => {
    const { repo, checkout, trace } = box();
    writeFileSync(join(checkout, "a.txt"), "moved by nobody\n", "utf8");

    const result = run(repo, [
      "--role",
      "devops",
      "--capability",
      "repo-refresh",
      "--target",
      checkout,
    ]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Pass --write to run it");
    expect(result.out).toContain(`step 1: git -C ${checkout} pull --ff-only`);
    expect(existsSync(trace)).toBe(false);
    // The dirty file is still dirty and still the caller's: a plan does not look at the tree,
    // so it cannot have refused it either.
    expect(readFileSync(join(checkout, "a.txt"), "utf8")).toBe("moved by nobody\n");
  });

  it("a dirty checkout is refused by the REAL 'git status --porcelain', and nothing is written", () => {
    const { repo, checkout, trace } = box();
    writeFileSync(join(checkout, "a.txt"), "somebody's uncommitted work\n", "utf8");

    const result = run(repo, [
      "--role",
      "devops",
      "--capability",
      "repo-refresh",
      "--target",
      checkout,
      "--write",
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain("the checkout holds uncommitted work");
    // The entries come out of git's own porcelain — that wiring is what only a process shows.
    expect(result.err).toContain("a.txt");
    expect(readFileSync(join(checkout, "a.txt"), "utf8")).toBe("somebody's uncommitted work\n");
    // NOTHING WAS DONE TO THE BOX, so there is nothing to record: a refusal at the door is not
    // a call that happened.
    expect(existsSync(trace)).toBe(false);
  });

  it("a failed step stops the next one, and the trace is written anyway — with the OS's answer for 'by'", () => {
    // The checkout has no remote, so step 1 fails by the box's own words; step 2 (`pnpm install`)
    // must not run. And the identity in the trace is asked of the OS: `USER`/`LOGNAME` are set
    // here to a value nobody is, exactly as the hand typing the command could set them, and the
    // record must not repeat them back. That was the reviewer's finding on #141 — a field whose
    // source the caller writes cannot carry the promise "an outsider establishes WHO".
    const { repo, checkout, trace } = box();

    const result = run(
      repo,
      ["--role", "devops", "--capability", "repo-refresh", "--target", checkout, "--write"],
      { USER: "not-the-one-who-ran-it", LOGNAME: "not-the-one-who-ran-it" },
    );

    expect(result.code).toBe(1);
    expect(result.err).toContain("step 1 of 2 failed");
    expect(result.err).toContain("The remaining 1 step(s) did NOT run");
    expect(result.err).toContain("pnpm --dir");

    const line = readFileSync(trace, "utf8").trim();
    expect(line).toContain("FAILED at step 1 of 2");
    expect(line).toContain(`capability repo-refresh · role devops · target ${checkout}`);
    expect(line).toContain(`by ${userInfo().username}`);
    expect(line).not.toContain("not-the-one-who-ran-it");
  });
});
