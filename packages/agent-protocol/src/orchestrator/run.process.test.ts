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
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseJournal } from "./journal.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: 1,
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
      { cwd: repo, encoding: "utf8", stdio: "pipe" },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const journal = (repo: string): ReturnType<typeof parseJournal> =>
  parseJournal(readFileSync(join(repo, ".orchestrator", "journal.jsonl"), "utf8"));

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
      { cwd: repo, encoding: "utf8", stdio: "pipe" },
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
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const last = journal(repo).at(-1);
    expect(last).toMatchObject({ kind: "lease-released", reason: "supervisor-gone" });

    // The session must be put down TOGETHER with the observer: had it lived out
    // its full 30 seconds, the marker would have appeared.
    await new Promise((resolve) => setTimeout(resolve, 22_000));
    expect(existsSync(marker), "the orphaned session outlived the supervisor").toBe(false);
  }, 90_000);

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
