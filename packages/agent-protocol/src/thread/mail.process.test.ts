/**
 * THE PROCESS TEST OF `mail` — the entry of a role, in QUEUE ORDER (R5).
 *
 * The FORM of the output is load-bearing and is deliberately left alone: one thread id
 * per line, because a script reads it (`has-mail.sh`). What R5 changes is the ORDER of
 * those lines, and it changes it for the same reason the daemon's queue exists — two
 * answers to "which one do I take now" would be worse than none, so the role reading
 * its own mail is told exactly what the daemon would decide.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";

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
      permissions: ["thread-priority"],
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

const handoff = (options: {
  readonly from: string;
  readonly date: string;
  readonly priority?: string;
}): string =>
  `---\nfrom: ${options.from}\ndate: ${options.date}\nexpects: answer\nwaiting-on: dev-core\n${
    options.priority === undefined ? "" : `priority: ${options.priority}\n`
  }---\n\nThe body.\n`;

/** A repository with a committed config and the given threads on disk. */
const contour = (
  threads: readonly { readonly id: string; readonly message: string }[],
): { repo: string; root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-mail-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const root = join(repo, "agent-comms");
  for (const spec of threads) {
    const dir = join(root, spec.id);
    mkdirSync(join(dir, "messages"), { recursive: true });
    writeFileSync(
      join(dir, "_meta.md"),
      "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n",
    );
    writeFileSync(join(dir, "messages", "2026-07-25T10-00-00Z-curator.md"), spec.message);
  }
  execFileSync("git", ["-C", repo, "add", "agent-protocol.json"]);
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "config"],
    { encoding: "utf8" },
  );
  return { repo, root };
};

const mail = (contest: { repo: string; root: string }): string[] =>
  execFileSync(
    TSX,
    [
      CLI,
      "mail",
      "--root",
      contest.root,
      "--repo",
      contest.repo,
      "--ref",
      "HEAD",
      "--no-fetch",
      "--role",
      "dev-core",
    ],
    { encoding: "utf8", stdio: "pipe" },
  )
    .split("\n")
    .filter((line) => line.trim() !== "");

describe("mail lists the entry in queue order (R5)", () => {
  it("an explicit 'high' comes first, however the directories sort", () => {
    const contest = contour([
      { id: "003-old", message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z" }) },
      {
        id: "016-urgent",
        message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z", priority: "high" }),
      },
    ]);

    expect(mail(contest)).toEqual(["016-urgent", "003-old"]);
  });

  it("with nothing said, the oldest handoff comes first — not the alphabet", () => {
    const contest = contour([
      { id: "003-recent", message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z" }) },
      { id: "016-old", message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z" }) },
    ]);

    expect(mail(contest)).toEqual(["016-old", "003-recent"]);
  });

  it("a priority nobody was authorized to set does not move the thread", () => {
    const contest = contour([
      { id: "003-old", message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z" }) },
      {
        id: "016-claims",
        message: handoff({ from: "dev-core", date: "2026-07-25T10:00:00Z", priority: "high" }),
      },
    ]);

    expect(mail(contest)).toEqual(["003-old", "016-claims"]);
  });

  it("the form of the output is unchanged: one thread id per line and nothing else", () => {
    const contest = contour([
      { id: "016-only", message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z" }) },
    ]);

    expect(mail(contest)).toEqual(["016-only"]);
  });
});
