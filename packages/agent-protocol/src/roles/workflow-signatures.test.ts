/**
 * EVERY ROLE A WORKFLOW OF THIS REPOSITORY SIGNS WITH IS DECLARED — the class, not the
 * instance. A claim about this repository's own config and its own `.github/workflows`,
 * in the generic package, for the reason `notify/transport.test.ts` and
 * `reviewer-pr.test.ts` hold theirs: the repository serves itself, and the door that
 * refuses a signature is this package.
 *
 * THE DEFECT IT PINS, and it was the SECOND of its kind within one day (thread
 * `014-merge-model`). On 2026-08-19 `merge-notify.yml` failed on the merge of PR #24
 * with `role 'github' is not listed in the config` → `new-message отказал для
 * мигрированного треда 014-merge-model — уведомление НЕ записано` (exit 1) — the same
 * refusal that had closed `reviewer-pr` the round before. The price is what makes this a
 * class rather than two typos: the merge notification is the ONLY writer of the fact of
 * a merge into the feed, and `parked-on: pr:<n>` is lifted by nothing else. It had NEVER
 * worked here — measured, not inferred: fourteen consecutive red `merge-notify` runs,
 * `32166051859` (18.08 17:31Z) through `32235536054` (19.08 09:01Z), i.e. every merge of
 * #11-#24, and not one `from: github` message anywhere in the mail on `11f62b9`. Nobody
 * saw it because the failures were red runs of a workflow nobody watches
 * (`notifier-watch.yml` is frozen here), so a piece of the protocol declared alive in
 * `docs/install-notes.md` had never once been delivered.
 *
 * WHY A SWEEP AND NOT A THIRD NAMED ROW. Both instances were invisible for the same
 * reason: the seam lives in two files that nobody reads together — a shell line inside a
 * workflow and a row of `agent-protocol.json` — and both ends look correct alone. A test
 * per role would have to be remembered at exactly the moment it is being forgotten. This
 * one reads the workflows the way the door reads them and fails BY NAME with the file,
 * the line and the flag, so the next `--from <something>` added to a workflow either has
 * its row or is red before it is merged.
 *
 * ONLY LITERALS ARE JUDGED: a value the shell substitutes (`--waiting-on "$ROLE"`) is a
 * runtime fact this test cannot know, and pretending otherwise would make the sweep
 * either noisy or quietly incomplete. What such a line does carry is checked where it can
 * be — the workflows that write `--waiting-on "$ROLE"` take that role from the `role:`
 * line of a PR description, and the door refuses an unknown one at write time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { roleLaunchability } from "../orchestrator/launch.js";
import { createRoleRegistry } from "./registry.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL("agent-protocol.json", REPO_ROOT));
const WORKFLOWS_DIR = fileURLToPath(new URL(".github/workflows/", REPO_ROOT));

/** The flags whose value IS a role id, i.e. the ones the mail door checks against the config. */
const ROLE_FLAGS = ["--from", "--waiting-on"] as const;

interface Signature {
  readonly file: string;
  readonly line: number;
  readonly flag: string;
  readonly role: string;
}

/** A value the shell fills in (`"$ROLE"`, `${{ … }}`) is not a literal this test can judge. */
const isLiteralRole = (value: string): boolean => /^[a-z][a-z0-9-]*$/.test(value);

const collectSignatures = (): readonly Signature[] => {
  const found: Signature[] = [];
  const names = readdirSync(WORKFLOWS_DIR)
    .filter((entry) => entry.endsWith(".yml"))
    .sort();
  for (const name of names) {
    const lines = readFileSync(join(WORKFLOWS_DIR, name), "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const flag of ROLE_FLAGS) {
        const match = new RegExp(`${flag}\\s+("?)([^\\s"]+)\\1`).exec(text);
        if (match === null) continue;
        const role = match[2] ?? "";
        if (!isLiteralRole(role)) continue;
        found.push({ file: name, line: index + 1, flag, role });
      }
    });
  }
  return found;
};

describe("the roles this repository's workflows sign with", () => {
  const config = parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  const registry = createRoleRegistry(config);
  const signatures = collectSignatures();

  it("are found at all — an empty sweep would be a green test that checks nothing", () => {
    // The workflows that write into the mail today: merge-notify, ci-outcome,
    // notifier-watch (`--from github`) and claude-review (`--from reviewer-pr`).
    expect(signatures.length).toBeGreaterThanOrEqual(5);
  });

  it("are every one of them declared in the config, so the mail door lets the message in", () => {
    const unknown = signatures
      .filter((signature) => !registry.isKnown(signature.role))
      .map((s) => `${s.file}:${s.line} ${s.flag} ${s.role}`);

    expect(unknown).toEqual([]);
  });

  // DECLARING A ROLE MUST NOT MOVE THE CIRCUIT QUIETLY: `github` is a signature, not a
  // worker. `wake.mode: event` is what keeps it out of the daemon's candidates and out of
  // the topology R13 answers for (`ownershipIssues` asks only about launchable and
  // resident roles), and the notifier has nobody to call for that mode. Asserted, not
  // trusted: the opposite would be a row in `agent-protocol.json` that costs a session.
  it("include a 'github' that GitHub Actions raises and the circuit never does", () => {
    const role = config.roles.find((entry) => entry.id === "github");
    if (role === undefined) throw new Error("role 'github' is not in the config");

    expect(role.wake.mode).toBe("event");
    expect(role.launch).toBeUndefined();
    expect(role.permissions ?? []).toEqual([]);
    expect(roleLaunchability(role)).toEqual({ launchable: false, reason: "wake-not-watch" });
  });
});
