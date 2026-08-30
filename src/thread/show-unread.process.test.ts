/**
 * THE SEAM OF B.1 (thread `058-concurrent-writers-one-thread`): the reading COMMAND, on a
 * thread two roles wrote into within a minute — the shape of LLE thread 110 on 2026-08-30.
 *
 * A unit on {@link unreadFor} cannot hold this: what failed in the field was a session
 * TYPING A COMMAND and believing its output, and the two halves that matter — the count
 * being printed at all, and `--tail` refusing to hide an unread message — live in the CLI
 * between the loader, the flag and the renderer. The scenario is the one the statement of
 * work names in «Проверяемость»: two letters a minute apart, and the next raised role names
 * BOTH.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
      id: "dev-speech",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s2" },
      summary: "the other stream",
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

const META =
  "---\ntitle: Two writers, one thread\nparticipants: dev-speech, curator, john\nstatus: open\n---\n";

const letter = (from: string, stamp: string, waitingOn: string, body: string): string =>
  `---\nfrom: ${from}\ndate: ${stamp}\nexpects: answer\nwaiting-on: ${waitingOn}\n---\n\n${body}\n`;

/**
 * The incident, in four letters: dev-speech works, curator asks john a question in her own
 * live session, dev-speech finishes its report into the thread that was frozen while it
 * wrote. The question is the SECOND-TO-LAST line, and that is the whole point.
 */
const mailbox = (): { repo: string; root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-show-unread-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const root = join(repo, "agent-comms");
  const dir = join(root, "110-two-writers", "messages");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, "110-two-writers", "_meta.md"), META);
  writeFileSync(
    join(dir, "2026-08-30T14-14-43Z-dev-speech.md"),
    letter("dev-speech", "2026-08-30T14:14:43Z", "curator", "THE HEAD OF THE BRANCH IS READY."),
  );
  writeFileSync(
    join(dir, "2026-08-30T14-24-50Z-curator.md"),
    letter("curator", "2026-08-30T14:24:50Z", "curator", "THE QUESTION FOR JOHN, AND THE PARK."),
  );
  writeFileSync(
    join(dir, "2026-08-30T14-26-53Z-dev-speech.md"),
    letter("dev-speech", "2026-08-30T14:26:53Z", "curator", "THE REPORT WRITTEN OVER THE PARK."),
  );
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

const show = (
  box: { repo: string; root: string },
  extra: readonly string[],
): { code: number; out: string; err: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "thread",
      "show",
      "--repo",
      box.repo,
      "--root",
      box.root,
      "--ref",
      "HEAD",
      "--no-fetch",
      "--thread",
      "110-two-writers",
      ...extra,
    ],
    { encoding: "utf8", env: sandbox(configHomeInside(box.repo), IDENTITY) },
  );
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

describe("thread show --for — the reading tool counts what is new to the reader (058, B.1)", () => {
  it("names the run from the reader's OWN last letter, and who wrote it", () => {
    const result = show(mailbox(), ["--for", "curator"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("unread for curator: 1 of 3 message(s)");
    expect(result.out).toContain("curator's own letter of 2026-08-30T14:24:50Z");
    expect(result.out).toContain("written by dev-speech");
  });

  it("reads a role that has never written here as having read nothing here", () => {
    const result = show(mailbox(), ["--for", "john"]);

    expect(result.out).toContain("all 3 message(s) — john has not written in this thread yet");
    expect(result.out).toContain("written by dev-speech, curator");
  });

  it("says the count even when there is nothing new — silence would read as unasked", () => {
    const result = show(mailbox(), ["--for", "dev-speech"]);

    expect(result.out).toContain("unread for dev-speech: none");
  });

  /**
   * THE HALF THAT MAKES IT A DOOR. `--tail 1` is the reading john refused, mechanised: it
   * shows the report and hides the question the thread was frozen on. The bound is widened
   * to the unread run, the widening is said, and BOTH letters are in the output.
   */
  it("widens a --tail that would hide an unread message, and says that it did", () => {
    const result = show(mailbox(), ["--for", "john", "--tail", "1"]);

    expect(result.out).toContain("--tail 1 was widened to 3");
    expect(result.out).toContain("THE QUESTION FOR JOHN, AND THE PARK.");
    expect(result.out).toContain("THE REPORT WRITTEN OVER THE PARK.");
    // Nothing was hidden, so the "earlier ones are NOT shown" notice must not appear.
    expect(result.out).not.toContain("are NOT shown");
  });

  it("leaves a bound WIDER than the unread run exactly as it was asked for", () => {
    const result = show(mailbox(), ["--for", "dev-speech", "--tail", "1"]);

    expect(result.out).not.toContain("was widened");
    expect(result.out).toContain("2 earlier ones are NOT shown");
  });

  it("refuses an unknown role BY NAME — it has no mark to count from", () => {
    const result = show(mailbox(), ["--for", "dev-cor"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("--for 'dev-cor'");
    expect(result.err).toContain("no such role in the config");
  });

  it("says nothing about unread messages when nobody asked whose reading it is", () => {
    const result = show(mailbox(), []);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("unread for");
  });
});
