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

/**
 * WHAT THE ROW SAYS THE ROLE MAY DO TO THE BOX (protocol 23, curator's composition of 2026-08-30
 * under john's «capabilities твои»). The grammar is guarded by `v24-role-capabilities.test.ts`;
 * what is pinned HERE is the content of this repository's own declaration — the three verbs, and
 * the fact that each of them is aimed by a list somebody wrote down rather than by a free string.
 *
 * WHY THREE. The composition carried five until 2026-08-30, when `service-restart` and
 * `service-status` were struck by john's «(A) сейчас, (B) — если окажется, что рестарт нужен
 * часто»: the daemons of both circuits are USER units of the user `lle`, and the separate identity
 * `aco-devops` cannot restart or query another user's units without root, polkit, or a move to the
 * system level. The three that remain are executable by ownership and a shared group alone — which
 * is the frame the whole first version stands in.
 */
describe("the capabilities the row grants, and their boundaries", () => {
  const capabilities = devops?.capabilities ?? [];
  const byName = new Map(capabilities.map((capability) => [capability.name, capability]));

  it("declares exactly the three verbs of the first version — no fourth arrived without a PR", () => {
    expect(capabilities.map((capability) => capability.name)).toEqual([
      "log-tail",
      "repo-refresh",
      "disk-free",
    ]);
  });

  it("claims nothing systemd: the two struck verbs are absent from the row, not merely unused", () => {
    // Not a restatement of the test above: this one is the claim a future editor would break
    // silently — a row that names a verb the operating system refuses by construction reads as a
    // right and is none. They come back with decision (B), at a new schema number.
    const declared: string[] = capabilities.map((capability) => capability.name);

    expect(declared).not.toContain("service-restart");
    expect(declared).not.toContain("service-status");
  });

  it("keeps 'log-tail' a glance: named log FILES only, and a ceiling on one call", () => {
    // Files, not `journal:` targets, and the reason is measured rather than assumed: a user
    // journal on this box is `root:systemd-journal 0640` with an ACL naming exactly its own user
    // and the group `adm` (measured 2026-08-30), so `aco-devops` would need a membership nobody
    // has granted. The two daemon logs live inside the checkouts the shared group already covers.
    const tail = byName.get("log-tail");

    expect(tail?.name === "log-tail" ? tail.maxLines : undefined).toBe(200);
    expect(tail?.name === "log-tail" ? tail.logs : []).toEqual([
      "/home/lle/projects/language-learning-ecosystem/.orchestrator/daemon.log",
      "/home/lle/projects/agent-crew-orchestrator/.orchestrator/daemon.log",
    ]);
  });

  it("points 'repo-refresh' at the two circuit roots — never at a role's workspace", () => {
    // The hard boundary of the statement of work: `pull --ff-only` + install in a NAMED checkout,
    // and nothing that touches a branch, a reset or somebody's uncommitted work. A role's
    // workspace is `<root>/.worktrees/<role>`, and it is not on this list — the door refuses a
    // path outside it by name rather than walking down into it.
    const refresh = byName.get("repo-refresh");
    const checkouts = refresh?.name === "repo-refresh" ? refresh.checkouts : [];

    expect(checkouts).toEqual([
      "/home/lle/projects/language-learning-ecosystem",
      "/home/lle/projects/agent-crew-orchestrator",
    ]);
    expect(checkouts.some((path) => path.includes(".worktrees"))).toBe(false);
  });

  it("aims every list at an ABSOLUTE path — a '~' would resolve to the wrong home", () => {
    // The identities are split on purpose: the run is `aco-devops`, the files are `lle`'s. A
    // tilde written here would be expanded against `/home/aco-devops` by whatever executes it and
    // would miss the target silently — the one failure mode a closed list cannot catch by itself.
    const targets = capabilities.flatMap((capability) =>
      capability.name === "log-tail"
        ? capability.logs
        : capability.name === "repo-refresh"
          ? capability.checkouts
          : [],
    );

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.startsWith("/")).toBe(true);
  });

  it("grants no verb the config does not spell — and the row still holds no mail permission", () => {
    // Two different alphabets, deliberately: `permissions` are rights INSIDE the protocol (the
    // mail, the thread, the launch parameters), `capabilities` are verbs on the machine. The
    // role that administers the box gets the second set and none of the first.
    expect(devops?.permissions).toEqual([]);
    expect(byName.get("disk-free")).toEqual({ name: "disk-free" });
  });

  it("is a declaration and not a right in use: the role is still 'planned' and unraisable", () => {
    // The order is the point (thread 047): the verbs are reviewed and merged BEFORE anything can
    // execute them — the system user they would run as does not exist on the box yet, and no
    // executor reads this field in this build.
    expect(devops?.status).toBe("planned");
    expect(roleLaunchability(devops as Role).launchable).toBe(false);
  });
});
