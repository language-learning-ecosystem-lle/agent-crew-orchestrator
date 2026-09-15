import { describe, expect, it } from "vitest";

import {
  journalBranchPrefix,
  journalEntryFile,
  journalEntryLabel,
  journalSubject,
  planJournalEntry,
} from "./write.js";

describe("where a journal entry lands", () => {
  it("the branch path is the mail directory of the CONFIG, the role and the thread", () => {
    expect(journalBranchPrefix({ mailDir: "agent-comms", role: "dev-core" })).toBe(
      "agent-comms/journal/dev-core",
    );
    // Another project names its mail directory another way, and the journal follows it —
    // the literal `agent-comms` is one project's name for it (thread 080).
    expect(journalBranchPrefix({ mailDir: "mail", role: "curator" })).toBe("mail/journal/curator");
  });

  it("the file is NAMED BY THE THREAD — the form of #408 survives the move of the branch", () => {
    expect(
      journalEntryFile({ mailRoot: "/box/comms/agent-comms", role: "dev-core", thread: "206-x" }),
    ).toBe("/box/comms/agent-comms/journal/dev-core/206-x.md");
  });

  it("the label says the path inside the branch, not the path on this box", () => {
    expect(journalEntryLabel({ mailDir: "agent-comms", role: "dev-core", thread: "206-x" })).toBe(
      "agent-comms/journal/dev-core/206-x.md",
    );
  });

  it("the commit subject is Conventional Commits with the mail directory as its scope", () => {
    // The mail checkout carries the commit-msg hook: a subject it refuses is a delivery
    // that dies after the write, inside the lock.
    expect(journalSubject({ mailDir: "agent-comms", role: "dev-core", thread: "206-x" })).toMatch(
      /^docs\(agent-comms\): /,
    );
    expect(journalSubject({ mailDir: "agent-comms", role: "dev-core", thread: "206-x" })).toContain(
      "206-x",
    );
  });
});

describe("what the file says after the write", () => {
  it("the first entry opens with the role and the thread — the file is readable on its own", () => {
    const plan = planJournalEntry({ role: "dev-core", thread: "206-x", body: "Что было.\n" });

    expect(plan.kind).toBe("create");
    expect(plan.kind === "create" ? plan.content : "").toBe(
      "# Журнал роли dev-core — тред `206-x`\n\nЧто было.\n",
    );
  });

  it("a second write APPENDS — a thread lives across ticks and the entry grows with it", () => {
    const first = planJournalEntry({ role: "dev-core", thread: "206-x", body: "Первое." });
    const plan = planJournalEntry({
      role: "dev-core",
      thread: "206-x",
      body: "Второе.",
      existing: first.kind === "create" ? first.content : "",
    });

    expect(plan.kind).toBe("append");
    expect(plan.kind === "append" ? plan.content : "").toBe(
      "# Журнал роли dev-core — тред `206-x`\n\nПервое.\n\nВторое.\n",
    );
  });

  it("the title is written ONCE — the append does not open a second head in one file", () => {
    const first = planJournalEntry({ role: "dev-core", thread: "206-x", body: "Первое." });
    const plan = planJournalEntry({
      role: "dev-core",
      thread: "206-x",
      body: "Второе.",
      existing: first.kind === "create" ? first.content : "",
    });
    const content = plan.kind === "append" ? plan.content : "";

    expect(content.split("# Журнал роли").length - 1).toBe(1);
  });

  /**
   * THE RE-RUN IS THE LIKELY SECOND CALL, not a hypothetical one: a session that lost the
   * output of the first one (a killed process, a transcript it cannot read back) has no way
   * to tell "written" from "not written" except by asking. An append-only file cannot be
   * edited afterwards without a hand, so the duplicate paragraph would stay in the branch.
   */
  it("the same text twice is REFUSED BY NAME, and the refusal says the text is already there", () => {
    const first = planJournalEntry({ role: "dev-core", thread: "206-x", body: "Первое.\n" });
    const plan = planJournalEntry({
      role: "dev-core",
      thread: "206-x",
      body: "Первое.\n",
      existing: first.kind === "create" ? first.content : "",
    });

    expect(plan.kind).toBe("duplicate");
    expect(plan.kind === "duplicate" ? plan.refusal : "").toContain("206-x");
    expect(plan.kind === "duplicate" ? plan.refusal : "").toContain("append-only");
  });

  it("the trailing newline of a body file is not a difference — the re-run is still a duplicate", () => {
    const plan = planJournalEntry({
      role: "dev-core",
      thread: "206-x",
      body: "Первое.\n\n",
      existing: "# Журнал роли dev-core — тред `206-x`\n\nПервое.\n",
    });

    expect(plan.kind).toBe("duplicate");
  });
});
