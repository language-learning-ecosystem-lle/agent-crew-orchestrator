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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
