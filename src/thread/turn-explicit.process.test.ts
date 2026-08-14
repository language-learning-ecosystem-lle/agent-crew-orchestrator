/**
 * The PROCESS test of `turn: explicit` — the form a THREAD declares for its answers
 * (thread 079), checked as real commands.
 *
 * THE CASE THAT CARRIES THIS FILE IS THE NEGATIVE ONE. The defect being closed — an
 * answer that leaves the turn where it was and raises a pair on a thread where nothing
 * happened — is INVISIBLE in the messages: on a receiving thread a fieldless answer is
 * always terminal, on a working thread the same bytes are the ordinary middle of the
 * work (rule 11). Three predicates were counted over the live mail (2875 messages) and
 * the narrowest of them refused 32 messages to catch three or four defects. So the
 * declaration is the mechanism, and "a thread that declared nothing behaves exactly as
 * it did" is not a footnote — it is the property the measurement bought.
 *
 * The door itself is checked in BOTH writing commands, because a rule one of them holds
 * and the other does not is a rule nobody can keep in their head (the argument of 042).
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
  AGENT_PROTOCOL_WORKER: "human",
};

type Contour = { repo: string; root: string; remote: string; body: string };

const META = "---\ntitle: The receiver\nparticipants: dev-core, curator\nstatus: open\n---\n";

const MESSAGE = `---
from: curator
date: 2026-08-14T10:00:00Z
expects: answer
waiting-on: dev-core
---

The statement of work.
`;

/** A bare origin on the mail branch, a checkout of it, one open thread and a body file. */
const contour = (): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-turn-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-turn-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const dir = join(repo, "agent-comms", "041-notifier");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(join(repo, "agent-comms", "INDEX.md"), "# threads\n");
  writeFileSync(join(dir, "_meta.md"), META);
  writeFileSync(join(dir, "messages", "2026-08-14T10-00-00Z-curator.md"), MESSAGE);
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");
  // The body lives OUTSIDE the mail checkout, as the protocol requires of every writer.
  const body = join(mkdtempSync(join(tmpdir(), "agent-protocol-turn-body-")), "body.md");
  writeFileSync(body, "The answer.\n");
  return { repo, root: join(repo, "agent-comms"), remote, body };
};

const cli = (contest: Contour, args: readonly string[]): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [CLI, ...args, "--repo", contest.repo, "--root", contest.root, "--ref", "HEAD", "--no-fetch"],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const declare = (contest: Contour, from = "curator", value = "explicit") =>
  cli(contest, [
    "thread",
    "status",
    "--thread",
    "041-notifier",
    "--from",
    from,
    "--turn",
    value,
    "--write",
  ]);

/** An answer written by the role that holds the turn — with or without the field. */
const answer = (contest: Contour, extra: readonly string[]) =>
  cli(contest, [
    "new-message",
    "--thread",
    "041-notifier",
    "--from",
    "dev-core",
    "--expects",
    "answer",
    "--worker",
    "human",
    "--body-file",
    contest.body,
    ...extra,
    "--write",
  ]);

const open = (contest: Contour, extra: readonly string[]) =>
  cli(contest, [
    "new-thread",
    "--id",
    "080-new",
    "--title",
    "A thread",
    "--participants",
    "dev-core, curator",
    "--from",
    "curator",
    "--expects",
    "answer",
    "--worker",
    "human",
    "--body-file",
    contest.body,
    ...extra,
    "--write",
  ]);

/** The only question worth asking about a delivery: what does the feed hold? */
const metaInOrigin = (contest: Contour, id = "041-notifier"): string =>
  execFileSync("git", ["-C", contest.remote, "show", `comms:agent-comms/${id}/_meta.md`], {
    encoding: "utf8",
  });

const messagesInOrigin = (contest: Contour): string =>
  execFileSync("git", ["-C", contest.remote, "ls-tree", "-r", "--name-only", "comms"], {
    encoding: "utf8",
  });

describe("the key 'turn: explicit' and its door (thread 079)", () => {
  it("a role WITH 'thread-status' declares the form, and the feed carries it beside the status", () => {
    const contest = contour();

    const result = declare(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("committed and pushed");
    expect(metaInOrigin(contest)).toContain("turn: explicit");
    expect(metaInOrigin(contest)).toContain("status: open");
  });

  it("a role WITHOUT it is refused BY NAME, and the feed does not move", () => {
    const contest = contour();

    const result = declare(contest, "dev-core");

    expect(result.code).toBe(2);
    expect(result.out).toContain("thread-status");
    expect(result.out).toContain("curator");
    expect(metaInOrigin(contest)).not.toContain("turn:");
  });

  it("a value the key does not know is refused, naming the two states it has", () => {
    const contest = contour();

    const result = declare(contest, "curator", "strict");

    expect(result.code).toBe(2);
    expect(result.out).toContain("explicit");
    expect(metaInOrigin(contest)).not.toContain("turn:");
  });

  it("'--turn' and '--status' in one call are refused: two decisions about one file", () => {
    const contest = contour();

    const result = cli(contest, [
      "thread",
      "status",
      "--thread",
      "041-notifier",
      "--from",
      "curator",
      "--turn",
      "explicit",
      "--status",
      "closed",
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("two decisions");
  });

  it("on a declared thread a message without --waiting-on is refused, and BOTH exits are named", () => {
    const contest = contour();
    declare(contest);

    const result = answer(contest, []);

    expect(result.code).toBe(2);
    expect(result.out).toContain("turn: explicit");
    // The door does not pick between "I hand the turn over" and "I take it off the
    // thread" — they are two different statements (the manner of 058).
    expect(result.out).toContain("--waiting-on <role>");
    expect(result.out).toContain("--waiting-on —");
    expect(messagesInOrigin(contest)).not.toContain("dev-core.md");
  });

  it("both exits actually pass: naming a role, and taking the turn off the thread", () => {
    const handed = contour();
    declare(handed);
    expect(answer(handed, ["--waiting-on", "curator"]).code).toBe(0);

    const released = contour();
    declare(released);
    expect(answer(released, ["--waiting-on", "—"]).code).toBe(0);
  });

  // THE CASE THIS FILE STANDS ON. The three predicates measured on the live mail all
  // died here: a fieldless message is the legal middle of a working thread, and there
  // are dozens of them for every defect. A thread that declared nothing sees no door.
  it("on a thread that declared NOTHING a message without --waiting-on passes, unchanged", () => {
    const contest = contour();

    const result = answer(contest, []);

    expect(result.code).toBe(0);
    expect(result.out).toContain("committed and pushed");
    expect(messagesInOrigin(contest)).toContain("041-notifier/messages/");
  });

  it("withdrawing the key gives the thread its old behaviour back", () => {
    const contest = contour();
    declare(contest);
    const withdrawn = declare(contest, "curator", "—");

    expect(withdrawn.code).toBe(0);
    expect(metaInOrigin(contest)).not.toContain("turn:");
    expect(answer(contest, []).code).toBe(0);
  });

  it("new-thread declares the form at birth — and its own first message obeys it", () => {
    const contest = contour();

    const refused = open(contest, ["--turn", "explicit"]);
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("--waiting-on");

    const created = open(contest, ["--turn", "explicit", "--waiting-on", "dev-core"]);
    expect(created.code).toBe(0);
    expect(metaInOrigin(contest, "080-new")).toContain("turn: explicit");
  });

  it("new-thread checks the same permission — the form is not the opener's to give", () => {
    const contest = contour();

    const result = cli(contest, [
      "new-thread",
      "--id",
      "080-new",
      "--title",
      "A thread",
      "--participants",
      "dev-core, curator",
      "--from",
      "dev-core",
      "--expects",
      "answer",
      "--worker",
      "human",
      "--body-file",
      contest.body,
      "--turn",
      "explicit",
      "--waiting-on",
      "curator",
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("thread-status");
    expect(messagesInOrigin(contest)).not.toContain("080-new");
  });
});
