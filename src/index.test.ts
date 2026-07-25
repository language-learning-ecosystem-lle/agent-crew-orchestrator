/**
 * The Telegram transport. Three things are worth pinning: an unconfigured machine is
 * a STATE and not a failure, a delivery is one request whose body carries the text
 * verbatim, and NOTHING that leaves this module carries the token — the last one is
 * the reason the bash predecessor printed only an HTTP code, and a rule that is not
 * a mechanism is not a rule.
 */
import { describe, expect, it } from "vitest";

import { CHAT_VAR, createTransport, redactSecrets, TOKEN_VAR } from "./index.js";

const SECRETS = { [TOKEN_VAR]: "123456:AAsecret-token", [CHAT_VAR]: "42" };

const ok = (): Response => new Response('{"ok":true}', { status: 200 });

describe("the telegram transport", () => {
  it("without credentials it is UNCONFIGURED, and it names the variables it lacks", async () => {
    const transport = createTransport({ options: {}, secrets: {}, fetch: async () => ok() });

    const outcome = await transport.send("hi");

    expect(outcome.state).toBe("unconfigured");
    expect(outcome.detail).toContain(TOKEN_VAR);
    expect(outcome.detail).toContain(CHAT_VAR);
  });

  it("sends the text as it was given, to the chat it was told", async () => {
    let seen: { url: string; body: string } | undefined;
    const transport = createTransport({
      options: {},
      secrets: SECRETS,
      fetch: async (url, init) => {
        seen = { url: String(url), body: String(init?.body) };
        return ok();
      },
    });

    const outcome = await transport.send("⏳ your turn: 016-x");

    expect(outcome.state).toBe("sent");
    expect(seen?.url).toContain(`/bot${SECRETS[TOKEN_VAR]}/sendMessage`);
    expect(new URLSearchParams(seen?.body ?? "").get("text")).toBe("⏳ your turn: 016-x");
    expect(new URLSearchParams(seen?.body ?? "").get("chat_id")).toBe("42");
  });

  it("a rejected request is a FAILURE with the status, and never with the token", async () => {
    const transport = createTransport({
      options: {},
      secrets: SECRETS,
      fetch: async () => new Response("Bad Request: chat not found", { status: 400 }),
    });

    const outcome = await transport.send("hi");

    expect(outcome.state).toBe("failed");
    expect(outcome.detail).toContain("400");
    expect(outcome.detail).not.toContain(SECRETS[TOKEN_VAR]);
  });

  it("a network error is redacted before it is reported — the URL carries the token", async () => {
    // This is the concrete leak: node's fetch puts the request URL into the message
    // of a connection error, and a cron log keeps it for ever.
    const transport = createTransport({
      options: {},
      secrets: SECRETS,
      fetch: async () => {
        throw new Error(
          `connect ECONNREFUSED https://api.telegram.org/bot${SECRETS[TOKEN_VAR]}/sendMessage`,
        );
      },
    });

    const outcome = await transport.send("hi");

    expect(outcome.state).toBe("failed");
    expect(outcome.detail).not.toContain("AAsecret-token");
    expect(outcome.detail).toContain("***");
  });

  it("redaction replaces every occurrence and ignores empty secrets", () => {
    expect(redactSecrets("a X b X", ["X", ""])).toBe("a *** b ***");
  });
});
