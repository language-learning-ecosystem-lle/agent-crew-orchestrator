import { describe, expect, it } from "vitest";

import { parseMessageFile } from "./message.js";
import { parseMetaFile } from "./thread.js";
import {
  messageTimestamp,
  nextMessageTimestamp,
  planNewMessage,
  planNewThread,
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
    const parsed = parseMessageFile(planNewMessage({ ...base, waitingOn: ["curator"] }).content);

    expect(parsed.fields.waitingOn).toEqual(["curator"]);
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
