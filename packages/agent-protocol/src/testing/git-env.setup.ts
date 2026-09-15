/**
 * The `setupFiles` entry that applies the choice made in `git-env.ts`: it runs before a test
 * module is loaded, so a fixture that calls git at module scope is already answered about
 * its own tree, and a CLI this suite spawns inherits the cleaned environment with the rest
 * of it (`process-sandbox.ts` builds a child's environment out of `process.env`).
 *
 * `process.env` is mutated in place rather than replaced: a child of this worker takes the
 * live object, and handing back a copy would clean the suite's own calls and leave every
 * spawn exactly as dirty as it was.
 */
import { scrubbedGitEnvNames } from "./git-env.js";

for (const name of scrubbedGitEnvNames(process.env)) delete process.env[name];
