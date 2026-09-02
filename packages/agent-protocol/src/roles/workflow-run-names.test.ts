/**
 * EVERY WORKFLOW NAME A `workflow_run` TRIGGER LISTENS FOR EXISTS IN THIS REPOSITORY —
 * the same sweep class as `workflow-signatures.test.ts`, and it sits beside it for that
 * reason rather than in a directory of its own: both read `.github/workflows/**` the way
 * the platform reads it and fail BY NAME with the file, the line and the value.
 *
 * THE DEFECT IT PINS, measured on 2026-09-02 (thread `073-notifiers-frozen-in-own-contour`).
 * `ci-outcome.yml` was unfrozen back to a live trigger, and the `workflows:` list it came
 * back with — the one frozen into it on 2026-08-17 — named `CI`, `E2E` and `Mobile E2E`.
 * Not one of the three exists in this repository: the run of checks here is called
 * `checks`. A `workflow_run` trigger naming a workflow that does not exist is NOT an
 * error on GitHub — it is silence. The file reads as alive, the Actions tab shows nothing
 * wrong, and no completed-event is ever delivered, which is indistinguishable from "no
 * run finished yet".
 *
 * WHY A TEST AND NOT ONE MORE CAREFUL READING. The same silence had already been paid for
 * in the parent contour with a name that was merely MISSING rather than wrong: an
 * emulator run was added and nobody appended it to this list, so its outcome raised no
 * letter at all and the `run:` park behind it was lifted by TTL instead of by the verdict
 * — a session woken blind half an hour after the round had ended, twice in a row on one
 * PR (2026-08-14). Both halves of the defect — a name that is stale and a name that is
 * absent — live in the gap between two files nobody reads together, and only the first
 * half is checkable from inside the repository. This test checks that half.
 *
 * ONLY NAMES ARE JUDGED, NOT COMPLETENESS: that a workflow SHOULD be listed is a decision
 * (which runs are worth a letter), and a test asserting it would be asserting the
 * decision, not the seam. What is checked is the direction that has one right answer —
 * a listed name either belongs to a file here or belongs nowhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const WORKFLOWS_DIR = fileURLToPath(new URL(".github/workflows/", REPO_ROOT));

interface Listened {
  /** The workflow file carrying the `workflow_run` trigger. */
  readonly file: string;
  /** 1-indexed line of the `workflows:` list, so a failure points at what to edit. */
  readonly line: number;
  /** One name out of that list, quotes stripped. */
  readonly name: string;
}

const workflowFiles = (): readonly string[] =>
  readdirSync(WORKFLOWS_DIR)
    .filter((entry) => entry.endsWith(".yml"))
    .sort();

/**
 * The declared `name:` of each workflow — the value `workflow_run` matches against, which
 * is the workflow's NAME and never its filename.
 */
const declaredNames = (): ReadonlyMap<string, string> => {
  const names = new Map<string, string>();
  for (const file of workflowFiles()) {
    const match = /^name:\s*(.+?)\s*$/m.exec(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
    if (match !== undefined && match !== null)
      names.set(file, (match[1] ?? "").replace(/^["']|["']$/g, ""));
  }
  return names;
};

/**
 * The inline form is the only one used here (`workflows: [a, b, "c d"]`), and reading it
 * with a regex rather than a YAML parser is deliberate: the block form would be a silent
 * miss, so it is refused loudly by the first assertion below instead of being half-read.
 */
const collectListened = (): readonly Listened[] => {
  const found: Listened[] = [];
  for (const file of workflowFiles()) {
    const lines = readFileSync(join(WORKFLOWS_DIR, file), "utf8").split("\n");
    lines.forEach((text, index) => {
      if (/^\s*#/.test(text)) return;
      const match = /^\s*workflows:\s*\[(.+)\]\s*$/.exec(text);
      if (match === null) return;
      for (const raw of (match[1] ?? "").split(",")) {
        const name = raw.trim().replace(/^["']|["']$/g, "");
        if (name.length > 0) found.push({ file, line: index + 1, name });
      }
    });
  }
  return found;
};

describe("the workflow names this repository's `workflow_run` triggers listen for", () => {
  const names = declaredNames();
  const listened = collectListened();

  it("are found at all — an empty sweep would be a green test that checks nothing", () => {
    // Two listeners write into the mail today: `ci-outcome.yml` (the run of checks) and
    // `notifier-watch.yml` (the four notifiers it watches).
    expect(listened.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(listened.map((entry) => entry.file))].sort()).toEqual([
      "ci-outcome.yml",
      "notifier-watch.yml",
    ]);
  });

  it("name a workflow that exists here — a name that does not is silence, not an error", () => {
    const declared = new Set(names.values());
    const dangling = listened
      .filter((entry) => !declared.has(entry.name))
      .map((entry) => `${entry.file}:${entry.line} workflows: [… ${entry.name} …]`);

    expect(dangling).toEqual([]);
  });

  it("never name their own workflow — `workflow_run` is not recursive, so it would be a lie", () => {
    const selfListening = listened
      .filter((entry) => names.get(entry.file) === entry.name)
      .map((entry) => `${entry.file}:${entry.line} listens for itself (${entry.name})`);

    expect(selfListening).toEqual([]);
  });
});
