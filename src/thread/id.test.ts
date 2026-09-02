/**
 * The form of a thread id, and the ONE place it is written down (thread 086).
 *
 * The third block is the point of the file: it does not re-type the regexp, it asserts
 * that the value the WALKER filters by and the value the REFUSAL asks are the same
 * object. A test that spelled `^\d{3}-` out again would pass on the day the two copies
 * drift — which is the defect this whole change is about.
 */
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { loadThreads } from "../fs/comms.js";
import { isReadableThreadId, THREAD_ID, unreadableThreadId } from "./id.js";

describe("the form of a thread id", () => {
  it("takes `NNN-slug` — the form the walker of the mail reads", () => {
    expect(isReadableThreadId("086-thread-id-write-read-mismatch")).toBe(true);
    expect(unreadableThreadId("047-devops-role")).toBeUndefined();
  });

  it("refuses the shapes the walker does not visit", () => {
    // The live one: a sub-thread number. `NNN.M` is a new form of address, not a typo.
    expect(isReadableThreadId("047.1-devops-enablement-acceptance")).toBe(false);
    expect(isReadableThreadId("47-foo")).toBe(false);
    expect(isReadableThreadId("0471-foo")).toBe(false);
    expect(isReadableThreadId("_foo")).toBe(false);
    expect(isReadableThreadId("foo")).toBe(false);
  });
});

describe("the refusal names what a refusal in this package owes", () => {
  const problem = unreadableThreadId("047.1-devops-enablement-acceptance") as string;

  it("names the id it was given", () => {
    expect(problem).toContain("047.1-devops-enablement-acceptance");
  });

  it("names the form required", () => {
    expect(problem).toContain("<NNN>-<slug>");
  });

  // The "why" is the whole point: `047.1-…` looks perfectly reasonable to whoever types
  // it, and the damage — a conversation nothing reads and nobody is told about — is
  // invisible from the outside. A refusal that only said "bad id" would be the defect of
  // §4 of the role card in a new place.
  it("names WHY: nothing reads such a thread, and the write reports success anyway", () => {
    expect(problem).toMatch(/thread show/);
    expect(problem).toMatch(/mail/);
    expect(problem).toMatch(/invisible|reaches nobody/);
  });
});

describe("the pattern has ONE source", () => {
  const NAMES = [
    "086-thread-id",
    "047-devops-role",
    "047.1-devops-enablement-acceptance",
    "47-foo",
    "0471-foo",
    "_instances",
    "foo",
  ];

  // The equivalence itself, measured rather than re-typed: what the WALK visits and what
  // the REFUSAL lets through are the same set. Nothing here spells the regexp out — a
  // test that did would keep passing on the day the two copies drift, which is exactly
  // the defect being closed.
  it("what the walk visits is what the refusal lets through — measured, not re-typed", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-protocol-thread-id-"));
    for (const name of NAMES) mkdirSync(join(root, name), { recursive: true });

    const scan = loadThreads(root, ["dev-core"]);
    // A directory the walk VISITED is either a thread it read or a failure it named; a
    // directory it never visited is in neither. Empty ones land in `failures`, and that
    // is the answer this test needs — "was it seen at all".
    const visited = new Set([
      ...scan.threads.map((loaded) => loaded.thread.id),
      ...scan.failures.map((failure) => failure.id),
    ]);

    expect(NAMES.filter((name) => visited.has(name)).sort()).toEqual(
      NAMES.filter((name) => isReadableThreadId(name)).sort(),
    );
  });

  it("`fs/comms.ts` keeps no copy of the pattern", () => {
    const source = readFileSync(fileURLToPath(new URL("../fs/comms.ts", import.meta.url)), "utf8");
    expect(source).toContain('import { THREAD_ID } from "../thread/id.js"');
    expect(THREAD_ID.test("086-x")).toBe(true);
  });
});
