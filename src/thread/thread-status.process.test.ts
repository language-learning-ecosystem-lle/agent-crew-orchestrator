/**
 * The PROCESS test of `thread status` — the door the permission `thread-status` never
 * had (thread 065, task 065.1).
 *
 * IT ASKS THE FEED, NOT THE DISK, for the same reason `new-thread`'s process test does:
 * the defect class this command belongs to is "the tool reported a change nobody can
 * read" — a status that moved on one disk is a thread still open for everybody else.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
      permissions: ["thread-status"],
    },
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
      permissions: ["thread-status"],
    },
  ],
};

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

type Contour = { repo: string; root: string; remote: string };

const META = (status: string): string =>
  `---\ntitle: A conversation\nparticipants: dev-core, curator\nstatus: ${status}\n---\n`;

const MESSAGE = `---
from: curator
date: 2026-08-13T10:00:00Z
expects: answer
waiting-on: dev-core
---

The statement of work.
`;

/** A bare origin on the mail branch, a checkout of it and one open thread inside. */
const contour = (): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-ts-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-ts-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const dir = join(repo, "agent-comms", "065-debts");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(join(repo, "agent-comms", "INDEX.md"), "# threads\n");
  writeFileSync(join(dir, "_meta.md"), META("open"));
  writeFileSync(join(dir, "messages", "2026-08-13T10-00-00Z-curator.md"), MESSAGE);
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");
  return { repo, root: join(repo, "agent-comms"), remote };
};

const setStatus = (
  contest: Contour,
  from: string,
  status: string,
  extra: readonly string[] = ["--write"],
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "thread",
        "status",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--thread",
        "065-debts",
        "--from",
        from,
        "--status",
        status,
        ...extra,
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/**
 * A SECOND CHECKOUT OF THE SAME ORIGIN — the other closer's box. Cloned at the moment it
 * is called, so a clone taken before anybody pushed has a disk that still says 'open':
 * that staleness is the whole scenario (thread 065, the verdict on #266).
 */
const secondBox = (contest: Contour): Contour => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-ts-second-"));
  execFileSync("git", ["clone", "-q", contest.remote, repo]);
  return { repo, root: join(repo, "agent-comms"), remote: contest.remote };
};

const headOf = (repo: string, rev: string): string =>
  execFileSync("git", ["-C", repo, "rev-parse", rev], { encoding: "utf8" }).trim();

/** The only question worth asking: what does the feed in origin hold? */
const metaInOrigin = (contest: Contour): string =>
  execFileSync("git", ["-C", contest.remote, "show", "comms:agent-comms/065-debts/_meta.md"], {
    encoding: "utf8",
  });

const show = (contest: Contour): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "thread",
      "show",
      "--repo",
      contest.repo,
      "--root",
      contest.root,
      "--ref",
      "HEAD",
      "--no-fetch",
      "--thread",
      "065-debts",
    ],
    { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
  );

describe("thread status — the door of the permission 'thread-status' (065.1)", () => {
  it("a role WITH the permission closes the thread, and the feed carries it", () => {
    const contest = contour();

    const result = setStatus(contest, "curator", "closed");

    expect(result.code).toBe(0);
    expect(result.out).toContain("committed and pushed");
    expect(metaInOrigin(contest)).toContain("status: closed");
  });

  it("the change is visible in 'thread show' — the reading half agrees with the writing one", () => {
    const contest = contour();
    setStatus(contest, "curator", "closed");

    expect(show(contest)).toContain("status: closed");
  });

  it("a role WITHOUT the permission is refused BY NAME, and the feed does not move", () => {
    const contest = contour();

    const result = setStatus(contest, "dev-core", "closed");

    expect(result.code).toBe(2);
    expect(result.out).toContain("thread-status");
    expect(result.out).toContain("dev-core");
    // The refusal names who may do it — the alternative is editing the file by hand.
    expect(result.out).toContain("curator");
    expect(metaInOrigin(contest)).toContain("status: open");
  });

  it("only '_meta.md' moves: the messages are append-only and the derived files are the generator's", () => {
    const contest = contour();
    setStatus(contest, "curator", "closed");

    const changed = execFileSync(
      "git",
      ["-C", contest.repo, "show", "--name-only", "--format=", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    expect(changed).toBe("agent-comms/065-debts/_meta.md");
  });

  it("a status already set writes nothing — closing twice is a no-op, not a conflict", () => {
    const contest = contour();
    setStatus(contest, "curator", "closed");
    const head = execFileSync("git", ["-C", contest.repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    });

    const again = setStatus(contest, "curator", "closed");

    expect(again.code).toBe(0);
    expect(again.out).toContain("already");
    expect(
      execFileSync("git", ["-C", contest.repo, "rev-parse", "HEAD"], { encoding: "utf8" }),
    ).toBe(head);
  });

  // THE RACE THE NO-OP WAS WRITTEN FOR, and the one the first eight cases did not cover:
  // the repeat above comes from ONE checkout, where the check before delivery reads a
  // current disk. Here the second closer's disk is stale, so it passes that check and
  // finds out inside the attempt — which used to mean `git commit … failed (code 1)`
  // straight through the catch (thread 065, the verdict on #266).
  it("two boxes close the same thread: the second one, whose disk was stale, gets 'already', not a git failure", () => {
    const contest = contour();
    const other = secondBox(contest); // cloned while the feed still said 'open'

    setStatus(contest, "curator", "closed");
    const second = setStatus(other, "john", "closed");

    expect(second.code).toBe(0);
    expect(second.out).toContain("already");
    expect(second.out).not.toContain("failed");
    // Nothing of its own was committed: its HEAD is the first closer's commit, no more.
    expect(headOf(other.repo, "HEAD")).toBe(headOf(contest.remote, "comms"));
    expect(metaInOrigin(contest)).toContain("status: closed");
  });

  // THE OTHER DIRECTION OF THE SAME STALENESS, and the reason the local read no longer
  // decides anything under `--write`: this box's disk says 'closed', which is exactly
  // what is being asked for — and the feed says 'open'. Answered from the disk it would
  // report "already closed" about a thread that is open for everybody else.
  it("a stale box asking for what only ITS disk holds writes anyway — the feed answers, not the disk", () => {
    const contest = contour();
    setStatus(contest, "curator", "closed");
    const other = secondBox(contest); // cloned while the feed said 'closed'
    setStatus(contest, "curator", "open"); // …and then it was reopened

    const second = setStatus(other, "john", "closed");

    expect(second.code).toBe(0);
    expect(second.out).toContain("committed and pushed");
    expect(metaInOrigin(contest)).toContain("status: closed");
  });

  it("without --write nothing is written and the thread stays open", () => {
    const contest = contour();

    const result = setStatus(contest, "curator", "closed", []);

    expect(result.code).toBe(0);
    expect(result.out).toContain("would set");
    expect(metaInOrigin(contest)).toContain("status: open");
  });

  it("a status that is neither 'open' nor 'closed' is refused at the door", () => {
    const contest = contour();

    const result = setStatus(contest, "curator", "done");

    expect(result.code).toBe(2);
    expect(result.out).toContain("'open' or 'closed'");
  });

  it("reopening is the same door — the permission governs the field, not one direction", () => {
    const contest = contour();
    setStatus(contest, "curator", "closed");

    const result = setStatus(contest, "curator", "open");

    expect(result.code).toBe(0);
    expect(metaInOrigin(contest)).toContain("status: open");
  });
});
