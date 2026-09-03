/**
 * THE DESCRIPTION OF A PULL REQUEST, JUDGED BEFORE THE PULL REQUEST EXISTS (thread
 * `052-pr-template`, john's decision of 2026-09-02 — variant (B), «ТРЕТИЙ С ПЕРВЫМ»).
 *
 * WHERE IT COMES FROM. The `thread:` and `role:` lines had drifted out of PR bodies, and
 * the first repair was a template (`.github/pull_request_template.md`, PR #134). The
 * measurement that followed said the template's premise holds only by halves: GitHub
 * substitutes a template into the INTERACTIVE paths only (`--web`, `--template <file>`),
 * and roles open pull requests with `gh pr create --body-file <p>`, where an explicit body
 * bypasses the placeholder entirely. So the template fixes the class of descriptions where
 * the defect was not, and does not touch the class where it was.
 *
 * AND THE TWO FIELDS FAIL DIFFERENTLY. `thread:` is protected by a LOUD refusal — guard 3
 * of the merge gate stops the merge without it. `role:` was read by nobody that refuses:
 * the CI and merge notifiers merely `grep` it, and when it is missing they simply do not
 * pass the turn on — silently. A silent failure is the worse of the two, which is what
 * john's decision closes: `role:` becomes as obligatory as `thread:`, checked at the
 * moment of OPENING (this file, the cheap and early half) and again at the merge (guard 3
 * in `gate.js`, the load-bearing half).
 *
 * WHAT THIS DOOR IS NOT — said here for the reason `roles/contour.ts` says its own: it
 * catches an HONEST mistake and is bypassed by not using it. `gh pr create` typed by hand
 * walks straight past it and always will. Nothing here is a substitute for guard 3; this
 * is the door that costs no runner minutes and answers before anything has been created.
 *
 * THE READERS ARE NOT COPIED HERE. `threadOfDescription` and `roleOfDescription` are the
 * door's own functions, imported — a second grammar for the same two lines is exactly the
 * class this package spends its existence avoiding (see `pr-template.test.ts`: what the
 * door accepts, every workflow `grep` must read).
 */

import { roleOfDescription, threadOfDescription } from "./gate.js";

/** The form of the two lines, as one sentence — repeated by every refusal below. */
export const PR_FIELDS_FORM =
  "the first two lines of the description are `thread: NNN-slug` and `role: <id>`, before any prose";

export type PrDescriptionVerdict =
  | { readonly ok: true; readonly thread: string; readonly role: string }
  | { readonly ok: false; readonly refusals: readonly string[] };

/** Where a field's line stands in the body, 1-based — `undefined` when there is none. */
const lineOf = (lines: readonly string[], field: "thread" | "role"): number | undefined => {
  const at = lines.findIndex((line) => new RegExp(`^${field}\\s*:`, "i").test(line));
  return at === -1 ? undefined : at + 1;
};

/**
 * The body a role is about to open a pull request with — refused BY NAME, field by field.
 * `isKnownRole` is the config's own registry: a role that does not exist in the protocol
 * config is a turn nobody can be handed, and it is caught here rather than at the notifier.
 */
export const judgePrDescription = (input: {
  readonly body: string;
  readonly isKnownRole: (id: string) => boolean;
}): PrDescriptionVerdict => {
  const lines = input.body.split("\n");
  const refusals: string[] = [];

  const thread = threadOfDescription(input.body);
  const threadAt = lineOf(lines, "thread");
  if (thread === undefined) {
    refusals.push(
      threadAt === undefined
        ? "the description names no thread — no `thread: NNN-slug` line in it at all"
        : `line ${threadAt} looks like the thread line but does not read \`thread: <slug>\`: '${lines[threadAt - 1]}'`,
    );
  } else if (threadAt !== 1) {
    refusals.push(
      `\`thread:\` stands on line ${threadAt}, not on line 1 — in the footer it is found by nobody`,
    );
  }

  const role = roleOfDescription(input.body);
  const roleAt = lineOf(lines, "role");
  if (role === undefined) {
    refusals.push(
      roleAt === undefined
        ? "the description names no role — no `role: <id>` line in it at all, and it is what tells the notifiers whose turn it is after the run and after the merge"
        : // The placeholder of the template lands here, and deliberately: `role: <id>` is
          // not a role, it is the shape of one.
          `line ${roleAt} looks like the role line but does not read \`role: <id>\`, a lowercase id (\`[a-z][a-z0-9-]*\`): '${lines[roleAt - 1]}'`,
    );
  } else if (roleAt !== 2) {
    refusals.push(`\`role:\` stands on line ${roleAt}, not on line 2 — the two fields come first`);
  } else if (!input.isKnownRole(role)) {
    refusals.push(`role '${role}' is not listed in the protocol config`);
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, thread: thread as string, role: role as string };
};
