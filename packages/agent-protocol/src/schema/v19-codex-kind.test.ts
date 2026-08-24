/**
 * The step 18 → 19 — a step that moves NO DATA, checked here as such: the config comes back
 * byte-identical except for the number, and no message is touched.
 *
 * The version exists for the OTHER half (thread `026-codex-agent-kind`): `roles[].launch.agent`
 * admits a second member (`kind: "codex"`), and a card naming it is met by a build from before
 * this version with an invalid-discriminator refusal — accurate, true and useless — unless the
 * number says the config is newer. So the pair (config 19, code 18) is measured here too, in
 * the words the operator will read.
 *
 * WHICH HALF OF THE SHAPE GUARD DEMANDS THIS NUMBER IS PINNED HERE RATHER THAN ASSUMED: the key
 * paths of 19 are IDENTICAL to those of 18 — the half that freezes PATHS stayed green across a
 * change an older build refuses (this diff is what paid for thread `034`) — and the half that
 * freezes VALUES is the one that fails without the entry. Both are asserted, because the pair is
 * the statement: a blind spot somebody has to remember becomes a fact somebody would have to
 * delete, and the door that covers it is named next to it.
 */
import { describe, expect, it } from "vitest";

import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import type { MigrationContext } from "./step.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const CONFIG_PATH = "/repo/agent-protocol.json";
const MAIL_ROOT = "/repo/.worktrees/comms/agent-comms";

const config = (): Record<string, unknown> => ({
  protocolVersion: 18,
  mail: { branch: "comms", dir: "agent-comms" },
  instances: [{ id: "box", roles: ["dev-core"] }],
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      launch: { allowedTools: ["Bash"], agent: { kind: "claude-code", model: "opus" } },
    },
  ],
});

const context = (): MigrationContext => ({
  config: config(),
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    throw new Error(`no such file: ${path}`);
  },
  list: () => [],
});

describe("18 → 19: the card may name codex", () => {
  it("moves no data: the config comes back with the number changed and nothing else", () => {
    const plan = planMigration({ declared: 18, target: 19, context: context() });
    expect(plan.steps).toHaveLength(1);
    expect(plan.writes).toHaveLength(1);
    const written = plan.writes[0] as { path: string; content: string };
    expect(written.path).toBe(CONFIG_PATH);
    const after = JSON.parse(written.content) as Record<string, unknown>;
    expect(after.protocolVersion).toBe(19);
    expect({ ...after, protocolVersion: 18 }).toEqual(config());
  });

  it("moves nobody onto codex: which tool raises a role is the project's decision", () => {
    const plan = planMigration({ declared: 18, target: 19, context: context() });
    const after = JSON.parse((plan.writes[0] as { content: string }).content) as {
      roles: readonly { launch?: { agent?: { kind?: string } } }[];
    };
    expect(after.roles[0]?.launch?.agent?.kind).toBe("claude-code");
    // And the dry run says it, so a human reading the plan is not left to infer it.
    expect(plan.steps[0]?.notes.join(" ")).toContain("no role is moved onto codex");
  });

  it("touches no message: this version says nothing about the mail", () => {
    const plan = planMigration({ declared: 18, target: 19, context: context() });
    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
  });

  it("is idempotent: a config already at 19 has nothing to migrate", () => {
    const plan = planMigration({
      declared: 19,
      target: 19,
      context: { ...context(), config: { ...config(), protocolVersion: 19 } },
    });
    expect(plan.steps).toHaveLength(0);
    expect(plan.writes).toHaveLength(0);
  });

  it("is a version this build has PASSED — 20 is what it writes now (thread 026, П1/П2)", () => {
    // The assertion moved rather than being deleted: it said "19 is the head" and the head
    // moved on, so what is worth pinning here is the ORDER — a step whose `from` is 19 exists
    // (`v20-codex-levers.ts`) and this number is behind the current one, never ahead of it.
    expect(CURRENT_PROTOCOL_VERSION).toBeGreaterThan(19);
  });

  it("answers a v19 config on a v18 build with 'restart required', not with 'invalid'", () => {
    // The whole reason a widened union costs a version: the OLD build is the one that has to
    // produce a diagnosis, and without the number it produces an invalid discriminator.
    const verdict = compareProtocolVersion(19, 18);
    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("is the version the PATH half of the shape guard could NOT have demanded", () => {
    // Not a curiosity: this equality is why `shape.test.ts` stayed green across a change that
    // an older build refuses. That half freezes key paths; a second union member with the same
    // field names is invisible to it, and the ceremony here was performed by hand.
    expect(CONFIG_SHAPES[19]).toEqual(CONFIG_SHAPES[18]);
  });

  it("is the version the VALUE half DOES demand — and it demands exactly one row", () => {
    // The other half (thread `034`) freezes the enum/const nodes of the same projection. Without
    // an entry at 19 it fails by construction; with one, the difference against 18 has to be the
    // single discriminator value this version exists for — nothing else rode along.
    const before = CONFIG_VALUES[18] ?? [];
    const after = CONFIG_VALUES[19] ?? [];
    expect(after.filter((row) => !before.includes(row))).toEqual([
      'roles[].launch.agent.kind = "codex"',
    ]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });
});
