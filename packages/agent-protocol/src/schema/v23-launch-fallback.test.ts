/**
 * The step 22 → 23 — a step that moves NO DATA, and that is what is checked here first: the
 * config comes back byte-identical except for the number, no role is given a chain, and no
 * message is touched.
 *
 * The version exists for the other half (thread `036-account-failover`, step 2), and it is the
 * half the docstring of `v23-launch-fallback.ts` promises in words: the config schema is strict,
 * so an OLDER build meeting `roles[].launch.fallback` answers `Unrecognized key: fallback` —
 * invalid, true and useless. The number is the only thing that turns that into "the config is
 * newer than this build, restart what runs on it", and this repository runs the daemon it ships,
 * so that sentence is not hypothetical: a live daemon died of exactly this on 2026-07-31. That
 * promise is measured here in the words the operator reads, the same way versions 18 through
 * 22 each measure their own — the door of the CHAIN itself (`chainRefusals`, `config check`)
 * lives in `../orchestrator/failover*.test.ts` and is not repeated here.
 */
import { describe, expect, it } from "vitest";

import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import type { MigrationContext } from "./step.js";
import { LAUNCH_FALLBACK_STEP } from "./v23-launch-fallback.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const CONFIG_PATH = "/repo/agent-protocol.json";
const MAIL_ROOT = "/repo/.worktrees/comms/agent-comms";

/** A config at 22 shaped like the live one: a role that already spends a named account. */
const config = (): Record<string, unknown> => ({
  protocolVersion: 22,
  mail: { branch: "comms", dir: "agent-comms" },
  instances: [{ id: "hetzner", account: "lle-main", roles: ["dev-core"] }],
  roles: [
    {
      id: "dev-core",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      launch: {
        account: "lle-main",
        agent: { kind: "claude-code", model: "claude-opus-5[1m]", effort: "high" },
      },
    },
  ],
});

const context = (at = config()): MigrationContext => ({
  config: at,
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    throw new Error(`no such file: ${path}`);
  },
  list: () => [],
});

describe("22 → 23: the fall-back chain of a role becomes a field", () => {
  it("moves no data: the config comes back with the number changed and nothing else", () => {
    const plan = planMigration({ declared: 22, target: 23, context: context() });
    expect(plan.steps).toHaveLength(1);
    expect(plan.writes).toHaveLength(1);
    const written = plan.writes[0] as { path: string; content: string };
    expect(written.path).toBe(CONFIG_PATH);
    const after = JSON.parse(written.content) as Record<string, unknown>;
    expect(after.protocolVersion).toBe(23);
    expect({ ...after, protocolVersion: 22 }).toEqual(config());
  });

  it("gives the chain to nobody — an empty chain is john's decision, not an omission", () => {
    // The two claude accounts of this box are one subscription behind two directories, so a
    // chain between them would be a failover in appearance and a second look at the same closed
    // window in fact (john, 2026-08-29). A migration that filled one in would be inventing a
    // spare that does not exist — and the plan says so, so a human reading the dry run does not
    // have to infer it from an absence.
    const plan = planMigration({ declared: 22, target: 23, context: context() });
    const after = JSON.parse((plan.writes[0] as { content: string }).content) as {
      roles: Array<{ launch?: Record<string, unknown> }>;
    };
    expect(after.roles[0]?.launch?.fallback).toBeUndefined();
    expect(plan.steps[0]?.notes.join(" ")).toContain("no role is given one by the migration");
  });

  it("touches no message: this version says nothing about the mail", () => {
    const plan = planMigration({ declared: 22, target: 23, context: context() });
    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
  });

  it("is idempotent: a config already at 23 has nothing to migrate", () => {
    const plan = planMigration({
      declared: 23,
      target: 23,
      context: context({ ...config(), protocolVersion: 23 }),
    });
    expect(plan.steps).toHaveLength(0);
    expect(plan.writes).toHaveLength(0);
  });

  it("the step is registered where the chain looks for it", () => {
    expect(LAUNCH_FALLBACK_STEP.from).toBe(22);
    // A gap would be a refusal of the whole chain — asserted through the frame, not the array.
    expect(() => planMigration({ declared: 22, target: 23, context: context() })).not.toThrow();
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is a version this build is at or past", () => {
    // The same relaxation versions 18 through 22 each made when the next one arrived: this file
    // owns "the field landed AT 23 and is never un-landed", not "the world stopped at 23".
    expect(CURRENT_PROTOCOL_VERSION).toBeGreaterThanOrEqual(23);
  });

  it("answers a v23 config on a v22 build with 'restart required', not with 'invalid'", () => {
    // The whole reason an OPTIONAL field costs a version: the old build is the one that has to
    // produce a diagnosis, and without the number it produces `Unrecognized key: fallback`.
    const verdict = compareProtocolVersion(23, 22);
    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the KEY table gains exactly one row, and it is the field", () => {
    const before = CONFIG_SHAPES[22] ?? [];
    const after = CONFIG_SHAPES[23] ?? [];
    expect(after.filter((row) => !before.includes(row))).toEqual(["roles[].launch.fallback"]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("the VALUE table does not move: the chain is ids, and no type pins them", () => {
    // The links are free-form account ids judged by the config door (`chainRefusals`), not by an
    // enum — so this half of the guard sees nothing, and has to say so rather than be absent.
    expect(CONFIG_VALUES[23]).toEqual(CONFIG_VALUES[22]);
  });

  it("the released entry at 22 is history and is not edited", () => {
    expect(CONFIG_SHAPES[22]).not.toContain("roles[].launch.fallback");
  });
});
