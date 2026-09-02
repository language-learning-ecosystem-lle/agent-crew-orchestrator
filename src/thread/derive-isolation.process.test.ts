/**
 * ONE BROKEN DIRECTORY DOES NOT FREEZE THE DERIVED FILES OF THE WHOLE BRANCH (thread 060,
 * statement of curator on john's word of 2026-08-30).
 *
 * The live case, twice in two days and both times the same repair — a thread directory created
 * with a message and WITHOUT `_meta.md`: `092-consent-and-deletion` on 29.08 (`derive` red ten
 * times in a row, `unreadable threads: 1` and no name, three false hypotheses, three trips of
 * john to the box) and `055` on 30.08 (two more red runs). Both times the
 * cost was not the broken thread — it was `INDEX.md`, `TASKS.md` and every `_thread.md` of the
 * whole mail standing still while one directory was missing one file.
 *
 * Three facts are asserted TOGETHER, because each alone is a failure mode:
 *   * the readable threads ARE assembled — the isolation;
 *   * the register does NOT go silent about the broken one — a marker row carries its id and
 *     the reason, so a partial register cannot be read as a complete one (option 2 of the
 *     statement, kept on top of option 1 rather than instead of it);
 *   * the run stays RED and the refusal NAMES THE DIRECTORY — the breakage is still a breakage,
 *     and the reader is not sent to a listing to find out which thread it was.
 *
 * The process form is what the case demands: the isolation lives in the exit path of the
 * command (write first, refuse last), and a unit of the renderer cannot see that order.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const MESSAGE =
  "---\nfrom: curator\ndate: 2026-08-30T11:45:32Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/**
 * A mail of TEN whole threads and one directory written the way the chatting curator writes
 * one — the message file first, `_meta.md` not yet. Ten rather than one on purpose: the number
 * is what the statement measures the punishment against.
 */
const contour = (): { repo: string; root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-derive-isolation-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);

  const write = (id: string, withMeta: boolean): void => {
    const dir = join(repo, "agent-comms", id);
    mkdirSync(join(dir, "messages"), { recursive: true });
    if (withMeta) {
      writeFileSync(
        join(dir, "_meta.md"),
        `---\ntitle: ${id}\nparticipants: curator, dev-core\nstatus: open\n---\n`,
      );
    }
    writeFileSync(join(dir, "messages", "2026-08-30T11-45-32Z-curator.md"), MESSAGE);
  };

  for (let n = 1; n <= 10; n++) write(`${String(n).padStart(3, "0")}-whole`, true);
  write("092-consent-and-deletion", false);

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

describe("derive with one thread that has no '_meta.md' (thread 060)", () => {
  it("assembles the ten whole threads and the register, and stays red naming the directory", () => {
    const contest = contour();

    const derived = run(contest, ["derive", "--root", contest.root, "--write"]);

    // The exit code is the one it always was: an unreadable thread is a breakage.
    expect(derived.code).toBe(2);
    // …and the LAST line names the directory — this is what used to read `unreadable threads: 1`.
    expect(derived.stderr).toContain("'092-consent-and-deletion'");
    expect(derived.stderr).toContain("1 unreadable thread");
    expect(derived.stderr).toContain("a thread opened without its head");
    // The cure the reader is supposed to act on survives the change of shape.
    expect(derived.stderr).toContain("--repair");

    // The isolation: every whole thread has its `_thread.md`, the broken one has none.
    for (let n = 1; n <= 10; n++) {
      const id = `${String(n).padStart(3, "0")}-whole`;
      expect(readFileSync(join(contest.root, id, "_thread.md"), "utf8")).toContain("The body.");
    }
    expect(existsSync(join(contest.root, "092-consent-and-deletion", "_thread.md"))).toBe(false);

    // The display does not go silent: the register carries the ten AND a marker row for the
    // eleventh, in id order, with the reason in it.
    const index = readFileSync(join(contest.root, "INDEX.md"), "utf8");
    expect(index).toContain("| 001-whole | curator, dev-core | normal | open | dev-core |");
    expect(index).toContain("| 010-whole | curator, dev-core | normal | open | dev-core |");
    expect(index).toContain(
      "| 092-consent-and-deletion | — | — | не прочитан | — | — | — | тред не собран: a thread opened without its head",
    );
    // TASKS.md is a derived file of the same class and is written on the same run.
    expect(existsSync(join(contest.root, "TASKS.md"))).toBe(true);
  });

  it("the second run has nothing left to write and still refuses by name", () => {
    const contest = contour();

    run(contest, ["derive", "--root", contest.root, "--write"]);
    const again = run(contest, ["derive", "--root", contest.root, "--write"]);

    // Idempotence is what the generator's "commit only on divergence" rests on: the second
    // run must find the files already matching AND still be red about the same directory.
    expect(again.stdout).toContain("already match");
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("'092-consent-and-deletion'");
  });

  it("a whole mail is not made red by any of this", () => {
    const contest = contour();
    // The broken directory is repaired the way the field repairs it — one file.
    writeFileSync(
      join(contest.root, "092-consent-and-deletion", "_meta.md"),
      "---\ntitle: 092\nparticipants: curator, dev-core\nstatus: open\n---\n",
    );

    const derived = run(contest, ["derive", "--root", contest.root, "--write"]);

    expect(derived.code).toBe(0);
    expect(readFileSync(join(contest.root, "INDEX.md"), "utf8")).not.toContain("не прочитан");
  });
});

describe("index build with the same mail (thread 060)", () => {
  it("writes the register with the marker row and refuses by name afterwards", () => {
    const contest = contour();

    const built = run(contest, ["index", "build", "--root", contest.root, "--write"]);

    expect(built.code).toBe(2);
    expect(built.stderr).toContain("'092-consent-and-deletion'");
    const index = readFileSync(join(contest.root, "INDEX.md"), "utf8");
    expect(index).toContain("| 001-whole |");
    expect(index).toContain("| 092-consent-and-deletion | — | — | не прочитан |");
  });
});
