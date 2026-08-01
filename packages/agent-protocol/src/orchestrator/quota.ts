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

/** One closed window: which one, until when, and on whose evidence. */
export type QuotaShelf = {
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
    latest.set(window, { window, since: event.ts, role: event.role, ...shelfEnd(event) });
  }
  return [...latest.values()]
    .filter((shelf) => new Date(shelf.until).getTime() > now.getTime())
    .sort((a, b) => (a.until < b.until ? -1 : a.until > b.until ? 1 : 0));
};

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

/** One shelf in a line — the window, when it opens, and whether that time is the vendor's. */
export const describeQuotaShelf = (shelf: QuotaShelf): string =>
  shelf.stated
    ? `${shelf.window} window closed until ${shelf.until} (the signal named the time; seen at ${shelf.since} on ${shelf.role})`
    : `${shelf.window} window closed until ${shelf.until} — the signal did NOT say when it reopens, so this is the short default shelf of ${SHORT_SHELF_MINUTES}m and the next signal extends it (seen at ${shelf.since} on ${shelf.role})`;
