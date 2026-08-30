/**
 * THE ROW OF THE ROLE `devops` IN THIS REPOSITORY'S OWN CONFIG — a claim about
 * `agent-protocol.json`, held in the generic package for the reason `explicit-model.test.ts`,
 * `reviewer-pr.test.ts` and `workflow-signatures.test.ts` hold theirs: the repository serves
 * itself, and the file that decides what a role of THIS circuit is entitled to is that config.
 *
 * WHAT THE ROW IS AND WHAT IT DELIBERATELY IS NOT (thread `047-devops-role`, john's simplified
 * frame of 2026-08-29). The role is declared `planned`, names its system identity
 * (`systemUser: "aco-devops"`, protocol 22) and carries NO launch profile. Every one of those
 * three is a statement, not an omission, and each is pinned below by the door that speaks when
 * it is changed — because the flip to `active` is a one-word diff, and a one-word diff is
 * exactly the kind that is made without reading the thread it came from.
 *
 * WHY THE ABSENT LAUNCH PROFILE IS THE SAFE SHAPE AND A HALF-FILLED ONE IS NOT. `launch.account`
 * and `launch.agent.model` spend money, which is john's decision and nobody else's (thread 047,
 * msg `14-45Z`: curator names the shape and deliberately leaves those two unsaid). A profile
 * carrying `allowedTools` and no `agent` would parse, pass every door, and put the role on
 * whatever the vendor defaults to on the day it is switched on — the silent state
 * `explicit-model.test.ts` exists against, and one its sweep does not see, because that sweep
 * only judges roles that HAVE an `agent` block. No profile at all cannot be silent: the launch
 * door refuses by name (`no-launch-profile`), so the money question has to be answered before
 * the role can be raised at all.
 *
 * THIS TEST ASSERTS NO MODEL AND NO ACCOUNT, on purpose and for the reason `explicit-model.test.ts`
 * names: it would then have to be edited by whoever spends the money, which is precisely the
 * review this repository wants to happen.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { powerDocumentList } from "../merge/gate.js";
import { roleLaunchability, systemUserRefusal } from "../orchestrator/launch.js";
import { ownershipIssues } from "../orchestrator/scope.js";
import type { Role } from "./schema.js";
import { forbiddenPrefixes } from "./zones.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL("agent-protocol.json", REPO_ROOT));

const config = parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
const devops = config.roles.find((role) => role.id === "devops");

/** The row as it would look the day somebody switches it on, minus the money fields. */
const flippedToActive = (role: Role): Role => ({ ...role, status: "active" });

describe("the role 'devops' as this repository declares it", () => {
  it("is in the config at all — an absent row would make every claim below vacuously green", () => {
    expect(devops).toBeDefined();
  });

  it("names its system identity, and the card it is raised from exists on disk", () => {
    expect(devops?.systemUser).toBe("aco-devops");
    expect(devops?.instructions?.map((entry) => entry.path)).toEqual(["docs/roles/devops.md"]);
    expect(existsSync(fileURLToPath(new URL("docs/roles/devops.md", REPO_ROOT)))).toBe(true);
  });

  it("is 'planned', so the circuit does not raise it and says why instead of failing every tick", () => {
    // `active` today would mean a session attempted on every tick and refused by
    // `systemUserRefusal` on every one of them — attempts burned on a door that cannot open
    // until a hand on the box opens it (`docs/box-setup.md` §0.1).
    expect(devops?.status).toBe("planned");
    expect(roleLaunchability(devops as Role)).toEqual({ launchable: false, reason: "inactive" });
  });

  it("cannot be raised as the daemon's own user even once it is active — the door names all three", () => {
    // The identity is the whole point of the row: the daemon's user on this box carries the
    // `sudo` group and reads both git private keys and `secrets.env` (measured, thread 047
    // msg-004 §2а), so a quiet fallback would hand the role everything the box has.
    const refusal = systemUserRefusal(flippedToActive(devops as Role), "lle");

    expect(refusal).toContain("role 'devops'");
    expect(refusal).toContain("'aco-devops'");
    expect(refusal).toContain("'lle'");
    expect(refusal).toContain("Repair:");
  });

  it("carries no launch profile, and the flip to 'active' is refused by name rather than defaulted", () => {
    expect(devops?.launch).toBeUndefined();
    expect(roleLaunchability(flippedToActive(devops as Role))).toEqual({
      launchable: false,
      reason: "no-launch-profile",
    });
  });

  it("has no owning instance yet, and that too is refused by name at the flip, not at runtime", () => {
    // `ownershipIssues` judges LAUNCHABLE roles only, so a `planned` row owned by nobody is
    // legitimate today. Whoever switches the role on gets the sentence rather than a daemon
    // that silently raises nobody — which is what makes "declare the box" part of the flip
    // checklist instead of part of somebody's memory.
    const isKnownRole = (id: string): boolean => config.roles.some((role) => role.id === id);

    expect(ownershipIssues({ instances: config.instances, launchable: [], isKnownRole })).toEqual(
      [],
    );
    expect(
      ownershipIssues({ instances: config.instances, launchable: ["devops"], isKnownRole }).join(
        " ",
      ),
    ).toContain("no instance claims it");
  });

  it("cannot widen its own rights: the config and the cards are under its forbidden prefixes", () => {
    // The direct prohibition of the statement of work (msg-003 §5.2): a role that administers
    // the box does not edit the file that says what it may do.
    const forbidden = forbiddenPrefixes(devops as Role);

    expect(forbidden).toContain("agent-protocol.json");
    expect(forbidden).toContain("docs/roles");
    expect(forbidden).toContain("packages");
    expect(forbidden).toContain(".github/workflows");
  });

  it("makes its own card a document of power the moment it is declared — merge-gate guard 4 sees it", () => {
    // The gap curator named in the thread (msg `14-45Z`): guard 4 DERIVES the list from the
    // `instructions` of declared roles, so a brand-new role's card is invisible to it right up
    // to the PR that declares the role. This row is that PR, and from here the card is derived.
    const documents = powerDocumentList({
      roles: config.roles,
      configPath: "agent-protocol.json",
      configured: config.powerDocuments,
    });

    expect(documents).toContainEqual({ path: "docs/roles/devops.md", source: "role" });
  });
});
