/**
 * THE PROCESS TEST OF THE TOLERANT READER (thread 065, variant (iv)).
 *
 * The live case it is built from is thread 066 on 2026-08-13: a thread opened BY HAND carried
 * `date: 2026-08-13T17-28-50Z` in the header of one message — the file-name spelling of the
 * stamp, copied from the file name — and the reader refused the whole conversation over it.
 * The refusal was not even the first one: it became visible only after a missing `_meta.md`
 * before it was repaired by hand, which is why the process form matters here rather than a unit.
 *
 * Two facts are asserted TOGETHER, because either alone is the failure mode:
 *   * the conversation is READ — `derive` assembles, `thread show` prints it;
 *   * the spelling is NAMED on every such run — the file stays off-canon in git forever (it is
 *     somebody else's committed message and is never rewritten), so the reader is the only
 *     thing that can ever say so. Tolerance without a voice is what (iv) was refused without.
 * And the strictness that must NOT have been traded away: a date that is not the same moment
 * written differently still refuses the thread, whole.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  ],
};

const message = (date: string): string =>
  `---\nfrom: curator\ndate: ${date}\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n`;

/** A mail with one thread whose single message carries the given `date:` value. */
const contour = (date: string): { repo: string; root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-off-canon-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const dir = join(repo, "agent-comms", "066-test-gaps");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(
    join(dir, "_meta.md"),
    "---\ntitle: T\nparticipants: curator, dev-core\nstatus: open\n---\n",
  );
  // The name is the CANON spelling and stays it: only the header is off-canon, exactly as
  // a hand that copies the name into the field produces.
  writeFileSync(join(dir, "messages", "2026-08-13T17-28-50Z-curator.md"), message(date));
  execFileSync("git", ["-C", repo, "add", "agent-protocol.json"]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "c",
  ]);
  return { repo, root: join(repo, "agent-comms") };
};

/**
 * The streams are kept APART on purpose (the lesson of 065.4): the conversation goes to
 * stdout and the line about the file to stderr, and a test that merged them could not tell
 * "the thread was read and a note was printed" from "the thread was refused".
 */
const run = (
  contest: { repo: string; root: string },
  argv: readonly string[],
): { code: number; stdout: string; stderr: string } => {
  const done = spawnSync(TSX, [CLI, ...argv, "--repo", contest.repo, "--ref", "HEAD"], {
    encoding: "utf8",
    env: sandbox(configHomeInside(contest.repo)),
  });
  return { code: done.status ?? 1, stdout: done.stdout, stderr: done.stderr };
};

describe("a UTC stamp written the way the file name writes it (thread 065, (iv))", () => {
  it("derive assembles the thread AND names the off-canon file", () => {
    const contest = contour("2026-08-13T17-28-50Z");

    const derived = run(contest, ["derive", "--root", contest.root, "--write"]);

    expect(derived.code).toBe(0);
    expect(derived.stderr).toContain("read in an OFF-CANON spelling");
    expect(derived.stderr).toContain("messages/2026-08-13T17-28-50Z-curator.md");
    expect(derived.stderr).toContain("read as '2026-08-13T17:28:50Z'");
    // The assembly happened, and the conversation is whole inside it.
    expect(readFileSync(join(contest.root, "066-test-gaps", "_thread.md"), "utf8")).toContain(
      "The body.",
    );
  });

  it("the file on disk keeps every byte — the header is normalized in memory only", () => {
    const contest = contour("2026-08-13T17-28-50Z");
    const path = join(contest.root, "066-test-gaps", "messages", "2026-08-13T17-28-50Z-curator.md");
    const before = readFileSync(path, "utf8");

    run(contest, ["derive", "--root", contest.root, "--write"]);

    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readFileSync(path, "utf8")).toContain("date: 2026-08-13T17-28-50Z");
  });

  it("thread show prints the conversation and names the spelling to the agent reading it", () => {
    const contest = contour("2026-08-13T17-28-50Z");

    const shown = run(contest, [
      "thread",
      "show",
      "--root",
      contest.root,
      "--thread",
      "066-test-gaps",
    ]);

    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("The body.");
    expect(shown.stderr).toContain("read in an OFF-CANON spelling");
  });

  it("a date that is NOT the same moment written differently still refuses the thread", () => {
    const contest = contour("13.08.2026 17:28");

    const derived = run(contest, ["derive", "--root", contest.root, "--write"]);

    expect(derived.code).toBe(2);
    expect(derived.stderr).toContain("a UTC stamp like 2026-07-23T13:45:12Z is required");
    // The raw value is quoted back, not the normalized one: the reader points at the byte
    // that is actually in the file, which is the only thing a human can go and look at.
    expect(derived.stderr).toContain("'date: 13.08.2026 17:28'");
  });
});
