/**
 * THE ROLE THE PR REVIEWER SIGNS WITH — a claim about THIS repository's own config,
 * in the generic package, for the same reason `notify/transport.test.ts` holds one:
 * the repository serves itself, and the door that refuses a verdict is this package.
 *
 * THE DEFECT IT PINS, measured on 2026-08-19 before the row existed (thread
 * `014-merge-model`): `claude-review.yml` was unfrozen with a reviewer that writes its
 * verdict into the thread as `--from reviewer-pr`, and no such role was declared. The
 * mail door answered `role 'reviewer-pr' is not listed in the config` (exit 2) — so the
 * reviewer would review, comment on the PR, and then fail red with the one artefact the
 * protocol needs (the verdict in the feed) never delivered. The workflow's own fallback
 * step (`cli role exists --role reviewer-pr`) was closed by the SAME refusal, which is
 * why the gap was invisible until somebody read both files together.
 *
 * WHAT IS ASSERTED IS THE DOOR, NOT THE SPELLING OF THE ROW: `isKnown` is exactly the
 * predicate `newMessage` asks before it writes, and the launchability is asserted
 * because the opposite would be the loud failure — a role nothing can raise must not
 * enter the circuit's queue as a candidate. `wake.mode` is `event` and not the
 * `none` of the first proposal: `none` is not in the union and the schema refuses it by
 * name, while `event` is the mode written for exactly this — woken by a platform event
 * (CI, webhook), nobody to wake or notify.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { roleLaunchability } from "../orchestrator/launch.js";
import { createRoleRegistry } from "./registry.js";

/** This repository's own config — the one the reviewer of this repository is judged by. */
const CONFIG_PATH = fileURLToPath(new URL("../../../../agent-protocol.json", import.meta.url));

const config = parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));

describe("the reviewer role of this repository", () => {
  it("is a known role, so the mail door lets its verdict in", () => {
    const registry = createRoleRegistry(config);

    expect(registry.isKnown("reviewer-pr")).toBe(true);
  });

  it("is woken by an event and is never raised by the circuit", () => {
    const role = config.roles.find((entry) => entry.id === "reviewer-pr");
    if (role === undefined) throw new Error("role 'reviewer-pr' is not in the config");

    expect(role.wake.mode).toBe("event");
    // GitHub Actions raises it, so a launch profile would be a promise nobody keeps.
    expect(role.launch).toBeUndefined();
    expect(roleLaunchability(role)).toEqual({ launchable: false, reason: "wake-not-watch" });
  });
});
