/**
 * The step 16 → 17 — a step that moves NO DATA, and that is exactly what is checked here:
 * the config comes out byte-identical except for the number, and no message is touched.
 *
 * The version exists for the other half (thread 080, 080.9): the config schema gains an
 * optional key (`identityDictionary`), and a strict object met by an OLDER build answers
 * `Unrecognized key` — invalid, true and useless — unless the number says the config is
 * newer. So the pair (config 17, code 16) is measured here too, in the words the operator
 * will read: a live daemon on the old build must say "restart required" and not "invalid".
 */
import { describe, expect, it } from "vitest";

import { planMigration } from "./migrate.js";
import type { MigrationContext } from "./step.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const CONFIG_PATH = "/repo/agent-protocol.json";
const MAIL_ROOT = "/repo/.worktrees/comms/agent-comms";

const config = (): Record<string, unknown> => ({
  protocolVersion: 16,
  mail: { branch: "comms", dir: "agent-comms" },
  instances: [{ id: "box", roles: ["dev-core"] }],
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
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

describe("16 → 17: the dictionary of authorized signatures becomes a declaration", () => {
  it("moves no data: the config comes back with the number changed and nothing else", () => {
    const plan = planMigration({ declared: 16, target: 17, context: context() });
    expect(plan.steps).toHaveLength(1);
    expect(plan.writes).toHaveLength(1);
    const written = plan.writes[0] as { path: string; content: string };
    expect(written.path).toBe(CONFIG_PATH);
    const after = JSON.parse(written.content) as Record<string, unknown>;
    expect(after.protocolVersion).toBe(17);
    expect({ ...after, protocolVersion: 16 }).toEqual(config());
  });

  it("declares the dictionary for nobody — a filled-in default is the defect it removes", () => {
    const plan = planMigration({ declared: 16, target: 17, context: context() });
    const after = JSON.parse((plan.writes[0] as { content: string }).content) as Record<
      string,
      unknown
    >;
    expect(after.identityDictionary).toBeUndefined();
    // And the plan says so, so a human reading the dry run is not left to infer it.
    expect(plan.steps[0]?.notes.join(" ")).toContain("declares it for nobody");
  });

  it("touches no message: this version says nothing about the mail", () => {
    const plan = planMigration({ declared: 16, target: 17, context: context() });
    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
  });

  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(17);
  });

  it("answers a v17 config on a v16 build with 'restart required', not with 'invalid'", () => {
    // The whole reason an optional field costs a version: the OLD build is the one that
    // has to produce a diagnosis, and without the number it produces 'Unrecognized key'.
    const verdict = compareProtocolVersion(17, 16);
    expect(verdict.state).toBe("ahead");
    const refusal = renderVersionVerdict(verdict);
    expect(refusal).toContain("restart required");
  });
});
