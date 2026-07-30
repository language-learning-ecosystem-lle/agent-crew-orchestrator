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
  }[];
  /** `statusCheckRollup`: check runs (status/conclusion) and status contexts (state) alike. */
  readonly checks: readonly {
    readonly name: string;
    readonly status: string | undefined;
    readonly conclusion: string | undefined;
    readonly state: string | undefined;
  }[];
  /** `files[].path`, repository-relative. */
  readonly changedPaths: readonly string[];
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

export type MergeGateVerdict = {
  readonly number: number;
  readonly headSha: string;
  /** No guard failed AND no document of power is touched: curator may merge, guards 3 and 5 permitting. */
  readonly curatorMayMerge: boolean;
  readonly guards: readonly GateOutcome[];
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

const checkIsGreen = (check: PullRequestFacts["checks"][number]): boolean =>
  check.conclusion === undefined && check.status === undefined
    ? check.state !== undefined && greenStates.has(check.state)
    : check.status === "COMPLETED" &&
      check.conclusion !== undefined &&
      greenConclusions.has(check.conclusion);

const describeCheck = (check: PullRequestFacts["checks"][number]): string =>
  `${check.name}=${check.conclusion ?? check.state ?? check.status ?? "?"}`;

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

  const onHead = pr.reviews.filter((review) => review.commitSha === head);
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

  const notGreen = pr.checks.filter((check) => !checkIsGreen(check));
  const checks: GateOutcome =
    pr.checks.length === 0
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
            detail: `${pr.checks.length} check(s) green: ${pr.checks.map(describeCheck).join(", ")}`,
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
  return {
    number: pr.number,
    headSha: head,
    curatorMayMerge: guards.every((guard) => guard.state !== "fail"),
    guards,
  };
};

/** The verdict as lines for a terminal; the last one is the answer. */
export const describeMergeGate = (verdict: MergeGateVerdict): readonly string[] => [
  `merge-gate: PR #${verdict.number} at ${verdict.headSha.slice(0, 7)}`,
  ...verdict.guards.map(
    (guard) =>
      `  ${guard.state === "pass" ? "ok  " : guard.state === "fail" ? "STOP" : "you "} guard ${guard.guard} · ${guard.title}: ${guard.detail}`,
  ),
  verdict.curatorMayMerge
    ? "nothing in the facts forbids this merge — guards 3 and 5 are yours to answer"
    : "REFUSED: a guard does not hold",
];
