/**
 * THE BUILD THE ROLE'S TREE ACTUALLY RUNS (thread `085-stale-workspace-package`) — read
 * before the spawn, and named out loud when it is not the one the circuit runs.
 *
 * WHAT WAS MEASURED. On 2026-09-02 one role workspace of a consuming contour stood on
 * `agent-protocol` 0.2.7 while that repository pinned `v0.2.9` — one tree out of four.
 * The ritual of a version bump ends with "`pnpm install` in EVERY workspace of a role", it
 * is executed by a hand, and the hand missed one directory. Nothing said so.
 *
 * WHY THE VERSION GATE COULD NOT SEE IT, and this is the whole reason the check exists as
 * a second one rather than as a fix to the first. `schema/version.ts` compares the SHAPE
 * OF THE DATA — the config's `protocolVersion` against the one the package writes. Between
 * 0.2.7 and 0.2.9 that number never moved (25 in both), so the two numbers agreed and the
 * launch was legal by its criterion. The criterion is right and the question is different:
 * "is this tree at the shape of my data" is not "is this tree running my build". Most
 * releases do not touch the schema, so this blind spot is the DEFAULT case, not a corner.
 *
 * WHO PAID. The raised session — on its first mail command. `thread show --for` exists
 * only from 0.2.9; on 0.2.7 the same line is `exit 2` plus seven hundred lines of usage in
 * the session's context, and the role spends a turn and a context window discovering that
 * its own environment is behind. The refusal below costs a file read and says the fact.
 *
 * WHAT IS COMPARED, AND WHY NOT THE PIN STRING. The statement asked for "the installed
 * version against the repository's pin". The pin is a DEPENDENCY SPECIFIER — a git tag in
 * one contour (`github:…#agent-protocol-v0.2.9`), a range or a workspace link in the next
 * — and a package that parses specifiers to derive a version would be inventing a resolver
 * that pnpm already owns. What is compared instead is two MANIFESTS of the same package:
 * the one installed in the role's workspace, and the one installed in the HOME CHECKOUT —
 * which is where the pin was resolved and, since thread 078, the tree the daemon itself
 * loads its modules from. So the question asked is the one that matters at a spawn: does
 * the role's tree run the same build as the circuit raising it. The pin is still read, and
 * only ever QUOTED in the refusal — it is what a human greps for.
 *
 * WHERE IT DOES NOT SPEAK. A home checkout that does not install this package as a
 * dependency at all — the protocol's own contour, where the package IS the repository and
 * the sessions run it from source — has no reference version to compare against, and this
 * module then says nothing rather than inventing an expectation. A workspace that does not
 * exist yet is likewise not judged: it is created empty a moment later, and the install
 * into it belongs to the ritual, not to a door that would refuse every first launch of a
 * new role.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not install anything. Running `pnpm install`
 * into a role's tree from the daemon's process is a write into somebody's workspace on a
 * guess, and john's decision of this thread's statement (§4) is that this door NAMES the
 * fault and a human repairs it. The ritual step is not removed by the check either: the
 * check only speaks, the ritual is what fixes.
 */

import { z } from "zod";

/**
 * The package whose build the circuit is made of. A constant rather than a lookup of
 * "what am I": the check has to name the package in a refusal a human will act on, and the
 * name of this package is not a runtime discovery.
 */
export const WORKSPACE_PACKAGE = "agent-protocol";

/** What can be read off the disk about that package, without asking the network. */
export type WorkspacePackageFacts = {
  /** `version` of `<workspace>/node_modules/<pkg>/package.json`; absent when there is none. */
  readonly installed?: string;
  /**
   * The same, in the home checkout — the version the pin resolved to. Absent when the home
   * checkout does not install the package at all, and that absence is a legitimate state
   * (the protocol's own contour), never a fault.
   */
  readonly reference?: string;
  /** The dependency specifier of the home checkout's `package.json` — quoted, never parsed. */
  readonly pin?: string;
};

/**
 * A `package.json` AT THE BOUNDARY — somebody else's file, in somebody else's tree, read
 * only to be measured. Loose on purpose: a manifest carries thirty fields this package has
 * no opinion about, and rejecting it for having them would be a door that refuses every
 * real repository.
 */
const MANIFEST = z
  .object({
    version: z.string().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .loose();

/**
 * The two readers are TOTAL — an unparseable or unexpected manifest answers `undefined`,
 * the same answer as a file that is not there. The caller acts on both the same way, and
 * the alternative is a launch door that throws on a stray comma in a tree it was only
 * asked to look at.
 */
const parseManifest = (text: string): z.infer<typeof MANIFEST> | undefined => {
  try {
    const parsed = MANIFEST.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** `version` of an installed manifest — what "which build is this" is answered from. */
export const manifestVersion = (text: string): string | undefined => parseManifest(text)?.version;

/**
 * The pin as the repository WROTE it — the dependency specifier, whatever form the contour
 * keeps it in. It is quoted in a refusal and never parsed for a version: deriving one from
 * a git tag, a range or a tarball URL would be a second resolver disagreeing with pnpm's.
 */
export const manifestPin = (text: string): string | undefined => {
  const manifest = parseManifest(text);
  return (
    manifest?.dependencies?.[WORKSPACE_PACKAGE] ?? manifest?.devDependencies?.[WORKSPACE_PACKAGE]
  );
};

export type WorkspacePackageVerdict =
  /** Nothing to refuse. `note` is present exactly when a comparison was actually made. */
  { readonly ok: true; readonly note?: string } | { readonly ok: false; readonly reason: string };

/**
 * The refusal, by name: which role, which tree, which version is there, which is expected,
 * and the one command that repairs it — the four things the session of 2026-09-02 had to
 * derive from an `exit 2`.
 */
export const checkWorkspacePackage = (input: {
  readonly role: string;
  /** The role's workspace, absolute — the tree being judged. */
  readonly path: string;
  /** The home checkout, absolute — where the pin was resolved. */
  readonly repo: string;
  readonly facts: WorkspacePackageFacts;
}): WorkspacePackageVerdict => {
  const { installed, reference, pin } = input.facts;
  // NO EXPECTATION, NO VERDICT. Silence here is the correct answer and not a gap: a
  // contour that runs the package from its own source has nothing installed to compare,
  // and a door that invented a version for it would refuse the whole circuit it lives in.
  if (reference === undefined) return { ok: true };
  const pinned = pin === undefined ? "" : ` (pinned as '${pin}')`;
  const repair = `pnpm --dir ${input.path} install --frozen-lockfile`;
  if (installed === undefined) {
    return {
      ok: false,
      reason: `the workspace of '${input.role}' has no '${WORKSPACE_PACKAGE}' installed — '${input.path}/node_modules/${WORKSPACE_PACKAGE}' is not there, while the home checkout '${input.repo}' installs ${reference}${pinned}. A session raised here cannot run its own mail commands at all; the dependencies of that tree have never been installed, or were removed: ${repair}`,
    };
  }
  if (installed === reference) {
    return {
      ok: true,
      note: `${input.path} — ${WORKSPACE_PACKAGE} ${installed}, the build of the home checkout`,
    };
  }
  return {
    ok: false,
    reason: `the workspace of '${input.role}' runs '${WORKSPACE_PACKAGE}' ${installed}, the home checkout '${input.repo}' installs ${reference}${pinned} — the tree is on a DIFFERENT BUILD from the circuit that raises it, and the protocol schema cannot see that (both carry the same schema version, which is why the launch was legal until now). A session raised here spends its first mail command on an 'exit 2' from a flag its own build does not have: ${repair}`,
  };
};
