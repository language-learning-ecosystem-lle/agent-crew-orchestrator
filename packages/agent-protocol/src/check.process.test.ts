/**
 * THE PROCESS TEST OF `check` — the WHOLE block it prints, not its lines one by one.
 *
 * The lines have unit tests (`renderThreadFailures`/`renderThreadWarnings` in
 * `fs/comms.test.ts`) and were right in isolation; what nothing covered was the block
 * they land in. That is where the defect of thread 023 lived: dropped fields were
 * appended to the failure list, so every warning line printed under a heading saying
 * "threads were not read" while the line itself said "the thread WAS read, minus one
 * field" — the two statements the whole warning/failure split exists to keep apart,
 * contradicting each other inside one output.
 *
 * So the assertions here are about ORDER AND MEMBERSHIP in the real stderr of a real
 * process: which heading a line sits under. A test on the renderers cannot see it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const META = "---\ntitle: Thread\nparticipants: dev-core, curator\nstatus: open\n---\n";
const MESSAGE =
  "---\nfrom: curator\ndate: 2026-07-24T13:45:12Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nBody.\n";

const DROPPED_FIELD = "2026-07-28T19-51-10Z-curator.md";

/** A repository whose mail holds one intact thread, plus whatever the test plants. */
const mail = (): { readonly repo: string; readonly root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-check-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { encoding: "utf8" });
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  execFileSync("git", ["-C", repo, "add", "-A"], { encoding: "utf8" });
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "base"],
    { encoding: "utf8" },
  );
  const root = join(repo, "agent-comms");
  thread(root, "012-ok");
  return { repo, root };
};

/** A thread with `_meta.md` and one intact message. */
const thread = (root: string, id: string): void => {
  mkdirSync(join(root, id, "messages"), { recursive: true });
  writeFileSync(join(root, id, "_meta.md"), META);
  writeFileSync(join(root, id, "messages", "2026-07-24T13-45-12Z-curator.md"), MESSAGE);
};

const check = (repo: string, root: string): { code: number; err: string } => {
  const run = spawnSync(TSX, [CLI, "check", "--root", root, "--ref", "HEAD"], {
    encoding: "utf8",
    env: sandbox(configHomeInside(repo)),
  });
  return { code: run.status ?? -1, err: run.stderr };
};

describe("`check` — a dropped field and an unreadable thread are said under DIFFERENT headings", () => {
  it("a dropped field is not listed as a thread that was not read (thread 023)", () => {
    const { repo, root } = mail();
    // `claude.ai` instead of `claude-ai`: a provenance field this reader cannot make
    // sense of. The thread IS in the answer — the field is not.
    thread(root, "024-odd-field");
    writeFileSync(
      join(root, "024-odd-field", "messages", DROPPED_FIELD),
      MESSAGE.replace("expects: answer", "expects: answer\nworker: claude.ai"),
    );

    const { code, err } = check(repo, root);

    // Still a red exit: `check` runs the CURRENT code, so an unreadable field is a
    // malformed field here and not a version skew.
    expect(code).toBe(1);
    expect(err).toContain("fields were dropped");
    // ...and the heading that would contradict it is not printed at all, there being
    // no unreadable thread in this mail.
    expect(err).not.toContain("threads were not read");

    rmSync(repo, { recursive: true, force: true });
  });

  it("with both in one mail, each line sits under its own heading", () => {
    const { repo, root } = mail();
    thread(root, "024-odd-field");
    writeFileSync(
      join(root, "024-odd-field", "messages", DROPPED_FIELD),
      MESSAGE.replace("expects: answer", "expects: answer\nworker: claude.ai"),
    );
    // A thread that did not parse at all: `messages/` beside a `_thread.md`, the shape
    // of the 009 incident.
    mkdirSync(join(root, "009-broken", "messages"), { recursive: true });
    writeFileSync(join(root, "009-broken", "_thread.md"), "# 009-broken · Thread\n");
    writeFileSync(join(root, "009-broken", "messages", "2026-07-24T21-00-00Z-curator.md"), MESSAGE);

    const { code, err } = check(repo, root);
    const lines = err.split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));

    expect(code).toBe(1);
    const failures = at("threads were not read");
    const dropped = at("fields were dropped");
    expect(failures).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeGreaterThan(failures);
    // The unreadable thread is above the second heading, the dropped field below it —
    // which is the whole assertion: a line saying "the thread was read without it" must
    // never appear under "threads were not read".
    expect(at("009-broken")).toBeGreaterThan(failures);
    expect(at("009-broken")).toBeLessThan(dropped);
    expect(at(DROPPED_FIELD)).toBeGreaterThan(dropped);

    rmSync(repo, { recursive: true, force: true });
  });
});
