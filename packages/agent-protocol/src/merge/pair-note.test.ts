/**
 * THE JUDGEMENT OF THE PAIR NOTE — the classes named by the statement of work of thread
 * `136-unmeasured-pair-of-step-and-script` §7, each pinned by the WORDS a reader would act
 * on rather than by a state name: a line that kept its state and lost its meaning is the
 * regression nobody notices in a door that only speaks.
 *
 * The tie is checked in BOTH directions on purpose. Which of the two files travels in the
 * pull request and which one landed in the base is an accident of the day — the live
 * specimen of 2026-09-06 (#277 × #278) had the workflow in the base and the script in the
 * PR, and the mirror of it is just as ordinary.
 */
import { describe, expect, it } from "vitest";
import { baseDriftOf } from "./gate.js";
import { CONTENT_READS, describePairNote, executorCandidatesOf, pairLinksOf } from "./pair-note.js";

const CHECKS = (startedAt: string) => [
  { name: "checks", status: "COMPLETED", conclusion: "SUCCESS", state: undefined, startedAt },
];

const DRIFT = baseDriftOf({
  checks: CHECKS("2026-09-06T08:30:00Z"),
  baseSha: "6da63f3c8f0a4f6c2e1b9d0a7c5e4f3b2a1908d7",
  baseCommittedAt: "2026-09-06T08:43:42Z",
});

const CURRENT = baseDriftOf({
  checks: CHECKS("2026-09-06T08:50:00Z"),
  baseSha: "6da63f3c8f0a4f6c2e1b9d0a7c5e4f3b2a1908d7",
  baseCommittedAt: "2026-09-06T08:43:42Z",
});

const UNKNOWN = baseDriftOf({ checks: [], baseSha: undefined, baseCommittedAt: undefined });

const WORKFLOW = [
  "jobs:",
  "  checks:",
  "    steps:",
  "      - run: bash .github/scripts/review-delivery.integration.sh",
].join("\n");

describe("describePairNote — the narrow sign, both directions", () => {
  it("the executor stands in the BASE and names a script this PR changes: the note fires", () => {
    const lines = describePairNote({
      drift: DRIFT,
      changedPaths: [".github/scripts/review-delivery.integration.sh"],
      moved: { state: "read", paths: [".github/workflows/checks.yml"] },
      contents: [
        {
          path: ".github/workflows/checks.yml",
          side: "base",
          state: "read",
          text: WORKFLOW,
        },
      ],
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("NOBODY MEASURED THIS PAIR");
    expect(lines[0]).toContain(".github/workflows/checks.yml");
    expect(lines[0]).toContain(".github/scripts/review-delivery.integration.sh");
    expect(lines[0]).toContain("landed in the base");
    expect(lines[0]).toContain("changed by THIS pull request");
  });

  it("the executor stands in the PULL REQUEST and names a script the base moved: the note fires", () => {
    const lines = describePairNote({
      drift: DRIFT,
      changedPaths: [".github/workflows/checks.yml"],
      moved: { state: "read", paths: [".github/scripts/review-delivery.integration.sh"] },
      contents: [
        { path: ".github/workflows/checks.yml", side: "pr", state: "read", text: WORKFLOW },
      ],
    });

    expect(lines[0]).toContain("NOBODY MEASURED THIS PAIR");
    expect(lines[0]).toContain("'.github/workflows/checks.yml' (changed by THIS pull request)");
    expect(lines[0]).toContain(
      "'.github/scripts/review-delivery.integration.sh' (landed in the base)",
    );
  });

  it("the text carries all four things the note owes its reader", () => {
    const lines = describePairNote({
      drift: DRIFT,
      changedPaths: [".github/scripts/review-delivery.integration.sh"],
      moved: { state: "read", paths: [".github/workflows/checks.yml"] },
      contents: [
        { path: ".github/workflows/checks.yml", side: "base", state: "read", text: WORKFLOW },
      ],
    });
    const whole = lines.join("\n");

    // 1 — the paths of both sides, by name and with the side of each;
    expect(whole).toContain(".github/workflows/checks.yml");
    expect(whole).toContain(".github/scripts/review-delivery.integration.sh");
    expect(whole).toContain("landed in the base");
    expect(whole).toContain("changed by THIS pull request");
    // 2 — that this is NOT a refusal;
    expect(whole).toContain("NOT a refusal");
    expect(whole).toContain("not blocked");
    // 3 — that it does not promise completeness, naming what it misses;
    expect(whole).toContain("does not promise completeness");
    expect(whole).toContain("LITERAL path name");
    expect(whole).toContain("test imports a module");
    // 4 — what it was measured by: the sha of the base and the start of the credited check.
    expect(whole).toContain("6da63f3");
    expect(whole).toContain("2026-09-06T08:30:00Z");
  });
});

describe("describePairNote — the states that are SILENT", () => {
  it("no drift at all: not a single line", () => {
    expect(
      describePairNote({
        drift: CURRENT,
        changedPaths: [".github/workflows/checks.yml"],
      }),
    ).toEqual([]);
  });

  it("drift, but neither side has an executor candidate: not a single line", () => {
    expect(
      describePairNote({
        drift: DRIFT,
        changedPaths: ["packages/agent-protocol/src/cli.ts"],
        moved: { state: "read", paths: ["docs/protocol-reference.md"] },
        contents: [],
      }),
    ).toEqual([]);
  });

  it("a candidate that does not name any path of the other side: not a single line", () => {
    expect(
      describePairNote({
        drift: DRIFT,
        changedPaths: [".github/workflows/checks.yml"],
        moved: { state: "read", paths: ["packages/agent-protocol/src/cli.ts"] },
        contents: [
          { path: ".github/workflows/checks.yml", side: "pr", state: "read", text: WORKFLOW },
        ],
      }),
    ).toEqual([]);
  });

  it("a file that names ITSELF is not a pair", () => {
    expect(
      pairLinksOf({
        contents: [
          {
            path: ".github/workflows/checks.yml",
            side: "pr",
            state: "read",
            text: "run: cat .github/workflows/checks.yml",
          },
        ],
        changedPaths: [".github/workflows/checks.yml"],
        movedPaths: [".github/workflows/checks.yml"],
      }),
    ).toEqual([]);
  });
});

describe("describePairNote — the states that were NOT measured say so in one line", () => {
  it("the drift itself is unknown: one line, and it is not 'there is no pair'", () => {
    const lines = describePairNote({ drift: UNKNOWN, changedPaths: [] });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("was NOT measured");
    expect(lines[0]).toContain("This is not 'there is no pair'");
  });

  it("the paths of the base did not read: one line, carrying the reason verbatim", () => {
    const lines = describePairNote({
      drift: DRIFT,
      changedPaths: [".github/workflows/checks.yml"],
      moved: { state: "unread", why: "gh api refused: HTTP 502" },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("was NOT measured");
    expect(lines[0]).toContain("gh api refused: HTTP 502");
  });

  it("the content of a candidate did not read: one line, naming the file and the reason", () => {
    const lines = describePairNote({
      drift: DRIFT,
      changedPaths: [".github/scripts/review-delivery.integration.sh"],
      moved: { state: "read", paths: [".github/workflows/checks.yml"] },
      contents: [
        {
          path: ".github/workflows/checks.yml",
          side: "base",
          state: "unread",
          why: "at 6da63f3: HTTP 404",
        },
      ],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("was NOT measured");
    expect(lines[0]).toContain(".github/workflows/checks.yml");
    expect(lines[0]).toContain("HTTP 404");
  });

  it("over the ceiling: one line WITH THE NUMBER, never a silent truncation", () => {
    const lines = describePairNote({
      drift: DRIFT,
      changedPaths: [],
      moved: { state: "read", paths: [] },
      overCeiling: CONTENT_READS + 9,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(String(CONTENT_READS + 9));
    expect(lines[0]).toContain(String(CONTENT_READS));
    expect(lines[0]).toContain("truncates nothing silently");
  });
});

describe("executorCandidatesOf — which files are worth reading at all", () => {
  it("workflows and shell files of BOTH sides, and nothing else", () => {
    expect(
      executorCandidatesOf({
        changedPaths: [
          ".github/workflows/checks.yml",
          ".github/workflows/claude-review.yaml",
          "packages/agent-protocol/src/cli.ts",
          "scripts/build.sh",
        ],
        movedPaths: [".github/scripts/comms-derive.sh", "docs/protocol-reference.md"],
      }),
    ).toEqual([
      { path: ".github/workflows/checks.yml", side: "pr" },
      { path: ".github/workflows/claude-review.yaml", side: "pr" },
      { path: "scripts/build.sh", side: "pr" },
      { path: ".github/scripts/comms-derive.sh", side: "base" },
    ]);
  });

  it("a yml that is not a workflow is not an executor candidate", () => {
    expect(executorCandidatesOf({ changedPaths: ["pnpm-workspace.yaml"], movedPaths: [] })).toEqual(
      [],
    );
  });
});
