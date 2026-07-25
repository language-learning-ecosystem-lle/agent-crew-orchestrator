/**
 * TEXT THE PROJECT OWNS (R4, thread `016-protocol-roadmap`).
 *
 * The package is designed as a foreign one, and the one thing it can never know is
 * WHAT WORDS a particular team uses. Two texts have already run into that: the
 * notifications about the turn passing (Russian, in a bash script outside the
 * package) and the force-stop announcement written into a thread — the latter was
 * translated into English by R1 and the question was deferred here, because a text
 * the package writes into somebody's CONVERSATION is not the package's prose.
 *
 * THE ANSWER IS A TEMPLATE, NOT A FUNCTION, and the alternative was weighed rather
 * than skipped. A function would be an escape hatch of unbounded shape: the config
 * is JSON in git, so a function would have to arrive as a module path, and that
 * turns "which words do we use" into a second plugin surface with its own contract,
 * its own failure modes and no way for `config check` to say anything about it. A
 * template is data — it can be validated at the door, printed, diffed and reviewed
 * in the PR that changes it. Where a template genuinely cannot express something (a
 * conditional), the answer is another named slot chosen by the FACT, not a branch
 * inside a string: see `turn` versus `turn-with-nudge` in `notify.ts`.
 *
 * THE ONE RULE THAT MAKES IT SAFE: an unknown placeholder is a REFUSAL, and it is
 * refused at the door — `parseProtocolConfig` validates every template against the
 * vocabulary of its slot, so a typo in `{thraed}` fails `config check` in the PR
 * that introduces it rather than at three in the morning, in the one message the
 * whole notifier exists to deliver. The opposite (leaving an unknown placeholder as
 * literal text, or rendering it empty) is the quiet-default class this package is
 * written against.
 */

/**
 * A placeholder is `{name}` with a name of latin letters and digits. Anything else
 * between braces is LITERAL: an emoji, a smiley, a `{` in prose. The vocabulary is
 * deliberately narrow — the wider it is, the more ordinary punctuation gets read as
 * a broken placeholder by a validator nobody can argue with.
 */
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/** The placeholders a template actually uses, in order of appearance, without repeats. */
export const templateVariables = (template: string): readonly string[] => {
  const found: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1] as string;
    if (!found.includes(name)) found.push(name);
  }
  return found;
};

/**
 * The door: a template may only mention variables its slot provides. Returns the
 * complaints rather than throwing, so the config schema can report ALL of them at
 * once — a config is edited by a human, and "fix this, then learn about the next
 * one" is a bad loop (the same reasoning as in the role registry).
 */
export const templateIssues = (template: string, allowed: readonly string[]): readonly string[] => {
  const unknown = templateVariables(template).filter((name) => !allowed.includes(name));
  if (unknown.length === 0) return [];
  return [
    `unknown placeholder${unknown.length > 1 ? "s" : ""} ${unknown
      .map((name) => `'{${name}}'`)
      .join(", ")} — this text is given ${
      allowed.length === 0 ? "no variables" : allowed.map((name) => `'{${name}}'`).join(", ")
    }`,
  ];
};

/**
 * Substitution. A variable the caller did not supply is a throw and not an empty
 * string: the caller is the package itself, so this can only fire on a slot whose
 * vocabulary and whose renderer have drifted apart — that is a defect of ours, and
 * it must not be delivered as a message with a hole in it.
 */
export const renderTemplate = (
  template: string,
  variables: Readonly<Record<string, string>>,
): string =>
  template.replaceAll(PLACEHOLDER, (whole, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      throw new TemplateError(
        `the template asks for '${whole}', and the caller supplied ${
          Object.keys(variables).length === 0
            ? "nothing"
            : Object.keys(variables)
                .map((key) => `'{${key}}'`)
                .join(", ")
        }`,
      );
    }
    return value;
  });
