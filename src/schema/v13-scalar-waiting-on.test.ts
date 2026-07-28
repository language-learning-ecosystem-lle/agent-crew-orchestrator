/**
 * The step 12 → 13 — the first step in six versions that REWRITES DATA, and that is
 * what these tests are about. A step that only moves a number is checked for not
 * touching anything; this one is checked for touching exactly what it promised: the
 * `waiting-on` LINE of a message header, never a body, never a derived file.
 *
 * The property that matters most: every reduction is NAMED in the plan. The reduction
 * itself is mechanical (keep the first role the circuit can wake), the judgement of
 * whether that is the turn that was meant is not — so the plan carries the list a human
 * reads, and a silent `--write` would be the failure mode.
 */
import { describe, expect, it } from "vitest";

import { MIGRATIONS, planMigration } from "./migrate.js";
import type { MigrationContext } from "./step.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

const CONFIG_PATH = "/repo/agent-protocol.json";
const MAIL_ROOT = "/repo/.worktrees/comms/agent-comms";

const config = (): Record<string, unknown> => ({
  protocolVersion: 12,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
    },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
  ],
});

const message = (waitingOn: string, body = "Text.\n\nwaiting-on → john, curator\n"): string =>
  `---\nfrom: dev-core\ndate: 2026-07-27T10:00:00Z\nexpects: answer\nwaiting-on: ${waitingOn}\n---\n\n${body}`;

const context = (files: Record<string, string>): MigrationContext => ({
  config: config(),
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    const content = files[path];
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  },
  list: () => Object.keys(files),
});

const plan = (files: Record<string, string>) =>
  planMigration({ declared: 12, target: 13, context: context(files) });

describe("the step 12 → 13 — 'waiting-on' becomes a scalar", () => {
  it("is registered for 12, and the chain to the current version has no gap", () => {
    expect(MIGRATIONS.find((step) => step.from === 12)).toBeDefined();
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("keeps the FIRST role of a header naming several and drops the rest", () => {
    // First, not last: in a sequential queue the role written first is the one asked
    // to move next.
    const path = `${MAIL_ROOT}/016-x/messages/2026-07-27T10-00-00Z-dev-core.md`;
    const written = plan({ [path]: message("dev-core, curator") }).writes.find(
      (file) => file.path === path,
    );

    expect(written?.content).toContain("waiting-on: dev-core\n");
    expect(written?.content).not.toContain("waiting-on: dev-core, curator");
  });

  it("SKIPS a first-named role nobody wakes — the step may not emit what its own door refuses", () => {
    // `john, curator` is the most common shape in the live feed (62 of 153 multi-role
    // headers; 76 name john first). Keeping john would write, into an append-only
    // feed, exactly the header the v13 checker calls an issue.
    const path = `${MAIL_ROOT}/016-x/messages/a.md`;
    const result = plan({ [path]: message("john, curator") });
    const written = result.writes.find((file) => file.path === path);

    expect(written?.content).toContain("waiting-on: curator\n");
    expect(result.steps[0]?.notes.join("\n")).toContain("the first named holds no turn");
  });

  it("keeps the first when EVERY named role is outside the domain — it invents no turn", () => {
    const path = `${MAIL_ROOT}/016-x/messages/a.md`;
    const written = plan({ [path]: message("john, john") }).writes.find(
      (file) => file.path === path,
    );

    expect(written?.content).toContain("waiting-on: john\n");
  });

  it("COUNTS the messages already declaring a lone role nobody wakes instead of rewriting them", () => {
    // A single declaration is the turn its author meant; replacing it would be
    // inventing one. But the checker of this same version has an opinion about it and
    // the feed cannot be edited later — so the fact is named in the plan, not left to
    // be discovered by a red run.
    const files = {
      [`${MAIL_ROOT}/016-x/messages/a.md`]: message("john"),
      [`${MAIL_ROOT}/016-x/messages/b.md`]: message("curator"),
    };
    const result = plan(files);

    expect(result.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(result.steps[0]?.notes.join("\n")).toContain("1 message(s) already declare a SINGLE");
    expect(result.steps[0]?.notes.join("\n")).toContain("016-x/messages/a.md");
  });

  it("does NOT touch the body — 'waiting-on → a, b' in prose is a quotation of history", () => {
    const path = `${MAIL_ROOT}/016-x/messages/2026-07-27T10-00-00Z-dev-core.md`;
    const written = plan({ [path]: message("john, curator") }).writes.find(
      (file) => file.path === path,
    );

    expect(written?.content).toContain("waiting-on → john, curator");
  });

  it("leaves a header that is already scalar, or lifted, or absent, alone", () => {
    const files = {
      [`${MAIL_ROOT}/016-x/messages/a.md`]: message("curator"),
      [`${MAIL_ROOT}/016-x/messages/b.md`]: message("—"),
      [`${MAIL_ROOT}/016-x/messages/c.md`]: `---\nfrom: john\ndate: 2026-07-27T10:00:00Z\nexpects: none\n---\n\nText.\n`,
    };

    expect(plan(files).writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
  });

  it("ignores everything that is not a message file — derived state is regenerated, not patched", () => {
    // `_thread.md` and `INDEX.md` show the waiting too. A step that hand-patched them
    // would be writing a second source of truth beside `messages/`.
    const files = {
      [`${MAIL_ROOT}/016-x/_thread.md`]: message("john, curator"),
      [`${MAIL_ROOT}/INDEX.md`]: "| 016-x | … | john, curator |\n",
    };

    expect(plan(files).writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
  });

  it("NAMES every reduction in the plan — the review of it is not mechanical", () => {
    const files = {
      [`${MAIL_ROOT}/016-x/messages/a.md`]: message("john, curator"),
      [`${MAIL_ROOT}/024-y/messages/b.md`]: message("dev-core, john, curator"),
    };
    const notes = plan(files).steps[0]?.notes.join("\n") as string;

    expect(notes).toContain("016-x/messages/a.md: waiting-on 'john, curator' → 'curator'");
    expect(notes).toContain(
      "024-y/messages/b.md: waiting-on 'dev-core, john, curator' → 'dev-core'",
    );
    expect(notes).toContain("check by hand");
    expect(notes).toContain("derive --write");
  });

  it("says so out loud when the feed was already scalar — silence would read as 'not run'", () => {
    const notes = plan({}).steps[0]?.notes.join("\n") as string;

    expect(notes).toContain("no message in the mail declared more than one role");
  });

  it("moves the config number and nothing else in it", () => {
    const written = plan({}).writes.find((file) => file.path === CONFIG_PATH);
    const after = JSON.parse(written?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(13);
    expect({ ...after, protocolVersion: 12 }).toEqual(config());
  });
});
