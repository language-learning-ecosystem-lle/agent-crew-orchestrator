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

/**
 * THE SECOND CASE OF THE CLASS, and it has no parallelism in it at all (curator, thread
 * `058`, msg-003): a consumer's circuit, 2026-08-30, dev-speech wrote twice in a row 32 seconds apart
 * (`15:49:21Z` and `15:49:53Z`) — the second letter lifted a parking the first one had
 * declared by mistake. One role, one session, two letters; a reader of "the last message"
 * sees the lift and never the thing being lifted. The mark being the reader's OWN last
 * letter is what makes this the same defect as two live writers, so it is pinned separately:
 * a fix that only ever looked at "somebody else wrote beside me" would pass the tests above
 * and lose this one.
 */
describe("unreadFor — one role, two letters in a row", () => {
  const burst: readonly Message[] = [
    message("john", "2026-08-30T15:40:00Z"),
    message("dev-speech", "2026-08-30T15:49:21Z"),
    message("dev-speech", "2026-08-30T15:49:53Z"),
  ];

  it("counts BOTH letters of one author, and names that author once", () => {
    const facts = unreadFor(burst, "john");
    expect(facts.unread).toBe(2);
    expect(facts.since).toBe("2026-08-30T15:40:00Z");
    expect(facts.authors).toEqual(["dev-speech"]);
  });

  it("widens `--tail 1` to both — the lift alone is the reading that lost the first letter", () => {
    expect(tailCovering(1, unreadFor(burst, "john"))).toBe(2);
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
