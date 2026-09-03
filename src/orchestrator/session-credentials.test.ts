/**
 * THE ENVIRONMENT OF A RAISED SESSION, on the record (thread `065`, the last mile).
 *
 * The three rules of the door itself are held by `config/credentials.test.ts`. What is
 * asked HERE is the thing the session layer adds and the command layer never had: the
 * environment a supervisor composes for a child agent binary, and the LINE it writes about
 * it into a journal every role of the circuit can read.
 *
 * The composition is asserted through `platformEnvFrom` with a session-shaped base
 * environment rather than through a second copy of the rules: the launcher's whole change
 * is that it hands the child `platform.env` instead of the inherited one, so a unit that
 * re-implemented the merge would be green about code nobody runs. What cannot be asked of a
 * pure function at all — whether the child PROCESS receives it — is the process test beside
 * this file.
 */
import { describe, expect, it } from "vitest";

import { platformEnvFrom } from "../config/credentials.js";
import { sessionCredentialLines } from "./launch.js";

const SECRET = "ghp_never_in_a_journal_0123456789";

const reader =
  (files: Record<string, string>) =>
  (path: string): { readonly raw: string } | { readonly error: NodeJS.ErrnoException } => {
    const raw = files[path];
    if (raw === undefined) {
      const error = new Error(
        `ENOENT: no such file or directory, open '${path}'`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return { error };
    }
    if (raw === "<denied>") {
      const error = new Error(`EACCES: permission denied, open '${path}'`) as NodeJS.ErrnoException;
      error.code = "EACCES";
      return { error };
    }
    return { raw };
  };

/** The environment a supervisor starts from: the daemon's own, plus the project preamble. */
const INHERITED = { PATH: "/usr/bin", HOME: "/home/lle", AGENT_PROTOCOL_WORKER: "claude-code" };

const SECRETS = "/home/lle/.config/agent-protocol/secrets.aco.env";
const CONFIG = "/home/lle/.config/agent-protocol/instances/hetzner.json";

const sessionEnv = (input: {
  readonly env: NodeJS.ProcessEnv;
  readonly files: Record<string, string>;
  readonly secretsPath?: string | null;
}): ReturnType<typeof platformEnvFrom> =>
  platformEnvFrom({
    secretsPath: input.secretsPath === undefined ? SECRETS : input.secretsPath,
    configPath: CONFIG,
    env: input.env,
    read: reader(input.files),
  });

describe("the environment a raised session is handed (thread 065)", () => {
  it("the token of the instance reaches the child, beside everything it inherited", () => {
    const answer = sessionEnv({
      env: INHERITED,
      files: { [SECRETS]: `GH_TOKEN=${SECRET}\n` },
    });

    expect(answer.env.GH_TOKEN).toBe(SECRET);
    // The daemon's own environment is not replaced by the file — the session still gets
    // its `PATH`, its `HOME` and the launch contract composed over this.
    expect(answer.env.PATH).toBe("/usr/bin");
    expect(answer.env.AGENT_PROTOCOL_WORKER).toBe("claude-code");
    expect(answer.token).toEqual({ key: "GH_TOKEN", from: "file" });
  });

  it("…and git can use it without a file on the box: the helper travels in the environment", () => {
    // The half that is NOT `gh`: a role's `git push` is what died with `could not read
    // Username` on 2026-09-03, and a token in `GH_TOKEN` alone would not have fixed it.
    const answer = sessionEnv({
      env: INHERITED,
      files: { [SECRETS]: `GH_TOKEN=${SECRET}\n` },
    });

    expect(answer.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(answer.env.GIT_CONFIG_KEY_0).toBe("credential.https://github.com.helper");
    // The helper reads the variable, so the secret is in the environment and in no
    // configuration value — this is the one string of the composition a `git config
    // --list` inside the session would print.
    expect(answer.env.GIT_CONFIG_VALUE_0).toContain("$GH_TOKEN");
    expect(answer.env.GIT_CONFIG_VALUE_0).not.toContain(SECRET);
  });

  it("a token the caller already exported is NOT overwritten by the circuit's file", () => {
    // The operator debugging a run and john standing in the tree by hand are the same
    // path, and a supervisor that silently won over them would make a deliberate
    // substitution inert.
    const answer = sessionEnv({
      env: { ...INHERITED, GH_TOKEN: "exported-by-the-caller" },
      files: { [SECRETS]: `GH_TOKEN=${SECRET}\n` },
    });

    expect(answer.env.GH_TOKEN).toBe("exported-by-the-caller");
    expect(answer.token).toEqual({ key: "GH_TOKEN", from: "environment" });
  });
});

describe("what the run's own log says about it (thread 065)", () => {
  it("says the file, its NAMES and whose token won — and no value of any of them", () => {
    const answer = sessionEnv({
      env: INHERITED,
      files: { [SECRETS]: `GH_TOKEN=${SECRET}\nTELEGRAM_BOT_TOKEN=t-42\n` },
    });
    const said = sessionCredentialLines(answer).join("\n");

    expect(said).toContain(SECRETS);
    expect(said).toContain("GH_TOKEN");
    expect(said).toContain("TELEGRAM_BOT_TOKEN");
    expect(said).toContain("the secrets file");
    expect(said).not.toContain(SECRET);
    expect(said).not.toContain("t-42");
    // Nothing is wrong, so nothing is said twice: one line, not a line plus a refusal.
    expect(sessionCredentialLines(answer)).toHaveLength(1);
  });

  it("the file is absent → the refusal names THAT file and the config that named it", () => {
    const said = sessionCredentialLines(sessionEnv({ env: INHERITED, files: {} })).join("\n");

    expect(said).toContain(SECRETS);
    expect(said).toContain(CONFIG);
    expect(said).toContain("does not exist");
  });

  it("the file is unreadable → a DIFFERENT line, with the reason the box gave", () => {
    const said = sessionCredentialLines(
      sessionEnv({ env: INHERITED, files: { [SECRETS]: "<denied>" } }),
    ).join("\n");

    expect(said).toContain(SECRETS);
    expect(said).toContain("could not be read");
    expect(said).toContain("EACCES");
  });

  it("the file carries no token → the names it DOES carry, so the operator sees the typo", () => {
    const said = sessionCredentialLines(
      sessionEnv({ env: INHERITED, files: { [SECRETS]: "GH_TOKN=oops\n" } }),
    ).join("\n");

    expect(said).toContain(SECRETS);
    expect(said).toContain("GH_TOKN");
    expect(said).toContain("none of them is GH_TOKEN or GITHUB_TOKEN");
  });

  it("the config names no secrets file at all → the fourth line, and it says what to add", () => {
    const said = sessionCredentialLines(
      sessionEnv({ env: INHERITED, files: {}, secretsPath: null }),
    ).join("\n");

    expect(said).toContain(CONFIG);
    expect(said).toContain("secrets.envFile");
  });

  it("the four refusals are four different sentences — a class each, not one text", () => {
    const lines = [
      sessionEnv({ env: INHERITED, files: {}, secretsPath: null }),
      sessionEnv({ env: INHERITED, files: {} }),
      sessionEnv({ env: INHERITED, files: { [SECRETS]: "<denied>" } }),
      sessionEnv({ env: INHERITED, files: { [SECRETS]: "GH_TOKN=oops\n" } }),
    ].map((answer) => answer.refusal);

    expect(new Set(lines).size).toBe(4);
    expect(lines.every((line) => line !== null)).toBe(true);
  });
});
