/**
 * THE EXTERNAL BOUNDARY OF THE MERGE GATE: what `gh pr view --json` answers — and, at
 * the foot of the file, how its REFUSAL is read when it answers nothing.
 *
 * Not strict, on purpose — this is somebody else's payload and it grows: a new field
 * in `gh` must not turn into a refusal here. What IS pinned is every field the
 * verdict is computed from, so a RENAME on their side is caught at the door with the
 * name of the missing field rather than silently read as "no reviews, no checks" —
 * which, for a merge gate, would fail open.
 *
 * `statusCheckRollup` is a union of two node types and is flattened into one loose
 * shape: a check run answers with `name`/`status`/`conclusion`, a status context
 * with `context`/`state`. Both halves are optional here and the gate reads whichever
 * arrived. The STAMPS (`completedAt`, `startedAt`) are optional for the same reason —
 * a status context has neither — but they are what tells a rerun from the attempt it
 * replaced, so they are asked for (thread 026, D1). `reviews[].submittedAt` is there for
 * the same reason on the verdict side (D4). `commits` is asked for BESIDE `reviews`:
 * the head commit's `committedDate` is what tells a verdict about this head from one
 * merely SHOWN against it, and it is the one fact a substituted anchor cannot fake
 * (thread 043).
 *
 * `mergeable` IS PINNED like the rest of the computed-from fields (D2): the door
 * refuses on anything that is not `MERGEABLE`, so its silent absence would be the very
 * fail-open this schema exists to prevent.
 */

import { z } from "zod";

const nullableText = z.string().nullish();

export const ghPullRequestSchema = z.looseObject({
  number: z.number().int(),
  headRefOid: z.string().min(1),
  body: z.string(),
  reviews: z.array(
    z.looseObject({
      state: z.string(),
      commit: z.looseObject({ oid: z.string() }).nullish(),
      author: z.looseObject({ login: z.string() }).nullish(),
      // The stamp that tells a second round from the verdict it replaced (D4); optional
      // for the same reason the check stamps are — a payload without it is judged whole.
      submittedAt: nullableText,
    }),
  ),
  // THE AGE OF THE HEAD COMMIT (thread 043): the one fact about the head that a
  // substituted review anchor cannot fake — a verdict older than this commit answered
  // about code that did not exist yet. PINNED like the rest of the computed-from fields:
  // guard 1 refuses on it, so losing the field silently would put the fail-open back
  // exactly where it was. `committedDate` per entry is optional — the gate takes the one
  // whose `oid` is the head and reads nothing into a commit gh did not date.
  commits: z.array(
    z.looseObject({
      oid: z.string(),
      committedDate: nullableText,
    }),
  ),
  statusCheckRollup: z.array(
    z.looseObject({
      name: nullableText,
      context: nullableText,
      status: nullableText,
      conclusion: nullableText,
      state: nullableText,
      completedAt: nullableText,
      startedAt: nullableText,
    }),
  ),
  files: z.array(z.looseObject({ path: z.string() })),
  mergeable: z.string(),
  mergeStateStatus: nullableText,
});

export type GhPullRequest = z.infer<typeof ghPullRequestSchema>;

/**
 * WHAT A REFUSAL OF `gh` PROBABLY MEANS — printed as a guess, never as the cause.
 *
 * The note this replaces asserted one: "`statusCheckRollup` needs a token with the
 * `checks: read` scope". It was wrong in both directions, measured, and both cost real
 * rounds (thread 026).
 *
 * WRONG SCOPE: three rounds in a row (#108, #109, #112) the diagnosis went to `checks`,
 * which the token already had — the field GraphQL actually refused was
 * `checkSuite.workflowRun`, an ACTIONS resource. The path GitHub names in its own
 * message said so every time; our text talked over it.
 *
 * WRONG REFUSAL: the old test also matched the word `statusCheckRollup`, which appears in
 * the ECHOED COMMAND LINE of every failure — so a `Could not resolve to a Repository`
 * (the wrong `gh` account being active, a 404 with no scope in it at all) was explained by
 * a missing scope too. Six refusals in one round of curator's, all diagnosed wrongly.
 *
 * So the hint fires only on the refusal that IS scope-shaped, it reads the path GitHub
 * named instead of assuming one, and where the path does not decide it offers both
 * candidates. The reason `gh` returned is printed by the caller either way: that is the
 * fact, and this is only a reading of it.
 */
export const ghRefusalHint = (message: string): string => {
  if (!/not accessible by integration/i.test(message)) return "";
  const path = /not accessible by integration\s*\(([^)]*)\)/i.exec(message)?.[1]?.trim();
  const named = path === undefined || path.length === 0 ? undefined : path;
  const scope =
    named !== undefined && /workflowRun|checkSuite/i.test(named)
      ? "an Actions resource — `actions: read`"
      : named !== undefined && /statusCheckRollup|commit/i.test(named)
        ? "a Checks resource — `checks: read`"
        : "likely `checks: read` or `actions: read`";
  const where = named === undefined ? "the path it refused" : `\`${named}\``;
  return ` — GitHub refuses a resource by name, not a token by scope: ${where} is ${scope}. A guess and not the cause: an installation token carries only what its job's \`permissions:\` lists, and \`claude-code-action\` exchanges only what \`additional_permissions\` asks for — unlisted is zeroed, not defaulted. Read the path above before adding a scope`;
};
