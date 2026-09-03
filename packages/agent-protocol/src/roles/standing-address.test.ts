/**
 * THE WORKFLOWS OF THE MAIL ADDRESS A STANDING ADDRESS, NOT A THREAD — the seam, not the
 * mapping. A claim about this repository's own `.github/workflows`, in the generic package,
 * for the reason `workflow-signatures.test.ts` holds its own: the repository serves itself,
 * and the door that judges an address is this package.
 *
 * WHAT IS BEING PINNED (thread 080, decision of john 2026-09-03). Both writers of a standing
 * address used to carry a thread id as a LITERAL — `MAIN_RED_THREAD: 076-main-red-alarm`,
 * `THREAD: 077-notifier-down` — i.e. an address with no end. The measurement behind the
 * decision is in `thread/receiver.ts`: a letter into a closed or parked thread is NOT refused
 * and NOT lost, it is accepted (a machine writer is never asked about a park, and closure is
 * not checked on the way in), and then `waitingOnOf` answers `undefined` before it reads a
 * single declaration. The alarm lands, the run is green, and nobody is raised.
 *
 * WHY A TEST AND NOT A READING OF THE YAML BY EYE. The two halves of this seam are in files
 * nobody reads together: a shell line inside a workflow and a door inside `cli.ts`. Each half
 * looks correct alone, and the price of them disagreeing is paid ONLY during an incident —
 * `--ensure-thread` without `--title` is a refusal inside the very command whose job is to
 * report that something is already broken, and a slug that carries a number
 * (`--ensure-thread 076-main-red-alarm`, the typo the previous literals invite) is refused the
 * same way. Nothing here is a fact of the run: every flag judged below is a LITERAL or an env
 * value of the same file, which is exactly the half a test can hold.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { unreadableReceiverSlug } from "../thread/receiver.js";
import { createRoleRegistry } from "./registry.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL("agent-protocol.json", REPO_ROOT));

/** The workflows that write into a standing address, and the address each one carries. */
const WRITERS = [
  { file: ".github/workflows/ci-outcome.yml", slug: "main-red-alarm" },
  { file: ".github/workflows/notifier-watch.yml", slug: "notifier-down" },
] as const;

/**
 * THE FILE WITHOUT ITS COMMENTS, and that is not a convenience: these workflows explain
 * themselves at length, and a claim counted over the prose would be a claim about how the
 * seam is DESCRIBED. What runs is what is judged — the same rule that made
 * `notifier-mute.process.test.ts` spawn the shipped script rather than restate it.
 */
const readWorkflow = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, REPO_ROOT)), "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/**
 * The value of an `env:` entry of the workflow — `NAME: value` or `NAME: "value"`. The
 * workflows hand these to the flags through the shell, so what the door will see is what
 * stands here and nothing else.
 */
const envValue = (text: string, name: string): string | undefined => {
  const match = new RegExp(`^\\s*${name}:\\s*(?:"([^"]*)"|([^\\s#][^#\\n]*?))\\s*$`, "m").exec(
    text,
  );
  return match?.[1] ?? match?.[2];
};

/**
 * What the door will actually see, following the ONE hop the shell is allowed to make:
 * `ci-outcome.yml` decides between two addresses (`ENSURE_SLUG="$MAIN_RED_SLUG"`), so the
 * flag is given a shell variable and the value is an `env:` entry behind it. Deeper than
 * that is not resolved on purpose — a value assembled at runtime is a fact of the run, and
 * pretending to judge it here would make this test quietly incomplete.
 */
const addressValue = (text: string, name: string): string | undefined => {
  const direct = envValue(text, name);
  if (direct !== undefined) return direct;
  const hop = new RegExp(`^\\s*${name}="\\$\\{?([A-Z_][A-Z0-9_]*)\\}?"\\s*$`, "m").exec(text)?.[1];
  return hop === undefined ? undefined : envValue(text, hop);
};

/** The env name a flag is given: `--ensure-thread "$THREAD_SLUG"` → `THREAD_SLUG`. */
const flagVariable = (text: string, flag: string): string | undefined =>
  new RegExp(`${flag}\\s+"\\$\\{?([A-Z_][A-Z0-9_]*)\\}?"`).exec(text)?.[1];

describe("the standing addresses this repository's workflows write into", () => {
  const registry = createRoleRegistry(
    parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8"))),
  );

  for (const writer of WRITERS) {
    describe(writer.file, () => {
      const text = readWorkflow(writer.file);

      it("addresses the standing address by slug, exactly once", () => {
        // Twice would mean two deliveries of one event, i.e. the race the flag was chosen to
        // close (form (ii), `msg-004`) reopened inside the caller.
        expect(text.match(/--ensure-thread/g) ?? []).toHaveLength(1);
      });

      it("hands the door a slug it accepts — no number of its own, no separator", () => {
        const variable = flagVariable(text, "--ensure-thread");
        expect(variable).toBeDefined();
        const slug = addressValue(text, variable as string);
        expect(slug).toBe(writer.slug);
        // The door's own refusal, asked here where it costs a red run and not an incident.
        expect(unreadableReceiverSlug(slug as string)).toBeUndefined();
      });

      it("carries --title and --participants, without which the door refuses mid-incident", () => {
        // `--ensure-thread` may have to OPEN the receiver, and a thread is opened with its
        // title and its participants named. The refusal for a missing one fires on the day
        // the previous receiver closes — which may be weeks after this line was written.
        expect(flagVariable(text, "--title")).toBeDefined();
        expect(flagVariable(text, "--participants")).toBeDefined();
      });

      it("names participants the config knows, so the receiver can be opened at all", () => {
        const variable = flagVariable(text, "--participants") as string;
        const participants = (addressValue(text, variable) ?? "")
          .split(",")
          .map((one) => one.trim());
        expect(participants.length).toBeGreaterThanOrEqual(2);
        expect(participants.filter((one) => !registry.isKnown(one))).toEqual([]);
        // The writer signs `--from github`, and a thread is opened with its author among its
        // participants: a receiver the notifier cannot write into again is a dead address.
        expect(participants).toContain("github");
      });

      it("holds no thread id as a literal — that is the shape this replaced", () => {
        // An env entry whose whole value is `NNN-slug` is the old form coming back: it is how
        // both addresses were written before, and it is invisible until the day the receiver
        // is closed. `--thread` with a literal id is the same statement said in the shell.
        const literalEnv = text.match(/^\s*[A-Z_]+:\s*"?\d{3}-[a-z0-9-]+"?\s*$/gm) ?? [];
        expect(literalEnv).toEqual([]);
        expect(text.match(/--thread\s+"?\d{3}-[a-z0-9-]+/g) ?? []).toEqual([]);
      });
    });
  }

  it("are two, and they are the two the decision of thread 080 names", () => {
    // A sweep that found nothing would be a green test over a seam that had moved: the price
    // of that class is written in `workflow-signatures.test.ts`, which lost it the same way.
    const addressing = WRITERS.filter((writer) =>
      readWorkflow(writer.file).includes("--ensure-thread"),
    );
    expect(addressing).toHaveLength(2);
  });
});
