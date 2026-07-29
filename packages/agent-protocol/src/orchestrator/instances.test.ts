import { describe, expect, it } from "vitest";
import {
  DIGEST_DIR,
  digestAgeSeconds,
  digestChanged,
  digestIssues,
  digestOf,
  digestPath,
  type InstanceDigest,
  isDigestPath,
  parseDigest,
  renderDigest,
  renderInstances,
  rolesOfInstance,
} from "./instances.js";
import type { LeaseView } from "./lease.js";

const view = (over: Partial<LeaseView> = {}): LeaseView => ({
  role: "dev-core",
  thread: "016-protocol-roadmap",
  state: "running",
  attempt: 1,
  ceiling: 3,
  deadline: "2026-07-27T11:00:00.000Z",
  waitDeadline: null,
  reason: null,
  lastEvent: "lease-acquired",
  overdue: false,
  exhausted: false,
  launchable: false,
  ...over,
});

const at = (iso: string): Date => new Date(iso);

describe("where a digest lives (R13)", () => {
  it("one file per box, under the class directory", () => {
    expect(digestPath("box-a")).toBe(`${DIGEST_DIR}/box-a.json`);
  });

  it("the class is recognised by path, so the checker can name it", () => {
    expect(isDigestPath("_instances/box-a.json")).toBe(true);
    expect(isDigestPath("_instances")).toBe(true);
    expect(isDigestPath("016-protocol-roadmap/messages/x.md")).toBe(false);
    expect(isDigestPath("_instancesomething/x.json")).toBe(false);
  });
});

describe("the roles a box answers for (R13, thread 025 part two)", () => {
  const topology = [
    { id: "box-a", roles: ["curator", "dev-core", "dev-speech"] },
    { id: "box-b", roles: ["dev-web"] },
  ];

  it("is the topology of THIS box — not of the circuit, and not of this launch", () => {
    expect(rolesOfInstance({ instances: topology, instance: "box-a" })).toEqual([
      "curator",
      "dev-core",
      "dev-speech",
    ]);
    expect(rolesOfInstance({ instances: topology, instance: "box-b" })).toEqual(["dev-web"]);
  });

  it("does not depend on which command asks — that is the whole point of the change", () => {
    // The old contract was "the roles THIS RUN raises", so `run --role dev-core` and the
    // daemon published different lists into one file and the last writer won. There is no
    // argument to pass here that could make the two disagree.
    expect(rolesOfInstance({ instances: topology, instance: "box-a" })).toEqual(
      rolesOfInstance({ instances: topology, instance: "box-a" }),
    );
  });

  it("an undeclared topology, or a box outside it, answers for nobody", () => {
    expect(rolesOfInstance({ instance: "box-a" })).toEqual([]);
    expect(rolesOfInstance({ instances: topology, instance: "box-z" })).toEqual([]);
  });
});

describe("what a box publishes about itself (R13)", () => {
  it("live leases only — a released pair is history, and the digest is not history", () => {
    const digest = digestOf({
      instance: "box-a",
      roles: ["dev-core"],
      leases: [
        view(),
        view({ role: "curator", thread: "017-x", state: "released" }),
        view({ role: "dev-speech", thread: "018-y", state: "waiting" }),
      ],
      now: at("2026-07-27T10:00:00.000Z"),
    });
    expect(digest.leases.map((lease) => lease.role)).toEqual(["dev-core", "dev-speech"]);
    expect(digest.writtenAt).toBe("2026-07-27T10:00:00.000Z");
    expect(digest.roles).toEqual(["dev-core"]);
  });

  it("renders as a text file with a trailing newline — it is read in diffs", () => {
    const raw = renderDigest(
      digestOf({ instance: "box-a", roles: [], leases: [], now: at("2026-07-27T10:00:00.000Z") }),
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).instance).toBe("box-a");
  });

  it("round-trips through the parser", () => {
    const digest = digestOf({
      instance: "box-a",
      roles: ["dev-core"],
      leases: [view()],
      now: at("2026-07-27T10:00:00.000Z"),
    });
    const read = parseDigest(renderDigest(digest));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.digest).toEqual(digest);
  });
});

describe("when the digest is rewritten (R13)", () => {
  const base = digestOf({
    instance: "box-a",
    roles: ["dev-core"],
    leases: [view()],
    now: at("2026-07-27T10:00:00.000Z"),
  });

  it("the first write always happens", () => {
    expect(digestChanged(undefined, base)).toBe(true);
  });

  it("a tick that changed nothing but the clock is NOT a commit — no heartbeat in the mail", () => {
    const later = digestOf({
      instance: "box-a",
      roles: ["dev-core"],
      leases: [view()],
      now: at("2026-07-27T10:30:00.000Z"),
    });
    expect(later.writtenAt).not.toBe(base.writtenAt);
    expect(digestChanged(base, later)).toBe(false);
  });

  it("a lease that appeared, moved state or ended is a change", () => {
    expect(
      digestChanged(
        base,
        digestOf({
          instance: "box-a",
          roles: ["dev-core"],
          leases: [view({ state: "draining" })],
          now: at("2026-07-27T10:30:00.000Z"),
        }),
      ),
    ).toBe(true);
    expect(
      digestChanged(
        base,
        digestOf({
          instance: "box-a",
          roles: ["dev-core"],
          leases: [],
          now: at("2026-07-27T10:30:00.000Z"),
        }),
      ),
    ).toBe(true);
  });

  it("a change of the roles this box raises is a change", () => {
    expect(
      digestChanged(
        base,
        digestOf({
          instance: "box-a",
          roles: ["dev-core", "curator"],
          leases: [view()],
          now: at("2026-07-27T10:30:00.000Z"),
        }),
      ),
    ).toBe(true);
  });
});

describe("reading somebody else's digest (R13)", () => {
  it("a malformed file is a reason, not a throw — one bad box must not blind the reader", () => {
    for (const [raw, contains] of [
      ["{", "not JSON"],
      ["[]", "not an object"],
      ['{"writtenAt":"2026-07-27T10:00:00.000Z","roles":[],"leases":[]}', "'instance'"],
      ['{"instance":"box-a","writtenAt":"soon","roles":[],"leases":[]}', "'writtenAt'"],
      ['{"instance":"box-a","writtenAt":"2026-07-27T10:00:00.000Z","leases":[]}', "'roles'"],
      ['{"instance":"box-a","writtenAt":"2026-07-27T10:00:00.000Z","roles":[]}', "'leases'"],
      [
        '{"instance":"box-a","writtenAt":"2026-07-27T10:00:00.000Z","roles":[],"leases":[{"role":"x"}]}',
        "'role'/'thread'",
      ],
    ] as const) {
      const read = parseDigest(raw);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.problem).toContain(contains);
    }
  });

  it("age is measured by the reader against writtenAt", () => {
    const digest = digestOf({
      instance: "box-a",
      roles: [],
      leases: [],
      now: at("2026-07-27T10:00:00.000Z"),
    });
    expect(digestAgeSeconds(digest, at("2026-07-27T10:01:30.000Z"))).toBe(90);
  });
});

describe("what `check` knows about the class (R13)", () => {
  const good = renderDigest(
    digestOf({ instance: "box-a", roles: [], leases: [], now: at("2026-07-27T10:00:00.000Z") }),
  );

  it("a well-formed digest of a declared instance passes", () => {
    expect(
      digestIssues({
        files: ["box-a.json"],
        contents: new Map([["box-a.json", good]]),
        declared: ["box-a", "box-b"],
      }),
    ).toEqual([]);
  });

  it("something that is not a digest in the class directory is named", () => {
    const issues = digestIssues({
      files: ["notes.md"],
      contents: new Map([["notes.md", "hi"]]),
      declared: ["box-a"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("is not a digest");
  });

  it("a file name that disagrees with the instance field is refused — the name is the identity", () => {
    const issues = digestIssues({
      files: ["box-b.json"],
      contents: new Map([["box-b.json", good]]),
      declared: ["box-a", "box-b"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("the file name is the identity");
  });

  it("a box the repository no longer declares keeps publishing — and is called out", () => {
    const issues = digestIssues({
      files: ["box-a.json"],
      contents: new Map([["box-a.json", good]]),
      declared: ["box-b"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("does not declare");
  });

  it("no declared topology means the last check has nothing to judge against", () => {
    expect(
      digestIssues({
        files: ["box-a.json"],
        contents: new Map([["box-a.json", good]]),
        declared: [],
      }),
    ).toEqual([]);
  });

  it("an unreadable file is an issue, not a skip", () => {
    const issues = digestIssues({
      files: ["box-a.json"],
      contents: new Map(),
      declared: ["box-a"],
    });
    expect(issues[0]).toContain("could not be read");
  });
});

describe("the other boxes, in `status` (R13)", () => {
  const digest = (over: Partial<InstanceDigest>): InstanceDigest => ({
    instance: "box-a",
    writtenAt: "2026-07-27T10:00:00.000Z",
    roles: ["dev-core"],
    leases: [],
    ...over,
  });

  it("no digests at all is said out loud, not shown as an empty list", () => {
    const text = renderInstances({ digests: [], now: at("2026-07-27T10:00:00.000Z") });
    expect(text).toContain("no digests published");
  });

  it("this box is marked, so a writer that stopped is visible", () => {
    const text = renderInstances({
      digests: [digest({}), digest({ instance: "box-b" })],
      self: "box-a",
      now: at("2026-07-27T10:00:10.000Z"),
    });
    expect(text).toContain("box-a (this box)");
    expect(text).not.toContain("box-b (this box)");
  });

  it("a digest older than the tolerance is marked STALE with its age", () => {
    const text = renderInstances({
      digests: [digest({})],
      now: at("2026-07-27T12:00:00.000Z"),
      staleAfterSeconds: 60,
    });
    expect(text).toContain("STALE");
    expect(text).toContain("7200s");
  });

  it("a fresh digest carries no stale mark and lists its live pairs", () => {
    const text = renderInstances({
      digests: [
        digest({
          leases: [
            {
              role: "dev-core",
              thread: "016-protocol-roadmap",
              state: "running",
              deadline: "2026-07-27T11:00:00.000Z",
            },
          ],
        }),
      ],
      now: at("2026-07-27T10:00:10.000Z"),
      staleAfterSeconds: 3600,
    });
    expect(text).not.toContain("STALE");
    expect(text).toContain("dev-core/016-protocol-roadmap");
    expect(text).toContain("deadline 2026-07-27T11:00:00.000Z");
  });

  it("a file that did not read is shown beside the boxes that did — never swallowed", () => {
    const text = renderInstances({
      digests: [digest({})],
      unreadable: new Map([["box-b.json", "not JSON"]]),
      now: at("2026-07-27T10:00:10.000Z"),
    });
    expect(text).toContain("box-b.json was not read: not JSON");
  });
});

/** D-3 part 2: the neighbours must be able to tell "standing down" from "nothing to do". */
describe("the digest publishes the closed windows", () => {
  const shelf = {
    window: "five_hour",
    until: "2026-07-29T21:40:00Z",
    since: "2026-07-29T16:40:00Z",
    stated: true,
    role: "dev-core",
  };
  const now = new Date("2026-07-29T16:41:00Z");

  it("a box with NO live leases still publishes why it is raising nobody", () => {
    const digest = digestOf({
      instance: "box",
      roles: ["dev-core"],
      leases: [],
      quota: [shelf],
      now,
    });
    expect(digest.quota).toEqual([shelf]);
    expect(renderInstances({ digests: [digest], now })).toContain("2026-07-29T21:40:00Z");
  });

  it("an empty shelf list is OMITTED — an ordinary digest is byte-identical to before", () => {
    const digest = digestOf({ instance: "box", roles: [], leases: [], quota: [], now });
    expect("quota" in digest).toBe(false);
  });

  it("the shelf MOVING is a change worth a commit — a stood-down box has no leases to move", () => {
    const idle = digestOf({ instance: "box", roles: [], leases: [], now });
    const shelved = digestOf({ instance: "box", roles: [], leases: [], quota: [shelf], now });
    expect(digestChanged(idle, shelved)).toBe(true);
  });

  it("round-trips through the file, and a neighbour without the field still reads", () => {
    const digest = digestOf({ instance: "box", roles: [], leases: [], quota: [shelf], now });
    const read = parseDigest(renderDigest(digest));
    expect(read.ok && read.digest.quota).toEqual([shelf]);
    const older = parseDigest(
      JSON.stringify({ instance: "box", writtenAt: now.toISOString(), roles: [], leases: [] }),
    );
    expect(older.ok).toBe(true);
  });

  it("a neighbour's malformed shelf is DROPPED, not a refusal to read its leases", () => {
    const read = parseDigest(
      JSON.stringify({
        instance: "box",
        writtenAt: now.toISOString(),
        roles: [],
        leases: [],
        quota: [{ window: 7 }],
      }),
    );
    expect(read.ok && read.digest.quota).toBeUndefined();
  });
});
