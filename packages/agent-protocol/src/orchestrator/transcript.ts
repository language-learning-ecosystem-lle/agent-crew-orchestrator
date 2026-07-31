/**
 * THE SESSION TRANSCRIPT — the pure core of R6 part 1 (thread 016, curator's
 * statement of work 16:10).
 *
 * The diagnosis behind it. Every `.orchestrator/sessions/*.log` was EMPTY, runs
 * with half an hour of live work included — so every break was analysed blind, and
 * "session output: <path>" in the break message pointed at a file guaranteed to
 * hold nothing. Two causes stacked, and only fixing both makes the log real:
 *
 *  1. THE STREAM. The supervisor put stderr into the file and INHERITED stdout —
 *     while `claude -p` says what it did on stdout. The log was collecting the one
 *     stream the agent is silent on.
 *  2. THE MOMENT. With the default `--output-format text` the agent prints its
 *     answer ONCE, when the run is over. A session cut by a deadline or a turn
 *     ceiling never reaches that point — precisely the runs whose analysis the log
 *     exists for produce zero bytes by construction.
 *
 * Hence `--output-format stream-json --verbose`: the agent emits an NDJSON event
 * per step AS IT WORKS. The raw stream is kept as it came (`.jsonl` — the primary
 * source; a rendering is lossy and its blind spots are exactly what one needs when
 * the rendering failed to explain the break), and beside it lies a human reading
 * of the same events (`.log`, the file the journal points at).
 *
 * THE RENDERING NEVER DROPS A LINE. An unknown event kind, a line that is not JSON
 * at all (a stub in the tests, a launcher's message, a crash dump) — everything
 * reaches the log as it was. A transcript that quietly swallows the unfamiliar
 * would fail in exactly the situation it is read in.
 */
import { z } from "zod";

/** How much of a text block reaches the human log — enough to recognise the step. */
const PREVIEW = 400;

const preview = (value: string, limit: number = PREVIEW): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}… (+${flat.length - limit})`;
};

/**
 * The stream is SOMEBODY ELSE'S data — an external boundary, hence zod. The
 * schemas are deliberately loose (`looseObject`, everything optional): the package
 * reads a format it does not own, and a field added upstream must not turn the log
 * into a refusal. Whatever fails to match a known shape is rendered as compact
 * JSON rather than lost.
 */
const contentBlock = z.looseObject({
  type: z.string().optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  thinking: z.string().optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

const streamEvent = z.looseObject({
  type: z.string().optional(),
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  model: z.string().optional(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  // THE LEDGER OF A FINISHED RUN (thread 029). It rides on the `result` event and
  // NOWHERE ELSE — see `runUsageOf` on why the per-message `usage` is not a second
  // source for the same numbers.
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    })
    .optional(),
  message: z
    .looseObject({
      content: z.union([z.string(), z.array(contentBlock)]).optional(),
    })
    .optional(),
});

type ContentBlock = z.infer<typeof contentBlock>;

/** A tool call in one line: the name plus the argument that identifies the call. */
const toolLine = (block: ContentBlock): string => {
  const input = block.input;
  if (input === undefined || input === null) return `tool ${block.name ?? "?"}`;
  const record = typeof input === "object" ? (input as Record<string, unknown>) : {};
  // The fields that say WHICH call this is — the same ones a human looks at first.
  for (const key of ["command", "file_path", "path", "pattern", "query", "prompt", "description"]) {
    const value = record[key];
    if (typeof value === "string")
      return `tool ${block.name ?? "?"}  ${key}=${preview(value, 200)}`;
  }
  return `tool ${block.name ?? "?"}  ${preview(JSON.stringify(input), 200)}`;
};

const blockLines = (blocks: readonly ContentBlock[], speaker: string): string[] =>
  blocks.map((block) => {
    if (block.type === "text" && typeof block.text === "string") {
      return `${speaker}  ${preview(block.text)}`;
    }
    if (block.type === "thinking") {
      return `${speaker}  thinking (${(block.thinking ?? "").length} chars)`;
    }
    if (block.type === "tool_use") return toolLine(block);
    if (block.type === "tool_result") {
      const body =
        typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
      return `result${block.is_error === true ? " ERROR" : ""}  ${preview(body, 200)}`;
    }
    return `${speaker}  ${preview(JSON.stringify(block), 200)}`;
  });

/**
 * One line of the raw stream → the lines of the human log (zero or more). Pure:
 * the caller stamps and writes them.
 */
export const renderStreamLine = (line: string): string[] => {
  const trimmed = line.trim();
  if (trimmed === "") return [];

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [trimmed]; // not the stream format at all — kept verbatim
  }
  const parsed = streamEvent.safeParse(raw);
  if (!parsed.success) return [preview(trimmed, 600)];
  const event = parsed.data;

  switch (event.type) {
    case "system":
      // The init line carries the SESSION ID — the identity a break analysis starts
      // from, and the answer the R7 header will need ("which session wrote this").
      return [
        `system ${event.subtype ?? ""}  session ${event.session_id ?? "?"}${
          event.model === undefined ? "" : `  model ${event.model}`
        }`.trim(),
      ];
    case "assistant":
    case "user": {
      const content = event.message?.content;
      if (typeof content === "string") return [`${event.type}  ${preview(content)}`];
      if (Array.isArray(content)) return blockLines(content, event.type);
      return [`${event.type}  ${preview(JSON.stringify(event.message ?? {}), 200)}`];
    }
    case "result": {
      const parts = [
        `result ${event.subtype ?? (event.is_error === true ? "error" : "ok")}`,
        event.num_turns === undefined ? undefined : `turns ${event.num_turns}`,
        event.duration_ms === undefined ? undefined : `${Math.round(event.duration_ms / 1000)}s`,
        event.total_cost_usd === undefined ? undefined : `cost $${event.total_cost_usd.toFixed(4)}`,
      ].filter((part): part is string => part !== undefined);
      const text = event.result === undefined ? [] : [`  ${preview(event.result)}`];
      return [parts.join("  "), ...text];
    }
    default:
      return [preview(trimmed, 600)];
  }
};

/**
 * THE SESSION ID OUT OF ONE STREAM LINE — the answer to R7's open question, "how
 * does a session learn its own id" (thread 016).
 *
 * It needs no channel of its own: `claude -p --output-format stream-json` opens with
 * a `system`/`init` event carrying `session_id`, and the supervisor is already
 * reading every line of that stream for the log. So the id is known to the
 * supervisor a second after the spawn — and it is passed DOWN to the session through
 * a file, because the environment of a process that is already running cannot be
 * changed, and at spawn time the id does not exist yet.
 *
 * `undefined` for every other line, including a later event that happens to repeat
 * the id: the first one wins, and the caller writes the file once.
 */
export const sessionIdOf = (line: string): string | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const parsed = streamEvent.safeParse(raw);
  if (!parsed.success) return undefined;
  const event = parsed.data;
  if (event.type !== "system" || event.subtype !== "init") return undefined;
  return event.session_id === undefined || event.session_id === "" ? undefined : event.session_id;
};

/**
 * WHICH MODEL RAN — from the same `system`/`init` line the id comes from (thread 029).
 * `undefined` everywhere else, first one wins, exactly like `sessionIdOf`: the model is
 * a property of the run, not of a message, and a later line repeating it changes nothing.
 */
export const modelOf = (line: string): string | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const parsed = streamEvent.safeParse(raw);
  if (!parsed.success) return undefined;
  const event = parsed.data;
  if (event.type !== "system" || event.subtype !== "init") return undefined;
  return event.model === undefined || event.model === "" ? undefined : event.model;
};

/** What a finished run burned — the block that lands on `lease-released` (thread 029). */
export type RunUsage = {
  readonly turns?: number;
  readonly durationSec?: number;
  readonly costUsd?: number;
  readonly tokens?: {
    readonly in: number;
    readonly out: number;
    readonly cacheWrite: number;
    readonly cacheRead: number;
  };
};

/**
 * THE ECONOMICS OF A RUN OUT OF ONE STREAM LINE (thread 029) — turns, wall time, dollars
 * and tokens, read where the supervisor is already reading every line for the log.
 *
 * WHY ONLY THE `result` EVENT, when every assistant message carries a `usage` of its own
 * and summing those would also cover the runs that never reach a result line. Because
 * they do not add up to the same thing, and the error is not a rounding one: measured on
 * three finished runs against their own result lines, per-message `output` came out 15 to
 * 110 times LOW (the values are streaming partials) while `cache_read` came out about
 * TWICE HIGH (the same read counted again on every message). Two fields, opposite signs,
 * an order of magnitude of spread between runs — so there is no correction factor either.
 * A broken run therefore has no honest token count at all, and this function returns
 * `undefined` for it rather than a number that would look like one.
 *
 * That absence is a NAMED CLASS, not a scatter: on this box every run without a result
 * line was a `quota-exhausted`, a `timeout` or a `supervisor-gone` — killed before the
 * ledger was written. The command that folds the journal prints those runs by their count,
 * their break class, their steps and their wall time, plus the plain sentence that their
 * tokens are not counted (curator's fifth acceptance condition, msg-014).
 */
export const runUsageOf = (line: string): RunUsage | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const parsed = streamEvent.safeParse(raw);
  if (!parsed.success || parsed.data.type !== "result") return undefined;
  const event = parsed.data;
  const usage = event.usage;
  const tokens =
    usage === undefined
      ? undefined
      : {
          in: Math.max(0, Math.round(usage.input_tokens ?? 0)),
          out: Math.max(0, Math.round(usage.output_tokens ?? 0)),
          cacheWrite: Math.max(0, Math.round(usage.cache_creation_input_tokens ?? 0)),
          cacheRead: Math.max(0, Math.round(usage.cache_read_input_tokens ?? 0)),
        };
  return {
    ...(event.num_turns === undefined ? {} : { turns: Math.max(0, Math.round(event.num_turns)) }),
    ...(event.duration_ms === undefined
      ? {}
      : { durationSec: Math.max(0, Math.round(event.duration_ms / 1000)) }),
    ...(event.total_cost_usd === undefined ? {} : { costUsd: event.total_cost_usd }),
    ...(tokens === undefined ? {} : { tokens }),
  };
};

/**
 * IS THIS LINE ONE STEP OF THE SESSION (R18) — how much of a run was burned before it
 * broke, counted as the assistant messages its stream carried.
 *
 * WHY NOT THE VENDOR'S OWN `num_turns`. It exists only in the `result` event, which a
 * run emits when it FINISHES — that is, precisely the runs that are never candidates
 * for a resume. A broken run leaves no result line at all, so the only count that
 * exists for it is the one the supervisor keeps while reading the stream anyway.
 *
 * The unit therefore differs from the vendor's and is named differently on purpose
 * (`steps`, not `turns`): on this repository's own runs the two ran about 1.45 steps
 * to a turn, and quietly calling one the other would make the ceiling in
 * `continuation.ts` mean something other than what it was calibrated against.
 */
export const isAssistantStep = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return false;
  }
  const parsed = streamEvent.safeParse(raw);
  return parsed.success && parsed.data.type === "assistant";
};

/**
 * A chunk of the stream (arriving in arbitrary pieces) → complete lines plus the
 * unfinished tail. A separate function because the split is where a naive reader
 * loses data: a chunk boundary falls in the middle of a JSON line far more often
 * than it looks, and half a line is neither renderable nor recoverable later.
 */
export const splitStreamChunk = (
  buffer: string,
  chunk: string,
): { readonly lines: string[]; readonly rest: string } => {
  const parts = `${buffer}${chunk}`.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
};

/** A log line with the moment it was written — the pace of a run is half its analysis. */
export const stampLine = (at: Date, text: string): string =>
  `${at.toISOString().slice(11, 19)}  ${text}`;
