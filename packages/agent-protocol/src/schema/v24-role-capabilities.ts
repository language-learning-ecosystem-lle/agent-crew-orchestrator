/**
 * MIGRATION 23 → 24: a role may declare WHAT IT MAY DO TO THE BOX — `roles[].capabilities`,
 * thread `047-devops-role` (john, 2026-08-30: «#115 нажал, capabilities твои»; the set composed
 * by curator under that delegation the same day).
 *
 * WHAT WIDENED. One optional key on a role and the grammar under it: three named verbs
 * (`log-tail`, `repo-refresh`, `disk-free`), each carrying the CLOSED LIST of values its one
 * parameter accepts. Version 22 gave a role a system identity on the box; it said nothing about
 * what that identity is entitled to DO, and the answer was whatever the operating system happened
 * to allow the user. This version makes the verb a declaration too — the same move, one level up:
 * the identity is in a PR since 22, and now the action is.
 *
 * WHY THREE AND NOT FIVE. The set composed under the delegation carried `service-restart` and
 * `service-status` as well; both were struck on 2026-08-30 (john, «(A) сейчас, (B) — если
 * окажется, что рестарт нужен часто») because the daemons of both circuits are USER units of the
 * user `lle`, and a separate identity cannot restart or query another user's units without root,
 * polkit, or a move to the system level. A verb the operating system refuses by construction is
 * not a narrower right, it is a declaration that lies — so the two wait for decision (B) and
 * arrive at their own number, visible in a diff.
 *
 * WHY 24 AND NOT 23. This step was written as 22 → 23 and renumbered before merge: 23 went to
 * `roles[].launch.fallback` (thread `036-account-failover`, #109), which landed first. Two steps
 * declaring `from: 22` is not a race to be won by pushing sooner, it is a broken chain — the
 * assembler looks a step up by `from`, so the second one is unreachable. Which of two open
 * branches merges first is not something either of them gets to assume, and renumbering is the
 * cheap half of that: the tables are append-only, so the fix is a number, not a rewrite.
 *
 * WHY IT IS A VERSION, and both halves of the guard see it this time. The key half sees five new
 * paths (`roles[].capabilities` and the fields of its members); the VALUE half sees three, one per
 * verb, because the discriminator of the union is a pinned literal. An older build meets a config
 * carrying either as `Unrecognized key` / an invalid discriminator — the exact class of the
 * daemon that died on 2026-07-31 — instead of "the config is newer than this build, restart what
 * runs on it".
 *
 * NOTHING IS WRITTEN BY THE STEP, and here that is a stronger claim than at 22. Every config
 * valid at 23 is valid at 24: the field is optional and has no default. A step that wrote a
 * capability into a role would be handing out a verb on somebody else's machine — and the whole
 * point of the field is that the verb is granted in a PR to a document of power, by john's
 * button, one named list at a time.
 *
 * AND THE STEP GRANTS NOTHING, TWICE OVER. It does not create the system user the verbs would run
 * as (`docs/box-setup.md` §0.1, john's hand, once), and there is no executor: the role that
 * carries the first set of capabilities is `planned`, so what this version adds is a declaration
 * that can be reviewed before anything can act on it. That order is deliberate — the alternative
 * is a door written against rights nobody has yet agreed to.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const ROLE_CAPABILITIES_STEP: MigrationStep = {
  from: 23,
  summary:
    "a role may declare what it may do to the box: 'roles[].capabilities' — three named verbs, each with the closed list its parameter accepts (optional, no default); no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "no role gains a capability by this step: the field is optional, has no default, and granting a verb on the box is a decision that belongs in a PR to the config",
      "the number exists for the OLDER build: it meets 'capabilities' as an unrecognized key — and its 'name' as an invalid discriminator — instead of 'restart required'",
      "absence keeps today's behaviour verbatim — a role that does nothing to the box, which is every role that runs today",
      "declaring a capability does not execute one: the executor arrives with the system user it would run as, and until then the declaration is a thing to review, not a right in use",
    ],
  }),
};
