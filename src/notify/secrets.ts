/**
 * WHERE A TRANSPORT'S SECRETS COME FROM (R4, thread `016-protocol-roadmap`).
 *
 * A bot token belongs to NEITHER config, and the reason is the same one that split
 * them in R14, taken one step further:
 *
 *  - not the repository config — it is in git, and a secret committed once lives in
 *    the history for ever (rule 10 of the project: keys live outside the repo);
 *  - not the machine config either — that file is PRINTED, on every preflight and by
 *    `status` ("which file the paths came from" is the first thing one wants when a
 *    run started the wrong binary). A file whose whole content is designed to be
 *    shown is the wrong place for something that must never be shown.
 *
 * So the values live in a third file that is read and never printed, and the machine
 * config says WHERE it is (`secrets.envFile`) — location, which is exactly what the
 * machine is allowed to say. The alternative was "the operator exports the variables
 * before the command", which is the R14 hole all over again: the path lives in a
 * crontab line, that is, in somebody's shell history, and a notifier that silently
 * has no credentials is indistinguishable from a quiet week.
 *
 * THE FORMAT IS THE ONE THAT IS ALREADY THERE — `KEY=value` lines, as in the file
 * this replaces (`~/.config/lle/telegram.env`, documented in PROTOCOL.md and set up
 * by hand once). Adopting an existing file beats asking a human to convert it, and
 * the parser is small enough to own: `export ` prefixes, `#` comments, blank lines,
 * and quotes stripped when they wrap the whole value.
 *
 * WHAT THIS MODULE NEVER DOES: return the values in an error message, log them, or
 * put them in a verdict line. Only names of variables ever leave here.
 */
import { readFileSync } from "node:fs";

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

/** Parse `KEY=value` lines. A line that is not a pair is skipped, not guessed at. */
export const parseEnvFile = (raw: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const text = line.trim().replace(/^export\s+/, "");
    if (text === "" || text.startsWith("#")) continue;
    const at = text.indexOf("=");
    if (at <= 0) continue;
    const name = text.slice(0, at).trim();
    let value = text.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
};

export type LoadedSecrets = {
  /** The environment handed to the transport: the process environment plus the file. */
  readonly values: Readonly<Record<string, string | undefined>>;
  /** The file that was read, or `null` if none was named. */
  readonly path: string | null;
  /** The NAMES that came out of the file — never the values. For the operator's line. */
  readonly names: readonly string[];
};

/**
 * Read the secrets for a transport.
 *
 * A file the operator NAMED and that cannot be read is an error — the same rule as
 * `--local-config` in R14: answering a specific statement with a silent fallback is
 * how a run ends up using settings nobody chose. No file named at all is legitimate:
 * the process environment may already carry everything, and a machine that notifies
 * nobody is a normal machine.
 *
 * THE FILE WINS OVER THE INHERITED ENVIRONMENT. It is the more specific statement —
 * somebody put that variable in that file for this purpose — and a stale exported
 * value in a long-lived shell is a plausible way to send a message to the wrong chat.
 */
export const loadSecrets = (input: {
  readonly path?: string | null;
  readonly env?: NodeJS.ProcessEnv;
}): LoadedSecrets => {
  const env = input.env ?? process.env;
  const path = input.path ?? null;
  if (path === null) return { values: env, path: null, names: [] };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new SecretsError(
      `the secrets file '${path}' was named but not read: ${(error as Error).message}`,
    );
  }
  const parsed = parseEnvFile(raw);
  return { values: { ...env, ...parsed }, path, names: Object.keys(parsed) };
};

/** One line for the operator: which file, and which names it gave. Never a value. */
export const describeSecrets = (loaded: LoadedSecrets): string => {
  if (loaded.path === null) return "no secrets file (the transport reads the environment)";
  return `${loaded.path} — ${
    loaded.names.length === 0 ? "no variables" : `${loaded.names.join(", ")} (values not shown)`
  }`;
};
