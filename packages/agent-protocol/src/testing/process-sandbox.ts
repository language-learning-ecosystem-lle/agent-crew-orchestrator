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
import { basename, join } from "node:path";

import { PLATFORM_TOKEN_KEYS } from "../config/credentials.js";
import { LAUNCH_ENV } from "../orchestrator/launch.js";
import { BOX_URL_KEY, CIRCUIT_URL_KEY } from "../orchestrator/watchdog.js";

/**
 * THE MONITORS OF THE BOX ARE THE BOX'S AND NOT A LAUNCH'S (thread `071`, measured
 * 2026-09-02). `loadSecrets` merges the secrets FILE over `process.env`, so a key the file
 * does not carry is still answered by the ambient environment — and on the box that runs
 * the circuit `HEALTHCHECKS_CIRCUIT_URL_HETZNER` is set STANDINGLY, because that is where
 * the live daemon's own monitor is named.
 *
 * Measured on `daemon.watchdog.process.test.ts:505`, the case whose whole claim is "a named
 * instance with only the BARE key beats nothing": the test writes a secrets file with the
 * bare key alone, the daemon read the box's suffixed key out of the inherited environment,
 * and the banner said `circuit watchdog ON — … 'HEALTHCHECKS_CIRCUIT_URL_HETZNER'` instead
 * of OFF. Red on the box, green on the runner (which has no monitors at all) — the same
 * direction as the three variables above, and the same loss: a role whose local run is red
 * for a reason of the stand stops being able to tell its own regression from the box's.
 *
 * AND THE SECOND HALF IS WORSE THAN A RED TEST. With the watchdog ON on the ambient URL,
 * the daemon that the test spawned beat the LIVE circuit's monitor — a suite run silencing
 * the production alarm for a daemon it is not.
 *
 * By prefix rather than by the two names, because the key of a named instance IS the bare
 * one with a suffix (`resolveWatchdog`), and every instance a box gains adds another.
 */
const boxMonitor = (name: string): boolean =>
  name === BOX_URL_KEY || name === CIRCUIT_URL_KEY || name.startsWith(`${CIRCUIT_URL_KEY}_`);

/**
 * THE LOGIN OF THE BOX IS THE BOX'S AND NOT A LAUNCH'S (thread `071`, 2026-09-02) — the
 * same mechanism as the monitors above with a wider blast radius. `config/credentials.ts`
 * answers a token out of the ambient environment whenever the secrets file does not carry
 * one (and, by rule 1 of that door, an already-set variable is never overwritten), so a
 * process test that reaches the credentials door on this box reaches it with the OPERATOR'S
 * OWN `GH_TOKEN` — which means a spawned CLI is logged in to the live GitHub, and a test
 * whose whole claim is "no credential anywhere → the refusal names the file" measures the
 * shell instead of the package.
 *
 * IT WAS ALREADY BEING SUBTRACTED, ONCE PER FILE, WHICH IS THE DEFECT AND NOT THE FIX:
 * `merge/gate.process.test.ts` and `orchestrator/force-stop-delivery.process.test.ts` each
 * destructured the two names out of the sandbox by hand, and that is exactly the copied
 * convention the head of this file is about — four files independently forgot one line, and
 * the third file to reach this door would have forgotten it too. Green today, and green by
 * accident twice.
 *
 * BY THE NAME OF THE DOOR, not by a list typed here: `PLATFORM_TOKEN_KEYS` is what `gh`
 * itself accepts as a login, so the day that list grows a third name the sandbox grows with
 * it instead of going stale silently.
 *
 * THE TELEGRAM TOKEN IS DELIBERATELY NOT HERE. `TELEGRAM_BOT_TOKEN` is ambient on this box
 * too and reaches a launch by the same merge, but no door of THIS package reads it: the core
 * knows a transport module named in the config, never a vendor, and the only constant for
 * that name lives in `transport-telegram` — a package the core must not import, since the
 * boundary is the point of splitting it off. Subtracting it here would mean copying a
 * foreign name into the core, which is the stale copy this file exists to prevent, and it
 * would buy nothing measured: the one process test that touches it writes the value into
 * the secrets FILE, and the file wins over the environment (`loadSecrets`).
 */
const platformToken = (name: string): boolean =>
  (PLATFORM_TOKEN_KEYS as readonly string[]).includes(name);

/**
 * The environment of one CLI launch: the ambient one, with the config home replaced by
 * a directory the test owns. `extra` goes last — a test that also passes provenance or
 * a session file keeps saying so.
 *
 * `CLAUDE_CONFIG_DIR` IS DROPPED, for the same reason and by the same evidence as the
 * config home above (thread 055, 2026-08-07). The variable became ambient on the
 * operator's box the day a role was put on a second subscription: the session running
 * the suite carries it, so a spawned CLI inherits it, so a child of THAT child sees it
 * — and the one test whose whole claim is "the role names no account → the variable is
 * not set AT ALL" measured the operator's shell instead of the package. It went red on
 * the box and stayed green on the runner (which exports nothing), which is precisely
 * the direction that makes a local run stop meaning anything.
 *
 * A test that is ABOUT inheritance passes the value through `extra` and keeps saying so
 * in its own words — that is the difference between a premise and an ambient accident.
 *
 * THE WHOLE LAUNCH CHANNEL GOES THE SAME WAY (thread 015, 2026-08-19), and by name of
 * the contract rather than by a list typed here: every variable of `LAUNCH_ENV` is what
 * the SUPERVISOR puts into a raised session, so on the box where the circuit runs the
 * suite they are all ambient and on a runner not one of them exists. That is the same
 * direction as the two above — green on the box, red on the runner — and it stopped
 * being theoretical the day this file was touched: a process test that did not pass
 * `--worker` read `AGENT_PROTOCOL_WORKER` out of the session running the suite, went
 * green locally three times, and failed three cases on the runner at the door that
 * requires it.
 *
 * Derived from `LAUNCH_ENV` rather than spelled out because the channel grows: the
 * deadline and the wait ceiling joined it after the first two variables, and a copy of
 * their names here would have gone stale silently — which is exactly the failure this
 * whole file exists to prevent.
 */
export const sandbox = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  // `INVOCATION_ID` GOES THE SAME WAY AND FOR A SHARPER REASON (thread 003, 2026-08-18):
  // systemd sets it for every process under a unit, and a raised session inherits it, so a
  // test suite run by the circuit itself would hand every daemon it raises the identity of
  // a supervisor that is not supervising IT. Since thread 003 that variable DECIDES a
  // behaviour (`selfRestartForm`: repair in place and leave, versus spawn a child), which
  // means the suite would measure one form on a developer's terminal and the other on the
  // box — and it did, the minute the flag was read: two cases of this package's own
  // process tests flipped. A sandbox inherits the ambient environment for convenience; the
  // two variables that would make it a DIFFERENT BOX are removed by name.
  const { CLAUDE_CONFIG_DIR: _ambient, INVOCATION_ID: _supervisor, ...ambient } = process.env;
  for (const name of Object.values(LAUNCH_ENV)) delete ambient[name];
  for (const name of Object.keys(ambient))
    if (boxMonitor(name) || platformToken(name)) delete ambient[name];
  return {
    ...ambient,
    XDG_CONFIG_HOME: home,
    ...extra,
  };
};

/**
 * The home of a circuit laid out as `<mkdtemp>/work` (an origin, a checkout and a mail
 * checkout side by side): a sibling of the checkout, NAMED AFTER IT.
 *
 * The name is the checkout's own because a fixed one ("xdg") is only unique while the
 * checkout sits inside a temp base of the test's own. Half the callers pass a checkout
 * that IS an `mkdtemp` root, and for those the sibling landed on `<tmpdir>/xdg` — one
 * path shared by every run of the suite AND BY EVERY USER OF THE BOX. It stopped being
 * theoretical on 2026-08-02: the self-hosted runner (user `runner`) and the operator
 * (user `lle`) live on the same machine, the runner created `/tmp/xdg` first at mode
 * 0755, and every local run afterwards died with `EACCES` on it — which reads as "the
 * package is red" and is nothing of the kind. Two concurrent runs of ONE user would
 * have stomped each other's machine config just as quietly.
 *
 * Deriving from the checkout puts the guarantee where `mkdtemp` already gives it: the
 * checkout is unique, so the home beside it is too, wherever the caller laid it out.
 */
export const configHome = (repo: string): string => join(repo, "..", `${basename(repo)}-xdg`);

/**
 * The home of a circuit whose checkout IS the temp root. It nests inside the checkout,
 * and nothing creates it unless a machine config is written — a test that needs no
 * config leaves no directory behind, so no tree goes dirty because of the sandbox.
 */
export const configHomeInside = (repo: string): string => join(repo, "xdg");
