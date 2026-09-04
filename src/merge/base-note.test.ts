/**
 * THE JUDGEMENT OF THE NOTE — four classes of the statement of work (thread `097`,
 * curator's `msg-030` §2), each pinned by its own case and each by the WORDS a reader would
 * act on, not by a state name: the note exists to be read, so a line that changed its
 * meaning while keeping its state would be exactly the regression nobody notices.
 *
 * The fifth case is not a class of the statement and is here anyway: the base moved and the
 * paths could not be read. It is the degradation of the only half that costs calls, and
 * without a test the honest way for it to fail is to print nothing at all.
 */
import { describe, expect, it } from "vitest";

import { describeBaseNote } from "./base-note.js";
import { baseDriftOf } from "./gate.js";

const CHECKS = (startedAt: string) => [
  { name: "checks", status: "COMPLETED", conclusion: "SUCCESS", state: undefined, startedAt },
];

const driftOf = (input: {
  readonly baseSha?: string;
  readonly baseCommittedAt?: string;
  readonly checks: ReturnType<typeof CHECKS> | [];
}) =>
  baseDriftOf({
    checks: input.checks,
    baseSha: input.baseSha,
    baseCommittedAt: input.baseCommittedAt,
  });

describe("describeBaseNote — the four classes, each said in its own line", () => {
  it("the base did not move: one line, and it names the base and the run it was dated against", () => {
    const lines = describeBaseNote({
      drift: driftOf({
        baseSha: "8003a547cf805c93b17227c732dc4d9c7c350c4d",
        baseCommittedAt: "2026-09-03T20:00:00Z",
        checks: CHECKS("2026-09-03T20:40:13Z"),
      }),
      changedPaths: ["packages/agent-protocol/src/cli.ts"],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("the base did not move under the credited 'checks'");
    expect(lines[0]).toContain("8003a54");
    expect(lines[0]).toContain("2026-09-03T20:00:00Z");
  });

  it("moved INSIDE the paths of the PR: the shared paths are named, not counted only", () => {
    const lines = describeBaseNote({
      drift: driftOf({
        baseSha: "9303cb992696d0c67086319b0eb36fbfa9c8c4c5",
        baseCommittedAt: "2026-09-03T22:41:00Z",
        checks: CHECKS("2026-09-03T22:30:00Z"),
      }),
      changedPaths: ["packages/agent-protocol/src/cli.ts", "README.md"],
      moved: {
        state: "read",
        paths: ["packages/agent-protocol/src/cli.ts", "docs/protocol-reference.md"],
      },
    });

    expect(lines).toHaveLength(2);
    // The facts of the shift come from the gate's own sentence — sha, when it landed, the
    // name of the credited run and when it started.
    expect(lines[0]).toContain("the base MOVED after the credited 'checks' started");
    expect(lines[0]).toContain("9303cb9");
    expect(lines[0]).toContain("'checks' started 2026-09-03T22:30:00Z");
    expect(lines[1]).toContain("moved THROUGH 1 path(s) this pull request also changes");
    expect(lines[1]).toContain("packages/agent-protocol/src/cli.ts");
    // The path the base moved through that this PR does NOT touch is not smuggled in.
    expect(lines[1]).not.toContain("docs/protocol-reference.md");
  });

  it("moved OUTSIDE the paths of the PR: printed, because inert is a MEASUREMENT", () => {
    const lines = describeBaseNote({
      drift: driftOf({
        baseSha: "9303cb992696d0c67086319b0eb36fbfa9c8c4c5",
        baseCommittedAt: "2026-09-03T22:41:00Z",
        checks: CHECKS("2026-09-03T22:30:00Z"),
      }),
      changedPaths: ["packages/agent-protocol/src/cli.ts"],
      moved: { state: "read", paths: ["docs/protocol-reference.md", ".github/workflows/ci.yml"] },
    });

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("the base moved OUTSIDE the paths of this pull request");
    expect(lines[1]).toContain("2 path(s) moved, none of them among the 1");
    expect(lines[1]).toContain("inert BY THIS MEASUREMENT");
  });

  it("NO CREDITED green run at all: a named line, not a crash and not a silence", () => {
    const lines = describeBaseNote({
      drift: driftOf({
        baseSha: "9303cb992696d0c67086319b0eb36fbfa9c8c4c5",
        baseCommittedAt: "2026-09-03T22:41:00Z",
        checks: [],
      }),
      changedPaths: ["packages/agent-protocol/src/cli.ts"],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("is UNKNOWN");
    expect(lines[0]).toContain("no green attempt is credited on this head");
    expect(lines[0]).toContain("This is not 'it did not'");
  });

  it("moved, and the paths were NOT read: the reason travels with the note", () => {
    const lines = describeBaseNote({
      drift: driftOf({
        baseSha: "9303cb992696d0c67086319b0eb36fbfa9c8c4c5",
        baseCommittedAt: "2026-09-03T22:41:00Z",
        checks: CHECKS("2026-09-03T22:30:00Z"),
      }),
      changedPaths: ["packages/agent-protocol/src/cli.ts"],
      moved: { state: "unread", why: "gh: Resource not accessible by integration" },
    });

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("the paths the base moved through were NOT read");
    expect(lines[1]).toContain("Resource not accessible by integration");
    expect(lines[1]).toContain("not the same as 'it does not'");
  });

  it("moved, and nobody even asked for the paths: still said, and said differently", () => {
    const lines = describeBaseNote({
      drift: driftOf({
        baseSha: "9303cb992696d0c67086319b0eb36fbfa9c8c4c5",
        baseCommittedAt: "2026-09-03T22:41:00Z",
        checks: CHECKS("2026-09-03T22:30:00Z"),
      }),
      changedPaths: [],
    });

    expect(lines[1]).toContain("(not asked)");
  });
});
