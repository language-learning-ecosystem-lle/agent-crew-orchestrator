/**
 * THE FRAME FOR SCHEMA MIGRATIONS: from version to version, one step at a time,
 * a dry run by default (R2, curator's statement of work, thread `016-protocol-roadmap`).
 *
 * WHAT IT IS FOR. The protocol keeps its data as files in a live repository, and a
 * change of shape has to reach data somebody has already written. Until now the
 * only such move (a thread from `_thread.md` into `messages/`) was a bespoke
 * command with its own guard — which is fine once and unrepeatable twice: the next
 * breaking change (message metadata, R7) would have brought a second bespoke
 * command, and the question "which shape is this repository at" would still have
 * had no answer.
 *
 * DELIBERATELY A FRAME, NOT A LIBRARY. The registry held nothing until the change
 * that needed it arrived — a migration engine written ahead of its first migration
 * guesses at what migrations look like. The first real step is `v2-provenance.ts`
 * (R7), and it kept the frame honest rather than the other way round: it needed no
 * new capability, and the one thing it did need — a REFUSAL from inside a step,
 * aborting the whole chain — the frame already had.
 *
 * THE FOUR PROPERTIES THE FRAME ENFORCES:
 *
 * 1. **A step never bumps the version itself.** The runner writes
 *    `protocolVersion` after every step, so "the migration ran but the config still
 *    says the old number" is not a mistake anyone can make. Half-migrated data with
 *    a truthful version is recoverable; migrated data with a lying version is the
 *    state the whole package exists to prevent.
 * 2. **A chain is planned in full before anything is written.** A gap in the middle
 *    (no step registered for some version) is a refusal, not five applied steps and
 *    then a stop. Stopping halfway through leaves data at a version no build of the
 *    package supports.
 * 3. **A later step sees the earlier one's output** (`context.read` consults the
 *    pending writes first). Two steps touching one file are the case a frame is
 *    obliged to get right — a step reading stale bytes off disk would silently
 *    discard the previous one.
 * 4. **Nothing is written without `--write`.** The same rule as everywhere in this
 *    package, and here it carries the most: the dry run is the review of a change
 *    to files nobody can restore by hand.
 *
 * WHAT THE FRAME DOES NOT DO. It does not commit and it does not know about
 * branches. A protocol migration usually touches TWO trees — the config in `main`
 * (through a PR) and the mail in the mail branch (directly) — and which commit goes
 * where is a decision of the protocol, not of the runner. The plan prints the
 * absolute paths, so the split is visible; the ordering rule is in the README
 * ("Compatibility and breaking changes").
 */
import type { MigrationContext, MigrationFile, MigrationStep } from "./step.js";
import { MigrationRefusedError } from "./step.js";
import { MESSAGE_PROVENANCE_STEP } from "./v2-provenance.js";
import { LAUNCH_LIMITS_STEP } from "./v3-launch-limits.js";
import { AGENT_PARAMS_STEP } from "./v4-agent-params.js";
import { NOTIFICATIONS_STEP } from "./v5-notifications.js";
import { WORKSPACES_STEP } from "./v6-workspaces.js";
import { INTERACTIVE_TURN_STEP } from "./v7-interactive-turn.js";
import { GRACEFUL_DEADLINE_STEP } from "./v8-graceful-deadline.js";
import { LAUNCH_DIRECTIVE_STEP } from "./v9-launch-directive.js";
import { THREAD_PRIORITY_STEP } from "./v10-thread-priority.js";
import { INSTANCES_STEP } from "./v11-instances.js";
import { RESIDENT_WAKE_STEP } from "./v12-resident.js";
import { SCALAR_WAITING_ON_STEP } from "./v13-scalar-waiting-on.js";
import { NATIVE_TASKS_STEP } from "./v14-native-tasks.js";
import { LAUNCH_ACCOUNT_STEP } from "./v15-launch-account.js";
import { INSTANCE_ACCOUNT_STEP } from "./v16-instance-account.js";
import { IDENTITY_DICTIONARY_STEP } from "./v17-identity-dictionary.js";
import { POWER_DOCUMENTS_STEP } from "./v18-power-documents.js";
import { CODEX_KIND_STEP } from "./v19-codex-kind.js";
import { CODEX_LEVERS_STEP } from "./v20-codex-levers.js";
import { CODEX_EFFORT_VOCABULARY_STEP } from "./v21-codex-effort-vocabulary.js";

/**
 * THE REGISTRY — one entry per version step, and the order of the array does not
 * matter: the chain is assembled by looking up `from`, so a step cannot be applied
 * out of turn by being listed out of turn.
 */
export const MIGRATIONS: readonly MigrationStep[] = [
  MESSAGE_PROVENANCE_STEP,
  LAUNCH_LIMITS_STEP,
  AGENT_PARAMS_STEP,
  NOTIFICATIONS_STEP,
  WORKSPACES_STEP,
  INTERACTIVE_TURN_STEP,
  GRACEFUL_DEADLINE_STEP,
  LAUNCH_DIRECTIVE_STEP,
  THREAD_PRIORITY_STEP,
  INSTANCES_STEP,
  RESIDENT_WAKE_STEP,
  SCALAR_WAITING_ON_STEP,
  NATIVE_TASKS_STEP,
  LAUNCH_ACCOUNT_STEP,
  INSTANCE_ACCOUNT_STEP,
  IDENTITY_DICTIONARY_STEP,
  POWER_DOCUMENTS_STEP,
  CODEX_KIND_STEP,
  CODEX_LEVERS_STEP,
  CODEX_EFFORT_VOCABULARY_STEP,
];

export type {
  MigrationContext,
  MigrationEffect,
  MigrationFile,
  MigrationStep,
} from "./step.js";
export { MigrationRefusedError } from "./step.js";

export type PlannedStep = {
  readonly from: number;
  readonly to: number;
  readonly summary: string;
  readonly files: readonly MigrationFile[];
  readonly notes: readonly string[];
};

export type MigrationPlan = {
  readonly from: number;
  readonly to: number;
  readonly steps: readonly PlannedStep[];
  /** The config the plan was built against — the path `rendersConfig` looks for in `writes`. */
  readonly configPath: string;
  /**
   * The writes folded across the chain: one entry per path with the LAST content,
   * the config file last of all. This is what `--write` applies — applying the
   * steps' files one after another would write intermediate states of a file to
   * disk, which is exactly the half-migrated state property 2 forbids.
   */
  readonly writes: readonly MigrationFile[];
};

/** Two-space JSON with a trailing newline — the shape a config already has in the tree. */
export const renderConfig = (config: Record<string, unknown>): string =>
  `${JSON.stringify(config, null, 2)}\n`;

/**
 * WHAT THE WRITER OWES THE OPERATOR, AND WHY IT IS SAID BY THE WRITER RATHER THAN BY
 * A STEP. `renderConfig` re-renders the whole file from the parsed object, so the
 * result carries `JSON.stringify`'s shape and not the one the file had: short arrays
 * come back one element per line, hand-written compact objects come back expanded.
 * Every reader is indifferent to it; a repository that ENFORCES a format is not — on
 * this one the rendered config grew 179 lines → 212 and its own lint went red
 * (measured 2026-08-28, thread `026-codex-agent-kind`).
 *
 * The escape used until now — "edit `protocolVersion` by hand and throw the rendered
 * file away" — holds only while the step changes NOTHING BUT the number. The first
 * step that changes a VALUE (v21, the effort vocabulary) killed it: there the
 * rendered file is the only place the new value exists, so it has to be taken whole.
 *
 * SO THE NOTE BELONGS TO THE WRITER. Hanging it on the step that happened to need it
 * would make the next author of a step remember a property of a function they never
 * called. And it names the CLASS of the repair — "your project's formatter" — not a
 * tool: the package does not know what the consumer formats with and has no standing
 * to name one.
 */
export const CONFIG_REFLOW_NOTE =
  "the config was re-rendered from its parsed form, so its JSON shape is the renderer's and not the file's — run your project's formatter over it before committing (this package has no formatter of its own and cannot match your repository's rules)";

/**
 * Does this plan re-render the config file? Asked of the WRITES rather than of
 * `steps.length`, so the note follows the file that is actually produced instead of
 * a coincidence of the current chain.
 */
export const rendersConfig = (plan: MigrationPlan): boolean =>
  plan.writes.some((file) => file.path === plan.configPath);

export type PlanInput = {
  /** The version the repository declares now. */
  readonly declared: number;
  /** Where to stop. No default here — the caller says it out loud (the CLI uses the supported one). */
  readonly target: number;
  readonly context: MigrationContext;
  readonly steps?: readonly MigrationStep[];
};

/**
 * Assemble the whole chain `declared → target` and refuse loudly instead of doing
 * part of it. Two refusals, both about data that cannot be recovered afterwards: a
 * downgrade (the older shape cannot re-derive what the newer one wrote) and a gap
 * in the chain — which is also what answers a target above this build's knowledge,
 * because a version it has never heard of has no step registered for it.
 */
export const planMigration = (input: PlanInput): MigrationPlan => {
  const registry = input.steps ?? MIGRATIONS;
  const { declared, target } = input;

  if (target < declared) {
    throw new MigrationRefusedError(
      `a downgrade is not performed: the repository is at ${declared}, ${target} was requested — data written by the newer shape cannot be re-derived from the older one`,
    );
  }

  // THE CHAIN IS ASSEMBLED BEFORE A SINGLE STEP IS RUN. A gap found halfway would
  // still be a refusal (nothing is written until the plan returns in full), but
  // running the steps before the gap means doing the expensive part of the work to
  // then throw it away — and, worse, letting a step's own failure hide the gap.
  const chain: MigrationStep[] = [];
  for (let version = declared; version < target; version++) {
    const step = registry.find((candidate) => candidate.from === version);
    if (step === undefined) {
      throw new MigrationRefusedError(
        `no migration is registered for ${version} → ${version + 1}: the chain ${declared} → ${target} has a gap and is not started (a half-applied chain would leave the repository at a version no build supports)`,
      );
    }
    chain.push(step);
  }

  const pending = new Map<string, string>();
  const read = (path: string): string => pending.get(path) ?? input.context.read(path);
  const steps: PlannedStep[] = [];
  let config = input.context.config;

  for (const [at, step] of chain.entries()) {
    const version = declared + at;
    const effect = step.plan({ ...input.context, config, read });
    // The version is set by the RUNNER, over whatever the step returned: a step
    // cannot forget the bump, and it cannot get it wrong either.
    config = { ...(effect.config ?? config), protocolVersion: version + 1 };
    for (const file of effect.files ?? []) pending.set(file.path, file.content);

    steps.push({
      from: version,
      to: version + 1,
      summary: step.summary,
      files: effect.files ?? [],
      notes: effect.notes ?? [],
    });
  }

  const writes: MigrationFile[] = [...pending].map(([path, content]) => ({ path, content }));
  // The config goes LAST, and only if something actually happened: the declared
  // version must not start claiming a shape while the data files it describes are
  // still unwritten (`--write` applies this list in order).
  if (steps.length > 0) {
    writes.push({ path: input.context.configPath, content: renderConfig(config) });
  }

  return { from: declared, to: target, configPath: input.context.configPath, steps, writes };
};

/** The plan as text for the operator: what would happen, step by step, then the files. */
export const renderMigrationPlan = (plan: MigrationPlan): string => {
  if (plan.steps.length === 0) {
    return `protocol version ${plan.from} — nothing to migrate`;
  }
  const lines = [`protocol version ${plan.from} → ${plan.to}, steps: ${plan.steps.length}`];
  for (const step of plan.steps) {
    lines.push(`  ${step.from} → ${step.to}: ${step.summary}`);
    lines.push(`    files: ${step.files.length}`);
    for (const note of step.notes) lines.push(`    NOTE (by hand): ${note}`);
  }
  lines.push(`files to write: ${plan.writes.length}`);
  for (const file of plan.writes) lines.push(`  ${file.path}`);
  return lines.join("\n");
};
