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
  /** A second file in the same attempt — what a new thread is (`_meta.md` + first message). */
  readonly extraFile?: boolean;
  /**
   * The staged diff comes back EMPTY — the plan turned out to be what the feed already
   * carries. Real for the two deliveries that write a mutable file (thread 065).
   */
  readonly emptyDiff?: boolean;
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
    // `git diff --cached --name-only -- <paths>`: the names of what the index actually
    // changed. Empty means the feed already says exactly this.
    if (args[0] === "diff")
      return options.emptyDiff === true ? "" : `${args.slice(4).join("\n")}\n`;
    if (args[0] === "push") {
      pushes += 1;
      if ((options.rejectPushes ?? []).includes(pushes)) throw new Error("rejected: fetch first");
    }
    return "";
  };

  const stage = () => {
    plans += 1;
    return {
      files: [
        { path: `/mail/016/messages/stamp-${plans}Z-dev-core.md`, content: `body ${plans}` },
        ...(options.extraFile === true ? [{ path: "/mail/016/_meta.md", content: "meta" }] : []),
      ],
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

    expect(result).toEqual({
      label: "016/messages/stamp-1Z-dev-core.md",
      attempts: 1,
      written: true,
    });
    expect(h.written).toEqual([
      { path: "/mail/016/messages/stamp-1Z-dev-core.md", content: "body 1" },
    ]);
    expect(h.calls.map((c) => c[0])).toEqual([
      "status",
      "fetch",
      "merge",
      "add",
      "diff",
      "commit",
      "push",
    ]);
  });

  // Thread 065, the verdict on PR #266: `git commit` on an empty index exits 1 with
  // "nothing to commit", and that error is neither a refusal nor a busy checkout — it
  // went past every caller's catch as a raw git failure, in the one scenario the command
  // above it promised as a no-op. The empty index is now an ANSWER.
  it("a plan the feed already carries commits nothing and comes back written: false", () => {
    const h = harness({ emptyDiff: true });
    const result = h.run();

    expect(result).toEqual({
      label: "016/messages/stamp-1Z-dev-core.md",
      attempts: 1,
      written: false,
    });
    expect(h.calls.map((c) => c[0])).toEqual(["status", "fetch", "merge", "add", "diff"]);
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

  // 033: a NEW THREAD is two files born together (`_meta.md` and its first message) and
  // they are ONE delivery — a meta pushed without its message is a conversation nobody
  // can read, and the retry would replan the message beside a meta already in the feed.
  it("stages every file of the attempt into ONE commit", () => {
    const h = harness({ extraFile: true });
    h.run();

    const add = h.calls.find((c) => c[0] === "add") as readonly string[];
    expect(add).toEqual([
      "add",
      "--",
      "/mail/016/messages/stamp-1Z-dev-core.md",
      "/mail/016/_meta.md",
    ]);
    expect(h.written).toHaveLength(2);
    expect(h.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  it("takes the lock the caller hands it — a caller alone in the checkout says so", () => {
    // `unlockedMail` is a value, not a default: a new call site has to choose.
    expect(unlockedMail.hold(() => 7)).toBe(7);
  });
});

describe("deliverySubject", () => {
  it("is Conventional Commits — the mail checkout carries the commit-msg hook", () => {
    // THE REGRESSION, AND IT IS THE POINT OF THE CHANGE (thread 080): with this
    // project's `mail.dir` the subject is byte-identical to the literal the package
    // used to carry, so nothing in this repository's feed reads differently.
    expect(
      deliverySubject({
        from: "dev-core",
        thread: "016-protocol-roadmap",
        mailDir: "agent-comms",
      }),
    ).toBe("docs(agent-comms): dev-core → 016-protocol-roadmap");
  });

  it("takes the scope from the mail directory — another project's feed is not ours", () => {
    // The defect the literal was: a scope naming a path the adopting tree does not have.
    expect(
      deliverySubject({ from: "dev-core", thread: "016-protocol-roadmap", mailDir: "mail" }),
    ).toBe("docs(mail): dev-core → 016-protocol-roadmap");
  });

  it("appends the detail the `_meta.md` writers add after the thread", () => {
    // Head repair, turn and status used to spell the whole subject by hand — four copies
    // of one literal, which is why fixing it in one place was not enough before.
    expect(
      deliverySubject({
        from: "curator",
        thread: "080-extraction-prep",
        mailDir: "agent-comms",
        detail: "head repaired",
      }),
    ).toBe("docs(agent-comms): curator → 080-extraction-prep head repaired");
  });
});
