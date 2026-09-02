/**
 * THE INVARIANT, NOT THE SYMPTOM (thread `070-session-tmpdir-breaks-tests`).
 *
 * What broke was not a test: under the run's own `TMPDIR` every tool that opens a unix
 * socket under it died with `listen EINVAL`, and `tsx` — the loader every process test in
 * this repository is spawned through — is one such tool. A green suite proves nothing here,
 * because the suite is green whenever the box happens to sit at a short path. So the test
 * below does the thing the class is about: it BINDS A SOCKET under the value the launcher
 * would hand a session whose name is long, and it does so from a directory long enough to
 * have failed before the fix.
 *
 * IT IS A PROCESS TEST because the measurement was one: `net.createServer().listen()` is
 * the syscall that refused, and no unit over string lengths can stand in for it — the limit
 * lives in the kernel, and the reason the fix works (a symlink is resolved AFTER the
 * address is copied) is only visible to the kernel.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  dropRunTmpAlias,
  handOverRunTmp,
  RUN_TMPDIR_MAX,
  runTmpAliasPath,
  runTmpFitsSocketBudget,
  SOCKET_PATH_MAX,
} from "./run-tmp.js";

const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

/**
 * A run directory whose name is long the way a real one is — the shape that broke was
 * `<state>/sessions/<timestamp>-<role>-<thread>.tmp`, 131 characters on the role's box. The
 * base is `/tmp` so the test does not depend on where the checkout sits, and the length is
 * PADDED TO THAT NUMBER rather than inherited from wherever the suite happens to run: a
 * test that reproduces the class only on a deep box is a test that goes quiet on a shallow
 * one, which is precisely how this survived CI.
 */
const RUN_TMP_LENGTH = 131;

const longRunTmp = (): string => {
  const base = mkdtempSync(join("/tmp", "aco-070-"));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const name = "2026-09-02T10-36-15Z-dev-core-070-session-tmpdir-breaks-tests.tmp";
  const pad = "p".repeat(RUN_TMP_LENGTH - base.length - name.length - 2);
  const dir = join(base, pad, name);
  mkdirSync(dir, { recursive: true });
  expect(dir.length).toBe(RUN_TMP_LENGTH);
  expect(dir.length).toBeGreaterThan(RUN_TMPDIR_MAX);
  return dir;
};

/** Bind a unix socket at `path` and report what the kernel said. */
const bind = (path: string): Promise<{ ok: boolean; code?: string | undefined }> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.on("error", (error) =>
      resolve({ ok: false, code: (error as NodeJS.ErrnoException).code }),
    );
    server.listen(path, () => server.close(() => resolve({ ok: true })));
  });

describe("the run's own TMPDIR has room for a socket under it", () => {
  it("the limit is the kernel's and it is 108 — the number the budget is derived from", async () => {
    const base = mkdtempSync(join(tmpdir(), "aco-sun-"));
    cleanup.push(() => rmSync(base, { recursive: true, force: true }));
    const at = (length: number): string => join(base, "x".repeat(length - base.length - 1));

    await expect(bind(at(SOCKET_PATH_MAX))).resolves.toEqual({ ok: true });
    await expect(bind(at(SOCKET_PATH_MAX + 1))).resolves.toEqual({ ok: false, code: "EINVAL" });
  });

  it("a long run directory is handed a short alias, and a socket opens under it", async () => {
    const real = longRunTmp();
    const handover = handOverRunTmp(real);
    cleanup.push(() => {
      if (handover.alias) dropRunTmpAlias(handover.alias);
    });

    expect(handover.alias).toBe(runTmpAliasPath(real));
    expect(handover.handed).toBe(handover.alias);
    expect(runTmpFitsSocketBudget(handover.handed)).toBe(true);
    // THE DOOR SPEAKS: the substitution is a fact about the run, so it is in the log with
    // the number that caused it — otherwise a session sitting on a symlink cannot be told
    // from one sitting on its own directory.
    expect(handover.lines.join(" ")).toContain(`${real.length} characters`);

    // The socket the loader would have opened: `<TMPDIR>/tsx-<uid>/<pid>.pipe`.
    const sock = join(handover.handed, "tsx-1000", "1594502.pipe");
    mkdirSync(join(handover.handed, "tsx-1000"), { recursive: true });
    await expect(bind(sock)).resolves.toEqual({ ok: true });
    // …and it was born in the RUN'S directory, not in the shared `/tmp`: the alias is a
    // name, not a second place. This is what keeps thread `056` intact.
    expect(statSync(join(real, "tsx-1000")).isDirectory()).toBe(true);

    // The same path WITHOUT the fix — the real directory handed straight through — is the
    // failure this thread was opened about, so it is asserted rather than remembered.
    const unfixed = join(real, "tsx-1000", "unfixed.pipe");
    expect(unfixed.length).toBeGreaterThan(SOCKET_PATH_MAX);
    await expect(bind(unfixed)).resolves.toEqual({ ok: false, code: "EINVAL" });
  });

  it("a short run directory is handed through untouched — no alias, nothing in the shared /tmp", () => {
    const base = mkdtempSync(join("/tmp", "aco-s-"));
    cleanup.push(() => rmSync(base, { recursive: true, force: true }));
    expect(base.length).toBeLessThanOrEqual(RUN_TMPDIR_MAX);

    const handover = handOverRunTmp(base);
    expect(handover).toEqual({ handed: base, lines: [] });
  });

  it("tsx itself runs under the handed value and dies under the raw one", () => {
    const real = longRunTmp();
    const handover = handOverRunTmp(real);
    cleanup.push(() => {
      if (handover.alias) dropRunTmpAlias(handover.alias);
    });
    const script = join(real, "ok.ts");
    execFileSync("node", [
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(script)}, 'console.log("ran")')`,
    ]);

    const run = (tmp: string): { code: number; out: string } => {
      try {
        return {
          code: 0,
          out: execFileSync(TSX, [script], {
            env: { ...process.env, TMPDIR: tmp },
            encoding: "utf8",
          }),
        };
      } catch (error) {
        const failure = error as { status?: number; stderr?: string; stdout?: string };
        return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
      }
    };

    const fixed = run(handover.handed);
    expect(fixed.out).toContain("ran");
    expect(fixed.code).toBe(0);

    const raw = run(real);
    expect(raw.out).toContain("EINVAL");
  });
});
