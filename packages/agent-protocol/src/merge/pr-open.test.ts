/**
 * THE DESCRIPTION JUDGED BEFORE THE PULL REQUEST EXISTS — the verdict of `pr-open.ts`, and
 * the reader it shares with guard 3. Why it exists at all is in the module's own header
 * (thread `052-pr-template`, john 2026-09-02: `role:` becomes as obligatory as `thread:`).
 *
 * What is asserted here is the REFUSAL, field by field: a door that refuses without saying
 * which field and of what shape is the defect this repair is made of, not the repair.
 */
import { describe, expect, it } from "vitest";

import { roleOfDescription } from "./gate.js";
import { judgePrDescription } from "./pr-open.js";

const KNOWN = new Set(["dev-core", "curator", "reviewer-pr"]);
const judge = (body: string) => judgePrDescription({ body, isKnownRole: (id) => KNOWN.has(id) });

/** Every refusal as one string — the assertions ask what the caller is told, not its shape. */
const said = (body: string): string => {
  const verdict = judge(body);
  expect(verdict.ok).toBe(false);
  return verdict.ok ? "" : verdict.refusals.join("\n");
};

describe("roleOfDescription — the fourth reader of the two lines", () => {
  it("takes the id of a role and nothing else", () => {
    expect(roleOfDescription("thread: 052-pr-template\nrole: dev-core\n")).toBe("dev-core");
    expect(roleOfDescription("role: reviewer-pr")).toBe("reviewer-pr");
  });

  it("does not take the placeholder of the template, with the arrow or without it", () => {
    expect(roleOfDescription("role: <id> ← заполнить")).toBeUndefined();
    expect(roleOfDescription("role: <id>")).toBeUndefined();
  });

  it("does not take a capitalised or spaced value — the greps read lowercase ids", () => {
    expect(roleOfDescription("role: Dev-Core")).toBeUndefined();
    expect(roleOfDescription("role: dev core")).toBeUndefined();
    expect(roleOfDescription("role: -dev")).toBeUndefined();
  });

  it("does not take a role named in prose — the line is a line, not a mention", () => {
    expect(roleOfDescription("this is the role: dev-core of the thread")).toBeUndefined();
  });
});

describe("judgePrDescription — the door before the pull request", () => {
  const good =
    "thread: 052-pr-template\nrole: dev-core\n\nWhat this PR is and what it stands on.\n";

  it("passes a description with both fields first, and says what it read", () => {
    const verdict = judge(good);
    expect(verdict).toEqual({ ok: true, thread: "052-pr-template", role: "dev-core" });
  });

  it("refuses the template's own placeholder — by name, both fields at once", () => {
    const refusals = said("thread: NNN-slug ← заполнить\nrole: <id> ← заполнить\n\nprose\n");
    expect(refusals).toContain("thread: <slug>");
    expect(refusals).toContain("role: <id>");
    expect(refusals).toContain("line 1");
    expect(refusals).toContain("line 2");
  });

  it("names the MISSING field when there is no such line at all", () => {
    expect(said("role: dev-core\n\nprose")).toContain("names no thread");
    expect(said("thread: 052-pr-template\n\nprose")).toContain("names no role");
  });

  it("refuses the fields in the footer — the whole of the defect the thread came from", () => {
    const refusals = said("Some prose first.\n\nthread: 052-pr-template\nrole: dev-core\n");
    expect(refusals).toContain("line 3, not on line 1");
    expect(refusals).toContain("line 4, not on line 2");
  });

  it("refuses the two fields in the wrong ORDER — line 1 is the thread", () => {
    expect(said("role: dev-core\nthread: 052-pr-template\n\nprose")).toContain("not on line 1");
  });

  it("refuses a role no config declares — a turn nobody could be handed", () => {
    const refusals = said("thread: 052-pr-template\nrole: dev-cores\n\nprose");
    expect(refusals).toContain("'dev-cores' is not listed in the protocol config");
  });

  it("refuses an empty body without saying anything but the two fields", () => {
    const refusals = said("");
    expect(refusals).toContain("names no thread");
    expect(refusals).toContain("names no role");
  });
});
