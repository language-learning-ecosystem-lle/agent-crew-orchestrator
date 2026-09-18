/**
 * A PACKAGE MANAGER THAT NEEDS ITS INTERPRETER — the stand that can tell thread 219's cure
 * from its absence (john's word of 2026-09-18, thread `219-restart-calls-pnpm-by-name`).
 *
 * WHAT WAS WRONG WITH THE STANDS THIS REPLACES. Four spawns of this package hand a resolved
 * tool `env: toolEnv()`, which puts the directory of `process.execPath` first on the CHILD'S
 * `PATH`; without it a `pnpm` whose first line is `#!/usr/bin/env node` dies at once with
 * `127` in any environment that has no node on it — systemd's, `sudo -i` without nvm. The
 * field took the contour down twice that way. But the stands under three of those four
 * spawns intercepted `pnpm` with a `#!/bin/sh` script, and a shell script needs no
 * interpreter from anywhere: those cases passed identically with the cure and without it.
 * A stand that cannot go red is not weaker evidence, it is evidence about something else —
 * and in this very thread the class had already come apart by call site (the restart path
 * was repaired while the levelling path stayed broken, thread 221, and no stand noticed).
 *
 * SO THE SHIM IS A REAL NODE SCRIPT, and the process under test is left with a `PATH` that
 * has no node on it. Then the shim can only run if the spawn it came from carried the
 * interpreter, which is exactly the fact under test; remove `env: toolEnv()` from the call
 * site and the shim's record is not written at all.
 *
 * THE THREE THINGS IN THE DIRECTORY, EACH LOAD-BEARING:
 *
 *   - `node` — a SYMLINK to the real binary, because the CLI spawns `process.execPath` for
 *     its own children (a daemon, a background levelling) and those must be a real node;
 *   - `pnpm` — the recording script, with `#!/usr/bin/env node` for a first line, as the
 *     box's own `pnpm` has;
 *   - `execpath.mjs` — the preload that states the two facts the stand is reproducing.
 *
 * WHY A PRELOAD AND NOT A REAL LAYOUT. `process.execPath` is `/proc/self/exe` resolved, so
 * a symlinked interpreter reports the REAL directory and the shim would never be looked at;
 * a hardlink beside it is refused on this box (`fs.protected_hardlinks`) and copying 118 MB
 * per case is a price this suite should not pay. The preload is also where the node-free
 * `PATH` is stated, and it has to be: the shell that starts `tsx` needs a node on its own
 * `PATH`, so the process under test cannot simply be launched without one.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * THE `PATH` THE PROCESS UNDER TEST IS LEFT WITH. `git` lives here and node does not — on
 * every box this package runs on node comes from nvm or a global prefix, never from
 * `/usr/bin`, which is the whole shape of the field failure.
 */
const PATH_WITHOUT_NODE = "/usr/bin:/bin";

export type BesideNodeStand = {
  /** The directory that plays "beside the node binary running this process". */
  readonly dir: string;
  /** The shim itself, as the failure lines and the choice lines print it. */
  readonly pnpm: string;
  /** The environment a spawned CLI is given on top of its own sandbox. */
  readonly env: { readonly NODE_OPTIONS: string };
};

/**
 * Builds the directory and the preload. `records` is appended one argument per line, so a
 * call that never happened and a call that died before its first line are the same empty
 * file — which is what the red looks like when the cure is taken out.
 */
export const besideNodeStand = (input: {
  /** Where to build it; created if it is not there. */
  readonly dir: string;
  /** The file the shim appends the argv it was called with to. */
  readonly records: string;
  /** Extra JS the shim runs after recording, with `args` in scope — what an install leaves. */
  readonly leaves?: string;
  /** The `PATH` to leave the process under test with; the default has git and no node. */
  readonly path?: string;
}): BesideNodeStand => {
  mkdirSync(input.dir, { recursive: true });
  const pnpm = join(input.dir, "pnpm");
  writeFileSync(
    pnpm,
    "#!/usr/bin/env node\n" +
      'const fs = require("node:fs");\n' +
      "const args = process.argv.slice(2);\n" +
      `fs.appendFileSync(${JSON.stringify(input.records)}, args.map((a) => \`\${a}\\n\`).join(""));\n` +
      `${input.leaves ?? ""}\n`,
  );
  chmodSync(pnpm, 0o755);
  const node = join(input.dir, "node");
  if (!existsSync(node)) symlinkSync(process.execPath, node);
  const preload = join(input.dir, "execpath.mjs");
  writeFileSync(
    preload,
    `process.execPath = ${JSON.stringify(node)};\n` +
      `process.env.PATH = ${JSON.stringify(input.path ?? PATH_WITHOUT_NODE)};\n`,
  );
  return { dir: input.dir, pnpm, env: { NODE_OPTIONS: `--import ${pathToFileURL(preload).href}` } };
};

/** What the shim recorded, one argument per line — empty when it never ran. */
export const besideNodeCalls = (records: string): string[] =>
  existsSync(records) ? readFileSync(records, "utf8").split("\n").filter(Boolean) : [];
