/**
 * WHAT A MIGRATION STEP IS — the contract between the frame (`migrate.ts`, which
 * runs the chain) and a step (`v2-provenance.ts` and whatever comes after it).
 *
 * It lives in its own module for one reason: a step must be able to REFUSE
 * (`MigrationRefusedError`) and the frame must be able to REGISTER it, and if both
 * halves lived in one file the two would import each other. A cycle here would be
 * survivable and still wrong — the registry is a const evaluated at load time, and
 * "survivable" depends on which module the loader reaches first.
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
 * A refusal — raised by the frame (a gap in the chain, a downgrade) and by a step
 * that cannot prove what it is about to do. Both mean the same thing to the caller:
 * NOTHING was written, and the message says what to fix.
 */
export class MigrationRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationRefusedError";
  }
}
