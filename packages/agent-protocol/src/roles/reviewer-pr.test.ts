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
/** The file that raises this reviewer — GitHub Actions does it, not the circuit. */
const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../../.github/workflows/claude-review.yml", import.meta.url),
);

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

  // THE OTHER HALF OF `roles/explicit-model.test.ts`, asserted where the reviewer's
  // launch actually lives (thread `035-explicit-models`). The circuit's roles are raised
  // from `agent-protocol.json`; this one is raised by `claude-review.yml`, and until this
  // line it named no model at all — i.e. it ran on `claude-code-action`'s default, a
  // lever on the vendor's side. Measured on 2026-08-28 (run 33159422402): the default
  // resolved to `"model": "claude-sonnet-5"`, the same name john measured on 24.08.
  //
  // The action declares no `model` input (v1 `action.yml`), so the only parameter is
  // `--model` inside the `claude_args` passthrough — which is why this asserts the flag
  // and not a `with:` key. The NAME is deliberately not asserted, for the reason its
  // sibling gives: models are money, i.e. john's decision, and changing one must be a
  // reviewable diff rather than a test somebody edits to make green.
  it("names the model it is raised with, so no vendor default moves the reviews unseen", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/^\s*--model\s+\S+$/m);
  });

  // THE COMMAND THE REVIEWER ACTUALLY TYPES (thread `042-unaccepted-turn-silent`).
  // `REVIEWER.md` tells the reviewer to declare the pair, but the template it copies
  // from lives HERE, in the prompt — and until this line the two said different things.
  // A model resolving that disagreement by itself is a bet, not a mechanism, and the
  // bet is invisible when it wins: the verdict simply arrives without the header, the
  // lift does not fire, and the turn sits unaccepted (the window this thread was opened
  // for — a consumer, 2026-08-28 17:40→17:59Z, 19 minutes).
  //
  // BOTH HALVES ARE ASSERTED TOGETHER, on the same block and not on the file, because
  // half a pair is the one shape the door refuses outright (exit 2): a template that
  // grew `--verdict` and lost `--pr` would not deliver a worse verdict, it would
  // deliver none. The VALUES are deliberately not asserted — they are `verdict.md`'s
  // first line, and the vocabulary is `REVIEWER.md`'s to move, behind john's button.
  //
  // The other `new-message` of this workflow is NOT covered and must not be: it runs
  // only when `verdict.md` does not exist, i.e. reports that no review happened, and a
  // verdict header there would announce a judgement nobody made.
  it("hands the reviewer a delivery command that declares the verdict pair", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    const delivery = workflow
      .split("\n")
      .findIndex((line) => line.includes("--from reviewer-pr --expects answer --waiting-on"));
    expect(delivery).toBeGreaterThanOrEqual(0);

    const block = workflow
      .split("\n")
      .slice(delivery, delivery + 4)
      .join("\n");
    expect(block).toMatch(/--verdict\s+\S/);
    expect(block).toMatch(/--pr\s+\S/);
  });
});
