/**
 * THE OPERATOR'S TAIL (thread 019) — three defects john met LIVE, and every one of them
 * belongs to the class "silent ≠ idle": the command reported success and the circuit did
 * something else. That is precisely why these are process tests over a real repository
 * and a real mail checkout rather than unit tests over stubs — what was wrong each time
 * was the ORDER of real side effects (a push that never happened, a daemon that exited
 * after the banner, a fetch nobody asked for), and a stub is the thing that hides it.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { waitFor } from "../testing/wait-for.js";

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

/**
 * THE IDENTITY GOES IN THE ENVIRONMENT (the same reason as in
 * `thread/new-message.process.test.ts`): the commit is made by the CLI, several git
 * calls deep, so a test cannot reach it with `-c user.email=…`. A temporary checkout
 * has no identity of its own, and the runner has no global config to fall back on —
 * which is exactly how this file passed here and failed in CI, with the delivery
 * dying inside `git commit` and leaving two message files behind.
 */
const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

const run = (
  cwd: string,
  home: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } => {
  const done = spawnSync(TSX, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: sandbox(home, IDENTITY),
  });
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
    })
      .split("\n")
      .filter((path) => /agent-comms\/016-x\/messages\/.*john\.md/.test(path));
    // TWO, not "at least one": the thread was SEEDED with a message from john, so a
    // pattern match alone is satisfied by the fixture and says nothing about delivery.
    // That is not hypothetical — it is what hid a real failure on the runner, where
    // the commit died on a missing identity and this assertion stayed green.
    expect(published).toHaveLength(2);
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
    //
    // "BETWEEN" IS A STATE, NOT TWO SECONDS (thread 084). The fixed pause measured how
    // fast this box collects a frame: on the loaded pool of 2026-08-18 the first frame
    // was still collecting when the origin went, and the watcher reported an honest
    // outage over a remote the test had removed under it — `frame: unavailable`, red,
    // on an invariant nobody had broken. Without a TTY a frame is appended and closed
    // by a blank line, so the first `\n\n` on the stream IS "frame one has landed";
    // after it the watcher sleeps out its interval, which is the window this deletion
    // belongs in.
    const landed = await waitFor(() => stdout.includes("\n\n"));
    expect(landed, `the first frame never landed; the watcher said: ${stdout}`).toBe(true);
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
    // Above the hang-sized ceiling of the wait above, for the reason that wait exists.
  }, 180_000);
});

describe("who signs a hold when nobody typed --by", () => {
  /** A machine config in the sandbox home the CLI will read. */
  const machineConfig = (home: string, config: unknown): void => {
    mkdirSync(join(home, "agent-protocol"), { recursive: true });
    writeFileSync(join(home, "agent-protocol", "local.json"), JSON.stringify(config), "utf8");
  };

  it("takes the operator of THIS box, not the account name it happens to run under", () => {
    const { repo } = contour();
    const home = configHome(repo);
    machineConfig(home, { operator: "john" });

    // The account name is deliberately not a role — that is the live case: `$USER` on
    // this box is `cosysoft`, and the short form refused every time until `--by` was
    // typed, which is the ceremony back with an error message on top.
    const done = spawnSync(TSX, [CLI, "orchestrator", "hold", "dev-core", "--ref", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      env: sandbox(home, { USER: "cosysoft" }),
    });

    expect(done.status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(repo, ".orchestrator", "holds", "dev-core"), "utf8")).by,
    ).toBe("john");
  });

  it("the flag still wins — the machine says who usually sits here, not who is typing", () => {
    const { repo } = contour();
    const home = configHome(repo);
    machineConfig(home, { operator: "john" });

    const done = run(
      repo,
      home,
      "orchestrator",
      "hold",
      "dev-core",
      "--by",
      "dev-core",
      "--ref",
      "HEAD",
    );

    expect(done.status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(repo, ".orchestrator", "holds", "dev-core"), "utf8")).by,
    ).toBe("dev-core");
  });

  it("with no operator and an account name that is no role, the refusal names the file to fix", () => {
    const { repo } = contour();
    const home = configHome(repo);

    const done = spawnSync(TSX, [CLI, "orchestrator", "hold", "dev-core", "--ref", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      env: sandbox(home, { USER: "cosysoft" }),
    });

    expect(done.status).toBe(2);
    // Both halves: what was wrong (a value from $USER that is no role) and where the
    // durable answer goes — a diagnosis that ends at "pass --by" gets retyped forever.
    expect(done.stderr).toContain("$USER");
    expect(done.stderr).toContain("local.json");
    expect(existsSync(join(repo, ".orchestrator", "holds", "dev-core"))).toBe(false);
  });
});

/**
 * THE OBSERVER'S DOOR (T-1). The rest of `orchestrator tui` — the reducer, the input
 * decoder, the layout — is pure and unit-tested in `tui.test.ts`; the shell around it
 * (raw mode, the alt-screen, the timers) is the named gap, and this is the one property
 * of it that can be asserted without dragging a pty into the package: WITHOUT A REAL
 * TERMINAL THE COMMAND REFUSES IN WORDS. A tool reached only when something else has
 * already gone wrong must not answer a pipe with escape sequences.
 */
describe("orchestrator tui — the door", () => {
  const ESC = "\u001b";

  it("refuses without a TTY and names the thing that does work in a pipe", () => {
    const { repo } = contour();
    const home = configHome(repo);
    // spawnSync gives the child pipes, never a tty — which is exactly the case tested.
    const done = run(repo, home, "orchestrator", "tui");

    expect(done.status).toBe(2);
    expect(done.stderr).toContain("needs a terminal");
    expect(done.stderr).toContain("status --watch");
    // Not one escape byte reached the pipe: the refusal is TEXT.
    expect(done.stdout).not.toContain(ESC);
    expect(done.stderr).not.toContain(ESC);
  });

  it("takes its ref from the working tree, like the other operator forms", () => {
    const { repo } = contour();
    const home = configHome(repo);
    const done = run(repo, home, "orchestrator", "tui");

    // The bootstrap line is printed BEFORE the door refuses — which ref governs is a
    // fact the operator gets even on a refusal.
    expect(done.stdout).toContain("--ref");
  });

  it("an unknown flag is refused by name, not swallowed", () => {
    const { repo } = contour();
    const home = configHome(repo);
    const done = run(repo, home, "orchestrator", "tui", "--nope");

    expect(done.status).toBe(2);
    expect(done.stderr).toContain("--nope");
  });
});
