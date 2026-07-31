/**
 * The single door to the protocol config.
 *
 * Reading the config from the working copy on disk is not allowed: an agent's
 * worktree sits on that agent's own feature branch, so a permissions change
 * living in that branch would look effective to the circuit — silently. Hence
 * reading goes through git at an EXPLICIT ref, and that is the package's duty,
 * not the callers' discipline: discipline gets bypassed, a door does not.
 *
 * `ref` is a parameter without a default. A default of `origin/main` would be the
 * same silent assumption from the other side: a check in CI must look at the head
 * of the PR branch, otherwise it says "ok" about a file this PR does not contain.
 *
 * Freshness is part of the operation: `origin/*` without a `fetch` goes stale
 * silently, and a stale config is indistinguishable from a current one. Declining
 * to refresh is possible, but it must be LOUD at the caller (`onStale`).
 *
 * The door also carries the PROTOCOL VERSION GATE (R2): a repository whose data is
 * at another version than the one this package writes stops the circuit here,
 * with the repair named, instead of being read as if the shapes matched.
 *
 * AND THE GATE IS A PROPERTY OF THE QUESTION, NOT OF THE COMMAND — `intent` (thread
 * `037-zones-door-version-gate`, john's decision of 2026-07-31). `data` (the default,
 * and everything the circuit does) is the door described above. `policy` is the reader
 * that asks about SOMEBODY ELSE'S ref — the base of a pull request — and asks only
 * about zones, role ids and instruction paths: it neither reads nor writes a byte of
 * the protocol's data, so no version can make its answer wrong. It parses only the
 * fields it came for (`config/policy.ts`) and prints the skew instead of refusing.
 * `tolerateOlder`, which relaxed the NUMBER alone, was the special case of it and is
 * gone: it could never close a bump of the FORM, because a strict parse of a config
 * from another version fails BEFORE the version is ever compared.
 */
import { fetchRef, readFileAtRef } from "../fs/git.js";
import { createRoleRegistry, RoleConfigError, type RoleRegistry } from "../roles/registry.js";
import {
  compareProtocolVersion,
  declaredProtocolVersion,
  legacyVersionHint,
  requireCurrentProtocolVersion,
  type VersionVerdict,
} from "../schema/version.js";
import { DEFAULT_CONFIG_PATH, type ProtocolConfig, protocolConfigSchema } from "./config.js";
import { type PolicyConfig, policyConfigSchema } from "./policy.js";

/**
 * WHAT THE CALLER IS ASKING THE CONFIG FOR — and therefore what a version mismatch
 * means for it. There is no third value on purpose: the two named here are the two
 * halves the 35 call sites split into (thread 037, msg-002 §2), and the split follows
 * from the question rather than from the command's name.
 */
export type ConfigIntent =
  /** Data of the protocol is about to be read or written; another shape stops the circuit. */
  | "data"
  /** Only policy fields of a FOREIGN ref are read; another shape is printed, not refused. */
  | "policy";

export type LoadOptions = {
  /** Working copy of the repository where the config lives (any branch — we read at a ref). */
  readonly repo: string;
  /** Explicit point in history: `origin/main`, `HEAD`, a sha. There is deliberately no default. */
  readonly ref: string;
  readonly path?: string;
  /** false — do not refresh the remote-tracking ref; the caller must say so out loud. */
  readonly fetch?: boolean;
};

export type LoadedConfig = {
  readonly config: ProtocolConfig;
  readonly registry: RoleRegistry;
  readonly path: string;
  readonly ref: string;
  /** How the version at the ref stands against this package — anything but `current` has already refused. */
  readonly version: VersionVerdict;
};

/**
 * What a POLICY reader gets: the few fields it asked for, and the skew for it to say
 * out loud. THERE IS NO REGISTRY HERE, and its absence is the point — the registry
 * answers questions about wake chains, permissions and sessions, which is data of the
 * protocol, not policy of a foreign ref. A door that had one would sooner or later ask
 * it something it has no right to ask of another version.
 */
export type LoadedPolicy = {
  readonly config: PolicyConfig;
  readonly path: string;
  readonly ref: string;
  /** How the version at the ref stands against this package — printed by the caller, never fatal. */
  readonly version: VersionVerdict;
};

export function loadProtocolConfig(options: LoadOptions & { intent?: "data" }): LoadedConfig;
export function loadProtocolConfig(options: LoadOptions & { intent: "policy" }): LoadedPolicy;
export function loadProtocolConfig(
  options: LoadOptions & { readonly intent?: ConfigIntent },
): LoadedConfig | LoadedPolicy {
  const path = options.path ?? DEFAULT_CONFIG_PATH;
  if (options.fetch !== false) fetchRef(options.repo, options.ref);

  const raw = readFileAtRef(options.repo, options.ref, path);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RoleConfigError([
      `'${path}' at ${options.ref} is not JSON: ${(error as Error).message}`,
    ]);
  }

  // THE POLICY READER LEAVES HERE, before any gate and before the strict shape: it is
  // reading a ref that is at another version BY CONSTRUCTION (the base of the very PR
  // that changes the shape), and the fields it came for do not depend on the version.
  // Its own refusals are refusals BY DATA — the field it needs is missing or is not a
  // list of strings — which is the honest half of what the strict parse used to say.
  if (options.intent === "policy") {
    const result = policyConfigSchema.safeParse(parsed);
    if (!result.success) {
      const hint = legacyVersionHint(parsed);
      throw new RoleConfigError([
        ...(hint === undefined ? [] : [hint]),
        ...result.error.issues.map(
          (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      ]);
    }
    return {
      config: result.data,
      path,
      ref: options.ref,
      version: compareProtocolVersion(result.data.protocolVersion),
    };
  }

  // THE VERSION IS ASKED OF THE RAW FILE FIRST, and only in the one direction where
  // the strict parse cannot be trusted to answer: a config written by a NEWER package
  // carries fields this build has never heard of, so the strict object trips over
  // `Unrecognized key: <whatever was added>` and the version gate below is never
  // reached. The human then reads a complaint about a field name instead of the one
  // sentence that fixes it — which is exactly what happened on 2026-07-28, when a
  // daemon raised before the merge of #66 met the new `stalled` key and died on it,
  // taking every command with it, `status` included (thread `023-daemon-parallelism`).
  // Only `ahead` is gated here. `behind` keeps going through the parse: the config is
  // one this package can still describe, so it gets the refusal that names the migration
  // rather than a complaint about a field.
  const declared = declaredProtocolVersion(parsed);
  if (declared !== undefined && compareProtocolVersion(declared).state === "ahead") {
    requireCurrentProtocolVersion(declared, { path, ref: options.ref });
  }

  const result = protocolConfigSchema.safeParse(parsed);
  if (!result.success) {
    // A config that predates versioning fails on a strict-object complaint about an
    // unknown field `version` — true, and useless. The repair is named instead
    // (R2): the field was not removed, it was RENAMED, and only whoever knows the
    // data can place it in the migration chain.
    const hint = legacyVersionHint(parsed);
    throw new RoleConfigError([
      ...(hint === undefined ? [] : [hint]),
      ...result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    ]);
  }

  // THE VERSION GATE stands here, on the reading path, and not in the callers: a
  // mismatch between the shape of the data and the shape the package writes is
  // exactly what every command would otherwise have to remember about. The
  // consequence is deliberate — the circuit halts, and the one command that keeps
  // working is `schema migrate`, which reads the raw file rather than this door.
  const version = compareProtocolVersion(result.data.protocolVersion);
  requireCurrentProtocolVersion(result.data.protocolVersion, { path, ref: options.ref });

  return {
    config: result.data,
    registry: createRoleRegistry(result.data),
    path,
    ref: options.ref,
    version,
  };
}
