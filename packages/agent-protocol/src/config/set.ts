/**
 * A POINT EDIT OF THE MACHINE CONFIG (thread 019, п.3 of the commissioning statement:
 * "`config set` — точечные правки без ручного JSON").
 *
 * `init` commissions a box: every fact at once, then `doctor`. This is the other half of
 * the same operator's day — the box has been in service for a month and ONE fact about it
 * changed (the agent binary moved after an upgrade, the operator at the keyboard is
 * somebody else, the secrets file was moved off `/root`). Until now that meant opening
 * `~/.config/agent-protocol/local.json` in an editor, and hand-edited JSON is how a box
 * ends up with a trailing comma, a duplicated key, or `"instances"` where `"instance"`
 * belongs — none of which is noticed until the daemon refuses to raise anybody.
 *
 * THE POINT IS THE DOOR, NOT THE WRITE. The strict parser (`parseLocalConfig`) already
 * catches every one of those — but it catches them on the NEXT read, which is after the
 * file was saved and usually in another session, with the error attributed to whatever
 * command happened to load it. Here the same judgement runs BEFORE anything is written:
 * the value is checked, the resulting object is re-parsed through the very same parser,
 * and a refusal names the rule it broke rather than the line number it broke it on. A
 * config this command writes cannot be one this package will not read.
 *
 * WHY IT BORROWS INIT'S STEP BUILDERS rather than describing the change in words of its
 * own: `init instance` and `config set instance` decide the same thing about the same
 * field, and two vocabularies for one decision drift — one of them learns that an
 * undeclared instance is a bench, the other does not, and the operator gets a different
 * answer depending on which command they reached for. So the wording has one home
 * (`orchestrator/init.ts`) and this module composes it, one fact at a time.
 *
 * WHAT IT MAY NOT DO is exactly what the machine config may not carry (R14): policy. A
 * key from `POLICY_KEYS` is refused BY THE RULE — "that lives in the repository config,
 * behind a PR" — and not as an unknown word, because the operator typing `config set
 * limits …` is not making a typo, they are making a mistake about where power lives.
 */

import {
  accountStep,
  agentStep,
  type InitStep,
  instanceStep,
  nextLocalConfig,
  operatorStep,
  secretsStep,
} from "../orchestrator/init.js";
import { type LocalConfig, LocalConfigError, POLICY_KEYS, parseLocalConfig } from "./local.js";

/** What the machine config holds, as the words an operator types. */
export const CONFIG_SET_KEYS = ["instance", "operator", "secrets", "agent", "account"] as const;

export type ConfigSetOutcome =
  | { readonly ok: true; readonly step: InitStep; readonly next: LocalConfig }
  /** A sentence for the operator: what is wrong AND which rule says so. */
  | { readonly ok: false; readonly refusal: string };

const listed = (words: readonly string[]): string => words.map((word) => `'${word}'`).join(", ");

/**
 * ONE ASSIGNMENT, DECIDED. Pure: the facts about the box (does that file exist, does that
 * binary resolve) are looked up by the caller and passed in, so the whole decision —
 * including every refusal — is testable without a home directory or a PATH.
 */
export const planConfigSet = (input: {
  readonly current: LocalConfig;
  /** Where the file lies. Only used to word the parser's refusal, never read here. */
  readonly path: string;
  readonly key?: string;
  /** The second bare word: the id, the role, the path — or, for `agent`, the tool kind. */
  readonly value?: string;
  /** `agent <kind> --exec <path>`: the flag of the key that has two halves. */
  readonly exec?: string;
  /** `account <id> --config-dir <path>`: the other half of the other two-halved key. */
  readonly configDir?: string;
  /** Whether the account directory named is on this disk (absence is legitimate — see `accountStep`). */
  readonly configDirExists?: boolean;
  readonly declaredInstances: readonly string[];
  readonly knownRoles: readonly string[];
  /** Whether the secrets file named is there yet (absence is legitimate — see `secretsStep`). */
  readonly secretsExists?: boolean;
  /** Whether the binary named resolves on this box. Unknown (`undefined`) says nothing. */
  readonly execFound?: boolean;
}): ConfigSetOutcome => {
  const key = (input.key ?? "").trim();
  if (key === "") {
    return {
      ok: false,
      refusal: `name what to set — ${listed([...CONFIG_SET_KEYS])}; the form is 'config set <key> <value>'`,
    };
  }
  if ((POLICY_KEYS as readonly string[]).includes(key)) {
    return {
      ok: false,
      refusal: `'${key}' is POLICY and it lives in the repository config, behind a PR — the machine config says only WHERE things are on this box (${listed([...CONFIG_SET_KEYS])})`,
    };
  }
  if (!(CONFIG_SET_KEYS as readonly string[]).includes(key)) {
    return {
      ok: false,
      refusal: `unknown key '${key}' — the machine config holds ${listed([...CONFIG_SET_KEYS])}`,
    };
  }
  const value = (input.value ?? "").trim();
  if (value === "") {
    return {
      ok: false,
      refusal:
        key === "agent"
          ? "'config set agent' needs the tool it is about — 'config set agent <kind> --exec <path>'"
          : key === "account"
            ? "'config set account' needs the account it is about — 'config set account <id> --config-dir <path>'"
            : `'config set ${key}' needs a value — 'config set ${key} <${key === "secrets" ? "path" : key === "operator" ? "role" : "id"}>'`,
    };
  }
  // A flag belongs to the one key that has two halves. Elsewhere it would be read
  // as accepted and silently dropped, which is the class of defect the argument guard
  // exists for — refused here for the same reason, one level up. Both flags are checked
  // the same way, so that `--exec` on an account (the plausible slip, both being "where
  // it lives") is a sentence and not a write that ignored half of what was typed.
  if (input.exec !== undefined && key !== "agent") {
    return {
      ok: false,
      refusal: `--exec belongs to 'config set agent <kind> --exec <path>' — 'config set ${key}' takes ${key === "account" ? "--config-dir <path>" : "its value as a bare word"}`,
    };
  }
  if (input.configDir !== undefined && key !== "account") {
    return {
      ok: false,
      refusal: `--config-dir belongs to 'config set account <id> --config-dir <path>' — 'config set ${key}' takes ${key === "agent" ? "--exec <path>" : "its value as a bare word"}`,
    };
  }

  const decided = decide({ ...input, key, value });
  if (!decided.ok) return decided;

  // THE PARSER RUNS BEFORE THE WRITE, and that is the whole statement of п.3: the strict
  // schema catches a broken machine config today too, but on the next read — after the
  // file was saved, in another command, blamed on whoever loaded it.
  try {
    parseLocalConfig(decided.next, input.path);
  } catch (error) {
    if (error instanceof LocalConfigError) return { ok: false, refusal: error.message };
    throw error;
  }
  return decided;
};

const decide = (input: {
  readonly current: LocalConfig;
  readonly key: string;
  readonly value: string;
  readonly exec?: string;
  readonly configDir?: string;
  readonly declaredInstances: readonly string[];
  readonly knownRoles: readonly string[];
  readonly secretsExists?: boolean;
  readonly execFound?: boolean;
  readonly configDirExists?: boolean;
}): ConfigSetOutcome => {
  if (input.key === "instance") {
    return {
      ok: true,
      step: instanceStep({
        requested: input.value,
        ...(input.current.instance === undefined ? {} : { current: input.current.instance }),
        declared: input.declaredInstances,
      }),
      next: nextLocalConfig(input.current, { instance: input.value }),
    };
  }
  if (input.key === "operator") {
    return {
      ok: true,
      step: operatorStep({
        requested: input.value,
        ...(input.current.operator === undefined ? {} : { current: input.current.operator }),
        known: input.knownRoles,
      }),
      next: nextLocalConfig(input.current, { operator: input.value }),
    };
  }
  if (input.key === "secrets") {
    return {
      ok: true,
      step: secretsStep({
        requested: input.value,
        ...(input.current.secrets === undefined ? {} : { current: input.current.secrets.envFile }),
        ...(input.secretsExists === undefined ? {} : { exists: input.secretsExists }),
      }),
      next: nextLocalConfig(input.current, { secretsEnvFile: input.value }),
    };
  }
  if (input.key === "account") {
    const configDir = (input.configDir ?? "").trim();
    if (configDir === "") {
      return {
        ok: false,
        refusal: `'config set account ${input.value}' needs --config-dir <path>: where the account's directory is on this box is the only thing the machine config says about an account`,
      };
    }
    // Relative would depend on the cwd of whoever typed it, while the path is read by a
    // daemon started somewhere else entirely — the same reason `secrets.envFile` is
    // absolute. Refused here rather than by the schema, which only knows it is a string.
    if (!configDir.startsWith("/")) {
      return {
        ok: false,
        refusal: `'${configDir}' is relative — the account directory is passed to sessions this box spawns from elsewhere ('CLAUDE_CONFIG_DIR'), so it must be absolute`,
      };
    }
    return {
      ok: true,
      step: accountStep({
        id: input.value,
        requested: configDir,
        ...(input.current.accounts?.[input.value] === undefined
          ? {}
          : { current: (input.current.accounts[input.value] as { configDir: string }).configDir }),
        ...(input.configDirExists === undefined ? {} : { exists: input.configDirExists }),
      }),
      next: nextLocalConfig(input.current, { account: { id: input.value, configDir } }),
    };
  }
  const exec = (input.exec ?? "").trim();
  if (exec === "") {
    return {
      ok: false,
      refusal: `'config set agent ${input.value}' needs --exec <path>: where the binary is on this box is the only thing the machine config says about a tool`,
    };
  }
  const step = agentStep({
    kind: input.value,
    requested: exec,
    ...(input.current.agents[input.value] === undefined
      ? {}
      : { current: (input.current.agents[input.value] as { exec: string }).exec }),
  });
  return {
    ok: true,
    // A binary that is not there is a WARNING and not a refusal: the operator who
    // declares the path before installing the tool is doing the ordinary thing, and
    // `doctor` is the command that judges whether the box can actually raise anybody.
    step:
      input.execFound === false
        ? {
            ...step,
            detail: `${step.detail} — WARNING: nothing at that path and nothing by that name on PATH; the session that spawns it will fail (doctor checks it for real)`,
          }
        : step,
    next: nextLocalConfig(input.current, { agent: { kind: input.value, exec } }),
  };
};

/**
 * THE ONE LINE THAT SAYS WHAT HAPPENED, in the two tenses `init` uses for the same file:
 * without `--write` what WOULD be done (naming the flag), with it, what was. A `keep`
 * gets its own sentence, because "already says that" and "changed it for you" are the two
 * answers an operator must never confuse.
 */
export const configSetSummary = (input: {
  readonly step: InitStep;
  readonly write: boolean;
  readonly path: string;
}): string => {
  if (input.step.action === "keep") {
    return `config set: '${input.step.name}' already says that — ${input.path} is untouched`;
  }
  return input.write
    ? `config set: '${input.step.name}' written — ${input.path}`
    : `config set: this is the plan — ${input.path} was not touched (--write does it)`;
};
