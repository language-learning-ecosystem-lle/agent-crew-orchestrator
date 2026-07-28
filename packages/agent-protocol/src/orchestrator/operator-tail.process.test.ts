/**
 * THE OPERATOR'S TAIL (thread 019) — three defects john met LIVE, and every one of them
 * belongs to the class "silent ≠ idle": the command reported success and the circuit did
 * something else. That is precisely why these are process tests over a real repository
 * and a real mail checkout rather than unit tests over stubs — what was wrong each time
 * was the ORDER of real side effects (a push that never happened, a daemon that exited
 * after the banner, a fetch nobody asked for), and a stub is the thing that hides it.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const JOHN = {
  id: "john",
  kind: "human",
  status: "active",
  wake: { mode: "self" },
  summary: "the one who forces",
};

const DEV_CORE = {
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "s" },
  summary: "the stream",
  launch: { allowedTools: ["Bash"] },
};

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  instances: [{ id: "main", roles: ["dev-core"] }],
  roles: [JOHN, DEV_CORE],
};

const META = "---\ntitle: T\nparticipants: dev-core, john\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: john\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

type Contour = {
  readonly repo: string;
  readonly origin: string;
  readonly mail: string;
};

/** A bare origin, a main checkout and a mail checkout with one waiting thread. */
const contour = (): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-tail-"));
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
  const thread = join(mail, "agent-comms", "016-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-john.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, origin, mail };
};

const run = (
  cwd: string,
  home: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } => {
  const done = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", env: sandbox(home) });
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
};

describe("a forced stop delivers its trace BEFORE it puts anything down", () => {
  it("the trace is committed and pushed, and only then does the flag appear", () => {
    const { repo, origin, mail } = contour();
    const home = configHome(repo);

    const done = run(
      repo,
      home,
      "orchestrator",
      "stop",
      "--mode",
      "force",
      "--ref",
      "HEAD",
      "--by",
      "john",
      "--reason",
      "the box is wedged",
      "--thread",
      "016-x",
      "--write",
    );

    expect(done.status).toBe(0);
    // THE FACT THAT WAS MISSING IN THE LIVE DEFECT: the message is in the REMOTE, not
    // merely on this disk. `git ls-tree` against origin's own branch answers that
    // without trusting the checkout.
    const published = execFileSync("git", ["-C", origin, "ls-tree", "-r", "--name-only", "comms"], {
      encoding: "utf8",
    });
    expect(published).toMatch(/agent-comms\/016-x\/messages\/.*john\.md/);
    // ...and the checkout is clean: a delivered message leaves nothing behind, which is
    // what `✗ mail: unsaved changes` in the next preflight was telling john.
    expect(git(mail, "status", "--porcelain").trim()).toBe("");
    expect(existsSync(join(repo, ".orchestrator", "force"))).toBe(true);
    expect(done.stdout).toContain("committed and pushed to origin/comms");
  });

  it("an undeliverable trace is kept and said out loud — and the stop still happens", () => {
    const { repo, origin, mail } = contour();
    const home = configHome(repo);
    // The remote goes away: the fetch inside delivery fails, which is the network case
    // curator named. A stop that cannot be announced must still be a stop.
    rmSync(origin, { recursive: true, force: true });

    const done = run(
      repo,
      home,
      "orchestrator",
      "stop",
      "--mode",
      "force",
      "--ref",
      "HEAD",
      "--by",
      "john",
      "--reason",
      "the box is wedged",
      "--thread",
      "016-x",
      "--write",
    );

    expect(done.status).toBe(0);
    expect(done.stderr).toContain("written locally and NOT delivered");
    // The trace is ON DISK — that is what "kept" means, and it is what a human delivers
    // by hand afterwards.
    expect(git(mail, "status", "--porcelain")).toMatch(/016-x/);
    expect(existsSync(join(repo, ".orchestrator", "force"))).toBe(true);
  });
});

describe("`up` does not start over a force flag", () => {
  it("refuses at the door, naming who put it there and why", () => {
    const { repo } = contour();
    const home = configHome(repo);
    mkdirSync(join(repo, ".orchestrator"), { recursive: true });
    writeFileSync(
      join(repo, ".orchestrator", "force"),
      JSON.stringify({ by: "john", note: "the box is wedged" }),
      "utf8",
    );

    const done = run(repo, home, "orchestrator", "up");

    expect(done.status).toBe(2);
    expect(done.stderr).toContain("john");
    expect(done.stderr).toContain("the box is wedged");
    expect(done.stderr).toContain("--clear-force");
    // NOTHING WAS STARTED — the defect was a banner over a daemon that had already left.
    expect(existsSync(join(repo, ".orchestrator", "daemon.pid"))).toBe(false);
    // ...and the flag is still there: a refusal does not quietly undo somebody's stop.
    expect(existsSync(join(repo, ".orchestrator", "force"))).toBe(true);
  });
});

describe("the watcher survives what it watches", () => {
  it("a frame that cannot be collected becomes an outage line, not an exit", () => {
    const { repo } = contour();
    const home = configHome(repo);

    // A journal that cannot be read is one of a dozen momentary failures the collection
    // meets; a directory in its place is the cheapest of them to arrange.
    mkdirSync(join(repo, "not-a-journal"), { recursive: true });
    const done = run(
      repo,
      home,
      "orchestrator",
      "status",
      "--watch",
      "--frames",
      "2",
      "--interval",
      "1",
      "--journal",
      join(repo, "not-a-journal"),
    );

    // It lived to the end of its frame budget instead of dying on the first one.
    expect(done.status).toBe(0);
    expect(done.stdout).toMatch(/frame: unavailable since \d\d:\d\d:\d\d/);
    expect(done.stdout).toContain("nothing has collected yet");
  });

  it("the config is resolved once: the remote may vanish mid-watch and the frames go on", async () => {
    const { repo, origin } = contour();
    const home = configHome(repo);
    // `--ref origin/main` is the resolution that FETCHES — the one that killed john's
    // watch when ssh went quiet. Deleting the origin mid-flight is the same failure
    // arranged deterministically: if the watcher fetched per frame, frame 2 would die.
    git(repo, "fetch", "-q", "origin", "main");

    const watcher = spawn(
      TSX,
      [
        CLI,
        "orchestrator",
        "status",
        "--watch",
        "--frames",
        "2",
        "--interval",
        "3",
        "--ref",
        "origin/main",
      ],
      { cwd: repo, env: sandbox(home) },
    );
    let stdout = "";
    watcher.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    watcher.stderr.on("data", () => {});

    // Between the frames, not before them: the first frame must be allowed to resolve
    // the config for real, so what the second frame proves is the FREEZE and not a
    // command that never looked.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    rmSync(origin, { recursive: true, force: true });

    const code = await new Promise<number | null>((resolve) => watcher.on("close", resolve));
    expect(code).toBe(0);
    // Two live frames, and not one word of outage: nothing went to the network after
    // the start, so there was nothing for the missing remote to break.
    expect(stdout).not.toContain("frame: unavailable");
    // Two frames landed: without a TTY each one is appended and separated by a blank
    // line, so the count of separated blocks is the count of frames.
    expect(
      stdout
        .trim()
        .split("\n\n")
        .filter((block) => block.trim() !== "").length,
    ).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
