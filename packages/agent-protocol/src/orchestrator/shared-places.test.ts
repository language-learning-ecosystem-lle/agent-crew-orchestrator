/**
 * WHAT A RUN LEFT IN A PLACE THAT IS NOT ITS OWN (thread `056-shared-tmp-mechanism`, step
 * 1). The listings are injected here on purpose: what these cases are about is the
 * JUDGEMENT — appeared / was already there / could not be read — and a case that reached
 * for the real `/tmp` to make it would be the very move the thread exists to close.
 *
 * The seam (a real session, a real typed path, the line in the run's own log) is measured
 * where it can only be measured, in `run.process.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { namedSharedLeftovers, sharedPlaces, snapshotShared } from "./shared-places.js";

const stat = (sizes: Record<string, { size: number; dir: boolean }>) => (path: string) =>
  sizes[path];

describe("the shared places of a run", () => {
  it("are the platform's shared temp and the box user's home — the two every measured case landed in", () => {
    const places = sharedPlaces({ HOME: "/home/lle" });
    expect(places).toContain("/home/lle");
    // Whatever the platform calls it — the point is that the run's own directory, which
    // lives under the state directory, is never one of them.
    expect(places.length).toBe(2);
    expect(places.some((place) => place.includes(".orchestrator"))).toBe(false);
  });

  it("do not repeat a place named twice, and a box with no HOME still has its temp", () => {
    const tmp = sharedPlaces({})[0] as string;
    expect(sharedPlaces({}).length).toBe(1);
    expect(sharedPlaces({ HOME: tmp })).toEqual([tmp]);
  });
});

describe("what appeared while the run was alive", () => {
  it("is named with its size, its role and its thread — and says that a window is not an owner", () => {
    const before = snapshotShared(["/tmp"], () => ["x"]);

    const lines = namedSharedLeftovers({
      before,
      places: ["/tmp"],
      roleId: "dev-core",
      thread: "056-shared-tmp-mechanism",
      list: () => ["x", ".nothing"],
      stat: stat({ "/tmp/.nothing": { size: 140, dir: false } }),
    });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("/tmp/.nothing (140 bytes)");
    expect(lines[0]).toContain("dev-core/056-shared-tmp-mechanism");
    // The entry that was already there is not a finding: the class is what THIS run added.
    expect(lines[0]).not.toContain("/tmp/x");
    // The honesty of the line is the value of it — the measurement is a window.
    expect(lines[0]).toContain("A shared place is shared");
    expect(lines[0]).toContain("Nothing was removed");
  });

  it("says nothing at all for the ordinary run, so a line always means something appeared", () => {
    const before = snapshotShared(["/tmp", "/home/lle"], () => ["x"]);

    expect(
      namedSharedLeftovers({
        before,
        places: ["/tmp", "/home/lle"],
        roleId: "dev-core",
        thread: "056-shared-tmp-mechanism",
        list: () => ["x"],
        stat: stat({}),
      }),
    ).toEqual([]);
  });

  it("names a directory as a directory, and an entry already gone as gone rather than as 0 bytes", () => {
    const before = snapshotShared(["/tmp"], () => []);

    const [line] = namedSharedLeftovers({
      before,
      places: ["/tmp"],
      roleId: "curator",
      thread: "056-shared-tmp-mechanism",
      list: () => ["dir", "vanished"],
      stat: stat({ "/tmp/dir": { size: 4096, dir: true } }),
    });

    expect(line).toContain("/tmp/dir (directory)");
    expect(line).toContain("/tmp/vanished (gone by the close of the run)");
  });

  it("counts past the twentieth name instead of printing a thousand of them", () => {
    const before = snapshotShared(["/tmp"], () => []);
    const many = Array.from({ length: 23 }, (_, i) => `f${String(i).padStart(2, "0")}`);

    const [line] = namedSharedLeftovers({
      before,
      places: ["/tmp"],
      roleId: "dev-core",
      thread: "056-shared-tmp-mechanism",
      list: () => many,
      stat: stat({}),
    });

    expect(line).toContain("gained 23 entries");
    expect(line).toContain("… and 3 more");
    expect(line).not.toContain("/tmp/f22");
  });

  it("REFUSES BY NAME when a place cannot be listed — a hole in the measurement is not «nothing was left»", () => {
    const before = snapshotShared(["/root"], () => {
      throw new Error("EACCES: permission denied, scandir '/root'");
    });

    const [line] = namedSharedLeftovers({
      before,
      places: ["/root"],
      roleId: "dev-core",
      thread: "056-shared-tmp-mechanism",
      list: () => [],
      stat: stat({}),
    });

    expect(line).toContain("/root could not be listed");
    expect(line).toContain("permission denied");
    expect(line).toContain("is NOT named");
  });

  it("does not invent findings when the place became readable only at the close", () => {
    // An unreadable place read as EMPTY would make every entry in it look new: the door
    // would report a whole directory as this run's leavings.
    const before = snapshotShared(["/root"], () => {
      throw new Error("EACCES");
    });

    const [line] = namedSharedLeftovers({
      before,
      places: ["/root"],
      roleId: "dev-core",
      thread: "056-shared-tmp-mechanism",
      list: () => ["a", "b", "c"],
      stat: stat({}),
    });

    expect(line).toContain("could not be listed");
    expect(line).not.toContain("gained 3");
  });
});
