/**
 * THE LAUNCH DIRECTIVE OF A THREAD (R21, john's decision, thread
 * `016-protocol-roadmap`) — reading out of the feed which model and effort the next
 * run of this thread is to be raised with.
 *
 * WHY IT IS A SEPARATE MODULE AND NOT A LINE IN `resolveAgentParams`. What the feed
 * says and what the parameters resolve to are two different questions, and only the
 * first one needs the ROLE REGISTRY: a directive is effective only from a role
 * holding `launch-params`, so the reading half depends on the config's permissions
 * while the resolving half (`launch.ts`) is a pure merge of three layers. Keeping
 * them together would drag the registry into every ceiling test in the package.
 *
 * THE RULE IS "THE LAST DIRECTIVE OF AN AUTHORIZED ROLE WINS", and it is the rule
 * for the reason john gave when the fork was settled: a thread lives for days
 * across phases (reconnaissance on a cheap model, implementation on a strong one),
 * so a directive is a statement about the work FROM HERE ON, not a property of the
 * conversation. One directive in the statement of work covers the steady case
 * without anybody having to think about it.
 *
 * AN UNAUTHORIZED DIRECTIVE IS IGNORED OUT LOUD, never silently and never fatally:
 *  - out loud, because a run raised on a model nobody chose looks exactly like a run
 *    that obeyed — the same argument that made every other resolution in the package
 *    print its source (R12/R15);
 *  - not fatally, because the feed is APPEND-ONLY. A refusal on a message that is
 *    already history would wedge the thread permanently: nobody can edit the offending
 *    message, so the role could never be raised on that thread again. The door of the
 *    writer (`new-message`) is where a bad directive is refused while it can still be
 *    retyped.
 */
import type { LaunchDirective, Message } from "../thread/message.js";

/** A directive as it was found in the feed — with whoever said it and when. */
export type FeedDirective = {
  readonly directive: LaunchDirective;
  readonly from: string;
  readonly date: string;
};

export type DirectiveVerdict = {
  /** The one in force, if any: the last one written by an authorized role. */
  readonly effective?: FeedDirective;
  /**
   * What was found and NOT applied, in the package's own words — printed at the
   * launch beside the resolved parameters. Empty in the ordinary case, which is why
   * the lines are collected rather than counted: an operator needs to know WHICH
   * directive was dropped and whose it was.
   */
  readonly ignored: readonly string[];
};

/**
 * The directive in force for a thread, plus everything that was ignored on the way.
 *
 * `authorized` is injected rather than taken as a registry: this is the one fact the
 * function needs from the config, and passing the predicate keeps the module free of
 * the loader (the same split the rest of the package uses — probes at the edge,
 * decisions in the core).
 */
export const resolveThreadDirective = (input: {
  readonly messages: readonly Message[];
  readonly authorized: (role: string) => boolean;
}): DirectiveVerdict => {
  let effective: FeedDirective | undefined;
  const ignored: string[] = [];
  for (const message of input.messages) {
    const directive = message.fields.launch;
    if (directive === undefined) continue;
    const found: FeedDirective = {
      directive,
      from: message.fields.from,
      date: message.fields.date,
    };
    if (!input.authorized(found.from)) {
      ignored.push(
        `the launch directive of '${found.from}' (${found.date}) is NOT in force: the role does not hold 'launch-params'`,
      );
      continue;
    }
    effective = found;
  }
  return { ...(effective === undefined ? {} : { effective }), ignored };
};

/** The directive in force, in one line for the launch output. */
export const describeDirective = (found: FeedDirective): string => {
  const parts = [
    ...(found.directive.model === undefined ? [] : [`model ${found.directive.model}`]),
    ...(found.directive.effort === undefined ? [] : [`effort ${found.directive.effort}`]),
  ];
  return `${parts.join(", ")} — said by '${found.from}' in the thread (${found.date})`;
};
