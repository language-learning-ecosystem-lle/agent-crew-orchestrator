import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { createRoleRegistry } from "../roles/registry.js";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { checkImmutable, checkThread, type ThreadInput } from "./check.js";
import type { Message } from "./message.js";
import { renderThread, type ThreadMeta } from "./thread.js";

const registry = createRoleRegistry(
  parseProtocolConfig({
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    mail: { branch: "comms", dir: "agent-comms" },
    roles: [
      { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "PM" },
      {
        id: "curator",
        kind: "claude.ai",
        status: "active",
        wake: { mode: "via-human", via: "john" },
        summary: "assistant",
      },
      {
        id: "dev-core",
        kind: "claude-code",
        status: "active",
        wake: { mode: "watch", session: "lle-dev-core" },
        summary: "main stream",
      },
    ],
  }),
);

const meta: ThreadMeta = {
  title: "012-x · thread",
  participants: ["curator", "dev-core", "john"],
  status: "open",
};

const message = (over: Partial<Message["fields"]> = {}, text = "Text."): Message => ({
  fields: {
    from: "dev-core",
    date: "2026-07-23T13:45:12Z",
    expects: "answer",
    waitingOn: ["curator"],
    ...over,
  },
  text,
});

const input = (over: Partial<ThreadInput> = {}): ThreadInput => {
  const entries = over.entries ?? [
    { fileName: "2026-07-23T13-45-12Z-dev-core.md", message: message() },
  ];
  return { id: "012-x", meta, ...over, entries };
};

describe("checkThread", () => {
  it("stays silent on a correct thread", () => {
    const entries = input().entries;
    const doc = renderThread(
      meta,
      entries.map((entry) => entry.message),
    );

    expect(checkThread(input({ threadDoc: doc }), registry)).toEqual([]);
  });

  it("does NOT require provenance on the read side, however loudly the door demands it", () => {
    // The asymmetry of the R7 contract, pinned deliberately: `new-message` refuses
    // without `--worker`, `check` accepts a message that has none. There are files
    // nobody can repair — legacy threads, history that predates the field, and the
    // window between the migration of the mail and the merge of the version bump —
    // and a rule that cannot be met makes the validator permanently red. A red
    // everybody has learned to ignore is worse than no rule at all.
    const entries = [
      { fileName: "2026-07-23T13-45-12Z-dev-core.md", message: message() },
      {
        fileName: "2026-07-23T13-45-13Z-curator.md",
        message: message({
          from: "curator",
          date: "2026-07-23T13:45:13Z",
          worker: "unknown",
          waitingOn: ["dev-core"],
        }),
      },
    ];
    const doc = renderThread(
      meta,
      entries.map((entry) => entry.message),
    );

    expect(checkThread(input({ entries, threadDoc: doc }), registry)).toEqual([]);
  });

  it("flags an unknown role in from and in waiting-on instead of dropping it silently", () => {
    // The silent drop was the very mechanism by which a role got lost from a
    // declaration (pain 2): a typo yielded an empty waiting and a silence
    // indistinguishable from normal work.
    const issues = checkThread(
      input({
        entries: [
          {
            fileName: "2026-07-23T13-45-12Z-github.md",
            message: message({ from: "github", waitingOn: ["jonh"] }),
          },
        ],
      }),
      registry,
    );

    expect(issues.map((issue) => issue.message)).toEqual([
      "'from: github' — no such role in the config",
      "'waiting-on' names role 'jonh', which is not in the config",
    ]);
  });

  it("catches a file name that drifted from the header", () => {
    const issues = checkThread(
      input({ entries: [{ fileName: "message.md", message: message() }] }),
      registry,
    );

    expect(issues[0]?.message).toMatch(/expected '2026-07-23T13-45-12Z-dev-core.md'/);
  });

  it("catches a '## msg-' line in the body — the assembly would break on it", () => {
    const issues = checkThread(
      input({
        entries: [
          {
            fileName: "2026-07-23T13-45-12Z-dev-core.md",
            message: message(
              {},
              "Quoting:\n\n## msg-001 · from: curator · 2026-07-22 · expects: none",
            ),
          },
        ],
      }),
      registry,
    );

    expect(issues[0]?.message).toMatch(/thread assembly would break/);
  });

  it("catches a derived file that drifted from the messages", () => {
    const issues = checkThread(input({ threadDoc: "# something of its own\n" }), registry);

    expect(issues[0]?.message).toMatch(/derived file drifted/);
  });

  it("catches a participant missing from the role config", () => {
    const issues = checkThread(
      input({ meta: { ...meta, participants: ["curator", "no-such-role"] } }),
      registry,
    );

    expect(issues[0]?.message).toMatch(/is not listed as a role/);
  });
});

describe("checkImmutable", () => {
  it("flags an edit and a deletion of a previously committed message", () => {
    const before = new Map([
      ["012-x/messages/a.md", "was"],
      ["012-x/messages/b.md", "intact"],
    ]);
    const after = new Map([
      ["012-x/messages/a.md", "became"],
      ["012-x/messages/c.md", "new"],
    ]);

    expect(checkImmutable(before, after).map((issue) => issue.message)).toEqual([
      "message file changed after the commit — a retroactive edit",
      "message file deleted — the feed is append-only",
    ]);
  });

  it("does not count new files as an edit — the feed grows", () => {
    const before = new Map([["012-x/messages/a.md", "was"]]);
    const after = new Map([
      ["012-x/messages/a.md", "was"],
      ["012-x/messages/b.md", "new"],
    ]);

    expect(checkImmutable(before, after)).toEqual([]);
  });
});
