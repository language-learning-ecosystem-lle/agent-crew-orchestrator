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
 * with `|` in one bracket — `[…]` when the whole group may be left out, `(…)` when
 * one of its members is required. Comment lines under a command start with `#` and
 * are skipped, since they do not begin with `agent-protocol`.
 *
 * PUNCTUATION IS NOT A VALUE, and both halves of that were measured defects (thread
 * 042). "Followed by something that is not a flag" is what the parse calls a value,
 * and two things in the grammar are neither: the `|` that separates alternatives, and
 * the `#` comment a usage line may end with. `(--staged | --base <ref>)` made
 * `--staged` a flag with a value spelled `|`; `[--clear-force]   # plus every 'daemon'
 * flag` made `--clear-force` a flag with a value spelled `#`. The second one stood
 * behind the door: `orchestrator up --clear-force` was REFUSED for wanting a value it
 * never takes, and `orchestrator up --clear-force --forgeround` passed, because the
 * typo was eaten as that value — the very defect this module was written against.
 *
 * A LIST IS NOT ONE WORD, and the comma in the placeholder is what says so (thread 042).
 * `--paths <a,b>`, `--roles <a,b>`, `--participants <r,r>` are read by `listFlag`, which
 * takes EVERY word up to the next flag — `--paths a b` is a form the usage line spells
 * out loud. A door that consumes exactly one word after such a flag calls the second word
 * a stray argument, and `new-thread --participants a b` was refused by this very check
 * for a spelling the help text offers. So a placeholder containing `,` marks a flag that
 * eats words until the next one, and the refusal it can still raise is the honest half:
 * a list flag with NOTHING after it.
 */

/** What one command accepts: flags that take a value, switches, and how many bare arguments. */
export type CommandFlags = {
  readonly value: readonly string[];
  readonly boolean: readonly string[];
  /**
   * The subset of `value` whose value is a LIST: one or more words, `--x a,b` and
   * `--x a b` naming the same thing (`listFlag` in `cli.ts`). Spelled `<a,b>` in the
   * usage line — the comma in the placeholder is the whole grammar of it.
   */
  readonly list: readonly string[];
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

/**
 * The brackets a human reads as grammar, taken off the token so that a machine reads
 * the flag. `(` and `)` are here for the same reason `[` and `]` are, and their
 * absence was a measured defect (thread 042): `(--role <id> | --role-from-workspace)`
 * parsed as ONE switch spelled `--role-from-workspace)` — a token no argv can ever
 * hold — while `--role`, hidden behind the opening parenthesis, was not read at all.
 */
const strip = (token: string): string => token.replaceAll(/^[[(]|[\])]$/g, "");
const isFlag = (token: string): boolean => token.startsWith("-");
const isPlaceholder = (token: string): boolean => token.startsWith("<");
/** `<a,b>`: the placeholder of a list flag — the comma is what tells it from `<path>`. */
const isListPlaceholder = (token: string): boolean => isPlaceholder(token) && token.includes(",");
/** The `|` of `(--staged | --base <ref>)`: grammar between two alternatives, never a value. */
const isSeparator = (token: string): boolean => token === "|";
/** The tail comment of a usage line: `#` and everything after it is prose, not grammar. */
const isComment = (token: string): boolean => token.startsWith("#");

/**
 * WHICH COMMAND A USAGE LINE DESCRIBES — the leading bare words of it, up to the first
 * flag or placeholder (`agent-protocol orchestrator hold <role> …` → `orchestrator
 * hold`). One function, because two readers now ask the same question of the same text:
 * the flag table below and `usageFor`, which cuts a command's own lines out for a
 * refusal. A line that names no command at all (the header, a blank, a comment) is
 * `undefined`.
 */
const commandKey = (line: string): string | undefined => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("agent-protocol ")) return undefined;
  const words: string[] = [];
  for (const token of trimmed.split(/\s+/).slice(1).map(strip).filter(Boolean)) {
    if (isFlag(token) || isPlaceholder(token) || isComment(token) || isSeparator(token)) break;
    words.push(token);
  }
  return words.length === 0 ? undefined : words.join(" ");
};

/**
 * THE LINES OF ONE COMMAND, cut out of the block the whole package is described by
 * (thread 087).
 *
 * The defect that asked for it: `orchestrator hold --role devops` — the strict form
 * typed without `--mode` — refused with `--mode is not set` and then printed the ENTIRE
 * usage text, whose first two entries are `config check` and `config set`. The command
 * has two forms, the short one is what the hand was reaching for, and the refusal named
 * neither: it answered a question about `hold` with a page about everything else, and
 * john read it as a broken command (thread 047, 2026-09-02).
 *
 * It is a CUT of the same string and never a second copy of it — the reason `parseUsage`
 * reads the help text instead of a table beside it holds here word for word: a refusal
 * that spells the form by hand is the first thing to fall behind the code, and a refusal
 * that offers a form the CLI no longer takes is worse than a silent one.
 *
 * A command's block is its lines PLUS the `#` comments hanging under them — that is
 * where the prose lives ("the short forms ACT (no --write)"), and it is the half a
 * refusal most needs to carry. Several lines for the same command (both `hold` forms,
 * strict and short) come back in the order the block spells them.
 */
export const usageFor = (usage: string, commands: readonly string[]): string => {
  const wanted = new Set(commands);
  const lines: string[] = [];
  let inside = false;
  for (const line of usage.split("\n")) {
    const key = commandKey(line);
    if (key !== undefined) inside = wanted.has(key);
    // A comment continues whatever line it hangs under; anything else ends the block.
    else if (!line.trim().startsWith("#")) inside = false;
    if (inside) lines.push(line);
  }
  return lines.join("\n");
};

/**
 * The usage block, read as data: command name → what it accepts. Several lines for
 * the same command (`hold --mode take` / `hold --mode release`) are one entry — the
 * union of what they spell.
 */
export const parseUsage = (usage: string): Map<string, CommandFlags> => {
  const table = new Map<
    string,
    { value: Set<string>; boolean: Set<string>; list: Set<string>; positionals: number }
  >();
  for (const line of usage.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("agent-protocol ")) continue;
    const spelled = trimmed.split(/\s+/).slice(1).map(strip).filter(Boolean);
    const comment = spelled.findIndex(isComment);
    const tokens = (comment === -1 ? spelled : spelled.slice(0, comment)).filter(
      (token) => !isSeparator(token),
    );

    const key = commandKey(line);
    if (key === undefined) continue;
    let at = key.split(" ").length;
    const entry = table.get(key) ?? {
      value: new Set<string>(),
      boolean: new Set<string>(),
      list: new Set<string>(),
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
      const takesList = takesValue && isListPlaceholder(next as string);
      for (const name of token.split("|")) {
        (takesValue ? entry.value : entry.boolean).add(name);
        if (takesList) entry.list.add(name);
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
      list: [...entry.list],
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
    if (flags.list.includes(token)) {
      // Every word up to the next flag belongs to the list, exactly as `listFlag` reads
      // it. A list that names NOTHING is left to the handler on purpose: `listFlag`
      // already refuses it by name (`--paths was given nothing to name`), and a second
      // refusal here would only reword a correct one — the door's business is the token
      // it cannot account for, not the value of a token it can.
      while (at + 1 < argv.length && !isFlag(argv[at + 1] as string)) at += 1;
      continue;
    }
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
