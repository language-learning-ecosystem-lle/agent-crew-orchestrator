/**
 * THE SEAM A DELIVERY IS (thread 015): the path the caller typed, the file that lands on
 * disk, and the `git add` that stages it — three things that have to be talking about ONE
 * place. They were not, and no unit could have said so: the resolution happens in
 * `cli.ts`, the write in the process's directory and the staging inside the mail checkout,
 * so only a real command in a real repository puts the two bases in the same room.
 *
 * Both halves of the defect are here, because they were one event: a relative `--root`
 * typed from inside the checkout died on `fatal: … is outside repository` — AFTER the
 * message file had been written — and the orphan it left made every LATER send by every
 * role refuse with "the mail checkout has uncommitted changes". The mail of the circuit
 * was shut by one mistyped path until a hand cleaned it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
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
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "k" },
      summary: "the keeper",
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";

type Contour = { repo: string; root: string; body: string; remote: string };

const FIRST =
  "---\nfrom: curator\ndate: 2026-08-19T09:20:41Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe question.\n";

/**
 * A bare remote, one mail checkout on `comms`, one thread WITH a message in it — and a
 * body file OUTSIDE both.
 *
 * The thread carries a committed message on purpose: that is the shape every thread in a
 * feed has (`new-thread` delivers `_meta.md` and the first message as ONE commit), and an
 * EMPTY `messages/` is a directory git does not track at all — the fixture would then be
 * telling a story about untracked dirt rather than about a delivery.
 */
const contour = (): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-root-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-root-mail-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const thread = join(repo, "agent-comms", "015-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-08-19T09-20-41Z-curator.md"), FIRST);
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");

  const body = join(mkdtempSync(join(tmpdir(), "agent-protocol-root-body-")), "body.md");
  writeFileSync(body, "The answer.\n");
  return { repo, root: join(repo, "agent-comms"), body, remote };
};

/**
 * `new-message --write` with the root spelled as the caller spells it, from `cwd`.
 *
 * `--worker` is passed OUT LOUD, as every other process test of this command does: the
 * writing door requires it, and the only other way to satisfy it is the launch channel
 * — an environment variable a raised session has and a runner does not. This helper
 * inherited it once, which bought three green runs on the box and three red cases on
 * the runner (thread 015, 2026-08-19); `sandbox()` now removes the whole channel, and
 * this line is what says which provenance the delivery is being measured under.
 */
const send = (
  contest: Contour,
  options: { root: string; cwd: string },
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-message",
        "--repo",
        contest.repo,
        "--root",
        options.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--thread",
        "015-x",
        "--from",
        "dev-core",
        "--expects",
        "answer",
        "--waiting-on",
        "curator",
        "--body-file",
        contest.body,
        "--worker",
        "claude-code",
        "--write",
      ],
      {
        encoding: "utf8",
        stdio: "pipe",
        cwd: options.cwd,
        env: sandbox(configHomeInside(contest.repo), {}),
      },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** The message files of the thread — an absent `messages/` is "none", not a crash. */
const messages = (contest: Contour): string[] => {
  const dir = join(contest.root, "015-x", "messages");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : [];
};

const dirt = (contest: Contour): string =>
  execFileSync("git", ["-C", contest.repo, "status", "--porcelain"], { encoding: "utf8" }).trim();

describe("new-message and the base of --root", () => {
  // The live failure, in the directory it happened in: the value is relative to the mail
  // directory the caller stands in, and `git -C <checkout>` measures it from the root of
  // the repository — two bases, one string.
  it("a relative root typed from inside the checkout delivers", () => {
    const contest = contour();

    const result = send(contest, { root: "../agent-comms", cwd: contest.root });

    expect(result.code).toBe(0);
    expect(result.out).toContain("sent 015-x/messages/");
    expect(messages(contest)).toHaveLength(2);
    expect(dirt(contest)).toBe("");
    // Delivered, not just written: the file is in the feed the other roles read.
    const feed = execFileSync(
      "git",
      ["-C", contest.remote, "ls-tree", "-r", "--name-only", "comms"],
      {
        encoding: "utf8",
      },
    );
    expect(feed).toContain("agent-comms/015-x/messages/");
  });

  it("a relative root from another directory names the same place as an absolute one", () => {
    const contest = contour();

    const result = send(contest, { root: "agent-comms", cwd: contest.repo });

    expect(result.code).toBe(0);
    expect(messages(contest)).toHaveLength(2);
  });

  // The trace, which is the expensive half: a delivery that fell over between the write
  // and the commit used to leave the message file behind, and delivery refuses a dirty
  // checkout — so the failure of ONE send became the failure of every send afterwards.
  // The hook is how a commit is refused for real (the mail checkout carries commit-msg).
  it("a failed write leaves no orphan file, and the next send goes through", () => {
    const contest = contour();
    const hook = join(contest.repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    const refused = send(contest, { root: contest.root, cwd: contest.repo });

    expect(refused.code).toBe(2);
    expect(refused.out).toContain("git commit");
    expect(messages(contest)).toEqual(["2026-08-19T09-20-41Z-curator.md"]);
    expect(dirt(contest)).toBe("");

    // And the mail is not shut: with the cause gone, the very next send delivers.
    writeFileSync(hook, "#!/bin/sh\nexit 0\n");
    const sent = send(contest, { root: contest.root, cwd: contest.repo });

    expect(sent.code).toBe(0);
    expect(messages(contest)).toHaveLength(2);
    expect(existsSync(join(contest.root, "015-x", "_meta.md"))).toBe(true);
  });
});
