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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { parseJournal } from "./journal.js";
import { foldLeases } from "./lease.js";

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
const contour = (extra: Record<string, unknown> = {}): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-run-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify({ ...CONFIG, ...extra }, null, 2)}\n`,
  );
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

/** Write a machine config into the test's own home directory (R14). */
const machineConfig = (repo: string, agents: Record<string, { exec: string }>): void => {
  const dir = join(configHome(repo), "agent-protocol");
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
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const journalPath = (repo: string): string => join(repo, ".orchestrator", "journal.jsonl");
const journal = (repo: string): ReturnType<typeof parseJournal> =>
  parseJournal(readFileSync(journalPath(repo), "utf8"));

/** The session log of a run — the file the journal points at. */
const sessionLog = (repo: string): string => {
  const dir = join(repo, ".orchestrator", "sessions");
  const names = readdirSync(dir).filter((name) => name.endsWith(".log"));
  return readFileSync(join(dir, names[names.length - 1] as string), "utf8");
};

/**
 * WAIT FOR A STATE, WITH A CEILING FOR A REAL HANG — never a deadline that the
 * runner's mood can miss.
 *
 * The distinction the flake of 2026-07-27 was made of (the same test, the same
 * class, twice on different commits — msg-100 and msg-123 of `016-protocol-roadmap`):
 * the invariant under test is "the outcome IS recorded", not "it is recorded within
 * twenty seconds". A tight ceiling turns a slow machine into a red run, and a red run
 * people have learned to restart stops being a fact — which is what rule #14 rests on.
 * So the ceiling here is sized for a HANG (something that will never arrive), and the
 * wait returns the moment the state does.
 */
const HANG_CEILING_MS = 120_000;
const waitFor = async (state: () => boolean, ceilingMs = HANG_CEILING_MS): Promise<void> => {
  const until = Date.now() + ceilingMs;
  while (Date.now() < until && !state()) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

/** Is a process still there? `signal 0` asks without touching it. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
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
    // The session says WHICH PROCESS it is and then works for far longer than any
    // release can take. Both halves matter: the pid makes "it was put down" a state
    // the test can read instead of a stretch of clock it has to sit through, and the
    // long sleep means the marker cannot appear while a slow machine is still writing
    // the release — the old thirty seconds put a ceiling on the supervisor's speed and
    // called a slow release an orphaned session.
    const pidFile = join(repo, "session.pid");
    const exec = stub(repo, `echo $$ > ${pidFile}\nsleep 300\ntouch ${marker}`);

    // THE SIGNAL MUST LAND ON THE PROCESS THAT INSTALLED THE HANDLER, and `tsx` is a
    // WRAPPER: it starts node as a grandchild and forwards signals to it. That
    // forwarding is what failed on the runner of 2026-07-25 — twice, deterministically,
    // while this machine handled the same test every time: the journal stopped at
    // `launch` because the wrapper died of the signal and the node underneath it never
    // saw one. So the run is put into its OWN PROCESS GROUP and the group is signalled
    // — which is also what the supervisor itself does to the session it raises, and for
    // the same reason (a signal to a launcher does not reach what it launched).
    const supervisorOut = join(repo, "supervisor.txt");
    const sink = openSync(supervisorOut, "a");
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
      // Its own words are kept: when this fails, "did the handler run at all" is the
      // first question, and `stdio: "ignore"` threw the answer away.
      // AND THE TEST'S OWN HOME DIRECTORY (R14), like every other run here. This one
      // spawn was missing it and inherited the developer's real machine config — so on
      // the day `instance` was added to a live `local.json` the run refused at the S17
      // door ("the machine calls itself 'main', the repository declares no instances")
      // and the test failed on a machine outside the repository. Exactly the defect
      // `sandbox` was written to remove, surviving in the one call that skipped it.
      { cwd: repo, stdio: ["ignore", sink, sink], detached: true, env: sandbox(configHome(repo)) },
    );
    // WAIT FOR THE STATE, NOT FOR A CLOCK. The fixed pause this replaced measured
    // the runner's mood: on a loaded CI machine the twelve seconds ran out while the
    // supervisor was still starting, the signal landed before it had a session to
    // watch, and the test failed for a reason that had nothing to do with the
    // invariant. The precondition it actually needs is "the session is up and
    // producing" — and the session's own pid file says so first-hand: the log is
    // opened by the SUPERVISOR before the spawn, so it can exist while there is still
    // nothing to kill.
    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
    const sessionPid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isInteger(sessionPid) && sessionPid > 0).toBe(true);
    // A moment of real work after the spawn, so the kill hits a live session.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    process.kill(-(child.pid as number), "SIGTERM");
    // AND HERE TOO, THE STATE RATHER THAN A CLOCK — with the ceiling raised to the
    // size of a HANG. The twenty seconds this replaced were the last deadline in the
    // test, and they were the flake: twice on different commits the runner needed
    // longer than that to get the release onto disk, the wait ran out, and the failure
    // read as "the outcome was never recorded" about a run that recorded it.
    const lastKind = (): string | undefined =>
      existsSync(journalPath(repo)) ? journal(repo).at(-1)?.kind : undefined;
    await waitFor(() => lastKind() === "lease-released");
    // A journal that does not exist at all means the supervisor never started — a
    // different failure from "it started and said nothing", and the two must not be
    // reported as one (the runner produced both on the same day).
    expect(
      existsSync(journalPath(repo)),
      `the supervisor left no journal; it said: ${readFileSync(supervisorOut, "utf8")}`,
    ).toBe(true);

    const last = journal(repo).at(-1);
    // The journal goes into the message beside the supervisor's words: "it hung" and
    // "it stopped at `launch`" are different diagnoses, and the previous message named
    // neither — it printed the supervisor's stdout and left the reader to guess.
    expect(
      last,
      `the supervisor said: ${readFileSync(supervisorOut, "utf8")}\nthe journal reads: ${readFileSync(journalPath(repo), "utf8")}`,
    ).toMatchObject({
      kind: "lease-released",
      reason: "supervisor-gone",
    });

    // The session must be put down TOGETHER with the observer, and THAT is a state
    // too: the process is gone. The clock this replaced waited out the session's own
    // sleep to see whether a marker appeared — which made the session's length a
    // ceiling on how slow the release was allowed to be, so a slow-but-correct release
    // was reported as an orphaned session.
    await waitFor(() => !alive(sessionPid));
    expect(alive(sessionPid), "the orphaned session outlived the supervisor").toBe(false);
    // The belt to that brace: it was put down BEFORE finishing its work, not after.
    expect(existsSync(marker), "the session ran to completion after the supervisor died").toBe(
      false,
    );
  }, 300_000);

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
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
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
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
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
        { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
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
        { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
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
    mkdirSync(join(configHome(repo), "agent-protocol"), { recursive: true });
    writeFileSync(
      join(configHome(repo), "agent-protocol", "local.json"),
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

/**
 * THE INTERACTIVE TURN, END TO END (R19). The pure core is tested next door; what can
 * only be checked here is the WIRING, and it is the whole mechanism: a passed turn that
 * does NOT close the run, an idle detector that does not fire on a wait, a work window
 * that gets its time back, and two endings that are recorded as themselves.
 *
 * The stub plays both parts — the parked session and the human answering — because the
 * way out of a wait is the marker rather than the mail, so nothing here needs a second
 * process to be true.
 */
describe("a session that asks and waits alive (R19)", () => {
  const messages = (mail: string): string => join(mail, "agent-comms", "012-x", "messages");
  /** A message file, written the way a live session writes one — straight into the checkout. */
  const message = (from: string, stamp: string, waitingOn: string): string =>
    `printf '%s' '---\nfrom: ${from}\ndate: ${stamp}\nexpects: answer\nwaiting-on: ${waitingOn}\n---\n\nThe text.\n'`;
  /** The declaration `new-message --await-input` writes, at the path the session is given. */
  const declare = (thread: string): string =>
    `WAIT="\${AGENT_PROTOCOL_SESSION_FILE%.session}.waiting"\nprintf '%s\\n' '{"thread":"${thread}","at":"2026-07-25T11:00:00Z"}' > "$WAIT"`;

  /**
   * `spawnSync` and not `execFileSync` here: several of the sentences below are the
   * supervisor's COMPLAINTS, and they go to stderr. A run that ends well returns only
   * its stdout through `execFileSync`, so half of what this mechanism says would be
   * invisible to the test — and it is exactly the half that explains a run that stopped
   * in the middle.
   */
  const runWith = (repo: string, extra: readonly string[]): { code: number; out: string } => {
    const result = spawnSync(
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
        "--write",
        ...extra,
      ],
      { cwd: repo, encoding: "utf8", env: sandbox(configHome(repo)) },
    );
    return {
      code: result.status ?? 1,
      out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  };

  it("asks, waits through a silence longer than the idle ceiling, gets an answer and finishes", () => {
    const { repo, mail } = contour();
    const dir = messages(mail);
    const exec = stub(
      repo,
      [
        "sleep 1",
        // The question and the declaration, in that one gesture: the marker first.
        declare("012-x"),
        `${message("dev-core", "2026-07-25T11:00:00Z", "curator")} > ${join(dir, "2026-07-25T11-00-00Z-dev-core.md")}`,
        // EIGHT SECONDS OF PRODUCING NOTHING against an idle ceiling of three. Before
        // R19 this exact silence was `stalled` — a session killed for doing what it was
        // told to do.
        "sleep 8",
        `${message("curator", "2026-07-25T11:10:00Z", "dev-core")} > ${join(dir, "2026-07-25T11-10-00Z-curator.md")}`,
        // `await-input` returns and drops the declaration — that is what un-parks the run.
        'rm -f "$WAIT"',
        "sleep 3",
        `${message("dev-core", "2026-07-25T11:20:00Z", "curator")} > ${join(dir, "2026-07-25T11-20-00Z-dev-core.md")}`,
        "sleep 2",
      ].join("\n"),
    );

    const result = runWith(repo, [
      "--exec",
      exec,
      "--wall-clock",
      "90",
      "--idle",
      "3",
      "--wait-input",
      "60",
    ]);
    const events = journal(repo);

    expect(events.map((event) => event.kind)).toEqual([
      "lease-acquired",
      "launch",
      "input-awaited",
      "input-received",
      "handoff-detected",
      "lease-released",
    ]);
    expect(events.at(-1)).toMatchObject({ reason: "completed" });
    // The silence was NEVER read as a stall — requirement (б) in the wiring.
    expect(result.out).not.toContain("stalled");
    // …and the work window got the waited time back (requirement (в)): the deadline the
    // fold arrives at is later than the one the lease was taken with.
    const acquired = events[0] as { deadline: string };
    const parked = events[2] as { ts: string };
    const back = events[3] as { ts: string };
    const waitedMs = new Date(back.ts).getTime() - new Date(parked.ts).getTime();
    expect(waitedMs).toBeGreaterThan(0);
    const shifted = foldLeases(events, new Date()).find((view) => view.thread === "012-x");
    expect(new Date(shifted?.deadline as string).getTime()).toBe(
      new Date(acquired.deadline).getTime() + waitedMs,
    );
  }, 90_000);

  it("nobody answers within the wait ceiling → input-timeout, and never stalled or timeout", () => {
    const { repo, mail } = contour();
    const exec = stub(
      repo,
      [
        "sleep 1",
        declare("012-x"),
        `${message("dev-core", "2026-07-25T11:00:00Z", "curator")} > ${join(messages(mail), "2026-07-25T11-00-00Z-dev-core.md")}`,
        "sleep 120",
      ].join("\n"),
    );

    const result = runWith(repo, [
      "--exec",
      exec,
      "--wall-clock",
      "90",
      "--idle",
      "3",
      "--wait-input",
      "5",
    ]);
    const events = journal(repo);

    expect(events.map((event) => event.kind)).toEqual([
      "lease-acquired",
      "launch",
      "input-awaited",
      "lease-released",
    ]);
    expect(events.at(-1)).toMatchObject({ reason: "input-timeout" });
    // The wait has its own refusal: neither of the two clocks it is NOT is allowed to
    // claim this run (the wall clock was 90s and the idle ceiling 3s). The log of the
    // run is where the sentence has to be — a break is analysed without a witness.
    expect(sessionLog(repo)).toContain("nobody answered within the wait ceiling");
    // And the line does not send anybody looking for a message that is already written.
    expect(`${result.out}${sessionLog(repo)}`).not.toContain("the turn was not passed");
    expect(result.out).toContain("finished: input-timeout");
  }, 90_000);

  it("the session dies while parked → exited-while-waiting, not completed", () => {
    // `completed` would have said the package finished, when in fact it stopped in the
    // middle with its question in the thread.
    const { repo, mail } = contour();
    const exec = stub(
      repo,
      [
        "sleep 1",
        declare("012-x"),
        `${message("dev-core", "2026-07-25T11:00:00Z", "curator")} > ${join(messages(mail), "2026-07-25T11-00-00Z-dev-core.md")}`,
        "sleep 3",
      ].join("\n"),
    );

    const result = runWith(repo, ["--exec", exec, "--wall-clock", "60", "--wait-input", "60"]);
    const events = journal(repo);

    expect(events.map((event) => event.kind)).toEqual([
      "lease-acquired",
      "launch",
      "input-awaited",
      "lease-released",
    ]);
    expect(events.at(-1)).toMatchObject({ reason: "exited-while-waiting" });
    expect(result.out).toContain("the session died while it was parked");
    expect(result.out).toContain("finished: exited-while-waiting");
  }, 60_000);

  it("a declaration naming ANOTHER thread is not honoured, and says so", () => {
    // A run is bound to one thread. Parking on somebody else's declaration would hold a
    // lease for work this run is not doing — and staying silent about it would look like
    // the flag did nothing.
    const { repo, mail } = contour();
    const exec = stub(
      repo,
      [
        "sleep 1",
        declare("009-somewhere-else"),
        `${message("dev-core", "2026-07-25T11:00:00Z", "curator")} > ${join(messages(mail), "2026-07-25T11-00-00Z-dev-core.md")}`,
        "sleep 2",
      ].join("\n"),
    );

    const result = runWith(repo, ["--exec", exec, "--wall-clock", "60"]);
    const events = journal(repo);

    expect(events.map((event) => event.kind)).toEqual([
      "lease-acquired",
      "launch",
      "handoff-detected",
      "lease-released",
    ]);
    expect(events.at(-1)).toMatchObject({ reason: "completed" });
    expect(result.out).toContain("the declared wait is not honoured");
    expect(result.out).toContain("009-somewhere-else");
    // …and in the log of the run too: the reason is analysed without a witness.
    expect(sessionLog(repo)).toContain("the declared wait is not honoured");
  }, 60_000);

  it("the session is told the ceiling of its own wait, so the two clocks cannot disagree", () => {
    const { repo } = contour();
    const dump = join(repo, "wait-env.txt");
    const exec = stub(repo, `printf '%s' "$AGENT_PROTOCOL_WAIT_SECONDS" > ${dump}\nsleep 1`);

    runWith(repo, ["--exec", exec, "--wall-clock", "30", "--wait-input", "123"]);

    expect(readFileSync(dump, "utf8")).toBe("123");
  }, 60_000);

  it("THE SESSION IS TOLD ITS OWN DEADLINE (R20) — in its environment and in its prompt", () => {
    // Until this existed a session had no channel to its own deadline at all (the
    // acceptance of 012 found `--wall-clock` being read out of a leaked
    // `npm_lifecycle_script`), so it could not wind down before being cut off. The env
    // value must be the SAME moment the journal leased, or the two would disagree by
    // however long the spawn took.
    const { repo } = contour();
    const dump = join(repo, "deadline-env.txt");
    const promptDump = join(repo, "prompt.txt");
    const exec = stub(
      repo,
      `printf '%s' "$AGENT_PROTOCOL_LEASE_DEADLINE" > ${dump}\nprintf '%s' "$*" > ${promptDump}\nsleep 1`,
    );

    runWith(repo, ["--exec", exec, "--wall-clock", "30", "--wind-down", "10"]);

    const leased = journal(repo).find((event) => event.kind === "lease-acquired") as {
      deadline: string;
    };
    expect(readFileSync(dump, "utf8")).toBe(leased.deadline);
    // …and the same moment reaches the session as WORDS: the environment is for the
    // shell, the prompt is what the session actually reads.
    const prompt = readFileSync(promptDump, "utf8");
    expect(prompt).toContain(leased.deadline);
    expect(prompt).toContain("YOUR RUN HAS A DEADLINE");
  }, 60_000);

  it("the landing point is announced in the log, so a timeout can be read for what it is", () => {
    // Nothing fires at the wind-down point — there is no gesture that makes a session
    // commit. What the supervisor owes is the record: it said so, at this minute, and
    // the run was cut off anyway.
    const { repo } = contour();
    const exec = stub(repo, "sleep 30");

    // A window of 6 seconds with a 5-second margin: the point falls one second in, the
    // wall clock ends the run four seconds later.
    const result = runWith(repo, ["--exec", exec, "--wall-clock", "6", "--wind-down", "5"]);

    expect(result.out).toContain("the wind-down point has passed");
    expect(sessionLog(repo)).toContain("the wind-down point has passed");
    // The timeout now says WHY it is worth looking at, instead of reading as the routine
    // ending of a long run.
    expect(journal(repo).at(-1)).toMatchObject({ reason: "timeout" });
    expect(result.out).toContain("did NOT wind down");
  }, 60_000);
});

/**
 * THE SCOPE DOOR OF A MANUAL RUN (R13, curator's decision on the reviewer's finding on
 * PR #32). The daemon refuses a role it does not own; `run` used to advertise the same
 * flags in its help and check nothing, so the hand-typed launch was the way around the
 * topology — and it is the launch a human types exactly when something is already wrong.
 *
 * The invariant nailed down here is that the refusal happens BEFORE the world is
 * touched: no lease, no journal, no workspace. A run that refuses after leasing would
 * leave the role held by nobody on a box that is not supposed to raise it at all.
 */
describe("a manual run stops at the same scope door as the daemon (R13)", () => {
  /** A machine that knows its own name — the second half of the ownership join (R14). */
  const identity = (repo: string, instance: string): void => {
    const dir = join(configHome(repo), "agent-protocol");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "local.json"), `${JSON.stringify({ instance }, null, 2)}\n`);
  };

  const runWith = (repo: string, extra: readonly string[]): { code: number; out: string } => {
    const result = spawnSync(
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
        "/bin/true",
        "--poll",
        "1",
        "--write",
        ...extra,
      ],
      { cwd: repo, encoding: "utf8", env: sandbox(configHome(repo)) },
    );
    return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };

  const TOPOLOGY = {
    instances: [
      { id: "box-a", roles: ["dev-core"], note: "the box that owns the role" },
      { id: "box-b", roles: [] },
    ],
  };

  it("the role belongs to another instance → refused, and nothing was leased", () => {
    const { repo } = contour(TOPOLOGY);
    identity(repo, "box-b");

    const result = runWith(repo, []);

    expect(result.code).toBe(2);
    expect(result.out).toContain("owned by instance 'box-a'");
    expect(result.out).toContain("this box is 'box-b'");
    // The door is BEFORE the world: the journal was never opened, so there is no lease
    // for a supervisor on the wrong box to have to close.
    expect(existsSync(journalPath(repo))).toBe(false);
  }, 60_000);

  it("the role is this box's → raised, the topology is not a blanket refusal", () => {
    const { repo } = contour(TOPOLOGY);
    identity(repo, "box-a");

    const result = runWith(repo, ["--wall-clock", "20"]);

    expect(result.code).toBe(0);
    expect(journal(repo).map((event) => event.kind)).toContain("lease-acquired");
  }, 60_000);

  it("the operator excluded the very role they asked for → refused instead of raised", () => {
    // `run --role X --exclude-roles X` is two statements that contradict each other, and
    // the one that must not win is the silent one. Before this it was a successful launch.
    const { repo } = contour();

    const result = runWith(repo, ["--exclude-roles", "dev-core"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("excluded by the operator");
    expect(existsSync(journalPath(repo))).toBe(false);
  }, 60_000);

  it("the operator named other roles → the one asked for is outside the scope of this run", () => {
    const { repo } = contour({
      roles: [
        ...CONFIG.roles,
        {
          ...CONFIG.roles[0],
          id: "curator",
          summary: "the other one",
          wake: { mode: "watch", session: "s2" },
        },
      ],
    });

    const result = runWith(repo, ["--roles", "curator"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("outside the scope of this run");
    expect(existsSync(journalPath(repo))).toBe(false);
  }, 60_000);

  it("a name that is not a launchable role is a typo, not an empty scope", () => {
    const { repo } = contour();

    const result = runWith(repo, ["--roles", "dev-cor"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("is not a launchable role of this circuit");
    expect(existsSync(journalPath(repo))).toBe(false);
  }, 60_000);

  it("both flags at once have two answers, so the run does not start", () => {
    const { repo } = contour();

    const result = runWith(repo, ["--roles", "dev-core", "--exclude-roles", "dev-core"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("mutually exclusive");
    expect(existsSync(journalPath(repo))).toBe(false);
  }, 60_000);

  it("a box with no name under a declared topology does not guess — it refuses", () => {
    // Guessing here would guess "raise it": the failure mode is a second box on a role
    // whose lease is local to the first.
    const { repo } = contour(TOPOLOGY);

    const result = runWith(repo, []);

    expect(result.code).toBe(2);
    expect(result.out).toContain("does not know which instance it is");
    expect(existsSync(journalPath(repo))).toBe(false);
  }, 60_000);
});
