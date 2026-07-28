/**
 * THE PROCESS TEST OF THE WORKSPACE AND THE CONTINUATION (R17 + R18).
 *
 * Both features are about things that only exist outside the process: a git worktree
 * on disk, the directory a child was spawned in, the argv a binary was handed. None
 * of that is observable from a pure function, and the previous incident of exactly
 * this class (`await runOne` dropped, PR #9) is the reason this file exists at all:
 * the CLI is started as a real process against a real git circuit, and what is
 * checked is the DISK and the STUB'S OWN RECORD of how it was called.
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

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    // The whole subject of R17: the roles get worktrees of their own, based on `main`.
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
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

const contour = (): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-ws-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  writeFileSync(join(repo, ".gitignore"), ".worktrees/\n.orchestrator/\nmailco/\n");
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
  return { repo, mail };
};

/**
 * The "session": it records WHERE it was started and WITH WHAT, then exits. Those two
 * files are the whole evidence — a session that reports its own cwd would prove
 * nothing about the cwd it was given.
 */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(
    path,
    `#!/bin/sh\npwd > ${join(repo, "cwd.txt")}\nprintf '%s\\n' "$@" > ${join(repo, "argv.txt")}\n` +
      // What git thought of the worktrees WHILE the session was alive — the only
      // moment at which the run lock can be observed at all.
      `git -C ${repo} worktree list --porcelain > ${join(repo, "worktrees.txt")}\n`,
  );
  chmodSync(path, 0o755);
  return path;
};

const run = (repo: string, extra: readonly string[] = []): { code: number; out: string } => {
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
        join(repo, "stub.sh"),
        "--wall-clock",
        "20",
        "--poll",
        "1",
        "--write",
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

const workspace = (repo: string): string => join(repo, ".worktrees", "dev-core");
const journalPath = (repo: string): string => join(repo, ".orchestrator", "journal.jsonl");
const journal = (repo: string): ReturnType<typeof parseJournal> =>
  parseJournal(readFileSync(journalPath(repo), "utf8"));
const argvOf = (repo: string): string[] =>
  readFileSync(join(repo, "argv.txt"), "utf8").split("\n").filter(Boolean);

describe("the role gets a workspace of its own (R17)", () => {
  it("no worktree yet → the orchestrator creates it and the session lands IN IT", () => {
    const { repo } = contour();
    stub(repo);

    const result = run(repo);

    expect(result.out).toContain("creating the worktree");
    expect(existsSync(workspace(repo))).toBe(true);
    // The evidence that the session was actually put there — not that we asked for it.
    expect(readFileSync(join(repo, "cwd.txt"), "utf8").trim()).toBe(
      execFileSync("realpath", [workspace(repo)], { encoding: "utf8" }).trim(),
    );
    // Detached at the base, because git refuses one branch in two worktrees and the
    // operator's own checkout holds `main`.
    expect(git(workspace(repo), "rev-parse", "HEAD").trim()).toBe(
      git(repo, "rev-parse", "origin/main").trim(),
    );
    expect(git(workspace(repo), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("HEAD");
    // And the operator's checkout is left exactly where it was — the pain R17 removes.
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });

  it("left on the previous package's branch, clean → moved back to the base", () => {
    const { repo } = contour();
    stub(repo);
    git(repo, "worktree", "add", "-q", "-b", "pkg/previous", workspace(repo));
    writeFileSync(join(workspace(repo), "done.txt"), "committed work\n");
    git(workspace(repo), "add", ".");
    git(workspace(repo), "commit", "-qm", "the previous package");

    const result = run(repo);

    expect(result.out).toContain("moving to");
    expect(git(workspace(repo), "rev-parse", "HEAD").trim()).toBe(
      git(repo, "rev-parse", "origin/main").trim(),
    );
    // NOTHING WAS LOST: the branch it left still exists and still points where it did.
    expect(git(repo, "rev-parse", "pkg/previous").trim()).not.toBe(
      git(repo, "rev-parse", "origin/main").trim(),
    );
  });

  it("DIRTY → the run is refused and the leftovers are untouched", () => {
    const { repo } = contour();
    stub(repo);
    git(repo, "worktree", "add", "-q", "--detach", workspace(repo));
    writeFileSync(join(workspace(repo), "half-done.txt"), "the broken session's work\n");

    const result = run(repo);

    expect(result.code).toBe(2);
    expect(result.out).toContain("uncommitted changes");
    // Not repaired at somebody else's expense.
    expect(readFileSync(join(workspace(repo), "half-done.txt"), "utf8")).toContain(
      "broken session",
    );
    // AND NO LEASE WAS TAKEN: a refusal before the journal, not an attempt that never happened.
    expect(existsSync(journalPath(repo))).toBe(false);
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });
});

/**
 * WHO THE COMMITS OUT OF A WORKSPACE ARE BY (thread 027). Only a real git can answer
 * this: the whole point is the file linked worktrees SHARE (`.git/config`) and the one
 * they do not (`config.worktree`), and a stub cannot be wrong about that in the way
 * that matters — a `--local` setting would have signed the operator's own checkout.
 */
describe("a role's workspace commits as the role (027)", () => {
  /**
   * `git config --get` EXITS 1 WHEN THE KEY IS UNSET, and that is a legitimate answer
   * here rather than a failure: the runner has no global identity at all, while a
   * developer's box does — the same trap that made this suite green locally and red in
   * CI before (see `testing/process-sandbox.ts`). So: the value, or nothing.
   */
  const identityOf = (tree: string): string | undefined => {
    const got = spawnSync("git", ["-C", tree, "config", "--get", "user.name"], {
      encoding: "utf8",
    });
    return got.status === 0 ? got.stdout.trim() : undefined;
  };

  /** A commit made the way a session makes one: no overrides, whatever the tree says. */
  const commitInside = (tree: string, file: string): string => {
    writeFileSync(join(tree, file), "work\n");
    execFileSync("git", ["-C", tree, "add", "."], { encoding: "utf8" });
    execFileSync("git", ["-C", tree, "commit", "-qm", `feat: ${file}`], { encoding: "utf8" });
    return execFileSync("git", ["-C", tree, "log", "-1", "--format=%an <%ae> | %cn <%ce>"], {
      encoding: "utf8",
    }).trim();
  };

  it("the launch signs the workspace, and a commit made there is authored by the role", () => {
    const { repo } = contour();
    stub(repo);

    const result = run(repo);

    expect(result.out).toContain("commits as dev-core <dev-core@agents.invalid>");
    expect(identityOf(workspace(repo))).toBe("dev-core");
    expect(commitInside(workspace(repo), "package.txt")).toBe(
      "dev-core <dev-core@agents.invalid> | dev-core <dev-core@agents.invalid>",
    );
  });

  it("and the operator's own checkout keeps its identity — the config file is shared", () => {
    const { repo } = contour();
    stub(repo);

    run(repo);

    // The trap this test exists for: `git config user.name` in a linked worktree writes
    // to the COMMON config, which would rename the human on their own machine.
    expect(identityOf(repo)).not.toBe("dev-core");
  });

  it("is re-applied at every launch — a workspace re-created elsewhere is signed again", () => {
    const { repo } = contour();
    stub(repo);
    run(repo);
    execFileSync("git", ["-C", workspace(repo), "config", "--worktree", "--unset", "user.name"], {
      encoding: "utf8",
    });

    run(repo);

    expect(identityOf(workspace(repo))).toBe("dev-core");
  });
});

describe("continuing the previous session (R18)", () => {
  /**
   * A journal with one finished run of the pair, broken the way a resume is allowed
   * to follow, and recording the world AS IT IS RIGHT NOW — the second condition is
   * about equality with the present, so the fixture has to be built from it.
   */
  const seedBrokenRun = (
    repo: string,
    over: Record<string, unknown> = {},
    world0: Record<string, unknown> = {},
  ): void => {
    const world = {
      base: git(repo, "rev-parse", "origin/main").trim(),
      // The role has said nothing in this thread yet — the empty mark, which is a
      // fact and not an absence.
      mine: "",
      ...world0,
    };
    const base = { ts: "2026-07-25T10:00:00Z", role: "dev-core", thread: "012-x" };
    const lines = [
      { kind: "lease-acquired", ...base, deadline: "2026-07-25T11:00:00Z" },
      { kind: "launch", ...base, mode: "fresh", world },
      {
        kind: "lease-released",
        ...base,
        reason: "supervisor-gone",
        session: "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b",
        steps: 12,
        ...over,
      },
    ];
    mkdirSync(join(repo, ".orchestrator"), { recursive: true });
    writeFileSync(journalPath(repo), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  };

  /** A message file added to the live thread and pushed, the way a real one arrives. */
  const arrives = (mail: string, name: string, body: string): void => {
    writeFileSync(join(mail, "agent-comms", "012-x", "messages", name), body);
    git(mail, "add", "agent-comms");
    git(mail, "commit", "-qm", name);
    // Pushed, or preflight refuses the run on an unpushed mail checkout long before
    // the continuation decision has any effect — a true refusal, but not this test's.
    git(mail, "push", "-q", "origin", "comms");
  };

  it("external break + the world standing still + a young run → --resume, and the tree is kept", () => {
    const { repo } = contour();
    stub(repo);
    git(repo, "worktree", "add", "-q", "-b", "pkg/in-flight", workspace(repo));
    writeFileSync(join(workspace(repo), "half-done.txt"), "what the session was doing\n");
    seedBrokenRun(repo);

    const result = run(repo);

    expect(result.out).toContain("resume 8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b");
    expect(result.out).toContain("kept as it is");
    expect(argvOf(repo).slice(0, 2)).toEqual(["--resume", "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b"]);
    // A RESUME MUST NOT MOVE THE TREE: the half-finished state is what it continues.
    expect(existsSync(join(workspace(repo), "half-done.txt"))).toBe(true);
    expect(git(workspace(repo), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("pkg/in-flight");
    // The launch event says how it was started — the journal does not have to be guessed at.
    const launch = journal(repo)
      .filter((event) => event.kind === "launch")
      .at(-1);
    expect(launch).toMatchObject({
      mode: "resume",
      resumes: "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b",
    });
  });

  it("AN ANSWER ARRIVED while it was down → still a resume: that is the input it waited for", () => {
    // john's narrowing of condition 2 (2026-07-25), end to end. The first version
    // compared the thread's tree id and refused here — burning a whole run on the most
    // ordinary event in the circuit.
    const { repo, mail } = contour();
    stub(repo);
    // The tree the broken session left behind: a resume continues it, so it has to be
    // there (a resume into a workspace that no longer exists is refused, see R17).
    git(repo, "worktree", "add", "-q", "-b", "pkg/in-flight", workspace(repo));
    seedBrokenRun(repo);
    arrives(mail, "2026-07-25T12-00-00Z-curator.md", WAITING);

    const result = run(repo);

    expect(result.out).toContain("resume 8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b");
    expect(argvOf(repo).slice(0, 2)).toEqual(["--resume", "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b"]);
  });

  it("ANOTHER SESSION WROTE FOR THIS ROLE → fresh: its intentions may already be spent", () => {
    const { repo, mail } = contour();
    stub(repo);
    seedBrokenRun(repo);
    arrives(
      mail,
      "2026-07-25T12-00-00Z-dev-core.md",
      "---\nfrom: dev-core\nworker: claude-code\nsession: 11111111-2222-3333-4444-555555555555\ndate: 2026-07-25T12:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nDone by somebody else.\n",
    );

    const result = run(repo);

    expect(result.out).toContain("fresh: another session wrote for this role");
    expect(result.out).toContain("2026-07-25T12-00-00Z-dev-core.md");
    expect(argvOf(repo)).not.toContain("--resume");
  });

  it("the base branch moved under it → fresh, and the workspace goes to the base", () => {
    const { repo } = contour();
    stub(repo);
    seedBrokenRun(repo, {}, { base: "0000000000000000000000000000000000000000" });

    const result = run(repo);

    expect(result.out).toContain("fresh: the base branch has moved on");
    expect(argvOf(repo)).not.toContain("--resume");
  });

  it("a run that used up its window is not resumed — it would return to the same tightness", () => {
    const { repo } = contour();
    stub(repo);
    seedBrokenRun(repo, { reason: "timeout" });

    expect(run(repo).out).toContain("fresh: the previous run ended as 'timeout'");
  });

  it("--fresh overrides a perfectly resumable break", () => {
    const { repo } = contour();
    stub(repo);
    seedBrokenRun(repo);

    const result = run(repo, ["--fresh"]);

    expect(result.out).toContain("fresh: --fresh was given");
    expect(argvOf(repo)).not.toContain("--resume");
  });

  it("a broken run records the id and the steps burned — without them nothing is resumable", () => {
    const { repo } = contour();
    stub(repo);
    // The stub announces a session id the way the real stream does, then exits
    // without passing the turn.
    writeFileSync(
      join(repo, "stub.sh"),
      `#!/bin/sh\nprintf '%s\\n' '{"type":"system","subtype":"init","session_id":"abc-123"}' '{"type":"assistant","message":{"content":"working"}}'\n`,
    );
    chmodSync(join(repo, "stub.sh"), 0o755);

    run(repo);

    const released = journal(repo)
      .filter((event) => event.kind === "lease-released")
      .at(-1);
    expect(released).toMatchObject({ session: "abc-123", steps: 1 });
  });
});

describe("the run lock (R17, john's requirement 1)", () => {
  it("the worktree is LOCKED while the session lives and unlocked when the run ends", () => {
    const { repo } = contour();
    stub(repo);

    run(repo);

    // Observed from inside the run, by the session itself: git considered the
    // workspace locked while it was alive.
    const duringTheRun = readFileSync(join(repo, "worktrees.txt"), "utf8");
    expect(duringTheRun).toContain("locked agent-protocol: dev-core is running on 012-x");
    // And afterwards it is released — a lock that outlives its run would block a
    // cleanup nobody is racing any more.
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain("locked ");
  });

  it("SOMEBODY ELSE'S LOCK → the run is refused and the tree is not moved", () => {
    // john, 22:20: the lock is taken before the plan mutates the tree, so a second
    // mutator — a manual run racing the daemon, a human `git worktree remove` — meets
    // a refusal instead of a race. The refusal is the dirty one's shape: this role
    // stands still, the circuit does not.
    const { repo } = contour();
    stub(repo);
    git(repo, "worktree", "add", "-q", "-b", "pkg/previous", workspace(repo));
    git(
      repo,
      "worktree",
      "lock",
      "--reason",
      "agent-protocol: dev-core is running on 012-other (supervisor pid 999999, since 2026-07-25T21:00:00Z)",
      workspace(repo),
    );

    const result = run(repo);

    expect(result.code).toBe(2);
    expect(result.out).toContain("locked");
    // The tree stayed where it was: a `rebase` under somebody's lock is the exact
    // move this refusal exists to prevent.
    expect(git(workspace(repo), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("pkg/previous");
    // No lease, no session — a refusal BEFORE the journal, as with a dirty tree.
    expect(existsSync(journalPath(repo))).toBe(false);
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
    // AND THE LOCK IS STILL THERE. The circuit does not clear a lock it did not set —
    // not even the one it has just refused to work around.
    expect(git(repo, "worktree", "list", "--porcelain")).toContain("supervisor pid 999999");
  });

  it("a lock left behind by a dead run is named as such — status shows it, nobody clears it", () => {
    const { repo } = contour();
    stub(repo);
    git(repo, "worktree", "add", "-q", "--detach", workspace(repo));
    // Pid 999999 is above the default pid_max of every Linux this runs on: nothing is
    // alive under it, which is what a lock left behind by a SIGKILLed run looks like.
    git(
      repo,
      "worktree",
      "lock",
      "--reason",
      "agent-protocol: dev-core is running on 012-other (supervisor pid 999999, since 2026-07-25T21:00:00Z)",
      workspace(repo),
    );

    const refusal = run(repo);
    const status = execFileSync(
      TSX,
      [CLI, "orchestrator", "status", "--ref", "HEAD", "--repo", repo],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
    );

    expect(refusal.out).toContain("git worktree unlock");
    expect(status).toContain("the process that locked it is gone");
  });

  it("the lock names the pair and the supervisor's pid — a stale one is identifiable", () => {
    const { repo } = contour();
    stub(repo);

    run(repo);

    expect(readFileSync(join(repo, "worktrees.txt"), "utf8")).toMatch(
      /locked agent-protocol: dev-core is running on 012-x \(supervisor pid \d+, since \d{4}-/,
    );
  });
});
