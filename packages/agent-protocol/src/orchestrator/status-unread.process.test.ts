/**
 * THE COUNT OF THE UNREAD IN THE OPERATOR'S FRAME (065.4, thread `065-protocol-debts`).
 *
 * WHY A PROCESS TEST, AND WHY THIS ONE DID NOT EXIST. The count in `mail` is covered by
 * `mail-unread.process.test.ts`; the same promise in the frame was not covered anywhere.
 * The unit tests around `queueNotes` (`snapshot.test.ts`) hand `renderFrame` a queueNotes
 * array they built themselves — the assembly inside `operatorFrame` (the count line, the
 * per-thread causes, the ignored roles) is never called by any of them. So a flipped sign,
 * a `hits.length` copied where `failures.length` belongs, or the line simply falling out of
 * a refactor of `operatorFrame` would pass a green package while the frame quietly went
 * back to a queue that is short for no stated reason — the very defect 065.4 closes.
 *
 * Only a run of the real command through the real wiring sees it: the mail is written with
 * both shapes of a thread written by hand — one with `messages/` and no `_meta.md`, one
 * whose `date:` is no moment at all — each of which must keep its own words.
 *
 * THE DAY'S SECOND CAUSE STANDS HERE AS A READABLE THREAD (`065-off-canon`): variant (iv)
 * of this same thread (#272) made the file-name spelling of a stamp READ rather than
 * refused, so it belongs in the queue and in no count. It is kept in the fixture on
 * purpose — the frame that counted it as a loss would be lying by exactly one thread.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
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
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const handoff = (date: string): string =>
  `---\nfrom: curator\ndate: ${date}\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n`;

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";

/**
 * A contour whose mail holds one readable thread and both of the day's broken ones. The
 * message file names are canonical everywhere — the second thread is broken by its HEADER,
 * which is the failure that only became visible after the first one was repaired.
 */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-frame-unread-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");

  const write = (id: string, meta: string | undefined, message: string): void => {
    const dir = join(mail, "agent-comms", id);
    mkdirSync(join(dir, "messages"), { recursive: true });
    if (meta !== undefined) writeFileSync(join(dir, "_meta.md"), meta);
    writeFileSync(join(dir, "messages", "2026-08-13T17-28-50Z-curator.md"), message);
  };

  write("019-readable", META, handoff("2026-08-13T17:28:50Z"));
  // Read since (iv), and therefore queued: the file-name spelling of this file's own stamp.
  write("065-off-canon", META, handoff("2026-08-13T17-28-50Z"));
  // Cause one: half-migrated by hand — the messages are there, the head of the thread is not.
  write("066-no-meta", undefined, handoff("2026-08-13T17:28:50Z"));
  // Cause two: a `date:` written by hand that is no moment in any spelling.
  write("064-bad-date", META, handoff("13.08.2026 17:28"));

  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

const status = (repo: string): { code: number; out: string; err: string } => {
  const result = spawnSync(
    TSX,
    [CLI, "orchestrator", "status", "--ref", "HEAD", "--no-fetch", "--repo", repo],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

describe("`orchestrator status` — the frame says how many threads it could not read", () => {
  it("counts them above their causes, in the queue the operator is reading", () => {
    const result = status(contour());

    // The count first: the queue below is short BECAUSE of these two, and that is the
    // fact the per-thread lines never carried.
    expect(result.out).toContain("2 thread(s) were NOT READ — the queue is narrowed by that much:");
    // Each cause keeps its own words — "2 skipped" would be the same blindness with a number.
    expect(result.out).toContain(
      "thread '066-no-meta' could not be read: half-migrated thread: 'messages/' is present but '_meta.md' is missing",
    );
    expect(result.out).toContain("thread '064-bad-date' could not be read:");
    expect(result.out).toContain("13.08.2026 17:28");
    // The frame is not broken by them: the readable threads are still queued, exit 0 —
    // and the off-canon one is among them, counted as a loss nowhere.
    expect(result.out).toContain("dev-core×019-readable");
    expect(result.out).toContain("dev-core×065-off-canon");
    expect(result.code).toBe(0);
  });

  it("says nothing at all when every thread was read — the zero case is silence", () => {
    const repo = contour();
    // Take both broken threads out of the same mail and re-publish it.
    const mail = join(repo, "mailco");
    git(mail, "rm", "-rq", "agent-comms/066-no-meta", "agent-comms/064-bad-date");
    git(mail, "commit", "-qm", "repaired");
    git(mail, "push", "-q", "origin", "comms");

    const result = status(repo);

    expect(result.out).not.toContain("NOT READ");
    expect(result.out).not.toContain("could not be read");
    expect(result.out).toContain("dev-core×019-readable");
    // The off-canon thread is left in the mail on purpose: silence has to survive it too.
    expect(result.out).toContain("dev-core×065-off-canon");
    expect(result.code).toBe(0);
  });
});
