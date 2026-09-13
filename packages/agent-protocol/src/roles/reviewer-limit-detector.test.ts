/**
 * THE LIMIT DETECTOR OF THE REVIEW ROUND — the jq program of the step `Лимит основной
 * учётки — установить факт` in `.github/workflows/claude-review.yml`, taken OUT OF THE
 * YAML and run, not restated here.
 *
 * WHY IT IS EXTRACTED AND NOT COPIED: a test that restates the workflow's own literal
 * pins its copy and nothing else — the yml is then free to drift in silence. The program
 * asserted below is read from the file by a regex, so an edit to the step that this suite
 * does not agree with is a RED test and not a quiet divergence.
 *
 * THE DEFECT IT PINS, measured in the field on 2026-09-13 (thread 197) on three rounds in
 * a row — runs 34775379733, 34775456728, 34776552737: the round of #416 SUCCEEDED on the
 * primary account (`is_error: false`, `terminal_reason: completed`) and DELIVERED its
 * verdict, and its transcript still carried three `rate_limit_event` records — all with
 * `status: "allowed"` and a five-hour utilization of 0.14. The detector counted the
 * EXISTENCE of such a record, so it declared a migration on a perfectly live account: the
 * fallback step ran for nothing, failed, and painted the whole round red. Guards 1 and 2
 * of `merge-gate` then refused a PR whose verdict was already in — measured on #416:
 * `STOP guard 1 … completed/failure`, `STOP guard 2 … review=FAILURE`.
 *
 * SO THE ASSERTION IS ABOUT THE `status` FIELD, in both directions: `allowed` is the
 * account WORKING and must not migrate; a refusal must, and it must name itself. The
 * other two signs of the step (`api_error_status: 429`, the limit text of the last
 * record) are asserted as the negative control — the repair touched neither.
 *
 * THE FIXTURES ARE THE MEASURED SHAPES, trimmed: the fields the program reads are the
 * fields the real transcripts carried (artifacts `reviewer-execution-416-34776552737`
 * and `reviewer-execution-410-34774024470`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The file that runs the round — the only place this program is written down. */
const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../../.github/workflows/claude-review.yml", import.meta.url),
);

/** The jq program of the step, lifted out of the `run:` block by its own assignment. */
const PROGRAM = ((): string => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  const match = workflow.match(/EVIDENCE=\$\(jq -r '([\s\S]*?)' "\$EXECUTION_FILE"/);
  if (match === null || match[1] === undefined) {
    throw new Error(
      "the limit detector of 'claude-review.yml' is no longer assigned as EVIDENCE=$(jq -r '…' \"$EXECUTION_FILE\") — this test reads the workflow, so the extraction is part of what it pins",
    );
  }
  return match[1];
})();

const workdir = mkdtempSync(join(tmpdir(), "reviewer-limit-"));

/** Runs the workflow's own program over a transcript, the way the step does. */
function evidenceOf(transcript: unknown, name: string): string {
  const file = join(workdir, `${name}.json`);
  writeFileSync(file, JSON.stringify(transcript), "utf8");
  const out = execFileSync("jq", ["-r", PROGRAM, file], { encoding: "utf8" }).trim();
  return out === "null" ? "" : out;
}

/** A routine record of a LIVE account — the shape that produced the field defect. */
const allowedRecord = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    rateLimitType: "five_hour",
    unifiedWindows: { five_hour: { utilization: 0.14 } },
  },
};

/** The same record when the account actually said no (measured on the round of #410). */
const rejectedRecord = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "rejected",
    rateLimitType: "five_hour",
    unifiedWindows: { five_hour: { utilization: 1 } },
  },
};

const successResult = {
  type: "result",
  subtype: "success",
  is_error: false,
  terminal_reason: "completed",
  result: "verdict written",
};

describe("the limit detector of the review round", () => {
  it("says NOTHING about a successful round whose transcript carries allowed rate-limit records", () => {
    // The round of #416: the primary answered, the verdict was delivered, and three of
    // these rode along. Declaring a migration here burns the second account and reddens
    // a round that has its verdict.
    const evidence = evidenceOf(
      [allowedRecord, { type: "assistant" }, allowedRecord, allowedRecord, successResult],
      "allowed-and-green",
    );

    expect(evidence).toBe("");
  });

  it("names the refusal, with its status, when the account really said no", () => {
    const evidence = evidenceOf(
      [
        rejectedRecord,
        { type: "assistant", error: "rate_limit" },
        { type: "result", subtype: "success", is_error: true, terminal_reason: "api_error" },
      ],
      "rejected",
    );

    expect(evidence).toBe("запись type=rate_limit_event со status=rejected");
  });

  it("treats a rate-limit record of an unknown shape as no refusal at all", () => {
    // A missing `status` is not a refusal: mistaking it for one is exactly the defect
    // above, and the cost of the other direction is a round that dies as it did before.
    const evidence = evidenceOf(
      [
        { type: "rate_limit_event" },
        { type: "rate_limit_event", rate_limit_info: {} },
        successResult,
      ],
      "unknown-shape",
    );

    expect(evidence).toBe("");
  });

  it("still reads a 429 on the last record — the branch the repair did not touch", () => {
    const evidence = evidenceOf(
      [{ type: "assistant" }, { type: "result", api_error_status: 429, is_error: true }],
      "api-429",
    );

    expect(evidence).toBe("api_error_status=429 последней записи");
  });

  it("still reads the limit text of the last record — the branch the repair did not touch", () => {
    const evidence = evidenceOf(
      [
        { type: "assistant" },
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "You've hit your session limit · resets 1:40pm (UTC)",
        },
      ],
      "limit-text",
    );

    expect(evidence).toBe("result последней записи несёт текст лимита");
  });
});
