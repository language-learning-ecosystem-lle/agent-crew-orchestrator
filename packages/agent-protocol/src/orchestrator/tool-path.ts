/**
 * WHERE THE RESTART'S TOOLS LIVE, AND WHAT IT SAYS WHEN ONE OF THEM IS NOT THERE
 * (thread 219, statement of curator from the field failure of 2026-09-17 12:23Z).
 *
 * THE FIELD CASE, MEASURED. `orchestrator restart --pull` on the `hetzner` instance
 * stopped the daemon, pulled the tree, and then printed `pnpm install FAILED (code ?) —
 * nothing was raised`. The contour lay down for two minutes. The install itself was
 * healthy: the same command, same user, same second, with `PATH` carrying the nvm bin
 * directory, answered `Already up to date. Done in 556ms`. Nothing was wrong with the
 * project, the lockfile or the store — `pnpm` was simply not found, because the restart
 * asked for it BY NAME and the caller's `PATH` did not have it.
 *
 * WHY THAT IS AN ASYMMETRY AND NOT BAD LUCK. The same chain calls `node` through a path
 * it knows (the launch profile names the interpreter explicitly), and that call worked in
 * the very same environment. One half of the chain does not depend on the caller's `PATH`
 * and the other half does; the half that does is the half that took the box down.
 *
 * THE CURE, AND WHY IT IS THIS ONE. The node binary running this process is a fact the
 * process cannot be wrong about (`process.execPath`), and in every layout this circuit is
 * installed in — nvm, corepack, a system node with a global prefix — the package manager
 * is installed BESIDE IT, in the same `bin` directory. So the first place looked for a
 * tool is that directory, and `PATH` stays as the fallback rather than the premise. A
 * machine-config key would have been the other answer and was not taken: a key is a power
 * document, it has to be set on every box before the box can restart, and a box that has
 * not set it is exactly the box this defect kills.
 *
 * WHY IT DOES NOT REFUSE WHEN IT FINDS NOTHING. Resolution is an improvement of the happy
 * path, never a new door: when neither place holds the tool, the bare name is handed to
 * the spawn exactly as before. The shell is not the only thing that can find an
 * executable, and a resolver that refused on its own opinion would turn an unusual but
 * working box into a box that cannot restart at all. What the empty answer buys is the
 * DIAGNOSIS: the list of places looked at travels into the failure line.
 *
 * AND THE FAILURE LINE NAMES ITSELF (П-2 of the statement, the class fixed in thread
 * 212). `FAILED (code ?)` conflated the two endings that need opposite repairs: a process
 * that ran and returned non-zero (read its output, fix the project) and a process that
 * NEVER STARTED (there is no such executable — install it, or name it where it is). The
 * `?` in that line was not an exit code at all; it was the absence of one. Here the two
 * are different sentences, and the second one carries the paths that were tried.
 */

import { dirname, join } from "node:path";

/** Where a tool was found — the premise the run then stands on. */
export type ToolSource =
  /** Beside the node binary running this process — independent of the caller's `PATH`. */
  | "beside-node"
  /** On the caller's `PATH` — works, but depends on who typed the command. */
  | "path"
  /** Nowhere this module can see; the bare name is handed on and may still work. */
  | "unresolved";

export type ResolvedTool = {
  /** What to spawn: an absolute path when one was found, the bare name otherwise. */
  readonly command: string;
  readonly source: ToolSource;
  /** Every candidate examined, in the order they were examined. */
  readonly looked: readonly string[];
};

/**
 * THE ORDER IS THE WHOLE POINT: beside the interpreter first, `PATH` second. Reversing it
 * would make the resolution agree with the caller's environment whenever that environment
 * has an opinion — which is the behaviour that failed, merely with one more place to look
 * after it failed.
 *
 * Pure: the disk is asked through `isExecutable`, so the decision is testable without one.
 */
export const resolveTool = (input: {
  /** The tool as it is typed today — `pnpm`, `git`. */
  readonly name: string;
  /** `process.execPath` — the node binary running this process. */
  readonly nodePath: string;
  /** `process.env.PATH`, verbatim; empty or absent is a legitimate answer. */
  readonly path?: string | undefined;
  readonly isExecutable: (candidate: string) => boolean;
}): ResolvedTool => {
  const looked: string[] = [];
  const consider = (candidate: string): boolean => {
    if (looked.includes(candidate)) return false;
    looked.push(candidate);
    return input.isExecutable(candidate);
  };
  const beside = join(dirname(input.nodePath), input.name);
  if (consider(beside)) return { command: beside, source: "beside-node", looked };
  for (const entry of (input.path ?? "").split(":")) {
    // An empty entry means the current directory to a shell; a tool resolved that way
    // would depend on where the restart was typed from, which is the same defect again.
    if (entry === "") continue;
    const candidate = join(entry, input.name);
    if (consider(candidate)) return { command: candidate, source: "path", looked };
  }
  return { command: input.name, source: "unresolved", looked };
};

/**
 * THE SECOND HALF OF THE SAME PREMISE, AND THE FIELD MEASURED IT (thread 219, П-1 of the
 * statement of 2026-09-17 15:49Z). The resolution above got the restart as far as running
 * the right file and no further:
 *
 *     pnpm install …, running '/home/…/v24.18.0/bin/pnpm' (beside this node binary)
 *     pnpm install FAILED — '…/pnpm' ran and exited 127:
 *       /usr/bin/env: 'node': No such file or directory
 *
 * `pnpm` in every layout this circuit is installed in is not a binary — it is a SCRIPT
 * whose first line is `#!/usr/bin/env node`. Resolving the path to it settles which file
 * the kernel opens; it settles nothing about whether that file's INTERPRETER can be found,
 * and the interpreter is looked up by name on the `PATH` OF THE SPAWNED PROCESS. Inherit
 * the environment of a caller with no node on it — a systemd unit, `sudo -i` without nvm —
 * and the tool starts and dies at once. The contour went down for the second time this way.
 *
 * SO THE CHILD IS GIVEN THE INTERPRETER IT NEEDS, from the same fact the resolution stands
 * on: the directory of `process.execPath` goes FIRST on the `PATH` the tool is spawned
 * with. Not "if it is missing" — first, because a `PATH` that already names some other node
 * would make the script run under an interpreter that is not the one running the circuit,
 * and a package manager under a foreign node is the skew this package spends its doors on.
 *
 * WHAT IT IS NOT. Not a new door (nothing is refused), not a machine-config key (the same
 * argument as above — a key is a power document and the box that has not set it is the box
 * this defect kills), and not a change of `PATH` anywhere but in the environment handed to
 * one spawn: the caller's own `process.env` is never written.
 */
export const pathForSpawnedTool = (input: {
  /** `process.execPath` — the node binary running this process. */
  readonly nodePath: string;
  /** The `PATH` the caller inherited; empty or absent is a legitimate answer. */
  readonly path?: string | undefined;
}): string => {
  const beside = dirname(input.nodePath);
  const rest = (input.path ?? "").split(":").filter((entry) => entry !== "" && entry !== beside);
  return [beside, ...rest].join(":");
};

/**
 * The same, as the environment a spawn is actually given. The caller hands in its own
 * environment verbatim and receives a copy — every other variable travels untouched,
 * because a tool that suddenly loses `HOME` or the store's own settings would be a second
 * defect bought with the cure for the first.
 */
export const environmentForSpawnedTool = <T extends Record<string, string | undefined>>(input: {
  readonly nodePath: string;
  readonly env: T;
}): T & { readonly PATH: string } => ({
  ...input.env,
  PATH: pathForSpawnedTool({ nodePath: input.nodePath, path: input.env["PATH"] }),
});

/**
 * WHOSE ABSENCE THE 127 IS ABOUT (thread 219, П-2). `127` from a shell means "command not
 * found", and a reader who has just been told the tool's full path reads it as a lie about
 * that path — they then go and check a path that is already right. The line that says which
 * name was actually missing is the difference between that dead end and the repair, and the
 * name is in the tool's own complaint: `/usr/bin/env: 'node': No such file or directory`.
 *
 * Read as TEXT and nothing more: `undefined` when the complaint does not say it, so the
 * general sentence stands. Both spellings are matched because both are in the field — GNU
 * coreutils quotes the name, busybox does not.
 */
export const missingInterpreter = (said: string): string | undefined =>
  /(?:^|[\s/])env: (?:'([^']+)'|([^\s:]+)): No such file or directory/
    .exec(said)
    ?.slice(1)
    .find((group) => group !== undefined);

/** How many candidates the failure line prints before it stops counting them out. */
const LOOKED_SHOWN = 6;

/** How much of a tool's own complaint is carried into the failure line. */
const SAID_CHARS = 400;

/**
 * The two endings that used to be one. `status` is the discriminator and it is the honest
 * one: a number means a process ran to completion and chose that number.
 */
export type ToolFailure =
  | { readonly kind: "exited"; readonly status: number; readonly said: string }
  | { readonly kind: "signalled"; readonly signal: string; readonly said: string }
  /** No process: the executable was not there, or the spawn itself refused. */
  | { readonly kind: "unspawned"; readonly code: string; readonly message: string };

/**
 * What `execFileSync`/`spawnSync` actually hands back, read WITHOUT deciding anything
 * about `PATH`: `status` is a number only when a process existed to return it, and an
 * `ENOENT` here is the spawn's, never the tool's.
 */
export const classifyToolFailure = (error: {
  readonly status?: number | null | undefined;
  readonly signal?: string | null | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly stderr?: string | undefined;
  readonly stdout?: string | undefined;
}): ToolFailure => {
  const said = `${error.stderr ?? ""}${error.stdout ?? ""}`.replaceAll(/\s+/g, " ").trim();
  if (typeof error.status === "number") return { kind: "exited", status: error.status, said };
  if (typeof error.signal === "string" && error.signal !== "")
    return { kind: "signalled", signal: error.signal, said };
  return {
    kind: "unspawned",
    code: error.code ?? "?",
    message: (error.message ?? "").replaceAll(/\s+/g, " ").trim(),
  };
};

/** The places tried, as the failure line prints them — bounded, because `PATH` is not. */
const describeLooked = (looked: readonly string[]): string =>
  looked.length === 0
    ? "nowhere — no candidate was even formed"
    : `${looked.slice(0, LOOKED_SHOWN).join(", ")}${
        looked.length > LOOKED_SHOWN ? ` (and ${looked.length - LOOKED_SHOWN} more)` : ""
      }`;

/**
 * THE CAUSE, IN ONE SENTENCE THAT SAYS WHICH REPAIR IT WANTS. Both readers of a failed
 * step — the log line and the sentence published into the mail — are built from this one
 * string, so they cannot come to disagree about what happened.
 */
export const describeToolFailure = (input: {
  readonly name: string;
  readonly resolution: ResolvedTool;
  readonly failure: ToolFailure;
}): string => {
  const tail = (said: string): string =>
    said === "" ? " — it printed nothing" : `: ${said.slice(-SAID_CHARS)}`;
  if (input.failure.kind === "exited") {
    // THE THIRD ENDING, AND IT WANTS A THIRD REPAIR (thread 219, П-2). "The tool exited
    // 127" is true and sends the reader after the path to the tool, which the line above it
    // has just printed in full and which is already right. What is missing is the
    // interpreter of a script, and it is missing from the environment of the CHILD.
    const interpreter =
      input.failure.status === 127 ? missingInterpreter(input.failure.said) : undefined;
    if (interpreter !== undefined)
      return `'${input.resolution.command}' ran and exited 127, but what was NOT FOUND is its interpreter '${interpreter}', not '${input.name}' itself — the path above is already right. '${input.name}' is a script whose first line asks for '${interpreter}' by name, and the environment it was spawned with has no '${interpreter}' on its PATH. The repair is the PATH OF THE SPAWNED PROCESS (put the directory of '${interpreter}' first on it), never the path to '${input.name}'${tail(input.failure.said)}`;
    return `'${input.resolution.command}' ran and exited ${input.failure.status}${tail(input.failure.said)}`;
  }
  if (input.failure.kind === "signalled")
    return `'${input.resolution.command}' ran and was killed by ${input.failure.signal}${tail(input.failure.said)}`;
  return `NO PROCESS RAN — there is no executable '${input.name}' to start (${input.failure.code}${
    input.failure.message === "" ? "" : `: ${input.failure.message}`
  }). Looked beside this node binary first, then on PATH: ${describeLooked(input.resolution.looked)}. This is NOT a failure of the project — install '${input.name}' beside the node that runs the circuit, or put it on the PATH of the user the circuit runs as`;
};

/**
 * The step about to run, with the premise it stands on said out loud. A restart that
 * worked "because the caller happened to have the right PATH" and one that works by
 * construction read identically in a log otherwise — and the difference between them is
 * the two minutes this contour spent down.
 */
export const describeToolChoice = (resolution: ResolvedTool): string =>
  resolution.source === "beside-node"
    ? `'${resolution.command}' (beside this node binary)`
    : resolution.source === "path"
      ? `'${resolution.command}' (from PATH — nothing beside this node binary)`
      : `'${resolution.command}' BY NAME — it is nowhere this process can see (looked: ${describeLooked(resolution.looked)}), so the spawn is left to try`;
