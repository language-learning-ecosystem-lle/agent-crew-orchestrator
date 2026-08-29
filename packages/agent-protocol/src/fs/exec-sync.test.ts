/**
 * THE SANDBOX ITSELF IS NOT ON CI — there is no codex, no apparmor profile and no
 * account on a runner, so no check here can hold this against a regression by
 * reproducing the confinement. What IS held is the decision the confinement exposed:
 * `verdictOf` gets the exact contradictory pair measured under `codex exec --sandbox
 * read-only` on 2026-08-28 (`error` set AND `status: 0` AND stdout captured), as data.
 */
import { describe, expect, it } from "vitest";
import { execFileSyncByExit, SyncRunError, verdictOf } from "./exec-sync.js";

describe("verdictOf", () => {
  it("trusts the child's exit code over the parent's errno — the measured sandbox pair", () => {
    const verdict = verdictOf({
      error: new Error("spawnSync git EPERM"),
      status: 0,
      signal: null,
      stdout: "/home/lle/projects/agent-crew-orchestrator/.worktrees/comms\n",
      stderr: "",
    });
    expect(verdict).toEqual({
      ok: true,
      stdout: "/home/lle/projects/agent-crew-orchestrator/.worktrees/comms\n",
    });
  });

  it("still fails when the child never ran — `status: null` is what 'could not spawn' means", () => {
    const verdict = verdictOf({
      error: new Error("spawnSync git ENOENT"),
      status: null,
      signal: null,
      stdout: null,
      stderr: null,
    });
    expect(verdict).toEqual({
      ok: false,
      ran: false,
      status: null,
      reason: "spawnSync git ENOENT",
    });
  });

  it("fails on a non-zero exit and carries git's own stderr as the reason", () => {
    const verdict = verdictOf({
      status: 128,
      signal: null,
      stdout: "",
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
    });
    expect(verdict).toEqual({
      ok: false,
      ran: true,
      status: 128,
      reason:
        "exited with code 128: fatal: not a git repository (or any of the parent directories): .git",
    });
  });

  it("fails on a signal, and says which one", () => {
    expect(verdictOf({ status: null, signal: "SIGKILL", stdout: "", stderr: "" })).toEqual({
      ok: false,
      ran: true,
      status: null,
      reason: "killed by SIGKILL",
    });
  });

  it("names no reason of its own when there is neither an error nor output to quote", () => {
    expect(verdictOf({ status: null, signal: null, stdout: null, stderr: null })).toEqual({
      ok: false,
      ran: false,
      status: null,
      reason: "the child process did not start",
    });
  });
});

describe("execFileSyncByExit", () => {
  it("returns the child's stdout", () => {
    expect(execFileSyncByExit("/bin/echo", ["hi"])).toBe("hi\n");
  });

  it("throws a SyncRunError that tells 'never started' apart from 'ran and failed'", () => {
    let didNotStart: unknown;
    try {
      execFileSyncByExit("agent-protocol-no-such-binary", ["--version"]);
    } catch (error) {
      didNotStart = error;
    }
    expect(didNotStart).toBeInstanceOf(SyncRunError);
    expect((didNotStart as SyncRunError).ran).toBe(false);
    expect((didNotStart as SyncRunError).message).toContain("ENOENT");

    let ranAndFailed: unknown;
    try {
      execFileSyncByExit("/bin/sh", ["-c", "echo boom >&2; exit 3"]);
    } catch (error) {
      ranAndFailed = error;
    }
    expect(ranAndFailed).toBeInstanceOf(SyncRunError);
    expect((ranAndFailed as SyncRunError).ran).toBe(true);
    expect((ranAndFailed as SyncRunError).status).toBe(3);
    expect((ranAndFailed as SyncRunError).message).toContain("exited with code 3: boom");
  });
});
