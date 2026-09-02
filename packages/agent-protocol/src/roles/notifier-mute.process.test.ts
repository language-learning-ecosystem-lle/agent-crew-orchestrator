/**
 * THE MUTE RULE OF THE NOTIFIER WATCHER IS RUN BY THE SUITE, not by whoever remembers to
 * run it — `.github/scripts/notifier-mute.test.sh` drives the rule on a fixture of two
 * identical failures in a row, and this file is what makes CI drive that script.
 *
 * WHY IT IS SPAWNED RATHER THAN REWRITTEN IN TYPESCRIPT. The rule decides inside a
 * workflow step, so it is bash — and a second implementation in TS would be a claim about
 * the rule, not the rule. The seam this test covers is therefore literal: the file that
 * ships is the file that is judged.
 *
 * WHY NOT LEFT MANUAL, THE WAY `comms-push.test.sh` DELIBERATELY IS. That one classifies
 * a push failure that a human reads in a log the same minute; this one decides whether a
 * letter is written AT ALL. A silently broken mute rule is indistinguishable from a
 * healthy one — either it swallows every alarm (the silence thread 073 exists to remove)
 * or it swallows none (the amplifying loop that thread measured: nine letters in thirteen
 * minutes, `077-notifier-down` msg-002…msg-010, 2026-09-02). Neither shows up until the
 * next real outage, which is exactly too late.
 *
 * It costs no workflow step: `pnpm test` already runs this suite, and the script needs
 * nothing but bash, `date` and a temporary directory.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RULE_TEST = fileURLToPath(
  new URL("../../../../.github/scripts/notifier-mute.test.sh", import.meta.url),
);

describe("notifier-mute.sh", () => {
  it("holds its own fixture — two identical failures in a row give one letter", () => {
    let output: string;
    let failed: unknown;
    try {
      output = execFileSync("bash", [RULE_TEST], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      // The script's own report is the diagnosis — printing the exception alone would say
      // "exit code 1", i.e. the refusal you cannot act on.
      failed = error;
      output = String((error as { stdout?: string }).stdout ?? "");
    }
    expect(`${output}${failed === undefined ? "" : "\n(скрипт вернул ненулевой код)"}`).toContain(
      "правило глушения: все проверки прошли",
    );
    expect(failed).toBeUndefined();
  });
});
