/**
 * THE HEALER'S HALF OF THE CONFIG — the two paths a restart needs to put this box's
 * code back on the canon (thread `055-multi-instance-multi-account`, task 055.3).
 *
 * WHY A THIRD SHAPE AFTER "there is no third value on purpose". The split of the gate
 * is by the QUESTION, not by the command (thread 037), and this is a third question,
 * not a third command: `data` is "read or write the protocol's data", `policy` is "ask
 * somebody else's ref about zones and role ids", and this one is "where does the state
 * of THIS box live, so that the code reading it can be replaced". The answer cannot be
 * made wrong by a version — the version is precisely what is being repaired.
 *
 * THE DEFECT IT CLOSES, verbatim (john, 2026-08-05, live): with `protocolVersion 15` on
 * `origin/main` and a package that knows 14, `orchestrator restart --pull` died with
 * `restart required: … this build is behind the data (pull and restart what is running
 * on it)` — exit 2, nothing restarted. The message names the repair and kills the one
 * command that performs it: the gate stands before the dispatch and cannot tell a
 * reader of the canon from its healer.
 *
 * AND THE NUMBER ALONE IS NOT ENOUGH — the lesson `tolerateOlder` was deleted over
 * (`config/policy.ts`): a config written by a newer package carries fields this build
 * has never heard of, so a strict parse fails on `Unrecognized key` BEFORE any number
 * is compared. The repro of 05.08 happened to be a version bump with no new field
 * (`Д-4`, one line), and skipping the gate alone would have been enough for that one
 * case and for no other. Hence the same medicine policy takes: parse only the fields
 * the caller came for, loosely.
 *
 * WHAT THIS SHAPE PROMISES. `orchestrator.state` and `mail.dir` — everything
 * `orchestratorPaths` builds the pid file, the flags, the journal and the mail root
 * from. Both come from the SAME field schemas as the full config, loosened: a
 * hand-written copy would drift, and the drift would be invisible until a restart
 * wrote a flag into a directory nobody watches. If a future version MOVES those
 * fields, this shape will not find them and the restart refuses — by the data, not by
 * the number, and that is a manual event by design.
 *
 * WHAT IT DOES NOT COVER — `restart --mode force`. That one writes a message into the
 * mail before it kills anything (the trace of 023), and a message is protocol data:
 * the gate protects exactly that. A force stop on a build behind the canon is the
 * operator's own two commands, as it was.
 */
import { z } from "zod";

import type { VersionVerdict } from "../schema/version.js";
import { mailSchema, orchestratorSchema } from "./config.js";

/** Where the mail lies, loose: only `dir` is joined into a path here. */
const repairMailSchema = mailSchema.loose();

/** Where the state lies, loose: `state` and `mailCheckout` are the whole question. */
const repairOrchestratorSchema = orchestratorSchema
  .pick({ state: true, mailCheckout: true })
  .loose();

/**
 * The config as the healer sees it. `protocolVersion` is required and is NOT read for
 * a verdict — it is read to be said out loud: a restart that quietly worked around a
 * shape it does not understand would be the silence this package exists against.
 */
export const repairConfigSchema = z.looseObject({
  protocolVersion: z.number().int().min(1),
  mail: repairMailSchema,
  orchestrator: repairOrchestratorSchema.optional(),
});

export type RepairConfig = z.infer<typeof repairConfigSchema>;

/**
 * The sentence a healer prints when the shapes differ. It names the two fields it
 * read, because that is the whole claim being made: nothing else of this config was
 * understood, and nothing else was needed.
 */
export const describeRepairSkew = (input: {
  readonly ref: string;
  readonly version: VersionVerdict;
}): string | undefined => {
  if (input.version.state === "current") return undefined;
  return `'${input.ref}' declares protocol version ${input.version.declared}, this package writes ${input.version.supported} — restart reads only where the state of this box lies (orchestrator.state, mail.dir) and is what brings the code to that version`;
};

/**
 * THE SKEW IS A STATEMENT, NOT AN EVENT — said once per process, not once per read
 * (the reviewer's finding on PR #202, measured: three identical lines on one `restart
 * --pull`, because `restart` resolves the paths three times — before phase 1, inside
 * `down` and inside `up`).
 *
 * WHY REPETITION IS NOT HARMLESS HERE. This line is the one thing the operator is
 * meant to read on a healing restart; printed three times among the phases it reads
 * as three separate discoveries, and the next person's first question is which of the
 * three was the real one. The rule is the statement's own: the SAME sentence about the
 * same read is said once, and a sentence that CHANGES is said again — after the pull
 * of phase 3 the repository can be at another version than it was in phase 1, and that
 * is news rather than an echo.
 */
export const createSkewVoice = (): {
  readonly announce: (key: string, skew: string) => boolean;
} => {
  const said = new Set<string>();
  return {
    announce: (key, skew) => {
      const what = `${key}\0${skew}`;
      if (said.has(what)) return false;
      said.add(what);
      return true;
    },
  };
};
