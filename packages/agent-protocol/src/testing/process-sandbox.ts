/**
 * THE CONFIG HOME OF A PROCESS TEST (R14).
 *
 * A process test starts the real CLI as a real process, and the CLI reads the MACHINE
 * config from `XDG_CONFIG_HOME` (falling back to `~/.config`). A launch that inherits
 * the environment unchanged therefore reads the config of WHOEVER RAN THE SUITE — and
 * that is the exact class of defect R14 was introduced to remove, reappearing inside
 * the tests that are supposed to guard it.
 *
 * It stopped being theoretical on 2026-07-27: the moment a live machine config gained
 * an `instance` name, 28 tests in four files went red on the developer's box and stayed
 * green on the runner (which has no machine config at all). "Green locally" had stopped
 * meaning anything, and it is the local run that checks a package BEFORE the runner.
 *
 * So the home lives HERE and not as a helper copied into each file: four files each
 * forgot the same line independently, which is what a copied convention does. Anything
 * that spawns the CLI takes its environment from `sandbox()`.
 */
import { join } from "node:path";

/**
 * The environment of one CLI launch: the ambient one, with the config home replaced by
 * a directory the test owns. `extra` goes last — a test that also passes provenance or
 * a session file keeps saying so.
 */
export const sandbox = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  XDG_CONFIG_HOME: home,
  ...extra,
});

/**
 * The home of a circuit laid out as `<mkdtemp>/work` (an origin, a checkout and a mail
 * checkout side by side): a sibling of the checkout, inside the test's own temp base.
 */
export const configHome = (repo: string): string => join(repo, "..", "xdg");

/**
 * The home of a circuit whose checkout IS the temp root. It nests inside the checkout,
 * and nothing creates it unless a machine config is written — a test that needs no
 * config leaves no directory behind, so no tree goes dirty because of the sandbox.
 */
export const configHomeInside = (repo: string): string => join(repo, "xdg");
