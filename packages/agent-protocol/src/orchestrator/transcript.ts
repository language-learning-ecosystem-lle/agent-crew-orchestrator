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
