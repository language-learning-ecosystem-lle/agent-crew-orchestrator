/**
 * THE INPUT NAMES WHAT IT COULD NOT READ, AND COUNTS IT (thread 065, task 065.4).
 *
 * The measured incident, twice on 2026-08-13: thread 066 was opened by hand, held six
 * statements waiting on dev-core, and was unreadable — first because `_meta.md` was
 * missing, then, once that was repaired, because a message header carried a `date:` in
 * the shape of the FILE NAME (`T17-28-50Z`) instead of a UTC stamp. `cli mail` printed
 * the readable threads and looked like an ordinary working input; seven red `Comms
 * Derived` runs shouted in GitHub and not one line reached the circuit that raises roles.
 *
 * WHAT THIS TEST FIXES IN PLACE, therefore, is not one string but the shape of the
 * answer: mail does NOT break on an unreadable thread (the readable ones are still
 * printed, exit 0), each cause is named in ITS OWN words rather than as a common
 * "skipped", and the COUNT is said — because a narrowed selection printed without one
 * reads exactly like a complete one.
 *
 * THE SECOND OF THE DAY'S CAUSES IS NO LONGER A CAUSE, and this file says so with a
 * thread rather than a sentence: variant (iv) of the same thread (#272) made the reader
 * TOLERANT of the file-name spelling — the same moment written another way is read, not
 * refused. So `065-off-canon` carries exactly the header that broke 066 that evening and
 * is expected in the INPUT, not in the count; what is refused here is a `date:` that is
 * not that moment in any spelling. Both facts are load-bearing and they hold each other:
 * were (iv) reverted, the off-canon thread would fall out of the input and this file
 * would go red on the line that says the input is whole.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "./schema/version.js";
import { configHomeInside, sandbox } from "./testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));

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

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

const META = "---\ntitle: A conversation\nparticipants: dev-core, curator\nstatus: open\n---\n";

const message = (stamp: string): string =>
  `---\nfrom: curator\ndate: ${stamp}\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe statement of work.\n`;

/**
 * A mail root holding one readable thread waiting on dev-core and BOTH of the shapes a
 * thread written by hand comes out in — each is a separate directory, so one run of
 * `mail` meets them together, the way the circuit did.
 */
const mailbox = (): { repo: string; root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-mail-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const root = join(repo, "agent-comms");

  const good = join(root, "064-readable", "messages");
  mkdirSync(good, { recursive: true });
  writeFileSync(join(root, "064-readable", "_meta.md"), META);
  writeFileSync(join(good, "2026-08-13T10-00-00Z-curator.md"), message("2026-08-13T10:00:00Z"));

  // NOT a cause since (iv): the header carries the file name's spelling of its own stamp —
  // the same moment, other bytes. It belongs to the input and must be counted nowhere.
  const offCanon = join(root, "065-off-canon", "messages");
  mkdirSync(offCanon, { recursive: true });
  writeFileSync(join(root, "065-off-canon", "_meta.md"), META);
  writeFileSync(join(offCanon, "2026-08-13T17-28-50Z-curator.md"), message("2026-08-13T17-28-50Z"));

  // Cause one: opened by hand, `messages/` without `_meta.md`.
  const noMeta = join(root, "066-no-meta", "messages");
  mkdirSync(noMeta, { recursive: true });
  writeFileSync(join(noMeta, "2026-08-13T17-28-50Z-curator.md"), message("2026-08-13T17:28:50Z"));

  // Cause two: the meta is there, and the header holds something that is no moment at all —
  // the half of the strictness (iv) deliberately kept.
  const badDate = join(root, "067-bad-date", "messages");
  mkdirSync(badDate, { recursive: true });
  writeFileSync(join(root, "067-bad-date", "_meta.md"), META);
  writeFileSync(join(badDate, "2026-08-13T17-28-50Z-curator.md"), message("13.08.2026 17:28"));

  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "init",
  ]);
  return { repo, root };
};

/**
 * The two streams are kept APART on purpose: stdout is read by scripts (one thread id
 * per line) and the alarm goes to stderr, so a test that folded them together could not
 * tell "the input is narrowed" from "the input is this".
 */
const mail = (box: { repo: string; root: string }): { code: number; out: string; err: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "mail",
      "--repo",
      box.repo,
      "--root",
      box.root,
      "--ref",
      "HEAD",
      "--no-fetch",
      "--role",
      "dev-core",
    ],
    { encoding: "utf8", env: sandbox(configHomeInside(box.repo), IDENTITY) },
  );
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

describe("mail — what it could not read is named and counted (065.4)", () => {
  it("the readable thread is still printed and the exit code is 0 — the input does not break", () => {
    const result = mail(mailbox());

    expect(result.code).toBe(0);
    // The off-canon one is IN here, not in the count below: (iv) reads that spelling.
    expect(result.out.trim().split("\n")).toEqual(["064-readable", "065-off-canon"]);
  });

  it("says HOW MANY were not read — a narrowed selection must not read like a full one", () => {
    const result = mail(mailbox());

    expect(result.err).toContain("2 thread(s) of the mail were NOT READ");
    // …and how much is left, so the two numbers stand beside each other.
    expect(result.err).toContain("2 id(s) above");
    // A thread read in an off-canon spelling is not a loss and is never counted as one.
    expect(result.err).not.toContain("065-off-canon");
  });

  it("names each unread thread by id and each cause in ITS OWN words, not as one 'skipped'", () => {
    const result = mail(mailbox());

    expect(result.err).toContain("066-no-meta");
    expect(result.err).toContain("'messages/' is present but '_meta.md' is missing");
    expect(result.err).toContain("067-bad-date");
    expect(result.err).toContain("a UTC stamp like");
    // The raw bytes of the header, not a normalized guess: the person goes to look at
    // what actually lies in the file.
    expect(result.err).toContain("13.08.2026 17:28");
  });
});
