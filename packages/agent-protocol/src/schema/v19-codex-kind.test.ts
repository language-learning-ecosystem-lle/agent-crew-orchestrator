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
 * AND THE THING THE SHAPE GUARD MISSES IS PINNED HERE RATHER THAN ASSUMED: the key paths of
 * version 19 are IDENTICAL to those of 18, which is why `shape.test.ts` stayed green while the
 * accepted set of values widened. A test asserting that equality turns a blind spot somebody
 * has to remember into a fact somebody would have to delete.
 */
import { describe, expect, it } from "vitest";

import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES } from "./shape.js";
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

  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(19);
  });

  it("answers a v19 config on a v18 build with 'restart required', not with 'invalid'", () => {
    // The whole reason a widened union costs a version: the OLD build is the one that has to
    // produce a diagnosis, and without the number it produces an invalid discriminator.
    const verdict = compareProtocolVersion(19, 18);
    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("is the version the shape guard could NOT have demanded — the key paths did not move", () => {
    // Not a curiosity: this equality is why `shape.test.ts` stayed green across a change that
    // an older build refuses. The guard freezes key paths; a second union member with the same
    // field names is invisible to it, and the ceremony here was performed by hand.
    expect(CONFIG_SHAPES[19]).toEqual(CONFIG_SHAPES[18]);
  });
});
