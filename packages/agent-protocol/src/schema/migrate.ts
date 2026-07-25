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
 * DELIBERATELY A FRAME, NOT A LIBRARY. The registry below is EMPTY: the first real
 * step arrives with the change that needs it. A migration engine written ahead of
 * its first migration guesses at what migrations look like; this one only fixes
 * what is already known from the one we have performed — a step is planned before
 * it is applied, it must be verifiable, and it must not be able to forget to bump
 * the version.
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

/** A file the migration rewrites in full. Absolute path — the plan is read by a human. */
export type MigrationFile = {
  readonly path: string;
  readonly content: string;
};

/**
 * What a step is handed. The probes (reading a directory, reading a file) are
 * INJECTED rather than done here: the same split as everywhere in the package —
 * the probes live at the edge (`cli.ts`), the decisions live in the core, and the
 * core stays testable without a repository on disk.
 */
export type MigrationContext = {
  /** The config as raw JSON at the version this step starts from. */
  readonly config: Record<string, unknown>;
  /** Absolute path of the config file — the runner rewrites it after every step. */
  readonly configPath: string;
  /** Absolute path of the mail directory. May not exist: a repository can carry no mail. */
  readonly mailRoot: string;
  /** Contents by absolute path; the pending writes of earlier steps win over disk. */
  readonly read: (path: string) => string;
  /** Absolute paths of the files inside a directory (recursively), as the caller sees them. */
  readonly list: (dir: string) => readonly string[];
};

/**
 * What a step returns. Every field is optional on purpose: a step that only changes
 * the config touches no data files, and a step that only rewrites data returns no
 * config — the version bump is the runner's business either way.
 */
export type MigrationEffect = {
  /** The config after the step, WITHOUT the version — the runner sets that itself. */
  readonly config?: Record<string, unknown>;
  readonly files?: readonly MigrationFile[];
  /** What a human still has to do by hand. Printed by the plan, never applied. */
  readonly notes?: readonly string[];
};

export type MigrationStep = {
  /** The version this step upgrades FROM; it always lands on `from + 1`. */
  readonly from: number;
  /** One line for the plan: what changes and why. Read by whoever approves the run. */
  readonly summary: string;
  readonly plan: (context: MigrationContext) => MigrationEffect;
};

/**
 * The registry — EMPTY until the first breaking change. That is the whole state of
 * affairs and not an omission: version 1 is the shape the protocol has always had,
 * and there is nothing before it to come from.
 */
export const MIGRATIONS: readonly MigrationStep[] = [];

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
  /**
   * The writes folded across the chain: one entry per path with the LAST content,
   * the config file last of all. This is what `--write` applies — applying the
   * steps' files one after another would write intermediate states of a file to
   * disk, which is exactly the half-migrated state property 2 forbids.
   */
  readonly writes: readonly MigrationFile[];
};

export class MigrationRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationRefusedError";
  }
}

/** Two-space JSON with a trailing newline — the shape a config already has in the tree. */
export const renderConfig = (config: Record<string, unknown>): string =>
  `${JSON.stringify(config, null, 2)}\n`;

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

  return { from: declared, to: target, steps, writes };
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
