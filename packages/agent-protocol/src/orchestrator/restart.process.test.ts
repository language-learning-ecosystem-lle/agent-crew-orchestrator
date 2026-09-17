/**
 * `orchestrator restart` OVER REAL PROCESSES (thread 019, statement of 2026-07-31).
 *
 * The pure half lives in `restart.test.ts`; what cannot be checked there is the only
 * thing the operator actually asked for — that the phases happen IN ORDER and that a
 * refusal in the middle leaves the circuit DOWN. Both are facts about side effects
 * (a pid that goes away, a flag file, a daemon that was or was not spawned), and a stub
 * in the place of any of them would hide exactly the failure this command exists to
 * prevent: a restart that reports success over a circuit that is not running.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  instances: [{ id: "main", roles: ["dev-core"] }],
  roles: [
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the operator",
    },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
  ],
};

/** A bare origin, a main checkout with the config, and a mail checkout on `comms`. */
const contour = (): { repo: string; origin: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-restart-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);
  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");
  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  mkdirSync(join(mail, "agent-comms"), { recursive: true });
  writeFileSync(join(mail, "agent-comms", ".keep"), "");
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, origin };
};

const state = (repo: string, ...names: string[]): string => join(repo, ".orchestrator", ...names);

const run = (
  repo: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } => {
  const done = spawnSync(TSX, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: sandbox(configHome(repo), {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@e",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@e",
    }),
  });
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
};

/**
 * A STAND-IN FOR THE RUNNING DAEMON — a process that is genuinely alive and genuinely
 * leaves. `restart` knows a daemon only as "the pid in `daemon.pid`, if `kill(pid, 0)`
 * answers", so this is the same fact the command reads, without a real daemon's ticks
 * (which would spend the test on a circuit it is not measuring).
 */
const standIn = (repo: string, seconds: number): number => {
  // ORPHANED ON PURPOSE, not spawned as a child of the test. A child of this process
  // that exits while `spawnSync` blocks the event loop stays a ZOMBIE — and a zombie
  // answers `kill(pid, 0)`, so the wait would never see it leave. Reaping it is the
  // init process's job, and orphaning it is how that job gets done here.
  const pid = Number(
    execFileSync("sh", ["-c", `sleep ${seconds} >/dev/null 2>&1 & echo $!`], {
      encoding: "utf8",
    }).trim(),
  );
  mkdirSync(state(repo), { recursive: true });
  writeFileSync(state(repo, "daemon.pid"), `${pid}\n`, "utf8");
  return pid;
};

const leftovers: number[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone — which is what most of these tests are waiting for anyway.
    }
  }
});

describe("restart raises the daemon with the flags it was stopped with", () => {
  it("waits the old one out and passes the SAVED argv, not what was typed", () => {
    const { repo } = contour();
    const pid = standIn(repo, 3);
    leftovers.push(pid);
    // What `up` would have written beside the pid. `--once` keeps the daemon this test
    // raises for real short-lived: it does one tick and leaves.
    writeFileSync(
      state(repo, "daemon.pid.args"),
      `${JSON.stringify(["--ref", "HEAD", "--once", "--max-runs", "2"])}\n`,
      "utf8",
    );

    const done = run(repo, "orchestrator", "restart", "--wait", "60");

    expect(done.status).toBe(0);
    expect(done.stdout).toContain(`stopping pid ${pid} gracefully`);
    expect(done.stdout).toMatch(/the daemon left after \d+s/);
    expect(done.stdout).toContain("flags it was stopped with");
    expect(done.stdout).toContain("--max-runs 2");
    // THE PROOF THAT `up` RAN AND RAN WITH THOSE FLAGS: it rewrites the args file from
    // the argv it actually spawned, so this is the daemon's own record, not an echo.
    expect(JSON.parse(readFileSync(state(repo, "daemon.pid.args"), "utf8"))).toEqual([
      "--ref",
      "HEAD",
      "--once",
      "--max-runs",
      "2",
    ]);
    // The stop flag `down` put there is gone — a daemon raised over it would exit on its
    // first tick, which is the live defect the operator's tail was built around.
    expect(existsSync(state(repo, "stop"))).toBe(false);
    expect(existsSync(state(repo, "enabled"))).toBe(true);
    // The phases are in the daemon's own log too: the terminal that saw them is gone by
    // the time anybody asks what happened at 04:00.
    expect(readFileSync(state(repo, "daemon.log"), "utf8")).toContain("[restart ");
    leftovers.push(Number(readFileSync(state(repo, "daemon.pid"), "utf8").trim()));
  }, 60_000);
});

describe("a refusal in the middle leaves the circuit down", () => {
  it("a daemon that will not leave within the wait raises nothing", () => {
    const { repo } = contour();
    const pid = standIn(repo, 60);
    leftovers.push(pid);
    writeFileSync(
      state(repo, "daemon.pid.args"),
      `${JSON.stringify(["--ref", "HEAD", "--once"])}\n`,
      "utf8",
    );

    const done = run(repo, "orchestrator", "restart", "--wait", "1");

    expect(done.status).toBe(1);
    expect(done.stderr).toContain("nothing was restarted");
    expect(done.stdout).toContain("STILL up");
    // NOTHING WAS RAISED: the pid file still names the stand-in, so no `up` happened...
    expect(readFileSync(state(repo, "daemon.pid"), "utf8").trim()).toBe(`${pid}`);
    // ...and the stop flag stays down — the operator asked for a restart and got a
    // circuit that is on its way down, which is what the message says.
    expect(existsSync(state(repo, "stop"))).toBe(true);
    expect(existsSync(state(repo, "daemon.log"))).toBe(true);
  }, 60_000);

  it("a failed --pull raises nothing and says why, in the log as well", () => {
    const { repo, origin } = contour();
    // The remote goes away: `git pull --ff-only` cannot succeed, which is the shape of
    // every reason a pull fails (no network, a diverged branch, a broken remote).
    rmSync(origin, { recursive: true, force: true });

    const done = run(repo, "orchestrator", "restart", "--pull", "--wait", "5");

    expect(done.status).toBe(1);
    expect(done.stdout).toContain("git pull --ff-only FAILED");
    expect(done.stdout).toContain("nothing was raised");
    expect(done.stderr).toContain("the daemon was NOT raised");
    // No daemon at all — and this is the assertion that would have caught "raise the OLD
    // code, report success".
    expect(existsSync(state(repo, "daemon.pid"))).toBe(false);
    expect(readFileSync(state(repo, "daemon.log"), "utf8")).toContain("git pull --ff-only FAILED");
  }, 60_000);
});

/**
 * THE TOOLS OF `--pull` ARE NOT ASKED OF THE CALLER'S `PATH` (thread 219, from the field
 * failure of 2026-09-17 12:23Z: `pnpm install FAILED (code ?)`, the daemon already
 * stopped, the contour down for two minutes — `pnpm` was simply not on the `PATH` of the
 * shell the restart was typed in, while `node` was called through a path the profile
 * knew).
 *
 * WHY THIS IS A PROCESS TEST AND NOT A UNIT. The decision lives in `tool-path.ts` and is
 * measured there; what cannot be measured there is the one thing that failed in the field
 * — that the REAL command forms its first candidate from the REAL interpreter. The stand
 * is the field environment reproduced: a `PATH` that carries `git` and no `pnpm` at all.
 *
 * AND THE ASSERTION HOLDS IN BOTH LAYOUTS THIS SUITE RUNS IN, deliberately: on a box
 * where the package manager sits beside node (nvm + corepack — this contour) the step
 * runs it from there, and on the runner (where `pnpm/action-setup` puts it elsewhere) the
 * same line says it looked there first and found nothing. Either way the path printed is
 * the one derived from `process.execPath`, and either way the word `PATH` is not what
 * `pnpm` was found by.
 */
describe("--pull does not depend on the PATH of whoever typed it", () => {
  it("looks for pnpm beside its own node binary, and says which premise it stands on", () => {
    const { repo } = contour();
    // A manifest with no dependencies: what makes the install phase reach an ending of
    // its own rather than fail for a reason this test is not about.
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "restart-contour", version: "0.0.0", private: true })}\n`,
    );
    git(repo, "add", "package.json");
    git(repo, "commit", "-qm", "a manifest");
    // THE SHIM EXISTS FOR ONE REASON: `tsx` is started through `#!/usr/bin/env node`, so
    // a `PATH` with no node at all would never reach the CLI. It is a symlink, and node
    // resolves it (`/proc/self/exe`) — `process.execPath` inside the child is therefore
    // the REAL binary, which is exactly the fact under test.
    const shim = mkdtempSync(join(tmpdir(), "agent-protocol-restart-path-"));
    symlinkSync(process.execPath, join(shim, "node"));
    const done = spawnSync(TSX, [CLI, "orchestrator", "restart", "--pull", "--wait", "5"], {
      cwd: repo,
      encoding: "utf8",
      env: sandbox(configHome(repo), {
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
        // git is here, pnpm is nowhere on it — the field environment, reproduced.
        PATH: `${shim}:/usr/bin:/bin`,
      }),
    });
    const stdout = done.stdout ?? "";

    expect(stdout).toContain(`pnpm install in '${repo}'`);
    // The candidate the field failure never formed: beside the interpreter that is
    // running, not beside the shell that called it.
    expect(stdout).toContain(join(dirname(process.execPath), "pnpm"));
    // And it was not found by the caller's PATH, because this PATH does not have it —
    // the premise is said out loud precisely so a restart that worked by accident and a
    // restart that works by construction cannot read the same.
    expect(stdout).not.toContain("'pnpm' (from PATH");
    // git is resolved by the same rule and reaches the step as an absolute path: the
    // second short-named call of this chain (П-3), not a second finding for later.
    expect(stdout).toMatch(new RegExp(`git pull --ff-only in '${repo}', running '/`));
    expect(stdout).toContain("git pull --ff-only — ok");

    rmSync(shim, { recursive: true, force: true });
    if (existsSync(state(repo, "daemon.pid")))
      leftovers.push(Number(readFileSync(state(repo, "daemon.pid"), "utf8").trim()));
  }, 60_000);
});

/**
 * AND THE TOOL IT FOUND IS GIVEN AN INTERPRETER (thread 219, П-1 of the statement of
 * 2026-09-17 15:49Z — the SECOND field failure of this chain, measured after the first cure
 * was live on the box):
 *
 *     pnpm install …, running '/home/…/bin/pnpm' (beside this node binary)
 *     pnpm install FAILED — '…/pnpm' ran and exited 127:
 *       /usr/bin/env: 'node': No such file or directory
 *
 * The path was right and the contour went down anyway: `pnpm` is a SCRIPT whose first line
 * is `#!/usr/bin/env node`, and the interpreter of a script is looked up by name on the
 * `PATH` OF THE CHILD. The restart was typed through `sudo -u … -i`, whose environment has
 * no nvm — so the tool started and died on its own first line.
 *
 * WHAT THE STAND REPRODUCES, AND WHY EACH PIECE IS LOAD-BEARING. A `pnpm` beside the
 * interpreter that is a REAL node script (it cannot run unless a `node` is findable from
 * its own environment), a `PATH` for the CLI process that has git and NO node at all — the
 * `sudo -i` environment, reproduced — and `process.execPath` pointed at a directory the
 * stand owns, through the preload of thread 221: a symlinked node reports the REAL
 * directory through `/proc/self/exe`, and a hardlink or a 118 MB copy of the binary is not
 * a price this suite pays.
 *
 * THE ASSERTION IS THE CHILD'S OWN `PATH`, recorded by the child. What the field failure
 * had is what this stand has: nothing on the caller's `PATH` can start that script.
 */
describe("--pull hands the tool the interpreter it is written for", () => {
  it("spawns pnpm with the directory of this node first on its PATH", () => {
    const { repo } = contour();
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "restart-contour", version: "0.0.0", private: true })}\n`,
    );
    git(repo, "add", "package.json");
    git(repo, "commit", "-qm", "a manifest");

    // WHERE THE INTERPRETER SAYS IT LIVES — and what lives beside it: a real `node`
    // (a symlink: every `process.execPath` spawn of the run, the daemon among them, must
    // still reach a real binary) and a `pnpm` that is a node script, exactly as the box's
    // own is.
    const beside = mkdtempSync(join(tmpdir(), "agent-protocol-restart-beside-"));
    symlinkSync(process.execPath, join(beside, "node"));
    const probe = join(beside, "path.txt");
    // IT RECORDS THE `PATH` IT WAS SPAWNED WITH, read off `/proc/self/environ` and not off
    // `process.env`: the preload below travels into every node this run starts, this script
    // among them, and a probe that read the mutable copy would be recording the stand's own
    // last word instead of the environment the spawn actually handed over.
    writeFileSync(
      join(beside, "pnpm"),
      "#!/usr/bin/env node\n" +
        'const fs = require("node:fs");\n' +
        'const spawnedWith = fs.readFileSync("/proc/self/environ", "utf8").split("\\0")\n' +
        '  .find((entry) => entry.startsWith("PATH=")) ?? "";\n' +
        `fs.writeFileSync(${JSON.stringify(probe)}, spawnedWith.slice("PATH=".length));\n`,
    );
    chmodSync(join(beside, "pnpm"), 0o755);
    // The `sudo -i` environment: git and nothing else. The preload states it from INSIDE
    // the CLI process, because the shell that starts `tsx` needs a node on its own `PATH`
    // and the process under test must not have one.
    const onlyGit = join(beside, "path");
    mkdirSync(onlyGit, { recursive: true });
    symlinkSync(
      execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(),
      join(onlyGit, "git"),
    );
    writeFileSync(
      join(beside, "execpath.mjs"),
      `process.execPath = ${JSON.stringify(join(beside, "node"))};\n` +
        `process.env.PATH = ${JSON.stringify(onlyGit)};\n`,
    );

    const done = spawnSync(TSX, [CLI, "orchestrator", "restart", "--pull", "--wait", "5"], {
      cwd: repo,
      encoding: "utf8",
      env: sandbox(configHome(repo), {
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
        PATH: `${beside}:${onlyGit}:/usr/bin:/bin`,
        NODE_OPTIONS: `--import ${pathToFileURL(join(beside, "execpath.mjs")).href}`,
      }),
    });
    const stdout = done.stdout ?? "";

    // THE PROOF THE FIELD CASE COULD NOT PRODUCE: the script RAN. It cannot have run
    // unless a `node` was findable from the environment it was handed, and the only `node`
    // in this stand is the one beside the interpreter.
    expect(readFileSync(probe, "utf8").split(":")[0]).toBe(beside);
    expect(stdout).toContain("pnpm install — ok");
    // ...and not the ending of 15:49Z, which is what this stand produces without the cure.
    expect(stdout).not.toContain("No such file or directory");
    expect(stdout).not.toContain("pnpm install FAILED");
    expect(done.status).toBe(0);

    rmSync(beside, { recursive: true, force: true });
    if (existsSync(state(repo, "daemon.pid")))
      leftovers.push(Number(readFileSync(state(repo, "daemon.pid"), "utf8").trim()));
  }, 60_000);
});

/**
 * THE VERSION GATE IS NOT THIS COMMAND'S (thread 055, task 055.3).
 *
 * john's repro, verbatim (2026-08-05, live on the box): the repository ahead of the
 * package — `restart --pull` died with `restart required: … this build is behind the
 * data (pull and restart what is running on it)`, exit 2, nothing restarted. The
 * sentence names the repair and kills the command that performs it.
 *
 * The config here is ahead AND carries a field this build has never heard of, because
 * that is what a bump normally looks like and because it is the half a gate-only
 * exemption would have missed.
 */
describe("a restart is the healer, not a reader of the canon", () => {
  const ahead = (repo: string): void => {
    // `--pull` runs `pnpm install` after the pull, and the contour is a bare git
    // repository: a manifest with no dependencies is what makes that phase reach its
    // "ok" instead of failing for a reason this test is not about.
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "restart-contour", version: "0.0.0", private: true })}\n`,
    );
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify(
        {
          ...CONFIG,
          protocolVersion: CURRENT_PROTOCOL_VERSION + 1,
          somethingTheNextVersionAdded: { whatever: true },
        },
        null,
        2,
      )}\n`,
    );
    // The config alone: the mail checkout lives inside this repo, and `add .` would
    // stage it as a would-be submodule.
    git(repo, "add", "agent-protocol.json", "package.json");
    git(repo, "commit", "-qm", "the bump this build has not caught up with");
    git(repo, "push", "-q", "origin", "main");
  };

  it("--pull goes through a repository ahead of the package, and says the skew", () => {
    const { repo } = contour();
    ahead(repo);

    const done = run(repo, "orchestrator", "restart", "--pull", "--wait", "5");

    expect(done.status).toBe(0);
    // The skew is SAID — a restart quietly working around a shape it does not
    // understand would be the silence this package exists against.
    expect(done.stdout).toContain(`declares protocol version ${CURRENT_PROTOCOL_VERSION + 1}`);
    expect(done.stdout).toContain("orchestrator.state");
    // AND SAID ONCE (the reviewer's finding on PR #202, measured with `grep -c`: three).
    // `restart` resolves the paths three times — before phase 1, inside `down`, inside
    // `up` — and three identical lines among the phases read as three discoveries; the
    // next person's first question is which of them was the real one. Counting rather
    // than `toContain` is the point of the assertion: the old one passed at three.
    expect(
      done.stdout.split("\n").filter((line) => line.includes("declares protocol version")).length,
    ).toBe(1);
    expect(done.stdout).toContain("git pull --ff-only — ok");
    // The circuit is back up over the fresh code: the flags are down, the daemon was
    // spawned. This is the assertion the defect failed at exit 2.
    expect(existsSync(state(repo, "stop"))).toBe(false);
    expect(existsSync(state(repo, "daemon.pid"))).toBe(true);
    leftovers.push(Number(readFileSync(state(repo, "daemon.pid"), "utf8").trim()));
  }, 60_000);

  it("but a data command on the same repository still refuses, by the same door", () => {
    const { repo } = contour();
    ahead(repo);

    const done = run(repo, "orchestrator", "status", "--ref", "HEAD", "--no-fetch");

    expect(done.status).not.toBe(0);
    expect(`${done.stdout}${done.stderr}`).toContain("restart required");
  }, 60_000);
});
