/**
 * THE MERGE GATE OF THE `curator` ROLE (thread `026-curator-merge-right`, john's
 * decision of 2026-07-27). The norm itself lives in the role card and in
 * `PROTOCOL.md`; this module is the part of it a machine can answer, and — just as
 * important — the part it CANNOT.
 *
 * Five guards stand between an approved PR and `main`:
 *
 *  1. an approve verdict of the reviewer ON THE CURRENT HEAD;
 *  2. green checks on that same head;
 *  3. ascent to a decision of john's — the PR belongs to a thread whose statement of
 *     work carries one;
 *  4. no self-merge on the DOCUMENTS OF POWER (role cards, the protocol config,
 *     whatever else the project names): a role does not accept the documents that
 *     define its own authority;
 *  5. a trace: the merge is named, with its guards, in curator's next message.
 *
 * WHAT THIS MODULE DECIDES AND WHAT IT REFUSES TO DECIDE. Guards 1, 2 and 4 are
 * facts about the pull request — a SHA either matches or it does not — and a human
 * comparing two forty-hex strings by eye is precisely the check that gets waved
 * through at the end of a long run. Guards 3 and 5 are judgements: whether the feed
 * really holds a decision of john's, and whether the merge gets written up
 * afterwards, are things no `gh` field answers. They are reported as OBLIGATIONS,
 * by name, and never as a pass — a tool that printed "all five green" would be
 * lying about two of them, and the lie would be load-bearing, because the whole
 * point of guard 3 is to stop curator merging what curator asked for.
 *
 * THE ONE MECHANICAL PART OF GUARD 3 that is checked: a PR must name its thread
 * (`thread: NNN-slug` in the description, rule 14). Without that line there is
 * nothing to ascend TO, so its absence is a refusal rather than an obligation.
 *
 * THE DOCUMENTS OF POWER ARE DERIVED, NOT LISTED IN CODE. Two sources, and neither
 * is a name this package invents: the `instructions` paths of every role (the cards
 * — that is what a card IS) and the protocol config itself (permissions and zones
 * live there). Anything else a project counts as a document of power is passed in by
 * its caller (`--power-docs`, `PROTOCOL.md` here). Hard-coding those names in the
 * package would make a project's file layout into the protocol's knowledge, which is
 * the line this package does not cross.
 *
 * AND A ROLE'S INSTRUCTIONS ARE NOT ALWAYS A DOCUMENT OF POWER (john's decision of
 * 2026-07-28, thread 026, on the reviewer's finding against the first version): the
 * boundary runs by the NATURE of the document, not by the fact that a role points at
 * it. A role card states what a role MAY do; a WORKING card (`CLAUDE.md` in this
 * repository) is the instruction a session works by, updated in the same commit as the
 * code it describes — under rule 3, in almost every package. Deriving power from the
 * `instructions` field alone made every such package a john-merge and would have eaten
 * the autonomous merge as a class, which is the very thing thread 026 exists to create.
 * So the caller names its working cards (`workingCards`) and they are subtracted from
 * the derived side — never from the DECLARED side: a path a project states outright is
 * a document of power stays one, whatever else it is.
 *
 * WHY A FLAG AND NOT A FIELD OF THE ROLE: a per-instruction `kind` is the right shape
 * and it costs a protocol version (R2, thread 028) — which currently cannot be
 * committed at all, see the note on `--power-docs` in `cli.ts`. The judgement the
 * subtraction leaves behind is a NORM in curator's card, not a hole: a change to
 * `CLAUDE.md` that moves authority, borders, permissions or zones goes to john, and
 * doubt reads as "it moves them".
 *
 * ENTRIES MATCH AS PATH PREFIXES, exactly as `zones` do (`docs/roles` covers
 * `docs/roles/curator.md`, never `docs/roles-old.md`) — one rule for "is this path
 * inside that entry", said the same way in both places.
 *
 * A HEAD ANSWERS ONCE PER CHECK NAME (curator's statement of work of 2026-07-31, D1).
 * A rerun does not replace the failed attempt in `statusCheckRollup`: both hang on the
 * same head, and reading the array flat made the door refuse #89 for a `review=FAILURE`
 * that a rerun had overwritten fifteen minutes later. So the runs are grouped by name
 * and only the LAST ATTEMPT of each name is judged — last BY TIME (`completedAt`, else
 * `startedAt`), never by position in the array, which `gh` does not promise to order.
 * The border that is easy to break in the other direction: a still-flying rerun is not
 * swallowed by an older success. The latest attempt wins, and a latest attempt that has
 * not finished has NOT ANSWERED — guard 2 is about the checks having answered on this
 * head. And when time cannot tell them apart (no stamps at all), the whole group is
 * judged, so an unreadable payload refuses rather than passes: this is a merge door.
 *
 * A HEAD ALSO ANSWERS MORE THAN ONCE PER REVIEWER (D4, the same statement of work).
 * Guard 1 read the PRESENCE of a `CHANGES_REQUESTED` on the head instead of the LAST
 * verdict on it: a second round of review that ends in `approve` on the very same head
 * left the door refusing, and #74 and #64 stood approved-and-blocked. So the verdicts
 * are grouped BY REVIEWER and only the last one of each is judged, by `submittedAt` —
 * the mirror of D1, with its symmetry kept in both directions: an `approve` overtaken
 * by a later `changes-requested` on the same head STOPS, or D4 would turn a fail-closed
 * door into a fail-open one. When the stamps cannot tell a reviewer's verdicts apart,
 * the group is judged whole, so an unreadable payload refuses; verdicts on other heads
 * are not verdicts on this one and never enter the count. States that are not a verdict
 * (`COMMENTED`, `DISMISSED`) do not overtake one — a comment is not an answer.
 *
 * A VERDICT CAN HAVE NO COMMIT AT ALL, AND `reviews[].commit` HIDES IT (thread
 * `043-merge-gate-unanchored-approve`, curator's measurement on #64 of 2026-07-31). A
 * review submitted with no `commit_id` — which is what the reviewer's action produces
 * when it is re-triggered by `workflow_dispatch`, because that run hangs on the head of
 * `main` and not on the head of the PR — comes back from `gh` carrying WHATEVER HEAD THE
 * PULL REQUEST HAS AT THE MOMENT OF READING. Curator read one and the same approve
 * (`submittedAt` 03:46:02Z, untouched) as "approved on c1dc1a3" and then, after
 * `gh pr update-branch`, as "approved on ea8572a". Read that way, an approve granted once
 * survives every later push — the exact thing guard 1 exists to forbid.
 *
 * THE FIELD THAT WOULD ADMIT IT DOES NOT EXIST, and this cost a round: the first repair
 * read the anchor out of `latestReviews`, on the belief that `commit.oid` is empty there
 * only for a verdict submitted without one. Measured across #62/#64/#108/#109/#110/#111,
 * `latestReviews[].commit.oid` is empty for EVERY review, anchored ones included — `gh`
 * simply does not resolve that field in this array. A door built on it refuses every PR
 * there is. Neither answer of `gh`, nor `commit_id` of the REST reviews endpoint, tells
 * an anchored verdict from a substituted one in a single read.
 *
 * SO THE DOOR ASKS TIME INSTEAD, and time cannot be substituted: A VERDICT CANNOT BE AN
 * ANSWER ABOUT A COMMIT THAT DID NOT EXIST WHEN IT WAS SUBMITTED. The head commit's
 * `committedDate` is read beside the reviews, and a verdict older than it is not a
 * verdict on this head, whatever commit it is shown against. It is refused in ITS OWN
 * WORDS — "a verdict older than the head commit" says "a review run on the
 * `pull_request` event is missing", which is a different repair from "no approve" (a new
 * round of review) and from "the approve is on an older head" (a rebase). The refusal
 * covers a `CHANGES_REQUESTED` in the same state too: a verdict whose target is unknown
 * does not open a merge door, whichever way it points.
 *
 * WHAT THIS CLOSES AND WHAT IT DOES NOT, said plainly. It closes the PERMANENCE, which is
 * what guard 1 is for: every push (and `gh pr update-branch`) makes a commit younger than
 * the verdict, so an approve granted once stops travelling to code nobody answered about.
 * It does NOT tell a `workflow_dispatch` verdict from a `pull_request` one while the head
 * has not moved since — and there it need not: such a run read the same tree the head
 * carries now, so its answer is about this code. The other half of that story is guard 2,
 * which a dispatch run never satisfies: its check hangs on the head of `main` and never
 * enters the `statusCheckRollup` of the PR.
 *
 * A VERDICT WITH NO STAMP that claims the head is refused as well — it cannot be shown to
 * be about the head, and this is a merge door: the same "judge the group whole when time
 * cannot tell it apart" that D1 and D4 use. A head commit whose date `gh` did not report
 * leaves the reading exactly as it was before this thread — nothing is known, nothing is
 * invented.
 *
 * AND THE AGE IS ASKED OF THE LAST VERDICT OF EACH AUTHOR, NOT OF THE HISTORY (the second
 * round of this thread, reviewer's finding on #110). Read over the whole `reviews` array,
 * the age test locked the door FOREVER on any PR where a `workflow_dispatch` run had ever
 * left a verdict: that record stays in the array, `gh` keeps showing it against the
 * current head, and the repair the refusal itself names — a run on the `pull_request`
 * event — only ADDS a verdict beside it, never removes the old one. The refusal outlived
 * its own remedy, which is the one thing a refusal must not do. So D4 comes FIRST: the
 * verdicts on the head are grouped by author, and only what survives that grouping is
 * asked its age. An author whose LAST word is anchorless still stops the door — being
 * overtaken is what clears a verdict, and nothing else does.
 *
 * AND `gh` SAYS "ABSENT" WITH AN EMPTY STRING (D3): a flying run comes back with
 * `conclusion: ""`, not `null`, so `??` reads it as a value and the refusal printed
 * `review=` — blind exactly where the reader decides whether to wait or to fix. Every
 * field of a check is read through `present()`: empty text is no text.
 *
 * MERGEABILITY IS NOT A SIXTH GUARD (D2). The five are a norm of the role card and of
 * `PROTOCOL.md`, and code does not add to them. But the door was blind to `mergeable`
 * altogether: a PR with a conflicting tree, one clean set of checks and an approve
 * would have passed guards 1, 2 and 4 "by the facts" and been refused by GitHub itself
 * at the merge. So it is read and printed as a FACT beside the guards — a refusal in
 * what GitHub would refuse anyway — and `UNKNOWN` (or a `gh` that did not report it at
 * all) is named for what it is rather than folded into "go ahead".
 */

/** One review as the gate reads it — who said what, against which commit, when. */
export type ReviewFact = {
  readonly state: string;
  readonly commitSha: string | undefined;
  readonly author: string | undefined;
  /** When it was submitted — how a second round is told from the verdict it replaced (D4). */
  readonly submittedAt?: string | undefined;
};

/** The facts about a pull request the gate judges — the shape `gh pr view --json` gives. */
export type PullRequestFacts = {
  readonly number: number;
  /** `headRefOid`: the commit the verdict and the checks have to be about. */
  readonly headSha: string;
  /** The PR description, where the `thread:` line lives (rule 14). */
  readonly body: string;
  /** `reviews`: state plus the commit it was submitted against — the commit BEING SUBSTITUTED with the current head when the verdict has none (thread 043). */
  readonly reviews: readonly ReviewFact[];
  /**
   * `committedDate` of the head commit — the one fact a substituted anchor cannot fake
   * (thread 043): a verdict older than it answered about code that did not exist yet.
   * Absent means gh was not asked (or did not say): then the anchors of `reviews` are
   * taken as given, which is the behaviour that let the defect through.
   */
  readonly headCommittedAt?: string | undefined;
  /** `statusCheckRollup`: check runs (status/conclusion) and status contexts (state) alike. */
  readonly checks: readonly {
    readonly name: string;
    readonly status: string | undefined;
    readonly conclusion: string | undefined;
    readonly state: string | undefined;
    /** When this attempt finished — how a rerun is told from the run it replaced. */
    readonly completedAt?: string | undefined;
    /** When it started — the only stamp a still-flying attempt has. */
    readonly startedAt?: string | undefined;
  }[];
  /** `files[].path`, repository-relative. */
  readonly changedPaths: readonly string[];
  /**
   * The head of the branch this PR merges INTO, AS MEASURED NOW — the branch asked for by
   * name, not the `baseRefOid` of the payload, which is the base the branch was cut from
   * (023.4). Guard 2 does not judge it and never will (023.3) — it is read so the door can
   * SAY that the base moved under the green check it is crediting. Absent means gh was not
   * asked (the scheduler never asks) or could not answer.
   */
  readonly baseSha?: string | undefined;
  /** `committedDate` of {@link baseSha} — when the base last moved; see {@link baseDriftOf}. */
  readonly baseCommittedAt?: string | undefined;
  /** `mergeable`: `MERGEABLE` / `CONFLICTING` / `UNKNOWN` — absent means gh did not say. */
  readonly mergeable?: string | undefined;
  /** `mergeStateStatus`: `CLEAN` / `DIRTY` / `BLOCKED` …, printed beside the verdict. */
  readonly mergeStateStatus?: string | undefined;
};

export type GateState =
  /** A fact was checked and holds. */
  | "pass"
  /** A fact was checked and does not hold — merge is refused. */
  | "fail"
  /** Not a fact: the guard stays with whoever merges, and is named so it cannot be forgotten. */
  | "by-hand";

export type GateOutcome = {
  readonly guard: number;
  readonly title: string;
  readonly state: GateState;
  readonly detail: string;
};

/**
 * What GitHub itself says about applying the branch — a fact beside the guards, not one
 * of them (see the header). `blocked` refuses the merge exactly as a failed guard does.
 */
export type Mergeability = {
  readonly state: "clear" | "blocked";
  readonly detail: string;
};

export type MergeGateVerdict = {
  readonly number: number;
  readonly headSha: string;
  /** No guard failed AND no document of power is touched: curator may merge, guards 3 and 5 permitting. */
  readonly curatorMayMerge: boolean;
  readonly guards: readonly GateOutcome[];
  readonly mergeability: Mergeability;
  /**
   * What guard 2 does not ask (023.3) — said beside it and counted in NOTHING: see
   * {@link baseDriftOf}. Never a guard, never a state, never part of `curatorMayMerge`.
   */
  readonly baseDrift: BaseDrift;
};

/** Normalised prefix: no leading `./`, no trailing slash. Same normalisation as `zones`. */
const normalise = (entry: string): string => entry.replace(/^\.\//, "").replace(/\/+$/, "");

const underPrefix = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * The documents of power of this repository: every role's instruction paths MINUS the
 * working cards, the protocol config itself, and whatever the caller adds
 * (`--power-docs`). Deduplicated, order of first appearance kept — the list is printed
 * to a human.
 */
export const powerDocuments = (input: {
  readonly roles: readonly {
    readonly instructions?: readonly { readonly path: string }[] | undefined;
  }[];
  readonly configPath: string;
  readonly declared?: readonly string[] | undefined;
  /** Instruction paths that are WORKING cards, not documents of power (see the header). */
  readonly workingCards?: readonly string[] | undefined;
}): readonly string[] => {
  const seen = new Set<string>();
  const push = (entry: string): void => {
    const normalised = normalise(entry);
    if (normalised.length > 0) seen.add(normalised);
  };
  const working = new Set((input.workingCards ?? []).map(normalise).filter((e) => e.length > 0));
  push(input.configPath);
  for (const role of input.roles)
    for (const doc of role.instructions ?? []) {
      if (!working.has(normalise(doc.path))) push(doc.path);
    }
  // The declared side is NOT filtered: naming a path outright outranks calling it a
  // working card, and a caller that says both things means the stricter one.
  for (const entry of input.declared ?? []) push(entry);
  return [...seen];
};

/**
 * The working cards a caller named that no role actually points at — a flag that hits
 * nothing is a flag whose author believes it is doing something. Printed, never fatal:
 * a role may lose its card between two runs of the gate.
 */
export const unmatchedWorkingCards = (input: {
  readonly roles: readonly {
    readonly instructions?: readonly { readonly path: string }[] | undefined;
  }[];
  readonly workingCards: readonly string[];
}): readonly string[] => {
  const instructions = new Set(
    input.roles.flatMap((role) => (role.instructions ?? []).map((doc) => normalise(doc.path))),
  );
  return input.workingCards
    .map(normalise)
    .filter((entry) => entry.length > 0 && !instructions.has(entry));
};

/** The changed paths that are documents of power — the whole of guard 4. */
export const touchedPowerDocuments = (input: {
  readonly changedPaths: readonly string[];
  readonly powerDocs: readonly string[];
}): readonly string[] =>
  input.changedPaths
    .map(normalise)
    .filter((path) => input.powerDocs.some((prefix) => underPrefix(path, prefix)));

/**
 * The `thread: NNN-slug` line of a PR description (rule 14). The line the reviewer
 * checks the scope against, and the only machine-readable half of guard 3.
 */
export const threadOfDescription = (body: string): string | undefined => {
  const match = /^thread:\s*(\S+)\s*$/m.exec(body);
  return match?.[1];
};

/**
 * A check is green when it FINISHED and did not fail. `NEUTRAL` and `SKIPPED` count
 * as green (a skipped job is a job the workflow decided not to run — the reviewer's
 * own action skips itself on a workflow change by design); anything still running is
 * not green, because guard 2 is about the checks having ANSWERED on this head.
 */
const greenConclusions = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const greenStates = new Set(["SUCCESS", "EXPECTED"]);

/** `gh` says "no value" with an empty string as readily as with null — both are absent. */
const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/** A check with every field read through `present()` — the shape the guard reasons about. */
type Attempt = {
  readonly name: string;
  readonly status: string | undefined;
  readonly conclusion: string | undefined;
  readonly state: string | undefined;
  /** The moment this attempt last spoke; `undefined` when the payload carries no stamp. */
  readonly at: number | undefined;
  /**
   * When this attempt STARTED — a different question from {@link at}, and the only one the
   * base can be dated against (023.3): what a run measured is fixed at its start, not at
   * its finish. Optional so the callers that build an {@link Attempt} by hand need not
   * know about it.
   */
  readonly since?: number | undefined;
};

const momentOf = (check: PullRequestFacts["checks"][number]): number | undefined => {
  const stamps = [present(check.completedAt), present(check.startedAt)]
    .map((value) => (value === undefined ? Number.NaN : Date.parse(value)))
    .filter((value) => !Number.isNaN(value));
  return stamps.length === 0 ? undefined : Math.max(...stamps);
};

const stampOf = (value: string | undefined): number | undefined => {
  const text = present(value);
  if (text === undefined) return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const asAttempt = (check: PullRequestFacts["checks"][number]): Attempt => ({
  name: present(check.name) ?? "?",
  status: present(check.status),
  conclusion: present(check.conclusion),
  state: present(check.state),
  at: momentOf(check),
  since: stampOf(check.startedAt),
});

/**
 * The last attempt of each check name (D1). A group without any usable stamp is kept
 * whole — the door refuses what it cannot read rather than picking a winner by luck.
 */
export const latestAttemptPerName = (attempts: readonly Attempt[]): readonly Attempt[] => {
  const byName = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const group = byName.get(attempt.name);
    if (group === undefined) byName.set(attempt.name, [attempt]);
    else group.push(attempt);
  }
  return [...byName.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const known = group.map((attempt) => attempt.at).filter((at) => at !== undefined);
    if (known.length === 0) return group;
    const last = Math.max(...known);
    // An attempt with no stamp cannot be shown to be older, so it stays in the answer.
    return group.filter((attempt) => attempt.at === undefined || attempt.at === last);
  });
};

/** A review reduced to what guard 1 judges: who said what, and when (D4). */
export type Verdict = {
  readonly state: string;
  readonly author: string | undefined;
  /** The moment it was submitted; `undefined` when the payload carries no stamp. */
  readonly at: number | undefined;
};

/** The two states that ANSWER. `COMMENTED`/`DISMISSED` are not verdicts and never overtake one. */
const verdictStates = new Set(["APPROVED", "CHANGES_REQUESTED"]);

const asVerdict = (review: PullRequestFacts["reviews"][number]): Verdict => {
  const stamp = present(review.submittedAt);
  const at = stamp === undefined ? Number.NaN : Date.parse(stamp);
  return {
    state: review.state,
    author: review.author,
    at: Number.isNaN(at) ? undefined : at,
  };
};

/**
 * The last of each author's items, by the {@link Verdict} `read` off them (D4). Kept
 * generic over the item so the SAME rule serves the two shapes guard 1 needs — the
 * reduced {@link Verdict} and the {@link ReviewFact} itself, whose identity the anchor
 * classification is subtracted by. Same shape as {@link latestAttemptPerName} and for the
 * same reason: a group whose stamps cannot tell its items apart is kept whole, so an
 * unreadable payload refuses instead of picking a winner by luck.
 *
 * AN UNNAMED ITEM IS ITS OWN GROUP, and that is the same fail-closed rather than a
 * detail of keying: grouping them all under one `"?"` would let the later verdict of one
 * anonymous reviewer silently overtake the earlier verdict of a DIFFERENT one — a
 * `CHANGES_REQUESTED` swallowed by somebody else's `APPROVED` is exactly what guard 1
 * exists to prevent for named reviewers. Not reproducible today (the one reviewer is
 * `github-actions`, always with a login); it is the boundary that answers wrongly if a
 * payload ever arrives without one, which is when nobody would be looking.
 */
const latestPerAuthor = <T>(items: readonly T[], read: (item: T) => Verdict): readonly T[] => {
  const byAuthor = new Map<string, T[]>();
  let unnamed = 0;
  for (const item of items) {
    const author = read(item).author;
    // Prefixed, so a login that reads like a generated key cannot land in someone
    // else's group: the two halves of the key space never meet.
    const key = author === undefined ? `unnamed:${unnamed++}` : `named:${author}`;
    const group = byAuthor.get(key);
    if (group === undefined) byAuthor.set(key, [item]);
    else group.push(item);
  }
  return [...byAuthor.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const known = group.map((item) => read(item).at).filter((at) => at !== undefined);
    if (known.length === 0) return group;
    const last = Math.max(...known);
    // An item with no stamp cannot be shown to be older, so it stays in the answer.
    return group.filter((item) => read(item).at === undefined || read(item).at === last);
  });
};

/**
 * The last verdict of each reviewer (D4) — {@link latestPerAuthor} over verdicts that are
 * already reduced.
 */
export const latestVerdictPerAuthor = (verdicts: readonly Verdict[]): readonly Verdict[] =>
  latestPerAuthor(verdicts, (verdict) => verdict);

/**
 * The reviews shown against the head that CANNOT be answers about it (thread 043): the
 * ones submitted before that commit existed, plus the ones carrying no stamp at all —
 * neither can be shown to be about this head, and a merge door refuses what it cannot
 * read rather than picking a winner by luck.
 *
 * Returns the elements of `reviews` themselves, so the caller can subtract them by
 * identity from the array it is judging.
 */
export const withoutAnchor = (input: {
  readonly reviews: readonly ReviewFact[];
  readonly headSha: string;
  readonly headCommittedAt?: string | undefined;
}): readonly ReviewFact[] => {
  // No date for the head commit means gh was not asked (or did not say) — nothing is
  // known about the age of a verdict, and the anchors of `reviews` are taken as given,
  // which is the reading before thread 043.
  const headAt = present(input.headCommittedAt);
  const headTime = headAt === undefined ? Number.NaN : Date.parse(headAt);
  if (Number.isNaN(headTime)) return [];
  return input.reviews.filter((review) => {
    // Only a verdict shown ON THE HEAD is at stake: one on another commit is already
    // out of the count, and saying it twice would rename a stale approve.
    if (review.commitSha !== input.headSha) return false;
    const at = present(review.submittedAt);
    if (at === undefined) return true;
    const time = Date.parse(at);
    return Number.isNaN(time) || time < headTime;
  });
};

const checkIsGreen = (check: Attempt): boolean =>
  check.conclusion === undefined && check.status === undefined
    ? check.state !== undefined && greenStates.has(check.state)
    : check.status === "COMPLETED" &&
      check.conclusion !== undefined &&
      greenConclusions.has(check.conclusion);

const describeCheck = (check: Attempt): string =>
  `${check.name}=${check.conclusion ?? check.state ?? check.status ?? "?"}`;

/**
 * What GitHub says about applying the branch (D2). Not a guard: printed as a fact and
 * refusing on anything that is not a plain `MERGEABLE`, `UNKNOWN` included — "not
 * computed yet" is an answer to come back for, never a permission.
 */
export const mergeabilityOf = (pr: PullRequestFacts): Mergeability => {
  const mergeable = present(pr.mergeable)?.toUpperCase();
  const stateStatus = present(pr.mergeStateStatus);
  const beside = stateStatus === undefined ? "" : ` (mergeStateStatus ${stateStatus})`;
  if (mergeable === "MERGEABLE") return { state: "clear", detail: `mergeable=MERGEABLE${beside}` };
  if (mergeable === undefined)
    return {
      state: "blocked",
      detail:
        "gh reported no 'mergeable' field — the door does not guess at what GitHub did not say",
    };
  if (mergeable === "UNKNOWN")
    return {
      state: "blocked",
      detail: `mergeable=UNKNOWN${beside} — GitHub has not finished computing the merge; ask again`,
    };
  return {
    state: "blocked",
    detail: `mergeable=${mergeable}${beside} — the branch does not apply to its base: a rebase and a new round, not a merge`,
  };
};

/**
 * WHAT GUARD 2 DOES NOT ASK — said beside it, and never instead of it (023.3, curator's
 * statement of work of 2026-08-03, thread `023-daemon-parallelism`).
 *
 * A green check hangs on the head, and guard 2 credits it there. But a `pull_request` run
 * does not measure the head: it measures `refs/pull/N/merge` — THE HEAD MERGED WITH THE
 * BASE AS THE BASE WAS WHEN THE RUN STARTED. Move the base afterwards and GitHub rebuilds
 * that ref, but NOBODY reruns the check that already answered: it stays green, stays on
 * the same head, and guard 2 goes on crediting a measurement of a tree that no longer is
 * the result of this merge. Measured in thread 023: run `30819577162` started 13:47:19Z on
 * head `92b2c612` over base `951b7551`, #189 landed at 14:00:28Z, and for the fifteen
 * minutes until the next push the door would have counted a reading of a tree that had
 * ceased to exist. `mergeStateStatus` does not cover it — it would say `BEHIND` only under
 * a "branch must be up to date" protection, which this repository does not have.
 *
 * THE SYMMETRY THAT MAKES IT ONE CLASS: guard 1 already thinks this thought on the other
 * axis — a verdict older than the head commit is not a verdict about it (thread 043). The
 * time of a CHECK against the BASE was asked by nobody.
 *
 * IT ONLY SPEAKS. The verdict and the exit code are the same with a drift and without one,
 * in every branch — that is the whole scope, and it is locked by test. A door that began
 * refusing what it used to pass would be a change of the norm, and the norm is john's.
 *
 * THE MEASUREMENT IS CONSERVATIVE, and this is the honest name for it: the API does not
 * hand back the merge-ref a check actually measured, so the comparison is the base's
 * `committedDate` against the START of the credited attempts — it will name a base move
 * that could not have changed the merge at all (#189, a lone new test, is exactly such a
 * move). Admissible precisely because the verdict does not move: the price of a false
 * positive is one line of text. It rests on one assumption, said out loud rather than
 * implied: THE COMMIT DATE OF THE BASE HEAD IS THE MOMENT IT LANDED — true while merges
 * are squash-only, as they are here, and wrong the day a merge commit carries an older date.
 *
 * The EARLIEST start among the credited attempts is the one compared, because guard 2
 * credits them all: if the base moved after any of them began, one of the readings the
 * door is counting is about the older base.
 *
 * SILENCE IS EARNED BY ONE STATE ONLY — a measurement that happened and dated the base
 * older than every credited check. No base, no date, no start stamp, nothing credited at
 * all: all of them are SAID. This is the false-silence class #190 repaired twice already
 * (`unpublished`, `unreadable`); a third repetition of it has nowhere to hide.
 *
 * AND IT HID THERE ANYWAY, FOR FOUR MINUTES (023.4, the repair of the input). #191 shipped
 * with `baseRefOid` as the base: the field is the head of the base branch AS RECORDED WHEN
 * THE BRANCH WAS CUT, and it does not move when the base does. Measured on the live circuit
 * minutes after that merge: `main` went to `6b87776f` at 15:42:33Z while PR #192 — whose
 * credited `checks` started 15:25:28Z, the exact case this note exists for — still reported
 * `baseRefOid: 44471804`; PR #3, opened 24.07, reports a July commit to this day. Dated
 * that way the base is older than the credited checks essentially always, so `drift` was
 * unreachable and `current` was printed about a reading nobody took. Every guard held,
 * every test passed, and the note was a no-op that looked like good news — the same shape
 * as the two false silences above, one layer lower: the states were honest about the
 * ANSWER and nothing checked the QUESTION. The base branch is now asked for BY NAME and
 * its head read live; the tests that lock this pin the second read to the branch, because
 * a fact of the right type in the wrong meaning is what the unit tests could not see.
 */
export type BaseDrift = {
  /** `current`: measured, the base is older than the credited checks — nothing to say. */
  readonly state: "current" | "drift" | "unknown";
  readonly detail: string;
};

const isoOf = (moment: number): string => new Date(moment).toISOString().replace(/\.\d{3}Z$/, "Z");

export const baseDriftOf = (pr: PullRequestFacts): BaseDrift => {
  const credited = latestAttemptPerName(pr.checks.map(asAttempt)).filter(checkIsGreen);
  if (credited.length === 0)
    return {
      state: "unknown",
      detail:
        "no green attempt is credited on this head, so there is no reading whose base could have moved — guard 2 answers this one on its own",
    };
  const base = present(pr.baseSha);
  const baseAt = present(pr.baseCommittedAt);
  const baseTime = baseAt === undefined ? undefined : stampOf(baseAt);
  if (base === undefined || baseTime === undefined)
    return {
      state: "unknown",
      detail: `${base === undefined ? "the head of the base branch was not read" : `no readable date for the base ${base.slice(0, 7)}`} — whether the base moved under the credited checks is UNKNOWN, which is not the same as 'it did not'`,
    };
  const unstamped = credited.filter((check) => check.since === undefined);
  if (unstamped.length > 0)
    return {
      state: "unknown",
      detail: `no start stamp on ${unstamped.map((check) => check.name).join(", ")} — a check that does not say when it began cannot be dated against the base ${base.slice(0, 7)}`,
    };
  const starts = credited.map((check) => check.since as number);
  const earliest = Math.min(...starts);
  const first = credited.find((check) => check.since === earliest);
  if (baseTime <= earliest)
    return {
      state: "current",
      detail: `the base ${base.slice(0, 7)} (${baseAt}) is older than every credited check — they measured this base`,
    };
  return {
    state: "drift",
    detail: `the base moved AFTER the credited checks started: ${base.slice(0, 7)} committed ${baseAt}, '${first?.name ?? "?"}' started ${isoOf(earliest)}. A 'pull_request' run measures the head merged with the base OF ITS OWN MOMENT, and a base that moves does not rerun it — the green guard 2 credits is a reading of a tree that is no longer the result of this merge. Conservative: a base move that cannot change the merge is named too`,
  };
};

/**
 * The verdict. `curatorMayMerge` answers ONE question — "is there anything in the
 * facts that forbids it" — and the two by-hand guards travel with the answer so the
 * caller cannot print the first without the second.
 */
/**
 * GUARDS 1 AND 2 — THE HALF A MACHINE ANSWERS ABOUT A PR ON ITS OWN, AS ONE FUNCTION
 * (thread `019-operator-ux`, statement of work of 2026-08-01, point 5).
 *
 * The scheduler asks the very same question the door asks — "is there an approve on THIS
 * head, and did the checks on that same head answer green" — in order to raise the pair
 * of a merge-ready PR ahead of the queue. It asks it HERE. A second implementation of
 * "approved on the head" would be a second definition of the word, and the two would
 * drift in silence: the queue would promise ready and the door would refuse. The age test
 * of thread 043 is the part any re-implementation forgets first, and it is the part that
 * decides whether an approve granted once travels forever.
 *
 * Guards 3-5 are deliberately NOT here: two of them are judgements (see the header), and
 * the fourth needs the caller's list of power documents. What a machine may say about a
 * pull request with no project knowledge at all is exactly these two.
 */
export const verdictAndChecks = (
  pr: PullRequestFacts,
): { readonly verdict: GateOutcome; readonly checks: GateOutcome } => {
  const head = pr.headSha;

  // A verdict older than the head commit is not a verdict on this head, whatever
  // `reviews[].commit` substitutes for it (thread 043). The classification is applied to
  // what SURVIVES the grouping by author (D4), never to the whole history: an anchorless
  // verdict already overtaken by a later, valid one of the same author has been answered,
  // and judging it would make the door's own repair unable to lift its refusal.
  const anchorless = new Set(
    withoutAnchor({
      reviews: pr.reviews,
      headSha: head,
      headCommittedAt: pr.headCommittedAt,
    }),
  );
  const lastOnHead = latestPerAuthor(
    pr.reviews.filter((review) => review.commitSha === head && verdictStates.has(review.state)),
    asVerdict,
  );
  const unanchoredVerdicts = lastOnHead.filter((review) => anchorless.has(review));

  const onHead = lastOnHead.filter((review) => !anchorless.has(review)).map(asVerdict);
  const approvals = onHead.filter((review) => review.state === "APPROVED");
  const changesRequested = onHead.filter((review) => review.state === "CHANGES_REQUESTED");
  const staleApprovals = pr.reviews.filter(
    (review) => review.state === "APPROVED" && review.commitSha !== head,
  );

  const verdict: GateOutcome =
    changesRequested.length > 0
      ? {
          guard: 1,
          title: "approve on the current head",
          state: "fail",
          detail: `changes were requested on ${head.slice(0, 7)} (${changesRequested
            .map((review) => review.author ?? "?")
            .join(", ")}) — a new round, not a merge`,
        }
      : unanchoredVerdicts.length > 0
        ? {
            guard: 1,
            title: "approve on the current head",
            state: "fail",
            detail: `a verdict older than the head commit (${unanchoredVerdicts
              .map(
                (review) =>
                  `${review.state === "APPROVED" ? "approve" : review.state} by ${review.author ?? "?"}${present(review.submittedAt) === undefined ? ", no stamp" : ` at ${present(review.submittedAt)}`}`,
              )
              .join(
                ", ",
              )}; ${head.slice(0, 7)} committed ${present(pr.headCommittedAt) ?? "?"}): a review submitted with no commit of its own is shown against whatever head the PR has now — it is not an answer about ${head.slice(0, 7)}. What is missing is a review run on the 'pull_request' event (re-label, or 'gh pr update-branch'), not a new round of review`,
          }
        : approvals.length > 0
          ? {
              guard: 1,
              title: "approve on the current head",
              state: "pass",
              detail: `approved on ${head.slice(0, 7)} by ${approvals
                .map((review) => review.author ?? "?")
                .join(", ")}`,
            }
          : {
              guard: 1,
              title: "approve on the current head",
              state: "fail",
              detail:
                staleApprovals.length === 0
                  ? `no approve verdict on ${head.slice(0, 7)}`
                  : `the approve is on ${staleApprovals
                      .map((review) => (review.commitSha ?? "?").slice(0, 7))
                      .join(", ")}, the head has moved to ${head.slice(0, 7)} — a new round is due`,
            };

  const attempts = latestAttemptPerName(pr.checks.map(asAttempt));
  const notGreen = attempts.filter((check) => !checkIsGreen(check));
  const checks: GateOutcome =
    attempts.length === 0
      ? {
          guard: 2,
          title: "green checks on the same head",
          state: "fail",
          detail: `no checks reported on ${head.slice(0, 7)} — nothing has confirmed this head`,
        }
      : notGreen.length === 0
        ? {
            guard: 2,
            title: "green checks on the same head",
            state: "pass",
            detail: `${attempts.length} check(s) green: ${attempts.map(describeCheck).join(", ")}`,
          }
        : {
            guard: 2,
            title: "green checks on the same head",
            state: "fail",
            detail: `not green: ${notGreen.map(describeCheck).join(", ")}`,
          };

  return { verdict, checks };
};

/**
 * Whether the two mechanical guards HOLD — the one fact the scheduler reads off a pull
 * request (thread 019, point 5). Deliberately a boolean over {@link verdictAndChecks} and
 * not a reading of its own: "ready" means precisely "neither of the two guards the door
 * computes would refuse", and the words that explain WHY stay with the outcomes.
 */
export const guardsOneAndTwoHold = (pr: PullRequestFacts): boolean => {
  const { verdict, checks } = verdictAndChecks(pr);
  return verdict.state === "pass" && checks.state === "pass";
};

export const evaluateMergeGate = (input: {
  readonly pr: PullRequestFacts;
  readonly powerDocs: readonly string[];
}): MergeGateVerdict => {
  const { pr } = input;
  const head = pr.headSha;
  const { verdict, checks } = verdictAndChecks(pr);

  const thread = threadOfDescription(pr.body);
  const ascent: GateOutcome =
    thread === undefined
      ? {
          guard: 3,
          title: "ascent to a decision of john's",
          state: "fail",
          detail:
            "the description names no thread (`thread: NNN-slug`) — there is nothing to ascend to",
        }
      : {
          guard: 3,
          title: "ascent to a decision of john's",
          state: "by-hand",
          detail: `thread '${thread}' — read the feed: a decision of john's, with its source named. Curator does not merge what curator set without one`,
        };

  const touched = touchedPowerDocuments({
    changedPaths: pr.changedPaths,
    powerDocs: input.powerDocs,
  });
  const power: GateOutcome =
    touched.length === 0
      ? {
          guard: 4,
          title: "no self-merge on the documents of power",
          state: "pass",
          detail: `${pr.changedPaths.length} changed path(s), none of them a document of power`,
        }
      : {
          guard: 4,
          title: "no self-merge on the documents of power",
          state: "fail",
          detail: `john merges this one — it changes ${touched.join(", ")}`,
        };

  const trace: GateOutcome = {
    guard: 5,
    title: "a trace of the merge",
    state: "by-hand",
    detail:
      "name this merge in your next message in the thread — which verdict, which head, which checks",
  };

  const guards = [verdict, checks, ascent, power, trace];
  const mergeability = mergeabilityOf(pr);
  return {
    number: pr.number,
    headSha: head,
    // `baseDrift` is deliberately absent from this expression, and that is the scope of
    // 023.3: the door says what it sees and decides exactly what it decided before.
    curatorMayMerge:
      guards.every((guard) => guard.state !== "fail") && mergeability.state === "clear",
    guards,
    mergeability,
    baseDrift: baseDriftOf(pr),
  };
};

/** The verdict as lines for a terminal; the last one is the answer. */
export const describeMergeGate = (verdict: MergeGateVerdict): readonly string[] => [
  `merge-gate: PR #${verdict.number} at ${verdict.headSha.slice(0, 7)}`,
  ...verdict.guards.flatMap((guard) => {
    const line = `  ${guard.state === "pass" ? "ok  " : guard.state === "fail" ? "STOP" : "you "} guard ${guard.guard} · ${guard.title}: ${guard.detail}`;
    // Under guard 2 and indented under it, because that is what it is about — a fact the
    // guard does not ask, marked `note` so no reader can mistake it for a sixth guard or
    // for a state of the fifth (023.3). It changes no answer below it.
    return guard.guard === 2 && verdict.baseDrift.state !== "current"
      ? [line, `       note · base: ${verdict.baseDrift.detail}`]
      : [line];
  }),
  // Beside the guards and before the answer — a fact, said in its own words so nobody
  // reads it as a sixth guard (D2).
  `  ${verdict.mergeability.state === "clear" ? "ok  " : "STOP"} mergeability · not a guard, a fact GitHub answers: ${verdict.mergeability.detail}`,
  verdict.curatorMayMerge
    ? "nothing in the facts forbids this merge — guards 3 and 5 are yours to answer"
    : verdict.mergeability.state === "blocked" &&
        verdict.guards.every((guard) => guard.state !== "fail")
      ? "REFUSED: GitHub itself would refuse this merge"
      : "REFUSED: a guard does not hold",
];
