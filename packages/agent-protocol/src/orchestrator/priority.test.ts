import { describe, expect, it } from "vitest";
import type { Message } from "../thread/message.js";
import {
  DEFAULT_THREAD_PRIORITY,
  describeOrder,
  orderCandidates,
  type RankedCandidate,
  resolveThreadPriority,
  threadNumber,
  waitingSince,
} from "./priority.js";

const message = (fields: Partial<Message["fields"]> & { from: string; date: string }): Message => ({
  fields: { expects: "answer", ...fields },
  text: "body",
});

const authorized = (role: string): boolean => role === "curator" || role === "john";

describe("resolveThreadPriority (R5)", () => {
  it("a feed with nothing said carries no priority — the caller falls back to the default", () => {
    const verdict = resolveThreadPriority({
      messages: [message({ from: "dev-core", date: "2026-07-26T10:00:00Z" })],
      authorized,
    });
    expect(verdict.effective).toBeUndefined();
    expect(verdict.ignored).toEqual([]);
    expect(DEFAULT_THREAD_PRIORITY).toBe("normal");
  });

  it("the LAST priority of an authorized role wins — a thread changes importance inside itself", () => {
    const verdict = resolveThreadPriority({
      messages: [
        message({ from: "curator", date: "2026-07-26T10:00:00Z", priority: "low" }),
        message({ from: "dev-core", date: "2026-07-26T11:00:00Z" }),
        message({ from: "john", date: "2026-07-26T12:00:00Z", priority: "high" }),
      ],
      authorized,
    });
    expect(verdict.effective).toEqual({
      priority: "high",
      from: "john",
      date: "2026-07-26T12:00:00Z",
    });
    expect(verdict.ignored).toEqual([]);
  });

  it("a priority from a role without the permission is dropped OUT LOUD, naming who and what", () => {
    const verdict = resolveThreadPriority({
      messages: [message({ from: "dev-core", date: "2026-07-26T10:00:00Z", priority: "high" })],
      authorized,
    });
    expect(verdict.effective).toBeUndefined();
    expect(verdict.ignored).toHaveLength(1);
    expect(verdict.ignored[0]).toContain("dev-core");
    expect(verdict.ignored[0]).toContain("high");
    expect(verdict.ignored[0]).toContain("thread-priority");
  });

  it("an unauthorized priority does not unseat the authorized one that came before it", () => {
    const verdict = resolveThreadPriority({
      messages: [
        message({ from: "curator", date: "2026-07-26T10:00:00Z", priority: "high" }),
        message({ from: "dev-core", date: "2026-07-26T11:00:00Z", priority: "low" }),
      ],
      authorized,
    });
    expect(verdict.effective?.priority).toBe("high");
    expect(verdict.ignored).toHaveLength(1);
  });
});

describe("waitingSince (R5) — the age is counted from the HANDOFF", () => {
  it("the stamp of the message that put the role into waiting-on, not of the latest message", () => {
    const since = waitingSince({
      messages: [
        message({ from: "curator", date: "2026-07-24T10:00:00Z", waitingOn: ["dev-core"] }),
        message({ from: "john", date: "2026-07-26T10:00:00Z", waitingOn: ["dev-core"] }),
      ],
      role: "dev-core",
    });
    expect(since).toBe("2026-07-24T10:00:00Z");
  });

  it("a talkative thread is not aged by talk: a message with no waiting-on inherits the wait", () => {
    const since = waitingSince({
      messages: [
        message({ from: "curator", date: "2026-07-24T10:00:00Z", waitingOn: ["dev-core"] }),
        message({ from: "reviewer-pr", date: "2026-07-25T10:00:00Z" }),
      ],
      role: "dev-core",
    });
    expect(since).toBe("2026-07-24T10:00:00Z");
  });

  it("a wait lifted and handed back again counts from the SECOND handoff", () => {
    const since = waitingSince({
      messages: [
        message({ from: "curator", date: "2026-07-24T10:00:00Z", waitingOn: ["dev-core"] }),
        message({ from: "dev-core", date: "2026-07-25T10:00:00Z", waitingOn: ["curator"] }),
        message({ from: "curator", date: "2026-07-26T10:00:00Z", waitingOn: ["dev-core"] }),
      ],
      role: "dev-core",
    });
    expect(since).toBe("2026-07-26T10:00:00Z");
  });

  it("a role nobody is waiting on has no wait at all", () => {
    expect(
      waitingSince({
        messages: [
          message({ from: "curator", date: "2026-07-24T10:00:00Z", waitingOn: ["dev-core"] }),
          message({ from: "dev-core", date: "2026-07-25T10:00:00Z", waitingOn: ["curator"] }),
        ],
        role: "dev-core",
      }),
    ).toBeUndefined();
  });
});

describe("orderCandidates (R5) — three tiers and nothing else", () => {
  const at = (
    thread: string,
    priority: RankedCandidate["priority"],
    since?: string,
  ): RankedCandidate => ({
    role: "dev-core",
    thread,
    priority,
    ...(since === undefined ? {} : { since }),
  });

  it("tier 1: an explicit priority beats a longer wait", () => {
    const ordered = orderCandidates([
      at("003-old", "normal", "2026-07-01T00:00:00Z"),
      at("016-urgent", "high", "2026-07-26T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["016-urgent", "003-old"]);
  });

  it("tier 1: 'low' goes behind everything at the default", () => {
    const ordered = orderCandidates([
      at("003-parked", "low", "2026-07-01T00:00:00Z"),
      at("016-ordinary", "normal", "2026-07-26T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["016-ordinary", "003-parked"]);
  });

  it("tier 2: at equal priority the oldest wait goes first", () => {
    const ordered = orderCandidates([
      at("016-new", "normal", "2026-07-26T00:00:00Z"),
      at("003-old", "normal", "2026-07-01T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["003-old", "016-new"]);
  });

  it("tier 2: an undated handoff goes BEHIND every dated one, not ahead of them", () => {
    const ordered = orderCandidates([
      at("003-undated", "normal"),
      at("016-dated", "normal", "2026-07-26T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["016-dated", "003-undated"]);
  });

  it("tier 3: an exactly equal pair is broken by the thread number, oldest first", () => {
    const ordered = orderCandidates([
      at("016-later", "normal", "2026-07-26T00:00:00Z"),
      at("003-earlier", "normal", "2026-07-26T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["003-earlier", "016-later"]);
  });

  it("the order does not depend on the order it was given in — the same input shuffled sorts the same", () => {
    const input = [
      at("016-urgent", "high", "2026-07-26T00:00:00Z"),
      at("003-old", "normal", "2026-07-01T00:00:00Z"),
      at("009-parked", "low", "2026-07-01T00:00:00Z"),
      at("012-new", "normal", "2026-07-25T00:00:00Z"),
    ];
    const expected = ["016-urgent", "003-old", "012-new", "009-parked"];
    expect(orderCandidates(input).map((c) => c.thread)).toEqual(expected);
    expect(orderCandidates([...input].reverse()).map((c) => c.thread)).toEqual(expected);
  });

  it("the input array is not mutated: the caller's list stays as it was", () => {
    const input = [at("016-b", "normal", "2026-07-26T00:00:00Z"), at("003-a", "high")];
    orderCandidates(input);
    expect(input.map((c) => c.thread)).toEqual(["016-b", "003-a"]);
  });

  it("a thread id with no leading number sorts after the numbered ones instead of throwing", () => {
    expect(threadNumber("016-protocol-roadmap")).toBe(16);
    expect(threadNumber("sync-front")).toBe(Number.POSITIVE_INFINITY);
    const ordered = orderCandidates([
      at("sync-front", "normal", "2026-07-26T00:00:00Z"),
      at("016-numbered", "normal", "2026-07-26T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["016-numbered", "sync-front"]);
  });

  it("two unnumbered ids are still a total order — broken by the id itself", () => {
    const ordered = orderCandidates([
      at("zeta", "normal", "2026-07-26T00:00:00Z"),
      at("alpha", "normal", "2026-07-26T00:00:00Z"),
    ]);
    expect(ordered.map((c) => c.thread)).toEqual(["alpha", "zeta"]);
  });
});

describe("describeOrder (R5) — the queue is readable without the code", () => {
  it("every line names its place, the pair, the priority and the wait", () => {
    const lines = describeOrder(
      orderCandidates([
        { role: "dev-core", thread: "016-a", priority: "high", since: "2026-07-26T00:00:00Z" },
        { role: "dev-core", thread: "003-b", priority: "normal" },
      ]),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("queue 1/2");
    expect(lines[0]).toContain("dev-core×016-a");
    expect(lines[0]).toContain("priority high");
    expect(lines[0]).toContain("waiting since 2026-07-26T00:00:00Z");
    expect(lines[1]).toContain("queue 2/2");
    expect(lines[1]).toContain("no dated handoff");
  });
});
