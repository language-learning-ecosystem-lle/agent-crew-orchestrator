/**
 * The version that makes THE NAME OF THE ROUND OF REVIEW a declaration of the served
 * project (thread `063-state-model-rewrite`, john's word of 2026-09-03: «1 — КОНФИГ»).
 * Asserted here is what the step claims: that the key exists and is optional, that BOTH
 * halves are required once it appears, that a config written at 26 meets an older build as
 * "restart required" rather than as "invalid", that the KEY table gains exactly the three
 * rows of the field, and that the VALUE table does not move at all — both halves are free
 * strings and pin nothing.
 */
import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { MIGRATIONS } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import { REVIEW_ROUND_STEP } from "./v26-review-round.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const config = (over: Record<string, unknown>): Record<string, unknown> => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "…",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
    },
  ],
  ...over,
});

describe("review — the round is the project's to name", () => {
  it("accepts the declared pair: the label a role hangs and the workflow that answers", () => {
    const parsed = parseProtocolConfig(
      config({ review: { label: "review", workflow: "Claude PR Review" } }),
    );

    expect(parsed.review).toEqual({ label: "review", workflow: "Claude PR Review" });
  });

  it("is OPTIONAL — a project that names no round is a valid project", () => {
    // Absence is the honest state: what changes with this version is that the frame then
    // says nothing about rounds of review, not that the config is refused. A required key
    // would have made every served repository invent a label before it could be read.
    expect(parseProtocolConfig(config({})).review).toBeUndefined();
  });

  it("refuses HALF a declaration — a label with no workflow, a workflow with no label", () => {
    // Half a declaration is the silence this field exists to end, wearing the shape of a
    // declaration: a label nobody can look for an answer to, or an answer to no question.
    expect(() => parseProtocolConfig(config({ review: { label: "review" } }))).toThrow();
    expect(() =>
      parseProtocolConfig(config({ review: { workflow: "Claude PR Review" } })),
    ).toThrow();
    expect(() => parseProtocolConfig(config({ review: { label: "", workflow: "w" } }))).toThrow();
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(26);
  });

  it("answers a v26 config on a v25 build with 'restart required', not with 'invalid'", () => {
    // The whole reason an optional key costs a number: a strict schema one field behind
    // answers `Unrecognized key: review`, which is invalid, true and useless.
    const verdict = compareProtocolVersion(26, 25);

    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the KEY table gains exactly the three paths of the field and loses none", () => {
    const before = CONFIG_SHAPES[25] ?? [];
    const after = CONFIG_SHAPES[26] ?? [];

    expect(after.filter((row) => !before.includes(row))).toEqual([
      "review",
      "review.label",
      "review.workflow",
    ]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("the VALUE table does NOT move — both halves are free strings and pin nothing", () => {
    expect(CONFIG_VALUES[26] ?? []).toEqual(CONFIG_VALUES[25] ?? []);
  });
});

describe("the step itself", () => {
  it("is registered for 25 in the chain and writes NOTHING", () => {
    expect(REVIEW_ROUND_STEP.from).toBe(25);
    expect(MIGRATIONS.map((step) => step.from)).toContain(25);
    expect(REVIEW_ROUND_STEP.plan({} as never)).toEqual({
      notes: expect.arrayContaining([expect.stringContaining("'review' is OPTIONAL")]),
    });
  });
});
