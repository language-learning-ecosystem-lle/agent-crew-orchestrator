/**
 * The version that makes HOW MANY PAIRS «role × thread» RUN AT ONCE a declaration of the
 * served project (thread `177-workspace-per-pair`, john's word of 2026-09-08: «ДВЕ пары на
 * роль, плюс явный потолок на инстанс»). Asserted here is what the step claims: that the key
 * exists and is optional, that BOTH halves are required once it appears, that a box ceiling
 * below the role ceiling is refused BY NAME, that absence resolves to today's behaviour —
 * one pair per role and NO box ceiling — that a config written at 27 meets an older build as
 * "restart required" rather than as "invalid", that the KEY table gains exactly the three
 * rows of the field, and that the VALUE table does not move at all.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_PAIRS_PER_ROLE, pairCeilings, parseProtocolConfig } from "../config/config.js";
import { MIGRATIONS } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import { PAIR_CEILINGS_STEP } from "./v27-pair-ceilings.js";
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

describe("parallelism — how many pairs run at once is the project's to name", () => {
  it("accepts the declared pair of ceilings: one per role, one per box", () => {
    const parsed = parseProtocolConfig(
      config({ parallelism: { pairsPerRole: 2, pairsPerInstance: 3 } }),
    );

    expect(parsed.parallelism).toEqual({ pairsPerRole: 2, pairsPerInstance: 3 });
  });

  it("is OPTIONAL — a project that names no ceiling is a valid project", () => {
    // Absence is the honest state and it is the load-bearing requirement of this version:
    // the code lands in `main` changing NOTHING in the field until john writes the numbers.
    expect(parseProtocolConfig(config({})).parallelism).toBeUndefined();
  });

  it("refuses HALF a declaration — a role ceiling with no box ceiling, and the reverse", () => {
    // john's own argument, not symmetry: «две роли по две пары дают четыре сессии на одно
    // окно». A per-role number raised alone names the multiplication and not the bound.
    expect(() => parseProtocolConfig(config({ parallelism: { pairsPerRole: 2 } }))).toThrow();
    expect(() => parseProtocolConfig(config({ parallelism: { pairsPerInstance: 4 } }))).toThrow();
  });

  it("refuses a ceiling that is not a positive whole number of pairs", () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        parseProtocolConfig(config({ parallelism: { pairsPerRole: bad, pairsPerInstance: 4 } })),
      ).toThrow();
      expect(() =>
        parseProtocolConfig(config({ parallelism: { pairsPerRole: 1, pairsPerInstance: bad } })),
      ).toThrow();
    }
  });

  it("refuses a box ceiling BELOW the role ceiling, and says both numbers by name", () => {
    // A door that refused silently — or that quietly took the smaller of the two — would let
    // an operator read `pairsPerRole: 2` off a config where no role can ever have two.
    try {
      parseProtocolConfig(config({ parallelism: { pairsPerRole: 3, pairsPerInstance: 2 } }));
      expect.unreachable("a box ceiling under the role ceiling must be refused");
    } catch (error) {
      const text = String(error);
      expect(text).toContain("pairsPerInstance");
      expect(text).toContain("pairsPerRole");
      expect(text).toContain("2");
      expect(text).toContain("3");
    }
  });

  it("accepts the two being EQUAL — a one-role box at its own ceiling is not a mistake", () => {
    expect(
      parseProtocolConfig(config({ parallelism: { pairsPerRole: 2, pairsPerInstance: 2 } }))
        .parallelism,
    ).toEqual({ pairsPerRole: 2, pairsPerInstance: 2 });
  });
});

describe("what absence RESOLVES to — today's behaviour, bit for bit", () => {
  it("gives one pair per role when the project has declared nothing", () => {
    expect(pairCeilings(parseProtocolConfig(config({}))).pairsPerRole).toBe(1);
    expect(DEFAULT_PAIRS_PER_ROLE).toBe(1);
  });

  it("gives NO box ceiling when the project has declared nothing — and that is not the number 1", () => {
    // A default of 1 here would be the opposite of bit-for-bit: it would stand down every
    // second ROLE of the box, which nothing does today. `undefined` is "no ceiling declared".
    expect(pairCeilings(parseProtocolConfig(config({}))).pairsPerInstance).toBeUndefined();
  });

  it("passes the declared numbers through untouched when they are there", () => {
    expect(
      pairCeilings(
        parseProtocolConfig(config({ parallelism: { pairsPerRole: 2, pairsPerInstance: 4 } })),
      ),
    ).toEqual({ pairsPerRole: 2, pairsPerInstance: 4 });
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(27);
  });

  it("answers a v27 config on a v26 build with 'restart required', not with 'invalid'", () => {
    // The whole reason an optional key costs a number, and here the reader is the DAEMON —
    // the longest-lived process on this box and the one that died of `Unrecognized key`.
    const verdict = compareProtocolVersion(27, 26);

    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the KEY table gains exactly the three paths of the field and loses none", () => {
    const before = CONFIG_SHAPES[26] ?? [];
    const after = CONFIG_SHAPES[27] ?? [];

    expect(after.filter((row) => !before.includes(row))).toEqual([
      "parallelism",
      "parallelism.pairsPerInstance",
      "parallelism.pairsPerRole",
    ]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("the VALUE table does NOT move — both halves are integers and pin no vocabulary", () => {
    expect(CONFIG_VALUES[27] ?? []).toEqual(CONFIG_VALUES[26] ?? []);
  });
});

describe("the step itself", () => {
  it("is registered for 26 in the chain and writes NOTHING", () => {
    expect(PAIR_CEILINGS_STEP.from).toBe(26);
    expect(MIGRATIONS.map((step) => step.from)).toContain(26);
    expect(PAIR_CEILINGS_STEP.plan({} as never)).toEqual({
      notes: expect.arrayContaining([expect.stringContaining("'parallelism' is OPTIONAL")]),
    });
  });
});
