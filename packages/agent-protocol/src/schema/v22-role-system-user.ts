/**
 * MIGRATION 21 → 22: a role may name the SYSTEM USER its session runs as — thread
 * `047-devops-role`, john's decision of 2026-08-29 (delivered through curator in the
 * simplified frame: one daemon, narrowly entitled to raise a session as ONE named user, no
 * root and no wrapper scripts).
 *
 * WHAT WIDENED — one optional key, `roles[].systemUser`. Before it, which system identity a
 * session runs as was not a declaration at all: `spawn` does not switch uid/gid
 * (`cli.ts`, the supervisor) and the unit is a user one on purpose (`orchestrator/systemd.ts`),
 * so a role's privileges on the box were whatever the daemon's user happened to hold. For a
 * role that administers a server that is the "privilege by presence" john's frame rules out:
 * the identity has to be a thing a PR changes, on a document of power, and the operating
 * system — not the protocol — has to be what actually holds the door.
 *
 * WHY IT IS A VERSION. The same class the guard was written for: a build from before this one
 * meets `systemUser` as `Unrecognized key` — accurate, true and useless — instead of "the
 * config is newer than this build, restart what runs on it" (2026-07-31, a live daemon died of
 * exactly that). The path half of the guard sees it (`CONFIG_SHAPES[22]`); the value half sees
 * nothing, because a unix user name is free-form and pins no vocabulary.
 *
 * NOTHING IS WRITTEN BY THE STEP. Every config valid at 21 is valid at 22: the field is
 * optional and has NO DEFAULT, and its absence is the behaviour of every role that runs today.
 * A step that wrote a user into a card would be handing out a system identity on somebody
 * else's box — which is the one decision this field exists to keep in a PR.
 *
 * AND THE STEP GRANTS NOTHING. The user, its groups and what it owns are made by hand on the
 * box, once (`docs/box-setup.md` §0); the config only says which identity a role is entitled
 * to. A role naming a user the daemon cannot become is refused BY NAME at the launch door and
 * is never quietly raised as the daemon instead.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const ROLE_SYSTEM_USER_STEP: MigrationStep = {
  from: 21,
  summary:
    "a role may name the system user its session runs as: 'roles[].systemUser' (optional, no default); no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "no role gains a system user by this step: the field is optional, has no default, and handing out a system identity is a decision that belongs in a PR to the config",
      "the number exists for the OLDER build: it meets 'systemUser' as an unrecognized key instead of 'restart required'",
      "absence keeps today's behaviour verbatim — the session runs as the daemon's own user",
      "declaring the field does not create the user: the account, its groups and what it owns are made by hand on the box (docs/box-setup.md §0), and a user the daemon cannot become is refused by name at the launch door",
    ],
  }),
};
