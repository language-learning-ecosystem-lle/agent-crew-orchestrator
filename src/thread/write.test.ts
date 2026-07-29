import { describe, expect, it } from "vitest";

import { parseMessageFile } from "./message.js";
import { parseMetaFile } from "./thread.js";
import {
  messageTimestamp,
  nextMessageTimestamp,
  planNewMessage,
  planNewThread,
  threadNumberTaker,
  WriteRefusedError,
} from "./write.js";

describe("messageTimestamp", () => {
  it("gives a UTC stamp without milliseconds", () => {
    expect(messageTimestamp(new Date("2026-07-24T10:30:00.123Z"))).toBe("2026-07-24T10:30:00Z");
  });
});

describe("nextMessageTimestamp", () => {
  it("with no previous new messages — simply the stamp of now", () => {
    expect(nextMessageTimestamp(new Date("2026-07-23T22:45:21Z"), [])).toBe("2026-07-23T22:45:21Z");
  });

  it("now is later than the last one — take now", () => {
    expect(
      nextMessageTimestamp(new Date("2026-07-23T22:50:00Z"), [
        "2026-07-23T22:32:28Z",
        "2026-07-23T22:47:00Z",
      ]),
    ).toBe("2026-07-23T22:50:00Z");
  });

  it("the writer's clock is BEHIND the last stamp — clamp to a second after it, not before the question", () => {
    // A real case in 012: the reply is written at 22:45 (my clock), while
    // curator's question it answers already lies with the stamp 22:47 (curator's
    // clock runs ahead). Without the clamp the reply would land BEFORE the
    // question.
    expect(
      nextMessageTimestamp(new Date("2026-07-23T22:45:21Z"), [
        "2026-07-23T22:32:28Z",
        "2026-07-23T22:47:00Z",
      ]),
    ).toBe("2026-07-23T22:47:01Z");
  });
});

describe("planNewMessage", () => {
  const base = {
    from: "dev-core",
    date: "2026-07-24T10:30:00Z",
    expects: "answer" as const,
    text: "Message text.",
    threadHasMessages: true,
  };

  it("REFUSES to write into a thread without messages/ (legacy)", () => {
    // That very guard: a file write into a non-migrated thread would truncate its
    // history down to a single file (msg-034/056).
    expect(() => planNewMessage({ ...base, threadHasMessages: false })).toThrow(WriteRefusedError);
    expect(() => planNewMessage({ ...base, threadHasMessages: false })).toThrow(/legacy form/);
  });

  it("creates a file named from the timestamp and the role, without seq/msg", () => {
    const planned = planNewMessage(base);

    expect(planned.path).toBe("messages/2026-07-24T10-30-00Z-dev-core.md");
    const parsed = parseMessageFile(planned.content);
    expect(parsed.fields).toEqual({
      from: "dev-core",
      date: "2026-07-24T10:30:00Z",
      expects: "answer",
    });
    expect(parsed.text).toBe("Message text.");
  });

  it("puts waiting-on in as a field when it is given", () => {
    const parsed = parseMessageFile(planNewMessage({ ...base, waitingOn: "curator" }).content);

    expect(parsed.fields.waitingOn).toBe("curator");
  });

  it("refuses on an empty body", () => {
    expect(() => planNewMessage({ ...base, text: "   " })).toThrow(/empty/);
  });
});

describe("planNewThread", () => {
  const base = {
    title: "015-new · thread",
    participants: ["curator", "dev-core"],
    from: "curator",
    date: "2026-07-24T10:30:00Z",
    expects: "answer" as const,
    text: "First message.",
  };

  it("creates a thread STRAIGHT in the file form: _meta.md + the first message", () => {
    const files = planNewThread(base);

    expect(files.map((f) => f.path)).toEqual([
      "_meta.md",
      "messages/2026-07-24T10-30-00Z-curator.md",
    ]);
    const meta = parseMetaFile(files[0]?.content ?? "");
    expect(meta).toEqual({
      title: "015-new · thread",
      participants: ["curator", "dev-core"],
      status: "open",
    });
    expect(parseMessageFile(files[1]?.content ?? "").text).toBe("First message.");
  });

  it("a new thread is file-based by construction — legacy ones are no longer born", () => {
    // planNewThread has no threadHasMessages=false branch: a thread is only ever
    // created in the file form, so new-message will never hit one.
    const files = planNewThread(base);
    expect(files.some((f) => f.path.startsWith("messages/"))).toBe(true);
  });
});

describe("provenance on the write path (R7)", () => {
  it("records what wrote the message next to who said it", () => {
    const planned = planNewMessage({
      from: "dev-core",
      worker: "claude-code",
      session: "8f3a2b1c-0d4e",
      date: "2026-07-25T18:00:00Z",
      expects: "answer",
      waitingOn: "curator",
      text: "body",
      threadHasMessages: true,
    });

    expect(planned.content).toContain(
      "from: dev-core\nworker: claude-code\nsession: 8f3a2b1c-0d4e\n",
    );
  });

  it("writes no provenance line at all when there is nothing to record", () => {
    // An absent field is the honest form of "this writer did not say": a placeholder
    // would be a claim, and the feed is append-only — a wrong claim stays.
    const planned = planNewMessage({
      from: "john",
      date: "2026-07-25T18:00:00Z",
      expects: "none",
      text: "body",
      threadHasMessages: true,
    });

    expect(planned.content).not.toContain("worker:");
    expect(planned.content).not.toContain("session:");
  });

  it("carries provenance into the first message of a new thread as well", () => {
    const files = planNewThread({
      title: "017-x · title",
      participants: ["curator", "dev-core"],
      from: "dev-core",
      worker: "claude-code",
      date: "2026-07-25T18:00:00Z",
      expects: "answer",
      text: "body",
    });

    expect(files[1]?.content).toContain("worker: claude-code");
  });
});

describe("threadNumberTaker", () => {
  it("names the thread already holding the number", () => {
    // The real collision (2026-07-28): `029` was handed out to a second thread the
    // same day, and from then on "тред 029" needed a slug beside it to mean anything.
    expect(threadNumberTaker("029-reviewer-verdict-absence", ["029-circuit-metrics"])).toBe(
      "029-circuit-metrics",
    );
  });

  it("a free number is free", () => {
    expect(threadNumberTaker("030-x", ["029-circuit-metrics", "028-y"])).toBeUndefined();
  });

  it("compares numbers, not text — `29` and `029` are one address said two ways", () => {
    expect(threadNumberTaker("29-x", ["029-circuit-metrics"])).toBe("029-circuit-metrics");
  });

  it("the thread itself is not its own taker", () => {
    expect(threadNumberTaker("029-x", ["029-x"])).toBeUndefined();
  });

  it("an id without a number is not guarded — the door checks the id form elsewhere", () => {
    expect(threadNumberTaker("no-number", ["029-x"])).toBeUndefined();
  });
});
