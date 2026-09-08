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
import type { ChecksReading, PullRequestFacts, ReviewRunFact, ReviewRunReading } from "./gate.js";

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
 * THE SAME PAYLOAD MINUS THE ONE NODE GITHUB MAY REFUSE (thread 160) — every field above
 * except `statusCheckRollup`, and it exists because the refusal is NOT a refusal of the
 * pull request.
 *
 * Measured by john on 2026-09-07 against a PRIVATE repository, with a fine-grained token:
 * `commits/<sha>/check-runs` answers 403, and inside `gh pr view` the elements of
 * `statusCheckRollup.contexts.nodes` each come back `FORBIDDEN` — while `pulls/N/reviews`
 * answers the verdict, `actions/runs?head_sha=` answers both runs with `conclusion:
 * success`, and even the failing GraphQL query itself carries `statusCheckRollup.state:
 * "SUCCESS"`. But `gh` exits 2 and prints NOTHING on stdout, so one forbidden node takes
 * the whole door with it — including guard 1, which needs no checks at all. A
 * fine-grained token has no `checks` permission to grant (there is none), and it reads
 * public repositories unconditionally: that is why THIS contour, being public, never saw
 * the class in six weeks while the consumer's private one paid for it in hand-pushed PRs.
 *
 * So the door asks a second time WITHOUT the node it was refused, and takes the checks
 * from the runs of Actions instead ({@link checksFromWorkflowRuns}). Nothing else about
 * the payload changes — the fields guards 1, 3 and 4 are computed from are pinned here
 * exactly as above, for exactly the same reason.
 */
export const ghPullRequestWithoutChecksSchema = ghPullRequestSchema.omit({
  statusCheckRollup: true,
});

export type GhPullRequestWithoutChecks = z.infer<typeof ghPullRequestWithoutChecksSchema>;

/**
 * THE SENTENCE GITHUB REFUSES A RESOURCE WITH — and it NAMES THE ACTOR, which is the whole
 * reason this is one shared expression instead of the literal string both readers below
 * used to carry.
 *
 * `Resource not accessible by integration` is how an INSTALLATION token is refused, and for
 * six weeks it was the only form written down here — because inside Actions, as a GitHub
 * App, it is the only form this contour had ever been answered with. A FINE-GRAINED
 * PERSONAL TOKEN is refused with `Resource not accessible by personal access token`, and
 * THAT is the form the consumer's private repository answers a session's own token with:
 * measured by john on 2026-09-08 against the installed `0.2.13` (thread 172), where the
 * whole door still died with no guard printed at all. The repair of thread 160 was correct
 * in every other part and never fired, because it did not recognise the refusal it was
 * written for — the class it was measured from had been reported in the OTHER wording.
 *
 * So the actor is read as whatever GitHub put there, and the decision keeps being made by
 * the PATH — which is the fact this file has trusted since thread 026. The actor is bounded
 * to one line and to the text before the parenthesis on purpose: the message of
 * `execFileSync` begins with the echoed command line, and a form with no path named must
 * keep answering "no path" rather than reach forward into somebody else's parentheses.
 */
const notAccessibleBy = /\bnot accessible by [^(\n]*/i;

/** The same sentence, with the path GitHub named captured out of it. */
const notAccessibleByPath = /\bnot accessible by [^(\n]*\(([^)]*)\)/i;

/**
 * WHETHER THIS REFUSAL IS ABOUT THE CHECKS NODE AND NOTHING ELSE — the path GitHub named,
 * or `undefined` when the refusal is about something the second ask would not repair.
 *
 * READS THE NAMED PATH, NEVER THE WORD (thread 026, and it is the whole reason this is a
 * function): the message of `execFileSync` carries the ECHOED COMMAND LINE, and that line
 * contains `statusCheckRollup` on EVERY failure — a `Could not resolve to a Repository`
 * included. A predicate that matched the word would drop the node on a refusal that had
 * nothing to do with it and then report the second failure instead of the first.
 *
 * AND NEVER THE ACTOR EITHER (thread 172): see {@link notAccessibleBy} for what reading one
 * actor cost.
 */
export const forbiddenChecksRollup = (message: string): string | undefined => {
  if (!notAccessibleBy.test(message)) return undefined;
  const path = notAccessibleByPath.exec(message)?.[1]?.trim();
  if (path === undefined || path.length === 0) return undefined;
  return /(^|\.)statusCheckRollup(\.|$)/i.test(path) ? path : undefined;
};

/**
 * THE RUNS OF ACTIONS READ AS CHECKS (thread 160) — the substitute source guard 2 judges
 * when `statusCheckRollup` was refused.
 *
 * REST answers in lower case (`completed`, `success`) where GraphQL answers in upper
 * (`COMPLETED`, `SUCCESS`), and the gate's green set is the GraphQL one — so the words are
 * folded up here, at the boundary, and the guard keeps one vocabulary. `state` is left
 * absent on purpose: a workflow run is a check run, never a status context, and inventing
 * a `state` for it would make {@link checkIsGreen} read it by the wrong branch.
 *
 * WIDER THAN THE ROLLUP, AND ONLY IN THE CLOSING DIRECTION: `actions/runs?head_sha=`
 * answers every run on the commit, including ones the rollup would not carry (a
 * `workflow_dispatch`, a rerun). An extra run can turn a green answer into a red one and
 * never the other way, which is the side of the error a merge door is allowed to be on.
 */
export const checksFromWorkflowRuns = (
  runs: readonly ReviewRunFact[],
): PullRequestFacts["checks"] =>
  runs.map((run) => ({
    name: run.name ?? "?",
    status: run.status?.toUpperCase(),
    conclusion: run.conclusion?.toUpperCase(),
    state: undefined,
    // A finished run last spoke at `updated_at`; a flying one has only `created_at`, which
    // is also the stamp the base drift note dates a reading against (023.3).
    completedAt: run.updatedAt,
    startedAt: run.createdAt,
  }));

/**
 * THE CHEAP HALF OF THE SCHEDULER'S READ (thread 019, point 5): what `gh pr list` says
 * about every open pull request. Four fields, and each earns its place — the number to
 * ask about, the head that tells a moved PR from a still one (the cache key), the
 * description whose `thread:` line says whose PR it is, and `mergeable`, which rides along
 * in the same `--json` FOR ZERO EXTRA CALLS (thread 097, half 2: that is the free first
 * ask the watchman of mergeability is built on). Loose for the same reason the full schema
 * is: this payload grows on somebody else's schedule.
 *
 * `mergeable` IS OPTIONAL HERE AND NOWHERE PROMISED. GitHub omits it, nulls it, and serves
 * it stale, and a single answer is not a verdict at all (`mergeability.ts`) — so a reader
 * that treats its absence as a fact about the branch is already wrong. Every caller of
 * this schema takes it as one sample.
 */
export const ghOpenPullRequestsSchema = z.array(
  z.looseObject({
    number: z.number().int(),
    headRefOid: z.string().min(1),
    body: z.string(),
    mergeable: nullableText,
    /**
     * The labels, as `gh pr list --json labels` answers them. DEFAULTED rather than
     * required: this schema reads somebody else's payload, and a field the caller did not
     * ask for must not turn a readable answer into a refusal that stands the whole tier
     * down (thread 063).
     */
    labels: z.array(z.looseObject({ name: z.string() })).default([]),
  }),
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
 * The answer of `gh api actions/runs` read as a {@link ReviewRunReading} — INCLUDING its
 * refusals, which is the whole reason this is a function and not two lines at the call
 * site. A throw of `gh`, a body that is not JSON and a body that is not the shape we read
 * are three different sentences a human can act on, and all three land in the same
 * honest state: unreadable, with what GitHub said quoted.
 */
export const readReviewRuns = (input: {
  readonly workflow: string;
  readonly ask: () => string;
}): ReviewRunReading => {
  let raw: string;
  try {
    raw = input.ask();
  } catch (error) {
    const message = (error as Error).message.trim();
    return {
      state: "unreadable",
      workflow: input.workflow,
      reason: `${message}${ghRefusalHint(message)}`,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    return {
      state: "unreadable",
      workflow: input.workflow,
      reason: `the answer is not JSON: ${(error as Error).message.trim()}`,
    };
  }
  const parsed = ghWorkflowRunsSchema.safeParse(body);
  if (!parsed.success)
    return {
      state: "unreadable",
      workflow: input.workflow,
      reason: `the answer is not the shape this command reads: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  return { state: "read", workflow: input.workflow, runs: reviewRunFacts(parsed.data) };
};

/**
 * THE PAYLOAD OF `gh` READ AS THE FACTS THE GUARDS JUDGE — one mapping, because there
 * are now two callers (thread 019, point 5): the merge door and the scheduler's
 * merge-ready reader. A second copy of it would be a second reading of `commits`, of the
 * empty-string absences and of `name ?? context`, which is exactly the drift the shared
 * guard function exists to prevent.
 */
export const pullRequestFacts = (
  /**
   * The payload — WITH the checks node, or without it when GitHub refused that one node
   * (thread 160). Without it, `checks` comes from {@link ChecksReading} and the absence is
   * never read as "no checks reported": that sentence is guard 2's answer for a head
   * NOBODY confirmed, and it is not the answer for a head we were not allowed to look at.
   */
  pr: GhPullRequest | (GhPullRequestWithoutChecks & { readonly statusCheckRollup?: undefined }),
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
   * WHERE THE CHECKS CAME FROM (thread 160), from a fourth read — absent means the ordinary
   * path: `statusCheckRollup` arrived and is what guard 2 judges. Present means the node was
   * refused and this is the substitute, in either of its two states.
   */
  checksReading?: ChecksReading | undefined,
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
  checks: (pr.statusCheckRollup ?? []).map((check) => ({
    // A flying run answers `conclusion: ""`, not null — the gate reads emptiness as
    // absence itself (D3), so the mapping stays a mapping.
    name: check.name ?? check.context ?? "?",
    status: check.status ?? undefined,
    conclusion: check.conclusion ?? undefined,
    state: check.state ?? undefined,
    completedAt: check.completedAt ?? undefined,
    startedAt: check.startedAt ?? undefined,
  })),
  checksReading,
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
 *
 * AND IT READS WHICH ACTOR WAS REFUSED (thread 172). "Add `checks: read`" is advice about a
 * `permissions:` block, and it has an addressee: an installation token. Told to the holder
 * of a FINE-GRAINED PERSONAL TOKEN it sends them after a permission that does not exist —
 * the fine-grained set has no `checks` at all, which is exactly why the consumer's private
 * repository refuses this node to every token they can mint. For that actor the sentence
 * says what is true instead: the node is out of reach and the door reads the checks from
 * the runs of Actions.
 *
 * BUT THAT SENTENCE IS ABOUT AN ACTION THE DOOR ONLY TAKES ON ONE PATH, so it is gated by
 * the SAME decision that takes it — {@link forbiddenChecksRollup}, the path, and not the
 * actor (found by the reviewer of #341, thread 172). Read by the actor alone it promised
 * "the door drops the refused node and reads the checks from the runs of Actions" for a
 * `repository.projectV2` refused to the same personal token — where no second ask happens
 * at all and the call dies with `was not read through gh`. A hint that describes a repair
 * the door did not perform is the defect of thread 026 in a third wording: it talks over
 * the fact instead of reading it. Off that path the sentence says what is true — nothing
 * substitutes, and the read did not happen.
 */
export const ghRefusalHint = (message: string): string => {
  if (!notAccessibleBy.test(message)) return "";
  const path = notAccessibleByPath.exec(message)?.[1]?.trim();
  const named = path === undefined || path.length === 0 ? undefined : path;
  const where = named === undefined ? "the path it refused" : `\`${named}\``;
  if (/not accessible by [^(\n]*personal access token/i.test(message))
    return forbiddenChecksRollup(message) === undefined
      ? ` — GitHub refuses a resource by name, not a token by scope: ${where} was refused to a PERSONAL ACCESS TOKEN, and the fine-grained set has no permission that grants every resource — some have none to add at all. This path is NOT the checks node the door asks a second time without, so nothing stands in for it: the call failed whole, and whatever needed ${where} was not read`
      : ` — GitHub refuses a resource by name, not a token by scope: ${where} was refused to a PERSONAL ACCESS TOKEN, and a fine-grained one has no \`checks\` permission to grant — this node is out of reach of any token you can mint for a private repository. Not a scope to add: the door drops the refused node and reads the checks from the runs of Actions on the head instead`;
  const scope =
    named !== undefined && /workflowRun|checkSuite/i.test(named)
      ? "an Actions resource — `actions: read`"
      : named !== undefined && /statusCheckRollup|commit/i.test(named)
        ? "a Checks resource — `checks: read`"
        : "likely `checks: read` or `actions: read`";
  return ` — GitHub refuses a resource by name, not a token by scope: ${where} is ${scope}. A guess and not the cause: an installation token carries only what its job's \`permissions:\` lists, and \`claude-code-action\` exchanges only what \`additional_permissions\` asks for — unlisted is zeroed, not defaulted. Read the path above before adding a scope`;
};

/**
 * THE ONE FIELD OUT OF A RAW `gh pr view` PAYLOAD, without judging the rest of it (thread
 * `097`): what {@link readMergeability} samples between its asks.
 *
 * Deliberately not `ghPullRequestSchema` — the shape check belongs at the door, once, on
 * the payload the verdict is finally computed from, and a caller asking "what word did it
 * say this time" must not be made to parse reviews and files to hear it. A payload that is
 * not JSON, or carries no `mergeable`, answers `undefined`; the reading then never settles
 * on a word, and the schema refusal that follows names the real defect.
 */
export const mergeableWordOf = (raw: string): string | undefined => {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const value = (payload as { readonly mergeable?: unknown } | null)?.mergeable;
  return typeof value === "string" ? value : undefined;
};
