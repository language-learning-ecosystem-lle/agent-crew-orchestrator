/**
 * MIGRATION 24 → 25: HOW THE MAIL IS INVOKED IS DECLARED BY THE PROJECT — the optional
 * top-level `mailCommand`, thread `038-pilot-codex-live-run` (john, 2026-08-30, «ДАВАЙ
 * ОБЕ»; the norm «ПРОМПТ ПОДЪЁМА НЕ ПРИДУМЫВАЕТ ФАКТОВ О РОЛИ» in `PROTOCOL.md`).
 *
 * WHAT WIDENED. One optional key and nothing under it: the prefix a raised session types
 * before `thread show` and `new-message`. The subcommands stay the package's own words;
 * what carries them is a property of one deployment. Until this version the launch prompt
 * wrote the literal `cli` — a name from no config, true in no live deployment of this box
 * — and the sessions that believed it got `exit 127`: four raises of `pilot-codex` out of
 * five, two of them without the thread ever reaching the session.
 *
 * NOTHING IS WRITTEN BY THE STEP, and it declares the value for nobody — the reason of v18
 * verbatim. The invocation is a fact about one box's deployment, and a migration that
 * filled it in would compile one project's shell line into a package built to travel. A
 * project WITH such a line writes it by hand; a project without the key keeps today's
 * behaviour minus the invention: the prompt names the subcommands and says the form is not
 * declared, instead of naming a command nobody promised exists.
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15 through v18 verbatim:
 * the config schema is strict, so a build older than the field answers `Unrecognized key:
 * mailCommand`, which is invalid, true and useless. The number is the one thing that turns
 * that into "the config is newer than this build, restart what is running on it". The
 * VALUE half of the guard does not move: the field is a free string, it pins nothing.
 *
 * THE OTHER HALF OF THE SAME NORM CARRIES NO NUMBER, deliberately. A role that cannot write
 * into the mail must be told so instead of being told to send a letter — and that property
 * is ALREADY declared, by `roles[].launch.agent.toolsHeldBy: "sandbox-read-only"` (v20,
 * thread `026`), the one field of a card that becomes confinement on the vendor's command
 * line. Deriving it from what the config already says costs no key, no migration and no
 * edit to a document of power; inventing a second field beside it would have been a second
 * way to say one thing, and the first one to drift would be the one nothing enforces.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const MAIL_COMMAND_STEP: MigrationStep = {
  from: 24,
  summary:
    "how the mail is invoked as a declaration: the optional top-level 'mailCommand' — the prefix a raised session types before 'thread show' and 'new-message' moves out of a literal compiled into the launch prompt and into the served project's config; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'mailCommand' is OPTIONAL and the step declares it for nobody: how a box invokes this package is a fact about one deployment, and a migration that filled it in would compile one project's shell line into a package built to travel",
      "a project WITH a form writes it itself (the prefix only — the subcommands 'thread show' and 'new-message' are this package's own words and stay in the prompt)",
      "a project WITHOUT the key does not get a guessed one: the launch prompt names the subcommands and says the form is not declared here, so a session repairs it by reading its role card",
      "the second half of the same norm — telling a role that cannot write into the mail how its turn really ends — needs no key: it is read from 'roles[].launch.agent.toolsHeldBy' (v20), which is already declared and already confines the run",
    ],
  }),
};
