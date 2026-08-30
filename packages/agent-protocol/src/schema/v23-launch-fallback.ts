/**
 * MIGRATION 22 → 23: the fall-back chain of a role (thread `036-account-failover`, step 2).
 *
 * Version 15 gave a role an account, 16 gave an instance one. Version 23 gives a role the
 * ORDERED list of accounts its next session is raised on when its own window is closed:
 * `roles[].launch.fallback`. One optional key, no data moved, and nothing at all changes
 * for a project that never writes it — an absent chain and `[]` are the same answer, and
 * that answer is the behaviour of every run before this field existed (`chooseAccount`
 * returns `stay` before it looks at a chain that is not there).
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15 and v16 verbatim: the
 * config schema is strict, so a build older than the field answers `Unrecognized key:
 * fallback`, which is invalid, true and useless. The number is the one thing that turns
 * that into "the config is newer than this build, restart what runs on it". This
 * repository runs the daemon it ships, so that sentence is not hypothetical here: a live
 * daemon died of exactly this on 2026-07-31.
 *
 * WHY NO ROLE IS GIVEN A CHAIN BY THE MIGRATION, and why that is the point rather than an
 * omission (john, 2026-08-29, `delivers`): the two claude accounts of this box —
 * `lle-main` and `lle-second` — are ONE subscription behind two directories, so a chain
 * between them would be a failover in appearance and a second look at the same closed
 * window in fact. The only true spare on this box is of another kind (`codex-main`), and
 * a fall-back of another kind is refused by name — a different TOOL is not a spare key.
 * So the mechanism lands with every chain EMPTY, ready to be turned on by one line of
 * config the day a real spare exists, and until then the whole of its effect is that a
 * standstill on quota is said out loud instead of being silence.
 *
 * WHAT THIS VERSION DOES NOT PROMISE. It does not make an id valid: the other half of the
 * join lives on each machine (`accounts.<id>.configDir`, `accounts.<id>.kind` of the
 * machine config) and is NOT part of the migration. A chain naming an account this box has
 * not declared is refused BY NAME at the door that reads it (`config check`, `doctor`) —
 * at the moment it is written, which is the only moment it is cheap to repair, rather than
 * at the moment quota runs out, which is the worst one.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const LAUNCH_FALLBACK_STEP: MigrationStep = {
  from: 22,
  summary:
    "the fall-back chain of a role: the optional ordered 'roles[].launch.fallback' list of account ids — the accounts a role's next session is raised on when its own quota window is closed; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'roles[].launch.fallback' is OPTIONAL and no role is given one by the migration: an absent chain and '[]' are identical, and both mean the behaviour of every run before this field — the role stands down until its own window reopens",
      "the order is the role's preference, read left to right: the first link that is neither shelved nor refused is the account the next session is raised on",
      "a link is judged where it is DECLARED ('config check', 'doctor'): the role's own account, an id this machine does not declare, an account of another kind, or the same id twice is refused BY NAME — a chain that only breaks the day quota runs out is a chain nobody can repair in time",
      "the other half of the join lives on each machine ('accounts.<id>.configDir' and 'accounts.<id>.kind' of the machine config) and is NOT part of this migration",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
