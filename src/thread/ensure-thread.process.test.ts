/**
 * THE STITCH of `new-message --ensure-thread` — the standing address, as a real command
 * against a real remote (thread 080, decision of john 2026-09-03).
 *
 * A unit over `chooseReceiver` cannot reach what this is for. The failure the mechanism
 * exists against is not a refusal and not a lost file: the letter into a closed receiver is
 * ACCEPTED, the run is green, and `waitingOnOf` answers `undefined` before it reads a single
 * declaration — nobody is raised and nothing is red. So the acceptance criterion is not "the
 * file is there", it is **`mail --role` names the new receiver**, i.e. the turn actually
 * arrives at a role. That crosses the CLI, the mail walker and the queue, and only the
 * process can say it.
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
    {
      // The writer both notifiers use — a machine event, raised by nobody and reading no card.
      id: "github",
      kind: "gh-action",
      status: "active",
      wake: { mode: "event" },
      summary: "the circuit announcing its own facts",
    },
  ],
};

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

const meta = (status: "open" | "closed"): string =>
  `---\ntitle: T\nparticipants: dev-core, curator, github\nstatus: ${status}\n---\n`;

const letter = (fields: string, text: string): string => `---\n${fields}---\n\n${text}\n`;

type Contour = { repo: string; root: string; body: string; remote: string };

/**
 * A bare `origin` plus the mail checkout — the smallest contour that can tell the truth
 * about a delivery, and the same one `new-message.process.test.ts` uses.
 *
 * `receivers` are the threads of the standing address as they already stand in the feed.
 */
const contour = (receivers: readonly { id: string; body: string }[]): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-ensure-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-ensure-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);

  for (const receiver of receivers) {
    const dir = join(repo, "agent-comms", receiver.id);
    mkdirSync(join(dir, "messages"), { recursive: true });
    writeFileSync(join(dir, "_meta.md"), receiver.body);
    writeFileSync(
      join(dir, "messages", "2026-09-01T10-00-00Z-curator.md"),
      letter(
        "from: curator\ndate: 2026-09-01T10:00:00Z\nexpects: ack\nwaiting-on: dev-core\n",
        "The address opens here.",
      ),
    );
  }

  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");

  // Outside the checkout: delivery refuses a dirty checkout, and a draft inside it is dirt.
  const body = join(mkdtempSync(join(tmpdir(), "agent-protocol-ensure-body-")), "body.md");
  writeFileSync(body, "main is red on 09b8943.\n");
  return { repo, root: join(repo, "agent-comms"), body, remote };
};

/** The notifier's own call: a machine event into a standing address, delivered for real. */
const sendSlug = (
  contest: Contour,
  slug: string,
  ...extra: string[]
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
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--ensure-thread",
        slug,
        "--title",
        "main is red",
        "--participants",
        "dev-core,curator,github",
        "--from",
        "github",
        "--expects",
        "answer",
        "--waiting-on",
        "dev-core",
        "--worker",
        "gh-action",
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

const send = (contest: Contour, ...extra: string[]): { code: number; out: string } =>
  sendSlug(contest, "main-red-alarm", ...extra);

/** What the mail's own queue says is waiting on a role — the only proof the turn arrived. */
const mailOf = (contest: Contour, role: string): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "mail",
      "--repo",
      contest.repo,
      "--root",
      contest.root,
      "--ref",
      "HEAD",
      "--no-fetch",
      "--role",
      role,
    ],
    { encoding: "utf8", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
  );

const threadsIn = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();

const messagesIn = (root: string, id: string): string[] =>
  readdirSync(join(root, id, "messages")).filter((name) => name.endsWith(".md"));

describe("new-message --ensure-thread opens the next receiver of a standing address", () => {
  it("the current receiver is CLOSED: a new one is opened, and the turn arrives at a role", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    const result = send(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("'020-main-red-alarm' is closed and raises nobody");
    expect(threadsIn(contest.root)).toEqual(["020-main-red-alarm", "021-main-red-alarm"]);
    expect(messagesIn(contest.root, "021-main-red-alarm")).toHaveLength(1);
    // THE POINT OF THE WHOLE MECHANISM. Into the closed receiver the letter would have gone
    // just as quietly — and `waitingOnOf` would have answered nobody.
    expect(mailOf(contest, "dev-core").trim().split("\n")).toContain("021-main-red-alarm");
  });

  it("the current receiver is PARKED: the same answer, because a parked thread raises nobody", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("open") }]);
    // A park declared by a role, standing on the feed as the last word.
    writeFileSync(
      join(contest.root, "020-main-red-alarm", "messages", "2026-09-02T10-00-00Z-dev-core.md"),
      letter(
        "from: dev-core\ndate: 2026-09-02T10:00:00Z\nexpects: answer\nwaiting-on: curator\nparked-on: john\n",
        "Waiting for a decision.",
      ),
    );
    execFileSync("git", ["-C", contest.repo, "add", "."]);
    execFileSync(
      "git",
      ["-C", contest.repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "park"],
      { encoding: "utf8" },
    );
    execFileSync("git", ["-C", contest.repo, "push", "-q", "origin", "comms"]);

    const result = send(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("'020-main-red-alarm' is parked and raises nobody");
    expect(threadsIn(contest.root)).toContain("021-main-red-alarm");
    expect(mailOf(contest, "dev-core").trim().split("\n")).toContain("021-main-red-alarm");
  });

  it("the receiver is alive: the letter is appended and NO thread is opened", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("open") }]);

    const result = send(contest);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("raises nobody");
    expect(threadsIn(contest.root)).toEqual(["020-main-red-alarm"]);
    expect(messagesIn(contest.root, "020-main-red-alarm")).toHaveLength(2);
  });

  // Nine letters in an hour is a measured rate (thread 080, `msg-002` §4), so two events of
  // one minute is not a hypothesis. Two calls in a row must end in ONE receiver — this is why
  // the address is resolved INSIDE the delivery attempt and not once, before the lock.
  it("two events on one address open ONE receiver, not two", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    expect(send(contest).code).toBe(0);
    expect(send(contest).code).toBe(0);

    expect(threadsIn(contest.root)).toEqual(["020-main-red-alarm", "021-main-red-alarm"]);
    expect(messagesIn(contest.root, "021-main-red-alarm")).toHaveLength(2);
  });

  // A thread whose `_meta.md` landed in another commit — or not at all — reddens `Comms
  // Derived` on every push into `comms`, and the letter reporting THAT redness is itself a
  // push into `comms`: a 1:1 loop with nobody watching. `--ensure-thread` therefore goes the
  // way `new-thread` goes: a thread is ONE delivery.
  it("the receiver is born whole: `_meta.md` and the first letter in the SAME commit", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    expect(send(contest).code).toBe(0);

    const files = execFileSync(
      "git",
      ["-C", contest.repo, "show", "--name-only", "--format=", "HEAD"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toBe("agent-comms/021-main-red-alarm/_meta.md");
    expect(files[1]).toMatch(/^agent-comms\/021-main-red-alarm\/messages\/.*-github\.md$/);
    // And the head is READ, not merely present: `thread show` is the reader whose silence
    // the whole class hides behind, so it is the reader asked here.
    const shown = execFileSync(
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
        "021-main-red-alarm",
      ],
      { encoding: "utf8", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
    );
    expect(shown).toContain("main is red");
    expect(shown).toContain("main is red on 09b8943.");
  });

  // A door that writes an id the reader never visits is the defect of 086 in a new place: the
  // thread would be committed, pushed, and invisible to `thread show`, to `mail` and to the tick.
  it("the id of the receiver is FLAT — NNN-slug, the form the walker takes", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    expect(send(contest).code).toBe(0);

    const opened = threadsIn(contest.root).filter((id) => id !== "020-main-red-alarm");
    expect(opened).toEqual(["021-main-red-alarm"]);
    expect(opened[0]).toMatch(/^\d{3}-/);
  });

  it("the title and the participants of the receiver come from the flags, not from a guess", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    expect(send(contest).code).toBe(0);

    const head = readFileSync(join(contest.root, "021-main-red-alarm", "_meta.md"), "utf8");
    expect(head).toContain("title: main is red");
    expect(head).toContain("participants: dev-core, curator, github");
    expect(head).toContain("status: open");
  });

  it("refuses a whole id where a slug is asked for — the workflows carry ids today", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    const result = sendSlug(contest, "020-main-red-alarm");

    expect(result.code).toBe(2);
    expect(result.out).toContain("is a whole thread id, not a slug");
    expect(result.out).toContain("'main-red-alarm'");
    expect(threadsIn(contest.root)).toEqual(["020-main-red-alarm"]);
  });

  it("refuses a slug that would open a thread under a name the mail cannot read", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("closed") }]);

    const result = sendSlug(contest, "../evil");

    expect(result.code).toBe(2);
    expect(result.out).toContain("not a slug a thread id can carry");
    expect(threadsIn(contest.root)).toEqual(["020-main-red-alarm"]);
  });

  it("refuses when both --thread and --ensure-thread name where the letter goes", () => {
    const contest = contour([{ id: "020-main-red-alarm", body: meta("open") }]);

    const result = send(contest, "--thread", "020-main-red-alarm");

    expect(result.code).toBe(2);
    expect(result.out).toContain("both name where this letter goes");
    expect(existsSync(join(contest.root, "021-main-red-alarm"))).toBe(false);
  });
});
