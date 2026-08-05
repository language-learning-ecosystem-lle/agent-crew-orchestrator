/**
 * MIGRATION 14 → 15: the account of a role (thread `055-multi-instance-multi-account`, B.2).
 *
 * Version 15 widens ONE shape and moves no data: the role's launch profile gains an
 * optional `account: <id>` — WHICH account of the tool that role's runs spend. Nothing
 * else changes, and nothing at all changes for a project that never writes the field:
 * every role without it is raised exactly as before, on the account of the box.
 *
 * WHY IT IS A VERSION AT ALL, the field being optional: the config schema is strict, so
 * a build of the package older than the field REFUSES a config that carries one —
 * "Unrecognized key: account", which is invalid, true and useless. The number is the
 * one thing that turns that into "the config is newer than this build", and the whole
 * reason the shape guard exists is that this was learned from a daemon that died of it.
 *
 * WHY THE ID IS IN THE REPOSITORY AT ALL and not on the machine beside the binary — the
 * question R14 is usually the answer to. Because the two halves answer different
 * questions: "role X works on subscription A" decides whose quota that role burns, and
 * that is a statement about the PROJECT, which a reviewer has to see in a diff. Where
 * that account's directory happens to sit is a statement about ONE BOX, and it stays
 * there (`accounts.<id>.configDir` of the machine config). Which subscription stands
 * behind the id is in neither file: the id is a label, and only whoever logged in knows.
 *
 * A CONSEQUENCE FOR R18 WORTH KNOWING BEFORE IT SURPRISES SOMEBODY: the tool keeps the
 * session store under the same directory as the credentials, so a role whose account is
 * changed does not corrupt its resumable sessions — it stops seeing them. The first run
 * after such a change is `--fresh` in fact, whatever the continuation policy decides.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const LAUNCH_ACCOUNT_STEP: MigrationStep = {
  from: 14,
  summary:
    "the account of a role: the optional 'launch.account' id of a role — the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'launch.account' is OPTIONAL and no role is given one by the migration: a role without it is raised on the box's own account, exactly as every run before this field",
      "the other half of the join lives on each machine ('accounts.<id>.configDir' of the machine config) and is NOT part of this migration — a box that has not declared the id REFUSES the launch by name rather than falling back",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
