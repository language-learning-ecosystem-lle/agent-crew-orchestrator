/**
 * THE CONFIG THAT STAYS IN FORCE WHEN THE NEXT READ CANNOT REACH THE REF.
 *
 * The door in `load.ts` reads the config at a ref, and reading at a ref means
 * touching the network (`fetch`). For a one-shot command a dead network is simply
 * a refusal — nothing was going to happen anyway. For a RUNNING DAEMON it is the
 * opposite: the tick IS the retry, and a process that exits on the first timeout
 * is not there when the network comes back.
 *
 * That is not hypothetical. On 2026-07-28 the daemon of this project died at
 * ~23:03Z with `TLS handshake timeout` → `ssh: connect to host github.com port 22:
 * Connection timed out` → `git fetch --quiet origin main` → "the protocol config at
 * 'origin/main' was not read", and stood until morning — 8.3 hours of silence with
 * eleven waiting pairs (thread `023-daemon-parallelism`, curator's facts from the
 * local daemon log). The already-written degradation of the mail probe ("LAUNCHING
 * NOBODY … the daemon stays up and re-probes") was beaten by this: the probe itself
 * starts by reading the config, so the retry killed the process before it could
 * retry anything.
 *
 * WHAT THIS MODULE IS. A memory of the last config ACTUALLY READ per (repo, ref,
 * path), and a rule about which failures may be answered from it.
 *
 * WHY THE FIRST READ IS STILL FATAL, WITH NO FLAG SAYING SO. It falls out of the
 * data instead of a switch: at startup nothing has been remembered yet, so there is
 * nothing to stand on and the failure passes through. Without a single config ever
 * read there is nothing to work by, and refusing is right.
 *
 * WHAT IS NOT TOLERATED — a config that WAS read and then rejected. A schema
 * complaint (`RoleConfigError`) or a version verdict (`ProtocolVersionError`) is a
 * statement about the repository's own data, made by whoever pushed it; carrying on
 * with yesterday's config would mean overriding a decision, not surviving a hiccup.
 * The wire is the only thing this module forgives.
 */
import { RoleConfigError } from "../roles/registry.js";
import { ProtocolVersionError } from "../schema/version.js";
import type { LoadedConfig, LoadOptions } from "./load.js";

/** What identifies "the same question": the same file, at the same ref, in the same repository. */
export const standingKey = (
  options: Pick<LoadOptions, "repo" | "ref"> & { path: string },
): string => [options.repo, options.ref, options.path].join("\0");

/**
 * WHAT IS REMEMBERED IS A PARAMETER, and one memory is never shared between two
 * shapes (thread 055.3, the reviewer's finding on PR #202). The healer reads the
 * same file with another question (`intent: "repair"` — where this box keeps its
 * state), and it needs exactly this survival for exactly this reason: `restart`
 * resolves the paths three times in one command, and the last of those runs AFTER
 * `down` has stopped the daemon, where a wire failure is a half-restart. It gets
 * its OWN instance rather than this one: a key of (repo, ref, path) says nothing
 * about the intent, so a shared map could hand a loosely-parsed repair read to a
 * caller whose version was never checked.
 */
export type StandingOutcome<T = LoadedConfig> =
  /** The ref was read; this is what it says, and it is now what stands. */
  | { readonly kind: "read"; readonly config: T }
  /** The ref was not reachable — the last config read at this key stays in force, out loud. */
  | { readonly kind: "stood"; readonly config: T; readonly reason: string }
  /** Nothing to stand on, or a refusal that must not be stood over. */
  | { readonly kind: "unread"; readonly error: Error };

export type StandingConfig<T = LoadedConfig> = {
  /**
   * Read through the memory. `load` is the real door — this module never reads
   * anything itself, which is what makes it testable without a repository.
   */
  readonly read: (key: string, load: () => T) => StandingOutcome<T>;
};

/** A rejection of the DATA, as opposed to a failure to reach it. Never stood over. */
const isVerdict = (error: unknown): boolean =>
  error instanceof RoleConfigError || error instanceof ProtocolVersionError;

export const createStandingConfig = <T = LoadedConfig>(options?: {
  readonly now?: () => Date;
}): StandingConfig<T> => {
  const now = options?.now ?? ((): Date => new Date());
  const remembered = new Map<string, { readonly config: T; readonly at: Date }>();

  return {
    read: (key, load) => {
      try {
        const config = load();
        remembered.set(key, { config, at: now() });
        return { kind: "read", config };
      } catch (error) {
        const standing = remembered.get(key);
        if (standing === undefined || isVerdict(error)) {
          return { kind: "unread", error: error as Error };
        }
        return {
          kind: "stood",
          config: standing.config,
          // The reason names all three facts a human needs at 3am: what failed, that
          // nothing new was read, and HOW OLD what we are working by is. A silent
          // fallback would be the stale-config defect this package was built against.
          reason: `${(error as Error).message} — the config read at ${standing.at.toISOString()} stays in force (nothing new was read)`,
        };
      }
    },
  };
};
