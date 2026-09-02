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
 * GUARD 4 HAS A DECLARED CLASS: Д-1 (john's decision of 2026-08-14, thread
 * `068-d1-vs-guard4`). A diff that ONLY encodes a decision john already took is
 * curator's to merge even when it touches a document of power — that is what the class
 * says, and until now the door printed STOP on every merge of it, BY CONSTRUCTION and
 * not by mistake: a guard that is always wrong about a whole class is a guard people
 * stop reading, and the day the STOP is real they will read it the same way. So the
 * door learns the class the only way it honestly can — it is DECLARED at the door
 * ({@link D1Reference}, `merge-gate --d1`), and guard 4 then says what guards 3 and 5
 * say: `by-hand`, a named obligation, never a pass. Without the flag the STOP stands,
 * word for word, which is the other half of the same repair.
 *
 * WHAT THE DOOR REFUSES TO MEASURE HERE, and why the state is `by-hand` and not `pass`:
 * condition (a) of the class — "the diff adds no new norm" — is a judgement, of exactly
 * the kind guard 3 is. No heuristic stands in for it ("only docs", "only text" appear in
 * no norm), because a machine printing "checked" about a judgement it never took is the
 * one failure this module exists to avoid. What the door CAN check is the FORM of the
 * reference: condition (б) asks for the message FILE the decision is fixed in, and a
 * flag that swallowed anything would make the obligation unverifiable.
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

/**
 * AND TIME ALONE IS NOT ENOUGH: A VERDICT CAN BE YOUNGER THAN THE HEAD AND STILL BE ABOUT
 * ANOTHER TREE (thread `027-guard1-orphan-verdict`; measured twice by the curator of the
 * served project on its PR #347, 2026-08-21, and carried here as the statement of work).
 * The round of review started on head `34716450`. A push landed MID-ROUND — the head became
 * `e7386435`, committed 22:48:38Z — and the round went on judging the OLD tree, sending its
 * verdict at 22:54:33Z. GitHub anchors a review to the head THE PULL REQUEST HAS WHEN
 * `gh pr review` IS CALLED, not to the head the text answered about, so the formal status
 * came back "approved on e7386435" and this door printed `ok guard 1`. The age test of 043
 * cannot see it: the verdict is YOUNGER than the head, which is the one thing that test
 * reads as healthy. The price that day was zero only because guard 2 happened to STOP on
 * the same PR for its own reason — two refusals coinciding is luck, not a door.
 *
 * SO THE ANCHOR OF GUARD 1 IS THE RUN, NOT THE REVIEW OBJECT. The review object cannot be
 * made to give up the commit it analysed — measured across both APIs: `reviews[].commit_id`
 * of REST and `reviews[].commit.oid` of GraphQL answer the CURRENT head for the orphan as
 * readily as for a healthy verdict. What does answer honestly is the run that produced the
 * verdict: a round of review on the `pull_request` event carries the head it read in its own
 * `head_sha`, and that field is not substituted by anybody. So an approve counts when a
 * CLOSED round of the reviewer's workflow exists ON THIS HEAD and the verdict lies inside
 * that round's window (`created_at` … `updated_at`). The orphan of #347 fails it by
 * construction: the only closed round of that moment carried `head_sha 34716450`.
 *
 * AND THE THIRD STATE IS THE HALF THAT MAKES IT HONEST. `actions/runs` is an ACTIONS
 * resource: an installation token (`ghs_…`, what any `gh-action` executor of this protocol
 * runs with, the reviewer included) gets `Resource not accessible by integration` unless its
 * job lists `actions: read`. A door that read a refusal as `ok` would put the defect back,
 * and one that read it as STOP would refuse every caller that never had the scope. So the
 * guard answers `by-hand` — with the refusal of GitHub quoted word for word and the manual
 * form of the check named — and it answers the same way when nobody told it WHICH workflow
 * is the review (`--review-workflow`): the reviewer's workflow is a name of the served
 * project, and a package that guessed it would be inventing project knowledge again (see
 * the note on the documents of power above). An obligation is not a pass: `by-hand` never
 * says the anchor holds, it says a human still owes the check.
 *
 * WHAT THIS DOES NOT CHANGE: nothing new is let through. The guard only stops crediting an
 * approve it used to credit blindly, so the class of the change is a defect of the tooling
 * and not a move of the norm — the norm always said "an approve ON THIS HEAD".
 */

/** One review as the gate reads it — who said what, against which commit, when. */
export type ReviewFact = {
  readonly state: string;
  readonly commitSha: string | undefined;
  readonly author: string | undefined;
  /** When it was submitted — how a second round is told from the verdict it replaced (D4). */
  readonly submittedAt?: string | undefined;
};

/**
 * One workflow run as guard 1 reads it (thread 027) — the shape of an entry of
 * `repos/{owner}/{repo}/actions/runs`. Every field is optional because it is somebody
 * else's payload; a run missing what the anchor is computed from simply cannot anchor
 * anything, and saying so is the guard's job, not the schema's.
 */
export type ReviewRunFact = {
  readonly id: number | undefined;
  /** The workflow's name — matched against `--review-workflow`, never guessed. */
  readonly name: string | undefined;
  /** THE FIELD THE WHOLE REPAIR RESTS ON: the head this round actually read. */
  readonly headSha: string | undefined;
  /** `pull_request`, `workflow_dispatch`, … — a dispatch round hangs on the head of the base. */
  readonly event: string | undefined;
  readonly status: string | undefined;
  readonly conclusion: string | undefined;
  /** The window the verdict has to lie in: when the round started … when it last spoke. */
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
};

/**
 * WHAT THE DOOR KNOWS ABOUT THE ROUNDS OF REVIEW ON THIS HEAD — including, as a state of
 * its own, that it could not ask. The three cases are not interchangeable and the guard
 * says which one it is in: an unread resource is an obligation, an unasked one is an
 * obligation with a different repair, and neither is a verdict.
 */
export type ReviewRunReading =
  /** The runs of the named workflow on this head, as GitHub answered. */
  | {
      readonly state: "read";
      readonly workflow: string;
      readonly runs: readonly ReviewRunFact[];
    }
  /** GitHub refused, or the answer was not the shape we read — `reason` is quoted verbatim. */
  | { readonly state: "unreadable"; readonly workflow: string; readonly reason: string }
  /** No `--review-workflow`: nobody named the reviewer's workflow, so nothing was asked. */
  | { readonly state: "not-asked" };

/**
 * WHAT THE DOOR KNOWS ABOUT THE RUNS ON THIS HEAD — guard 2's source since thread 120,
 * where the outcome of the checks moved off `statusCheckRollup` (a resource no fine-grained
 * token can be granted; see `gh.ts`) and onto `actions/runs?head_sha=`.
 *
 * Three states and no fourth, because the difference between them is the whole repair:
 * `read` carries the runs, `unreadable` carries GitHub's own words and REFUSES the guard by
 * name, `not-asked` refuses it too and says the caller never asked. Neither refusal is "no
 * checks reported": that sentence is reserved for a head Actions answered about with an
 * empty list, which is a fact about the head and not about our reach.
 */
export type CheckRunReading =
  | { readonly state: "read"; readonly runs: readonly ReviewRunFact[] }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "not-asked" };

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
  /**
   * The rounds of review on this head, and the anchor guard 1 credits an approve by
   * (thread 027). Absent means the caller does not ask Actions at all — the scheduler's
   * merge-ready reader does not, because it ranks a queue rather than opening a door —
   * and it is read exactly as {@link ReviewRunReading} `not-asked`: an obligation, never
   * a pass.
   */
  readonly reviewRuns?: ReviewRunReading | undefined;
  /**
   * How guard 2's source answered (thread 120) — the runs on this head, or the reason
   * there are none to read. Absent is read as {@link CheckRunReading} `not-asked`.
   */
  readonly checkRuns?: CheckRunReading | undefined;
  /**
   * The attempts guard 2 judges — the runs of {@link checkRuns} anchored to this head
   * (`gh.ts` → `checkFactsFromRuns`). The vocabulary is Actions': `status: completed`,
   * `conclusion: success|failure|skipped|cancelled|…`, lower case. The older vocabulary
   * of `statusCheckRollup` (upper case, plus a status context's `state`) is still read —
   * the judgement is case-insensitive and the field survives — because a caller that
   * builds these facts by hand is not the reason to lose a reading that costs nothing.
   */
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
  /**
   * No guard FAILED and GitHub would apply the branch: curator may merge, the obligations
   * permitting — guards 3 and 5 always, guard 4 as well when class Д-1 is declared (068).
   */
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
 * WHERE A DOCUMENT OF POWER CAME FROM. Printed beside every path, and the reason is the
 * whole of thread `025`: a list with no provenance cannot be told apart from a SHORTER one.
 * The guard's completeness used to depend on a flag somebody remembered to type, and the
 * trace it left said only which paths were judged — never that three more should have been.
 * With the source said out loud, "the config declares nothing" is a fact on the screen
 * instead of a silence.
 */
export type PowerDocumentSource =
  /** The protocol config itself — always, and derived from nothing. */
  | "config"
  /** An `instructions` path of some role: the role cards, derived from the config. */
  | "role"
  /** The `powerDocuments` list the served project declares (v18). */
  | "declared"
  /** `--power-docs` on the command line: what the caller adds on top. */
  | "flag";

export type PowerDocument = {
  readonly path: string;
  readonly source: PowerDocumentSource;
};

/**
 * The documents of power of this repository, WITH the source of each: the protocol config
 * itself, every role's instruction paths MINUS the working cards, the `powerDocuments` the
 * project declares, and whatever the caller adds (`--power-docs`). Deduplicated, order of
 * first appearance kept — the list is printed to a human, and the first appearance is also
 * what names the source: a path that is both derived and declared is derived, because the
 * derivation would hold even if the declaration were deleted.
 */
export const powerDocumentList = (input: {
  readonly roles: readonly {
    readonly instructions?: readonly { readonly path: string }[] | undefined;
  }[];
  readonly configPath: string;
  /** The `powerDocuments` of the config the door is judging by (the BASE of the PR). */
  readonly configured?: readonly string[] | undefined;
  readonly declared?: readonly string[] | undefined;
  /** Instruction paths that are WORKING cards, not documents of power (see the header). */
  readonly workingCards?: readonly string[] | undefined;
}): readonly PowerDocument[] => {
  const seen = new Map<string, PowerDocumentSource>();
  const push = (entry: string, source: PowerDocumentSource): void => {
    const normalised = normalise(entry);
    if (normalised.length > 0 && !seen.has(normalised)) seen.set(normalised, source);
  };
  const working = new Set((input.workingCards ?? []).map(normalise).filter((e) => e.length > 0));
  push(input.configPath, "config");
  for (const role of input.roles)
    for (const doc of role.instructions ?? []) {
      if (!working.has(normalise(doc.path))) push(doc.path, "role");
    }
  // Neither the declared nor the flagged side is filtered by the working cards: naming a
  // path outright outranks calling it a working card, and a caller that says both things
  // means the stricter one.
  for (const entry of input.configured ?? []) push(entry, "declared");
  for (const entry of input.declared ?? []) push(entry, "flag");
  return [...seen].map(([path, source]) => ({ path, source }));
};

/** How each source is named to a human. One wording, so two traces read as one fact. */
const SOURCE_WORDING: Record<PowerDocumentSource, string> = {
  config: "the protocol config itself",
  role: "derived from a role's instructions",
  declared: "declared by 'powerDocuments' of the config",
  flag: "named on the command line by --power-docs",
};

/**
 * The list guard 4 judges by, said out loud with the source of every path — and, when the
 * config declares nothing, said out loud THAT it declares nothing. The second half is the
 * point: the failure this trace exists to catch is a list that looks complete because the
 * paths missing from it were never mentioned.
 */
export const describePowerDocuments = (documents: readonly PowerDocument[]): readonly string[] => {
  const lines = [`merge-gate: documents of power judged by (${documents.length}):`];
  for (const document of documents) {
    lines.push(`merge-gate:   ${document.path} — ${SOURCE_WORDING[document.source]}`);
  }
  if (!documents.some((document) => document.source === "declared")) {
    lines.push(
      "merge-gate:   (the config declares no 'powerDocuments': the list above is derived plus whatever --power-docs named)",
    );
  }
  return lines;
};

/**
 * THE MERGE THAT NEEDS A HAND AFTER THE BUTTON (thread 040, point 2 of curator's
 * statement).
 *
 * The config and the code of a circuit travel by different roads: `protocolVersion` lands
 * in the base the instant the button is pressed, while the build running on the box moves
 * only when somebody pulls it. Between those two moments the version gate refuses, and
 * three times in a week that gap ended with a dead circuit and a human on the phone
 * (`self-restart.ts` has the measured mechanism). The daemon now repairs itself across
 * that gap — this line SHORTENS the gap, which is the cheaper half and the one that keeps
 * working when the repair cannot (no drift to pull: the config was merged ahead of a build
 * that does not exist yet).
 *
 * WHAT IT DOES AND DOES NOT CLAIM. The gate reads the names of the changed files, not
 * their content, so what is known here is that the diff TOUCHES the file that carries the
 * number — and the line says exactly that, conditionally, rather than asserting a bump it
 * has not read. An "if" the reader can check beats a claim they cannot.
 */
export const describeVersionBumpFollowUp = (input: {
  readonly changedPaths: readonly string[];
  readonly configPath: string;
}): readonly string[] => {
  const config = normalise(input.configPath);
  if (!input.changedPaths.map(normalise).some((path) => path === config)) return [];
  return [
    `merge-gate: this diff touches '${input.configPath}' — IF it moves 'protocolVersion', THE BUTTON IS NOT THE END: every box running the circuit refuses every command until its build is pulled. After the merge, on each box: git pull --ff-only && pnpm install && systemctl --user restart agent-protocol@<instance>`,
    "merge-gate: say that line in the merge trace of the thread — a bump merged in silence is the one class this circuit cannot notice for itself until the watchdog rings",
  ];
};

/** The same list as bare paths — what guard 4 actually matches the changed files against. */
export const powerDocuments = (input: Parameters<typeof powerDocumentList>[0]): readonly string[] =>
  powerDocumentList(input).map((document) => document.path);

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
 * The declaration of class Д-1 at the door: WHICH message of WHICH thread fixes the
 * decision this diff encodes (condition (б) of the class).
 */
export type D1Reference = {
  /** The thread the decision was fixed in — not necessarily the PR's own (see guard 4). */
  readonly thread: string;
  /** The message FILE. An ordinal travels (norm 024); a file name does not. */
  readonly file: string;
  /** As it was typed, for the obligation's own words. */
  readonly raw: string;
};

/** The two canonical writings of a moment, as `thread show` reads them: `17-28-50Z` and `17:28:50Z`. */
const MESSAGE_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}[:-]\d{2}[:-]\d{2}Z-\S+\.md$/;
const ORDINAL = /^msg-\d+/;

/**
 * The reference of `--d1`, read and CHECKED FOR FORM — the refusals are by name, because
 * "this value is not a reference" and "this reference points nowhere" are different
 * repairs. Two forms are accepted, the short one and the full path:
 * `NNN-slug/<stamp>-<role>.md` and `<mail>/NNN-slug/messages/<stamp>-<role>.md`.
 *
 * WHAT IS NOT CHECKED, and deliberately: whether the file EXISTS. The door has no mail
 * checkout in its input, and what the message SAYS is a judgement anyway — the form is
 * the whole of what a machine can hold here. The stamp is read tolerantly for the same
 * reason: both writings of the moment are canonical in the mail.
 */
export const readD1Reference = (value: string): D1Reference | { readonly refusal: string } => {
  const raw = value.trim();
  if (raw.length === 0) return { refusal: "--d1 was given no value" };
  const parts = raw.split("/").filter((part) => part.length > 0);
  const named =
    parts.length === 2
      ? { thread: parts[0] as string, file: parts[1] as string }
      : parts.length === 4 && parts[1] !== undefined && parts[2] === "messages"
        ? { thread: parts[1] as string, file: parts[3] as string }
        : undefined;
  if (named === undefined) {
    // A bare thread is the commonest miss, and it is the one condition (б) forbids: it
    // names the conversation, not the decision inside it.
    return {
      refusal: `--d1 '${raw}' names no message file — class Д-1 ascends to the MESSAGE that fixes the decision, not to the thread. Write 'NNN-slug/<stamp>-<role>.md' or 'agent-comms/NNN-slug/messages/<stamp>-<role>.md'`,
    };
  }
  if (ORDINAL.test(named.file)) {
    return {
      refusal: `--d1 '${raw}' names an ordinal ('${named.file}') — ordinals travel (norm 024): the same message answers to another number as soon as one is inserted before it. Name the FILE`,
    };
  }
  if (!named.file.endsWith(".md")) {
    return { refusal: `--d1 '${raw}' — '${named.file}' is not a message file (…-<role>.md)` };
  }
  if (!MESSAGE_FILE.test(named.file)) {
    return {
      refusal: `--d1 '${raw}' — '${named.file}' is not the name of a message: they are stamped, '<YYYY-MM-DDTHH-MM-SSZ>-<role>.md'`,
    };
  }
  return { thread: named.thread, file: named.file, raw };
};

/**
 * A check is green when it FINISHED and did not fail; anything still running is not green,
 * because guard 2 is about the checks having ANSWERED on this head.
 *
 * `SKIPPED` USED TO BE COUNTED GREEN AND IS NOT ANY MORE (thread 120, john's decision of
 * 2026-09-02): a skipped job answered nothing, and green that is the sum of skips is a
 * class this project has already named. It is not a failure either — the reviewer's own
 * action skips itself on a workflow change by design, and six `Notifier Watch: skipped`
 * runs sat on head `0a612b27` beside three real successes. So it is a THIRD class
 * ({@link checkIsSkipped}): it never fails guard 2 by itself, it never satisfies a required
 * run, and it is never what "green" is made of.
 */
const greenConclusions = new Set(["SUCCESS", "NEUTRAL"]);
const greenStates = new Set(["SUCCESS", "EXPECTED"]);
const skippedConclusions = new Set(["SKIPPED"]);

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

/**
 * THE ANCHOR OF AN APPROVE, AS THE RUNS TELL IT (thread 027) — see the header for why the
 * review object cannot tell it and the run can.
 *
 * Three answers, and they are the three states of guard 1: `anchored` (a closed round of the
 * named workflow ran ON THIS HEAD and the verdict lies inside its window), `orphan` (there is
 * no such round, or the verdict lies outside every one of them — the round that produced it
 * read another tree), `by-hand` (the rounds could not be read, or nobody named the workflow).
 */
export type RunAnchor = {
  readonly state: "anchored" | "orphan" | "by-hand";
  readonly detail: string;
};

/** The manual form of the check, printed with every `by-hand` — an obligation names its work. */
const anchorByHand = (head: string): string =>
  `check it by hand: \`gh api "repos/{owner}/{repo}/actions/runs?head_sha=${head}"\` — a CLOSED round of the reviewer's workflow (event 'pull_request', conclusion 'success') must exist on this head, and the verdict must lie inside its 'created_at'…'updated_at'`;

/** A run said in one line — what it read and how it ended, so a STOP can be acted on. */
const describeRun = (run: ReviewRunFact): string =>
  `run ${run.id ?? "?"} (${run.event ?? "?"}, head ${(run.headSha ?? "?").slice(0, 7)}, ${run.status ?? "?"}/${run.conclusion ?? "?"}, ${run.createdAt ?? "?"}…${run.updatedAt ?? "?"})`;

export const reviewRunAnchor = (input: {
  readonly reading: ReviewRunReading | undefined;
  readonly headSha: string;
  /** The approvals guard 1 is about to credit — the ones whose anchor is at stake. */
  readonly approvals: readonly ReviewFact[];
}): RunAnchor => {
  const head = input.headSha;
  const reading = input.reading ?? { state: "not-asked" as const };
  if (reading.state === "not-asked")
    return {
      state: "by-hand",
      detail: `the round of review behind this approve was NOT asked about: no --review-workflow was given, and the name of the reviewer's workflow belongs to the project, not to this package. GitHub anchors a review to the head the PR has when the verdict is SENT, so the formal status alone cannot tell an answer about this head from one about the tree a mid-round push replaced. Pass --review-workflow '<name>', or ${anchorByHand(head)}`,
    };
  if (reading.state === "unreadable")
    return {
      state: "by-hand",
      detail: `the rounds of '${reading.workflow}' on ${head.slice(0, 7)} could not be read, so the anchor of this approve is unverified — GitHub answered: ${reading.reason}. 'actions/runs' is an ACTIONS resource: an installation token needs 'actions: read' in its job's permissions, and unlisted is zeroed, not defaulted. Add the scope, or ${anchorByHand(head)}`,
    };

  // A round that ANSWERS about this head: the workflow the caller named, run on this head,
  // on the `pull_request` event, and finished successfully. `workflow_dispatch` is excluded
  // by both halves at once — such a round hangs on the head of the base branch and carries
  // that `head_sha` (thread 043 met the same run from the other side).
  const named = reading.runs.filter((run) => run.name === reading.workflow);
  const rounds = named.filter(
    (run) =>
      run.headSha === head &&
      run.event === "pull_request" &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
  if (rounds.length === 0)
    return {
      state: "orphan",
      detail:
        named.length === 0
          ? `no round of '${reading.workflow}' is reported for ${head.slice(0, 7)} at all — an approve shown against this head with no round behind it is not an answer about it. What is missing is a round of review ON THIS HEAD (re-label, or a push), not a merge`
          : `no CLOSED round of '${reading.workflow}' on ${head.slice(0, 7)}: ${named.map(describeRun).join("; ")} — a round that read another head, or on another event, or that has not finished, does not anchor a verdict about this head`,
    };

  const windows = rounds
    .map((run) => ({ run, from: stampOf(run.createdAt), to: stampOf(run.updatedAt) }))
    .filter((window) => window.from !== undefined && window.to !== undefined);
  if (windows.length === 0)
    return {
      state: "by-hand",
      detail: `the round(s) of '${reading.workflow}' on ${head.slice(0, 7)} carry no readable window (${rounds.map(describeRun).join("; ")}), so whether the verdict came out of one cannot be told from the payload. ${anchorByHand(head)}`,
    };

  const inside = input.approvals.filter((approval) => {
    const at = stampOf(approval.submittedAt);
    if (at === undefined) return false;
    return windows.some((window) => at >= (window.from as number) && at <= (window.to as number));
  });
  // AN APPROVE WITH NO STAMP IS "CANNOT TELL", NOT "ORPHAN", and the difference is the whole
  // value of the third state: STOP means the anchor was measured and does not hold, `by-hand`
  // means it could not be measured. Read as a STOP, an unstamped payload would refuse a merge
  // for a fact nobody established; read as a pass, it would be the silence this thread exists
  // to end. It is asked AFTER the stamped ones: a verdict that IS shown inside a round of this
  // head is anchored whatever else stands beside it.
  if (inside.length === 0 && input.approvals.some((a) => stampOf(a.submittedAt) === undefined))
    return {
      state: "by-hand",
      detail: `the approve on ${head.slice(0, 7)} carries no 'submittedAt', so it cannot be placed inside the round(s) of '${reading.workflow}' on this head (${rounds.map(describeRun).join("; ")}). ${anchorByHand(head)}`,
    };
  if (inside.length > 0) {
    const window = windows.find((candidate) =>
      inside.some((approval) => {
        const at = stampOf(approval.submittedAt) as number;
        return at >= (candidate.from as number) && at <= (candidate.to as number);
      }),
    );
    return {
      state: "anchored",
      detail: `inside the round ${window?.run.id ?? "?"} of '${reading.workflow}' on this head (${window?.run.createdAt ?? "?"}…${window?.run.updatedAt ?? "?"})`,
    };
  }
  return {
    state: "orphan",
    detail: `the approve (${input.approvals
      .map(
        (approval) =>
          `${approval.author ?? "?"}${present(approval.submittedAt) === undefined ? ", no stamp" : ` at ${present(approval.submittedAt)}`}`,
      )
      .join(
        ", ",
      )}) lies OUTSIDE every closed round of '${reading.workflow}' on ${head.slice(0, 7)}: ${rounds
      .map(describeRun)
      .join(
        "; ",
      )}. A verdict sent from a round that read ANOTHER head is anchored here by GitHub anyway — it answers about the tree that round analysed, not about this one. What is missing is a round of review on this head`,
  };
};

/**
 * UPPER CASE IS NOT THE FACT, IT WAS THE SOURCE (thread 120): GraphQL shouted
 * `COMPLETED`/`SUCCESS`, the REST of `actions/runs` says `completed`/`success`, and the
 * guard judges the same thing in both. Read at the door, once, so no judgement below has to
 * remember which payload it came from.
 */
const word = (value: string | undefined): string | undefined => value?.trim().toUpperCase();

const checkIsFinished = (check: Attempt): boolean =>
  word(check.status) === "COMPLETED" || (check.status === undefined && check.state !== undefined);

/** Still in flight — "it is running" is an answer of its own, never "it is not green". */
export const checkIsRunning = (check: Attempt): boolean =>
  !checkIsFinished(check) &&
  // A status context (`state`) with no `status` is finished by construction; a run with
  // neither field said nothing at all, and "said nothing" is not "is running".
  (check.status !== undefined || check.conclusion === undefined);

export const checkIsSkipped = (check: Attempt): boolean =>
  checkIsFinished(check) &&
  check.conclusion !== undefined &&
  skippedConclusions.has(word(check.conclusion) ?? "");

const checkIsGreen = (check: Attempt): boolean =>
  check.conclusion === undefined && check.status === undefined
    ? check.state !== undefined && greenStates.has(word(check.state) ?? "")
    : word(check.status) === "COMPLETED" &&
      check.conclusion !== undefined &&
      greenConclusions.has(word(check.conclusion) ?? "");

const describeCheck = (check: Attempt): string =>
  `${check.name}=${check.conclusion ?? check.state ?? check.status ?? "?"}`;

const GUARD_2 = { guard: 2, title: "green checks on the same head" } as const;

/**
 * GUARD 2 — "the checks on THIS head answered green", computed off the runs of Actions
 * since thread 120 and not off `statusCheckRollup` (why: `gh.ts`).
 *
 * Five answers, and the four that are not "pass" are four different sentences on purpose:
 *
 *  - THE SOURCE REFUSED (`unreadable`) — GitHub's words are quoted and the guard FAILS. Not
 *    `by-hand` like guard 1's third state: an unread anchor leaves a human an obligation,
 *    an unread OUTCOME leaves the door with nothing at all, and silent degradation into
 *    "nothing confirmed this head" is the class that cost this project a morning.
 *  - NOBODY ASKED (`not-asked`) — the caller reads no runs (the scheduler does not), so the
 *    guard says that, in those words, instead of reading an empty list as a fact about the
 *    head.
 *  - NO RUN ON THE HEAD — Actions answered, and answered nothing about this commit.
 *  - A REQUIRED RUN IS MISSING OR NOT GREEN — see below.
 *  - SOMETHING IS STILL RUNNING — said as "still running", never as "not green": one is a
 *    moment to come back to, the other is a refusal.
 *
 * AND GREEN IS NEVER THE SUM OF SKIPS. A skipped run is neither side (see
 * {@link checkIsSkipped}); a head whose every run skipped is not confirmed by anything, and
 * a required run that only skipped is a required run that did not happen.
 *
 * THE REQUIRED LIST IS DECLARED, NEVER INFERRED. "All the runs that started are green" is
 * a sentence about what happened to start — the door says so out loud when the list is
 * empty rather than passing quietly on it. The list is the caller's (`--required-runs`)
 * because which workflows are obligatory is a fact of the served project, the same line
 * `--review-workflow` and the documents of power already stand on.
 *
 * THE ANSWER IS THE LAST ATTEMPT. `actions/runs` lists reruns as separate runs, so D1's
 * rule (latest attempt per name) is what makes a `rerun --failed` count: a head green after
 * a rerun IS green here, deliberately, and the failed attempt it replaced is not held
 * against it.
 */
export const checksOutcome = (
  pr: PullRequestFacts,
  required: readonly string[] = [],
): GateOutcome => {
  const head = pr.headSha;
  const reading: CheckRunReading = pr.checkRuns ?? { state: "not-asked" };
  if (reading.state === "unreadable")
    return {
      ...GUARD_2,
      state: "fail",
      detail: `the runs on ${head.slice(0, 7)} could not be read, so the outcome of the checks is UNKNOWN — GitHub answered: ${reading.reason}. Guard 2 reads 'actions/runs?head_sha=' (thread 120): 'statusCheckRollup' is a Checks resource no fine-grained token can be granted, and this door refuses rather than calling an unread outcome an outcome`,
    };
  if (reading.state === "not-asked")
    return {
      ...GUARD_2,
      state: "fail",
      detail: `the runs on ${head.slice(0, 7)} were not asked for — this caller reads no Actions, so nothing here has confirmed the head. By hand: \`gh api "repos/{owner}/{repo}/actions/runs?head_sha=${head}"\``,
    };

  const attempts = latestAttemptPerName(pr.checks.map(asAttempt));
  if (attempts.length === 0)
    return {
      ...GUARD_2,
      state: "fail",
      detail: `no run of Actions reported on ${head.slice(0, 7)} — nothing has confirmed this head`,
    };

  const running = attempts.filter(checkIsRunning);
  const skipped = attempts.filter(checkIsSkipped);
  const green = attempts.filter(checkIsGreen);
  const failed = attempts.filter(
    (check) => !checkIsGreen(check) && !checkIsSkipped(check) && !checkIsRunning(check),
  );
  const missing = required.filter(
    (name) => !green.some((check) => check.name.trim().toLowerCase() === name.trim().toLowerCase()),
  );
  const beside =
    skipped.length === 0
      ? ""
      : `; skipped (neither side): ${skipped.map(describeCheck).join(", ")}`;

  if (failed.length > 0)
    return {
      ...GUARD_2,
      state: "fail",
      detail: `not green: ${failed.map(describeCheck).join(", ")}${beside}`,
    };
  if (missing.length > 0)
    return {
      ...GUARD_2,
      state: "fail",
      detail: `required run(s) with no green answer on this head: ${missing.join(", ")} — ${running.length > 0 ? `still running: ${running.map(describeCheck).join(", ")}` : "not among the runs of this head at all"}${beside}`,
    };
  if (running.length > 0)
    return {
      ...GUARD_2,
      state: "fail",
      detail: `still running on ${head.slice(0, 7)}: ${running.map(describeCheck).join(", ")} — the checks have not answered yet, which is a moment to come back to and not a refusal${beside}`,
    };
  if (green.length === 0)
    return {
      ...GUARD_2,
      state: "fail",
      detail: `nothing on ${head.slice(0, 7)} answered green — every run of this head skipped: ${skipped.map(describeCheck).join(", ")}. Green is never the sum of skips`,
    };
  return {
    ...GUARD_2,
    state: "pass",
    detail:
      `${green.length} run(s) green: ${green.map(describeCheck).join(", ")}${beside}. ` +
      (required.length === 0
        ? "NO REQUIRED LIST WAS DECLARED (--required-runs): this says every run that started on this head is green, not that every run that had to run did"
        : `required and green: ${required.join(", ")}`),
  };
};

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
  /** The runs guard 2 requires by name; see {@link checksOutcome}. Empty means none was declared. */
  required: readonly string[] = [],
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
  const approvalFacts = lastOnHead.filter(
    (review) => !anchorless.has(review) && review.state === "APPROVED",
  );
  const approvals = onHead.filter((review) => review.state === "APPROVED");
  // The anchor of thread 027, asked of the approvals that survived everything above: being
  // shown against this head is not the same as having been decided about it.
  const runAnchor = reviewRunAnchor({
    reading: pr.reviewRuns,
    headSha: head,
    approvals: approvalFacts,
  });
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
              // The three states of thread 027, in one place: the approve is credited only
              // when a round of review on THIS head is shown to have produced it.
              state:
                runAnchor.state === "anchored"
                  ? "pass"
                  : runAnchor.state === "orphan"
                    ? "fail"
                    : "by-hand",
              detail:
                runAnchor.state === "anchored"
                  ? `approved on ${head.slice(0, 7)} by ${approvals
                      .map((review) => review.author ?? "?")
                      .join(", ")} — ${runAnchor.detail}`
                  : runAnchor.state === "orphan"
                    ? `an approve is shown on ${head.slice(0, 7)} (${approvals
                        .map((review) => review.author ?? "?")
                        .join(
                          ", ",
                        )}) but no round of review on this head produced it: ${runAnchor.detail}`
                    : `an approve is shown on ${head.slice(0, 7)} by ${approvals
                        .map((review) => review.author ?? "?")
                        .join(
                          ", ",
                        )}, and the door cannot tell whether it answers about THIS head: ${runAnchor.detail}`,
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

  return { verdict, checks: checksOutcome(pr, required) };
};

/**
 * Whether the two mechanical guards HOLD — the one fact the scheduler reads off a pull
 * request (thread 019, point 5). Deliberately a boolean over {@link verdictAndChecks} and
 * not a reading of its own: "ready" means precisely "neither of the two guards the door
 * computes would refuse", and the words that explain WHY stay with the outcomes.
 */
/**
 * AND "WOULD NOT REFUSE" IS THE WHOLE OF IT — `by-hand` counts as holding (thread 027). The
 * scheduler ranks a queue; it does not open a door. Guard 1 answers `by-hand` whenever the
 * rounds of review were not read, and this reader never reads them (that would be an Actions
 * call per pull request per tick, for a hint). Read as "not ready", the new state would
 * silently switch the merge-ready acceleration off for every PR there is; read as "nothing
 * refuses", the pair is raised and the OBLIGATION is answered at the door, where it belongs.
 */
export const guardsOneAndTwoHold = (pr: PullRequestFacts): boolean => {
  const { verdict, checks } = verdictAndChecks(pr);
  return verdict.state !== "fail" && checks.state !== "fail";
};

export const evaluateMergeGate = (input: {
  readonly pr: PullRequestFacts;
  readonly powerDocs: readonly string[];
  /** Class Д-1 DECLARED at the door — see the header and {@link readD1Reference}. */
  readonly d1?: D1Reference | undefined;
  /** The runs guard 2 requires by name (`--required-runs`); see {@link checksOutcome}. */
  readonly requiredRuns?: readonly string[] | undefined;
}): MergeGateVerdict => {
  const { pr } = input;
  const head = pr.headSha;
  const { verdict, checks } = verdictAndChecks(pr, input.requiredRuns ?? []);

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
  // Where the decision is fixed and where the PACKAGE is stated are two different
  // conversations as often as not, and that is not a refusal — it is a fact the trace
  // has to be written with open eyes (thread 068, point 6).
  const d1Elsewhere =
    input.d1 !== undefined && thread !== undefined && input.d1.thread !== thread
      ? ` (the decision is fixed in '${input.d1.thread}', the PR belongs to thread '${thread}' — not a refusal, said so the trace is written knowing it)`
      : "";
  const power: GateOutcome =
    touched.length === 0
      ? {
          guard: 4,
          title: "no self-merge on the documents of power",
          state: "pass",
          detail:
            input.d1 === undefined
              ? `${pr.changedPaths.length} changed path(s), none of them a document of power`
              : // Never silent in either direction: a flag that changed nothing is a flag
                // whose author believes it did something (the norm `--working-cards` follows).
                `${pr.changedPaths.length} changed path(s), none of them a document of power — --d1 '${input.d1.raw}' changed nothing here: this guard was not going to stop the merge`,
        }
      : input.d1 === undefined
        ? {
            guard: 4,
            title: "no self-merge on the documents of power",
            state: "fail",
            detail: `john merges this one — it changes ${touched.join(", ")}`,
          }
        : {
            guard: 4,
            title: "no self-merge on the documents of power",
            state: "by-hand",
            detail: `class Д-1 declared: it changes ${touched.join(", ")}, and the diff is obliged to ONLY encode the decision fixed in '${input.d1.raw}'${d1Elsewhere} — read that message, and name the class and the reference in your trace (guard 5). A new norm in this diff is john's merge, not yours`,
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

/**
 * The obligations of THIS verdict, in the last line — not the two the door used to name
 * from memory (068, point 7). Guard 4 joins them when class Д-1 is declared, and the
 * closing line is the last thing a human reads before pressing merge: it must not name a
 * set of obligations the verdict above it does not have.
 */
const obligationsOf = (verdict: MergeGateVerdict): string => {
  const numbers = verdict.guards
    .filter((guard) => guard.state === "by-hand")
    .map((guard) => String(guard.guard));
  const listed =
    numbers.length <= 1
      ? (numbers[0] ?? "")
      : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
  // The count is never one on the path this line is printed on (guards 3 and 5 are both
  // obligations whenever the merge is allowed), but the verb agrees anyway: a sentence
  // built to be read by a human does not go stale on a state nobody meant to reach.
  return numbers.length === 1 ? `guard ${listed} is` : `guards ${listed} are`;
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
    ? `nothing in the facts forbids this merge — ${obligationsOf(verdict)} yours to answer`
    : verdict.mergeability.state === "blocked" &&
        verdict.guards.every((guard) => guard.state !== "fail")
      ? "REFUSED: GitHub itself would refuse this merge"
      : "REFUSED: a guard does not hold",
];
