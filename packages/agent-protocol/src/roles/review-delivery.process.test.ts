/**
 * THE DELIVERY RULES OF THE REVIEWER'S VERDICT ARE RUN BY THE SUITE, not by whoever
 * remembers to run them — `.github/scripts/review-delivery.test.sh` drives them on
 * fixtures (the four park states, the three named deliveries, the addressee of the turn),
 * and this file is what makes CI drive that script.
 *
 * WHY IT IS SPAWNED RATHER THAN REWRITTEN IN TYPESCRIPT — the same reason as
 * `notifier-mute.process.test.ts`: the rules decide inside workflow steps, so they are
 * bash, and a second implementation in TS would be a claim about the rule rather than the
 * rule. The file that ships is the file that is judged.
 *
 * WHY NOT LEFT MANUAL, THE WAY `comms-push.test.sh` DELIBERATELY IS. These rules decide
 * whether the verdict of a round is delivered AT ALL, and a silently broken one is
 * indistinguishable from a healthy one until the next round — which costs ~$2.4 and is the
 * only place they run. Thread 088 exists because exactly that happened three times in one
 * hour: a verdict written and never read, a verdict delivered under the words "none of the
 * three deliveries worked", and a letter refused by the park door of a thread parked by the
 * book.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RULE_TEST = fileURLToPath(
  new URL("../../../../.github/scripts/review-delivery.test.sh", import.meta.url),
);

describe("review-delivery.sh", () => {
  it("holds its own fixtures — park flags, named deliveries, the addressee of the turn", () => {
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
      "доставка вердикта: все проверки прошли",
    );
    expect(failed).toBeUndefined();
  });
});
