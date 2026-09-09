/**
 * MIGRATION 26 → 27: HOW MANY PAIRS «role × thread» RUN AT ONCE IS DECLARED BY THE PROJECT —
 * the optional top-level `parallelism: { pairsPerRole, pairsPerInstance }`, thread
 * `177-workspace-per-pair` (john, 2026-09-08: «ДВЕ пары на роль, плюс явный потолок на
 * инстанс»; the precedent for "a number that spends money is a document of power" is v16 and
 * v26 alike).
 *
 * WHAT WIDENED. One optional key and two integers under it. Both are required TOGETHER once
 * the key appears, and that is john's word rather than symmetry: a per-role ceiling raised
 * alone multiplies by however many roles a box raises — «две роли по две пары дают четыре
 * сессии на одно окно» — and the limiter measured in this thread is the ACCOUNT WINDOW, not
 * disk (11 MB and 1.5 s per worktree, thread `177` msg-002). A config naming one half names
 * the multiplication and not the bound.
 *
 * NOTHING IS WRITTEN BY THE STEP, and it declares the numbers for nobody — the reason of v18,
 * v25 and v26 verbatim, with one addition of this thread's own. How many sessions a project
 * may run at once is a statement about somebody's subscription, and this package travels; a
 * migration that filled in `2` would spend a stranger's window on our measurement. A project
 * WITHOUT the key keeps today's behaviour BIT FOR BIT: one pair per role (the planner's
 * `role-busy`) and no box ceiling beyond the global run budget that already cuts each tick.
 *
 * AND "BIT FOR BIT" IS WHY THE NUMBERS TRAVEL IN A SECOND PULL REQUEST. The code lands
 * changing nothing in the field; the numbers land when john writes them into
 * `agent-protocol.json`, which is a document of power and where the DECISION actually is
 * (statement of work, curator, thread `177`: «режь PR по этой границе»).
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15 through v26 verbatim: the
 * config schema is strict, so a build older than the field answers `Unrecognized key:
 * parallelism`, which is invalid, true and useless. The number is the one thing that turns
 * that into "the config is newer than this build, restart what is running on it" — and this
 * field is read by the DAEMON, the longest-lived process here, which is exactly the reader
 * that died of the other sentence on 2026-07-31.
 *
 * WHAT THIS VERSION DELIBERATELY DID NOT REACH, AND WHERE IT WAS REACHED. When this step was
 * written the planner still refused a second pair of a role by `role-busy` and still said
 * «one session per role (its workspace is one)». It counts to these ceilings since #355 and
 * names the number in its refusal; the operator's frame was taught the same in the pull
 * request of the queue row. Neither rides on this number: both ride on the key of the
 * workspace pair (#346), and this migration remains what it was — the announcement that makes
 * a config newer than the build readable to it.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const PAIR_CEILINGS_STEP: MigrationStep = {
  from: 26,
  summary:
    "how many pairs 'role × thread' run at once as a declaration: the optional top-level 'parallelism' — a ceiling per role and a ceiling per box — so parallelism inside a role is a number in the served project's config instead of a rule compiled into the planner; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'parallelism' is OPTIONAL and the step declares it for nobody: how many sessions may run at once is a statement about somebody's subscription window, and a migration that filled in a number would spend a stranger's account on our measurement",
      "a project WITH parallelism writes BOTH halves — 'parallelism.pairsPerRole' is how many pairs one role may run at once, 'parallelism.pairsPerInstance' how many one box may run summed across its roles; half a declaration is refused, because a per-role ceiling raised alone multiplies by the number of roles",
      "a project WITHOUT the key keeps today's behaviour bit for bit: one pair per role, and no box ceiling beyond the global run budget — the absence of the box half is NOT the number 1, which would stand down every second role and is what nothing does today",
      "the planner is not touched by this version: it still refuses a second pair with 'role-busy'; the ceilings are read by the pull request that follows this one",
    ],
  }),
};
