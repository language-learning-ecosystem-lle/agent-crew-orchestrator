/**
 * THE PROCESS TEST OF THE ACCOUNT (thread 055, B.2) — the door, not the resolver.
 *
 * The resolver is a pure function and is tested as one (`launch.test.ts`). This file
 * exists because of what the two review rounds of PR #196 found twice in a row: a
 * resolution can be complete, unit-tested and unreachable, and nothing about the unit
 * tests says so. The integration point here is the SPAWN — whether the session the
 * package actually starts is pointed at the account's directory — so it is checked by
 * starting one and asking IT what it received, rather than by reading `cli.ts`.
 *
 * The stub is the witness: it writes its own `CLAUDE_CONFIG_DIR` into a file. What the
 * package intended is not evidence; what arrived in the child's environment is.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const configOf = (account?: string): Record<string, unknown> => ({
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
      launch: { allowedTools: ["Bash"], ...(account === undefined ? {} : { account }) },
    },
  ],
});

/** The same contour every process test of a run needs: origin, checkout, mail branch. */
const contour = (account?: string): { repo: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-account-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configOf(account), null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "055-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo };
};

/**
 * The witness. It reports the environment it was given — the empty string when the
 * variable is unset, which is a DIFFERENT answer from "the default path" and the test
 * below depends on telling the two apart.
 */
const witness = (repo: string): { exec: string; seen: string } => {
  const seen = join(repo, "seen.txt");
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' "$CLAUDE_CONFIG_DIR" > ${seen}\n`);
  chmodSync(path, 0o755);
  return { exec: path, seen };
};

const machineConfig = (repo: string, extra: Record<string, unknown>): void => {
  const dir = join(configHome(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local.json"), `${JSON.stringify({ agents: {}, ...extra }, null, 2)}\n`);
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
        "055-x",
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

describe("the account of a run reaches the session it raises (thread 055)", () => {
  it("the role names an account → the session is spawned pointed at its directory", () => {
    const { repo } = contour("second");
    const { exec, seen } = witness(repo);
    machineConfig(repo, { accounts: { second: { configDir: "/home/j/.claude-second" } } });

    run(repo, exec);

    // Asked of the child, not of the code that started it.
    expect(readFileSync(seen, "utf8")).toBe("/home/j/.claude-second");
  }, 60_000);

  it("the role names none → the variable is not set at all, not set to a default", () => {
    // The difference matters to one real operator: whoever exported CLAUDE_CONFIG_DIR
    // before starting the daemon. Writing a default over it would be the package
    // deciding something nobody asked it to decide.
    const { repo } = contour();
    const { exec, seen } = witness(repo);
    machineConfig(repo, {});

    run(repo, exec);

    expect(readFileSync(seen, "utf8")).toBe("");
  }, 60_000);

  it("…and an inherited value survives that silence", () => {
    const { repo } = contour();
    const { exec, seen } = witness(repo);
    machineConfig(repo, {});

    try {
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
          "055-x",
          "--exec",
          exec,
          "--wall-clock",
          "20",
          "--poll",
          "1",
          "--write",
        ],
        {
          cwd: repo,
          encoding: "utf8",
          stdio: "pipe",
          env: sandbox(configHome(repo), { CLAUDE_CONFIG_DIR: "/home/j/.claude-exported" }),
        },
      );
    } catch {
      // The outcome of the run is the other file's subject; this one asks the child.
    }

    expect(readFileSync(seen, "utf8")).toBe("/home/j/.claude-exported");
  }, 60_000);

  it("the role names an account this box does not declare → refused BY NAME, nothing spawned", () => {
    // The failure this whole layer exists against: a quiet fall-back would raise the
    // role on a subscription nobody assigned it and look exactly like a run that
    // obeyed. So the refusal has to happen BEFORE the spawn — the witness file not
    // existing is the load-bearing half of this assertion.
    const { repo } = contour("second");
    const { exec, seen } = witness(repo);
    machineConfig(repo, {});

    const result = run(repo, exec);

    expect(result.code).not.toBe(0);
    expect(result.out).toContain("accounts.second.configDir");
    expect(existsSync(seen)).toBe(false);
  }, 60_000);
});

/**
 * B.3 (thread 055) — THE ACCOUNT REACHES THE PLANNER AND THE JOURNAL, and it is asked of
 * the circuit rather than of the code, for the reason the file's own doc block gives: the
 * shelves of B.3 are complete and unit-tested, and on an empty field they behave exactly
 * as they did before B.3. Two facts are the whole wiring, so both are measured here:
 *
 *  1. a run WRITES whose account it spent — without it every shelf folds over silence;
 *  2. a candidate CARRIES whose account it would spend — without it a window closed on
 *     one subscription still stands the other's roles down, which is the stall B.3 exists
 *     to remove.
 */
const twoAccountConfig = {
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
      launch: { allowedTools: ["Bash"], account: "main" },
    },
    {
      id: "curator",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s2" },
      summary: "the other stream",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"], account: "second" },
    },
  ],
};

const WAITING_ON_CURATOR =
  "---\nfrom: dev-core\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nThe body.\n";

/** The contour of a box on TWO subscriptions: a role on each, a thread waiting on each. */
const twoAccountContour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-shelf-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(twoAccountConfig, null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  for (const [id, body] of [
    ["055-a", WAITING],
    ["055-b", WAITING_ON_CURATOR],
  ] as const) {
    const thread = join(mail, "agent-comms", id);
    mkdirSync(join(thread, "messages"), { recursive: true });
    writeFileSync(join(thread, "_meta.md"), META);
    writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), body);
  }
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

const journalOf = (repo: string): ReturnType<typeof parseJournal> => {
  const path = join(repo, ".orchestrator", "journal.jsonl");
  return existsSync(path) ? parseJournal(readFileSync(path, "utf8")) : [];
};

/** The window of ONE account, closed for hours — the fact the planner has to read per account. */
const seedClosedWindow = (repo: string, account: string): void => {
  const state = join(repo, ".orchestrator");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "enabled"), "", "utf8");
  const until = new Date(Date.now() + 5 * 60 * 60_000).toISOString().slice(0, 19);
  writeFileSync(
    join(state, "journal.jsonl"),
    `${JSON.stringify({
      kind: "lease-released",
      ts: new Date(Date.now() - 60_000).toISOString().slice(0, 19).concat("Z"),
      role: "dev-core",
      thread: "055-a",
      reason: "quota-exhausted",
      window: "five_hour",
      until: `${until}Z`,
      account,
    })}\n`,
    "utf8",
  );
};

const daemonOnce = (repo: string, exec: string): string => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "orchestrator",
      "daemon",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      repo,
      "--once",
      "--exec",
      exec,
      "--poll",
      "1",
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

describe("the account reaches the planner and the journal (thread 055, B.3)", () => {
  it("a run records WHOSE account it spent — the field every shelf is folded over", () => {
    const { repo } = contour("second");
    const { exec } = witness(repo);
    machineConfig(repo, { accounts: { second: { configDir: "/home/j/.claude-second" } } });

    run(repo, exec);

    const released = journalOf(repo).filter((event) => event.kind === "lease-released");
    expect(released).not.toHaveLength(0);
    expect(released.map((event) => (event as { account?: string }).account)).toContain("second");
  }, 60_000);

  it("a run on the box's own account writes NO field — silence is the key, not a gap", () => {
    const { repo } = contour();
    const { exec } = witness(repo);
    machineConfig(repo, {});

    run(repo, exec);

    const released = journalOf(repo).filter((event) => event.kind === "lease-released");
    expect(released).not.toHaveLength(0);
    expect(released.every((event) => !("account" in event))).toBe(true);
  }, 60_000);

  it("the window closed on ONE account → the role of the OTHER is raised, the first is skipped", () => {
    // The acceptance minimum of B.5, end to end: before the wiring the same contour raised
    // nobody at all, because one closed window was a state of the whole box.
    const repo = twoAccountContour();
    const stub = join(repo, "stub.sh");
    writeFileSync(stub, "#!/bin/sh\nexit 0\n");
    chmodSync(stub, 0o755);
    machineConfig(repo, {
      accounts: {
        main: { configDir: "/home/j/.claude-main" },
        second: { configDir: "/home/j/.claude-second" },
      },
    });
    seedClosedWindow(repo, "main");

    const out = daemonOnce(repo, stub);

    expect(out).toContain("candidate dev-core");
    expect(out).toContain("rate-limit window is closed");
    const launched = journalOf(repo).filter((event) => event.kind === "launch");
    expect(launched.map((event) => event.role)).toEqual(["curator"]);
  }, 60_000);

  it("…and closed on the OTHER account → the OTHER role is raised, the mirror image", () => {
    // The control: the same contour, the shelf moved to the other subscription. Without it
    // the test above would also pass on a planner that simply raises whoever is second.
    // The title said "nobody is raised" until B.4 and its own assert said otherwise — a
    // control whose name contradicts it teaches the next reader the wrong invariant.
    const repo = twoAccountContour();
    const stub = join(repo, "stub.sh");
    writeFileSync(stub, "#!/bin/sh\nexit 0\n");
    chmodSync(stub, 0o755);
    machineConfig(repo, {
      accounts: {
        main: { configDir: "/home/j/.claude-main" },
        second: { configDir: "/home/j/.claude-second" },
      },
    });
    seedClosedWindow(repo, "second");

    daemonOnce(repo, stub);

    const launched = journalOf(repo).filter((event) => event.kind === "launch");
    expect(launched.map((event) => event.role)).toEqual(["dev-core"]);
  }, 60_000);
});
