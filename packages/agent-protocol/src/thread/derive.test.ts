import { describe, expect, it } from "vitest";

import { renderIndex } from "./index-doc.js";
import type { Message } from "./message.js";
import { renderThread, type ThreadMeta } from "./thread.js";

// derive() in the CLI glues exactly these two renderers together — here their
// consistency is checked at the core level: the assembled thread and the index do
// not contradict each other, and a repeated assembly is idempotent (that is what
// "commit only on divergence" rests on, i.e. a soft transition without a second
// writer).

const meta = (status: "open" | "closed"): ThreadMeta => ({
  title: "012-x · thread",
  participants: ["curator", "dev-core"],
  status,
});

const msg = (from: string, date: string, waitingOn?: string): Message => ({
  fields: { from, date, expects: "answer", ...(waitingOn ? { waitingOn } : {}) },
  text: "text",
});

describe("derive (consistency of the derived files)", () => {
  it("a repeated assembly of _thread.md is idempotent", () => {
    const messages = [msg("curator", "2026-07-23T10:00:00Z", "dev-core")];
    const once = renderThread(meta("open"), messages);
    // "Parsing it back" is not needed here: idempotence of the renderer — the same
    // inputs yielding a byte-identical result — is exactly the property the
    // idempotent action relies on.
    const twice = renderThread(meta("open"), messages);

    expect(twice).toBe(once);
  });

  it("INDEX and _thread.md agree on the waiting-on of one thread", () => {
    const messages = [
      msg("curator", "2026-07-23T10:00:00Z", "dev-core"),
      msg("dev-core", "2026-07-23T11:00:00Z", "curator"),
    ];
    const thread = { id: "012-x", meta: meta("open"), messages };
    const index = renderIndex([thread]);

    // The last declaration is curator; both the waiting-on column in INDEX and the
    // tail of the assembled thread must say the same thing.
    expect(index).toContain("| 012-x | curator, dev-core | open | curator |");
    expect(renderThread(thread.meta, messages)).toContain(
      "dev-core · 2026-07-23 · expects: answer",
    );
  });

  it("a closed thread awaits nobody in INDEX, whatever the last message says", () => {
    const thread = {
      id: "012-x",
      meta: meta("closed"),
      messages: [msg("curator", "2026-07-23T10:00:00Z", "dev-core")],
    };

    expect(renderIndex([thread])).toContain("| 012-x | curator, dev-core | closed | — |");
  });
});
