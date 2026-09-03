/**
 * The units of measure 4 (thread `062-contour-boundary`): where the list of foreign
 * checkouts comes from, and what a moved ref reads as. The SEAM — a whole tick with a
 * planted footprint, and the opposite control of a clean tick — is in
 * `contour-footprint.process.test.ts`, because a mapping unit cannot prove that the
 * supervisor calls any of this.
 */
import { describe, expect, it } from "vitest";

import {
  type ForeignCheckout,
  foreignCheckouts,
  namedForeignFootprints,
  snapshotForeign,
} from "./contour-footprint.js";

const SINCE = new Date("2026-09-03T12:00:00Z");
const UNTIL = new Date("2026-09-03T12:30:00Z");

const configs = (names: Record<string, string>): readonly { name: string; path: string }[] =>
  Object.keys(names).map((name) => ({ name, path: `/cfg/${name}.json` }));

const reader =
  (bodies: Record<string, unknown>) =>
  (path: string): string => {
    const body = bodies[path];
    if (body === undefined) throw new Error(`ENOENT: ${path}`);
    return JSON.stringify(body);
  };

describe("the checkouts of other contours known to the box", () => {
  it("every declared checkout that is not this run's own is a foreign one — no new key", () => {
    const found = foreignCheckouts({
      own: "/home/lle/projects/aco/.worktrees/dev-core",
      env: {},
      configs: configs({ hetzner: "", "lle-hetzner": "" }),
      read: reader({
        "/cfg/hetzner.json": { repo: "/home/lle/projects/aco" },
        "/cfg/lle-hetzner.json": { repo: "/home/lle/projects/lle" },
      }),
    });

    // The role's worktree answers with its home checkout by containment — the same rule
    // the instance resolution already uses — so the box's own house is not reported.
    expect(found.checkouts).toEqual<readonly ForeignCheckout[]>([
      { instance: "lle-hetzner", path: "/home/lle/projects/lle" },
    ]);
    expect(found.holes).toEqual([]);
  });

  it("a box with one contour declares no named config and pays nothing", () => {
    expect(foreignCheckouts({ own: "/x", env: {}, configs: [], read: reader({}) })).toEqual({
      checkouts: [],
      holes: [],
    });
  });

  it("a machine config that cannot be read is a HOLE said by name, not a silent drop", () => {
    const found = foreignCheckouts({
      own: "/x",
      env: {},
      configs: configs({ broken: "" }),
      read: () => "{ not json",
    });

    expect(found.checkouts).toEqual([]);
    expect(found.holes).toHaveLength(1);
    expect(found.holes[0]).toContain("/cfg/broken.json");
    expect(found.holes[0]).toContain("NOT known");
  });

  it("a config that declares no checkout is not a hole — it simply serves none", () => {
    const found = foreignCheckouts({
      own: "/x",
      env: {},
      configs: configs({ nameless: "" }),
      read: reader({ "/cfg/nameless.json": { instance: "nameless" } }),
    });

    expect(found).toEqual({ checkouts: [], holes: [] });
  });
});

describe("what moved in the house of another contour", () => {
  const neighbour: readonly ForeignCheckout[] = [{ instance: "lle-hetzner", path: "/lle" }];
  const refs = (map: Record<string, string>) => () => new Map(Object.entries(map));

  it("a new branch names the role, the window, the address and the ref", () => {
    const before = snapshotForeign(neighbour, refs({ "refs/heads/main": "a".repeat(40) }));
    const lines = namedForeignFootprints({
      before,
      checkouts: neighbour,
      roleId: "dev-core",
      thread: "062-contour-boundary",
      since: SINCE,
      until: UNTIL,
      refsOf: refs({ "refs/heads/main": "a".repeat(40), "refs/heads/theirs": "b".repeat(40) }),
    });

    expect(lines).toHaveLength(1);
    const line = lines[0] as string;
    expect(line).toContain("CONTOUR BOUNDARY");
    expect(line).toContain("/lle");
    expect(line).toContain("'lle-hetzner'");
    expect(line).toContain("dev-core/062-contour-boundary");
    expect(line).toContain("2026-09-03T12:00:00.000Z → 2026-09-03T12:30:00.000Z");
    expect(line).toContain("refs/heads/theirs (new, bbbbbbbb)");
    // The window is a window, and the line says so instead of accusing the run.
    expect(line).toContain("not proof of its authorship");
  });

  it("a branch that moved is named from and to — a commit in a foreign checkout is that", () => {
    const before = snapshotForeign(neighbour, refs({ "refs/heads/main": "a".repeat(40) }));
    const lines = namedForeignFootprints({
      before,
      checkouts: neighbour,
      roleId: "dev-core",
      thread: "012-x",
      since: SINCE,
      until: UNTIL,
      refsOf: refs({ "refs/heads/main": "c".repeat(40) }),
    });

    expect(lines[0]).toContain("refs/heads/main (was aaaaaaaa, now cccccccc)");
  });

  it("a tick that touched nothing outside is SILENT — the control the measure lives by", () => {
    const same = refs({ "refs/heads/main": "a".repeat(40), HEAD: "a".repeat(40) });
    expect(
      namedForeignFootprints({
        before: snapshotForeign(neighbour, same),
        checkouts: neighbour,
        roleId: "dev-core",
        thread: "012-x",
        since: SINCE,
        until: UNTIL,
        refsOf: same,
      }),
    ).toEqual([]);
  });

  it("a checkout that cannot be read is a named hole, not an empty listing full of news", () => {
    const before = snapshotForeign(neighbour, () => {
      throw new Error("not a git repository");
    });
    const lines = namedForeignFootprints({
      before,
      checkouts: neighbour,
      roleId: "dev-core",
      thread: "012-x",
      since: SINCE,
      until: UNTIL,
      refsOf: refs({ "refs/heads/main": "a".repeat(40) }),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("could not be read");
    expect(lines[0]).toContain("NOT named");
    // …and NOT a finding invented out of the hole: the refs are not listed as new.
    expect(lines[0]).not.toContain("CONTOUR BOUNDARY");
  });
});
