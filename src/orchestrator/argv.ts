/**
 * A TYPO IS REFUSED AT THE DOOR — the argument check of the operator commands
 * (thread 019, curator's report of 2026-07-27).
 *
 * The reason this module exists is one line of a defect: `orchestrator daemon -d`
 * SWALLOWED the flag it does not know and started attached, so the operator went
 * away believing the watch was in the background and came back to a dead terminal.
 * `flag()` reads argv by `indexOf`, which means an unknown argument is not an error
 * — it is nothing at all, and "nothing" is exactly what a silent default looks like
 * from outside.
 *
 * WHERE THE LIST OF FLAGS COMES FROM: the usage text. Not a second table beside it —
 * the first thing to be forgotten in a second table is a flag, and a checker that
 * disagrees with the help text is worse than no checker: it refuses what the help
 * offers. So `parseUsage` reads the very block the operator is shown on a refusal,
 * and the help text is the specification by construction.
 *
 * The parse is deliberately dumb, and the shape of the usage lines is its whole
 * grammar:
 *
 *   agent-protocol <command words> [<positional>] --a <value> [--b <value>] [--c] [-d|--long]
 *
 * a token followed by a `<…>` (or by a bare literal, as in `--mode take`) takes a
 * value; anything else that starts with `-` is a switch; alternatives are spelled
 * with `|` in one bracket. Comment lines under a command start with `#` and are
 * skipped, since they do not begin with `agent-protocol`.
 */

/** What one command accepts: flags that take a value, switches, and how many bare arguments. */
export type CommandFlags = {
  readonly value: readonly string[];
  readonly boolean: readonly string[];
  /** Bare arguments the command itself takes (`hold <role>`); flags do not count. */
  readonly positionals: number;
};

/**
 * Flags that belong to no single command: they are read by the config loader, which
 * every command that touches the config goes through. Documenting them on every
 * usage line would be noise; leaving them out of the checker would make the checker
 * refuse working commands.
 */
const GLOBAL_VALUE = ["--repo", "--config-path"] as const;
const GLOBAL_BOOLEAN = ["--no-fetch"] as const;

const strip = (token: string): string => token.replaceAll(/^\[|]$/g, "");
const isFlag = (token: string): boolean => token.startsWith("-");
const isPlaceholder = (token: string): boolean => token.startsWith("<");

/**
 * The usage block, read as data: command name → what it accepts. Several lines for
 * the same command (`hold --mode take` / `hold --mode release`) are one entry — the
 * union of what they spell.
 */
export const parseUsage = (usage: string): Map<string, CommandFlags> => {
  const table = new Map<
    string,
    { value: Set<string>; boolean: Set<string>; positionals: number }
  >();
  for (const line of usage.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("agent-protocol ")) continue;
    const tokens = trimmed.split(/\s+/).slice(1).map(strip).filter(Boolean);

    const words: string[] = [];
    let at = 0;
    while (
      at < tokens.length &&
      !isFlag(tokens[at] as string) &&
      !isPlaceholder(tokens[at] as string)
    ) {
      words.push(tokens[at] as string);
      at += 1;
    }
    if (words.length === 0) continue;
    const key = words.join(" ");
    const entry = table.get(key) ?? {
      value: new Set<string>(),
      boolean: new Set<string>(),
      positionals: 0,
    };

    let positionals = 0;
    while (at < tokens.length && isPlaceholder(tokens[at] as string)) {
      positionals += 1;
      at += 1;
    }
    entry.positionals = Math.max(entry.positionals, positionals);

    for (; at < tokens.length; at += 1) {
      const token = tokens[at] as string;
      if (!isFlag(token)) continue;
      const next = tokens[at + 1];
      const takesValue = next !== undefined && !isFlag(next);
      for (const name of token.split("|")) {
        (takesValue ? entry.value : entry.boolean).add(name);
      }
      if (takesValue) at += 1;
    }
    table.set(key, entry);
  }

  const result = new Map<string, CommandFlags>();
  for (const [key, entry] of table) {
    result.set(key, {
      value: [...entry.value, ...GLOBAL_VALUE],
      boolean: [...entry.boolean, ...GLOBAL_BOOLEAN],
      positionals: entry.positionals,
    });
  }
  return result;
};

/**
 * What the command cannot account for in what it was given. An empty list is a clean
 * invocation; every element is a sentence for the operator, because a refusal that
 * names the token without saying what is wrong with it sends them back to the help
 * text anyway.
 *
 * `--flag=value` is called out by name rather than lumped in with typos: it is the
 * spelling half the world uses, this CLI has never supported it, and before this
 * check it was silently ignored — the worst of the three possible outcomes.
 */
export const strayArguments = (argv: readonly string[], flags: CommandFlags): readonly string[] => {
  const problems: string[] = [];
  let bare = 0;
  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at] as string;
    if (!isFlag(token) || token === "-") {
      bare += 1;
      if (bare > flags.positionals) {
        problems.push(`'${token}' — this command takes no such argument`);
      }
      continue;
    }
    if (flags.boolean.includes(token)) continue;
    if (flags.value.includes(token)) {
      if (argv[at + 1] === undefined) {
        problems.push(`'${token}' expects a value and is the last thing on the line`);
      }
      at += 1;
      continue;
    }
    const [name] = token.split("=");
    if (name !== undefined && (flags.value.includes(name) || flags.boolean.includes(name))) {
      problems.push(
        `'${token}' — write it as '${name} <value>', this CLI does not read '--flag=value'`,
      );
      continue;
    }
    problems.push(`'${token}' — unknown flag`);
  }
  return problems;
};
