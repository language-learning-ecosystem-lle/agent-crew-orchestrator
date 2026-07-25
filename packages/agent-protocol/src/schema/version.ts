/**
 * THE VERSION OF THE PROTOCOL SCHEMA — one number for the whole shape the
 * protocol keeps on disk: the config, the thread layout, the message header, the
 * journal event. Declared by the project in `agent-protocol.json`
 * (`protocolVersion`), supported by the package as `CURRENT_PROTOCOL_VERSION`.
 *
 * WHY ONE NUMBER AND NOT ONE PER ARTIFACT. The artifacts are not independent: a
 * field added to a message header changes what the assembled `_thread.md` looks
 * like, and a role field changes what the launch contract reads. Versioning them
 * separately would mean a matrix of combinations nobody ever tests; one number
 * means one question — "is the repository at the shape this package writes".
 *
 * WHY THE NUMBER LIVES IN THE CONFIG AND NOT IN THE PACKAGE ALONE. The package is
 * designed as a foreign one and travels between repositories; the DATA stays in
 * the repository. Only the repository can say which shape its own data is at, and
 * only the package can say which shape it writes. A mismatch between the two is
 * the thing worth catching, and it is catchable exactly because the two numbers
 * live in different places.
 *
 * WHAT THE NUMBER IS NOT. It does not describe a single thread. The move of a
 * thread from one `_thread.md` into `messages/` runs thread by thread and is
 * deliberately gradual (`migrate`, both forms are read at once) — that is a
 * property of one directory, not of the repository. A versioned migration is
 * repo-wide and lands in one go.
 */

/**
 * The shape this build of the package reads and writes. It is bumped ONLY together
 * with a migration step registered for the previous version (see `schema/migrate.ts`)
 * and with the `protocolVersion` of the config in the same PR — otherwise the
 * circuit halts on its own repository.
 */
export const CURRENT_PROTOCOL_VERSION = 2;

/** The key of the config field. Kept as a constant: the loader's hint quotes it. */
export const PROTOCOL_VERSION_FIELD = "protocolVersion";

/**
 * The field this one replaced. `version` said nothing about WHAT it versioned —
 * the file, the package or the protocol — and the ambiguity became load-bearing
 * the moment migrations started keying off the number. A config still carrying the
 * old key is met with the exact repair rather than with a generic "unknown field".
 */
export const LEGACY_VERSION_FIELD = "version";

export type VersionState =
  /** The repository is at the shape the package writes. */
  | "current"
  /** The repository is OLDER than the package: a migration has not been run. */
  | "behind"
  /** The repository is NEWER than the package: the package is out of date. */
  | "ahead";

export type VersionVerdict = {
  readonly state: VersionState;
  readonly declared: number;
  readonly supported: number;
};

export const compareProtocolVersion = (
  declared: number,
  supported: number = CURRENT_PROTOCOL_VERSION,
): VersionVerdict => ({
  state: declared === supported ? "current" : declared < supported ? "behind" : "ahead",
  declared,
  supported,
});

/**
 * The refusal text. Both directions name the ONE action that fixes them, and they
 * are different actions: a repository behind the package is migrated, a repository
 * ahead of it means the package is old and a DOWNGRADE IS NOT PERFORMED — data
 * written by a newer shape cannot be re-derived from the older one, so guessing
 * would destroy what it cannot restore.
 */
export const renderVersionVerdict = (verdict: VersionVerdict): string => {
  if (verdict.state === "current") {
    return `protocol version ${verdict.declared} — matches the package`;
  }
  if (verdict.state === "behind") {
    return `the repository declares protocol version ${verdict.declared}, the package writes ${verdict.supported} — run 'agent-protocol schema migrate' (a dry run first, then --write)`;
  }
  return `the repository declares protocol version ${verdict.declared}, the package supports only ${verdict.supported} — update the package; a downgrade is not performed`;
};

export class ProtocolVersionError extends Error {
  readonly verdict: VersionVerdict;

  constructor(verdict: VersionVerdict, at: { readonly path: string; readonly ref?: string }) {
    const where = at.ref === undefined ? `'${at.path}'` : `'${at.path}' at ${at.ref}`;
    super(`${where}: ${renderVersionVerdict(verdict)}`);
    this.name = "ProtocolVersionError";
    this.verdict = verdict;
  }
}

/**
 * The gate on the reading path. It stands in the LOADER rather than in the callers:
 * a version mismatch is exactly the kind of thing every command would otherwise
 * have to remember about, and the package's own rule is that a door beats
 * discipline. The consequence is deliberate — once the numbers diverge, the whole
 * circuit stops, and the only command that keeps working is the one that fixes it
 * (`schema migrate` reads the raw file, not the loader).
 */
export const requireCurrentProtocolVersion = (
  declared: number,
  at: { readonly path: string; readonly ref?: string },
  supported: number = CURRENT_PROTOCOL_VERSION,
): void => {
  const verdict = compareProtocolVersion(declared, supported);
  if (verdict.state !== "current") throw new ProtocolVersionError(verdict, at);
};

/**
 * The version as DECLARED BY THE RAW FILE, before any schema validation: a
 * migration works on a config whose shape the current schema may well reject, so
 * the number has to be readable without it.
 *
 * A config with no `protocolVersion` is NOT guessed at. Guessing would mean
 * choosing which shape somebody else's data is in — and the whole point of the
 * field is that only the repository can answer that.
 */
export const declaredProtocolVersion = (raw: unknown): number | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = (raw as Record<string, unknown>)[PROTOCOL_VERSION_FIELD];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
};

/**
 * The hint for a config that predates versioning (`version` and no
 * `protocolVersion`). It is a HAND edit and says so: migrations are keyed on
 * `protocolVersion`, so a config that lacks the key cannot be placed in the chain
 * at all — the very first step has to be taken by whoever knows what the data is.
 */
export const legacyVersionHint = (raw: unknown): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (!(LEGACY_VERSION_FIELD in record) || PROTOCOL_VERSION_FIELD in record) return undefined;
  return `the config carries the old field '${LEGACY_VERSION_FIELD}' — rename it to '${PROTOCOL_VERSION_FIELD}' by hand (the field now versions the PROTOCOL SCHEMA, and migrations key off it)`;
};
