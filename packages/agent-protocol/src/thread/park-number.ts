/**
 * A PARK THAT TOOK SOMEBODY ELSE'S NUMBER (thread `061-unreachable-event-park`, msg-002).
 *
 * `pr:N` and `run:N` both take THE NUMBER OF A PULL REQUEST — `run:` waits for the round on that
 * PR, not for a workflow run by its id. The two numbers are indistinguishable to the eye (`160`
 * and `33328290131` are both integers) and the door accepted either, so the wrong one froze a
 * pair behind an event that cannot happen: there is no PR #33328290131, so no message will ever
 * name it back.
 *
 * MEASURED THREE TIMES IN ONE DAY (2026-08-30): `dev-core` parked on `run:33328290131` at
 * 18:34:38Z and spent a separate letter correcting itself nine seconds later; `dev-speech` wrote
 * a correction to its own park twice in LLE-`110`; thread `054` records a park "набранная
 * номером ПРОГОНА вместо номера PR". Every one of them was caught by the author, and every one
 * of them was caught AFTER the record — which is why the repair is the door and not the care.
 *
 * WHAT IS CHECKED HERE IS ONLY WHAT NEEDS NO NETWORK: the ORDER OF MAGNITUDE. A pull request
 * number is a counter within one repository and reaches six digits only in the largest
 * repositories that exist; a workflow run id is a global identifier and is eleven digits today.
 * Nothing about a park has to be guessed to tell them apart. The existence of the pull request
 * is a separate question, asked of the vendor and only where it is safe to ask (`run:` parks —
 * see `run-park.ts`); a `pr:` park is deliberately left to this cheap check alone, because a
 * park on a pull request BEING CREATED IN THE SAME TICK is legal and an existence check would
 * refuse it (statement of work, point 4).
 */

/**
 * THE SMALLEST NUMBER THAT IS NOT A PULL REQUEST — one million, and the gap either side of it is
 * what makes the check safe.
 *
 * Below it: the busiest repositories on GitHub are in the low hundreds of thousands of pull
 * requests, so no honest `pr:`/`run:` value ever reaches this. Above it: a workflow run id is
 * ~11 digits (`33328290131`), four orders of magnitude clear of the line. There is no repository
 * for which this check is a judgement call.
 */
export const MAX_PR_NUMBER = 1_000_000;

/** The magnitude at which the wrong number is almost certainly a run id, and is named as one. */
const RUN_ID_DIGITS = 9;

/** The verdict on the number itself: it can be a PR number, or it plainly cannot. */
export type ParkNumberVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * IS THIS A NUMBER OF A PULL REQUEST AT ALL — the check both event parks pass before anything
 * else happens, and the only one that needs neither a network nor a token.
 *
 * TWO REFUSALS, BOTH BY NAME (discipline 4): the value is quoted back as the door read it, the
 * fact is stated ("this is taken as the NUMBER OF A PULL REQUEST"), and where the number looks
 * like a workflow run id the likely cause is named as a hypothesis — "похоже на id прогона" — and
 * not as a diagnosis, because the door cannot know what the author meant. What it can do is say
 * which of the two numbers the form wants, and where to read it.
 */
export const judgeParkNumber = (input: {
  /** `pr` or `run` — quoted into the refusal so it names the form the author actually typed. */
  readonly kind: "pr" | "run";
  readonly value: number;
}): ParkNumberVerdict => {
  const form = `${input.kind}:${input.value}`;
  if (!Number.isInteger(input.value) || input.value <= 0) {
    return {
      ok: false,
      reason: `--parked-on '${form}' — '${input.value}' is taken as the NUMBER OF A PULL REQUEST, and pull requests are numbered from 1. Nothing will ever name this number back, so the park would stand until a human lifted it by hand (thread 061)`,
    };
  }
  if (input.value >= MAX_PR_NUMBER) {
    const looksLikeRunId = String(input.value).length >= RUN_ID_DIGITS;
    return {
      ok: false,
      reason: `--parked-on '${form}' — '${input.value}' is taken as the NUMBER OF A PULL REQUEST, and there is no such pull request in any repository: PR numbers are a counter inside one repository and do not reach ${MAX_PR_NUMBER}.${
        looksLikeRunId
          ? ` It has ${String(input.value).length} digits, which is the shape of an ID OF A WORKFLOW RUN — and BOTH park forms want the NUMBER OF THE PR, 'run:' included ('run:<pr>' waits for the round ON that PR, not for a run by its id).`
          : ""
      } Read the number off the pull request itself ('gh pr view --json number' on the branch, or the last part of its URL). A park on a number nobody can name back freezes the pair until a human lifts it (thread 061: three such parks in one day, all corrected by their own author AFTER the record)`,
    };
  }
  return { ok: true };
};
