/**
 * THE QUOTA REFUSAL — finding C of thread 023, part 1 (`D-3`).
 *
 * The gap it closes. Until now the package had no notion of a rate limit anywhere:
 * not in `RELEASE_REASONS`, not in `REFUSAL_REASONS`, not in the observer. A session
 * cut off because the five-hour window ran out arrived as an ORDINARY death — the
 * process exited without passing the turn — and was recorded as
 * `exited-without-handoff`, i.e. as a failed attempt. Three of those mark the pair
 * `exhausted` and the role drops out of the circuit for a reason that has nothing to
 * do with it: nobody was at fault, the window simply closed. With D-2 landed the risk
 * stopped being theoretical — N parallel sessions burn one shared window N times
 * faster, so the misattribution arrives in a fan rather than one pair at a time.
 *
 * WHAT THIS MODULE IS AND IS NOT. It is the RECOGNITION and the arithmetic, kept pure
 * so that both have tests that do not spawn anything: one stream line in, a verdict
 * out. The decision built on the verdict lives in `observe.ts` (which reason to
 * record) and in `lease.ts` (that this reason is not an attempt). Nothing here reads
 * a file or knows what a daemon is.
 *
 * THE SIGNAL IS SOMEBODY ELSE'S FORMAT, so the net is deliberately in three layers,
 * and the layers are NOT equal — the first is the source, the other two cover the
 * shapes the first cannot reach:
 *
 *  1. THE STRUCTURED ONE — the stream's own `rate_limit_event`, whose `rate_limit_info`
 *     carries `{status, resetsAt, rateLimitType, …}`. This is the FIRST-HAND source
 *     (thread 029, measured on 74 captured streams of this box: the event is present
 *     in all of them), it arrives on EVERY turn rather than only at the moment of
 *     refusal, and its `resetsAt` is the window boundary as the vendor states it
 *     instead of a number scraped out of prose. Recognition is built the way thread
 *     029 required: A PERMITTING STATUS IS THE WHITELIST, anything else is a loud
 *     named refusal.
 *  2. THE EXACT PROSE — `Claude AI usage limit reached|<epoch seconds>`, the shape the
 *     tool prints when it stops mid-run. Kept because a session cut off hard does not
 *     necessarily get another `rate_limit_event` out of the door first.
 *  3. THE LOOSE PROSE — a line that says a usage/rate limit was hit without an epoch
 *     (`rate_limit_error`, "usage limit reached", "rate limit exceeded"). It yields a
 *     verdict with NO reset time, and that difference is carried in the type rather
 *     than papered over with a default: "the window closed, reopening unknown" is a
 *     different operational fact from "the window closed until 14:00", and the second
 *     must never be invented out of the first.
 *
 * WHY `allowed` IS A PREFIX AND NOT AN EQUALITY — the correction the real data forced,
 * and the reason the whitelist is not written as `status !== "allowed"`. Counted over
 * every session log on this box: `allowed` 133, `allowed_warning` 13 (`rateLimitType`:
 * `five_hour` 140, `seven_day` 6). The vendor names a state that still PERMITS work
 * with the `allowed` prefix — `allowed_warning` means "76% of the seven-day window is
 * gone", i.e. keep going. A rule refusing on everything but the exact string `allowed`
 * would have declared the window closed on thirteen observations where it was open,
 * and would have done it on a warning that arrives long BEFORE the limit: the worst
 * false positive available here.
 *
 * WHAT WE HAVE STILL NEVER SEEN, said out loud: in none of those observations was the
 * status anything but permitting. The closed shape is therefore recognised by the
 * ABSENCE of the prefix rather than by a guessed enum value — we do not invent the
 * vendor's word for "closed", we refuse to read a status we do not know as permission.
 *
 * WHY THE PROSE LAYERS ARE A SUBSTRING SEARCH AND NOT A PARSE. Those two reach the
 * supervisor in shapes JSON parsing cannot cover: an assistant text block, a `result`
 * event's `result` field, and (when the launcher gives up before a session exists at
 * all) a line that is not stream JSON in the first place.
 *
 * WHERE THE SUBSTRING IS ALLOWED TO LOOK — the correction of 2026-07-30, and the
 * load-bearing half of this module. A substring search over the WHOLE line reads the
 * session's own payload as if it were the vendor speaking: a `tool_result` carrying
 * the text of a file is a stream event like any other, and a file of THIS package
 * quotes the refusal marker verbatim as a fixture. Three live sessions of 30.07 were
 * cut off by their own test data that way, each with the epoch OF THE FIXTURE as the
 * reopening time — and, because a quota release is not a delivery, the false releases
 * then ate the global run budget down to a deadlock. So the prose layers no longer see
 * a line, they see a SURFACE:
 *
 *  - a line that is NOT stream JSON — the launcher's own output, whole;
 *  - a stream event of type `result` — its `result` field;
 *  - a stream event of type `assistant` — its text blocks.
 *
 * Everything else a stream event carries is the SESSION's voice, not the tool's, and
 * the difference between "the run hit the limit" and "the run was reading about the
 * limit" is exactly the difference between those two. The price paid for it is one
 * `JSON.parse` per line where a substring hint used to gate it: knowing whether a line
 * is stream JSON at all is the question being asked, and there is no cheaper way to
 * ask it. The remaining false positive — a session DISCUSSING a limit in its own
 * assistant text — is left in on purpose: that surface is also the one the tool prints
 * its own refusal on, and a missed signal costs a role dropping out of the circuit.
 */

/**
 * The quota verdict for one line. `resetsAt` is present only when the signal
 * carried it — see layer 2 above.
 */
export type QuotaSignal = {
  /** When the window reopens, UTC ISO to the second; absent when the signal did not say. */
  readonly resetsAt?: string;
  /**
   * WHICH window closed, in the vendor's own word (`rateLimitType`: `five_hour`,
   * `seven_day` — the two seen on this box). Absent when the signal did not name one,
   * which is every prose form: only the structured event carries the type.
   *
   * It is carried as an OPAQUE STRING and never as an enum of ours (thread 029's rule,
   * restated by curator for part 2): a word we have not seen must be able to arrive and
   * be shelved under its own name rather than folded into one of the two we know.
   */
  readonly window?: string;
  /** The matched text, trimmed — what the log and the journal quote as evidence. */
  readonly evidence: string;
};

/**
 * ONE LINE → the stream event it is, or `undefined` when the line is not stream JSON
 * at all (the launcher's refusal, a truncated line, a stray print).
 *
 * The `{` test is the cheap gate that the substring hint used to be, and it asks the
 * right question: every line of the stream is a JSON object, and only the answer
 * "this is not one" sends the line to the prose layers whole.
 */
const streamEventOf = (line: string): Record<string, unknown> | undefined => {
  if (!line.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
};

/**
 * A status that still lets work happen. The vendor prefixes those with `allowed`
 * (`allowed`, `allowed_warning` — both observed on this box); see the doc block for why
 * this is a prefix test and not an equality.
 */
const permits = (status: string): boolean => status.toLowerCase().startsWith("allowed");

/** The shape we read out of the event — everything else in it is not our business. */
type RateLimitInfo = {
  readonly status?: unknown;
  readonly resetsAt?: unknown;
  readonly rateLimitType?: unknown;
};

/**
 * A stream event that is not a `rate_limit_event` at all. A THIRD NAMED VERDICT rather
 * than "no verdict": the two are different facts, and conflating them is what the
 * incident of 30.07 was made of. "I could not read this as the quota event" used to
 * mean "hand the whole line to the prose layers" — and every ordinary event of the
 * stream, a `tool_result` with a file in it above all, went through that door. Named,
 * it says the one true thing: this line is the stream speaking, the quota is not what
 * it is speaking about, and its prose is looked for only where the TOOL writes prose
 * (`proseSurfacesOf`), never in the payload the session itself produced.
 */
const NOT_QUOTA_EVENT = "not-quota-event";

/**
 * The structured verdict for one stream event, in three answers:
 *
 *  - a `QuotaSignal` — this event says the window is CLOSED;
 *  - `"open"` — this event was read and says work is permitted, which is CONCLUSIVE:
 *    the caller must not then hand the same event to the prose layers, where the
 *    event's own vocabulary would match it;
 *  - `NOT_QUOTA_EVENT` — this is some other event of the stream (see above).
 *
 * A parsed event WITHOUT a readable status is a refusal on purpose: the whitelist is
 * "we could read permission", and a status we cannot read is not permission.
 */
const structuredSignalOf = (
  event: Record<string, unknown>,
): QuotaSignal | "open" | typeof NOT_QUOTA_EVENT => {
  const info = event["rate_limit_info"] as RateLimitInfo | undefined;
  if (info === undefined || info === null || typeof info !== "object") return NOT_QUOTA_EVENT;

  const status = typeof info.status === "string" ? info.status : undefined;
  if (status !== undefined && permits(status)) return "open";

  const resetsAt =
    typeof info.resetsAt === "number" || typeof info.resetsAt === "string"
      ? stampOfEpoch(String(info.resetsAt))
      : undefined;
  const window = typeof info.rateLimitType === "string" ? info.rateLimitType : UNKNOWN_WINDOW;
  return {
    ...(resetsAt === undefined ? {} : { resetsAt }),
    window,
    // The evidence is RENDERED, not quoted: the raw event carries a uuid and a session
    // id that say nothing about the window, and the three fields that do say something
    // are worth more in a log line than 200 characters of JSON.
    evidence: `rate_limit_event: status=${status ?? "(none)"}, window=${window}`,
  };
};

/** The exact form: the tool's own marker, with the epoch of the reset after a pipe. */
const EXACT = /Claude AI usage limit reached\|(\d{9,13})/i;

/**
 * The loose form: a limit was hit, the reset is unknown. `rate_limit_error` is the
 * API's own error type; the two prose forms are what the launcher prints when it
 * refuses before a session even starts.
 */
const LOOSE = /(rate_limit_error|usage limit reached|rate limit exceeded)/i;

/** Epoch (seconds or milliseconds — the tool has emitted both) → the journal's stamp shape. */
const stampOfEpoch = (raw: string): string | undefined => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // Ten digits is seconds, thirteen is milliseconds. The boundary is set at a year no
  // stamp of ours predates rather than at a digit count, so a future widening of the
  // epoch does not silently flip the unit.
  const ms = value < 1e11 ? value * 1000 : value;
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return undefined;
  return `${at.toISOString().slice(0, 19)}Z`;
};

/** How much of a matched line is quoted as evidence — enough to recognise, not a dump. */
const EVIDENCE = 200;

const evidenceOf = (line: string): string => {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length <= EVIDENCE ? flat : `${flat.slice(0, EVIDENCE)}…`;
};

/**
 * WHERE THE TOOL WRITES PROSE inside a stream event — and nowhere else.
 *
 * Two surfaces, both named by the event's own `type`: the `result` field of the final
 * `result` event, and the text blocks of an `assistant` message. A `user` event's
 * blocks (`tool_result` — the output of a read, an edit, a grep) are the SESSION's
 * material, not the tool's voice, and are deliberately not here: that is the door the
 * three deaths of 30.07 came through.
 */
const proseSurfacesOf = (event: Record<string, unknown>): readonly string[] => {
  const type = event["type"];
  if (type === "result") {
    const result = event["result"];
    return typeof result === "string" ? [result] : [];
  }
  if (type !== "assistant") return [];
  const message = event["message"];
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { readonly content?: unknown }).content;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const { type: blockType, text } = block as { readonly type?: unknown; readonly text?: unknown };
    if (blockType === "text" && typeof text === "string") texts.push(text);
  }
  return texts;
};

/**
 * THE SURFACES OF ONE LINE WHERE THE TOOL — not the session — WRITES PROSE. The rule of
 * the correction of 2026-07-30, exported so that a SECOND infrastructure signal reuses it
 * instead of copying a regex over whole lines (`auth.ts`, thread 023): the lesson that
 * cost three sessions of 30.07 lives in one place or it is unlearnt by the next module.
 *
 * A line that is not stream JSON is the launcher's own output and is a surface WHOLE; a
 * stream event yields the surfaces `proseSurfacesOf` allows and no others.
 */
export const toolSurfacesOf = (line: string): readonly string[] => {
  const trimmed = line.trim();
  if (trimmed === "") return [];
  const event = streamEventOf(trimmed);
  return event === undefined ? [trimmed] : proseSurfacesOf(event);
};

/** Layers 2 and 3 over ONE SURFACE of text — see `proseSurfacesOf` for what may be one. */
const proseSignalOf = (text: string): QuotaSignal | undefined => {
  const exact = EXACT.exec(text);
  if (exact !== null) {
    const resetsAt = stampOfEpoch(exact[1] as string);
    return {
      ...(resetsAt === undefined ? {} : { resetsAt }),
      evidence: evidenceOf(text),
    };
  }
  if (LOOSE.test(text)) return { evidence: evidenceOf(text) };
  return undefined;
};

/**
 * ONE LINE OF THE SESSION STREAM → the quota verdict, or `undefined` for the
 * overwhelming majority of lines that say nothing about a limit.
 *
 * Pure and total: it never throws. Whether the line is stream JSON is the FIRST
 * question it asks — see the doc block on why the prose layers may not be let loose on
 * a line whose payload belongs to the session.
 */
export const quotaSignalOf = (line: string): QuotaSignal | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;

  // Not stream JSON — the launcher's own refusal, whole. Nothing here belongs to a
  // session, so there is no payload to mistake for the vendor's voice.
  const event = streamEventOf(trimmed);
  if (event === undefined) return proseSignalOf(trimmed);

  // Layer 1 — and when it READ the event, its answer is final in both directions.
  const structured = structuredSignalOf(event);
  if (structured !== NOT_QUOTA_EVENT) return structured === "open" ? undefined : structured;

  for (const surface of proseSurfacesOf(event)) {
    const signal = proseSignalOf(surface);
    if (signal !== undefined) return signal;
  }
  return undefined;
};

/**
 * The human line for the supervisor's log and its stream. It says the two things a
 * reader needs and refuses to say a third: that the run ended on the QUOTA (not on
 * its own failure), and whether the reopening time is known.
 *
 * The sentence about attempts is in here on purpose. The whole value of this reason
 * is that it does NOT count towards the ceiling, and a property nobody can see is a
 * property nobody trusts — the operator reading this line is exactly the person who
 * would otherwise go and check the journal by hand.
 */
export const describeQuotaRelease = (signal: QuotaSignal): string =>
  signal.resetsAt === undefined
    ? `the window ran out (the signal did not say when it reopens): ${signal.evidence}. This does NOT count as a failed attempt — the pair is not moving towards 'exhausted'.`
    : `the window ran out and reopens at ${signal.resetsAt}: ${signal.evidence}. This does NOT count as a failed attempt — the pair is not moving towards 'exhausted'.`;

/* ── PART 2 (D-3): THE SHELF THE CIRCUIT WAITS ON ─────────────────────────────────
 *
 * Part 1 gave the closed window its own name so a role stopped being marked
 * `exhausted` for something that was never its fault. What it deliberately left alone
 * was the operational half, said out loud at the time: the tick goes on hammering a
 * closed door every tick. This is that half — the backoff.
 *
 * THE WINDOW BELONGS TO THE ACCOUNT, NOT TO THE ROLE (curator's correction 1, and the
 * load-bearing fact of all of D-2). N parallel sessions burn ONE five-hour window, so a
 * per-role backoff, taken literally, would stand one role down and leave the other N−1
 * walking into the same closed door — the very thing part 2 exists to remove, only in
 * N−1 copies. The shelf is therefore per INSTANCE: a signal from any role closes it for
 * every role of this box. That needs no new storage — the journal is already this box's
 * own file, read whole on every tick, so "somebody here hit the wall" is a fold of it
 * rather than a state file to be kept in sync with one.
 *
 * THERE ARE TWO WINDOWS AND THEY ARE NOT ONE SHELF (correction 2). Counted on this box:
 * `five_hour` 140, `seven_day` 6. One shelf for both is wrong in both directions — a
 * seven-day signal filed on the five-hour shelf opens the door six days early, and a
 * five-hour one filed on the weekly shelf freezes the circuit for a week. The shelf is
 * keyed by the vendor's own word, so a third window type we have never seen gets its own
 * shelf under its own name instead of being folded into one of ours.
 *
 * A SIGNAL WITHOUT A TIME GETS A SHORT SHELF, AND THE NUMBER IS SAID HERE (correction 3).
 * "Closed, reopening unknown" is a distinct fact of part 1 and must not be inflated into
 * "closed for five hours": a made-up long shelf stands the whole box down for hours on a
 * signal that never claimed as much. Five minutes, and a repeat signal simply extends it
 * — the cost of being too short is one wasted launch that immediately re-signals and
 * re-shelves; the cost of being too long is hours of a circuit that could have worked.
 * The asymmetry picks the number, exactly as it picked the net in part 1.
 */

/** The shelf a signal that did not name a reset time gets — see the block above. */
export const SHORT_SHELF_MINUTES = 5;

/** The key of a shelf for a signal that did not name its window type. */
export const UNKNOWN_WINDOW = "unknown";

/**
 * THE SHELF IS PER ACCOUNT AND PER WINDOW (thread 055, B.3) — the correction B.2 forced.
 *
 * The block above says it in one line and it was true while a box had one subscription:
 * "the window belongs to the account, not to the role". B.2 made a box able to raise its
 * roles on SEVERAL accounts (`launch.account` in the repository, `accounts.<id>.configDir`
 * on the machine), and from that moment "per instance" stopped being a synonym for "per
 * account" — it became the bug. A five-hour window burnt out on account `main` would stand
 * down the roles of account `second`, whose window nobody has touched, for five hours: the
 * exact stall D-3 part 2 exists to remove, now caused by the backoff itself and on a box
 * that has the quota to keep working. In the other direction nothing is lost — a signal
 * still closes the door for every role sharing that account, which is the fact that made
 * a per-role backoff wrong in the first place.
 *
 * SILENCE IS A KEY, NOT A GAP. A run with no `launch.account` spends the box's own account
 * (`launch.ts`), and that is a real account with a real window — so `undefined` shelves
 * under {@link BOX_ACCOUNT} and matches candidates that name no account either. This is
 * also why journals written before B.3 need no migration: every one of their events lands
 * on the box's own shelf, which is where every one of those runs actually spent.
 */
export const BOX_ACCOUNT = "";

/**
 * The key of one shelf — the pair (account, window), in that order, joined by a separator
 * neither half can contain. It is written as the ESCAPE SEQUENCE and never as the byte
 * itself: one literal NUL in a source file makes git, GitHub and grep call the whole blob
 * binary for ever while every tool stays green (`sources.test.ts`, the guard of PR #81) —
 * which is exactly what the first draft of this line did.
 */
const shelfKey = (account: string, window: string): string => `${account}\u0000${window}`;

/**
 * THE BOUNDARY THE VENDOR STATES ON EVERY TURN (thread 019) — and the reason the short
 * shelf above is a last resort rather than the answer.
 *
 * Measured on the live journal of the LLE box (2026-08-21, `daemon.log`, 46 events, every
 * one of them of this shape): the stream carries a `rate_limit_event` in the first frames
 * of EVERY session, and it carries `resetsAt` whatever the status —
 * `{"status":"allowed","resetsAt":1787305800,"rateLimitType":"five_hour"}`. So the moment
 * the window ends is known to the circuit long BEFORE the window closes, and it is known
 * from the vendor's own number rather than from a guess.
 *
 * WHAT THIS IS NOT, and the mistake it would be: a permitting event is NOT a closure and
 * must never open a shelf. `resetsAt` on an `allowed` status says when the CURRENT window
 * rolls over — every session sees one, and shelving on it would stand the box down
 * permanently, on the very signal that says work is allowed. The boundary is therefore
 * inert on its own: it is only ever read as the END of a shelf that a REFUSAL has already
 * opened (`shelfEndOfRefusal`), and it changes nothing about when a shelf opens.
 */
export type WindowBoundary = {
  /** The vendor's word for the window (`five_hour`, `seven_day`, …) or `unknown`. */
  readonly window: string;
  /** When that window rolls over, UTC ISO to the second. */
  readonly resetsAt: string;
};

/**
 * ONE LINE OF THE SESSION STREAM → the window boundary it states, or `undefined` for
 * every line that is not a `rate_limit_event` with a readable `resetsAt`.
 *
 * The status is deliberately NOT looked at: both a permitting and a refusing event carry
 * the same field about the same window, and this function's whole job is to read that
 * number. Whether the window is OPEN is `quotaSignalOf`'s question and stays there — the
 * two are kept apart so that no future edit can turn an `allowed` event into a shelf.
 *
 * Pure and total: it never throws.
 */
export const windowBoundaryOf = (line: string): WindowBoundary | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  const event = streamEventOf(trimmed);
  if (event === undefined) return undefined;
  const info = event["rate_limit_info"] as RateLimitInfo | undefined;
  if (info === undefined || info === null || typeof info !== "object") return undefined;
  if (typeof info.resetsAt !== "number" && typeof info.resetsAt !== "string") return undefined;
  const resetsAt = stampOfEpoch(String(info.resetsAt));
  if (resetsAt === undefined) return undefined;
  return {
    window: typeof info.rateLimitType === "string" ? info.rateLimitType : UNKNOWN_WINDOW,
    resetsAt,
  };
};

/**
 * WHEN THE SHELF OPENED BY THIS REFUSAL ENDS — the whole of thread 019's part 2 as the
 * supervisor sees it, in one pure function so the rule has one home.
 *
 * Three answers, in order, and the order is the point:
 *
 *  1. **The refusal's own number wins.** `Claude AI usage limit reached|<epoch>` and a
 *     refusing `rate_limit_event` both state the reopening of the window that ACTUALLY
 *     closed; nothing observed earlier in the run can be better evidence than that.
 *  2. **The boundary of the SAME window.** A refusal that named its window type but no
 *     time (and the loose prose never names a time) is answered by the number the vendor
 *     stated for that very window in the frames of this run.
 *  3. **The EARLIEST future boundary**, when the refusal named no window at all — which is
 *     every prose form, `rate_limit_error` and the launcher's 429 included. Earliest and
 *     not latest, by the asymmetry this module already lives by: waiting too long is hours
 *     of a circuit that could have worked, waiting too little is ONE launch that
 *     immediately re-signals and re-shelves. A seven-day boundary must never be able to
 *     stand the box down for a week on a refusal that never said which window it was.
 *
 * `undefined` — nothing was observed and the short default shelf stands, exactly as
 * before. A boundary already in the past is not an answer either: it describes a window
 * that has since rolled over, and a shelf ending in the past is no shelf at all.
 */
export const shelfEndOfRefusal = (input: {
  readonly signal: QuotaSignal;
  /** Boundaries seen in this run's stream, in the order they arrived. */
  readonly boundaries: readonly WindowBoundary[];
  /** The moment of the release — what makes a boundary "future". */
  readonly now: Date;
}): string | undefined => {
  if (input.signal.resetsAt !== undefined) return input.signal.resetsAt;
  const future = input.boundaries.filter(
    (boundary) => new Date(boundary.resetsAt).getTime() > input.now.getTime(),
  );
  if (future.length === 0) return undefined;
  const window = input.signal.window;
  if (window !== undefined && window !== UNKNOWN_WINDOW) {
    // The newest reading of that window: a run's later frames correct its earlier ones.
    const named = future.filter((boundary) => boundary.window === window).at(-1);
    if (named !== undefined) return named.resetsAt;
  }
  return future.reduce((earliest, boundary) =>
    boundary.resetsAt < earliest.resetsAt ? boundary : earliest,
  ).resetsAt;
};

/** One closed window: whose account, which window, until when, and on whose evidence. */
export type QuotaShelf = {
  /**
   * The account whose window closed — the id as the repository names it, or
   * {@link BOX_ACCOUNT} for the box's own. See the block above for why the empty string is
   * a key and not a missing value.
   */
  readonly account: string;
  /** The vendor's word for the window (`five_hour`, `seven_day`, …) or `unknown`. */
  readonly window: string;
  /** When the door opens again, UTC ISO to the second. */
  readonly until: string;
  /** The stamp of the signal that closed it. */
  readonly since: string;
  /**
   * Whether `until` is the VENDOR'S time or our short default. An operator reading
   * "closed until 21:40" deserves to know which of the two they are looking at: the
   * first is a fact, the second is a guess that expires quickly on purpose.
   */
  readonly stated: boolean;
  /** The role whose session brought the signal in — evidence, not ownership. */
  readonly role: string;
};

/** The journal shape this fold reads — kept structural so nothing here imports the daemon. */
type QuotaEvent = {
  readonly kind: string;
  readonly ts: string;
  readonly role: string;
  readonly reason?: string | undefined;
  readonly until?: string | undefined;
  readonly window?: string | undefined;
  readonly account?: string | undefined;
};

const shelfEnd = (event: QuotaEvent): { until: string; stated: boolean } =>
  event.until === undefined
    ? {
        until: `${new Date(new Date(event.ts).getTime() + SHORT_SHELF_MINUTES * 60_000)
          .toISOString()
          .slice(0, 19)}Z`,
        stated: false,
      }
    : { until: event.until, stated: true };

/**
 * THE JOURNAL → THE SHELVES THAT ARE STILL CLOSED at `now`, newest signal per window.
 *
 * Derived rather than stored, and that is the whole reason there is no `quota` state
 * file beside the holds: the journal is append-only, local to this box and already read
 * whole on every tick, so the shelf cannot drift from the events that produced it. The
 * fold takes the LAST signal per window key — a repeat signal extends (or corrects) the
 * shelf, which is what makes the short default safe.
 *
 * A shelf whose `until` has passed is simply not returned: the backoff ends by the clock
 * and by nothing else. A backoff that needed clearing by hand would be `exhausted` under
 * another name, which is precisely the failure part 1 removed.
 */
export const openQuotaShelves = (
  events: readonly QuotaEvent[],
  now: Date,
): readonly QuotaShelf[] => {
  const latest = new Map<string, QuotaShelf>();
  for (const event of events) {
    if (event.kind !== "lease-released" || event.reason !== "quota-exhausted") continue;
    const window = event.window ?? UNKNOWN_WINDOW;
    const account = event.account ?? BOX_ACCOUNT;
    latest.set(shelfKey(account, window), {
      account,
      window,
      since: event.ts,
      role: event.role,
      ...shelfEnd(event),
    });
  }
  return [...latest.values()]
    .filter((shelf) => new Date(shelf.until).getTime() > now.getTime())
    .sort((a, b) => (a.until < b.until ? -1 : a.until > b.until ? 1 : 0));
};

/**
 * THE SHELVES THAT STAND IN THE WAY OF ONE CANDIDATE — the whole of B.3 as the planner
 * sees it. A candidate spending account `a` is refused by the closed windows of `a` and by
 * nothing else; a candidate that names no account spends the box's own and is refused by
 * its shelves. The filter is an equality on the key and never a fall-back: a shelf of
 * another account leaking into this answer is the stall this change removes.
 */
export const shelvesAgainst = (
  shelves: readonly QuotaShelf[],
  account: string | undefined,
): readonly QuotaShelf[] => shelves.filter((shelf) => shelf.account === (account ?? BOX_ACCOUNT));

/**
 * Whether the refusal of THIS shelf has already been written to the journal. Not once per
 * tick: a closed five-hour window with a 60-second tick would otherwise leave three
 * hundred identical `launch-refused` lines, and a journal of runs that has to be read to
 * explain a stall would be unreadable exactly then. The daemon's stream still says it
 * every tick — that is the channel where repetition is the point, and the journal is the
 * one where it is noise.
 *
 * THE UNIT OF THE LINE IS THE DARK SPELL OF THE BOX, NOT THE WINDOW (the granularity
 * curator asked to name, thread 023). `ts >= shelf.since` per shelf, folded with `every`
 * by the caller, means two windows that close before the first line is written share ONE
 * line, while a window that closes AFTER the last line opens a new one. That is the
 * intent, not a rounding of it: what `launch-refused` records is that NOTHING WAS
 * LAUNCHED, and nothing-was-launched is a property of the box — the candidates it names
 * belong to no window in particular, so a per-window line would print the same refused
 * pair twice with a label it cannot honestly carry. Which windows were closed at that
 * moment is a question the shelves answer (`status`, the digest, the stream), and they
 * answer it per window.
 */
export const quotaRefusalRecorded = (events: readonly QuotaEvent[], shelf: QuotaShelf): boolean =>
  events.some(
    (event) =>
      event.kind === "launch-refused" && event.reason === "quota" && event.ts >= shelf.since,
  );

/**
 * WHOSE WINDOW, in the words an operator can act on: a named account, or the box's own
 * when nothing was named. Two accounts standing down at once is the picture B.3 makes
 * possible, and a line that does not say which is which is unreadable exactly then.
 */
export const describeAccount = (account: string): string =>
  account === BOX_ACCOUNT ? "the box's own account" : `account '${account}'`;

/**
 * HOW LONG THIS SHELF STILL STANDS, in whole minutes, rounded UP and never below zero.
 *
 * Rounded up because the reader's question is "may I stop waiting yet", and a shelf with
 * forty seconds left printed as `0m left` answers it wrongly in the one direction that
 * costs something: it reads as "this should already be over" and sends a hand looking for
 * a defect that is not there. Clamped at zero because a passed shelf is not returned by
 * {@link openQuotaShelves} at all, so a negative here would only ever be a caller holding
 * an older `now` than the fold did — and `-3m left` is noise, not news.
 */
export const minutesLeftOnShelf = (shelf: QuotaShelf, now: Date): number =>
  Math.max(0, Math.ceil((new Date(shelf.until).getTime() - now.getTime()) / 60_000));

/**
 * THE MOMENT THE DOOR OPENS, in the clock a human reads — `16:00Z`, not a full ISO stamp.
 * The date is dropped and the `Z` is kept: every shelf in the field opens within hours of
 * being read, so the day is noise, while the ZONE is the one part that cannot be guessed
 * from context — a bare `16:00` on a box whose operator lives in +03:00 is a three-hour
 * lie about when the circuit comes back.
 */
export const resumesAt = (shelf: QuotaShelf): string => `${shelf.until.slice(11, 16)}Z`;

/**
 * ONE SHELF IN A LINE, AND IT OPENS WITH THE WORD THE READER IS LOOKING FOR (thread 019,
 * §4). The line used to begin with the window's name, so the answer to "why is the circuit
 * silent" was spelled out in the middle of a sentence whose first half was vendor jargon.
 * `quota-paused` is the marker — the same token in the daemon's stream, the `status` frame,
 * the TUI and the digest of a neighbouring box — and the minutes left are on it because the
 * ISO stamp alone makes every reader do arithmetic against a clock they must first find.
 *
 * The rest of the sentence is unchanged in substance: whose account, which window, and
 * whether `until` is the VENDOR'S time or our short guess. That last distinction is the
 * reason this is not one string with a placeholder — a guess printed in the shape of a fact
 * is how an operator learns to distrust the whole line.
 */
export const describeQuotaShelf = (shelf: QuotaShelf, now: Date): string =>
  shelf.stated
    ? `quota-paused until ${shelf.until} (${minutesLeftOnShelf(shelf, now)}m left) — ${shelf.window} window of ${describeAccount(shelf.account)}; the signal named the time (seen at ${shelf.since} on ${shelf.role})`
    : `quota-paused until ${shelf.until} (${minutesLeftOnShelf(shelf, now)}m left) — ${shelf.window} window of ${describeAccount(shelf.account)}; the signal did NOT say when it reopens, so this is the short default shelf of ${SHORT_SHELF_MINUTES}m and the next signal extends it (seen at ${shelf.since} on ${shelf.role})`;

/**
 * THE SAME FACT FOR A ONE-LINE DIGEST, where the whole circuit gets one sentence and this
 * shelf gets a clause of it (thread 019, §4). The courier's line is read on a phone: it
 * carries the marker, the clock and how long is left, and drops the provenance — whoever
 * wants to know which signal opened the shelf has `status` open in the next breath.
 *
 * A GUESSED END IS NAMED AS A GUESS HERE TOO, in four words rather than in a sentence. The
 * short default expires by design and a reader who takes it for the vendor's word will be
 * back in five minutes wondering why the circuit is still down.
 */
export const describeQuotaPause = (shelf: QuotaShelf, now: Date): string =>
  `quota-paused, resumes ${resumesAt(shelf)} (${minutesLeftOnShelf(shelf, now)}m left${
    shelf.stated ? "" : ", our short default — the signal named no time"
  }) — ${shelf.window} window of ${describeAccount(shelf.account)}`;
