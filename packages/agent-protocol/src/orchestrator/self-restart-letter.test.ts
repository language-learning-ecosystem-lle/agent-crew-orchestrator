import { describe, expect, it } from "vitest";
import { type SelfRestartEvent, type SelfRestartMemory, selfRestartEvent } from "./self-restart.js";
import {
  describeDeliveredSelfRestartLetter,
  describeSuppressedSelfRestartLetter,
  describeUndeliveredSelfRestartLetter,
  planSelfRestartDelivery,
  planSelfRestartLetter,
  SELF_RESTART_SLUG,
  SELF_RESTART_WAITING_ON,
  type SelfRestartMemo,
  selfRestartSignature,
} from "./self-restart-letter.js";

const root = "/srv/aco/.worktrees/comms/agent-comms";

/** A complete event — every one of the four facts john named is known. */
const full: SelfRestartEvent = {
  from: "fd1c14a671210777eebd6e36c449986bcded0a30",
  to: "7db145ba901a521621eaed0f1fb89a146ebec8c3",
  behind: 18,
  waitedForSec: 4230,
  at: "2026-09-06T17:00:00Z",
};

/** The flag's value, read out of the argv the plan hands to the child. */
const flagValue = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

describe("planSelfRestartLetter — the four facts john required", () => {
  it("says what the code WAS and what it BECAME", () => {
    const { body } = planSelfRestartLetter({ event: full, root });
    expect(body).toContain("fd1c14a67121");
    expect(body).toContain("7db145ba901a");
  });

  it("says how far it was BEHIND", () => {
    expect(planSelfRestartLetter({ event: full, root }).body).toContain("18 коммит");
  });

  it("says how long it WAITED for the sessions, in units a human reads", () => {
    expect(planSelfRestartLetter({ event: full, root }).body).toContain("1 ч 10 мин (4230 с)");
  });

  it("names the moment it went — the stamp of the event, not of the letter", () => {
    expect(planSelfRestartLetter({ event: full, root }).body).toContain("2026-09-06T17:00:00Z");
  });

  it("names the circuit when the caller knows it, and says nothing about one when it does not", () => {
    expect(planSelfRestartLetter({ event: full, root, served: "/srv/aco" }).body).toContain(
      "/srv/aco",
    );
    expect(planSelfRestartLetter({ event: full, root }).body).not.toContain("**контур:**");
  });
});

describe("planSelfRestartLetter — a fact that is NOT KNOWN is said, not dropped", () => {
  /** The whole complaint of this thread is that silence and absence look alike. */
  const old: SelfRestartEvent = { to: full.to, at: full.at };

  it("says that the previous sha is not recorded, rather than leaving the line out", () => {
    const { body } = planSelfRestartLetter({ event: old, root });
    expect(body).toContain("какой код был:");
    expect(body).toContain("не записано");
  });

  it("says that the distance is not recorded", () => {
    expect(planSelfRestartLetter({ event: old, root }).body).toMatch(
      /сколько отставал:.*не записано/,
    );
  });

  it("says that the wait is not recorded — and never prints it as a zero", () => {
    const { body } = planSelfRestartLetter({ event: old, root });
    expect(body).toMatch(/сколько ждал сессии:.*не записано/);
    expect(body).not.toContain("сколько ждал сессии:** 0 с");
  });

  it("says a short wait in seconds and a middling one in minutes", () => {
    expect(planSelfRestartLetter({ event: { ...full, waitedForSec: 42 }, root }).body).toContain(
      "сколько ждал сессии:** 42 с",
    );
    expect(planSelfRestartLetter({ event: { ...full, waitedForSec: 600 }, root }).body).toContain(
      "10 мин (600 с)",
    );
  });
});

describe("planSelfRestartLetter — the delivery it asks for", () => {
  it("posts into the STANDING ADDRESS, opening a receiver when none is open", () => {
    const { argv } = planSelfRestartLetter({ event: full, root });
    expect(flagValue(argv, "--ensure-thread")).toBe(SELF_RESTART_SLUG);
    expect(flagValue(argv, "--title")).toBeDefined();
  });

  it("names participants — `--ensure-thread` refuses without them, at the door", () => {
    const participants = flagValue(
      planSelfRestartLetter({ event: full, root }).argv,
      "--participants",
    );
    expect(participants?.split(",")).toContain("curator");
    expect(participants?.split(",")).toContain("github");
  });

  it("is sent from the system, expects nothing back, and still CARRIES A TURN", () => {
    const { argv, waitingOn } = planSelfRestartLetter({ event: full, root });
    expect(flagValue(argv, "--from")).toBe("github");
    expect(flagValue(argv, "--expects")).toBe("none");
    expect(flagValue(argv, "--waiting-on")).toBe(SELF_RESTART_WAITING_ON);
    expect(waitingOn).toBe("curator");
  });

  it("hands the turn to a ROLE and not to a person: a turn on `john` raises nobody", () => {
    expect(planSelfRestartLetter({ event: full, root }).waitingOn).not.toBe("john");
  });

  it("carries the mail's own location through to the child, and omits what it was not given", () => {
    const withAll = planSelfRestartLetter({ event: full, root, repo: "o/r", ref: "origin/main" });
    expect(flagValue(withAll.argv, "--root")).toBe(root);
    expect(flagValue(withAll.argv, "--repo")).toBe("o/r");
    expect(flagValue(withAll.argv, "--ref")).toBe("origin/main");
    expect(planSelfRestartLetter({ event: full, root }).argv).not.toContain("--repo");
  });

  it("writes: the file, the commit and the push are one action", () => {
    expect(planSelfRestartLetter({ event: full, root }).argv).toContain("--write");
  });
});

describe("selfRestartSignature — one restart is one letter", () => {
  it("is the SAME for the same event read again — the tick a minute later says nothing new", () => {
    expect(selfRestartSignature(full)).toBe(selfRestartSignature({ ...full }));
  });

  it("does not read the wall clock: nothing but the memory's own fields is in it", () => {
    const signature = selfRestartSignature(full);
    expect(signature).toContain(full.to);
    expect(signature).toContain(full.at);
  });

  it("is UNCHANGED by facts that cannot vary while `at` stands still", () => {
    expect(selfRestartSignature({ ...full, behind: 99, waitedForSec: 1 })).toBe(
      selfRestartSignature(full),
    );
  });

  it("is DIFFERENT for a second restart onto the same sha — two restarts are two events", () => {
    expect(selfRestartSignature({ ...full, at: "2026-09-06T19:00:00Z" })).not.toBe(
      selfRestartSignature(full),
    );
  });

  it("is DIFFERENT for a restart onto another sha", () => {
    expect(
      selfRestartSignature({ ...full, to: "0000000000000000000000000000000000000000" }),
    ).not.toBe(selfRestartSignature(full));
  });
});

describe("planSelfRestartDelivery — the lock on the repeat", () => {
  const memo: SelfRestartMemo = {
    signature: selfRestartSignature(full),
    at: "2026-09-06T17:00:05Z",
  };

  it("posts when nothing was ever posted", () => {
    expect(planSelfRestartDelivery({ signature: selfRestartSignature(full) }).post).toBe(true);
  });

  it("STAYS QUIET on the tick that re-reads the same file — and says why in the journal", () => {
    const plan = planSelfRestartDelivery({ signature: selfRestartSignature(full), memo });
    expect(plan.post).toBe(false);
    if (plan.post === false) {
      expect(plan.said).toContain(SELF_RESTART_SLUG);
      expect(plan.said).toContain(memo.at);
    }
  });

  it("posts again for a NEW restart, though a letter about the previous one stands", () => {
    const next = selfRestartSignature({ ...full, at: "2026-09-06T19:00:00Z" });
    expect(planSelfRestartDelivery({ signature: next, memo }).post).toBe(true);
  });
});

describe("the journal lines — a suppressed tick and a lost letter are both readable", () => {
  it("the suppressed line points at where the one letter is", () => {
    const said = describeSuppressedSelfRestartLetter({
      memo: { signature: "x", at: "2026-09-06T17:00:05Z" },
    });
    expect(said).toContain("SUPPRESSED");
    expect(said).toContain(SELF_RESTART_SLUG);
  });

  it("the undelivered line carries the EVENT, so the log alone reconstructs it", () => {
    const said = describeUndeliveredSelfRestartLetter({
      event: full,
      cause: "exit 1: push refused",
    });
    expect(said).toContain("NOT DELIVERED");
    expect(said).toContain("push refused");
    expect(said).toContain("7db145ba901a");
    expect(said).toContain(full.at);
    expect(said).toContain("STANDS");
  });

  it("the delivered line names the address the reader has to go to", () => {
    expect(describeDeliveredSelfRestartLetter()).toContain(SELF_RESTART_SLUG);
  });
});

/**
 * THE SEAM, and it is the one this package is: the facts written by the process that died
 * (#309) reach a letter read by a human. A unit over the mapping does not measure it — what
 * is asserted here is that `selfRestartEvent`'s OUTPUT is what the letter's input consumes,
 * field for field, with no adapter in between.
 */
describe("the seam: the memory that survived the exit → the letter", () => {
  const memory: SelfRestartMemory = {
    target: "7db145ba901a521621eaed0f1fb89a146ebec8c3",
    attempts: 1,
    at: "2026-09-06T17:00:00Z",
    from: "fd1c14a671210777eebd6e36c449986bcded0a30",
    behind: 18,
    drainSince: "2026-09-06T15:49:30Z",
  };

  it("carries all four facts from the file into the body, the wait ARITHMETIC included", () => {
    const event = selfRestartEvent({ memory, loaded: memory.target });
    expect(event).toBeDefined();
    if (event === undefined) return;
    const { body } = planSelfRestartLetter({ event, root });
    expect(body).toContain("fd1c14a67121");
    expect(body).toContain("7db145ba901a");
    expect(body).toContain("18 коммит");
    // 15:49:30Z → 17:00:00Z is 4230 seconds, and the letter is what says so.
    expect(body).toContain("1 ч 10 мин (4230 с)");
  });

  it("a file written BEFORE those fields still yields a letter — it just says less", () => {
    const old: SelfRestartMemory = {
      target: memory.target,
      attempts: 1,
      at: memory.at,
    };
    const event = selfRestartEvent({ memory: old, loaded: old.target });
    expect(event).toBeDefined();
    if (event === undefined) return;
    const { body } = planSelfRestartLetter({ event, root });
    expect(body).toContain("7db145ba901a");
    expect(body).toContain("не записано");
  });

  it("somebody ELSE's restart yields no event, and so no letter is ever planned", () => {
    expect(selfRestartEvent({ memory, loaded: "0000000000000000000000000000000000000000" })).toBe(
      undefined,
    );
  });
});
