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

/** The facts about a pull request the gate judges — the shape `gh pr view --json` gives. */
export type PullRequestFacts = {
  readonly number: number;
  /** `headRefOid`: the commit the verdict and the checks have to be about. */
  readonly headSha: string;
  /** The PR description, where the `thread:` line lives (rule 14). */
  readonly body: string;
  /** `reviews`: state plus the commit it was submitted against. */
  readonly reviews: readonly {
    readonly state: string;
    readonly commitSha: string | undefined;
    readonly author: string | undefined;
    /** When it was submitted — how a second round is told from the verdict it replaced (D4). */
    readonly submittedAt?: string | undefined;
  }[];
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
};

const momentOf = (check: PullRequestFacts["checks"][number]): number | undefined => {
  const stamps = [present(check.completedAt), present(check.startedAt)]
    .map((value) => (value === undefined ? Number.NaN : Date.parse(value)))
    .filter((value) => !Number.isNaN(value));
  return stamps.length === 0 ? undefined : Math.max(...stamps);
};

const asAttempt = (check: PullRequestFacts["checks"][number]): Attempt => ({
  name: present(check.name) ?? "?",
  status: present(check.status),
  conclusion: present(check.conclusion),
  state: present(check.state),
  at: momentOf(check),
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
 * The last verdict of each reviewer (D4). Same shape as {@link latestAttemptPerName} and
 * for the same reason: a group whose stamps cannot tell its verdicts apart is kept whole,
 * so an unreadable payload refuses instead of picking a winner by luck.
 */
export const latestVerdictPerAuthor = (verdicts: readonly Verdict[]): readonly Verdict[] => {
  const byAuthor = new Map<string, Verdict[]>();
  for (const verdict of verdicts) {
    const key = verdict.author ?? "?";
    const group = byAuthor.get(key);
    if (group === undefined) byAuthor.set(key, [verdict]);
    else group.push(verdict);
  }
  return [...byAuthor.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const known = group.map((verdict) => verdict.at).filter((at) => at !== undefined);
    if (known.length === 0) return group;
    const last = Math.max(...known);
    // A verdict with no stamp cannot be shown to be older, so it stays in the answer.
    return group.filter((verdict) => verdict.at === undefined || verdict.at === last);
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
 * The verdict. `curatorMayMerge` answers ONE question — "is there anything in the
 * facts that forbids it" — and the two by-hand guards travel with the answer so the
 * caller cannot print the first without the second.
 */
export const evaluateMergeGate = (input: {
  readonly pr: PullRequestFacts;
  readonly powerDocs: readonly string[];
}): MergeGateVerdict => {
  const { pr } = input;
  const head = pr.headSha;

  const onHead = latestVerdictPerAuthor(
    pr.reviews
      .filter((review) => review.commitSha === head)
      .map(asVerdict)
      .filter((verdict) => verdictStates.has(verdict.state)),
  );
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
    curatorMayMerge:
      guards.every((guard) => guard.state !== "fail") && mergeability.state === "clear",
    guards,
    mergeability,
  };
};

/** The verdict as lines for a terminal; the last one is the answer. */
export const describeMergeGate = (verdict: MergeGateVerdict): readonly string[] => [
  `merge-gate: PR #${verdict.number} at ${verdict.headSha.slice(0, 7)}`,
  ...verdict.guards.map(
    (guard) =>
      `  ${guard.state === "pass" ? "ok  " : guard.state === "fail" ? "STOP" : "you "} guard ${guard.guard} · ${guard.title}: ${guard.detail}`,
  ),
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
