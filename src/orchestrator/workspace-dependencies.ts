/**
 * CAN THE TREE THE SESSION IS PUT IN RUN A COMMAND AT ALL (thread
 * `161-daemon-self-restart`) — the question `workspace-package.ts` does not ask, and the
 * one that broke the field the day the trees started being made per PAIR.
 *
 * WHAT WAS MEASURED. On 2026-09-09, minutes after the circuit restarted itself onto #366
 * ("the run sits in the tree of the PAIR"), two roles were raised into two brand-new pair
 * worktrees and both had their FIRST command die the same way — the documented mail line
 * out of their own prompt, answered by `ERR_MODULE_NOT_FOUND: Cannot find package 'zod'`.
 * Neither tree had `node_modules`, and neither had `packages/agent-protocol/node_modules`:
 * a worktree is created empty by construction, and nothing installs into it. One of the
 * two sessions guessed the repair by hand and paid a turn for the guess; the other class
 * of session — the one that does not guess — dies without delivering anything.
 *
 * WHY THE EXISTING DOOR IS BLIND TO IT, and this is the whole reason there is a second
 * module rather than a longer first one. `workspace-package.ts` compares the version of
 * `agent-protocol` INSTALLED in the workspace against the one installed in the home
 * checkout. In the protocol's OWN contour the home checkout installs no copy of itself —
 * the package IS the repository and the sessions run it from source — so that door has no
 * reference to compare against and, correctly, says nothing. The thing that is missing in
 * this contour is not a copy of the package: it is the package's own DEPENDENCIES, which
 * in a pnpm layout live in `packages/agent-protocol/node_modules`. Different fact,
 * different reader, and the first door is right to stay silent about it.
 *
 * WHAT IS COMPARED, AND WHY AGAINST THE HOME CHECKOUT. Not "does this tree have
 * `node_modules`" — that criterion would have to know a package manager's layout, and it
 * would be wrong for the next contour. What is compared is two DISKS: the directories in
 * which the home checkout has an install, and the same relative directories in the role's
 * tree. The home checkout is the tree the daemon itself loads its modules from, so it is
 * the one place where "installed" is a fact rather than an expectation — the same move
 * `workspace-package.ts` makes with versions, asked one level down.
 *
 * WHY IT IS A NOTE AND NOT A REFUSAL. A refusal here would stop EVERY first launch into
 * every pair tree, because empty is the normal state of a tree that was made a moment ago
 * — the door would be against the circuit it lives in. What the session lacks is not
 * permission, it is the fact; so the fact is said, in its prompt, before its first
 * command, with the one line that repairs it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not install anything, and nothing in this
 * module runs a package manager. `pnpm install` into a role's tree from the daemon's
 * process is a write into somebody's workspace on a guess, and john's decision of thread
 * `085-stale-workspace-package` (§4) stands: the door NAMES the fault, a hand repairs it.
 * Here the hand is the raised session's own, which is why the text is addressed to it.
 */

import { join } from "node:path";

/** The directory an install leaves behind; the relative root `.` means the tree itself. */
export const INSTALL_DIR = "node_modules";

/**
 * The one line that repairs it — `--dir` rather than a bare `pnpm install`, so that the
 * SAME text is correct for both of its readers: the session, whose cwd is the tree, and
 * the human reading the launch line in a journal somewhere else entirely. Deliberately
 * the same form `workspace-package.ts` already prints, because a contour with two repair
 * lines for two shapes of the same fault is a contour nobody greps successfully.
 */
export const dependenciesRepair = (path: string): string =>
  `pnpm --dir ${path} install --frozen-lockfile`;

export type WorkspaceDependenciesVerdict =
  /** Nothing to say — every install root of the home checkout is present in the tree. */
  | { readonly installed: true }
  /** The fact and its repair, in one text, addressed to the session that will read it. */
  | { readonly installed: false; readonly note: string };

/** How many missing roots are named before the text starts counting instead. */
const NAMED = 4;

/**
 * The paths as a reader can act on them — absolute, and pointing at the directory that is
 * actually not there rather than at the package that would have lived in it. `.` is the
 * tree's own root, and it is the one that is missing most often.
 */
const namePaths = (path: string, roots: readonly string[]): string => {
  const absolute = roots.map((root) =>
    root === "." ? join(path, INSTALL_DIR) : join(path, root, INSTALL_DIR),
  );
  if (absolute.length <= NAMED) return absolute.map((one) => `'${one}'`).join(", ");
  const rest = absolute.length - NAMED;
  return `${absolute
    .slice(0, NAMED)
    .map((one) => `'${one}'`)
    .join(", ")} and ${rest} more`;
};

/**
 * THE VERDICT, from two lists of relative directories and nothing else — the IO half (which
 * directories those are) belongs to the caller, for the reason every door in this package
 * splits that way: the decision is what a test can hold, and a function that went looking
 * at a disk could not be held to two states in one file.
 */
export const checkWorkspaceDependencies = (input: {
  readonly role: string;
  /** The role's workspace, absolute — the tree the session will be started in. */
  readonly path: string;
  /** The home checkout, absolute — the tree the circuit loads its own modules from. */
  readonly repo: string;
  /** Relative directories in which the HOME CHECKOUT has an install. */
  readonly home: readonly string[];
  /** The same, measured in the role's workspace. */
  readonly tree: readonly string[];
}): WorkspaceDependenciesVerdict => {
  // NO INSTALL ANYWHERE, NO EXPECTATION. A home checkout with nothing installed in it is
  // not a contour this module has anything true to say about — inventing a requirement
  // from an empty measurement is the failure mode the version door was written against.
  if (input.home.length === 0) return { installed: true };
  const present = new Set(input.tree);
  const missing = input.home.filter((root) => !present.has(root));
  if (missing.length === 0) return { installed: true };
  return {
    installed: false,
    note: `THE DEPENDENCIES OF YOUR WORKING TREE ARE NOT INSTALLED — ${namePaths(
      input.path,
      missing,
    )} ${missing.length === 1 ? "is" : "are"} not there, while the home checkout '${
      input.repo
    }' has an install in ${missing.length === 1 ? "it" : "each of them"}. This tree was made for the run '${
      input.role
    }' a moment ago and nothing installs into it. Every command of this package started from here — INCLUDING the mail commands above — dies on 'ERR_MODULE_NOT_FOUND' before it does anything, and the error names a package rather than this fact. Run this once, before your first command: \`${dependenciesRepair(
      input.path,
    )}\``,
  };
};
