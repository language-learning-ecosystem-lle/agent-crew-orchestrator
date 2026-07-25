import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkImmutable } from "../thread/check.js";
import { messagesAtRef } from "./git.js";

const git = (repo: string, ...args: string[]): void => {
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { encoding: "utf8" },
  );
};

/** A repository with one message in a thread, committed once. */
const repoWithMessage = (): { root: string; file: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-git-"));
  const root = join(repo, "agent-comms");
  const file = join(root, "012-x", "messages", "2026-07-23T13-45-12Z-dev-core.md");

  mkdirSync(join(root, "012-x", "messages"), { recursive: true });
  writeFileSync(
    file,
    "---\nfrom: dev-core\ndate: 2026-07-23T13:45:12Z\nexpects: none\n---\n\nWas.\n",
  );

  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first message");

  return { root, file };
};

describe("messagesAtRef", () => {
  it("returns message contents as of a ref, keyed by path relative to the mail root", () => {
    const { root } = repoWithMessage();

    const files = messagesAtRef(root, "HEAD");

    expect([...files.keys()]).toEqual(["012-x/messages/2026-07-23T13-45-12Z-dev-core.md"]);
    expect(files.values().next().value).toContain("Was.");
  });

  it("together with checkImmutable catches a retroactive edit", () => {
    // This pairing is what the git layer exists for: disk only holds "now", and
    // without a point in history the question "was it edited after the fact" makes
    // no sense.
    const { root, file } = repoWithMessage();
    const previous = messagesAtRef(root, "HEAD");

    writeFileSync(file, readFileSync(file, "utf8").replace("Was.", "Became."));
    const current = new Map(
      [...previous.keys()].map((key) => [key, readFileSync(join(root, key), "utf8")]),
    );

    expect(checkImmutable(previous, current).map((issue) => issue.message)).toEqual([
      "message file changed after the commit — a retroactive edit",
    ]);
  });

  it("fails loudly on a non-existent ref instead of returning an empty map", () => {
    // An empty map would mean "nothing changed" — the check would turn into its
    // own opposite exactly where it is needed.
    const { root } = repoWithMessage();

    expect(() => messagesAtRef(root, "no-such-ref")).toThrow(/git/);
  });
});
