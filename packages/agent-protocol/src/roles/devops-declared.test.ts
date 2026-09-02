/**
 * THE ROW OF THE ROLE `devops` IN THIS REPOSITORY'S OWN CONFIG — a claim about
 * `agent-protocol.json`, held in the generic package for the reason `explicit-model.test.ts`,
 * `reviewer-pr.test.ts` and `workflow-signatures.test.ts` hold theirs: the repository serves
 * itself, and the file that decides what a role of THIS circuit is entitled to is that config.
 *
 * WHAT THE ROW IS AND WHAT MAKES IT RAISABLE (thread `047-devops-role`, john's simplified frame of
 * 2026-08-29, switched on by his word of 2026-09-02). The role names its system identity
 * (`systemUser: "aco-devops"`, protocol 22), it is `active`, and it carries a launch profile whose
 * two money fields are said rather than defaulted. None of the three stands alone: `active` without
 * a profile refuses by name (`no-launch-profile`), a profile without an owning instance refuses by
 * name too, and each of them is pinned below by the door that speaks when it is changed — because
 * the flip was a one-word diff in `status`, and a one-word diff is exactly the kind that is made
 * without reading the thread it came from.
 *
 * WHY A HALF-FILLED LAUNCH PROFILE IS THE SHAPE TO GUARD AGAINST. `launch.account` and
 * `launch.agent.model` spend money, which is john's decision and nobody else's (thread 047,
 * msg `14-45Z` for the shape, john's «последний Sonnet» of 2026-09-02 for the value). A profile
 * carrying `allowedTools` and no `agent` would parse, pass every door, and put the role on
 * whatever the vendor defaults to — the silent state `explicit-model.test.ts` exists against, and
 * one its sweep does not see, because that sweep only judges roles that HAVE an `agent` block.
 * That is why what is asserted below is that both fields are SAID: an absent profile refuses out
 * loud, a half-filled one does not.
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
import { CAPABILITY_NAMES } from "./capabilities.js";
import type { Role } from "./schema.js";
import { forbiddenPrefixes } from "./zones.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL("agent-protocol.json", REPO_ROOT));

const config = parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
const devops = config.roles.find((role) => role.id === "devops");

/** The row as it looked before john's word of 2026-09-02 — the state the doors below are read against. */
const beforeTheFlip = (role: Role): Role => ({ ...role, status: "planned" });

describe("the role 'devops' as this repository declares it", () => {
  it("is in the config at all — an absent row would make every claim below vacuously green", () => {
    expect(devops).toBeDefined();
  });

  it("names its system identity, and the card it is raised from exists on disk", () => {
    expect(devops?.systemUser).toBe("aco-devops");
    expect(devops?.instructions?.map((entry) => entry.path)).toEqual(["docs/roles/devops.md"]);
    expect(existsSync(fileURLToPath(new URL("docs/roles/devops.md", REPO_ROOT)))).toBe(true);
  });

  it("is 'active' — and the row that made it raisable is the whole flip, not the one word", () => {
    // The flip is a one-word diff only in the status; what makes the role raisable is the
    // profile and the owning instance below. `planned` is kept as the read-back of the door
    // that spoke for four weeks, so a future editor who reverts the word gets the same
    // sentence rather than silence.
    expect(devops?.status).toBe("active");
    expect(roleLaunchability(beforeTheFlip(devops as Role))).toEqual({
      launchable: false,
      reason: "inactive",
    });
    expect(roleLaunchability(devops as Role)).toEqual({ launchable: true });
  });

  it("cannot be raised as the daemon's own user now that it is active — the door names all three", () => {
    // The identity is the whole point of the row: the daemon's user on this box carries the
    // `sudo` group and reads both git private keys and `secrets.env` (measured, thread 047
    // msg-004 §2а), so a quiet fallback would hand the role everything the box has. Active
    // does not soften this by one word — the refusal is read off the row as it now stands.
    const refusal = systemUserRefusal(devops as Role, "lle");

    expect(refusal).toContain("role 'devops'");
    expect(refusal).toContain("'aco-devops'");
    expect(refusal).toContain("'lle'");
    expect(refusal).toContain("Repair:");
  });

  it("carries a launch profile that answers both money questions rather than defaulting them", () => {
    // WHAT IS ASSERTED IS THAT THEY ARE SAID, NOT WHICH: the model and the account are money,
    // i.e. john's decision, and pinning their values here would mean this file is edited by
    // whoever spends it — the review this repository wants to happen instead.
    expect(devops?.launch?.agent?.kind).toBe("claude-code");
    expect(devops?.launch?.agent?.model).toBeDefined();
    expect(devops?.launch?.account).toBeDefined();
    // The lever claude-code HAS: a session raised without it writes nothing (thread 012).
    expect((devops?.launch?.allowedTools ?? []).length).toBeGreaterThan(0);
    // Ceilings are dev-core's judgement and not john's, but their absence is not a judgement
    // at all — a row that leaves all three unsaid inherits a window sized for nobody.
    expect(devops?.launch?.limits?.wallClockSeconds).toBeDefined();
    expect(devops?.launch?.limits?.idleSeconds).toBeDefined();
    expect(devops?.launch?.limits?.maxTurns).toBeDefined();
  });

  it("is claimed by exactly one instance, so the box that raises it is declared and not remembered", () => {
    // `ownershipIssues` judges LAUNCHABLE roles only: while the row was `planned`, owned by
    // nobody was legitimate, and the sentence below is what the flip had to answer. Now that
    // it is raisable, the same judgement has to come back empty — a role owned by two boxes
    // is two daemons whose local leases know nothing of each other.
    const isKnownRole = (id: string): boolean => config.roles.some((role) => role.id === id);
    const launchable = config.roles
      .filter((role) => roleLaunchability(role).launchable)
      .map((role) => role.id);

    expect(launchable).toContain("devops");
    expect(ownershipIssues({ instances: config.instances, launchable, isKnownRole })).toEqual([]);
    expect(
      (config.instances ?? []).filter((box) => box.roles.includes("devops")).map((box) => box.id),
    ).toEqual(["hetzner"]);
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
 * WHAT THE ROW SAYS THE ROLE MAY DO TO THE BOX (protocol 24, curator's composition of 2026-08-30
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

  it("stays a closed list once the role is raisable: the verbs did not widen with the flip", () => {
    // The order was the point (thread 047): the verbs were reviewed and merged BEFORE anything
    // could execute them, and switching the role on is not the moment to add a fourth. A verb
    // arrives by a PR to this array and by nothing else — the flip moved `status`, `launch` and
    // the owning instance, and left the vocabulary of the row where review put it.
    expect(devops?.status).toBe("active");
    expect(roleLaunchability(devops as Role).launchable).toBe(true);
    expect([...byName.keys()].sort()).toEqual(["disk-free", "log-tail", "repo-refresh"]);
  });
});

/**
 * THE PROSE OF THE ROW MAY NOT OUTLIVE THE DATA UNDER IT (thread `047-devops-role`, 2026-08-30).
 *
 * `summary` is the only free text in a role's row, and the day john's hand landed on the box it
 * became the row's least true field: it still named FIVE verbs after two were struck from the
 * vocabulary, and still said the system user was absent some twenty hours after `useradd`. Both
 * halves are the failure `capabilities.ts` is built against — «a declaration that lies» — arriving
 * through the one field no door was watching, and neither half is visible in a diff of the data:
 * the `capabilities` array below the sentence was already correct.
 *
 * SO THE PROSE IS PINNED TO THE VOCABULARY, NOT PROOFREAD. Two rules, and both are machine-checked
 * here rather than in `config check`: a general door would have to refuse a summary that MENTIONS
 * `service-restart` — and the honest way to explain an exclusion is to name the excluded thing, so
 * such a door would refuse correct prose. What is claimed here is narrower and checkable: this
 * repository's own row names the verbs it declares, names no others, and restates no state of the
 * box, because the box changes under a hand this repository cannot see.
 */
describe("the prose of the row and the data under it", () => {
  const summary = devops?.summary ?? "";
  const declared = new Set((devops?.capabilities ?? []).map((capability) => capability.name));

  it("names every verb it declares, by the name the vocabulary uses", () => {
    // By the vocabulary name, not by a Russian paraphrase: «хвост логов» and «место на диске» are
    // what the row said while it also said «перезапуск сервиса контура», and a paraphrase is
    // exactly what cannot be compared to the array below it.
    expect(declared.size).toBeGreaterThan(0);
    for (const name of declared) expect(summary).toContain(name);
  });

  it("names no verb it does not declare — including the two the vocabulary no longer has", () => {
    // The struck pair is checked by name and not by the loop above: `service-restart` and
    // `service-status` are outside `CAPABILITY_NAMES` entirely, so a sweep over declared names
    // could never see them return in prose while the array stays honest.
    for (const name of CAPABILITY_NAMES) {
      if (!declared.has(name)) expect(summary).not.toContain(name);
    }
    expect(summary).not.toContain("service-restart");
    expect(summary).not.toContain("service-status");
  });

  it("restates no state of the box: the claim that went stale in a day is gone and stays gone", () => {
    // The exact sentence that rotted: «сам пользователь на ящике не заведён». It was true when
    // written on 2026-08-29 and false by 2026-08-30 ~08:20Z, and nothing in a CI run can notice —
    // the box is not the repository. The state lives in `docs/box-setup.md` §0.1, which carries
    // dates and a taken acceptance; the row points there instead of copying it.
    expect(summary).not.toContain("не заведён");
    expect(summary).toContain("docs/box-setup.md");
  });

  it("names the door of the only path in, and names it in the words of this build", () => {
    // A reason that lives in the code outlives a reason that lives on the box: the door is here,
    // named, and a future editor who deletes it breaks a test rather than a sentence. It was the
    // reason the row was `planned`; with the row `active` it is the reason the row is still safe
    // — the identity switch is the ONLY way in, and its absence refuses by name.
    expect(summary).toContain("systemUserRefusal");
    expect(devops?.status).toBe("active");
  });
});
