/**
 * EVERY LAUNCH PROFILE OF THIS REPOSITORY NAMES ITS MODEL — a claim about this
 * repository's own config, in the generic package, for the reason `reviewer-pr.test.ts`
 * and `workflow-signatures.test.ts` hold theirs: the repository serves itself, and the
 * file that decides which model raises a role of this circuit is `agent-protocol.json`.
 *
 * WHAT WAS MEASURED, AND WHY SILENCE IS THE DEFECT (thread `035-explicit-models`;
 * john's facts of 2026-08-24, re-measured 2026-08-28 before this test was written).
 * Not one `claude-code` role named `model`, so every role of the circuit lived on the
 * ACCOUNT'S DEFAULT — a lever on the vendor's side. The journal says what that default
 * resolved to on both days: `"model":"claude-opus-5[1m]"` on the launch lines of the
 * last runs. Nothing was broken; the point is that nothing was DECIDED here either — a
 * change of the default on the vendor's side would have moved every session of this
 * circuit, in either direction (a weaker model, or a costlier one), with no diff, no PR
 * and no line anywhere to read it off. This test is that line's guard.
 *
 * IT IS NOT ABOUT WHICH MODEL. Choosing models is money, i.e. john's decision, and this
 * test deliberately asserts NO name: it would then have to be edited by whoever changes
 * a model, which is exactly the review this repository wants to happen. What it refuses
 * is the SILENT state — a launch profile that says nothing and inherits whatever the
 * vendor decided this week.
 *
 * WHY QUANTIFIED OVER THE ROLES AND NOT TWO NAMED ROWS: a third role is added by
 * copying a second, and the copy inherits the omission. `pilot-codex` (thread 026) is
 * the proof the sweep is right — it arrived with `model` already named, and it is
 * caught by the same predicate rather than by a row somebody remembered to add.
 *
 * The reviewer's model is the other half of the same thread, and it is asserted where
 * its file is read — `reviewer-pr.test.ts`, on `claude-review.yml`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";

/** This repository's own config — the one the roles of this circuit are raised from. */
const CONFIG_PATH = fileURLToPath(new URL("../../../../agent-protocol.json", import.meta.url));

const config = parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));

describe("the launch profiles of this repository's roles", () => {
  const withAgent = config.roles.filter((role) => role.launch?.agent !== undefined);

  it("are found at all — an empty sweep would be a green test that checks nothing", () => {
    // curator, dev-core, pilot-codex today; the roles GitHub Actions raises carry no
    // launch profile at all and are not judged here.
    expect(withAgent.map((role) => role.id).sort()).toEqual(["curator", "dev-core", "pilot-codex"]);
  });

  it("name the model explicitly, so no vendor default moves this circuit unseen", () => {
    const silent = withAgent
      .filter((role) => role.launch?.agent?.model === undefined)
      .map((role) => `${role.id} (agent.kind ${role.launch?.agent?.kind})`);

    expect(silent).toEqual([]);
  });
});
