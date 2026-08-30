/**
 * VERSION 20 AND THE TWO DOORS IT PAYS FOR (thread `026-codex-agent-kind`, П1 and П2).
 *
 * Three questions are asked here and each one is a different door:
 *
 *  1. the SCHEMA — may a card omit `launch.allowedTools`, and under exactly which
 *     assertion. The requirement is conditional on the kind, so both halves are pinned:
 *     the waiver works where the tool has no lever, and the refusal stands where it has
 *     one. A test asserting only the first half would leave the defect of thread 012 (a
 *     session raised unable to write) one edit away;
 *  2. the LEVER DOOR — a role whose card declares what holds it is raised; the same card
 *     without the word is refused exactly as before, and `max-turns` is refused either
 *     way because nothing outside the run counts steps;
 *  3. the VERSION — the pair (config 20, code 19) has to read as "restart required", and
 *     the frozen tables have to move by exactly the rows this version is for.
 */
import { describe, expect, it } from "vitest";

import { buildCodexArgv, CODEX, codexEffortSchema } from "../orchestrator/codex.js";
import { CLAUDE_CODE, kindLeverRefusal, leversAskedFor } from "../orchestrator/kind.js";
import { buildLaunchArgv, describeLaunch, resolveAgentParams } from "../orchestrator/launch.js";
import { type Launch, launchSchema, leversHeldOutside, roleSchema } from "../roles/schema.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const role = (launch: unknown): Record<string, unknown> => ({
  id: "pilot",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "acme-pilot" },
  summary: "a role that pilots the second kind",
  instructions: [{ kind: "in-repo", path: "docs/roles/pilot.md" }],
  launch,
});

const WAIVER = { kind: "codex", toolsHeldBy: "sandbox-read-only" } as const;

describe("П1 — a card may omit the allow-list only by naming what holds the session", () => {
  it("raises a codex role with NO `launch.allowedTools` when the waiver is declared", () => {
    const parsed = roleSchema.safeParse(role({ agent: WAIVER }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.launch?.allowedTools).toBeUndefined();
  });

  it("REFUSES the same card without the waiver — BY NAME, at the field", () => {
    // A codex card that says nothing is not "the pilot's card minus a word": it is a role
    // whose levers went missing rather than being handed to something else.
    const parsed = roleSchema.safeParse(role({ agent: { kind: "codex", model: "gpt-5-codex" } }));
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.path).toEqual(["launch", "allowedTools"]);
    expect(issue?.message).toContain("'launch.allowedTools' is missing");
    expect(issue?.message).toContain("toolsHeldBy");
    expect(issue?.message).toContain("sandbox-read-only");
  });

  it("REFUSES a claude-code role without the profile — the defect of thread 012 stays closed", () => {
    // The half that is not cosmetics. The tool HAS the lever, so an omission here is the
    // first production run again: five minutes alive, nothing written.
    for (const launch of [{}, { agent: { kind: "claude-code" as const } }]) {
      const parsed = roleSchema.safeParse(role(launch));
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toContain("HAS the lever");
    }
  });

  it("REFUSES the waiver on the tool that has an allow-list — by the key", () => {
    // `toolsHeldBy` on claude-code would be a card claiming a sandbox holds a session the
    // package raises with `--allowedTools`. The strict member says so.
    expect(
      roleSchema.safeParse(
        role({
          allowedTools: ["Bash"],
          agent: { kind: "claude-code", toolsHeldBy: "sandbox-read-only" },
        }),
      ).success,
    ).toBe(false);
    // And the word itself is a closed literal: no other assertion is admitted by silence.
    expect(launchSchema.safeParse({ agent: { kind: "codex", toolsHeldBy: "ci" } }).success).toBe(
      false,
    );
  });

  it("the waiver covers the two levers the sandbox stands in for, and NOT max-turns", () => {
    expect(leversHeldOutside(WAIVER)).toEqual(["allowed-tools", "zone-deny"]);
    expect(leversHeldOutside({ kind: "codex", model: "gpt-5-codex" })).toEqual([]);
    expect(leversHeldOutside(undefined)).toEqual([]);

    const asks = leversAskedFor({
      denyRules: ["Edit(docs/roles/**)"],
      maxTurns: { value: 40, source: "role" },
    });
    // Zones: held outside, so the door is silent about them...
    const zonesOnly = kindLeverRefusal({
      kind: CODEX,
      role: "pilot",
      asks: leversAskedFor({ denyRules: ["Edit(docs/roles/**)"] }),
      heldOutside: leversHeldOutside(WAIVER),
    });
    expect(zonesOnly).toBeUndefined();
    // ...and a step ceiling is refused all the same, because nothing outside the run counts
    // steps — the waiver is about confinement, not about ceilings.
    const withTurns = kindLeverRefusal({
      kind: CODEX,
      role: "pilot",
      asks,
      heldOutside: leversHeldOutside(WAIVER),
    });
    expect(withTurns).toContain("max-turns");
    expect(withTurns).not.toContain("zone-deny");
  });

  it("without the waiver the refusal stands, naming the levers exactly as before", () => {
    const said = kindLeverRefusal({
      kind: CODEX,
      role: "pilot",
      asks: leversAskedFor({ allowedTools: ["Bash", "Edit"], denyRules: ["Edit(x)"] }),
    });
    expect(said).toContain("allowed-tools");
    expect(said).toContain("zone-deny");
  });

  it("П1-3 — the assertion reaches the argv as the vendor's own tokens", () => {
    const launch = launchSchema.parse({ agent: WAIVER }) as Launch;
    const argv = buildCodexArgv({ prompt: "work", maxTurns: "300", launch });
    // The pair, in order and adjacent: `--sandbox read-only` is one statement, not two flags.
    expect(argv.join(" ")).toContain("--sandbox read-only");
    // The prompt stays last (a positional after the options) and nothing else moved.
    expect(argv[argv.length - 1]).toBe("work");
    // A codex card WITHOUT the waiver carries no sandbox token: the argv does not invent a
    // confinement nobody declared.
    const plain = buildCodexArgv({
      prompt: "work",
      maxTurns: "300",
      launch: launchSchema.parse({ allowedTools: ["Bash"], agent: { kind: "codex" } }) as Launch,
    });
    expect(plain).not.toContain("--sandbox");
  });

  it("claude-code's argv REFUSES to be assembled without the profile, rather than dropping it", () => {
    expect(() =>
      buildLaunchArgv({
        prompt: "work",
        maxTurns: "300",
        launch: { agent: { kind: "codex", toolsHeldBy: "sandbox-read-only" } },
      }),
    ).toThrow(/no 'launch.allowedTools'/);
  });

  it("the display says what holds the session instead of showing an empty list", () => {
    const parsed = roleSchema.parse(role({ agent: WAIVER }));
    expect(describeLaunch(parsed)).toContain("no tool allow-list — held by sandbox-read-only");
  });
});

describe("П2 — the effort vocabulary belongs to the tool", () => {
  // WHAT THIS BLOCK STILL OWNS AFTER VERSION 21. `minimal` left the codex vocabulary at 21
  // (`v21-codex-effort-vocabulary.test.ts` — no model of the vendor's live list sells it), so
  // the LIST itself is pinned there, on the current schema. What version 20 established and
  // still holds is the other half: that there are TWO lists rather than one shared enum, that
  // each door asks its own kind for its own, and that a card's level reaches codex spelled as
  // a config override. Those are asserted here on values that are live at both versions.
  it("two vocabularies, not one — each door asks its own kind, not a shared literal", () => {
    expect(CODEX.effortLevels).toEqual(codexEffortSchema.options);
    // AND AS OF VERSION 21 THE TWO LISTS COINCIDE, which is worth an assertion rather than a
    // silence: the argument for two enums was an asymmetry (`minimal` here, `max` there) that
    // the vendor's live list refuted. What survives it is not the asymmetry but the OWNERSHIP —
    // each kind answers for its own vocabulary, so the day one vendor moves, one list moves.
    // A shared enum would make that day a change of the other tool's contract.
    expect(CLAUDE_CODE.effortLevels).not.toBe(CODEX.effortLevels);
    expect(CLAUDE_CODE.effortLevels).toEqual(CODEX.effortLevels);
    // The row version 20 froze, kept as history: the value was accepted then, and the table
    // of a released version is not edited when a later one retires it.
    expect(CONFIG_VALUES[20]).toContain('roles[].launch.agent.effort = "minimal"');
  });

  it("a level the tool does not take is a refusal that LISTS the levels, not a spent lease", () => {
    const resolved = resolveAgentParams({
      flags: { effort: "minimal" },
      worker: { value: "codex", source: "flag" },
      kind: CODEX,
    });
    expect(resolved.ok).toBe(false);
    const said = (resolved as { reason: string }).reason;
    expect(said).toContain("--effort 'minimal'");
    // The list is optional ON THE TYPE — `undefined` there means "takes effort, names no
    // closed list", which is the state this very row denies. So it is asserted, not
    // `?.`-ed away: a codex that stopped naming its levels must fail HERE, by name, and
    // not slip through as a refusal text compared against an empty join.
    const levels = CODEX.effortLevels;
    expect(levels).toBeDefined();
    expect(said).toContain(`allowed levels of 'codex' are ${(levels ?? []).join(", ")}`);
  });

  it("and the other tool's door keeps its own list, asked of the kind rather than of a literal", () => {
    const resolved = resolveAgentParams({
      flags: { effort: "minimal" },
      worker: { value: "claude-code", source: "flag" },
      kind: CLAUDE_CODE,
    });
    expect(resolved.ok).toBe(false);
    expect((resolved as { reason: string }).reason).toContain("allowed levels of 'claude-code'");
  });

  it("a card's codex effort reaches `-c model_reasoning_effort=` with its source named", () => {
    const launch = launchSchema.parse({
      agent: { ...WAIVER, model: "gpt-5.4-mini", effort: "low" },
    }) as Launch;
    const resolved = resolveAgentParams({
      flags: {},
      worker: { value: "codex", source: "role" },
      kind: CODEX,
      launch,
    });
    expect(resolved).toMatchObject({
      ok: true,
      params: { effort: { value: "low", source: "role" } },
    });
    if (!resolved.ok) return;
    const argv = buildCodexArgv({
      prompt: "work",
      maxTurns: "300",
      launch,
      params: resolved.params,
    });
    expect(argv).toContain("-c");
    expect(argv).toContain("model_reasoning_effort=low");
    expect(argv).toContain("-m");
    expect(argv).toContain("gpt-5.4-mini");
    // The other tool's spellings are absent — they are flags of another binary.
    expect(argv).not.toContain("--effort");
    expect(argv).not.toContain("--model");
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is a version this build has passed, and never one it has not reached", () => {
    // Pinned as a floor rather than as equality: 20 is history the moment 21 lands, and a test
    // that asserted "20 is current" would have to be rewritten by every later version — which
    // is how a released version's record stops being a record.
    expect(CURRENT_PROTOCOL_VERSION).toBeGreaterThanOrEqual(20);
  });

  it("answers a v20 config on a v19 build with 'restart required', not with 'invalid'", () => {
    // The words an operator reads. Without the number the older build says `Unrecognized key`
    // of `toolsHeldBy` — the class of failure that killed a live daemon on 2026-07-31.
    const verdict = compareProtocolVersion(20, 19);
    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("moves the PATH table by exactly one row — and this time that half DOES see it", () => {
    const before = CONFIG_SHAPES[19] ?? [];
    const after = CONFIG_SHAPES[20] ?? [];
    expect(after.filter((row) => !before.includes(row))).toEqual([
      "roles[].launch.agent.toolsHeldBy",
    ]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("moves the VALUE table by exactly two rows, and edits none of the released ones", () => {
    const before = CONFIG_VALUES[19] ?? [];
    const after = CONFIG_VALUES[20] ?? [];
    expect(after.filter((row) => !before.includes(row))).toEqual([
      'roles[].launch.agent.effort = "minimal"',
      'roles[].launch.agent.toolsHeldBy = "sandbox-read-only"',
    ]);
    // Nothing left the accepted set: `max` is still a level of the other member.
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
    expect(CONFIG_VALUES[19]).toContain('roles[].launch.agent.effort = "max"');
  });

  it("REQUIREDNESS is what neither half sees — measured here, homed in thread 034", () => {
    // `launch.allowedTools` went from required to conditionally optional and appears in both
    // tables unchanged, at 19 and at 20. That is a third blind spot of the same guard: it
    // freezes which paths a config MAY carry and which values they accept, never which of
    // them a config MUST carry. Recorded as a measurement rather than worked around.
    expect(CONFIG_SHAPES[19]).toContain("roles[].launch.allowedTools");
    expect(CONFIG_SHAPES[20]).toContain("roles[].launch.allowedTools");
  });
});
