/**
 * THE ENVIRONMENT A GIT CALL OF THIS PACKAGE IS MADE IN — one reader, because every door
 * that asks git about a TREE asks it the same way (thread 170).
 *
 * It lived inside `cli.ts` while it had one kind of caller. It moved here when the body
 * location door (`fs/body-location.ts`) grew a second and a third: a helper copied next to
 * a second caller is a helper that drifts, and the drift here is silent — a git call made
 * with a hook's `GIT_DIR` still answers, it just answers about the wrong tree.
 */

/**
 * THE ENVIRONMENT WITHOUT THE VARIABLES A GIT HOOK EXPORTS. Every hook runs with
 * `GIT_DIR` (and friends) set, and with `GIT_DIR` set `git rev-parse --show-toplevel`
 * stops answering "the root of the repository" and answers "the current directory" —
 * so a guard that resolves the repository from its cwd resolves it to whatever
 * directory the hook's command happened to run in. That is not a hypothetical: the
 * zones guard of thread 020 let a commit into a path under a prefix FORBIDDEN to the
 * committing role through on its first live test, because `pnpm -F agent-protocol`
 * runs in the package directory and the inherited `GIT_DIR` made that directory look
 * like the repository root — the
 * guard concluded "not a role workspace" and stood aside, silently, in exactly the
 * situation it exists for.
 */
export const gitEnvOutsideHook = (): NodeJS.ProcessEnv => {
  const {
    GIT_DIR: _dir,
    GIT_INDEX_FILE: _index,
    GIT_WORK_TREE: _tree,
    GIT_PREFIX: _prefix,
    ...rest
  } = process.env;
  return rest;
};
