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
 *  1. {@link judgeRunPark} — AT THE DOOR of the park. One `gh` call: is there a run on THIS
 *     head, and is the pull request mergeable at all. Nothing there — the park is refused with
 *     the reason in words. This closes the case above entirely and costs one call.
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

/** What the door asks GitHub about a pull request before a park on its round is allowed. */
export type RunParkFacts = {
  /** The head the park would be waiting on — named in the refusal, so a human can check it. */
  readonly headSha: string;
  /** `gh`'s own word: `MERGEABLE`, `CONFLICTING`, `UNKNOWN` (it is computed lazily). */
  readonly mergeable: string;
  /** How many check runs / status contexts GitHub reports ON THAT HEAD. Zero is the defect. */
  readonly checkRuns: number;
};

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
}): RunParkVerdict => {
  const { facts } = input;
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
  if (facts.checkRuns === 0) {
    return {
      ok: false,
      reason: `--parked-on 'run:${input.pr}' — there is not one run on head ${short(
        facts.headSha,
      )} of PR #${input.pr}, and the park has exactly one lift: a message about the OUTCOME of a run. Waiting for an event with no source is the silence of thread 062. Check with 'gh pr checks ${
        input.pr
      }' — if a push has just landed, the first run appears seconds later and the park is legal then; if the answer stays "no checks reported", find out why the workflow did not start before parking`,
    };
  }
  return {
    ok: true,
    note: `the park on PR #${input.pr} waits for a run that exists (${facts.checkRuns} on head ${short(
      facts.headSha,
    )})`,
  };
};

const short = (sha: string): string => (sha.length > 9 ? sha.slice(0, 9) : sha);

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
