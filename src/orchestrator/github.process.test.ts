/**
 * WHAT `init github` DOES TO A DISK — the effects, not the decisions (thread
 * `019-operator-ux`, point 4; statement of work by curator of 2026-08-01, found by the
 * reviewer in the verdict on #152).
 *
 * `github.test.ts` covers the pure half in full — `keyStep`, `sshConfigStep`,
 * `readSshProbe`, `probeStep`, `githubSummary` all decide, and all are tested as
 * functions. Nothing tested the half that ACTS: `mkdirSync`, `ssh-keygen`, the append to
 * `~/.ssh/config`, the `ssh -T` probe, all of them in `initGithub` in `cli.ts`. The most
 * expensive property of the command — AN EXISTING PRIVATE KEY IS NEVER OVERWRITTEN —
 * rested on one `if (!keyThere)` there, and a future edit parting it from `keyStep` would
 * turn no test red. So each fact below is asserted against the FILE, not against the step
 * the command printed.
 *
 * Nothing here goes to the network and nothing touches the operator's own `~/.ssh`: the
 * runs get a `$HOME` inside the test's temp base, and `--no-probe` keeps `ssh` unspawned.
 * The one place a probe IS wanted (proving the "not spawned" assertion is not vacuous)
 * uses an `ssh` shim on `PATH` that only records that it ran.
 *
 * `ssh-keygen` is a real binary and is deliberately NOT stubbed — the property under test
 * is what lands on the disk. A machine without it fails the first test by name rather
 * than skipping quietly, which is what the statement of work asked for.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

/** A `$HOME` of this test's own, with the marker file the `ssh` shim writes beside it. */
const box = (): { readonly home: string; readonly marker: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-github-"));
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  return { home, marker: join(base, "ssh-was-spawned") };
};

/**
 * An `ssh` on `PATH` that spawns nothing and remembers that it was asked to. It answers
 * with silence, which `readSshProbe` reads as "no answer" — this file never judges the
 * probe's wording (that is `github.test.ts`'s work), only whether it happened at all.
 */
const shimBin = (marker: string): string => {
  const bin = mkdtempSync(join(tmpdir(), "agent-protocol-shim-"));
  const path = join(bin, "ssh");
  writeFileSync(path, `#!/bin/sh\necho spawned >> ${JSON.stringify(marker)}\n`);
  chmodSync(path, 0o755);
  return bin;
};

const run = (
  box: { readonly home: string; readonly marker: string },
  ...extra: readonly string[]
): { readonly out: string; readonly status: number | null } => {
  const { PATH = "" } = process.env;
  const done = spawnSync(TSX, [CLI, "init", "github", "--ref", "HEAD", ...extra], {
    cwd: box.home,
    encoding: "utf8",
    env: sandbox(configHomeInside(box.home), {
      HOME: box.home,
      PATH: `${shimBin(box.marker)}:${PATH}`,
    }),
  });
  return { out: `${done.stdout ?? ""}${done.stderr ?? ""}`, status: done.status };
};

const key = (home: string): string => join(home, ".ssh", "github");
const config = (home: string): string => join(home, ".ssh", "config");
const exists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};
const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8);

describe("init github --write --no-probe: what lands on the disk", () => {
  it("on an empty $HOME the pair is generated, ~/.ssh is 0700 and the private half 0600", () => {
    const { home, marker } = box();
    const said = run({ home, marker }, "--write", "--no-probe");
    // Named out loud, because the whole file rests on this binary being here: without
    // ssh-keygen the CLI throws and no key appears, and that is a finding, not a skip.
    expect(exists(key(home)), `no key was generated. The run said:\n${said.out}`).toBe(true);
    expect(exists(`${key(home)}.pub`)).toBe(true);
    expect(mode(join(home, ".ssh"))).toBe("700");
    expect(mode(key(home))).toBe("600");
    // The public half is printed for a human to paste — the grant stays a human action.
    expect(said.out).toContain("ssh-ed25519");
  });

  it("an existing private key keeps its bytes and no second one is generated", () => {
    const { home, marker } = box();
    mkdirSync(join(home, ".ssh"), { recursive: true, mode: 0o700 });
    // Both halves, because the run reads the public one to print it — a fixture with a
    // private half only would fail for a reason that is not the property under test.
    writeFileSync(key(home), "PRIVATE KEY OF THIS BOX, NOT TO BE REPLACED\n", { mode: 0o600 });
    writeFileSync(`${key(home)}.pub`, "ssh-ed25519 AAAAOLD lle-agents\n");
    const before = readFileSync(key(home));

    const said = run({ home, marker }, "--write", "--no-probe");

    expect(readFileSync(key(home)).equals(before)).toBe(true);
    expect(readFileSync(`${key(home)}.pub`, "utf8")).toBe("ssh-ed25519 AAAAOLD lle-agents\n");
    // The bytes alone would also survive a run that CALLED ssh-keygen and had it refuse
    // the overwrite prompt — an accident of another program, not this command's refusal.
    // So the run has to have succeeded, and to have said the key was kept.
    expect(said.status, said.out).toBe(0);
    expect(said.out).toContain("never regenerated");
  });

  it("a config that already carries the host block does not get a second one", () => {
    const { home, marker } = box();
    run({ home, marker }, "--write", "--no-probe");
    const once = readFileSync(config(home), "utf8");
    expect(once.match(/^Host github\.com$/gm)).toHaveLength(1);

    run({ home, marker }, "--write", "--no-probe");

    const twice = readFileSync(config(home), "utf8");
    expect(twice.match(/^Host github\.com$/gm)).toHaveLength(1);
    // Not "one Host line" by luck of the regexp: the file did not grow at all.
    expect(twice).toBe(once);
  });

  it("without --write nothing on the disk moves — no ~/.ssh, no config", () => {
    const { home, marker } = box();
    const said = run({ home, marker }, "--no-probe");
    // The sentence and the disk are asserted together: a plan that promises "~/.ssh was
    // not touched" is only worth the ref check underneath it.
    expect(said.out).toContain("~/.ssh was not touched");
    expect(exists(join(home, ".ssh"))).toBe(false);
    expect(exists(key(home))).toBe(false);
    expect(exists(config(home))).toBe(false);
  });

  it("--no-probe spawns no ssh at all, and the marker proves the shim would have caught one", () => {
    const { home, marker } = box();
    run({ home, marker }, "--write", "--no-probe");
    expect(exists(marker)).toBe(false);
    // The other half of the same fact: with the probe allowed, this very shim records
    // the spawn — so the assertion above is about the flag, not about a broken PATH.
    run({ home, marker }, "--write");
    expect(exists(marker)).toBe(true);
  });
});

describe("the fixture of every test above", () => {
  it("ssh-keygen is on this machine — its absence is a finding, not a skipped test", () => {
    // '-?' asks for the usage: it exits non-zero and writes nothing anywhere, so the
    // only thing this can fail on is the binary not being there at all.
    const found = spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" });
    expect(found.error === undefined, "ssh-keygen is not on PATH of this machine").toBe(true);
  });
});
