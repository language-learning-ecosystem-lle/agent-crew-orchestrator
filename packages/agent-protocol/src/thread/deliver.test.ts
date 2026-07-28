import { describe, expect, it } from "vitest";
import { roleIdentity } from "../roles/identity.js";
import { unlockedMail } from "./checkout-lock.js";
import {
  DELIVERY_ATTEMPTS,
  DeliveryRefusedError,
  deliverMessage,
  deliverySubject,
} from "./deliver.js";

type Call = readonly string[];
type Invocation = {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

const harness = (options: {
  readonly status?: string;
  /** Attempts (1-based) whose push is rejected. */
  readonly rejectPushes?: readonly number[];
  readonly ffFails?: boolean;
  /** Whose message this is — the role the commit has to be signed by (027). */
  readonly from?: string;
}) => {
  const calls: Call[] = [];
  const invocations: Invocation[] = [];
  const written: { path: string; content: string }[] = [];
  const notes: string[] = [];
  let pushes = 0;
  let plans = 0;

  const git = (args: readonly string[], env?: Readonly<Record<string, string>>): string => {
    calls.push(args);
    invocations.push({ args, ...(env === undefined ? {} : { env }) });
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

  // The lock records when it is entered and left, so the tests can say WHERE the
  // sequence sits relative to it — the dirty check included.
  const held: string[] = [];
  const lock = {
    hold: <T>(body: () => T): T => {
      held.push("taken");
      try {
        return body();
      } finally {
        held.push("released");
      }
    },
  };

  const run = () =>
    deliverMessage({
      git,
      write: (path, content) => written.push({ path, content }),
      branch: "comms",
      subject: "docs(agent-comms): dev-core → 016",
      stage,
      note: (line) => notes.push(line),
      lock,
      identity: roleIdentity(options.from ?? "dev-core"),
    });

  return { run, calls, invocations, written, notes, held, plans: () => plans };
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

  // D-0: the checkout is dirty between the write and the commit, so the lock has to
  // cover the WHOLE sequence — the dirty check first of all, otherwise a delivery
  // reads another delivery's transient dirt as somebody's unfinished message.
  it("runs the whole sequence under the lock on the checkout, dirty check included", () => {
    const h = harness({});
    h.run();

    expect(h.held).toEqual(["taken", "released"]);
    expect(h.calls[0]?.[0]).toBe("status");
  });

  it("releases the lock when the delivery refuses", () => {
    const h = harness({ status: " M agent-comms/016/messages/draft.md" });
    expect(() => h.run()).toThrow(/uncommitted changes/);
    expect(h.held).toEqual(["taken", "released"]);
  });

  // 027: the mail checkout is shared by every role on the box, so its identity cannot
  // be configured — whoever configured it last would sign the next role's message.
  it("signs the COMMIT with the role, author and committer both", () => {
    const h = harness({ from: "curator" });
    h.run();

    const commit = h.invocations.find((call) => call.args[0] === "commit");
    expect(commit?.env).toEqual({
      GIT_AUTHOR_NAME: "curator",
      GIT_AUTHOR_EMAIL: "curator@agents.invalid",
      GIT_COMMITTER_NAME: "curator",
      GIT_COMMITTER_EMAIL: "curator@agents.invalid",
    });
  });

  it("signs NOTHING but the commit — fetch, push and the rest run as they always did", () => {
    const h = harness({});
    h.run();

    expect(
      h.invocations
        .filter((call) => call.args[0] !== "commit")
        .every((call) => call.env === undefined),
    ).toBe(true);
  });

  it("re-signs the replanned message: a retry is a new commit, not a rebase of the old one", () => {
    const h = harness({ rejectPushes: [1], from: "dev-core" });
    h.run();

    const commits = h.invocations.filter((call) => call.args[0] === "commit");
    expect(commits).toHaveLength(2);
    expect(commits.map((call) => call.env?.GIT_AUTHOR_EMAIL)).toEqual([
      "dev-core@agents.invalid",
      "dev-core@agents.invalid",
    ]);
  });

  it("takes the lock the caller hands it — a caller alone in the checkout says so", () => {
    // `unlockedMail` is a value, not a default: a new call site has to choose.
    expect(unlockedMail.hold(() => 7)).toBe(7);
  });
});

describe("deliverySubject", () => {
  it("is Conventional Commits — the mail checkout carries the commit-msg hook", () => {
    expect(deliverySubject({ from: "dev-core", thread: "016-protocol-roadmap" })).toBe(
      "docs(agent-comms): dev-core → 016-protocol-roadmap",
    );
  });
});
