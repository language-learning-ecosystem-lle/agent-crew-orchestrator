/**
 * THE FOREIGN-NAME WATCHER IS RUN BY THE SUITE, not by whoever remembers to run it —
 * `.github/scripts/foreign-name-watch.test.sh` drives the rule on fixtures, and this file
 * is what makes CI drive that script.
 *
 * WHY IT IS SPAWNED RATHER THAN REWRITTEN IN TYPESCRIPT. The rule decides inside a
 * workflow step, so it is bash — and a second implementation in TS would be a claim about
 * the rule, not the rule. The seam this test covers is therefore literal: the file that
 * ships is the file that is judged. Same reasoning as `notifier-mute.process.test.ts`.
 *
 * WHY NOT LEFT MANUAL, THE WAY `comms-push.test.sh` DELIBERATELY IS. This watcher's whole
 * output is silence-or-a-letter, and a silently broken measurement is indistinguishable
 * from a clean tree: "the class is not there" and "I did not look" render identically to
 * the reader. Thread 064 paid for that confusion three times in one day (2026-09-05) —
 * once with a wrong pattern, once with a wrong scope, once with a zero produced by a
 * measurement that never ran. The unit script exists to keep those two apart; leaving its
 * execution to memory would reproduce exactly the failure it guards.
 *
 * It costs no workflow step: `pnpm test` already runs this suite, and the script needs
 * nothing but bash, coreutils and a temporary directory.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RULE_TEST = fileURLToPath(
  new URL("../../../../.github/scripts/foreign-name-watch.test.sh", import.meta.url),
);

describe("foreign-name-watch.sh", () => {
  it("holds its own fixtures — own address subtracted, foreign name found, refusal audible", () => {
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
      "смотритель имени соседнего дома: все проверки прошли",
    );
    expect(failed).toBeUndefined();
  });
});
