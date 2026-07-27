import { describe, expect, it } from "vitest";

import {
  describeExclusion,
  describeScope,
  instanceIssues,
  ownershipIssues,
  resolveLaunchScope,
  scopeFlagIssues,
} from "./scope.js";

const known = (ids: readonly string[]) => (id: string) => ids.includes(id);

describe("ownership of a role by an instance (R13)", () => {
  it("a repository that declares no instances has nothing to answer for", () => {
    expect(
      ownershipIssues({ launchable: ["dev-core", "dev-speech"], isKnownRole: known(["dev-core"]) }),
    ).toEqual([]);
  });

  it("a launchable role nobody claims is refused, by name", () => {
    const issues = ownershipIssues({
      instances: [{ id: "box-a", roles: ["dev-core"] }],
      launchable: ["dev-core", "dev-speech"],
      isKnownRole: known(["dev-core", "dev-speech"]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'dev-speech'");
    expect(issues[0]).toContain("no instance claims it");
  });

  it("a role claimed by two boxes is refused with both names — the case local leases cannot cover", () => {
    const issues = ownershipIssues({
      instances: [
        { id: "box-a", roles: ["dev-core"] },
        { id: "box-b", roles: ["dev-core"] },
      ],
      launchable: ["dev-core"],
      isKnownRole: known(["dev-core"]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'box-a'");
    expect(issues[0]).toContain("'box-b'");
    expect(issues[0]).toContain("EXACTLY ONE instance");
  });

  it("an instance claiming a role that does not exist is a typo, and is said so", () => {
    const issues = ownershipIssues({
      instances: [{ id: "box-a", roles: ["dev-cor"] }],
      launchable: [],
      isKnownRole: known(["dev-core"]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'dev-cor'");
    expect(issues[0]).toContain("not declared in 'roles'");
  });

  it("one instance declared twice is refused: two descriptions of one box drift apart", () => {
    const issues = ownershipIssues({
      instances: [
        { id: "box-a", roles: ["dev-core"] },
        { id: "box-a", roles: ["dev-speech"] },
      ],
      launchable: ["dev-core", "dev-speech"],
      isKnownRole: known(["dev-core", "dev-speech"]),
    });
    expect(issues.some((issue) => issue.includes("declared twice"))).toBe(true);
  });

  it("a complete topology passes", () => {
    expect(
      ownershipIssues({
        instances: [
          { id: "box-a", roles: ["dev-core"], note: "the laptop" },
          { id: "box-b", roles: ["dev-speech"] },
        ],
        launchable: ["dev-core", "dev-speech"],
        isKnownRole: known(["dev-core", "dev-speech"]),
      }),
    ).toEqual([]);
  });
});

describe("whether the box knows which instance it is (the machine half of the join)", () => {
  const localConfigPath = "/home/x/.config/agent-protocol/local.json";

  it("no topology and no name — the pre-R13 world, silent", () => {
    expect(instanceIssues({ localConfigPath })).toEqual([]);
  });

  it("a topology and no name: refused, and the repair names the file and the choices", () => {
    const issues = instanceIssues({
      instances: [
        { id: "box-a", roles: [] },
        { id: "box-b", roles: [] },
      ],
      localConfigPath,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(localConfigPath);
    expect(issues[0]).toContain("'box-a'");
    expect(issues[0]).toContain("'box-b'");
  });

  it("a name the repository does not declare is refused rather than trusted", () => {
    const issues = instanceIssues({
      instances: [{ id: "box-a", roles: [] }],
      instance: "box-z",
      localConfigPath,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'box-z'");
    expect(issues[0]).toContain("does not declare");
  });

  it("a name with no topology at all is a mismatch too — it has nothing to join to", () => {
    const issues = instanceIssues({ instance: "box-a", localConfigPath });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("nothing to join to");
  });

  it("both halves present and agreeing — nothing to say", () => {
    expect(
      instanceIssues({
        instances: [{ id: "box-a", roles: ["dev-core"] }],
        instance: "box-a",
        localConfigPath,
      }),
    ).toEqual([]);
  });
});

describe("the operator's flags, refused at the door", () => {
  const launchable = ["dev-core", "dev-speech"];

  it("--roles and --exclude-roles together have two answers, so they are refused", () => {
    const issues = scopeFlagIssues({ select: ["dev-core"], exclude: ["dev-speech"], launchable });
    expect(issues.some((issue) => issue.includes("mutually exclusive"))).toBe(true);
  });

  it("a name that is not a launchable role is a typo, not an empty filter", () => {
    const issues = scopeFlagIssues({ select: ["dev-cor"], launchable });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'dev-cor'");
  });

  it("a well-formed selection passes", () => {
    expect(scopeFlagIssues({ select: ["dev-core"], launchable })).toEqual([]);
    expect(scopeFlagIssues({ exclude: ["dev-speech"], launchable })).toEqual([]);
    expect(scopeFlagIssues({ launchable })).toEqual([]);
  });
});

describe("the scope of a run", () => {
  const launchable = ["dev-core", "dev-speech", "curator"];
  const instances = [
    { id: "box-a", roles: ["dev-core", "curator"] },
    { id: "box-b", roles: ["dev-speech"] },
  ];

  it("without a topology every launchable role stays — the pre-R13 behaviour verbatim", () => {
    const scope = resolveLaunchScope({ launchable });
    expect(scope.roles).toEqual(launchable);
    expect(scope.excluded).toEqual([]);
    expect(scope.operator).toBe("all");
  });

  it("another box's role drops out, and the line names the owner", () => {
    const scope = resolveLaunchScope({ launchable, instances, instance: "box-a" });
    expect(scope.roles).toEqual(["dev-core", "curator"]);
    expect(scope.excluded.map((exclusion) => exclusion.role)).toEqual(["dev-speech"]);
    expect(scope.excluded[0]?.reason).toBe("other-instance");
    expect(describeExclusion(scope.excluded[0] as never)).toContain("box-b");
  });

  it("--roles narrows what is already mine, and says what it left out", () => {
    const scope = resolveLaunchScope({
      launchable,
      instances,
      instance: "box-a",
      select: ["dev-core"],
    });
    expect(scope.roles).toEqual(["dev-core"]);
    expect(scope.operator).toBe("listed");
    const curator = scope.excluded.find((exclusion) => exclusion.role === "curator");
    expect(curator?.reason).toBe("not-listed");
  });

  it("--exclude-roles is the same statement from the other side", () => {
    const scope = resolveLaunchScope({
      launchable,
      instances,
      instance: "box-a",
      exclude: ["curator"],
    });
    expect(scope.roles).toEqual(["dev-core"]);
    expect(scope.operator).toBe("all-but");
    expect(scope.excluded.find((exclusion) => exclusion.role === "curator")?.reason).toBe(
      "excluded-by-operator",
    );
  });

  it("a role that is both another box's AND excluded is reported as the former: the reason a flag cannot change", () => {
    const scope = resolveLaunchScope({
      launchable,
      instances,
      instance: "box-a",
      exclude: ["dev-speech"],
    });
    expect(scope.excluded.find((exclusion) => exclusion.role === "dev-speech")?.reason).toBe(
      "other-instance",
    );
  });

  it("saying nothing means every role of this instance — not none", () => {
    const scope = resolveLaunchScope({ launchable, instances, instance: "box-b" });
    expect(scope.roles).toEqual(["dev-speech"]);
    expect(scope.operator).toBe("all");
  });

  it("the scope is printable in one line, and an empty one says NONE rather than nothing", () => {
    const mine = describeScope(resolveLaunchScope({ launchable, instances, instance: "box-a" }));
    expect(mine).toContain("instance box-a");
    expect(mine).toContain("dev-core");
    const empty = describeScope(
      resolveLaunchScope({ launchable: ["dev-speech"], instances, instance: "box-a" }),
    );
    expect(empty).toContain("NONE");
  });
});
