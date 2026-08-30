import { describe, expect, it } from "vitest";

import type { Message } from "./message.js";
import { describeUnread, tailCovering, unreadFor } from "./unread.js";

const message = (from: string, date: string): Message => ({
  fields: { from, date, expects: "answer", waitingOn: "dev-core" },
  text: `a letter from ${from}`,
});

/** The measured shape of the incident: a park, then somebody else's letter over it. */
const thread: readonly Message[] = [
  message("curator", "2026-08-30T10:00:00Z"),
  message("dev-speech", "2026-08-30T14:14:43Z"),
  message("curator", "2026-08-30T14:24:50Z"),
  message("dev-speech", "2026-08-30T14:26:53Z"),
];

describe("unreadFor", () => {
  it("counts from the role's OWN last letter, and names who wrote the run", () => {
    const facts = unreadFor(thread, "dev-speech");
    expect(facts).toMatchObject({ role: "dev-speech", total: 4, unread: 0 });
    expect(facts.since).toBe("2026-08-30T14:26:53Z");
  });

  it("takes the LAST of the role's letters as the mark, not the first", () => {
    // curator wrote twice; only the newer letter says what she had already seen.
    const facts = unreadFor(thread, "curator");
    expect(facts.since).toBe("2026-08-30T14:24:50Z");
    expect(facts.unread).toBe(1);
    expect(facts.authors).toEqual(["dev-speech"]);
  });

  it("reads a role that never wrote here as having read nothing here", () => {
    const facts = unreadFor(thread, "john");
    expect(facts.since).toBeUndefined();
    expect(facts.unread).toBe(4);
    // The authors are named once each, in order of first appearance.
    expect(facts.authors).toEqual(["curator", "dev-speech"]);
  });

  it("says the count even when there is nothing new — an absent number reads as unasked", () => {
    expect(describeUnread(unreadFor(thread, "dev-speech"))).toContain(
      "unread for dev-speech: none",
    );
  });

  it("names the run, its start and its writers in one line", () => {
    const line = describeUnread(unreadFor(thread, "curator"));
    expect(line).toContain("unread for curator: 1 of 4 message(s)");
    expect(line).toContain("2026-08-30T14:24:50Z");
    expect(line).toContain("written by dev-speech");
  });

  it("says the whole thread is unread when the role has never written", () => {
    expect(describeUnread(unreadFor(thread, "john"))).toContain(
      "all 4 message(s) — john has not written in this thread yet",
    );
  });
});

describe("tailCovering", () => {
  it("widens a bound that would cut into the unread run", () => {
    // `--tail 1` on the incident itself: the reader would see the letter that says nothing
    // about the park and none of the one that declared it.
    expect(tailCovering(1, unreadFor(thread, "john"))).toBe(4);
  });

  it("never shrinks a wider bound — asking for context around two new letters is legal", () => {
    expect(tailCovering(50, unreadFor(thread, "curator"))).toBe(50);
  });
});
