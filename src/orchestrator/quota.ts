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
 * all) a line that is not stream JSON in the first place. The failure mode of a
 * substring search is a false positive on a session that DISCUSSES rate limits, which
 * costs one wrongly-named release; a missed signal costs a role dropping out of the
 * circuit. The asymmetry chooses the net.
 */

/**
 * The quota verdict for one line. `resetsAt` is present only when the signal
 * carried it — see layer 2 above.
 */
export type QuotaSignal = {
  /** When the window reopens, UTC ISO to the second; absent when the signal did not say. */
  readonly resetsAt?: string;
  /** The matched text, trimmed — what the log and the journal quote as evidence. */
  readonly evidence: string;
};

/**
 * THE STRUCTURED LAYER (layer 1) — the stream's own `rate_limit_event`.
 *
 * The cheap gate first: parsing every line of a stream that is mostly assistant text
 * would be paid on every line for a shape that appears on a handful of them.
 */
const STRUCTURED_HINT = "rate_limit_info";

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
 * The structured verdict for one line, in three answers rather than two:
 *
 *  - a `QuotaSignal` — this event says the window is CLOSED;
 *  - `"open"` — this event was read and says work is permitted, which is CONCLUSIVE:
 *    the caller must not then hand the same line to the prose layers, where the event's
 *    own vocabulary would match it;
 *  - `undefined` — not this event, or not parseable as one. That is NOT a verdict:
 *    the line goes on to the prose layers, because the shape that carries the refusal
 *    text inside a bigger payload is exactly the shape that fails to parse here.
 *
 * A parsed event WITHOUT a readable status is a refusal on purpose: the whitelist is
 * "we could read permission", and a status we cannot read is not permission.
 */
const structuredSignalOf = (line: string): QuotaSignal | "open" | undefined => {
  let info: RateLimitInfo | undefined;
  try {
    const parsed = JSON.parse(line) as { readonly rate_limit_info?: RateLimitInfo };
    info = parsed?.rate_limit_info;
  } catch {
    return undefined;
  }
  if (info === undefined || info === null || typeof info !== "object") return undefined;

  const status = typeof info.status === "string" ? info.status : undefined;
  if (status !== undefined && permits(status)) return "open";

  const resetsAt =
    typeof info.resetsAt === "number" || typeof info.resetsAt === "string"
      ? stampOfEpoch(String(info.resetsAt))
      : undefined;
  const window = typeof info.rateLimitType === "string" ? info.rateLimitType : "unknown";
  return {
    ...(resetsAt === undefined ? {} : { resetsAt }),
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
 * ONE LINE OF THE SESSION STREAM → the quota verdict, or `undefined` for the
 * overwhelming majority of lines that say nothing about a limit.
 *
 * Pure and total: it never throws, and it does not care whether the line is stream
 * JSON — see the doc block on why that is the point rather than a shortcut.
 */
export const quotaSignalOf = (line: string): QuotaSignal | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;

  // Layer 1 first — and when it READ the event, its answer is final in both
  // directions. Only "I could not read this as that event" falls through.
  if (trimmed.includes(STRUCTURED_HINT)) {
    const structured = structuredSignalOf(trimmed);
    if (structured === "open") return undefined;
    if (structured !== undefined) return structured;
  }

  const exact = EXACT.exec(trimmed);
  if (exact !== null) {
    const resetsAt = stampOfEpoch(exact[1] as string);
    return {
      ...(resetsAt === undefined ? {} : { resetsAt }),
      evidence: evidenceOf(trimmed),
    };
  }
  if (LOOSE.test(trimmed)) return { evidence: evidenceOf(trimmed) };
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
