/**
 * `up --foreground` AND THE FLAGS, OVER REAL PROCESSES (thread 019, systemd).
 *
 * The pure half is `systemd.test.ts`. What cannot be checked there is the only property
 * the unit rests on: THE EXIT CODE. `Restart=on-failure` re-raises a non-zero exit, so
 * "the daemon leaves cleanly when a flag is on the floor" is what keeps a stop from
 * turning into a restart loop — and it is a fact about a process, not about a return
 * value. The same run also proves the foreground mode is a foreground mode: the process
 * that is watched is the daemon, and it wrote its own pid.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-foreground-"));
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
  // WHO THIS BOX IS (R14): without it the scope of the run does not resolve and the
  // daemon refuses at the door — which would hide the exit code this file measures.
  const xdg = join(configHome(repo), "agent-protocol");
  mkdirSync(xdg, { recursive: true });
  writeFileSync(join(xdg, "local.json"), `${JSON.stringify({ instance: "main" })}\n`, "utf8");
  return repo;
};

const state = (repo: string, ...names: string[]): string => join(repo, ".orchestrator", ...names);

/** The agent binary the preflight probes — a real file, so the daemon starts at all. */
const EXEC = ["--exec", "/bin/echo"];

const runUnder = (repo: string, extra: NodeJS.ProcessEnv, ...args: string[]) => {
  const done = spawnSync(TSX, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 90_000,
    env: sandbox(configHome(repo), {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@e",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@e",
      ...extra,
    }),
  });
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
};

const run = (repo: string, ...args: string[]) => runUnder(repo, {}, ...args);

describe("a flag on the floor beats the restart policy", () => {
  it("a force flag refuses the foreground start CLEANLY — nothing raised, exit 0", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });
    writeFileSync(state(repo, "force"), JSON.stringify({ by: "john", note: "acceptance" }), "utf8");

    const done = run(repo, "orchestrator", "up", "--foreground", "--once");

    // Exit 0 is the whole point: 'Restart=on-failure' does not fire on it, so the flag
    // keeps the circuit down instead of being re-read every RestartSec forever.
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("NOT a failure");
    expect(done.stdout).toContain("john: acceptance");
    // Nothing was raised: no daemon wrote its pid, and the flag was left where it was.
    expect(existsSync(state(repo, "daemon.pid"))).toBe(false);
    expect(existsSync(state(repo, "force"))).toBe(true);
  });

  it("in a terminal the same refusal keeps its code 2", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });
    writeFileSync(state(repo, "force"), JSON.stringify({ by: "john", note: "acceptance" }));

    const done = run(repo, "orchestrator", "up");

    expect(done.status).toBe(2);
    expect(existsSync(state(repo, "daemon.pid"))).toBe(false);
  });

  it("a stop flag under a running daemon is a CLEAN exit, not a crash", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });
    writeFileSync(state(repo, "stop"), "", "utf8");

    // The daemon itself, not `up` — `up` clears the stop flag left by `down`, and what
    // the unit depends on is the loop's own verdict on a flag it finds at a tick.
    const done = run(repo, "orchestrator", "daemon", "--ref", "HEAD", "--once", ...EXEC);

    expect(done.status).toBe(0);
    expect(`${done.stdout}${done.stderr}`).toContain("the daemon stopped — the stop flag");
  });
});

/**
 * THE DOOR OVER A LIVING DAEMON, MEASURED AS A PROCESS (thread 141). The sentence itself
 * is pinned in `systemd.test.ts`; what a pure function cannot answer is the half john paid
 * for on the box: the EXIT CODE, and that the refusal happens before `up` touches any
 * state. The pid file is given a pid that IS alive — this test process — so the door
 * refuses without raising anything (the same trick, for the same reason, as
 * `instance-flag.process.test.ts`).
 */
describe("'up' over a daemon that is already up", () => {
  const live = (repo: string): string[] => {
    const pidFile = join(repo, "live.pid");
    writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    return ["--pid-file", pidFile];
  };

  it("under a unit: code 2 KEPT, and the sentence carries the whole repair", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });

    const done = run(repo, "orchestrator", "up", "--foreground", ...live(repo));

    // NOT the clean exit its neighbour above gets, and that is the decision of this
    // package: a zero here would report a green `systemctl restart` over a box that is
    // still unsupervised. The unit stays honestly red while the daemon is outside it.
    expect(done.status).toBe(2);
    const said = `${done.stdout}${done.stderr}`;
    expect(said).toContain("a daemon is already up");
    expect(said).toContain("'orchestrator down'");
    // NO UNIT NAME IS INVENTED HERE, and that is the fix of this PR's own review: this
    // process runs under no unit, so it holds no name — and the sentence hands over the
    // command that prints the real one instead of a plausible guess.
    expect(said).toContain(`systemctl --user list-units "agent-protocol*"`);
    expect(said).not.toContain("systemctl --user restart agent-protocol");
    expect(said).toContain("Do NOT type 'orchestrator up'");
    // Nothing was raised and nothing was enabled: the refusal is the FIRST thing `up`
    // does, so a refused start leaves the box exactly as it found it.
    expect(existsSync(state(repo, "daemon.pid"))).toBe(false);
    expect(existsSync(state(repo, "enabled"))).toBe(false);
  });

  it("the unit's own name reaches the sentence from the UNIT, not from the argv", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });

    // THE BOX THE REVIEWER OF THIS PR NAMED, run as a process (thread 141). Its install
    // was `systemd install --instance main --unit-name custom.service`: the file is
    // `custom.service`, and the `ExecStart` it generated carries `--instance main`,
    // because the two are computed independently. The first form of this refusal read the
    // argv and ordered `systemctl --user restart agent-protocol@main.service` — no such
    // unit on that box. Now the unit hands its own name down (`Environment=…=%n`), which
    // is what this environment stands for.
    const done = runUnder(
      repo,
      { AGENT_PROTOCOL_UNIT: "custom.service" },
      "orchestrator",
      "up",
      "--foreground",
      "--instance",
      "main",
      ...live(repo),
    );

    expect(done.status).toBe(2);
    const said = `${done.stdout}${done.stderr}`;
    expect(said).toContain("systemctl --user restart custom.service");
    expect(said).not.toContain("agent-protocol@main.service");
  });

  it("in a terminal: code 2 as before, and the stop flag is NOT lifted by a refused start", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });
    writeFileSync(state(repo, "stop"), "", "utf8");

    const done = run(repo, "orchestrator", "up", ...live(repo));

    expect(done.status).toBe(2);
    const said = `${done.stdout}${done.stderr}`;
    expect(said).toContain("a daemon is already up");
    expect(said).toContain("only otherwise with 'orchestrator up'");
    // The half that would be a genuine bug: `up` clears a stop flag left by `down`, and a
    // refused `up` must not do it — a hand that hit this refusal still has its stop.
    expect(existsSync(state(repo, "stop"))).toBe(true);
  });
});

describe("the foreground daemon is a daemon like any other", () => {
  it("writes its own pid and its saved argv, and mirrors the stream into the daemon log", () => {
    const repo = contour();

    const done = run(
      repo,
      "orchestrator",
      "up",
      "--foreground",
      "--once",
      "--max-runs",
      "1",
      ...EXEC,
    );

    expect(done.status).toBe(0);
    expect(done.stdout).toContain("the daemon runs in the FOREGROUND");
    // `status`, `down` and `restart` all know a daemon as "the pid in daemon.pid".
    expect(Number(readFileSync(state(repo, "daemon.pid"), "utf8").trim())).toBeGreaterThan(0);
    expect(readFileSync(state(repo, "daemon.pid.args"), "utf8")).toContain("--once");
    // journalctl and `orchestrator log` must not disagree about what happened.
    const log = readFileSync(state(repo, "daemon.log"), "utf8");
    expect(log).toContain("the daemon is up");
  });

  it("rotates a log over the cap and marks the epoch, so the file stays bounded and legible", () => {
    const repo = contour();
    mkdirSync(state(repo), { recursive: true });
    writeFileSync(state(repo, "daemon.log"), "the daemon before\n".repeat(50), "utf8");

    const done = run(
      repo,
      "orchestrator",
      "up",
      "--foreground",
      "--once",
      "--max-runs",
      "1",
      "--log-max-bytes",
      "200",
      ...EXEC,
    );

    expect(done.status).toBe(0);
    // The old epoch is aside, in the ONE generation that is kept — not deleted and not
    // piling up: this is what bounds the footprint after a week of restarts.
    expect(readFileSync(state(repo, "daemon.log.1"), "utf8")).toContain("the daemon before");
    const log = readFileSync(state(repo, "daemon.log"), "utf8");
    expect(log).not.toContain("the daemon before");
    // And the seam is visible: which daemon said a line is answered by reading upwards.
    expect(log).toContain("daemon epoch");
    expect(log).toContain("foreground");
  });
});
