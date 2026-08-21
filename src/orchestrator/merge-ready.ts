/**
 * WHICH WAITING THREAD IS HOLDING A MERGE (thread `019-operator-ux`, john's decision of
 * 2026-08-01, curator's statement of work of the same day, point 5).
 *
 * A pull request that has passed the two guards a machine can compute — an approve on the
 * current head and green checks on that same head — is waiting for nothing but a button.
 * Its pair should not stand in the general queue behind conversations that still have
 * thinking to do, so the scheduler reads that fact and raises it earlier.
 *
 * THE FACT IS MEASURED, NEVER WRITTEN DOWN. The candidate john named first — the verdict
 * notifier stamping `priority: high` into the feed — was refused on three counts, and the
 * third is the one this module exists for: "ready to merge" is written in the repository
 * EXACTLY ONCE, as guards 1 and 2 of the merge door. So this module computes nothing of
 * its own; it calls {@link guardsOneAndTwoHold} and reports which threads it fired for.
 * A `priority` in the feed would also be a right (`thread-priority`, held by john and
 * curator) handed to a machine role, and an opinion frozen at the moment of the verdict:
 * the checks on that head may still be flying, and the head may move with the next push.
 *
 * A PR IS TIED TO A THREAD THE WAY THE DOOR TIES IT — by the `thread: NNN-slug` line of
 * its description (rule 14), read with the door's own {@link threadOfDescription}. That
 * line already exists for the reviewer and for guard 3; inventing a second link (a
 * message naming a number, a park) would mean two answers to "whose PR is this".
 *
 * DEGRADATION RUNS IN ONE DIRECTION ONLY, and this is a requirement of the statement of
 * work rather than an implementation detail. No token, no network, a refusal from `gh`, a
 * payload that does not parse — the answer is an EMPTY map: nobody is accelerated, nobody
 * is slowed, and the order is bit-for-bit the order of a circuit without merge-ready at
 * all. A silent failure that reordered the queue would be worse than the feature is good.
 *
 * THE PRICE IS BOUNDED BY TWO LIMITS, both named in the statement of work:
 *  · only threads that are ALREADY waiting for a raise are asked about — the queue this
 *    tick is about to order, not the repository's whole PR list;
 *  · a POSITIVE answer is remembered per head SHA ({@link MergeReadyCache}): a head that
 *    was ready last tick is not asked about again. A negative one is never remembered —
 *    "not ready yet" becomes "ready" without the head moving, which is the whole life of
 *    a pull request. The cheap half of the read (the numbers and their heads) still
 *    happens every tick — that is what tells a moved head from a still one, and it is
 *    one call.
 */
import { guardsOneAndTwoHold, type PullRequestFacts, threadOfDescription } from "../merge/gate.js";

/** An open pull request as the cheap half of the read sees it: what it is, where it is, whose it is. */
export type OpenPullRequest = {
  readonly number: number;
  readonly headSha: string;
  /** The description — the `thread:` line is read out of it, and nothing else is. */
  readonly body: string;
};

/**
 * The outside world, as two calls. Injected rather than imported so the ordering can be
 * tested without a network and so the CLI keeps its own `gh` invocation in one place.
 */
export type MergeReadySource = {
  /** Every open pull request, cheaply: number, head, description. */
  readonly open: () => Promise<readonly OpenPullRequest[]>;
  /** Everything guards 1 and 2 judge, for one pull request. */
  readonly facts: (number: number) => Promise<PullRequestFacts>;
};

/**
 * What was measured, remembered by (pull request, head) — and only when it was READY (see
 * the note at the write site). Deliberately a plain mutable map owned by the caller: the
 * daemon keeps one for its whole life, and a test hands in a fresh one to see the read
 * happen.
 */
export type MergeReadyCache = Map<string, boolean>;

export const createMergeReadyCache = (): MergeReadyCache => new Map();

const cacheKey = (pr: number, head: string): string => `${pr}@${head}`;

/** Which thread is held by which merge-ready PR, plus what the reader wants said out loud. */
export type MergeReadyReading = {
  /** thread id → the number of the PR whose guards 1-2 hold. Empty on any failure. */
  readonly ready: ReadonlyMap<string, number>;
  /** Lines for the daemon's stream — a refusal, or the pairs that were accelerated. */
  readonly notes: readonly string[];
  /**
   * THE VENDOR'S OWN SENTENCE when the tier could not be read AT ALL, verbatim — the fact
   * a persistent outage is counted and quoted from (`outage.ts`, thread 051). It is set
   * only for the failure of the cheap half (`open()`), which is the whole tier going dark;
   * a single pull request that could not be read is a partial answer, stays a note, and
   * does not stand the tier down. Absent means the tier answered.
   */
  readonly refusal?: string;
  /**
   * WAS THE VENDOR ASKED AT ALL. Three answers, not two (reviewer's finding 2 on #161): a
   * tick with no candidates never opens a socket, and reading its silence as "the tier
   * answered" would clear a run of refusals that nothing has fixed. It is NO EVIDENCE
   * either way, and `foldGhOutage` holds the run on it.
   */
  readonly asked: boolean;
};

const EMPTY: MergeReadyReading = { ready: new Map(), notes: [], asked: false };

/**
 * Read the merge-readiness of the threads that are already queued.
 *
 * `threads` is the scope of the question — the candidates of this tick. A pull request
 * pointing at a thread nobody is waiting on is not asked about: its readiness could not
 * change any order.
 */
export const readMergeReady = async (input: {
  readonly source: MergeReadySource;
  readonly threads: readonly string[];
  readonly cache: MergeReadyCache;
}): Promise<MergeReadyReading> => {
  const wanted = new Set(input.threads);
  if (wanted.size === 0) return EMPTY;
  let open: readonly OpenPullRequest[];
  try {
    open = await input.source.open();
  } catch (error) {
    return {
      ready: new Map(),
      notes: [
        `merge-ready: not asked — ${describe(error)}. Nothing is accelerated and nothing is slowed: the queue is exactly the queue without merge-ready`,
      ],
      refusal: describe(error),
      asked: true,
    };
  }
  const ready = new Map<string, number>();
  const notes: string[] = [];
  for (const pr of open) {
    const thread = threadOfDescription(pr.body);
    // A PR with no `thread:` line is a defect of ITS OWN (rule 14, and guard 3 refuses
    // it) — not this reader's to report: it reorders nothing.
    if (thread === undefined || !wanted.has(thread)) continue;
    const key = cacheKey(pr.number, pr.headSha);
    const remembered = input.cache.get(key);
    let holds: boolean;
    if (remembered !== undefined) holds = remembered;
    else {
      try {
        holds = guardsOneAndTwoHold(await input.source.facts(pr.number));
      } catch (error) {
        notes.push(
          `merge-ready: PR #${pr.number} (${thread}) not read — ${describe(error)}; the thread keeps its ordinary place`,
        );
        continue;
      }
      // ONLY "READY" IS REMEMBERED (curator, 2026-08-01). "Not ready yet" is the answer of
      // a MOMENT, not of a head: the approve and the green checks arrive on the SAME head
      // the pull request was opened with — that is the only way a PR becomes merge-ready at
      // all — so a remembered `false` would shut the question for the whole life of the
      // daemon exactly in the case this tier exists for. "Ready" is absorbing the other
      // way round: were it to stop holding, the door refuses anyway, and the price of the
      // stale memory is one needless place in a queue.
      if (holds) input.cache.set(key, holds);
    }
    if (!holds) continue;
    // The FIRST ready PR of a thread wins the tier. A thread with two of them is raised
    // for the same reason either way, and naming one keeps the queue line short.
    if (!ready.has(thread)) ready.set(thread, pr.number);
  }
  for (const [thread, pr] of ready) notes.push(note({ thread, pr }));
  return { ready, notes, asked: true };
};

/**
 * WHAT THE RAISE IS FOR, IN THE LINE ITSELF (thread `024-merge-ready-vs-power-docs`,
 * curator's statement of work of 2026-08-21).
 *
 * The line used to end at "the pair is raised ahead of the ordinary queue", and a reader
 * of the frame — the curator, on 2026-08-21T15:15Z — read that ending as "the pair was
 * raised in order to press merge". On PR #48 of that morning the button was not the
 * pair's at all: guard 4 of the door stops a diff that touches a document of power at
 * EVERY raised role, and john's hand is the only one that merges it. The tier measured
 * the truth (guards 1-2 did hold) and promised something else with it. MEASURED, not
 * remembered: over both files of the daemon's log the tier fired for 17 pull requests,
 * of which 4 touched documents of power — #33, #35, #38, #48. The class is not a
 * one-off, so the words are the thing that changes; the ORDER is not touched, and neither
 * is the map (see the header: any weakening of that degradation is worse than the tier).
 *
 * ONE NOTE FOR EVERY PULL REQUEST, and the missing half is missing ON PURPOSE. This
 * module could name the offending document for SOME pull requests — `powerDocuments()`
 * derives half of the door's list from the role cards and the config without any new
 * data — and that is exactly the trap: of the four measured cases the derived half would
 * name only #38, leaving #33, #35 and #48 with no name at all while their diffs DO touch
 * documents of power. A note that names a document sometimes teaches its reader that
 * silence means "no documents of power here" — a false "clear" is read as a fact, whereas
 * a standing caveat is read as what it is. Naming the document of THIS pull request needs
 * the declared list to become data (a field of `agent-protocol.json`, john's to own); until
 * it is, the line carries the caveat and no name.
 */
const note = (input: { readonly thread: string; readonly pr: number }): string =>
  `merge-ready: ${input.thread} — guards 1-2 hold on PR #${input.pr} (approve on the head, checks green on it). Guards 3-5 stay with a human, and a diff that touches a document of power is john's button, not the pair's. The pair is raised ahead of the ordinary queue to MOVE that pull request: merge it if the remaining guards allow, otherwise park behind it or report`;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
