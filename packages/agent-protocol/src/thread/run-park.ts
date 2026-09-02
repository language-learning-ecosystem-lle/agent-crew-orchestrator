/**
 * A PARK ON A RUN THAT DOES NOT EXIST (thread `062-park-without-a-run`).
 *
 * `parked-on: run:N` has EXACTLY ONE lift — a message about the outcome of the round on that
 * pull request, written by the notifier out of a workflow run. Which makes the deadly case not
 * "the run hangs" but "there is no run and there never will be": the pair stands silently and
 * without a ceiling, and nothing in the feed says so.
 *
 * It happened live on 2026-08-08: dev-core announced `checks` on head `6f933b032` of PR #243 and
 * parked on `run:243`; there was not one run on that head (`gh pr checks 243` — "no checks
 * reported"), because #244 had landed in `main` eleven minutes earlier and the push went in
 * CONFLICTING. GitHub assembles no merge ref for a conflicting pull request and therefore emits
 * no `pull_request` event, so the workflow that would have produced the awaited message was
 * never born. The pair stood from 15:03Z to 17:15Z until a human lifted the park by hand.
 *
 * THE NOTIFIER IS NOT AT FAULT and is not touched here — it had nothing to say. The defect is
 * that the park is taken without asking whether the SOURCE OF THE EVENT exists.
 *
 * TWO LAYERS, AND THEY CATCH DIFFERENT THINGS (curator's statement of work, point 3):
 *
 *  1. {@link judgeRunPark} — AT THE DOOR of the park. Is there a run on THIS head, is the pull
 *     request mergeable at all, and — since thread 032 — is any of those runs STILL RUNNING.
 *     Nothing there — the park is refused with the reason in words. This closes the case above
 *     entirely. TWO CALLS SINCE THREAD 120, not one: `gh pr view` for the head and `mergeable`,
 *     `gh api actions/runs?head_sha=` for the runs. They were one call while the runs came from
 *     `statusCheckRollup` — and that field is a Checks resource no fine-grained token can hold,
 *     so on this circuit the single call failed WHOLE and the door said "not verified" about
 *     every park it was ever asked. Two calls that answer beat one that 403s.
 *
 *     The third question is the other end of the same class and was measured a fortnight later
 *     (thread 032, a consumer, 2026-08-23): a park whose condition had come true TWENTY SECONDS BEFORE
 *     it was written. The door is the only place that can see it, because the reader of the
 *     lift looks forward from the park by construction and the header of an outcome message
 *     names no run — so "has it already happened" is a question about the world, not about the
 *     feed, and it is asked once, at the moment the promise is made.
 *  2. {@link staleRunParks} — a CEILING ON THE AGE of a `run:` park, for what layer 1 cannot
 *     see: a run that existed and was lost in flight (a dead runner, a workflow that never
 *     reported, a silent notifier). Past the ceiling the park stops freezing the pair and the
 *     role is raised to check the outcome itself — exactly what the human did by hand.
 *
 * Neither layer closes the class alone: layer 1 sees only the moment of parking, layer 2 only
 * the passage of time. The threshold is a PARAMETER with a default named in the help, and the
 * default is measured rather than guessed (see {@link RUN_PARK_TTL_SECONDS}).
 */

import { mergedPrs, parkingOf, type Thread } from "./thread.js";

/**
 * HOW LONG A `run:` PARK MAY STAND before the pair is raised to look for itself — 30 minutes,
 * and the number is measured, not chosen.
 *
 * The median `checks` on this pool is 9–10 minutes (runs `31262638311` — 9m32s, `31261416352` —
 * 9m29s, `31261270639` — 9m35s, all on 2026-08-08), so 30 minutes is ≈3× the median: it does not
 * argue with an honestly long round, and it does not leave a dead park standing for two hours.
 * A REVIEW round on the same PR is longer, and that is why the ceiling does not end the wait but
 * hands it back to the role: the raised session looks at the run and parks again if it is alive.
 */
export const RUN_PARK_TTL_SECONDS = 30 * 60;

/**
 * What the door asks GitHub about a pull request before a park on its round is allowed.
 *
 * TWO QUESTIONS AND TWO SOURCES SINCE THREAD 120, and that is why the counts are OPTIONAL:
 * the head and `mergeable` come from `gh pr view`, the runs on that head from
 * `actions/runs?head_sha=`. A token can hold the first and be refused the second, and a door
 * that threw away the answer it did get would refuse nothing it could have refused —
 * `CONFLICTING` is judged from the first source alone. Absent counts mean "the runs were not
 * read", are said out loud with {@link RunParkFacts.runsRefusal}, and are NEVER read as
 * "there are no runs", which is a refusal of the park.
 */
export type RunParkFacts = {
  /** The head the park would be waiting on — named in the refusal, so a human can check it. */
  readonly headSha: string;
  /** `gh`'s own word: `MERGEABLE`, `CONFLICTING`, `UNKNOWN` (it is computed lazily). */
  readonly mergeable: string;
  /**
   * How many runs Actions reports ON THAT HEAD. Zero is the defect; `undefined` is "not
   * read" and degrades into a note, exactly like a `gh` that could not be asked at all.
   */
  readonly checkRuns?: number;
  /**
   * How many of those are STILL IN FLIGHT — queued or running (thread 032). Zero with
   * `checkRuns > 0` is the race: the round is over, its outcome is already in the feed or is
   * being written into it right now, and the park would wait for an event behind its own back.
   */
  readonly pendingRuns?: number;
  /** Why the counts are missing — GitHub's own sentence, quoted into the note. */
  readonly runsRefusal?: string;
};

/**
 * One run of `actions/runs` as this door reads it (thread 120) — the head it ran on and
 * whether it has finished. Two fields, because those are the two questions.
 */
export type RunRollupEntry = {
  /** Actions: `queued` / `in_progress` / `completed` (and whatever GitHub adds next). */
  readonly status?: string | null | undefined;
  /**
   * `head_sha` of the run. The API is asked WITH the head in the query and the answer is
   * filtered by it again ({@link runsOnHead}) — the same belt guard 2 wears, for the same
   * reason: this circuit has twice paid for an outcome read off another slice of the repo.
   */
  readonly headSha?: string | null | undefined;
  /**
   * A status context of the old `statusCheckRollup`: `PENDING` / `SUCCESS` / `FAILURE`.
   * Nothing produces this shape any more — it is still read because the reading costs one
   * comparison and because the vocabulary of the old source is what older feeds quote.
   */
  readonly state?: string | null | undefined;
};

/**
 * THE RUNS THAT BELONG TO THIS HEAD — the anchor enforced on the ANSWER and not only in the
 * query, because the payload is somebody else's.
 *
 * A run naming another head is dropped by name rather than read charitably: counting it would
 * let a park stand behind a round of another slice, the class this door exists to refuse. A run
 * carrying NO head is dropped too — it anchors nothing, and "unanchored" cannot be the evidence
 * that there is something to wait for. Both drops err towards refusing the park, which is the
 * loud direction; the silent one has no second layer.
 */
export const runsOnHead = (
  runs: readonly RunRollupEntry[],
  head: string,
): readonly RunRollupEntry[] =>
  runs.filter((run) => (run.headSha ?? "").toLowerCase() === head.toLowerCase());

/**
 * HOW MANY ROUNDS ARE STILL RUNNING ON THE HEAD — the one fact the race is read from, kept
 * pure so its edges are a test and not a screenshot of `gh`.
 *
 * The vocabulary it reads is Actions' since thread 120 (`queued` / `in_progress` /
 * `completed`, lower case in REST), and the comparison has always been case-folded, which is
 * why the move of the source did not move this function: `COMPLETED` of the old GraphQL rollup
 * and `completed` of `actions/runs` are the same word to it.
 *
 * NOT-COMPLETED IS THE POSITIVE READING, and the asymmetry is deliberate: an entry whose shape
 * this function does not recognise (no `status`, no `state`, a word GitHub invented after this
 * was written) is counted as FINISHED — never as pending. Counting it as pending would let a
 * dead park through, which is the defect being repaired; counting it as finished can at worst
 * refuse a park whose round is alive, and that refusal is loud, names the head and is repaired
 * by looking once. The layer that catches a wrongly-standing park is the age ceiling; there is
 * no layer that catches a wrongly-silent door.
 */
export const pendingRunsOf = (entries: readonly RunRollupEntry[]): number =>
  entries.filter((entry) => {
    const status = entry.status?.toUpperCase();
    if (status !== undefined && status !== null && status !== "") return status !== "COMPLETED";
    return entry.state?.toUpperCase() === "PENDING";
  }).length;

/**
 * IS THIS REFUSAL OF `gh` THE SENTENCE "THERE IS NO SUCH PULL REQUEST" (thread 061) — read from
 * the vendor's own words, and kept pure so the patterns are a test rather than a screenshot.
 *
 * NARROW ON PURPOSE, and the narrowness is the safety: only the two sentences GitHub says about
 * a MISSING PULL REQUEST count. `Could not resolve to a Repository`, `HTTP 404` on the repo, a
 * missing token, a `gh` that is not installed are NOT this — they are the network blinking or the
 * box being misconfigured, and those must keep leaving the park exactly as it was. A pattern that
 * matched them too would turn a flaky network into a role that cannot end its turn, which is the
 * failure the degradation of this door was written to avoid.
 */
export const looksLikeAbsentPr = (message: string): boolean =>
  /could not resolve to a pullrequest/i.test(message) || /no pull requests found/i.test(message);

/** The verdict of the door: the park stands, or it is refused with the reason in words. */
export type RunParkVerdict =
  | { readonly ok: true; readonly note?: string }
  | { readonly ok: false; readonly reason: string };

/**
 * IS THERE ANYTHING TO WAIT FOR — the check at the entrance of a `run:` park.
 *
 * Pure, so the wording is testable without a network; the one `gh` call that feeds it lives at
 * the CLI door beside every other call to the vendor.
 *
 * TWO REFUSALS, SAID APART, because they are repaired differently:
 *  · CONFLICTING — the run will never be born (no merge ref, no `pull_request` event); the
 *    repair is two minutes of the author's hands (rebase, push) and the park after it;
 *  · no runs on this head — the run may simply not have been registered yet (a push and its
 *    first check run are seconds apart, not zero), so the refusal names the head and the one
 *    command that answers, rather than diagnosing on the author's behalf.
 *
 * A VENDOR THAT COULD NOT BE ASKED DOES NOT REFUSE THE PARK — the degradation runs in one
 * direction here as it does for the merge-ready tier: no token, no network, an unparseable
 * payload leave the park exactly as it was before this check existed, with a note saying the
 * question was not asked. Refusing on a refusal of `gh` would turn a flaky network into a role
 * that cannot end its turn, and the age ceiling is the second layer precisely for what the
 * first one does not see.
 */
export const judgeRunPark = (input: {
  readonly pr: number;
  readonly facts?: RunParkFacts;
  /** Why the facts are missing — `gh`'s own sentence, quoted into the note. */
  readonly refusal?: string;
  /**
   * THE VENDOR SAID THE PULL REQUEST IS NOT THERE (thread 061, msg-002) — `where` is what was
   * asked, so a human can check the same thing by hand.
   *
   * This is the one refusal of `gh` that is a FACT ABOUT THE WORLD and not a blink of the
   * network, so it is the one that does NOT degrade into a note: everything else leaves the park
   * standing (see the sentence above about degradation running in one direction), but "no such
   * pull request" means the park's only lift can never be written.
   */
  readonly absent?: { readonly where: string };
}): RunParkVerdict => {
  const { facts } = input;
  if (input.absent !== undefined) {
    return {
      ok: false,
      reason: `--parked-on 'run:${input.pr}' — gh answers that THERE IS NO PULL REQUEST #${input.pr} in the repository it was asked about (${input.absent.where}), and this form takes the NUMBER OF A PULL REQUEST: 'run:<pr>' waits for the round ON that PR. Nothing can ever name #${input.pr} back, so the park would stand until a human lifted it by hand (thread 061). If the number came from a workflow run, read the PR number instead ('gh pr view --json number' on the branch, or the last part of its URL)`,
    };
  }
  if (facts === undefined) {
    return {
      ok: true,
      note: `the run behind the park on PR #${input.pr} was NOT verified: ${
        input.refusal ?? "gh could not be asked"
      }. The park stands — the age ceiling (${Math.round(
        RUN_PARK_TTL_SECONDS / 60,
      )} min by default) is what catches it if there is nothing to wait for`,
    };
  }
  if (facts.mergeable.toUpperCase() === "CONFLICTING") {
    return {
      ok: false,
      reason: `--parked-on 'run:${input.pr}' — PR #${input.pr} is CONFLICTING, so the merge ref is not assembled and NO RUN WILL BE BORN on head ${short(
        facts.headSha,
      )}: the park would wait for a message the circuit has no reason to write (thread 062, the live case of 2026-08-08 — 2h10m of a frozen pair). Resolve the conflict, push, and park on the round that starts then`,
    };
  }
  // THE PULL REQUEST WAS READ AND ITS RUNS WERE NOT (thread 120) — the two sources of this
  // door can refuse apart, and this is the half where `gh pr view` answered while
  // `actions/runs` did not. The park stands with the reason quoted, in the same one direction
  // as a `gh` that could not be asked at all: an unread source is not evidence of an empty one.
  // `CONFLICTING` above is judged before this on purpose — it is a fact of the first source,
  // and the runs have nothing to add to a merge ref GitHub will never assemble.
  if (facts.checkRuns === undefined) {
    return {
      ok: true,
      note: `the runs on head ${short(facts.headSha)} of PR #${input.pr} were NOT read, so the park was not verified: ${
        facts.runsRefusal ?? "the runs of the head could not be asked for"
      }. The park stands — the age ceiling (${Math.round(
        RUN_PARK_TTL_SECONDS / 60,
      )} min by default) is what catches it if there is nothing to wait for`,
    };
  }
  if (facts.checkRuns === 0) {
    return {
      ok: false,
      reason: `--parked-on 'run:${input.pr}' — there is not one run on head ${short(
        facts.headSha,
      )} of PR #${input.pr}, and the park has exactly one lift: a message about the OUTCOME of a run. Waiting for an event with no source is the silence of thread 062. Check with ${byHand(
        facts.headSha,
      )} — if a push has just landed, the first run appears seconds later and the park is legal then; if the answer stays empty, find out why the workflow did not start before parking`,
    };
  }
  // THE ROUND IS OVER BEFORE THE PARK IS WRITTEN (thread 032, the race of the third refusal).
  // The lift of a `run:` park is a message, and the reader of that lift looks FORWARD from the
  // park only — so an outcome that landed while the letter was being composed lifts nothing,
  // ever. It was measured on 2026-08-23 (a consumer): the outcome of the round on PR #386 was
  // committed at 05:41:46Z, the letter parking on `run:386` at 05:42:06Z — twenty seconds
  // BEHIND its own condition; the pair stood until a human woke it 22 minutes later, the second
  // such sleep in two days.
  //
  // The window is not a mistake of the role and cannot be closed by care: between the snapshot
  // a session takes ("checks in_progress") and the commit of the letter it writes from that
  // snapshot there are always minutes, and a fast round ends inside them for anybody. What
  // closes it is asking the CURRENT state at the door instead of subscribing to the future:
  // nothing in flight on this head — nothing to wait for, and the park does not stand.
  //
  // SAME CLASS AND SAME REMEDY AS "no runs at all" above, said apart because the repair
  // differs: there the run has not been born yet, here it has already died. A role that has
  // just pushed or just labelled and finds this refusal is in the first case — the round
  // appears seconds later and the park is legal then; a role whose round is genuinely over
  // must read the outcome instead of parking behind it.
  if (facts.pendingRuns === 0) {
    return {
      ok: false,
      reason: `--parked-on 'run:${input.pr}' — every run on head ${short(
        facts.headSha,
      )} of PR #${input.pr} has ALREADY FINISHED (${facts.checkRuns} run${
        facts.checkRuns === 1 ? "" : "s"
      }, none queued or in progress), so the outcome this park waits for has already happened: its message is in the feed BEHIND the park, and the lift only ever looks forward (thread 032, the live race of 2026-08-23 — 22 minutes of a frozen pair). Read the outcome and report it, or, if you have just pushed or just put up the label, wait for the round to appear (${byHand(
        facts.headSha,
      )}) and park then`,
    };
  }
  return {
    ok: true,
    note: `the park on PR #${input.pr} waits for a run that is still running (${facts.pendingRuns} of ${facts.checkRuns} on head ${short(
      facts.headSha,
    )})`,
  };
};

const short = (sha: string): string => (sha.length > 9 ? sha.slice(0, 9) : sha);

/**
 * THE ONE COMMAND THAT ANSWERS THE SAME QUESTION BY HAND — and it is not `gh pr checks`
 * any more (thread 120).
 *
 * `gh pr checks` reads `statusCheckRollup`, a Checks resource that no fine-grained token can
 * be granted, so a role told to run it on this circuit gets `Resource not accessible by
 * personal access token` and learns nothing. A refusal that hands out a command the reader
 * cannot run is worse than one that hands out none: it spends the reader's turn proving the
 * door wrong. This is the same call the door itself makes.
 */
const byHand = (head: string): string =>
  `'gh api "repos/{owner}/{repo}/actions/runs?head_sha=${head}"'`;

/** A `run:` park that has outlived the ceiling — the thread, the round, and how long it stood. */
export type StaleRunPark = {
  readonly thread: string;
  readonly pr: number;
  /** The stamp of the message that declared the park. */
  readonly since: string;
  readonly ageSeconds: number;
};

/**
 * THE `run:` PARKS THAT HAVE OUTLIVED THE CEILING — layer 2, read from the same scan of the mail
 * every other park reading comes from.
 *
 * Only `run:` parks are aged. A park behind a PERSON waits for a human and has no business being
 * timed out by a machine; a park on `pr:N` waits for a button whose press is announced whenever
 * it happens, and merges legitimately wait for days. Only this one waits for a machine event
 * with a measured duration, which is what makes a ceiling meaningful at all.
 */
export const staleRunParks = (
  threads: readonly Thread[],
  options: { readonly now: Date; readonly ttlSeconds?: number },
): readonly StaleRunPark[] => {
  const ttl = options.ttlSeconds ?? RUN_PARK_TTL_SECONDS;
  // ZERO IS "OFF", not "everything is stale": the ceiling is the SAFETY of the pair, and a box
  // that wants only the door check must be able to say so without setting a number so large it
  // reads as a policy. The refusal at the door is the layer that cannot be switched off.
  if (ttl <= 0) return [];
  const merged = mergedPrs(threads);
  const stale: StaleRunPark[] = [];
  for (const thread of threads) {
    const parking = parkingOf(thread, merged);
    if (parking === undefined || parking.kind !== "run" || parking.pr === undefined) continue;
    const since = Date.parse(parking.since);
    if (Number.isNaN(since)) continue;
    const ageSeconds = Math.floor((options.now.getTime() - since) / 1000);
    if (ageSeconds < ttl) continue;
    stale.push({ thread: thread.id, pr: parking.pr, since: parking.since, ageSeconds });
  }
  return stale;
};

/** The one wording of a lifted park, for the daemon's stream and the operator's frame. */
export const describeStaleRunPark = (stale: StaleRunPark, ttlSeconds?: number): string =>
  `thread ${stale.thread}: the park on the round of PR #${stale.pr} HAS GONE STALE — declared ${
    stale.since
  }, standing ${Math.floor(stale.ageSeconds / 60)} min against a ceiling of ${Math.round(
    (ttlSeconds ?? RUN_PARK_TTL_SECONDS) / 60,
  )} min. It no longer freezes the pair: the role is raised to check the outcome of that run itself (thread 062, layer 2)`;
