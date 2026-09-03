import { describe, expect, it } from "vitest";
import {
  chooseReceiver,
  ReceiverRefusedError,
  type ReceiverThread,
  receiverNote,
  threadSlug,
  unreadableReceiverSlug,
} from "./receiver.js";

const open = (id: string): ReceiverThread => ({ id, status: "open", parked: false });
const closed = (id: string): ReceiverThread => ({ id, status: "closed", parked: false });
const parked = (id: string): ReceiverThread => ({ id, status: "open", parked: true });
const unreadable = (id: string): ReceiverThread => ({
  id,
  status: "open",
  parked: false,
  readable: false,
});

describe("chooseReceiver", () => {
  it("takes the open, unparked receiver of the slug", () => {
    const choice = chooseReceiver({
      slug: "main-red-alarm",
      threads: [open("001-first"), open("076-main-red-alarm"), open("090-note-sort")],
    });
    expect(choice).toEqual({ kind: "existing", id: "076-main-red-alarm" });
  });

  // THE WHOLE POINT OF THE MECHANISM (thread 080, `msg-003`): a letter into a closed thread is
  // accepted and raises nobody — `waitingOnOf` answers `undefined` before it reads a single
  // declaration. So a closed receiver is not written into; the next one is opened.
  it("opens the next receiver when the current one is closed", () => {
    const choice = chooseReceiver({
      slug: "main-red-alarm",
      threads: [closed("076-main-red-alarm"), open("090-note-sort")],
    });
    expect(choice).toEqual({
      kind: "create",
      id: "091-main-red-alarm",
      blocked: [{ id: "076-main-red-alarm", why: "closed" }],
    });
  });

  // A parked thread raises nobody either, and a machine event does not lift the park (072) —
  // the same class by another path, and therefore the same answer.
  it("opens the next receiver when the current one is parked", () => {
    const choice = chooseReceiver({
      slug: "notifier-down",
      threads: [parked("077-notifier-down")],
    });
    expect(choice).toEqual({
      kind: "create",
      id: "078-notifier-down",
      blocked: [{ id: "077-notifier-down", why: "parked" }],
    });
  });

  it("does not write into a receiver whose feed cannot be read", () => {
    const choice = chooseReceiver({
      slug: "notifier-down",
      threads: [unreadable("077-notifier-down")],
    });
    expect(choice).toEqual({
      kind: "create",
      id: "078-notifier-down",
      blocked: [{ id: "077-notifier-down", why: "unreadable" }],
    });
  });

  it("takes the newest fit when several receivers of the slug are open", () => {
    const choice = chooseReceiver({
      slug: "main-red-alarm",
      threads: [open("076-main-red-alarm"), open("091-main-red-alarm")],
    });
    expect(choice).toEqual({ kind: "existing", id: "091-main-red-alarm" });
  });

  it("opens the first receiver of an address nobody has used yet", () => {
    const choice = chooseReceiver({
      slug: "notifier-down",
      threads: [open("001-first"), open("090-note-sort")],
    });
    expect(choice).toEqual({ kind: "create", id: "091-notifier-down", blocked: [] });
  });

  it("hands out the number AFTER the last one, not the first hole in the sequence", () => {
    const choice = chooseReceiver({
      slug: "notifier-down",
      // 002 was never opened: filling the gap would put today's receiver in the middle of
      // last month's conversations, and a thread number is read as its order.
      threads: [open("001-first"), open("003-third")],
    });
    expect(choice).toEqual({ kind: "create", id: "004-notifier-down", blocked: [] });
  });

  it("takes the number of an unreadable thread as taken", () => {
    const choice = chooseReceiver({
      slug: "notifier-down",
      threads: [unreadable("090-broken")],
    });
    expect((choice as { id: string }).id).toBe("091-notifier-down");
  });

  it("refuses a slug that would open a thread the mail cannot read", () => {
    expect(() => chooseReceiver({ slug: "../evil", threads: [] })).toThrow(ReceiverRefusedError);
    expect(unreadableReceiverSlug("../evil")).toContain("not a slug a thread id can carry");
    expect(unreadableReceiverSlug("Main Red")).toContain("lowercase letters");
    expect(unreadableReceiverSlug("")).toContain("not a slug a thread id can carry");
    expect(unreadableReceiverSlug("main-red-alarm")).toBeUndefined();
  });

  // The workflows carry FULL ids today, so this is the first typo anyone will make — and it
  // would open `091-076-main-red-alarm` silently.
  it("refuses a whole id where a slug is asked for, and names the slug inside it", () => {
    const problem = unreadableReceiverSlug("076-main-red-alarm");
    expect(problem).toContain("is a whole thread id, not a slug");
    expect(problem).toContain("'main-red-alarm'");
  });

  it("refuses when there is no free three-digit address left", () => {
    expect(() => chooseReceiver({ slug: "notifier-down", threads: [open("999-last")] })).toThrow(
      /three digits and no more/,
    );
  });
});

describe("threadSlug", () => {
  it("is the tail of the id, and undefined when there is no number in front", () => {
    expect(threadSlug("076-main-red-alarm")).toBe("main-red-alarm");
    expect(threadSlug("main-red-alarm")).toBeUndefined();
  });
});

describe("receiverNote", () => {
  it("names the receiver that could not take the letter, and why", () => {
    expect(
      receiverNote({
        kind: "create",
        id: "091-main-red-alarm",
        blocked: [{ id: "076-main-red-alarm", why: "closed" }],
      }),
    ).toBe(
      "the receiver '076-main-red-alarm' is closed and raises nobody — opening '091-main-red-alarm' as the next one for this address",
    );
  });

  it("says so plainly when the address is new", () => {
    expect(receiverNote({ kind: "create", id: "091-notifier-down", blocked: [] })).toContain(
      "no thread of this address exists yet",
    );
  });
});
