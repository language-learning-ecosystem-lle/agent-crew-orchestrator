/**
 * The notification and announcement sections OF THE CONFIG (R4). The point of these
 * tests is the moment of failure: a template with a typo must fail here — in
 * `config check`, in the PR that introduces it — and not at the moment the notifier
 * finally has something to say.
 */
import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { parseProtocolConfig } from "./config.js";

const base = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [{ id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "PM" }],
};

describe("the notifications section", () => {
  it("is optional — a repository that notifies nobody is a valid one", () => {
    expect(() => parseProtocolConfig(base)).not.toThrow();
  });

  it("takes a transport module with its own options and the three template slots", () => {
    const config = parseProtocolConfig({
      ...base,
      notifications: {
        transport: { module: "transport-telegram", options: { parseMode: "HTML" } },
        templates: {
          turn: "⏳ {thread}",
          "turn-with-nudge": "⏳ {thread} ({nudged})",
          nudge: "🔔 {thread} · {role} · {via}",
        },
      },
      announcements: { "force-stop": "{thread} · {by} · {reason}" },
    });

    expect(config.notifications?.transport?.module).toBe("transport-telegram");
    expect(config.notifications?.transport?.options).toEqual({ parseMode: "HTML" });
  });

  it("REFUSES a placeholder the slot does not provide, at the door", () => {
    expect(() =>
      parseProtocolConfig({ ...base, notifications: { templates: { turn: "{nudged}" } } }),
    ).toThrow(/nudged/);
  });

  it("refuses an unknown slot — a typo in a slot name would be a silent default", () => {
    expect(() =>
      parseProtocolConfig({ ...base, notifications: { templates: { turnn: "x" } } }),
    ).toThrow();
  });

  it("refuses an announcement placeholder outside its vocabulary", () => {
    expect(() =>
      parseProtocolConfig({ ...base, announcements: { "force-stop": "{role}" } }),
    ).toThrow(/role/);
  });

  it("refuses an unknown field in the section itself", () => {
    expect(() => parseProtocolConfig({ ...base, notifications: { chatId: "42" } })).toThrow();
  });
});
