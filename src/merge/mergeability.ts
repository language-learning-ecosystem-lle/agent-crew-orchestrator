/**
 * WHETHER A PULL REQUEST STILL APPLIES TO ITS BASE — read so that ONE ANSWER IS NEVER A
 * VERDICT (thread `097-conflict-has-no-signal`, msg-002).
 *
 * WHERE IT COMES FROM. `mergeable` is computed by GitHub LAZILY and served from a cache
 * that is allowed to be stale: the first ask about a pull request starts the job and
 * answers whatever the cache holds, the next one answers for real. The merge gate already
 * knew half of this — it asked again on `UNKNOWN` — and the half it did not know is the
 * expensive one: A STALE ANSWER CAN ALSO BE `MERGEABLE`. Measured 2026-09-03 on the pull
 * request that opened this thread: a role read `MERGEABLE` at `17:02:30Z` and hung the
 * `review` label on it; the same head, with its base standing still at `0a833551`, read
 * `dirty` at `17:21Z`. Burnt: one round of review and eighteen minutes of tests, all on a
 * head that has to be rebased, after which guard 1 voids the verdict anyway.
 *
 * WHY NOT "LET THE ROLES REMEMBER". The lesson was already written down in a role's memory
 * (`mergeable-unknown-is-not-a-verdict`, «спрашивать трижды») and it still did not fire.
 * A note does not stop a mistake made at the moment the answer LOOKS certain — and it
 * always looks certain, because the field is called `mergeable` and carries `true`. So the
 * rule moves out of memory and into a function every caller shares.
 *
 * THE RULE, and it is the whole module: a verdict is what TWO CONSECUTIVE ASKS AGREE ON.
 * One sample is never a verdict, however definite it reads. Samples that disagree are not
 * a verdict either — they are the cache changing its mind under us, which is exactly the
 * state the field cannot be trusted in. `UNKNOWN` is not a verdict at any count: GitHub
 * saying "not computed" twice is still "not computed".
 *
 * WHAT THIS IS NOT. It is not a guarantee that the branch is still mergeable a second
 * later — nothing read over a network is. It is the cheapest reading that cannot be
 * fooled by the ONE failure mode observed: a single stale cache hit. The verdict names how
 * many times it asked and what it heard each time, so a caller that later turns out to
 * have been wrong can be told apart from a caller that guessed.
 */

/** The three answers GitHub gives, and the only ones this module treats as words. */
export const MERGEABLE = "MERGEABLE";
export const CONFLICTING = "CONFLICTING";
export const UNKNOWN = "UNKNOWN";

export type MergeabilityReading =
  | {
      /** Two consecutive asks agreed on a word that is not `UNKNOWN`. */
      readonly state: "settled";
      /** The agreed word, upper-cased — `MERGEABLE`, `CONFLICTING`, or a word gh grew. */
      readonly mergeable: string;
      readonly samples: readonly string[];
      readonly detail: string;
    }
  | {
      /** Too few asks, asks that disagree, or `UNKNOWN` — no verdict, and why. */
      readonly state: "unsettled";
      readonly samples: readonly string[];
      readonly detail: string;
    };

/** `null`/`undefined`/blank all mean "gh said nothing here" and are kept as one word. */
const wordOf = (sample: string | null | undefined): string =>
  (sample ?? "").trim().toUpperCase() || "(absent)";

const heard = (samples: readonly string[]): string =>
  samples.length === 0 ? "nothing" : samples.map((s, at) => `#${at + 1} ${s}`).join(", ");

/**
 * THE JUDGE — pure, and the one place the rule lives.
 *
 * Only the LAST TWO samples decide. An earlier `UNKNOWN` followed by two agreeing answers
 * is a settled reading and not a contradiction: that first answer is the lazy computation
 * starting, which is the normal opening of every conversation with this field.
 */
export const judgeMergeability = (
  raw: readonly (string | null | undefined)[],
): MergeabilityReading => {
  const samples = raw.map(wordOf);
  if (samples.length < 2)
    return {
      state: "unsettled",
      samples,
      detail: `asked ${samples.length} time(s) (heard ${heard(samples)}) — one answer about mergeability is not a verdict, GitHub computes it lazily and serves it stale; ask again`,
    };
  const last = samples[samples.length - 1] as string;
  const before = samples[samples.length - 2] as string;
  if (last !== before)
    return {
      state: "unsettled",
      samples,
      detail: `asked ${samples.length} times and heard ${heard(samples)} — consecutive answers disagree, so GitHub has not settled this pull request; ask again`,
    };
  if (last === UNKNOWN)
    return {
      state: "unsettled",
      samples,
      detail: `asked ${samples.length} times and heard ${heard(samples)} — GitHub has not finished computing the merge; ask again`,
    };
  return {
    state: "settled",
    mergeable: last,
    samples,
    detail: `mergeable=${last}, agreed by two consecutive asks (heard ${heard(samples)})`,
  };
};

/** Whether a settled reading says the branch applies to its base. */
export const isMergeable = (reading: MergeabilityReading): boolean =>
  reading.state === "settled" && reading.mergeable === MERGEABLE;

/**
 * THE READER — asks until two consecutive answers agree, and never fewer than twice.
 *
 * `ask` and `pause` are injected so the rule is testable without a network and without a
 * clock: every caller in this package passes `gh` and a blocking sleep, the tests pass a
 * scripted list. `asks` is a CEILING, not a count — a pull request that agrees with itself
 * on the second ask costs exactly two calls, which is what the common case pays.
 *
 * A THROW FROM `ask` IS NOT CAUGHT. Callers of this module already have their own
 * degradation (the gate refuses by name, the park door lets the park stand) and a failure
 * swallowed here would arrive at them as "unsettled", which is a different fact.
 */
export const readMergeability = (input: {
  readonly ask: () => string | null | undefined;
  readonly pause: (ms: number) => void;
  /** Ceiling on asks; never fewer than 2, defaults to 3 — the count the field's own lore names. */
  readonly asks?: number;
  readonly pauseMs?: number;
}): MergeabilityReading => {
  const ceiling = Math.max(2, input.asks ?? 3);
  const pauseMs = input.pauseMs ?? 2000;
  const samples: (string | null | undefined)[] = [];
  let reading = judgeMergeability(samples);
  while (samples.length < ceiling) {
    if (samples.length > 0) input.pause(pauseMs);
    samples.push(input.ask());
    reading = judgeMergeability(samples);
    if (reading.state === "settled") return reading;
  }
  return reading;
};
