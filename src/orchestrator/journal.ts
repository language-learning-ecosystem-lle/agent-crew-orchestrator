/**
 * The P3 orchestrator journal — an append-only log of WHAT it did with role
 * sessions. Step S0 (thread 012): data before behaviour. There is not a single
 * spawn here — only the event model and its reading/writing; launching sessions
 * arrives with S1.
 *
 * Why the journal comes first (curator's decision, thread 012): the whole package
 * was built that way — observability first, the risky action after. Spawning
 * `claude -p` without a journal would be diagnosed blind, exactly like the circuit
 * before `derive`/`verify`.
 *
 * The journal is LOCAL, not in git (fork 3): lease state is transient and has no
 * place in the history of `comms`. The file is JSONL, ONE event per line: the
 * order of events is the order of lines written by a single writer (the daemon),
 * not the result of merging branches, so the seq comparator of migrated messages
 * is not needed here — appending from one process already gives order by
 * construction.
 *
 * EVERY OUTCOME LEAVES A TRACE (lesson of 014): releasing a lease for ANY reason —
 * success, force, timeout, attempts exhausted — is a `lease-released` event with a
 * `reason` field. Silently hanging in `draining` or silently ceasing to try is not
 * allowed: both must leave a record, otherwise a role drops out of the system
 * unnoticed (the two gaps named by curator; closed in the data, not in the
 * executor).
 */
import { z } from "zod";

/**
 * The attempt ceiling per (role, thread) pair. A previous run of a role on a
 * thread may have broken off systemically — a low turn limit, a broken
 * environment; then the launch condition ("the role is awaited, there is no
 * lease") becomes true again, and without a ceiling the next tick would launch it
 * forever, burning quota (gap 2, curator). Ceiling reached — the pair is
 * `exhausted`, we stop trying and look at the journal.
 */
export const MAX_ATTEMPTS = 3;

/**
 * The reason a lease was released. Always terminal — a lease lives until the first
 * release.
 *
 * `forced` and `exited-without-handoff` ARE SEPARATED (curator's statement of
 * work, thread 012, 20:55): before that, a process that exited on its own without
 * passing the turn was recorded as `forced` — that is, a session crash was
 * indistinguishable in the journal from a stop by john. The acceptance scenario
 * "`force` leaves a who/when/why trace" would pass identically on such an
 * instrument whether the circuit works or the role simply crashed. `forced` now
 * means exactly one thing: there was a force, and it has a `by`.
 *
 * `supervisor-gone` — THE SUPERVISOR died, not the session. Acceptance
 * 2026-07-25: the daemon returned control right after the spawn, the session was
 * orphaned and finished the work, while the lease stayed `running` forever — the
 * journal started lying ("working" about something long done). A silently hanging
 * lease is worse than any reason, so the supervisor must record the outcome even
 * with its own death. SIGKILL cannot be intercepted, and we do not promise that:
 * the guarantee covers exit, exception, SIGINT and SIGTERM.
 *
 * `stalled` — the session produced NO TRACES of activity for longer than the idle
 * ceiling (R6, thread 016): no output, no change in the working tree, no commit,
 * no CPU. It is split from `timeout` because the two say opposite things about the
 * run: on 2026-07-25 both breaks were recorded as `timeout` while both sessions
 * were alive and working — merely longer than the window. `timeout` now means "it
 * was working and did not fit", `stalled` means "it stopped doing anything"; the
 * first calls for a wider window, the second for an investigation. One name for
 * both made the journal an instrument that cannot tell them apart at all.
 *
 * `input-timeout` and `exited-while-waiting` — the two ways an INTERACTIVE TURN (R19)
 * ends without the session getting back to work: nobody answered within the wait
 * ceiling, or the session died while parked. Both are separate names because both are
 * separate facts, and the alternative was to record them as `completed`: the turn HAS
 * passed in either case (the question is in the thread, the mail waits on somebody
 * else), so the ordinary vocabulary would have called a package that stopped in the
 * middle a package that finished. Neither of them counts towards the attempt ceiling
 * — see `isFailedTerminal` in `lease.ts`.
 *
 * `quota-exhausted` — THE WINDOW RAN OUT, not the session (finding C, thread 023).
 * Before it, a run cut off by the rate limit came back as an ordinary death without a
 * handoff and was counted as a failed attempt: three of those marked the pair
 * `exhausted` and the role left the circuit for a cause that was never its own. With
 * parallel supervision (D-2) the misattribution arrives in a fan — N sessions share
 * one window and burn it N times faster — so the reason is separated here and
 * excluded from the ceiling in `lease.ts`. `until` carries the reopening time when
 * the signal named it.
 *
 * `forced` has NOT been removed from the list even though the `lease-released`
 * path no longer writes it (a real force writes a `stop {mode: forced, by, note}`
 * event): journals are append-only files on disk, and removing a value would make
 * old lines UNREADABLE, while our parsing is loud. The past is not rewritten by
 * editing an enum.
 */
export const RELEASE_REASONS = [
  "completed",
  "forced",
  "exited-without-handoff",
  "supervisor-gone",
  "timeout",
  "stalled",
  "input-timeout",
  "exited-while-waiting",
  "exhausted",
  "quota-exhausted",
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

/**
 * The reason a launch was REFUSED — a `launch-refused` event (S3). The
 * orchestrator wanted to raise a (role, thread) pair but did not, and the refusal
 * leaves a TRACE (otherwise a "launch → break → launch" loop would burn quota
 * silently — curator's requirement for S3).
 *
 * `run-budget` — the global ceiling of runs without completion.
 *
 * `quota` — THE WINDOW IS STILL CLOSED (D-3 part 2, thread 023). Part 1 stopped a
 * window-cut session from being counted as a failed attempt; it left the tick walking
 * into the same closed door every tick. The backoff is a fold of this journal
 * (`openQuotaShelves`), so the refusal is written ONCE per dark spell of the box and not
 * once per tick — the line says NOTHING WAS LAUNCHED, which is the box's property and not
 * any one window's; see `quotaRefusalRecorded` for why the journal and the daemon's stream
 * differ here, and why the unit is the box rather than the window.
 */
export const REFUSAL_REASONS = ["run-budget", "quota"] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

const base = {
  /** The event's UTC stamp: `2026-07-24T13:45:12Z`. Set by the writer at write time. */
  ts: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "ts must be UTC ISO without milliseconds"),
  role: z.string().min(1),
  thread: z.string().min(1),
};

/**
 * THE STATE OF THE WORLD A RUN STARTED FROM (R18, thread 016) — what john's second
 * condition for a resume is checked against: a session may only be continued while
 * the world it was reasoning about has not moved.
 *
 * WHAT "MOVED" MEANS WAS NARROWED BY john (2026-07-25, thread 016), and the narrowing
 * is the reason this record no longer holds the thread's tree id. A tree id says "the
 * conversation changed", and the most ordinary way for a conversation to change is the
 * very event the session was waiting for: AN ANSWER. New messages from OTHER
 * participants are INPUT, not a shift — a resumed session reads them exactly as a
 * fresh one would. Two things are a shift, and only two:
 *
 *  1. a message of the SAME ROLE from ANOTHER session — somebody worked in its place,
 *     so its intentions may already have been carried out or overruled. That is what
 *     `mine` marks: the role's own last message at launch, the point from which
 *     "who has spoken since" is measured (the sessions themselves are read off the
 *     message headers, R7);
 *  2. `base` — the commit the workspace's base branch resolved to. A merge into `main`
 *     while the session was down (including the merge of its own PR) means its work now
 *     sits on top of something that no longer exists.
 *
 * Recorded at LAUNCH, because that is the moment the session saw them; compared at the
 * next launch, which is the moment the decision is taken. Optional, so journals written
 * before R18 still parse — and `mine` is optional inside it for the same reason one
 * level down: a `world` written by the first version of R18 has no mark, and a run
 * whose mark nobody wrote is never resumed.
 */
export const worldSchema = z.object({
  /** The commit the base branch of the role's workspace pointed at. */
  base: z.string().min(1),
  /**
   * The file name of the role's OWN last message in the thread at launch. `""` — it
   * had not written in this thread yet (a legal value, and the reason this is not
   * `min(1)`); absent — the run predates the narrowed rule and cannot be measured.
   */
  mine: z.string().optional(),
});

export type World = z.infer<typeof worldSchema>;

/**
 * A journal event — a discriminated union on `kind`. Which fields are required is
 * set by the kind of event rather than checked by hand: a `lease-acquired` without
 * a `deadline` or a `lease-released` without a `reason` will not parse at all.
 */
export const orchestratorEventSchema = z.discriminatedUnion("kind", [
  // The orchestrator took a lease to launch a role on a thread; `deadline` is the
  // materialised wall-clock limit of the run (fork 2), by which S2/S3 judge
  // "is it stuck" without recomputing the deadline on the spot.
  z.object({
    kind: z.literal("lease-acquired"),
    ...base,
    deadline: base.ts,
  }),
  // The role's session has been launched as a process (populated from S1 on).
  // Since R18 the event also says HOW it was launched and WHAT IT SAW: `mode` is
  // fresh/resume, `resumes` names the session being continued, and `world` pins the
  // two object ids the decision for the NEXT run is taken against. All three are
  // optional — a journal written before R18 parses unchanged, and its runs are simply
  // never resumed, which is the only honest answer for a run whose world was never
  // recorded.
  z.object({
    kind: z.literal("launch"),
    ...base,
    mode: z.enum(["fresh", "resume"]).optional(),
    resumes: z.string().min(1).optional(),
    world: worldSchema.optional(),
  }),
  // The turn left the role — the completion signal (populated from S2 on). Lease → draining.
  z.object({ kind: z.literal("handoff-detected"), ...base }),
  // THE RUN IS PARKED (R19): the session declared a wait for input, the turn has
  // passed, and the process is deliberately left alive. `deadline` is the materialised
  // limit OF THE WAIT — a second clock, written down for the same reason the lease's
  // own deadline is: whoever asks "why was this closed" must not have to recompute it.
  // The pair of this event and `input-received` is also what the fold reads to shift
  // the WORK deadline by the time spent waiting, so waiting does not eat the window
  // the work was given (john's requirement (в)).
  z.object({ kind: z.literal("input-awaited"), ...base, deadline: base.ts }),
  // The wait is over and the session is working again — the marker of the declaration
  // is gone. It says nothing about WHAT ended it (an answer, or the session's own
  // timeout): from here both look the same and both mean the same thing, the run
  // continues and its completion signal is unchanged.
  z.object({ kind: z.literal("input-received"), ...base }),
  // The lease is released — ALWAYS with a reason (with a trace). `exitCode` and
  // `output` are the WHY, not just the WHAT: the first production run showed that
  // "the session could not write" and "the session simply exited" produce the same
  // line, and the investigation has to rely on the memory of whoever watched the
  // terminal. The exit code and the path to the saved session output make the
  // investigation possible without a witness. The fields are optional: a manual
  // `record` does not set them, and old journals still parse.
  // `session` and `steps` are the two facts R18 needs from a run that broke off, and
  // they are written here because this is the last event a broken run produces: the
  // id to hand to `--resume`, and how much of the run had been burned before the
  // break (assistant steps seen in the stream — see `stepsSeen` in the transcript).
  // Both optional: a run whose id never arrived, and every journal line older than
  // R18, still parse and are simply never resumed.
  z.object({
    kind: z.literal("lease-released"),
    ...base,
    reason: z.enum(RELEASE_REASONS),
    exitCode: z.number().int().optional(),
    output: z.string().min(1).optional(),
    session: z.string().min(1).optional(),
    steps: z.number().int().min(0).optional(),
    // WHEN THE WINDOW REOPENS, for a `quota-exhausted` release (finding C). Optional
    // and DELIBERATELY not defaulted: a quota signal that did not name a reset time is
    // a different fact from one that did ("closed, reopening unknown" vs "closed until
    // 14:00"), and inventing the second out of the first is how a backoff comes to
    // hammer a door it believes is open.
    until: base.ts.optional(),
    // WHICH window closed (D-3 part 2). The backoff has a shelf per window type because
    // the two we see are five hours and seven days apart, and one shelf for both is
    // wrong in both directions. A free string, not an enum: the vendor's own word rides
    // through to the shelf key, so a type we have never seen gets its own shelf instead
    // of being folded into one of ours. Optional — the prose layers never name a window,
    // and journals written by part 1 parse unchanged.
    window: z.string().min(1).optional(),
  }),
  // The session was stopped forcibly (S4). `by`/`note` are the "who" and the
  // "why", and together with `ts` (the "when") they make the force trace in the
  // journal self-sufficient. For `graceful` (the daemon lets the current session
  // finish on a stop flag) they are not required.
  z.object({
    kind: z.literal("stop"),
    ...base,
    mode: z.enum(["graceful", "forced"]),
    by: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  }),
  // The orchestrator REFUSED to launch a (role, thread) pair — with a trace (S3).
  z.object({
    kind: z.literal("launch-refused"),
    ...base,
    reason: z.enum(REFUSAL_REASONS),
  }),
]);

export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;
export type EventKind = OrchestratorEvent["kind"];

/** An event's UTC stamp from a point in time: `2026-07-24T13:45:12Z` (no milliseconds). */
export const eventTimestamp = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

/** Event → a JSONL line. Keys in a stable order — the journal diff stays readable. */
export const renderEventLine = (event: OrchestratorEvent): string => JSON.stringify(event);

/**
 * A JSONL line → an event. A malformed line is a LOUD refusal, not a skip: the
 * orchestrator's journal is the source of truth about its actions, and a silently
 * swallowed line would hide exactly the failure the journal exists to make visible.
 */
export const parseEventLine = (line: string): OrchestratorEvent => {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error(`journal line is not JSON: ${line}`);
  }
  return orchestratorEventSchema.parse(raw);
};

/** Journal text (JSONL) → events in line order. Blank lines are skipped. */
export const parseJournal = (text: string): OrchestratorEvent[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parseEventLine);

/** Events → JSONL text (with a trailing newline — an append writes the next line). */
export const renderJournal = (events: readonly OrchestratorEvent[]): string =>
  events.length === 0 ? "" : `${events.map(renderEventLine).join("\n")}\n`;
