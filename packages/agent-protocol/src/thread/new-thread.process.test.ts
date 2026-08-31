/**
 * The PROCESS test of `new-thread` — the OTHER writing door, checked as a real command
 * against a real remote (thread 033).
 *
 * WHY IT READS THE FEED OUT OF `origin` AND NEVER OFF THE DISK. The defect this file is
 * the acceptance of was exactly a command that wrote its files, printed "thread created"
 * and delivered nothing: a test asserting the files exist would have passed on it. The
 * question a test has to ask here is the one the agent asks — "is it in the feed?" — so
 * every case below looks at `git ls-tree` of the bare origin.
 */
import { execFileSync } from "node:child_process";
import {
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
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";
import { parseMessageFile } from "./message.js";

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
    },
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
    },
  ],
};

/**
 * The identity goes in the ENVIRONMENT: the commit is made by the CLI several git calls
 * deep, and a temporary checkout has no identity of its own — on the runner there is no
 * global config to fall back on either.
 */
const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

type Contour = { repo: string; root: string; body: string; remote: string };

/** A bare origin on the mail branch, a checkout of it, and a body file OUTSIDE the mail. */
const contour = (): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-nt-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-nt-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  mkdirSync(join(repo, "agent-comms"), { recursive: true });
  writeFileSync(join(repo, "agent-comms", "INDEX.md"), "# threads\n");
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");

  // Outside the checkout on purpose: delivery refuses a dirty checkout, and an untracked
  // draft beside the mail is dirt like any other.
  const body = join(mkdtempSync(join(tmpdir(), "agent-protocol-nt-body-")), "body.md");
  writeFileSync(body, "The statement of work.\n");
  return { repo, root: join(repo, "agent-comms"), body, remote };
};

const open = (contest: Contour, extra: readonly string[] = []): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-thread",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--id",
        "040-new",
        "--title",
        "A new conversation",
        "--participants",
        "dev-core,curator",
        "--from",
        "dev-core",
        "--expects",
        "answer",
        "--waiting-on",
        "curator",
        "--worker",
        "claude-code",
        "--body-file",
        contest.body,
        "--write",
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
 * The same command with the header fields typed by the case rather than by the helper
 * above: `--expects` and `--waiting-on` are read with `indexOf`, so a value appended
 * after the defaults would never be seen — a park tested against `--expects none` has
 * to type the whole line.
 */
const openWith = (
  contest: Contour,
  fields: readonly string[],
): { code: number; out: string; id: string } => {
  const id = "042-park";
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-thread",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--id",
        id,
        "--title",
        "A question to the owner of a decision",
        "--participants",
        "dev-core,curator",
        "--from",
        "curator",
        "--worker",
        "claude-code",
        "--body-file",
        contest.body,
        ...fields,
        "--write",
        "--no-push",
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
    );
    return { code: 0, out, id };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}`, id };
  }
};

/** The header of the one message the thread was born with. */
const firstHeader = (contest: Contour, id: string): ReturnType<typeof parseMessageFile> => {
  const dir = join(contest.root, id, "messages");
  const names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  return parseMessageFile(readFileSync(join(dir, names[0] as string), "utf8"));
};

/** THE ONLY QUESTION WORTH ASKING: what does the feed in origin actually hold? */
const inOrigin = (contest: Contour): string =>
  execFileSync("git", ["-C", contest.remote, "ls-tree", "-r", "--name-only", "comms"], {
    encoding: "utf8",
  });

describe("new-thread --write delivers (R3, thread 033)", () => {
  it("one action: the files, the commit and the push — the thread is in the FEED", () => {
    const contest = contour();

    const result = open(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("committed and pushed");
    const feed = inOrigin(contest);
    expect(feed).toContain("agent-comms/040-new/_meta.md");
    expect(feed).toMatch(/agent-comms\/040-new\/messages\/.*-dev-core\.md/);
  });

  it("leaves the mail checkout clean — a delivered thread is not a diff somebody has to notice", () => {
    const contest = contour();
    open(contest);

    expect(
      execFileSync("git", ["-C", contest.repo, "status", "--porcelain"], { encoding: "utf8" }),
    ).toBe("");
  });

  it("the meta and the first message are ONE commit — half a thread is not a thread", () => {
    const contest = contour();
    open(contest);

    const changed = execFileSync(
      "git",
      ["-C", contest.repo, "show", "--name-only", "--format=", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    expect(changed).toContain("040-new/_meta.md");
    expect(changed).toContain("040-new/messages/");
    // The derived files stay the generator's business, here as in `new-message`.
    expect(changed).not.toContain("_thread.md");
    expect(changed).not.toContain("INDEX.md");
  });

  // 027: the mail checkout is shared by every role on the box, so its identity cannot be
  // configured — the signature travels with the commit.
  it("the commit is authored by the role that opened the thread", () => {
    const contest = contour();
    open(contest);

    expect(
      execFileSync("git", ["-C", contest.repo, "log", "-1", "--format=%an <%ae>"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("dev-core <dev-core@agents.invalid>");
  });

  it("a feed that moved underneath the writer is retried, not reported as a failure", () => {
    const contest = contour();
    // Somebody else pushes into the branch first: our push is rejected and the attempt
    // replans on top of theirs.
    const other = mkdtempSync(join(tmpdir(), "agent-protocol-nt-other-"));
    execFileSync("git", ["-C", other, "clone", "-q", "-b", "comms", contest.remote, "."]);
    writeFileSync(join(other, "agent-comms", "INDEX.md"), "# threads\n\n- theirs\n");
    for (const args of [
      ["add", "."],
      ["commit", "-qm", "theirs"],
    ]) {
      execFileSync("git", ["-C", other, "-c", "user.name=t", "-c", "user.email=t@e", ...args]);
    }
    execFileSync("git", ["-C", other, "push", "-q", "origin", "comms"]);

    const result = open(contest);

    expect(result.code).toBe(0);
    const feed = inOrigin(contest);
    expect(feed).toContain("agent-comms/040-new/_meta.md");
    // And theirs survived: append-only means the loser of the race is replanned, never
    // overwritten.
    expect(
      execFileSync("git", ["-C", contest.remote, "show", "comms:agent-comms/INDEX.md"], {
        encoding: "utf8",
      }),
    ).toContain("theirs");
  });

  it("a git that refuses says WHY, and nothing is left half-written on disk", () => {
    const contest = contour();
    execFileSync("git", ["-C", contest.repo, "remote", "set-url", "origin", "/nowhere/at/all"]);

    const result = open(contest);

    expect(result.code).toBe(2);
    expect(result.out).toContain("git fetch");
    expect(existsSync(join(contest.root, "040-new"))).toBe(false);
  });

  it("--no-push writes the files and SAYS it did not commit — the CI caller owns its git", () => {
    const contest = contour();

    const result = open(contest, ["--no-push"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("NOT committed");
    expect(existsSync(join(contest.root, "040-new", "_meta.md"))).toBe(true);
    expect(inOrigin(contest)).not.toContain("040-new");
  });

  it("without --write it delivers nothing and writes nothing", () => {
    const contest = contour();

    const dry = execFileSync(
      TSX,
      [
        CLI,
        "new-thread",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--id",
        "041-dry",
        "--title",
        "T",
        "--participants",
        "dev-core,curator",
        "--from",
        "dev-core",
        "--expects",
        "answer",
        "--waiting-on",
        "curator",
        "--worker",
        "claude-code",
        "--body-file",
        contest.body,
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
    );
    expect(dry).toContain("would create thread 041-dry");
    expect(existsSync(join(contest.root, "041-dry"))).toBe(false);
    expect(inOrigin(contest)).not.toContain("041-dry");
  });
});

/**
 * THE PARK OF AN OPENING MESSAGE (thread 075). A question to the owner of a decision
 * is very often what OPENS a conversation — 074 is the live case — and until
 * 2026-08-14 `--parked-on` was parsed for `new-message` alone: `new-thread` accepted
 * the flag, said nothing and wrote a header without it. The failure is invisible at
 * the door and visible one tick later, as a pair raised on a thread that is waiting
 * for a person.
 *
 * Nothing here is a new rule: every case below is `new-message`'s door, asked of the
 * second entrance.
 */
describe("new-thread and the turn parked behind a person (R27, thread 075)", () => {
  it("the header of the FIRST message carries the park", () => {
    const contest = contour();

    const opened = openWith(contest, [
      "--expects",
      "ack",
      "--waiting-on",
      "curator",
      "--parked-on",
      "john",
    ]);

    expect(opened.code).toBe(0);
    expect(firstHeader(contest, opened.id).fields.parkedOn).toBe("john");
  });

  it("a park with '--expects none' is legal — the park as a MODE, a line of state that calls nobody", () => {
    const contest = contour();

    const opened = openWith(contest, ["--expects", "none", "--parked-on", "john"]);

    expect(opened.code).toBe(0);
    expect(firstHeader(contest, opened.id).fields.parkedOn).toBe("john");
  });

  // THE EVENT PARK THROUGH THE SECOND ENTRANCE (thread 030, Д-3). `--parked-on pr:N` had no
  // case in this file at all: the shape check and the note of the lift were covered on
  // `new-message` only, and this door was the one 075 had already caught swallowing the flag
  // in silence. A thread OPENED frozen behind a merge is the live shape — the freeze of
  // 2026-08-21 that stood 8 hours was declared exactly like this — so the note has to reach
  // the writer here too, not only on the reply.
  it("a thread OPENED behind a merge carries the park and is told what lifts it", () => {
    const contest = contour();

    const opened = openWith(contest, [
      "--expects",
      "none",
      "--parked-on",
      "pr:366",
      "--park-mover",
      "curator",
    ]);

    expect(opened.code).toBe(0);
    expect(firstHeader(contest, opened.id).fields.parkedOn).toBe("pr:366");
    expect(opened.out).toContain("lifts on ONE thing");
    expect(opened.out).toContain("'merged-pr: 366'");
    expect(opened.out).toContain("NOTHING WATCHES THE STATE OF #366");
  });

  // THE DELIVERY THROUGH THE SECOND ENTRANCE (thread 030, (в1)) — the lesson of 075 applied to
  // the new field the day it is born: a thread is often OPENED by the courier of a decision, and
  // the park that word lifts stands in ANOTHER thread. A flag parsed by one command of the pair
  // and swallowed by the other writes a silent header into an append-only feed.
  it("a thread OPENED by the courier of a decision carries the delivery in its first header", () => {
    const contest = contour();

    const opened = openWith(contest, ["--expects", "none", "--delivers", "john"]);

    expect(opened.code).toBe(0);
    expect(firstHeader(contest, opened.id).fields.delivers).toBe("john");
  });

  it("--delivers with a role the circuit CAN wake is refused here too, by the same door", () => {
    const contest = contour();

    const opened = openWith(contest, ["--expects", "ack", "--delivers", "dev-core"]);

    expect(opened.code).toBe(2);
    expect(opened.out).toContain("--delivers 'dev-core'");
    expect(existsSync(join(contest.root, opened.id))).toBe(false);
  });

  it("THE VERDICT PAIR IS PARSED BY THIS DOOR TOO, and refused by it in half (042)", () => {
    // Both doors of the pair judge it the same way, for the reason `--delivers` and `--parked-on`
    // are here: what one command swallows it swallows into an append-only feed. In an OPENING
    // message the fields open no turn — the walk looks for a park EARLIER in the thread, and
    // there is none — but a declared field is written, not eaten.
    const contest = contour();

    const opened = openWith(contest, [
      "--expects",
      "answer",
      "--verdict",
      "needs-fixes",
      "--pr",
      "96",
    ]);
    expect(opened.code).toBe(0);
    const header = firstHeader(contest, opened.id).fields;
    expect([header.verdict, header.pr]).toEqual(["needs-fixes", 96]);

    const half = contour();
    const refused = openWith(half, ["--expects", "answer", "--pr", "96"]);
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("--verdict approve");
    expect(existsSync(join(half.root, refused.id))).toBe(false);
  });

  it("a role the circuit CAN wake is refused here too — that is a turn to pass, not a person to wait for", () => {
    const contest = contour();

    const opened = openWith(contest, ["--expects", "ack", "--parked-on", "dev-core"]);

    expect(opened.code).toBe(2);
    expect(opened.out).toContain("--waiting-on dev-core");
    expect(existsSync(join(contest.root, opened.id))).toBe(false);
  });
});

/**
 * THE DOOR ON THE WRITING COMMAND (thread 075, item (a)). `--parked-on` was swallowed
 * because `new-thread` had no argument check at all — `flag()` reads argv by `indexOf`,
 * and an unknown token is not an error there, it is nothing. On a mail command that
 * "nothing" lands in an append-only feed.
 */
describe("new-thread refuses what it does not understand", () => {
  it("an unknown flag is refused BY NAME, and no thread is opened", () => {
    const contest = contour();

    const result = open(contest, ["--parked-onn", "john"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("--parked-onn");
    expect(existsSync(join(contest.root, "040-new"))).toBe(false);
    expect(inOrigin(contest)).not.toContain("040-new");
  });

  it("'--flag=value' is named as the spelling this CLI does not read, not as a typo", () => {
    const contest = contour();

    const result = open(contest, ["--parked-on=john"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("--parked-on <value>");
    expect(inOrigin(contest)).not.toContain("040-new");
  });
});
