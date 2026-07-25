/**
 * MIGRATION 4 → 5: notification and announcement texts as data, and the transport as
 * a plugin (R4, thread `016-protocol-roadmap`).
 *
 * Version 5 adds two optional sections — `notifications` (a transport module with its
 * options, plus the templates of the three notification slots) and `announcements`
 * (the templates of the texts the package writes into a thread). Like 2 → 3 and
 * 3 → 4, it MOVES NO DATA: a version-4 config is already a valid version-5 one, not
 * one message, thread or journal line is touched, and the step carries the number
 * alone.
 *
 * WHY IT IS STILL A VERSION. The schemas are strict on purpose, so a build of the
 * package that predates these sections REFUSES a config that carries them. Without
 * the number that refusal reads "unrecognized key: notifications" and blames the
 * config; with it, it reads "the repository declares 5, the package supports 4 —
 * update the package", which names the repair. The same argument as the two steps
 * before it, and worth restating rather than assumed: it is the only thing standing
 * between an additive-looking change and a circuit that halts with the wrong
 * diagnosis.
 *
 * WHAT IS NOT VERSIONED, AND DELIBERATELY: the secrets FILE the machine config now
 * points at (`secrets.envFile`). `protocolVersion` covers data that TRAVELS; that
 * file travels nowhere — one box, one writer, a human, outside git — and the same
 * carve-out was written down for the machine config itself in 3 → 4.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const NOTIFICATIONS_STEP: MigrationStep = {
  from: 4,
  summary:
    "notification/announcement templates and the transport plugin (notifications, announcements) — the schema widens, no data changes; the number moves alone",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "the texts themselves are OPTIONAL — a repository that says nothing keeps the package's English defaults; a project with its own language adds 'notifications.templates' and 'announcements'",
    ],
  }),
};
