/**
 * MIGRATION 8 → 9: the launch directive in the feed (R21, thread `016-protocol-roadmap`).
 *
 * Version 9 widens TWO shapes and moves no data:
 *  - the message header gains an optional `launch: model=…, effort=…` — an authorized
 *    role saying with what the runs of THIS thread are raised from here on;
 *  - the role config gains the permission `launch-params`, which is what makes such a
 *    directive effective (from anyone else it is ignored out loud).
 *
 * NOTHING IS REWRITTEN. Not one message in the mail carries the field yet, and none
 * has to: its absence means exactly what it meant before R21 existed — the run is
 * raised on the role's standing calibration. The journal is untouched too: the
 * directive is a fact about the FEED, and where it was applied is printed on the
 * launch line beside the other resolved sources (R12/R15), not stored as an event.
 *
 * WHY IT IS STILL A VERSION, for the seventh time: both schemas are strict, so a build
 * of the package that predates the permission REFUSES a config carrying it, and a build
 * that predates the header field refuses the whole THREAD carrying one message with it.
 * The number is what turns those refusals from "your data is broken" into "run the
 * migration / update the package".
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const LAUNCH_DIRECTIVE_STEP: MigrationStep = {
  from: 8,
  summary:
    "the launch directive in the feed: the message header field 'launch' and the role permission 'launch-params' — both schemas widen, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'launch-params' is a PERMISSION — grant it in the config to whoever may direct the runs of a thread (here: curator, john); a directive from a role without it is ignored out loud at the moment a candidate is chosen",
      "the mail is NOT rewritten: no message carries the field yet, and its absence keeps meaning 'raise the role on its standing calibration'",
    ],
  }),
};
