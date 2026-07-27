/**
 * THE WATCH AGAINST A DEAD REMOTE — the process test of R6-достройка (john's
 * decision of 2026-07-26, curator's wording the same day).
 *
 * The scenario that motivated it is the one the whole recovery chain was built for:
 * a session dies because the network died. Everything downstream of that already
 * works — the outcome is recorded, the thread still waits on the role, the next run
 * resumes. And then the watch that was supposed to raise that next run turns out to
 * have died of the SAME outage, on the mail fetch in `preflight`, before the loop
 * even started. Nobody is left to raise anyone once the network returns.
 *
 * The remote here is unreachable FOR REAL — the bare repository is moved out from
 * under the checkout, so `git fetch` fails the way it fails on a dead network, with
 * git's own words. Nothing is stubbed: the point of the test is the seam between the
 * probe and the loop, and a fake fetch would prove nothing about it.
 *
 * Two facts are nailed down: the daemon SURVIVES the failure (and says, every tick,
 * that it is raising nobody), and it goes back to work by itself when the remote
 * comes back — no restart, no human.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/** The full circuit on disk — a bare origin, a code checkout and a mail checkout. */
const contour = (): { repo: string; origin: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-netdaemon-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, origin };
};

/** A "session" stub that does nothing and exits — enough to prove a launch happened. */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

const stateDir = (repo: string): string => join(repo, ".orchestrator");

const enable = (repo: string): void => {
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(join(stateDir(repo), "enabled"), "", "utf8");
};

/** Move the bare repository away — from the checkout's side the remote is simply gone. */
const cutTheWire = (origin: string): void => renameSync(origin, `${origin}.away`);
const restoreTheWire = (origin: string): void => renameSync(`${origin}.away`, origin);

/**
 * Drop a flag TOGETHER WITH ITS VALUE, by index.
 *
 * Removing only the value would leave the flag orphaned in front of the next token,
 * and `flag()` resolves by the FIRST match — so a `--exec` stripped that way keeps
 * resolving, to whatever happens to follow it. A test whose argv says one thing and
 * resolves to another passes by coincidence, and its name lies about its mechanism.
 */
const without = (argv: readonly string[], name: string): string[] => {
  const at = argv.indexOf(name);
  if (at < 0) throw new Error(`'${name}' is not in the argv — nothing to drop`);
  return [...argv.slice(0, at), ...argv.slice(at + 2)];
};

const args = (repo: string, extra: readonly string[] = []): string[] => [
  CLI,
  "orchestrator",
  "daemon",
  "--ref",
  "HEAD",
  "--no-fetch",
  "--repo",
  repo,
  "--exec",
  stub(repo),
  "--poll",
  "1",
  ...extra,
];

describe("the watch survives a dead remote (R6-достройка)", () => {
  it("--once with the remote gone: the daemon does NOT refuse to start, it declines to LAUNCH", () => {
    const { repo, origin } = contour();
    enable(repo);
    cutTheWire(origin);

    const result = spawnSync(TSX, args(repo, ["--once"]), {
      cwd: repo,
      encoding: "utf8",
      stdio: "pipe",
      env: sandbox(configHome(repo)),
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    // Code 2 is what preflight used to return here, and it killed the watch.
    expect(result.status).toBe(0);
    expect(output).toContain("LAUNCHING NOBODY");
    // git's own words about the remote, not a paraphrase: a refusal that does not
    // name its cause costs more than no refusal at all.
    expect(output).toMatch(/does not appear to be a git repository|Could not read from remote/);
    // And the gate really is shut: reading yesterday's mail is the outcome preflight
    // exists against, so "alive" must not mean "launching".
    expect(output).not.toContain("candidate dev-core");
  });

  it("a fatal check is still fatal: no binary → the process refuses, degraded or not", () => {
    // The split is by self-healing, not by severity. A missing binary is missing on
    // every tick, and a daemon spinning on it prints the same line forever.
    const { repo, origin } = contour();
    enable(repo);
    cutTheWire(origin);

    const result = spawnSync(
      TSX,
      [...without(args(repo, ["--once"]), "--exec"), "--exec", "no-such-binary-xyz"],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(result.status).toBe(2);
    expect(output).toContain("not starting");
    // The binary the test NAMES is the one the refusal is about: without this the test
    // would still be green on any other unresolvable string that slipped into `--exec`.
    expect(output).toContain("no-such-binary-xyz");
  });

  it("the outage does not block the off switch: the stop flag still stops the daemon", () => {
    // The gate is checked BEFORE the probe for exactly this reason — a daemon that
    // can only be stopped once the network recovers is not stoppable.
    const { repo, origin } = contour();
    enable(repo);
    writeFileSync(join(stateDir(repo), "stop"), "", "utf8");
    cutTheWire(origin);

    const result = spawnSync(TSX, args(repo, ["--once"]), {
      cwd: repo,
      encoding: "utf8",
      stdio: "pipe",
      env: sandbox(configHome(repo)),
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(result.status).toBe(0);
    expect(output).toContain("the daemon stopped — the stop flag");
    expect(output).not.toContain("LAUNCHING NOBODY");
  });

  it("the remote comes back → the same daemon resumes launching, with no restart", async () => {
    const { repo, origin } = contour();
    enable(repo);
    cutTheWire(origin);

    const child = spawn(TSX, args(repo, ["--tick", "1"]), {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
      env: sandbox(configHome(repo)),
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? -1));
    });
    const until = async (predicate: () => boolean, what: string): Promise<void> => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      child.kill("SIGKILL");
      throw new Error(`timed out waiting for ${what}; the output so far:\n${output}`);
    };

    // TWO refusals, not one: the second proves the loop is ticking rather than that
    // the process merely failed to die yet.
    await until(() => output.split("LAUNCHING NOBODY").length > 2, "two refused ticks");

    restoreTheWire(origin);

    await until(() => output.includes("the mail is readable again"), "the mail to come back");
    await until(
      () => output.includes("candidate dev-core") || output.includes("launch"),
      "a launch",
    );

    // The off switch works through all of it — the flag was never blocked by the outage.
    mkdirSync(dirname(join(stateDir(repo), "stop")), { recursive: true });
    writeFileSync(join(stateDir(repo), "stop"), "", "utf8");
    const code = await Promise.race([
      exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-2), 30_000)),
    ]);
    if (code === -2) child.kill("SIGKILL");
    expect(code).toBe(0);
    expect(existsSync(join(stateDir(repo), "journal.jsonl"))).toBe(true);
  }, 120_000);
});
