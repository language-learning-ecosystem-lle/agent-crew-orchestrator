/**
 * MIGRATION 15 → 16: the account of an INSTANCE (thread `055-multi-instance-multi-account`, B.2).
 *
 * Version 15 gave a ROLE an account id. Version 16 gives the same id to an INSTANCE, as
 * the fall-back for every role of that instance which named none: `instances[].account`.
 * One optional key, no data moved, and nothing at all changes for a project that never
 * writes it — a role without an account and an instance without one is raised on the
 * account the box itself is logged into, exactly as before either field existed.
 *
 * WHY A DEFAULT IS WORTH A FIELD AT ALL rather than "write the id on every role": the
 * unit a subscription is actually bought for is the PROJECT. A box hosting two
 * instances is the case this whole thread exists for, and there the true sentence is
 * "the crew instance runs on the second subscription" — said once. Written per role it
 * is the same sentence N times, and the failure mode of a sentence repeated N times is
 * that the N+1st role is added without it and quietly spends the other subscription.
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15 verbatim: the config
 * schema is strict, so a build older than the field answers `Unrecognized key: account`,
 * which is invalid, true and useless. The number is the one thing that turns that into
 * "the config is newer than this build".
 *
 * THE LAYER ORDER IT CREATES, and it is the R21 order applied to one more parameter: the
 * role's own `launch.account` wins, the instance's is the fall-back, and silence means the
 * box's own account. Which layer answered is PRINTED on the launch line beside the model
 * and the effort — a default nobody can see is a default nobody can audit, and this one
 * decides whose money a run spends.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const INSTANCE_ACCOUNT_STEP: MigrationStep = {
  from: 15,
  summary:
    "the account of an instance: the optional 'instances[].account' id — the fall-back for roles that name none; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'instances[].account' is OPTIONAL and no instance is given one by the migration: an instance without it raises its roles on the box's own account, exactly as before this field",
      "it is a FALL-BACK and never an override: a role that names 'launch.account' keeps spending that one, and the launch line says which layer answered",
      "the other half of the join lives on each machine ('accounts.<id>.configDir' of the machine config) and is NOT part of this migration — a box that has not declared the id REFUSES the launch by name rather than falling back",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
