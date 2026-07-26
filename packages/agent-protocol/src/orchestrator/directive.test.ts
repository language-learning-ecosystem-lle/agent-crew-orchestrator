import { describe, expect, it } from "vitest";
import type { Message } from "../thread/message.js";
import { parseLaunchDirective, renderMessageFile } from "../thread/message.js";
import { resolveThreadDirective } from "./directive.js";
import { ignoredDirective, resolveAgentParams, resolveWorker } from "./launch.js";

const say = (from: string, date: string, launch?: string): Message => ({
  fields: {
    from,
    date,
    expects: "answer",
    ...(launch === undefined ? {} : { launch: parseLaunchDirective(launch) }),
  },
  text: "…",
});

const authorized = (role: string): boolean => role === "curator";

describe("the launch directive of a thread (R21)", () => {
  it("takes the LAST directive of an authorized role — a change mid-thread applies from the next run", () => {
    const verdict = resolveThreadDirective({
      messages: [
        say("curator", "2026-07-26T10:00:00Z", "model=haiku"),
        say("dev-core", "2026-07-26T11:00:00Z"),
        say("curator", "2026-07-26T12:00:00Z", "model=opus, effort=high"),
      ],
      authorized,
    });
    expect(verdict.effective?.directive).toEqual({ model: "opus", effort: "high" });
    expect(verdict.ignored).toEqual([]);
  });

  it("ignores a directive from a role without the permission — and SAYS SO", () => {
    const verdict = resolveThreadDirective({
      messages: [say("dev-core", "2026-07-26T10:00:00Z", "model=opus")],
      authorized,
    });
    expect(verdict.effective).toBeUndefined();
    expect(verdict.ignored).toHaveLength(1);
    expect(verdict.ignored[0]).toContain("dev-core");
    expect(verdict.ignored[0]).toContain("launch-params");
  });

  it("an unauthorized directive does not displace the authorized one before it", () => {
    const verdict = resolveThreadDirective({
      messages: [
        say("curator", "2026-07-26T10:00:00Z", "model=opus"),
        say("dev-core", "2026-07-26T11:00:00Z", "model=haiku"),
      ],
      authorized,
    });
    expect(verdict.effective?.directive).toEqual({ model: "opus" });
    expect(verdict.ignored).toHaveLength(1);
  });

  it("no directive in the feed — nothing in force and nothing said", () => {
    const verdict = resolveThreadDirective({
      messages: [say("curator", "2026-07-26T10:00:00Z")],
      authorized,
    });
    expect(verdict).toEqual({ ignored: [] });
  });
});

describe("the directive as a layer of the merge (R21 + R15)", () => {
  const worker = resolveWorker({});

  it("beats the role's standing calibration, and says where it came from", () => {
    const resolution = resolveAgentParams({
      flags: {},
      worker,
      launch: {
        allowedTools: ["Bash"],
        agent: { kind: "claude-code", model: "sonnet", effort: "medium" },
      },
      directive: { model: "opus" },
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.params.model).toEqual({ value: "opus", source: "thread" });
    // Unsaid by the directive — the role's value stands, with its own source.
    expect(resolution.params.effort).toEqual({ value: "medium", source: "role" });
  });

  it("loses to the operator's flag — a decision about THIS run beats one written days ago", () => {
    const resolution = resolveAgentParams({
      flags: { model: "haiku" },
      worker,
      directive: { model: "opus" },
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.params.model).toEqual({ value: "haiku", source: "flag" });
  });

  it("an effort level outside the vocabulary is dropped, not fatal — the feed cannot be unwritten", () => {
    const resolution = resolveAgentParams({
      flags: {},
      worker,
      directive: { effort: "ultra" },
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.params.effort).toBeUndefined();
  });
});

describe("what was found and NOT applied is spoken (R21, requirement 4)", () => {
  it("names the tool the run is being raised as when the directive was written for another", () => {
    const said = ignoredDirective({
      directive: { model: "opus", effort: "high" },
      worker: resolveWorker({ flag: "cursor" }),
    });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("cursor");
    expect(said[0]).toContain("NOT applied");
  });

  it("names the effort level the tool does not know", () => {
    const said = ignoredDirective({
      directive: { effort: "ultra" },
      worker: resolveWorker({}),
    });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("ultra");
    expect(said[0]).toContain("NOT applied");
  });

  it("says nothing when the directive reaches the run whole — or when there is none", () => {
    const worker = resolveWorker({});
    expect(ignoredDirective({ directive: { model: "opus", effort: "high" }, worker })).toEqual([]);
    expect(ignoredDirective({ worker })).toEqual([]);
  });
});

describe("the directive in the message header", () => {
  it("survives a round trip through the file", () => {
    const rendered = renderMessageFile(
      say("curator", "2026-07-26T10:00:00Z", "model=opus, effort=high"),
    );
    expect(rendered).toContain("launch: model=opus, effort=high");
  });

  it("refuses an unknown key rather than resolving it to 'nothing was said'", () => {
    expect(() => parseLaunchDirective("modell=opus")).toThrow(/known keys/);
  });

  it("refuses an empty field", () => {
    expect(() => parseLaunchDirective("")).toThrow(/empty/);
  });
});
