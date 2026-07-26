/**
 * MIGRATION 9 → 10: the priority of a thread in the feed (R5, thread `016-protocol-roadmap`).
 *
 * Version 10 widens TWO shapes and moves no data:
 *  - the message header gains an optional `priority: high | normal | low` — an
 *    authorized role saying which of the waiting threads is raised first from here on;
 *  - the role config gains the permission `thread-priority`, which is what makes such
 *    a statement effective (from anyone else it is ignored out loud when the queue is
 *    built).
 *
 * NOTHING IS REWRITTEN. No message in the mail carries the field, and none has to: its
 * absence means the thread sits at the default (`normal`), which is exactly what every
 * thread had before the tiers existed. The journal is untouched — the order is a fact
 * about the FEED, recomputed every tick and printed on the daemon's stream, not stored
 * as an event.
 *
 * WHY IT IS STILL A VERSION, for the eighth time: both schemas are strict, so a build
 * of the package that predates the permission REFUSES a config carrying it, and a build
 * that predates the header field refuses the whole THREAD carrying one message with it.
 * The number turns those refusals from "your data is broken" into "run the migration /
 * update the package".
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const THREAD_PRIORITY_STEP: MigrationStep = {
  from: 9,
  summary:
    "the priority of a thread in the feed: the message header field 'priority' and the role permission 'thread-priority' — both schemas widen, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'thread-priority' is a PERMISSION — grant it in the config to whoever may say which thread is raised first (here: curator, john); a priority from a role without it is ignored out loud when the queue is built",
      "the mail is NOT rewritten: no message carries the field yet, and its absence means the thread sits at the default priority 'normal'",
    ],
  }),
};
