import { describe, expect, it } from "vitest";
import {
  DELIVERY_ATTEMPTS,
  DeliveryRefusedError,
  deliverMessage,
  deliverySubject,
} from "./deliver.js";

type Call = readonly string[];

const harness = (options: {
  readonly status?: string;
  /** Attempts (1-based) whose push is rejected. */
  readonly rejectPushes?: readonly number[];
  readonly ffFails?: boolean;
}) => {
  const calls: Call[] = [];
  const written: { path: string; content: string }[] = [];
  const notes: string[] = [];
  let pushes = 0;
  let plans = 0;

  const git = (args: readonly string[]): string => {
    calls.push(args);
    if (args[0] === "status") return options.status ?? "";
    if (args[0] === "merge" && options.ffFails === true) throw new Error("not a fast-forward");
    if (args[0] === "push") {
      pushes += 1;
      if ((options.rejectPushes ?? []).includes(pushes)) throw new Error("rejected: fetch first");
    }
    return "";
  };

  const stage = () => {
    plans += 1;
    return {
      path: `/mail/016/messages/stamp-${plans}Z-dev-core.md`,
      content: `body ${plans}`,
      label: `016/messages/stamp-${plans}Z-dev-core.md`,
    };
  };

  const run = () =>
    deliverMessage({
      git,
      write: (path, content) => written.push({ path, content }),
      branch: "comms",
      subject: "docs(agent-comms): dev-core → 016",
      stage,
      note: (line) => notes.push(line),
    });

  return { run, calls, written, notes, plans: () => plans };
};

describe("deliverMessage", () => {
  it("delivers in one action: refresh, write, add, commit, push", () => {
    const h = harness({});
    const result = h.run();

    expect(result).toEqual({ label: "016/messages/stamp-1Z-dev-core.md", attempts: 1 });
    expect(h.written).toEqual([
      { path: "/mail/016/messages/stamp-1Z-dev-core.md", content: "body 1" },
    ]);
    expect(h.calls.map((c) => c[0])).toEqual(["status", "fetch", "merge", "add", "commit", "push"]);
  });

  it("refreshes BEFORE planning — the stamp has to fall after the last message that exists", () => {
    const h = harness({});
    h.run();

    const names = h.calls.map((c) => c[0]);
    expect(names.indexOf("merge")).toBeLessThan(names.indexOf("add"));
  });

  it("stages only the message file — the derived files belong to the generator", () => {
    const h = harness({});
    h.run();

    const add = h.calls.find((c) => c[0] === "add") as readonly string[];
    expect(add).toEqual(["add", "--", "/mail/016/messages/stamp-1Z-dev-core.md"]);
    expect(h.written).toHaveLength(1);
  });

  it("a rejected push resets the checkout and REPLANS the message (a new name, not a rebase)", () => {
    const h = harness({ rejectPushes: [1] });
    const result = h.run();

    expect(result.attempts).toBe(2);
    expect(h.plans()).toBe(2);
    expect(h.written.map((w) => w.path)).toEqual([
      "/mail/016/messages/stamp-1Z-dev-core.md",
      "/mail/016/messages/stamp-2Z-dev-core.md",
    ]);
    expect(h.calls.map((c) => c[0]).filter((name) => name === "reset")).toHaveLength(1);
    expect(h.notes[0]).toContain("attempt 1 of 3");
  });

  it("gives up after the ceiling of attempts and says why", () => {
    const h = harness({ rejectPushes: [1, 2, 3] });
    expect(() => h.run()).toThrow(DeliveryRefusedError);
    expect(h.plans()).toBe(DELIVERY_ATTEMPTS);
  });

  it("refuses a dirty checkout instead of resetting somebody else's work", () => {
    const h = harness({ status: " M agent-comms/016/messages/draft.md" });
    expect(() => h.run()).toThrow(/uncommitted changes/);
    expect(h.written).toEqual([]);
  });

  it("refuses a diverged checkout — a fast-forward is the only update it does", () => {
    const h = harness({ ffFails: true });
    expect(() => h.run()).toThrow(/diverged/);
    expect(h.written).toEqual([]);
  });
});

describe("deliverySubject", () => {
  it("is Conventional Commits — the mail checkout carries the commit-msg hook", () => {
    expect(deliverySubject({ from: "dev-core", thread: "016-protocol-roadmap" })).toBe(
      "docs(agent-comms): dev-core → 016-protocol-roadmap",
    );
  });
});
