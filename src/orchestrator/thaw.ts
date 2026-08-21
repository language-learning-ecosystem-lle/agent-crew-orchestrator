/**
 * WHY AN EXHAUSTED PAIR MAY THAW BY ITSELF (thread `013-exhausted-visibility`).
 *
 * WHAT WAS MEASURED. On 2026-08-18 three pairs — dev-core×006, curator×001, curator×004 —
 * spent their whole attempt ceiling (3/3) on `API Error: 529 Overloaded`, the vendor's own
 * server-side overload, and stood frozen for about five hours. Every one of the nine runs
 * died before its first assistant step, having burned about $0.004. Nobody was told: the
 * pairs were found by a HUMAN asking "where is the PR", and the courier's line of that
 * evening said `4 parked, 0 of them asking; 0 waits; 2 stalled over 180m — nothing to
 * announce` with three exhausted pairs standing in the queue.
 *
 * THE CEILING ITSELF IS RIGHT AND IS NOT TOUCHED HERE. It exists to catch a pair that
 * breaks on its OWN cause ("launch → break → launch"), and three of those genuinely need a
 * human. What the ceiling could not tell apart is WHICH of two failures spent it:
 *
 *  - EXTERNAL — the session never reached the work. The vendor answered 5xx, the launch
 *    timed out, the process died on its first turn having produced nothing. This class
 *    dissolves in TIME and needs neither a human nor new content in the thread; freezing a
 *    pair forever over a five-minute overload is an overshoot in the expensive direction.
 *  - SUBSTANTIVE — the session worked and exited without passing the turn. Three of those
 *    is a statement of work that needs a human, and it must NOT thaw by itself. That
 *    asymmetry is the whole design: silence is the correct answer to a bad package.
 *
 * WHY THE CLASS IS OBSERVED AT THE RUN AND NOT GUESSED AT THE FOLD. The journal has no
 * error text in it, and the transcript that does is a file — reading it while folding would
 * put IO in the middle of a pure function that every tick, the status frame and the courier
 * all call. The supervisor is already reading every line of the stream (it latches the
 * quota and the credentials signals off the same lines), so it knows the fact at the moment
 * it is true and writes it on the release. Same road as `quota-exhausted` and `auth-failed`,
 * one class further down: those two are external causes we can NAME, this is the residue we
 * can only RECOGNISE.
 *
 * WHY NOT SIMPLY EXCLUDE 5xx FROM THE CEILING, the way the quota and the credentials are
 * excluded. Because we cannot see the difference from inside with the same confidence. A
 * closed window and a dead token are stated by the vendor about the BOX; a 5xx at turn 0 is
 * a strong hint that could also be one session in a genuinely bad loop. Excluding it would
 * uncap the retry of a class we are guessing at — the backoff below keeps the cap and only
 * makes it FINITE IN TIME, which is the smaller claim and the one the evidence supports.
 */

import { toolSurfacesOf } from "./quota.js";

/** The verdict for one line: the vendor's own sentence, trimmed — quoted as evidence. */
export type ApiFailureSignal = {
  readonly evidence: string;
};

/**
 * The shapes that mean "the vendor's side failed, not this session". Kept narrow on
 * purpose — every shape here buys a pair a second life, and a pattern that also matches a
 * session's own bad turn would hand that life to the class that must not have one:
 *
 *  - `API Error: 5xx` — the launcher's own line, the exact form of the episode (529);
 *  - `overloaded_error` / `api_error` / `Overloaded` — the API's own error types;
 *  - `503 Service Unavailable`, `502 Bad Gateway`, `504 Gateway Time-out` — the shapes a
 *    proxy in front of the vendor produces instead of the API's JSON;
 *  - `Connection error` / `ECONNRESET` / `ETIMEDOUT` / `socket hang up` — the network never
 *    reached the vendor at all, which is the same fact one layer lower.
 *
 * NOT HERE, deliberately: `429` and every rate-limit word (that is `quota.ts`, and it does
 * not count as an attempt at all), every 4xx that is not a timeout (a 400 is OUR malformed
 * request and repeating it changes nothing), and `authentication_error` (that is `auth.ts`).
 */
const API_FAILURE =
  /(api error: 5\d\d|"?status"?:\s*5\d\d|\b5\d\d\s+(internal server error|bad gateway|service unavailable|gateway time-?out)|overloaded_error|\boverloaded\b|api_error|connection error|econnreset|etimedout|enetunreach|socket hang up)/i;

/** How much of a matched line is quoted as evidence — enough to recognise, not a dump. */
const EVIDENCE = 200;

const evidenceOf = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EVIDENCE ? flat : `${flat.slice(0, EVIDENCE)}…`;
};

/**
 * ONE LINE OF THE SESSION STREAM (or of the launcher) → the external-failure verdict, or
 * `undefined` for every line that says nothing about the vendor's side.
 *
 * Pure and total: it never throws.
 */
export const apiFailureSignalOf = (line: string): ApiFailureSignal | undefined => {
  for (const surface of toolSurfacesOf(line)) {
    if (API_FAILURE.test(surface)) return { evidence: evidenceOf(surface) };
  }
  return undefined;
};

/**
 * HOW FAR A RUN MAY HAVE GOT AND STILL BE CALLED EXTERNAL. The signal alone is not enough:
 * a session that worked for forty minutes, hit one 5xx on some late turn and then exited
 * without passing the turn failed at ITS OWN work — the 5xx is an incident inside it, not
 * the cause of it. The measured class is the one that never started: all nine runs of the
 * episode died at zero assistant steps. One step of slack, not zero, because the tool emits
 * an assistant step for the system preamble of some models, and a class that flips on that
 * detail would be a class nobody can predict.
 */
export const EXTERNAL_STEP_CEILING = 1;

/**
 * THE CLASS OF A FAILED RUN, decided from the two facts the supervisor holds at release:
 * whether the stream ever said the vendor's side failed, and how much of the run had been
 * burned before it broke (`steps` — assistant steps seen in the stream, the same number
 * R18 reads).
 *
 * `steps` absent is NOT taken as zero: journals older than R18 carry no count, and reading
 * silence as "it never started" would let an old broken run buy itself a thaw it was never
 * measured for. Absence with a signal is external only when the signal is there AND the
 * count is there — the conservative direction, since the wrong answer here costs a frozen
 * pair (loud, a human notices) rather than an endless retry (quiet, it burns).
 */
export type FailureClass = "external" | "substantive";

export const failureClassOf = (input: {
  /** The stream said the vendor's side failed (`apiFailureSignalOf` latched during the run). */
  readonly apiFailure: boolean;
  /** Assistant steps seen in the stream before the break; absent — never measured. */
  readonly steps?: number;
}): FailureClass =>
  input.apiFailure && input.steps !== undefined && input.steps <= EXTERNAL_STEP_CEILING
    ? "external"
    : "substantive";

/**
 * THE BACKOFF OF AN EXTERNAL FREEZE, in minutes, one entry per round past the ceiling.
 *
 * 15 → 60 → 240 and then STOP. The first step is shorter than the episode's own outage was
 * (about five hours), which is the point: the cheap probe is the launch itself — a run that
 * dies of a 5xx costs 0 seconds and $0.004 — so an early knock costs less than the standing
 * still it ends. The last one being finite is the other half of the design: a vendor outage
 * that outlives four hours has stopped being weather, and a pair that keeps failing
 * externally for that long needs the phone rather than a fifth silent retry.
 */
export const THAW_BACKOFF_MINUTES = [15, 60, 240] as const;

/**
 * WHICH ROUND A PAIR IS IN and how long it waits for it. `round` is 1 for the first freeze
 * (the attempt that hit the ceiling), 2 for the freeze after the first thaw, and so on —
 * derived from the attempt counter rather than stored, because the counter is already the
 * one number the ceiling and the delivery reset agree on (`foldLeases`).
 *
 * `undefined` — THIS ONE DOES NOT THAW: the schedule is spent, and the pair is frozen for
 * good until a delivery lands in the thread. That is not a failure of the mechanism, it is
 * its ending, and the courier announces it in those words.
 */
export const thawDelayMinutes = (round: number): number | undefined =>
  round >= 1 && round <= THAW_BACKOFF_MINUTES.length ? THAW_BACKOFF_MINUTES[round - 1] : undefined;

/** ISO stamp + minutes → ISO stamp, in the journal's own second-precision shape. */
export const thawStamp = (from: string, minutes: number): string =>
  `${new Date(new Date(from).getTime() + minutes * 60_000).toISOString().slice(0, 19)}Z`;

/**
 * WHEN AN EXHAUSTED PAIR MAY BE RAISED AGAIN — the whole policy in one function, so the
 * fold, the status frame and the courier cannot come to hold three versions of it.
 *
 * `null` has two readings and they are told apart by the class, which is why the class
 * rides beside it everywhere it is shown: a SUBSTANTIVE freeze has no thaw by design (only
 * a delivery lifts it), an EXTERNAL one with `null` has spent its schedule.
 */
export const thawAt = (input: {
  readonly failureClass: FailureClass;
  /** The attempt the pair broke on, and the ceiling it hit. */
  readonly attempt: number;
  readonly ceiling: number;
  /** The stamp of the release that froze it — the clock starts at the break. */
  readonly since: string;
}): string | null => {
  if (input.failureClass !== "external") return null;
  const minutes = thawDelayMinutes(input.attempt - input.ceiling + 1);
  return minutes === undefined ? null : thawStamp(input.since, minutes);
};

/**
 * The human line for the supervisor's log and its stream. It says the two things a reader
 * needs: that the run died on the VENDOR's side before reaching the work, and that this
 * does not freeze the pair for good.
 */
export const describeApiFailure = (signal: ApiFailureSignal): string =>
  `the vendor's side failed before the session reached the work: ${signal.evidence}. This still counts as a failed attempt, but an exhaustion spent on it THAWS BY ITSELF (${THAW_BACKOFF_MINUTES.join("m → ")}m) instead of standing until a human notices.`;

/**
 * How an exhausted pair reads in a courier line, a status frame or a digest — one sentence,
 * the same words everywhere. `thaw` is the stamp from `thawAt`.
 *
 * THE TWO TERMINAL BRANCHES NAME A HAND, NOT A DELIVERY (curator's §1, thread 013). They
 * used to say "only a delivery lifts it", and that advice is unreachable from inside the
 * circuit: the counter is zeroed by a DELIVERY EVENT OF THIS PAIR (`isDelivery` /
 * `isSelfTurnDelivery` in `lease.ts`), every shape of which is written by a RUN of the pair
 * — and `planLaunch` refuses an exhausted pair before any run starts (`reason: "exhausted"`),
 * as does `orchestrator run` through the same gate. So no message into the thread lifts it:
 * a letter from another role, or from another session of the same role, creates no event of
 * this pair at all. What is left is the operator (`--max-attempts` above the ceiling, which
 * lets one run through and its handoff zeroes the count) and the retroactive shape of thread
 * 023 — the dead session's OWN message appearing in the mail, which no live actor can write.
 * A line that advises the unreachable costs the reader the time this thread exists to save.
 *
 * `closed` IS THE THIRD BRANCH AND IT ADVISES NOBODY (thread 016). A freeze on a closed
 * thread is history: the circuit was never going to raise the pair again, and neither is
 * the hand the two branches above call for — there is nothing left to raise it FOR. The
 * class is still named, because the reader of a frame is reading history and the class is
 * what that history says; what is dropped is the call to action, which is the whole
 * difference between a mark and a fact.
 */
export const describeFreeze = (input: {
  readonly failureClass: FailureClass;
  readonly thaw: string | null;
  /** The pair's thread is closed — see the block above; the surfaces that CALL drop it. */
  readonly closed?: boolean;
}): string =>
  input.closed === true
    ? `${input.failureClass}, and the THREAD IS CLOSED — nothing raises this pair any more and nothing needs to: history, not a call`
    : input.failureClass === "external"
      ? input.thaw === null
        ? "external, the backoff is spent — the circuit will not raise it again, a hand does (--max-attempts above the ceiling)"
        : `external, thaws at ${input.thaw}`
      : "substantive — the circuit will not raise it, a hand does (--max-attempts above the ceiling)";

/**
 * DOES THIS FREEZE END AT A MOMENT THAT CAN BE NAMED — the predicate behind the word
 * "then" (thread 016, defect 2). Only an external freeze with a live backoff has one; a
 * substantive freeze and a spent backoff both wait for a hand, which is not a moment. It
 * lives here, beside the sentence it belongs to, so that a surface printing "until then"
 * and the sentence naming the term can never disagree about whether there IS one.
 */
export const freezeHasTerm = (input: {
  readonly failureClass: FailureClass;
  readonly thaw: string | null;
}): boolean => input.failureClass === "external" && input.thaw !== null;
