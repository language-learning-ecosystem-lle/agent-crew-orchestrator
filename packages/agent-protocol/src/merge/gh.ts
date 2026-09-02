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
 * `statusCheckRollup` IS NOT ASKED FOR AT ALL, and its absence is the repair of thread
 * 120 (john's facts of 2026-09-02). Three measured reasons, in the order they bite:
 *
 *  1. THE WHOLE CALL DIES FOR IT. `gh pr view` asks for that field in ONE request with
 *     `body`, `reviews`, `files`, `headRefOid`; a token that may not read it gets
 *     `Resource not accessible by personal access token (…statusCheckRollup…)` and the
 *     request answers NOTHING — so guards 1, 2, 4 and the `thread:` line go down together
 *     over a field only guard 2 used.
 *  2. NO TOKEN CAN BE GIVEN THE RIGHT. `Checks` is not in the repository permissions of a
 *     fine-grained PAT at all (it exists for GitHub Apps only), so this is not a setting
 *     anybody can fix on the box — it is a source that has to change.
 *  3. THE REFUSED HALF IS EMPTY HERE ANYWAY. The path GitHub names ends in
 *     `statusCheckRollup.contexts.nodes.N` — commit statuses — and this project creates
 *     none: on head `0a612b27` the combined status carried `statuses: 0` while Actions
 *     carried ten runs. The call paid a total refusal for zero rows.
 *
 * The outcome of the checks now comes from `actions/runs?head_sha=<head>` instead
 * ({@link ghWorkflowRunsSchema}), which the same token reads — one read that already
 * happened for guard 1 and now serves guard 2 beside it.
 *
 * `reviews[].submittedAt` tells a second round from the verdict it
 * replaced (D4). `commits` is asked for BESIDE `reviews`:
 * the head commit's `committedDate` is what tells a verdict about this head from one
 * merely SHOWN against it, and it is the one fact a substituted anchor cannot fake
 * (thread 043).
 *
 * `mergeable` IS PINNED like the rest of the computed-from fields (D2): the door
 * refuses on anything that is not `MERGEABLE`, so its silent absence would be the very
 * fail-open this schema exists to prevent.
 */

import { z } from "zod";
import type { CheckRunReading, PullRequestFacts, ReviewRunFact, ReviewRunReading } from "./gate.js";

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
  files: z.array(z.looseObject({ path: z.string() })),
  // THE NAME OF THE BASE BRANCH (023.4) — the branch, not a SHA, and that is the whole
  // repair: `baseRefOid` was read here first and it is the base recorded when the branch
  // was CUT. It stands still exactly when the base moves, so the drift it was read for was
  // unreachable by construction (measured 2026-08-03: #192 said `44471804` while `main`
  // was `6b87776f`; #3, opened 24.07, still says a July commit). The head of the branch is
  // asked for by name, in a second read. NOT pinned, unlike the fields above, and for the
  // reason that decides everything else about this reading: no guard is computed from it.
  // A payload without it makes the door SAY it cannot tell whether the base moved; a
  // payload without `mergeable` makes it refuse. The two absences are not the same class.
  baseRefName: nullableText,
  mergeable: z.string(),
  mergeStateStatus: nullableText,
});

export type GhPullRequest = z.infer<typeof ghPullRequestSchema>;

/**
 * THE CHEAP HALF OF THE SCHEDULER'S READ (thread 019, point 5): what `gh pr list` says
 * about every open pull request. Three fields, and each earns its place — the number to
 * ask about, the head that tells a moved PR from a still one (the cache key), and the
 * description whose `thread:` line says whose PR it is. Loose for the same reason the
 * full schema is: this payload grows on somebody else's schedule.
 */
export const ghOpenPullRequestsSchema = z.array(
  z.looseObject({ number: z.number().int(), headRefOid: z.string().min(1), body: z.string() }),
);

/**
 * THE CHEAPEST READ OF ALL — the three facts the door of a `run:` park needs (thread 062):
 * which head the park would wait on, whether GitHub will assemble a merge ref for this pull
 * request at all, and whether ANY run exists on that head.
 *
 * Its own schema rather than {@link ghPullRequestSchema}: that one asks for reviews, commits
 * and files, which the question "is there a run" has no use for, and this call sits in the
 * hot path of an ordinary message. Loose for the same reason as the rest — somebody else's
 * payload grows — and the three fields it computes from are pinned, so a rename is caught by
 * name instead of being read as "no runs" (which here would REFUSE a legal park).
 */
export const ghRunParkSchema = z.looseObject({
  headRefOid: z.string().min(1),
  mergeable: z.string(),
  // `status`/`state` ARE READ, NOT PINNED (thread 032): the door asks not only whether a run
  // exists on this head but whether one is STILL IN FLIGHT — a park behind a round that has
  // already finished waits for an event that has already happened. A check run says
  // `status: QUEUED|IN_PROGRESS|COMPLETED`, a status context says `state: PENDING|SUCCESS|…`,
  // and the two shapes live in the same array; an entry carrying neither is read as finished,
  // which is the direction that does not refuse a legal park on a payload we stopped
  // understanding (see {@link pendingRunsOf}).
  statusCheckRollup: z
    .array(z.looseObject({ status: nullableText, state: nullableText }))
    .nullish(),
});

/**
 * THE ROUNDS OF REVIEW ON A HEAD (thread 027) — `repos/{owner}/{repo}/actions/runs`, the
 * one API that still knows WHICH TREE a round of review read. Loose like the rest, and
 * NOTHING here is pinned: this reading has a third state of its own (`by-hand`), so a
 * payload that lost a field must degrade into that state with GitHub's own words rather
 * than throw — the guard says "unverified", never "verified" and never "refused for
 * everyone". `head_sha`, `event`, `status`, `conclusion` and the window are the fields the
 * anchor is computed from, and a run missing any of them simply anchors nothing.
 */
export const ghWorkflowRunsSchema = z.looseObject({
  workflow_runs: z.array(
    z.looseObject({
      id: z.number().int().nullish(),
      name: nullableText,
      head_sha: nullableText,
      event: nullableText,
      status: nullableText,
      conclusion: nullableText,
      created_at: nullableText,
      updated_at: nullableText,
    }),
  ),
});

export type GhWorkflowRuns = z.infer<typeof ghWorkflowRunsSchema>;

/** The runs of the answer as the guard reads them — a mapping and nothing else. */
export const reviewRunFacts = (payload: GhWorkflowRuns): readonly ReviewRunFact[] =>
  payload.workflow_runs.map((run) => ({
    id: run.id ?? undefined,
    name: run.name ?? undefined,
    headSha: run.head_sha ?? undefined,
    event: run.event ?? undefined,
    status: run.status ?? undefined,
    conclusion: run.conclusion ?? undefined,
    createdAt: run.created_at ?? undefined,
    updatedAt: run.updated_at ?? undefined,
  }));

/**
 * The answer of `gh api actions/runs` read as runs OR as the reason there are none —
 * INCLUDING its refusals, which is the whole reason this is a function and not two lines
 * at the call site. A throw of `gh`, a body that is not JSON and a body that is not the
 * shape we read are three different sentences a human can act on, and all three land in
 * the same honest state: unreadable, with what GitHub said quoted.
 *
 * ONE READING, TWO GUARDS (thread 120): guard 1 asks which round produced the verdict and
 * guard 2 asks how the checks ended, and both are answers of this one payload. They are
 * built from the SAME call at the call site — a second `gh api` for the second guard would
 * be a second moment, and two guards judging two moments is the class of defect this
 * module already carries a note about.
 */
export const readWorkflowRuns = (
  ask: () => string,
): { readonly runs: readonly ReviewRunFact[] } | { readonly reason: string } => {
  let raw: string;
  try {
    raw = ask();
  } catch (error) {
    const message = (error as Error).message.trim();
    return { reason: `${message}${ghRefusalHint(message)}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    return { reason: `the answer is not JSON: ${(error as Error).message.trim()}` };
  }
  const parsed = ghWorkflowRunsSchema.safeParse(body);
  if (!parsed.success)
    return {
      reason: `the answer is not the shape this command reads: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  return { runs: reviewRunFacts(parsed.data) };
};

/** {@link readWorkflowRuns} as guard 1 reads it — the runs under the workflow it was told about. */
export const readReviewRuns = (input: {
  readonly workflow: string;
  readonly ask: () => string;
}): ReviewRunReading => {
  const answer = readWorkflowRuns(input.ask);
  return "reason" in answer
    ? { state: "unreadable", workflow: input.workflow, reason: answer.reason }
    : { state: "read", workflow: input.workflow, runs: answer.runs };
};

/** {@link readWorkflowRuns} as guard 2 reads it — every run on the head, workflow or not. */
export const readCheckRuns = (ask: () => string): CheckRunReading => {
  const answer = readWorkflowRuns(ask);
  return "reason" in answer
    ? { state: "unreadable", reason: answer.reason }
    : { state: "read", runs: answer.runs };
};

/**
 * THE RUNS OF THIS HEAD AS THE ATTEMPTS GUARD 2 JUDGES (thread 120) — the mapping that
 * replaces `statusCheckRollup`, and the place the ANCHOR TO THE HEAD is enforced.
 *
 * The filter on `head_sha` is not a tidiness: `actions/runs` is asked WITH the head in the
 * query, but a payload is somebody else's and this door has twice paid for an outcome read
 * off another slice of the repository. A run that does not name this head anchors nothing
 * and is dropped by name, not read charitably.
 *
 * `updated_at` becomes `completedAt` ONLY for a finished run — for one still in flight it is
 * the moment it last spoke, and calling that "completed" would let an unfinished attempt
 * overtake the finished one it is retrying (D1 reads the stamps to tell reruns apart).
 */
export const checkFactsFromRuns = (
  runs: readonly ReviewRunFact[],
  head: string,
): PullRequestFacts["checks"] =>
  runs
    .filter((run) => (run.headSha ?? "").toLowerCase() === head.toLowerCase())
    .map((run) => ({
      name: run.name ?? "?",
      status: run.status ?? undefined,
      conclusion: run.conclusion ?? undefined,
      state: undefined,
      completedAt:
        (run.status ?? "").toLowerCase() === "completed" ? (run.updatedAt ?? undefined) : undefined,
      startedAt: run.createdAt ?? undefined,
    }));

/**
 * THE PAYLOAD OF `gh` READ AS THE FACTS THE GUARDS JUDGE — one mapping, because there
 * are now two callers (thread 019, point 5): the merge door and the scheduler's
 * merge-ready reader. A second copy of it would be a second reading of `commits`, of the
 * empty-string absences and of `name ?? context`, which is exactly the drift the shared
 * guard function exists to prevent.
 */
export const pullRequestFacts = (
  pr: GhPullRequest,
  /**
   * THE HEAD OF THE BASE BRANCH AS IT IS NOW, and its commit date (023.3, repaired 023.4).
   * Both arrive from a SECOND read — `gh pr view` dates the PR's own commits, never the
   * base's, and the SHA it does report for the base is the one the branch was cut from
   * (see `baseRefName` above) — so this is a parameter and not a field of the payload: a
   * caller with no use for the drift note (the scheduler) simply does not pay for the
   * call, and the note says "unknown" instead of guessing.
   *
   * The two halves travel TOGETHER because they are one measurement: a SHA from the
   * payload dated by a commit read elsewhere is exactly the pair that produced the silent
   * no-op this repairs.
   */
  baseHead?: { readonly sha: string; readonly committedAt: string } | undefined,
  /**
   * THE ROUNDS OF REVIEW ON THE HEAD (thread 027), from a third read — `gh pr view` knows
   * nothing about runs. A parameter for the same reason the base head is one: the caller
   * that has no use for the anchor (the scheduler) does not pay for the call, and the
   * guard then says `by-hand` instead of guessing.
   */
  reviewRuns?: ReviewRunReading | undefined,
  /**
   * THE RUNS ON THE HEAD AS GUARD 2'S SOURCE (thread 120) — the same payload as
   * {@link reviewRuns}, read without the workflow filter. A parameter and not a field for
   * the reason the two above are: a caller that does not ask Actions gets `not-asked`, and
   * guard 2 then REFUSES BY NAME instead of reading "no checks" as "nothing confirmed" and
   * "everything green" alike.
   */
  checkRuns?: CheckRunReading | undefined,
): PullRequestFacts => ({
  number: pr.number,
  headSha: pr.headRefOid,
  body: pr.body,
  reviews: pr.reviews.map((review) => ({
    state: review.state,
    commitSha: review.commit?.oid,
    author: review.author?.login,
    // The stamp guard 1 tells a second round of review by (D4).
    submittedAt: review.submittedAt ?? undefined,
  })),
  // When the head commit was made — a verdict older than it answered about code that
  // did not exist yet (thread 043). Only the head's own entry counts.
  headCommittedAt:
    pr.commits.find((commit) => commit.oid === pr.headRefOid)?.committedDate ?? undefined,
  reviewRuns,
  checkRuns,
  checks:
    checkRuns !== undefined && checkRuns.state === "read"
      ? checkFactsFromRuns(checkRuns.runs, pr.headRefOid)
      : [],
  changedPaths: pr.files.map((file) => file.path),
  baseSha: baseHead?.sha,
  baseCommittedAt: baseHead?.committedAt,
  mergeable: pr.mergeable,
  mergeStateStatus: pr.mergeStateStatus ?? undefined,
});

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
