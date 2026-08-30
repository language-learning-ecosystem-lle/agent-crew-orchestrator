/**
 * THE COMMAND TAKES THE CREDENTIALS OF ITS OWN CIRCUIT (thread `065`, john's word of
 * 2026-08-30: «пусть он сам свои креды берёт»).
 *
 * Until this file, every call this package makes to GitHub — `gh` for the merge door and
 * for the scheduler's `merge-ready` layer, `git` for the mail push — took its token from
 * THE ENVIRONMENT OF WHOEVER STARTED THE PROCESS. The machine config already said where
 * the token is (`secrets.envFile`, R4), so the fact was known and not used, and the price
 * was paid three times on one day:
 *
 *  · the daemon went blind for five ticks — `gh` started refusing after the shared login
 *    was closed, and the circuit kept ticking as if nothing happened;
 *  · the cure had to be applied ON TOP of the package (`EnvironmentFile=` in a unit
 *    override, by hand, per circuit), which made the unit carry what the config already
 *    knew: one place, two sources of truth;
 *  · a human standing in the tree of a circuit could not call a command by hand —
 *    `orchestrator status` answered `Username for 'https://github.com'`.
 *
 * SO THE ENVIRONMENT OF A CHILD CALL IS COMPUTED, from one source: the machine config of
 * the instance the checkout belongs to (`resolveLocalConfig`, thread 055 — that is where
 * the boundary between circuits already lives, and the token is the second fence on the
 * same line as `062`).
 *
 * THREE RULES DECIDE EVERYTHING HERE:
 *
 *  1. AN ALREADY-SET VARIABLE IS NEVER OVERWRITTEN. This is the opposite of the
 *     precedence in `notify/secrets.ts`, and deliberately: there, the file is the
 *     specific statement about which chat to write to, and a stale export is a plausible
 *     way to notify the wrong place. Here the caller who exported a token IS the debug
 *     path and IS john's path — a command that overrode it would make a deliberate
 *     substitution silently ineffective.
 *  2. THE REFUSAL SAYS WHICH FILE AND WHY. `populate the GH_TOKEN environment variable`
 *     is a refusal a human cannot act on; four cases are told apart by name, and each one
 *     names the path it tried to read.
 *  3. A VALUE NEVER LEAVES. Names of variables, paths of files, counts — those are what
 *     the note and the refusal are made of. There is no code path in this file that puts
 *     a value into a string.
 */
import { readFileSync } from "node:fs";
import { parseEnvFile } from "../notify/secrets.js";
import { LocalConfigError, resolveLocalConfig } from "./local.js";

/**
 * THE VARIABLES `gh` READS AS A LOGIN, in the order it reads them itself. The list is
 * what "the credential is there" means for this module: the merge door and the scheduler
 * both call `gh`, and `gh` accepts either.
 */
export const PLATFORM_TOKEN_KEYS = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

const present = (env: NodeJS.ProcessEnv, key: string): boolean => {
  const value = env[key];
  return value !== undefined && value.length > 0;
};

/** Which file was consulted and what came of the attempt — never what was in it. */
export type SecretsFileState =
  | { readonly kind: "not-named" }
  | { readonly kind: "absent"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly reason: string }
  | { readonly kind: "read"; readonly path: string; readonly names: readonly string[] };

export type PlatformEnv = {
  /** The environment to hand to a child `gh` or `git`. Contains values; is never printed. */
  readonly env: NodeJS.ProcessEnv;
  /** Where the token that will be used came from, or `null` when there is none. */
  readonly token: { readonly key: string; readonly from: "environment" | "file" } | null;
  readonly file: SecretsFileState;
  /**
   * Why no credential could be assembled, said by name and with the path — `null` when
   * one was. Not thrown: every caller of this module already has a place for a refusal
   * (a `refusal` field, a degraded layer, an exit-2 line), and which of them it is is
   * their decision, not this file's.
   */
  readonly refusal: string | null;
  /** One line for the operator: the file, the names it gave, whose token won. No values. */
  readonly note: string;
};

/**
 * GIT MUST NOT ASK A HUMAN WHO IS NOT THERE. `Username for 'https://github.com'` on a
 * daemon's stdin is a call that hangs until something kills it; with the prompt off, the
 * same call fails in one line that names the repository. This is set for every child, with
 * or without a token — a prompt is never the right answer for a call made by a tick.
 */
const GIT_NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" } as const;

/**
 * HOW `git` USES THE TOKEN THE CONFIG NAMED, without touching any file on the box: a
 * credential helper handed to the child through `GIT_CONFIG_*`, which git reads as if it
 * were configured. The helper prints the token FROM ITS OWN ENVIRONMENT (`$GH_TOKEN`), so
 * the secret is in the child's environment and in no configuration value, no command line
 * and no process title.
 *
 * THE INDEX IS APPENDED, NOT ASSUMED: a caller who already handed git a `GIT_CONFIG_COUNT`
 * said something, and overwriting entry 0 would silently drop it.
 */
const gitCredentialHelper = (
  env: NodeJS.ProcessEnv,
  key: string,
): Record<string, string> | undefined => {
  const at = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10);
  const start = Number.isFinite(at) && at > 0 ? at : 0;
  return {
    GIT_CONFIG_COUNT: String(start + 1),
    [`GIT_CONFIG_KEY_${start}`]: "credential.https://github.com.helper",
    [`GIT_CONFIG_VALUE_${start}`]: `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$${key}"; }; f`,
  };
};

const readFile = (
  path: string,
): { readonly raw: string } | { readonly error: NodeJS.ErrnoException } => {
  try {
    return { raw: readFileSync(path, "utf8") };
  } catch (error) {
    return { error: error as NodeJS.ErrnoException };
  }
};

/**
 * BUILD THE ENVIRONMENT OF A CHILD CALL from a named secrets file (or from none).
 *
 * Separate from {@link platformEnvOf} so that the rules above are testable without a
 * machine config, a home directory or a checkout.
 */
export const platformEnvFrom = (input: {
  /** `secrets.envFile` of the machine config, or `null` when it names none. */
  readonly secretsPath: string | null;
  /** Which machine config named it — quoted in every refusal, so the human knows what to edit. */
  readonly configPath: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Seam for the tests; the real one is `readFileSync`. */
  readonly read?: (
    path: string,
  ) => { readonly raw: string } | { readonly error: NodeJS.ErrnoException };
}): PlatformEnv => {
  const env = input.env ?? process.env;
  const read = input.read ?? readFile;
  const values: NodeJS.ProcessEnv = { ...env };

  let file: SecretsFileState = { kind: "not-named" };
  if (input.secretsPath !== null) {
    const path = input.secretsPath;
    const answer = read(path);
    if ("error" in answer) {
      file =
        answer.error.code === "ENOENT"
          ? { kind: "absent", path }
          : { kind: "unreadable", path, reason: answer.error.message };
    } else {
      const parsed = parseEnvFile(answer.raw);
      // RULE 1. Every variable of the file is offered to the child, not only the token:
      // one file, one circuit, and a second list here would be a second source of truth
      // about what a circuit's calls need.
      for (const [name, value] of Object.entries(parsed)) {
        if (!present(env, name)) values[name] = value;
      }
      file = { kind: "read", path, names: Object.keys(parsed) };
    }
  }

  const key = PLATFORM_TOKEN_KEYS.find((candidate) => present(values, candidate));
  const token =
    key === undefined ? null : ({ key, from: present(env, key) ? "environment" : "file" } as const);

  const refusal = ((): string | null => {
    if (token !== null) return null;
    const wanted = PLATFORM_TOKEN_KEYS.join(" or ");
    switch (file.kind) {
      case "not-named":
        return `no credential for GitHub: the machine config '${input.configPath}' names no 'secrets.envFile', and neither ${wanted} is set in the environment. Add "secrets": { "envFile": "<path>" } to that file, or export a token for this call`;
      case "absent":
        return `no credential for GitHub: the secrets file '${file.path}' named by '${input.configPath}' does not exist, and neither ${wanted} is set in the environment`;
      case "unreadable":
        return `no credential for GitHub: the secrets file '${file.path}' named by '${input.configPath}' could not be read (${file.reason}), and neither ${wanted} is set in the environment`;
      case "read":
        return `no credential for GitHub: the secrets file '${file.path}' named by '${input.configPath}' carries ${
          file.names.length === 0
            ? "no variables"
            : `${file.names.length} variable(s) — ${file.names.join(", ")}`
        }, and none of them is ${wanted}`;
    }
  })();

  return {
    env:
      token === null
        ? { ...values, ...GIT_NO_PROMPT }
        : { ...values, ...GIT_NO_PROMPT, ...gitCredentialHelper(env, token.key) },
    token,
    file,
    refusal,
    note: describePlatformEnv({ file, token }),
  };
};

/** The operator's line: which file, which NAMES, whose token won. Never a value. */
export const describePlatformEnv = (input: {
  readonly file: SecretsFileState;
  readonly token: PlatformEnv["token"];
}): string => {
  const where =
    input.file.kind === "not-named"
      ? "no secrets file named"
      : input.file.kind === "read"
        ? `${input.file.path} — ${
            input.file.names.length === 0
              ? "no variables"
              : `${input.file.names.join(", ")} (values not shown)`
          }`
        : `${input.file.path} — ${input.file.kind}`;
  const who =
    input.token === null
      ? "no token"
      : `token ${input.token.key} ← ${
          input.token.from === "environment"
            ? "the environment of the caller (not overwritten)"
            : "the secrets file"
        }`;
  return `${where}; ${who}`;
};

/**
 * THE ENVIRONMENT FOR A CHILD CALL MADE ABOUT ONE CHECKOUT — the whole of the wiring a
 * caller needs: which instance the tree belongs to is answered by the same resolution
 * every other command uses, so a box hosting two circuits hands each call the token of
 * ITS circuit and of no other.
 *
 * IT NEVER THROWS. A machine config that does not resolve is reported the way a missing
 * token is — a refusal with the reason in it — because every caller of this is a call to
 * the network that already knows how to degrade, and dying inside the environment
 * computation would turn a diagnosable refusal into a stack trace.
 */
export const platformEnvOf = (input: {
  /** The checkout the call is about; the instance is resolved from it. */
  readonly repo: string;
  readonly instance?: string | undefined;
  /** `--local-config <path>`, when the caller was given one. */
  readonly localConfig?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
}): PlatformEnv => {
  const env = input.env ?? process.env;
  let resolved: ReturnType<typeof resolveLocalConfig>;
  try {
    resolved = resolveLocalConfig({
      path: input.localConfig,
      instance: input.instance,
      repo: input.repo,
      env,
    });
  } catch (error) {
    const reason = error instanceof LocalConfigError ? error.message : (error as Error).message;
    const key = PLATFORM_TOKEN_KEYS.find((candidate) => present(env, candidate));
    const file: SecretsFileState = { kind: "not-named" };
    const token = key === undefined ? null : ({ key, from: "environment" } as const);
    return {
      env: {
        ...env,
        ...GIT_NO_PROMPT,
        ...(key === undefined ? {} : gitCredentialHelper(env, key)),
      },
      token,
      file,
      refusal:
        token !== null
          ? null
          : `no credential for GitHub: the machine config of '${input.repo}' was not read (${reason}), and neither ${PLATFORM_TOKEN_KEYS.join(" or ")} is set in the environment`,
      note: `machine config unread (${reason}); ${token === null ? "no token" : `token ${token.key} ← the environment of the caller`}`,
    };
  }
  return platformEnvFrom({
    secretsPath: resolved.config.secrets?.envFile ?? null,
    configPath: resolved.path,
    env,
  });
};
