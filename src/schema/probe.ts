/**
 * ASKING A BUILD FOR ITS NUMBER WITHOUT INSTALLING IT (thread 028).
 *
 * `CURRENT_PROTOCOL_VERSION` answers "which shape does the package write" — but only
 * for the build that is RUNNING. The moment the question matters most, that is the
 * wrong build: a foreign circuit moves its pin from one tag to the next, and until
 * the pin has moved the installed package is still the OLD one. So `config check`
 * there stays green right up to the merge and goes red on a live `main` afterwards —
 * measured on 2026-08-22, LLE: pin `v0.2.1` → `v0.2.3` moved by hand, CI red 37
 * seconds later on «the repository declares protocol version 17, the package writes
 * 18», because the step that was skipped over (`v0.2.2`) carried the shape bump.
 *
 * The two numbers have to stand side by side BEFORE the pin moves, and both have to
 * come from the CANDIDATE rather than from what is installed. Neither is behind the
 * loader: the package's number is read out of its SOURCE at a git ref (a tag is
 * enough — no checkout, no install), and the consumer's number is read out of the
 * raw config, exactly as `schema migrate` reads it and for the same reason — a config
 * one version away is a config the current schema may legitimately reject, and going
 * through the loader would turn the measurement into "invalid config".
 *
 * WHAT THIS IS NOT: a door that refuses the bump. The pin lives in a repository this
 * package does not own, so a refusal there would have nothing to stand on and could
 * be walked around by editing somebody else's `package.json` — a false guarantee is
 * worse than a visible measurement. Hence a verdict that is PRINTED, and a ritual
 * step in prose that reads it (root `README.md`, "Доставка пакета наружу").
 */
import { compareProtocolVersion, renderVersionVerdict, type VersionVerdict } from "./version.js";

/**
 * Where the number is declared inside the artifact. Two paths and not one: a tag cut
 * by `scripts/split-package.sh` has the PACKAGE at its root, while a branch of this
 * repository has it under the workspace prefix. The same ref name means a different
 * layout depending on which of the two it is, and guessing wrong reads as "this ref
 * is not a build of the package".
 */
export const PACKAGE_VERSION_SOURCES = [
  "src/schema/version.ts",
  "packages/agent-protocol/src/schema/version.ts",
] as const;

/**
 * The declaration, read out of the source text. A regex and not an import: importing
 * would mean running somebody else's revision of the code just to learn a number, and
 * the whole point is to ask a build that is NOT installed. The shape it keys on is
 * the shape the file has had since versioning began — `export const
 * CURRENT_PROTOCOL_VERSION = <n>;` — and a source that does not match is reported as
 * unreadable rather than defaulted to anything.
 */
const DECLARATION = /^export const CURRENT_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/m;

export const parseSupportedVersion = (source: string): number | undefined => {
  const found = DECLARATION.exec(source);
  if (found === null) return undefined;
  const value = Number(found[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

/** Where a number came from, so the output never leaves it to be guessed. */
export type NumberSource = {
  readonly version: number;
  /** Human-readable origin: `this build`, `agent-protocol-v0.2.3:src/schema/version.ts`. */
  readonly at: string;
};

export type SchemaVersionProbe = {
  /** What the candidate package writes. */
  readonly writes: NumberSource;
  /** What the consumer declares — absent when no repository was named. */
  readonly declares?: NumberSource;
};

export type SchemaVersionReport = {
  readonly lines: readonly string[];
  /** Absent when only one of the two numbers was asked for. */
  readonly verdict?: VersionVerdict;
};

/**
 * BOTH NUMBERS, THEN THE VERDICT — in that order, and both origins named. The order
 * is the measurement: the reader is deciding whether a pin may move, and a verdict
 * without the two numbers it was computed from is a claim they would have to verify
 * by hand anyway.
 *
 * The verdict text is `renderVersionVerdict` verbatim — the three states already
 * exist and already name their repairs, and a second wording of the same thing is a
 * second thing to keep true.
 */
export const renderSchemaVersion = (probe: SchemaVersionProbe): SchemaVersionReport => {
  const lines = [
    `the package at ${probe.writes.at} writes protocol version ${probe.writes.version}`,
  ];
  if (probe.declares === undefined) {
    lines.push(
      "no config was compared — name the consumer with --repo (and --ref) to get the verdict",
    );
    return { lines };
  }
  lines.push(
    `the config at ${probe.declares.at} declares protocol version ${probe.declares.version}`,
  );
  const verdict = compareProtocolVersion(probe.declares.version, probe.writes.version);
  lines.push(renderVersionVerdict(verdict));
  return { lines, verdict };
};
