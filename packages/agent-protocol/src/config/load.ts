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
 */
import { fetchRef, readFileAtRef } from "../fs/git.js";
import { createRoleRegistry, RoleConfigError, type RoleRegistry } from "../roles/registry.js";
import { DEFAULT_CONFIG_PATH, type ProtocolConfig, protocolConfigSchema } from "./config.js";

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
};

export const loadProtocolConfig = (options: LoadOptions): LoadedConfig => {
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

  const result = protocolConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new RoleConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  return {
    config: result.data,
    registry: createRoleRegistry(result.data),
    path,
    ref: options.ref,
  };
};
