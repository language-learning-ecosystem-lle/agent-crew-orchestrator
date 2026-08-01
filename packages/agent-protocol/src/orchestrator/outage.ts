/**
 * THE MERGE-READY TIER'S REFUSAL, WHEN IT STOPS BEING AN ACCIDENT (thread
 * `051-ringing-predicates`, curator's statement of work of 2026-08-01, point 1.2).
 *
 * WHAT WAS MEASURED. On 2026-07-31 `gh` answered `Could not resolve to a Repository with
 * the name '<owner>/<repo>'` six times in a row for the same reason (the active account of
 * the box could not see the repository, #108/#109/#112), and on 2026-08-01 the tier that
 * reads merge-readiness refused every tick for hours. Every one of those refusals landed in
 * `daemon.log` and nowhere else: the circuit kept working exactly as a circuit without the
 * tier — which is the design — and told nobody that a feature the operator believes in has
 * been dead since morning.
 *
 * FAIL-OPEN IS UNTOUCHED, and that is the first requirement of the statement of work rather
 * than a note: nothing here slows a tick, reorders a queue or fails a run. This module is a
 * COUNTER and a PREDICATE — one refusal in, a run of them out, and a boolean saying whether
 * the run is long enough to be worth a human's phone. Everything it can do wrong is to say
 * nothing.
 *
 * A RUN, NOT A COUNT. What rings is not "gh has failed N times today" but "gh has been
 * failing with THE SAME WORDS ever since HH:MM": an outage is a state, and its identity is
 * the text of the refusal. A different message means a different fault, so the run restarts
 * and the alarm is due again — while the same one repeats, the phone stays quiet (the
 * statement of work: "пока отказ тот же и не прекратился — второй раз не звонит").
 *
 * THE EVIDENCE IS THE VENDOR'S OWN SENTENCE, quoted, never a guess at what it means. The
 * lesson is #108/#109/#112 and the six identical refusals of 31.07: the path and the text
 * of the refusal are FACTS, "the token is probably missing the `repo` scope" is a
 * HYPOTHESIS, and the message to a human at 3am carries the fact.
 *
 * WHY A TICK IS THE UNIT AND NOT A MINUTE. The thing being counted is "the tier asked and
 * was refused" — an event of the loop, not of the clock. A daemon that is down is not
 * having an outage, and a minute-based threshold would ring for one. The tick interval is
 * the operator's, so the threshold is stated in ticks and PRINTED next to the count
 * wherever the count is printed, which is what makes the number legible without this file.
 *
 * WHY THE STATE IS A FILE AND NOT THE JOURNAL. The journal is append-only and is read whole
 * every tick; a line per tick per outage would grow it by a thousand lines a day for the
 * one fact that nothing changed. This is a single overwritten object instead — the current
 * run and nothing else — and the operator frame reads the same file the daemon writes, so
 * the picture a human sees and the state the courier rings from are one object.
 */

/** The run of identical refusals in force now — an outage as a state, not as a tally. */
export type GhOutage = {
  /** The vendor's own sentence, verbatim and trimmed — the fact the alarm quotes. */
  readonly evidence: string;
  /** When this run began: the first tick refused with THIS text. UTC ISO to the second. */
  readonly since: string;
  /** How many consecutive ticks have been refused with it, this one included. */
  readonly ticks: number;
  /** The most recent refused tick — what tells a live outage from a stale file. */
  readonly last: string;
};

/**
 * HOW MANY CONSECUTIVE REFUSALS MEAN "THE TIER IS DEAD", rather than a flaky call. Five:
 * with the daemon's default tick that is five minutes of the feature being silently off,
 * which is long past any retry, network blip or rate-limit pause — and short enough that
 * an operator hears about it in the same working hour it broke.
 */
export const GH_OUTAGE_TICKS = 5;

/** How much of a refusal is kept as evidence — enough to recognise it, not a log dump. */
const EVIDENCE = 300;

const evidenceOf = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EVIDENCE ? flat : `${flat.slice(0, EVIDENCE)}…`;
};

/**
 * ONE TICK'S ANSWER → THE RUN. THREE ANSWERS, NOT TWO, and the third is the whole of this
 * signature (reviewer's finding 2 on #161):
 *
 *  · REFUSED — the run extends when the text is the run's own; any other text starts a new
 *    run, because a different message is a different fault;
 *  · ANSWERED (`asked`, no refusal) — the tier works, the run ends, the file is cleared;
 *  · NOT ASKED (`asked: false`) — a tick with no candidates never opened a socket. That is
 *    NO EVIDENCE, not good news, so the run is HELD exactly as it was: neither extended
 *    (nothing was refused) nor cleared (nothing was fixed). Counting it as an answer was
 *    the defect: an unevenly loaded queue has quiet ticks, and an outage lasting hours
 *    across them would have restarted its run at every lull and never reached the
 *    threshold — the very case the statement of work names ("повторяется каждый тик
 *    часами"). The unit stays the tick with a question in it, so the printed count still
 *    means "this many times we asked and were refused".
 *
 * Pure and total — it never throws and never reads anything.
 */
export const foldGhOutage = (input: {
  readonly previous: GhOutage | undefined;
  readonly refusal: string | undefined;
  /** Was the vendor asked this tick at all. A tick without candidates asks nobody. */
  readonly asked: boolean;
  readonly now: Date;
}): GhOutage | undefined => {
  if (!input.asked) return input.previous;
  if (input.refusal === undefined) return undefined;
  const evidence = evidenceOf(input.refusal);
  if (evidence === "") return undefined;
  const stamp = `${input.now.toISOString().slice(0, 19)}Z`;
  const previous = input.previous;
  if (previous !== undefined && previous.evidence === evidence)
    return { evidence, since: previous.since, ticks: previous.ticks + 1, last: stamp };
  return { evidence, since: stamp, ticks: 1, last: stamp };
};

/**
 * THE PREDICATE THAT RINGS. A single refusal is not an event — `gh` times out, a runner
 * hiccups, a network drops one call — and an alarm that fires on those is one nobody reads.
 * A run past the threshold is the other thing entirely: the tier has been off for minutes
 * and will stay off until somebody looks.
 */
export const ghAlarmDue = (outage: GhOutage): boolean => outage.ticks >= GH_OUTAGE_TICKS;

/**
 * The outage in a line, WITH THE THRESHOLD BESIDE THE COUNT (the statement of work: the
 * threshold is printed in the operator frame next to the refusal itself). Without it "3
 * ticks" is a number the reader has to go and look up the meaning of.
 */
export const describeGhOutage = (outage: GhOutage): string =>
  `merge-ready: gh has refused ${outage.ticks} tick(s) in a row (rings at ${GH_OUTAGE_TICKS}) since ${outage.since} — ${outage.evidence}. Nothing is accelerated and nothing is slowed: the queue is exactly the queue without merge-ready${
    ghAlarmDue(outage) ? "; the tier has been off since then and stays off until this is fixed" : ""
  }`;

/** The state as a file: one JSON object, overwritten — see the head block for why not the journal. */
export const renderGhOutage = (outage: GhOutage | undefined): string =>
  outage === undefined ? "" : `${JSON.stringify(outage)}\n`;

/**
 * The file back into the state. A file that is missing, empty or unparseable reads as NO
 * OUTAGE — the same one-directional degradation the tier itself has: the worst this can do
 * is stay quiet, and a courier that threw on a corrupt state file would take the daemon's
 * whole tick with it.
 */
export const parseGhOutage = (raw: string): GhOutage | undefined => {
  const text = raw.trim();
  if (text === "") return undefined;
  try {
    const value = JSON.parse(text) as Partial<GhOutage>;
    if (
      typeof value.evidence !== "string" ||
      typeof value.since !== "string" ||
      typeof value.last !== "string" ||
      typeof value.ticks !== "number"
    )
      return undefined;
    return { evidence: value.evidence, since: value.since, ticks: value.ticks, last: value.last };
  } catch {
    return undefined;
  }
};
