/**
 * The session transcript (R6, thread 016). The property that matters is not
 * "pretty output" but that NOTHING IS LOST: the log is read after a break, and a
 * renderer that quietly drops what it does not recognise fails exactly there.
 */
import { describe, expect, it } from "vitest";

import { renderStreamLine, splitStreamChunk, stampLine } from "./transcript.js";

describe("rendering the stream of a session", () => {
  it("the init line carries the SESSION ID — the identity an analysis starts from", () => {
    const line = renderStreamLine(
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
        model: "claude-opus-5",
      }),
    );

    expect(line).toHaveLength(1);
    expect(line[0]).toContain("session abc-123");
    expect(line[0]).toContain("model claude-opus-5");
  });

  it("the agent's words reach the log", () => {
    const line = renderStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "I am reading the thread" }] },
      }),
    );

    expect(line).toEqual(["assistant  I am reading the thread"]);
  });

  it("a tool call is named together with the argument that identifies it", () => {
    // "tool Bash" answers nothing; "which command" is the whole point of reading
    // the log of a broken run.
    const line = renderStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }],
        },
      }),
    );

    expect(line).toEqual(["tool Bash  command=pnpm test"]);
  });

  it("a failed tool result is marked as an error, not smoothed over", () => {
    const line = renderStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "permission denied", is_error: true }],
        },
      }),
    );

    expect(line[0]).toBe("result ERROR  permission denied");
  });

  it("the final result line carries the turns, the duration and the cost", () => {
    const lines = renderStreamLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        num_turns: 42,
        duration_ms: 61_000,
        total_cost_usd: 1.5,
        result: "done",
      }),
    );

    expect(lines[0]).toBe("result success  turns 42  61s  cost $1.5000");
    expect(lines[1]).toContain("done");
  });

  it("a line that is NOT the stream format reaches the log verbatim", () => {
    // A launcher's complaint, a stack trace, the output of a stub — the answer
    // itself, and rendering it would mean losing it.
    expect(renderStreamLine("claude: command not found")).toEqual(["claude: command not found"]);
  });

  it("an UNKNOWN event kind is kept, not dropped", () => {
    const line = renderStreamLine(JSON.stringify({ type: "something-new", payload: 1 }));
    expect(line[0]).toContain("something-new");
  });

  it("a blank line adds nothing", () => {
    expect(renderStreamLine("   ")).toEqual([]);
  });

  it("a long text is truncated WITH the number of characters dropped — not silently", () => {
    const line = renderStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "x".repeat(1000) }] },
      }),
    );
    expect(line[0]).toContain("(+600)");
  });
});

describe("splitting the stream into lines", () => {
  it("a chunk boundary in the middle of a line does not lose it", () => {
    const first = splitStreamChunk("", '{"type":"assis');
    expect(first.lines).toEqual([]);

    const second = splitStreamChunk(first.rest, 'tant"}\n');
    expect(second.lines).toEqual(['{"type":"assistant"}']);
    expect(second.rest).toBe("");
  });

  it("several lines in one chunk all come through", () => {
    const split = splitStreamChunk("", "a\nb\nc");
    expect(split.lines).toEqual(["a", "b"]);
    expect(split.rest).toBe("c");
  });
});

describe("the stamp", () => {
  it("every line carries the moment — the pace of a run is half its analysis", () => {
    expect(stampLine(new Date("2026-07-25T16:41:07Z"), "assistant  hi")).toBe(
      "16:41:07  assistant  hi",
    );
  });
});
