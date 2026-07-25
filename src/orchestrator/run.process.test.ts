/**
 * The PROCESS test of the observer — the only place where the RUN ITSELF is
 * checked rather than a fold of the journal.
 *
 * curator's statement of work after the 2026-07-25 acceptance, plus reviewer-pr's
 * finding on PR #9: the incident happened in `cli.ts` (the supervisor stopped
 * existing between the spawn and the terminal state), while the tests hit pure
 * functions — a regression of the form "`await runOne` is lost again" cannot be
 * caught by them at all. Here the CLI is started as a real process against a real
 * git circuit, and the JOURNAL is checked, not a report.
 *
 * The invariant nailed down: **a run does not end without recording its outcome.**
 * Exactly how it ended is a second question; it never ends silently.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { parseJournal } from "./journal.js";

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

/**
 * The full circuit on disk: a bare origin, a working checkout with the config on
 * `main` and a SEPARATE mail checkout on the `comms` branch — preflight demands
 * exactly this, and faking it cheaply would mean testing something other than
 * what actually runs.
 */
const contour = (): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-run-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  // The mail branch is assembled in a SEPARATE checkout — just as in the live
  // circuit: mail and code never lie in the same working tree.
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
  return { repo, mail };
};

/** A "session" stub: it does what it is asked and exits. */
const stub = (repo: string, body: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

/**
 * THE HOME DIRECTORY OF THE TEST (R14). The machine config is read from
 * `XDG_CONFIG_HOME`, so every run here gets its own — otherwise the outcome would
 * depend on whether the person running the suite happens to have one, which is the
 * class of defect the file was introduced to remove, reappearing in the tests.
 */
const xdgOf = (repo: string): string => join(repo, "..", "xdg");

const sandbox = (repo: string): NodeJS.ProcessEnv => ({
  ...process.env,
  XDG_CONFIG_HOME: xdgOf(repo),
});

/** Write a machine config into the test's own home directory. */
const machineConfig = (repo: string, agents: Record<string, { exec: string }>): void => {
  const dir = join(xdgOf(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local.json"), `${JSON.stringify({ agents }, null, 2)}\n`);
};

const run = (repo: string, exec: string): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "20",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(repo) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const journal = (repo: string): ReturnType<typeof parseJournal> =>
  parseJournal(readFileSync(join(repo, ".orchestrator", "journal.jsonl"), "utf8"));

/** Has the run got as far as opening its session log — i.e. is there a session to kill? */
const sessionLogExists = (repo: string): boolean => {
  const dir = join(repo, ".orchestrator", "sessions");
  return existsSync(dir) && readdirSync(dir).some((name) => name.endsWith(".log"));
};

/** The session log of a run — the file the journal points at. */
const sessionLog = (repo: string): string => {
  const dir = join(repo, ".orchestrator", "sessions");
  const names = readdirSync(dir).filter((name) => name.endsWith(".log"));
  return readFileSync(join(dir, names[names.length - 1] as string), "utf8");
};

describe("running a role as a process — the outcome is always recorded", () => {
  it("the session answered → handoff-detected and completed, not a report of success", () => {
    const { repo, mail } = contour();
    // The stub answers the way a live session does: it writes a message file into
    // the mail checkout.
    const answer = join(
      mail,
      "agent-comms",
      "012-x",
      "messages",
      "2026-07-25T11-00-00Z-dev-core.md",
    );
    const exec = stub(
      repo,
      `sleep 1\nprintf '%s' '---\nfrom: dev-core\ndate: 2026-07-25T11:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nThe answer.\n' > ${answer}`,
    );

    const result = run(repo, exec);
    const kinds = journal(repo).map((event) => event.kind);

    expect(kinds).toEqual(["lease-acquired", "launch", "handoff-detected", "lease-released"]);
    expect(journal(repo).at(-1)).toMatchObject({ reason: "completed" });
    expect(result.code).toBe(0);
  }, 60_000);

  it("the session exited without answering → exited-without-handoff, the lease is closed", () => {
    const { repo } = contour();
    const exec = stub(repo, "sleep 1");

    run(repo, exec);
    const events = journal(repo);

    expect(events.map((event) => event.kind)).toEqual([
      "lease-acquired",
      "launch",
      "lease-released",
    ]);
    expect(events.at(-1)).toMatchObject({ reason: "exited-without-handoff" });
  }, 60_000);

  it("the deadline without an answer → timeout: the role does not hang forever", () => {
    const { repo } = contour();
    const exec = stub(repo, "sleep 120");

    execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "3",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(repo) },
    );

    expect(journal(repo).at(-1)).toMatchObject({ reason: "timeout" });
  }, 60_000);

  it("the supervisor was killed with SIGTERM → the lease closes as supervisor-gone, the session is NOT orphaned", async () => {
    // reviewer-pr's finding on PR #9: recording "the lease is released" without
    // putting the group down would mean an orphaned session keeps writing while
    // the pair is already `launchable` — and the next tick would raise a SECOND
    // session on top of a live one.
    const { repo } = contour();
    const marker = join(repo, "alive.txt");
    const exec = stub(repo, `sleep 30\ntouch ${marker}`);

    const child = spawn(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "60",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, stdio: "ignore" },
    );
    // WAIT FOR THE STATE, NOT FOR A CLOCK. The fixed pause this replaced measured
    // the runner's mood: on a loaded CI machine the twelve seconds ran out while the
    // supervisor was still starting, the signal landed before it had a session to
    // watch, and the test failed for a reason that had nothing to do with the
    // invariant. The precondition it actually needs is "the session is up and
    // producing" — the log of the run says so.
    const started = Date.now();
    while (Date.now() - started < 45_000 && !sessionLogExists(repo)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    // A moment of real work after the spawn, so the kill hits a live session.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const last = journal(repo).at(-1);
    expect(last).toMatchObject({ kind: "lease-released", reason: "supervisor-gone" });

    // The session must be put down TOGETHER with the observer: had it lived out
    // its full 30 seconds, the marker would have appeared.
    await new Promise((resolve) => setTimeout(resolve, 22_000));
    expect(existsSync(marker), "the orphaned session outlived the supervisor").toBe(false);
  }, 90_000);

  it("THE SESSION OUTPUT REACHES THE FILE — every log used to be empty (R6)", () => {
    // The diagnosis of 2026-07-25: the supervisor collected stderr while the agent
    // speaks on stdout, so a run of any length left zero bytes behind and every
    // break was analysed blind. The stub speaks on BOTH streams — a live agent's
    // words and a launcher's complaint must both land.
    const { repo } = contour();
    const exec = stub(repo, "echo 'a word on stdout'\necho 'a complaint on stderr' >&2\nsleep 1");

    run(repo, exec);
    const log = sessionLog(repo);

    expect(log).toContain("a word on stdout");
    expect(log).toContain("a complaint on stderr");
    // The path in the journal points at a file that is NOT empty — the whole point.
    expect(log.length).toBeGreaterThan(0);
  }, 60_000);

  it("a session producing NO traces → stalled, not timeout (R6)", () => {
    // A hang and a long piece of work are indistinguishable by the clock; they
    // differ by side effects. The stub sleeps silently: no output, no file, no
    // commit — the case the idle ceiling exists for.
    const { repo } = contour();
    const exec = stub(repo, "sleep 120");

    execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "60",
        "--idle",
        "3",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(repo) },
    );

    const last = journal(repo).at(-1);
    expect(last).toMatchObject({ kind: "lease-released", reason: "stalled" });
    // The wall clock was 60 seconds and was NOT what fired: the run ended on the
    // idle ceiling, otherwise the test would have taken a minute.
    expect(sessionLog(repo)).toContain("stalled");
  }, 60_000);

  it("a session that WORKS is not killed by the idle ceiling", () => {
    // The expensive error of the detector: a false stall kills live work and burns
    // one of the three attempts on the pair. The stub keeps writing — the ceiling
    // must never fire, and the run ends the way it would without it.
    const { repo } = contour();
    const exec = stub(repo, 'for i in 1 2 3 4 5 6; do echo "step $i"; sleep 1; done');

    execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "60",
        "--idle",
        "3",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(repo) },
    );

    expect(journal(repo).at(-1)).toMatchObject({ reason: "exited-without-handoff" });
  }, 60_000);

  it("INVARIANT: a run does not finish leaving the lease alive", () => {
    // This is exactly what was lost in the 2026-07-25 acceptance: the process
    // ended, the lease stayed `running`, and from the outside that was
    // indistinguishable from work in progress.
    for (const body of ["sleep 1", "exit 3", "sleep 120"]) {
      const { repo } = contour();
      run(repo, stub(repo, body));
      const last = journal(repo).at(-1);
      expect(last?.kind, `the outcome was not recorded for the stub '${body}'`).toBe(
        "lease-released",
      );
    }
  }, 120_000);
});

describe("the session is told what it is and learns its own id (R7)", () => {
  it("passes worker and the session-id file in the environment, and fills the file from the init line", () => {
    // The two halves of the channel, checked where they actually live — in the
    // wiring, not in a pure function. `worker` can travel as a VALUE (the
    // supervisor knows what it raises); the session id cannot, because it does not
    // exist until the agent says its first line.
    const { repo } = contour();
    const dump = join(repo, "env.txt");
    const init = '{"type":"system","subtype":"init","session_id":"8f3a2b1c-0d4e","model":"m"}';
    const exec = stub(
      repo,
      `printf '%s\\n' '${init}'\nprintf '%s|%s\\n' "$AGENT_PROTOCOL_WORKER" "$AGENT_PROTOCOL_SESSION_FILE" > ${dump}\nsleep 2`,
    );

    run(repo, exec);

    const [worker, sessionFile] = readFileSync(dump, "utf8").trim().split("|");
    expect(worker).toBe("claude-code");
    expect(sessionFile).toMatch(/\.orchestrator\/sessions\/.*\.session$/);
    expect(readFileSync(sessionFile as string, "utf8")).toBe("8f3a2b1c-0d4e");
    // And the log says where it went — a break is analysed from the log alone.
    expect(sessionLog(repo)).toContain("session 8f3a2b1c-0d4e");
  }, 60_000);

  it("writes no session file when the stream never names a session — silence, not an empty file", () => {
    // An empty file would read as "the id is ''" to `new-message`; absence reads as
    // "this run could not name itself", which is the truth.
    const { repo } = contour();
    const exec = stub(repo, "printf '%s\\n' 'not the stream format'\nsleep 1");

    run(repo, exec);

    const dir = join(repo, ".orchestrator", "sessions");
    expect(readdirSync(dir).filter((name) => name.endsWith(".session"))).toEqual([]);
  }, 60_000);
});

describe("attached by default, detached on request (R12)", () => {
  /** The command as `run` above, plus whatever this test needs. */
  const runWith = (repo: string, extra: readonly string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(
        TSX,
        [
          CLI,
          "orchestrator",
          "run",
          "--ref",
          "HEAD",
          "--no-fetch",
          "--repo",
          repo,
          "--role",
          "dev-core",
          "--thread",
          "012-x",
          "--poll",
          "1",
          ...extra,
        ],
        { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(repo) },
      );
      return { code: 0, out };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
    }
  };

  it("--detach returns the terminal at once and the supervisor still records the outcome", async () => {
    // The whole point of the flag: the run outlives the command that started it. If
    // it did not, `-d` would just be a fancier way of losing the lease.
    const { repo } = contour();
    const exec = stub(repo, "sleep 6");

    const started = Date.now();
    const result = runWith(repo, ["--exec", exec, "--wall-clock", "60", "--write", "-d"]);
    const returnedAfter = Date.now() - started;

    expect(result.code).toBe(0);
    expect(result.out).toContain("went to the background");
    // The stub alone sleeps six seconds; returning inside that window is the proof
    // that we did not simply wait for it.
    expect(returnedAfter).toBeLessThan(6_000);

    // …and the detached supervisor closes the lease on its own, later.
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    expect(journal(repo).at(-1)).toMatchObject({ kind: "lease-released" });

    // Its own words went to a file: a background run has no terminal, and a
    // supervisor that speaks into /dev/null cannot be examined after a break.
    const dir = join(repo, ".orchestrator", "sessions");
    const supervisor = readdirSync(dir).filter((name) => name.endsWith(".supervisor"));
    expect(supervisor).toHaveLength(1);
    expect(readFileSync(join(dir, supervisor[0] as string), "utf8").length).toBeGreaterThan(0);
  }, 60_000);

  it("--detach without --write is REFUSED: a dry run has nothing to background", () => {
    const { repo } = contour();
    const result = runWith(repo, ["--exec", "/bin/true", "--detach"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("nothing to background");
  }, 60_000);

  it("the ceilings of the RUN come from the role's config and say so", () => {
    // The wiring, not the pure resolver: `launch.limits` has to travel from the
    // config file into the numbers the run is actually held to.
    const { repo } = contour();
    const config = join(repo, "agent-protocol.json");
    const raw = JSON.parse(readFileSync(config, "utf8")) as typeof CONFIG;
    (raw.roles[0] as { launch: { limits?: unknown } }).launch.limits = {
      idleSeconds: 0,
      wallClockSeconds: 45,
      maxTurns: 17,
    };
    writeFileSync(config, `${JSON.stringify(raw, null, 2)}\n`);
    git(repo, "commit", "-qam", "limits");

    const result = runWith(repo, ["--exec", stub(repo, "sleep 1"), "--write"]);

    expect(result.out).toContain("wall-clock 45s (role)");
    expect(result.out).toContain("max-turns 17 (role)");
    expect(result.out).toContain("idle off (role)");
  }, 60_000);

  it("a flag beats the role's ceiling — a human typed it for THIS run", () => {
    const { repo } = contour();
    const config = join(repo, "agent-protocol.json");
    const raw = JSON.parse(readFileSync(config, "utf8")) as typeof CONFIG;
    (raw.roles[0] as { launch: { limits?: unknown } }).launch.limits = { maxTurns: 17 };
    writeFileSync(config, `${JSON.stringify(raw, null, 2)}\n`);
    git(repo, "commit", "-qam", "limits");

    const result = runWith(repo, ["--exec", stub(repo, "sleep 1"), "--max-turns", "5", "--write"]);

    expect(result.out).toContain("max-turns 5 (flag)");
  }, 60_000);
});

describe("the machine says WHERE, the repository says WHAT (R14 + R15)", () => {
  /** `run`, but without `--exec`: the binary has to be found some other way. */
  const runWithout = (repo: string, extra: readonly string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(
        TSX,
        [
          CLI,
          "orchestrator",
          "run",
          "--ref",
          "HEAD",
          "--no-fetch",
          "--repo",
          repo,
          "--role",
          "dev-core",
          "--thread",
          "012-x",
          "--wall-clock",
          "20",
          "--poll",
          "1",
          ...extra,
        ],
        { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(repo) },
      );
      return { code: 0, out };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
    }
  };

  /** Put the role's launch section into the committed config. */
  const withLaunch = (repo: string, launch: Record<string, unknown>): void => {
    const path = join(repo, "agent-protocol.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as typeof CONFIG;
    (raw.roles[0] as { launch: unknown }).launch = { allowedTools: ["Bash"], ...launch };
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
    git(repo, "commit", "-qam", "launch");
  };

  it("the binary comes from the machine config — no --exec anywhere", () => {
    // The hole R14 closes, end to end: until now this path lived in john's shell
    // history, and a machine without the binary on PATH could not start the circuit
    // at all.
    const { repo } = contour();
    const exec = stub(repo, "sleep 1");
    machineConfig(repo, { "claude-code": { exec } });

    const result = runWithout(repo, ["--write"]);

    expect(result.out).toContain(`exec ${exec} (machine)`);
    expect(journal(repo).at(-1)).toMatchObject({ kind: "lease-released" });
  }, 60_000);

  it("a flag still beats the machine, and the output says which layer won", () => {
    const { repo } = contour();
    const fromMachine = stub(repo, "sleep 1");
    machineConfig(repo, { "claude-code": { exec: "/nowhere/claude" } });

    const result = runWithout(repo, ["--exec", fromMachine, "--write"]);

    expect(result.out).toContain(`exec ${fromMachine} (flag)`);
  }, 60_000);

  it("the machine config is NOT allowed to carry policy, and the refusal names the rule", () => {
    // The boundary is the whole point of the second file. A box quietly running with
    // ceilings nobody reviewed is exactly what keeping the config in `main` prevents.
    const { repo } = contour();
    mkdirSync(join(xdgOf(repo), "agent-protocol"), { recursive: true });
    writeFileSync(
      join(xdgOf(repo), "agent-protocol", "local.json"),
      JSON.stringify({ agents: {}, limits: { maxTurns: 9000 } }),
    );

    const result = runWithout(repo, ["--exec", "/bin/true", "--write"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("POLICY");
  }, 60_000);

  it("nobody named a binary and there is none → preflight refuses BEFORE the lease", () => {
    // With no machine config the name falls through to `claude` on PATH. The child's
    // PATH is emptied through the project's own preamble rather than left to the
    // machine running the suite: a test whose verdict depends on whether the
    // developer has the agent installed is the very defect this layer removes.
    // The refusal must arrive before an attempt is recorded — a journal showing a
    // launch that never happened is worse than no journal.
    const { repo } = contour();
    const path = join(repo, "agent-protocol.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as typeof CONFIG;
    (raw.orchestrator as { env?: unknown }).env = { PATH: "/nonexistent" };
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
    git(repo, "commit", "-qam", "empty PATH");

    const result = runWithout(repo, ["--write"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("agents['claude-code'].exec");
    expect(existsSync(join(repo, ".orchestrator", "journal.jsonl"))).toBe(false);
  }, 60_000);

  it("the role's model and effort reach the agent's own argv (R15)", () => {
    const { repo } = contour();
    const dump = join(repo, "argv.txt");
    const exec = stub(repo, `printf '%s\\n' "$@" > ${dump}\nsleep 1`);
    withLaunch(repo, { agent: { kind: "claude-code", model: "opus", effort: "high" } });

    const result = runWithout(repo, ["--exec", exec, "--write"]);
    const argv = readFileSync(dump, "utf8").split("\n");

    expect(argv).toContain("--model");
    expect(argv).toContain("opus");
    expect(argv).toContain("--effort");
    expect(argv).toContain("high");
    expect(result.out).toContain("model opus (role)");
  }, 60_000);

  it("no parameters declared → the tool's own defaults, not ours", () => {
    const { repo } = contour();
    const dump = join(repo, "argv.txt");
    const exec = stub(repo, `printf '%s\\n' "$@" > ${dump}\nsleep 1`);

    runWithout(repo, ["--exec", exec, "--write"]);

    expect(readFileSync(dump, "utf8").split("\n")).not.toContain("--model");
  }, 60_000);

  it("a --worker that contradicts the role's declared tool is REFUSED", () => {
    // Not pedantry: the parameters were written for one tool, and passing them to
    // another — or dropping them quietly — are both worse than stopping.
    const { repo } = contour();
    withLaunch(repo, { agent: { kind: "claude-code", model: "opus" } });

    const result = runWithout(repo, ["--exec", "/bin/true", "--worker", "cursor", "--write"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("cursor");
  }, 60_000);
});
