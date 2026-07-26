/**
 * THE INTERACTIVE TURN (R19, thread `016-protocol-roadmap`, john's statement of work
 * 22:00) — a session that runs into an unclear point in the MIDDLE of a long task
 * does not die with its question. It writes the question into the thread, passes the
 * turn, and WAITS ALIVE: context, environment and uncommitted work are all still
 * there; the answer arrives the ordinary way (the thread plus the R4 notification),
 * and THE SAME SESSION reads it and carries on.
 *
 * WHY THIS IS NOT THE CHEAP CASE. For a question at the END of a package the norm
 * stands and is cheaper: answer, pass the turn, let the run finish. Everything the
 * next session needs is in the thread, and a fresh context is worth more than a
 * preserved one. R19 pays for itself only where dying is expensive — half a
 * refactor on disk, a diagnosis nobody wrote down yet, a decision that changes the
 * next twenty steps. That threshold is a NORM, stated in the launch prompt, not a
 * mechanism: no ceiling can tell "the middle of a long task" from "nearly done".
 *
 * WHY A DECLARATION IS REQUIRED, AND WHY IT IS WRITTEN BEFORE THE QUESTION IS.
 * From the outside, a session waiting for input is indistinguishable from a session
 * that finished: the mail says the turn has passed, and the process is still up.
 * That is exactly the shape of a run the supervisor closes — the turn passing IS the
 * completion signal (`observe.ts`). So the wait has to be DECLARED, and it has to be
 * declared no later than the message that passes the turn: the supervisor reads the
 * mail off the disk of the checkout the session writes into, so the question becomes
 * visible to it the moment the file lands. A declaration made afterwards would race
 * a poll that has already concluded the run was over. Hence one gesture:
 * `new-message --await-input` writes the marker and the message together, and
 * `await-input` (the blocking wait) refuses to run without the marker — waiting
 * undeclared is impossible through the legal path rather than forbidden by a rule.
 *
 * WHY A RUNTIME FILE AND NOT A FIELD IN THE MESSAGE HEADER. Aliveness is a fact
 * about the RUN, not about the conversation, and the header is the conversation's
 * (the same line `worker`/`session` are drawn on in `message.ts` — with the opposite
 * result there, because provenance stays true forever). "A session is waiting" is
 * true for minutes; frozen into an append-only feed it would be a claim that is
 * false a minute later and unfixable for good. What the thread does carry is what
 * john required in words: the question states what is uncommitted and where the
 * session stopped, so the thread is self-sufficient even if the session dies
 * waiting.
 *
 * THE MARKER IS A LEVEL, NOT AN EDGE, and that is what makes the two ways out of a
 * wait come out right. The file exists while the session considers itself waiting;
 * `await-input` removes it on ANY exit — the answer arrived, or its own timeout ran
 * out. So the supervisor leaves the wait when the marker goes, without having to
 * guess which of the two happened: if the answer came, the session works on and the
 * turn is still with somebody else until it says otherwise; if the wait expired and
 * the session decided to wrap up, its final message is already in the thread and the
 * run closes as `completed`. Reading the MAIL for the way out would get the second
 * case wrong — the turn had passed before the wait began, so nothing in the mail
 * changes when the session gives up.
 */
import { z } from "zod";

/**
 * THE CEILING OF A WAIT — one hour, and it is the fourth ceiling of a run rather
 * than a share of the third (john's requirement (в): waiting must not burn the work
 * window; its own limit, its own refusal).
 *
 * WHY AN HOUR. The number is taken from the latency this circuit actually has: in
 * thread 016 the answers of curator and john land 20–40 minutes apart, and a ceiling
 * under that would expire on the ordinary case. The cost of the opposite error is
 * small and worth naming: a session parked with nobody answering burns no tokens (it
 * is blocked inside one tool call) — it holds a lease and a workspace lock, both
 * visible in `status`. Calibratable: a flag, a per-role limit, this default.
 */
export const DEFAULT_WAIT_INPUT_SECONDS = 3600;

/**
 * The declaration itself. JSON in a file, and it carries the thread on purpose: a
 * run is bound to ONE thread, and a marker naming another one is not a wait this run
 * may take — it is a session that went and wrote somewhere else. The supervisor says
 * so out loud and closes the run the ordinary way instead of parking it.
 *
 * `at` is the moment the session declared the wait, which is EARLIER than the moment
 * the supervisor sees it; it is printed rather than computed with (the shift of the
 * work deadline is derived from the journal's own events, so that the fold of the
 * journal and the live supervisor cannot disagree).
 */
export const waitMarkerSchema = z.object({
  thread: z.string().min(1),
  at: z.string().min(1),
  /** The session that declared it, when the run has managed to learn its own id (R7). */
  session: z.string().min(1).optional(),
});

export type WaitMarker = z.infer<typeof waitMarkerSchema>;

export const renderWaitMarker = (marker: WaitMarker): string => `${JSON.stringify(marker)}\n`;

/**
 * Reading a marker. A file that does not parse is NOT a wait: the supervisor's
 * default has to be the one that ends runs rather than the one that keeps them alive
 * — a broken marker that parked a session would hold a lease with nobody able to
 * explain why.
 */
export const parseWaitMarker = (raw: string): WaitMarker | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = waitMarkerSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/**
 * Whether a marker authorises THIS run to park: it parses, and it names the thread
 * the lease was taken for. The refusal is a sentence rather than a boolean because
 * it is printed — a wait that was not honoured must say why, or it looks like the
 * declaration was ignored.
 */
export const waitAuthorised = (input: {
  readonly raw?: string;
  readonly thread: string;
}):
  | { readonly ok: true; readonly marker: WaitMarker }
  | { readonly ok: false; readonly why: string } => {
  if (input.raw === undefined) return { ok: false, why: "no wait was declared" };
  const marker = parseWaitMarker(input.raw);
  if (marker === undefined) {
    return {
      ok: false,
      why: "the wait declaration could not be read (not the shape this package writes)",
    };
  }
  if (marker.thread !== input.thread) {
    return {
      ok: false,
      why: `the wait was declared for thread '${marker.thread}', while this run holds '${input.thread}'`,
    };
  }
  return { ok: true, marker };
};

/** The line the supervisor prints when it parks a run — the moment and the ceiling. */
export const describeWait = (input: {
  readonly marker: WaitMarker;
  readonly until: string;
}): string =>
  `awaiting input since ${input.marker.at}${input.marker.session === undefined ? "" : ` (session ${input.marker.session})`} — the wait expires at ${input.until}`;
