/**
 * THE EXTERNAL BOUNDARY OF THE MERGE GATE: what `gh pr view --json` answers.
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
 * arrived.
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
    }),
  ),
  statusCheckRollup: z.array(
    z.looseObject({
      name: nullableText,
      context: nullableText,
      status: nullableText,
      conclusion: nullableText,
      state: nullableText,
    }),
  ),
  files: z.array(z.looseObject({ path: z.string() })),
});

export type GhPullRequest = z.infer<typeof ghPullRequestSchema>;
