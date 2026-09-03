/**
 * THE VENDOR'S OWN DOOR, RUN FOR FREE (thread `058-launch-prompt-mail-form-sandbox`).
 *
 * `codex sandbox` runs ANY command under the same confinement `codex exec --sandbox
 * read-only` puts on a session, and it calls no model: the whole file below costs nothing
 * but seconds. That is what makes it a test rather than a live acceptance run — the
 * defect it pins was found twice in the field at the price of a whole role slot each time
 * (thread `083` at 18:19:25Z, run 10 of this thread at 19:08:26Z, both `ENOENT: mkdir
 * '<TMPDIR>/tsx-1000'`), and neither run answered which of the two levers fixed it.
 *
 * WHAT IT MEASURES, in one line: a loader that has to CREATE its cache directory under a
 * read-only filesystem dies before the CLI it was importing ever starts, and the
 * environment this package hands a held run is what keeps it alive. Both arms are here on
 * purpose — the failing one is the reason the fix exists, and the day a new `codex` or a
 * new `tsx` makes it pass, this file says so by name instead of leaving a variable nobody
 * can justify removing.
 *
 * SKIPPED, NOT RED, WHERE THE BINARY IS ABSENT — and skipped WITH THE REASON PRINTED. The
 * runner has no `codex`; a suite that reddened there would teach everyone to ignore it,
 * and this measurement is about a box, not about the package's logic.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { codexReadOnlyEnv } from "./codex.js";

/** The repository's own tree — `tsx` is resolved from here, as a session's command is. */
const REPO = fileURLToPath(new URL("../../../..", import.meta.url));

/** The vendor binary and the mode word, exactly as {@link CODEX_READ_ONLY_ARGV} spells it. */
const CODEX = "codex";
const SANDBOX_ARGV = [
  "sandbox",
  "-c",
  'sandbox_mode="read-only"',
  "--",
  "/usr/bin/env",
  "node",
  "--import",
  "tsx",
];

/**
 * WHY THE MODE IS SET BY KEY HERE AND BY ARGV IN A RUN — the seam this file does not
 * close, said out loud rather than discovered later. `codex sandbox` takes the mode as a
 * config override; a raised session gets `--sandbox read-only` on the command line
 * (`CODEX_READ_ONLY_ARGV`). One vendor, one name of one mode, and the refusal below
 * reproduces the field's stack frame word for word — but "the same thing" is here
 * supported by the outcome matching, not by a reading of the vendor's code. The live
 * acceptance of §5, which goes through a real `codex exec`, is what closes it.
 */
const codexHere = (): boolean => spawnSync(CODEX, ["--version"], { encoding: "utf8" }).status === 0;

/**
 * A directory nobody has been in yet — which is what every run gets since #172 — AND
 * REMOVED WHEN THE CASE ENDS. A test measuring the price of leftovers in a shared place
 * (S26) may not leave any: on this box the suite is run with `TMPDIR=/tmp` by hand, so
 * every case would otherwise add an entry belonging to nobody.
 */
const made: string[] = [];
const freshTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aco-sandbox-loader."));
  mkdirSync(dir, { recursive: true });
  made.push(dir);
  return dir;
};

/**
 * THE MARKER IS AN EXIT CODE AND NOT A PRINTED LINE, and that is a measurement rather than
 * a taste: `codex sandbox` does not relay a child's stdout into a PIPE (measured on this
 * box — the same command prints under an inherited terminal and gives an empty `stdout`
 * through `spawnSync`), while the exit status travels intact both ways. A crash still
 * arrives on stderr, which is why the failing arm below can also read the reason.
 */
const RAN = 42;

/** A trivial TypeScript file: if the loader starts at all, this exit code comes back. */
const script = (dir: string): string => {
  const path = join(dir, "probe.ts");
  writeFileSync(path, `const code: number = ${RAN};\nprocess.exit(code);\n`);
  return path;
};

const underSandbox = (
  tmp: string,
  extra: NodeJS.ProcessEnv,
): { status: number | null; said: string } => {
  const result = spawnSync(CODEX, [...SANDBOX_ARGV, script(tmp)], {
    cwd: REPO,
    encoding: "utf8",
    // TMPDIR is set LAST for the same reason the supervisor sets it last: on Linux it
    // outranks whatever the inherited environment carries.
    env: { ...process.env, ...extra, TMPDIR: tmp },
  });
  return { status: result.status, said: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

describe("the loader of a run held by the read-only sandbox (thread 058)", () => {
  afterAll(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("dies on a FRESH TMPDIR when nothing is handed to it — the defect, reproduced", (ctx) => {
    if (!codexHere()) {
      ctx.skip("no `codex` binary on this box — the vendor's sandbox cannot be entered here");
      return;
    }
    const { status, said } = underSandbox(freshTmp(), {});

    // The field's refusal, to the frame: `mkdirSync` of `<TMPDIR>/tsx-<uid>`, ENOENT and
    // not EACCES — under this sandbox the filesystem is read-only WHOLE, so a path that
    // does not exist cannot be made rather than being forbidden.
    expect(status).not.toBe(RAN);
    expect(said).toContain("ENOENT");
    expect(said).toMatch(/mkdir .*tsx-\d+/);
  }, 120_000);

  it("runs when handed the environment the supervisor gives a held run — the fix", (ctx) => {
    if (!codexHere()) {
      ctx.skip("no `codex` binary on this box — the vendor's sandbox cannot be entered here");
      return;
    }
    // NOT the literal `TSX_DISABLE_CACHE=1` typed a second time: the value under test is
    // the one the spawn site actually hands, read from the same function. A test that
    // retypes the string would keep passing on the day the package stopped setting it.
    const handed = codexReadOnlyEnv({
      agent: { kind: "codex", toolsHeldBy: "sandbox-read-only" },
    } as never);
    expect(handed).not.toEqual({});

    const { status, said } = underSandbox(freshTmp(), handed);

    // The loader started and the file it was importing ran to its own end — which is the
    // whole claim: the first command of a held role no longer dies before its CLI exists.
    expect(status).toBe(RAN);
    expect(said).not.toContain("ENOENT");
  }, 120_000);
});
