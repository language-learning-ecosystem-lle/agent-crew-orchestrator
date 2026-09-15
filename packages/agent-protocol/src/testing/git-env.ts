/**
 * WHICH GIT THIS SUITE IS ALLOWED TO TALK TO (thread `180-selfheal-leaves-the-workspaces-behind`).
 *
 * A process test of this package builds its own repositories under a temp base and then
 * addresses them the way every caller does — `git -C <its own fixture> …`. `-C` reads like
 * isolation and IS NOT: `GIT_DIR` in the environment beats it, and the call answers about,
 * and WRITES INTO, whatever tree the variable names. Measured, 2026-09-14, three outcomes
 * apart (a run that refused, a run that wrote where it was told, a run that wrote
 * elsewhere) on throw-away repositories:
 *
 *     GIT_DIR=$P/victim/.git  git -C $P/target remote set-url origin https://HIJACKED/x.git
 *     exit=0
 *     victim  remote.origin.url : https://ORIGINAL/… -> https://HIJACKED/x.git   ← the write landed HERE
 *     target  remote.origin.url : (none)                                        ← and not in the named -C
 *     …with `env -u GIT_DIR`, the same call: target -> the url it was given.
 *
 * The blast radius is not the test. `git config --show-origin --get remote.origin.url` in a
 * role's workspace of this contour answers `file:<checkout>/.git/config` — the SHARED file
 * of every worktree, `extensions.worktreeConfig` notwithstanding. One hijacked write there
 * redirects the mail of every role on the box at once.
 *
 * AND THE CONFIG HALF LEAKS TODAY, not hypothetically. `env | grep ^GIT` inside a raised
 * session of this circuit names `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` /
 * `GIT_CONFIG_VALUE_0` — the credential helper the orchestrator hands a session
 * (`config/credentials.ts`). Every git call of a suite run from inside a session therefore
 * carries the operator's login, which is the same loss `process-sandbox.ts` already
 * removes for `GH_TOKEN`: a test whose whole claim is "no credential anywhere → the refusal
 * names the file" measures the shell instead of the package.
 *
 * WHY THE HARNESS AND NOT THE CALL SITES. Thirteen files of this suite write a remote
 * (`remote add` / `remote set-url`) and not one of them scrubs anything — but those thirteen
 * are the radius of the SYMPTOM, not of the defect: a hijacked `GIT_DIR` bends `init`,
 * `commit` and `status` in every `*.process.test.ts` just as well. An explicit helper would
 * have to be remembered at every git call of every such file, and forgetting it is the
 * mechanism itself. This package has decided the same question twice already and written
 * the answer down both times — `tmp-base.ts` ("chosen once here rather than at 135 call
 * sites") and `process-sandbox.ts` ("four files each forgot the same line independently,
 * which is what a copied convention does"). So the environment is chosen once, in
 * `vitest.config.ts` → `setupFiles`, and `sandbox()` builds a child's environment out of
 * `process.env` — which means one scrub covers both the suite's own git calls and the CLI
 * it spawns.
 *
 * WHAT IS SCRUBBED AND WHAT IS NOT — the rule, not the list, because the list will grow:
 *
 * - out goes a name that makes git answer about a TREE OTHER than the one the caller named,
 *   and a name that makes it answer OUT OF A CONFIG the caller did not name;
 * - a name that does not change git's ANSWER stays: `GIT_EDITOR`, `GIT_TERMINAL_PROMPT`,
 *   `GIT_ASKPASS` and the `GIT_TRACE*` family. Dropping `GIT_TERMINAL_PROMPT=0` would be an
 *   active loss: a test that reaches authentication would get a prompt and a timeout where
 *   it used to get a refusal;
 * - the committer identity (`GIT_AUTHOR_*`, `GIT_COMMITTER_*`) is deliberately left alone.
 *   It is a third class — it changes what a commit SAYS, not which repository answers — and
 *   this package has a door of its own about a missing identity (`workspace.process`)
 *   whose cases would change meaning if the harness started deciding it.
 *
 * Names verified against `git help environment` (git 2.43) and `git-config(1)`, not from
 * memory: `GIT_PREFIX` is documented with the hooks rather than there, and
 * `GIT_CONFIG_COUNT`/`KEY_<n>`/`VALUE_<n>` live in `git-config(1)` alone.
 */
import { GIT_HOOK_ENV_KEYS } from "../fs/git-env.js";

/**
 * Names that redirect git to ANOTHER TREE. The four a hook exports come from the product's
 * own door — one list, see `fs/git-env.ts` — and the rest are the names by which a git call
 * can be told to read someone else's objects, someone else's refs, or to stop looking for
 * the repository the caller is standing in.
 */
export const GIT_TREE_ENV_KEYS: readonly string[] = [
  ...GIT_HOOK_ENV_KEYS,
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
];

/**
 * Names that answer out of ANOTHER CONFIG. `GIT_CONFIG_COUNT` is listed here and the
 * indexed pairs it counts are matched by pattern — dropping the count alone would leave
 * `GIT_CONFIG_KEY_0` behind for a test that sets a count of its own to walk into.
 */
export const GIT_CONFIG_ENV_KEYS: readonly string[] = [
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
];

const INDEXED_CONFIG_PAIR = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;

/**
 * THE NAMES TO REMOVE FROM A GIVEN ENVIRONMENT — the picker, pure, so that the three
 * questions (is this name taken out, is this one left in, is the hook list covered) are
 * answerable without a box whose environment happens to carry any of them.
 *
 * Only names actually PRESENT are returned: the caller deletes what is there, and a report
 * of what was scrubbed that names variables nobody set would be a report about nothing.
 */
export const scrubbedGitEnvNames = (env: NodeJS.ProcessEnv): readonly string[] =>
  Object.keys(env).filter(
    (name) =>
      GIT_TREE_ENV_KEYS.includes(name) ||
      GIT_CONFIG_ENV_KEYS.includes(name) ||
      INDEXED_CONFIG_PAIR.test(name),
  );

/** The same environment with those names gone. The input is never mutated. */
export const gitEnvOutsideLauncher = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const rest = { ...env };
  for (const name of scrubbedGitEnvNames(env)) delete rest[name];
  return rest;
};
