/**
 * The PROCESS test of mode (b) of `thread status` — a MISSING head, synthesised from the
 * messages (thread 065, the scope carried over from 042).
 *
 * THE ORDER OF STATES IS THE TEST, and it is the incident of 2026-08-13 replayed: `messages/`
 * on disk with no `_meta.md` → `derive` refuses the thread by name → the repair → `derive`
 * assembles. That thread (066) held six statements of work waiting on dev-core and was invisible
 * to the queue for an afternoon, and the only cure that day was a hand-written mail file — the
 * act the door of 065.1 exists to remove.
 *
 * AND THE SECOND FAILURE IS SHOWN NOT TO BE FIXED, in the same order it appeared live: a message
 * whose own header is malformed keeps the thread unreadable after the head is back. That is the
 * boundary of this mode and not an oversight — repairing it would mean editing somebody's
 * committed message, which the norm of the mail forbids outright. It was invisible on 066 until
 * the first failure was gone, which is exactly why it is asserted here AFTER a repair rather than
 * beside it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

type Contour = { repo: string; root: string; remote: string };

const message = (from: string, date: string, body: string): string =>
  `---\nfrom: ${from}\ndate: ${date}\nexpects: answer\nwaiting-on: dev-core\n---\n\n${body}\n`;

/**
 * A mail holding ONE thread written by a hand outside the writing door: message files and no
 * head. `broken` adds the second half of the live incident — a `date:` no reader accepts in any
 * spelling (it is not the same moment written differently, it is another notation entirely).
 */
const contour = (options: { readonly broken?: boolean } = {}): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-repair-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-repair-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const dir = join(repo, "agent-comms", "066-test-gaps");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(join(repo, "agent-comms", "INDEX.md"), "# threads\n");
  writeFileSync(
    join(dir, "messages", "2026-08-13T17-20-00Z-curator.md"),
    message("curator", "2026-08-13T17:20:00Z", "Test gaps: six statements of work."),
  );
  writeFileSync(
    join(dir, "messages", "2026-08-13T17-28-50Z-curator.md"),
    message(
      "curator",
      options.broken === true ? "13.08.2026 17:28" : "2026-08-13T17:28:50Z",
      "The second one.",
    ),
  );
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "a thread opened by hand");
  git("push", "-q", "origin", "comms");
  return { repo, root: join(repo, "agent-comms"), remote };
};

const run = (contest: Contour, args: readonly string[]): { code: number; out: string } => {
  try {
    const out = execFileSync(TSX, [CLI, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      env: sandbox(configHomeInside(contest.repo), IDENTITY),
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const repair = (
  contest: Contour,
  from: string,
  extra: readonly string[] = ["--write"],
): { code: number; out: string } =>
  run(contest, [
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
    "066-test-gaps",
    "--from",
    from,
    "--repair",
    ...extra,
  ]);

/** `derive` is the reader that refused the whole thread on 2026-08-13 — the honest witness. */
const derive = (contest: Contour, extra: readonly string[] = []): { code: number; out: string } =>
  run(contest, [
    "derive",
    "--repo",
    contest.repo,
    "--root",
    contest.root,
    "--ref",
    "HEAD",
    "--no-fetch",
    ...extra,
  ]);

const metaInOrigin = (contest: Contour): string =>
  execFileSync("git", ["-C", contest.remote, "show", "comms:agent-comms/066-test-gaps/_meta.md"], {
    encoding: "utf8",
  });

describe("thread status --repair — the missing head, synthesised (065, mode (b))", () => {
  it("the three states in order: derive refuses → repair → derive assembles", () => {
    const contest = contour();

    const before = derive(contest);
    expect(before.code).toBe(2);
    expect(before.out).toContain("a thread opened without its head");
    // The refusal names the very command the next two lines run (thread 042): a red `derive`
    // shows whoever is on duty this line and nothing else.
    expect(before.out).toContain("--repair");

    const repaired = repair(contest, "curator");
    expect(repaired.code).toBe(0);
    expect(repaired.out).toContain("committed and pushed");

    // The head is in the FEED, not just on this disk — a thread repaired on one box is a
    // thread still unreadable for everybody else.
    const head = metaInOrigin(contest);
    // The title is the first thing said in the earliest message, the participants are its
    // authors, and the status is 'open': closing is an acceptance, and this is a machine.
    expect(head).toContain("title: Test gaps: six statements of work.");
    expect(head).toContain("participants: curator");
    expect(head).toContain("status: open");

    // Third state: the thread is READ. `derive --write` assembles its derived files —
    // the very ones whose failure rang seven red CI runs while 066 stood headless.
    const after = derive(contest, ["--write"]);
    expect(after.code).toBe(0);
    expect(after.out).not.toContain("could not be read");
    expect(existsSync(join(contest.root, "066-test-gaps", "_thread.md"))).toBe(true);
  });

  it("a title given by hand wins over the synthesised one", () => {
    const contest = contour();

    repair(contest, "curator", ["--title", "Test gaps", "--write"]);

    expect(metaInOrigin(contest)).toContain("title: Test gaps\n");
  });

  it("the SECOND failure is not repaired and is not hidden: a broken message header survives it", () => {
    const contest = contour({ broken: true });

    const repaired = repair(contest, "curator");
    expect(repaired.code).toBe(0);
    // The head IS written — the synthesiser reads the header leniently and takes the one
    // field a head needs, so a broken `date:` does not stop the repair it is not about.
    expect(metaInOrigin(contest)).toContain("participants: curator");

    // And the thread is still refused, now by the failure that was invisible until this one
    // was gone. This is the boundary of the mode, and it is the state a human is told about.
    const after = derive(contest);
    expect(after.code).toBe(2);
    expect(after.out).toContain("messages/2026-08-13T17-28-50Z-curator.md");
    expect(after.out).not.toContain("opened without its head");
  });

  it("a thread that ALREADY has a head is refused — a repair never overwrites an acceptance", () => {
    const contest = contour();
    repair(contest, "curator");

    const again = repair(contest, "curator");

    expect(again.code).toBe(2);
    expect(again.out).toContain("already has a head");
    expect(again.out).toContain("--status");
  });

  it("a role without 'thread-status' is refused BY NAME, and the feed does not move", () => {
    const contest = contour();

    const result = repair(contest, "dev-core");

    expect(result.code).toBe(2);
    expect(result.out).toContain("thread-status");
    expect(result.out).toContain("curator");
    expect(() => metaInOrigin(contest)).toThrow();
  });

  it("without --write nothing is written: the head is printed and the feed stays as it was", () => {
    const contest = contour();

    const dry = repair(contest, "curator", []);

    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would write the missing head");
    expect(dry.out).toContain("status: open");
    expect(() => metaInOrigin(contest)).toThrow();
  });

  it("--repair and --status are two modes of one command, never one call", () => {
    const contest = contour();

    const both = repair(contest, "curator", ["--status", "closed", "--write"]);

    expect(both.code).toBe(2);
    expect(both.out).toContain("two modes of one command");
  });
});
