import { describe, expect, it } from "vitest";
import type { Role } from "./schema.js";
import {
  changedPathsGitArgs,
  describeZones,
  parseChangedPaths,
  pathsOutsideZones,
  zoneDenyRules,
  zoneSettings,
} from "./zones.js";

const role = (zones: Role["zones"]): Role =>
  ({
    id: "dev-core",
    kind: "developer",
    status: "active",
    wake: { mode: "watch", session: "s" },
    summary: "s",
    permissions: [],
    ...(zones === undefined ? {} : { zones }),
  }) as Role;

describe("pathsOutsideZones", () => {
  it("a role without zones is restricted by nothing — the whole tree", () => {
    expect(pathsOutsideZones({ role: role(undefined), paths: ["apps/x/a.ts"] })).toEqual([]);
  });

  it("an empty forbidden list bans nothing, whatever writes says", () => {
    const r = role({ writes: ["packages/agent-protocol"], forbidden: [] });
    expect(pathsOutsideZones({ role: r, paths: ["apps/api/a.ts"] })).toEqual([]);
  });

  it("names the paths under a banned prefix, and only those", () => {
    const r = role({ writes: [], forbidden: ["apps/pronunciation-service"] });
    const verdict = pathsOutsideZones({
      role: r,
      paths: [
        "apps/api/src/index.ts",
        "apps/pronunciation-service/main.py",
        "./apps/pronunciation-service/README.md",
      ],
    });
    expect(verdict).toEqual([
      "apps/pronunciation-service/main.py",
      "apps/pronunciation-service/README.md",
    ]);
  });

  it("a prefix matches at a separator, never mid-name", () => {
    const r = role({ writes: [], forbidden: ["apps"] });
    expect(pathsOutsideZones({ role: r, paths: ["appsuite/a.ts"] })).toEqual([]);
    expect(pathsOutsideZones({ role: r, paths: ["apps/a.ts"] })).toEqual(["apps/a.ts"]);
  });

  it("a banned prefix that is a file bans that file itself", () => {
    const r = role({ writes: [], forbidden: ["PROTOCOL.md"] });
    expect(pathsOutsideZones({ role: r, paths: ["PROTOCOL.md"] })).toEqual(["PROTOCOL.md"]);
  });
});

describe("zoneDenyRules", () => {
  it("the entry and its subtree are denied to every editing tool through one Edit rule", () => {
    const r = role({ writes: [], forbidden: ["apps/pronunciation-service"] });
    // Edit(path) covers every file-editing tool; Write(path) is not matched at all
    // (the tool said so on the live probe) — so an Edit rule is the whole rule.
    expect(zoneDenyRules(r)).toEqual([
      "Edit(apps/pronunciation-service)",
      "Edit(apps/pronunciation-service/**)",
    ]);
  });

  it("Read is never denied — a zone says who may write", () => {
    const r = role({ writes: [], forbidden: ["apps"] });
    expect(zoneDenyRules(r).some((rule) => rule.startsWith("Read("))).toBe(false);
  });

  it("trailing slashes and ./ do not make a second prefix", () => {
    const r = role({ writes: [], forbidden: ["apps/", "./apps"] });
    expect(zoneDenyRules(r)).toHaveLength(2);
  });

  it("no zones — no settings at all, so the launch says nothing", () => {
    expect(zoneSettings(role(undefined))).toBeUndefined();
    expect(zoneSettings(role({ writes: ["docs"], forbidden: [] }))).toBeUndefined();
  });

  it("with zones — the settings carry the deny list", () => {
    const r = role({ writes: [], forbidden: ["apps"] });
    expect(zoneSettings(r)?.permissions.deny).toEqual(zoneDenyRules(r));
  });
});

describe("changedPathsGitArgs — the three ways a foreign-zone edit slipped past the guard", () => {
  it("no --diff-filter at all: a DELETION of a foreign file is a change like any other", () => {
    // The first version filtered ACMRT — no D — and `git rm` on a foreign file left
    // an empty path list, so the commit passed.
    const args = changedPathsGitArgs({ repo: "/r", source: { kind: "staged" } });
    expect(args.some((entry) => entry.startsWith("--diff-filter"))).toBe(false);
  });

  it("--no-renames: a rename OUT of a foreign zone shows its banned source side", () => {
    // With rename detection on, `git mv apps/pronunciation-service/x packages/foo/x`
    // reports only the destination — and the destination is inside the role's own zone.
    expect(changedPathsGitArgs({ repo: "/r", source: { kind: "staged" } })).toContain(
      "--no-renames",
    );
  });

  it("-z: a non-ASCII path arrives as a path, not as an octal-escaped quoted string", () => {
    // Default core.quotePath returns "apps/…/\\321\\202…py", which matches no prefix.
    expect(changedPathsGitArgs({ repo: "/r", source: { kind: "staged" } })).toContain("-z");
  });

  it("the staged form asks the index; the range form asks the PR range", () => {
    expect(changedPathsGitArgs({ repo: "/r", source: { kind: "staged" } })).toEqual([
      "-C",
      "/r",
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
    ]);
    expect(
      changedPathsGitArgs({ repo: "/r", source: { kind: "range", base: "origin/main" } }),
    ).toEqual(["-C", "/r", "diff", "--name-only", "--no-renames", "-z", "origin/main...HEAD"]);
  });
});

describe("parseChangedPaths", () => {
  it("NUL separates the records; the trailing NUL is not an empty path", () => {
    expect(parseChangedPaths("a.ts\0apps/x/b.py\0")).toEqual(["a.ts", "apps/x/b.py"]);
  });

  it("a non-ASCII path survives unquoted — the case -z exists for", () => {
    expect(parseChangedPaths("apps/pronunciation-service/тест.py\0")).toEqual([
      "apps/pronunciation-service/тест.py",
    ]);
  });

  it("no changes is no paths", () => {
    expect(parseChangedPaths("")).toEqual([]);
  });
});

describe("describeZones", () => {
  it("says the ban, or says there is none", () => {
    expect(describeZones(role(undefined))).toContain("no write ban");
    expect(describeZones(role({ writes: [], forbidden: ["apps"] }))).toContain("denied under apps");
  });
});
