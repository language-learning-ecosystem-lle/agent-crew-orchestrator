/**
 * THE SEAM, END TO END — the test thread `002-courier-mute` asked for.
 *
 * `index.test.ts` beside this one tests the transport with `fetch` handed to it; the
 * core's `transport.test.ts` tests the loader with a module handed to it. Between the
 * two there is a path neither of them walks, and it is the path the live courier
 * actually takes: THE CORE RESOLVES A BARE PACKAGE NAME, builds the transport through
 * the contract (which passes no `fetch`, so the platform's own is used), and the
 * rendered text arrives at the wire. Every part of that was green while the daemon
 * was mute — the name did not resolve, because the package was not declared anywhere
 * a resolver would look.
 *
 * IT LIVES IN THIS PACKAGE AND NOT IN THE CORE for the reason the seam exists at all:
 * the claim is "I am loadable by my own name", and it is this package's claim to make.
 * The core must not learn a vendor's name to test itself.
 *
 * THE DOUBLE IS AT THE DELIVERY BOUNDARY (the network), not at the module boundary —
 * a double at the module boundary is exactly what hid the defect.
 */
import { loadTransport } from "agent-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { CHAT_VAR, TOKEN_VAR } from "./index.js";

const SPECIFIER = "transport-telegram";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the transport loaded by name, as the notifier loads it", () => {
  it("resolves by bare name and the event reaches the wire", async () => {
    const seen: { url: string; body: string }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: String(init?.body) });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof globalThis.fetch;

    // Exactly the call `notify` makes: the specifier as it stands in the config, and
    // the two fields of the contract — nothing else crosses the seam.
    const transport = await loadTransport(SPECIFIER, {
      options: {},
      secrets: { [TOKEN_VAR]: "123456:AAsecret-token", [CHAT_VAR]: "42" },
    });
    const outcome = await transport.send("⏳ твой ход: 002-courier-mute");

    expect(outcome.state).toBe("sent");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("api.telegram.org");
    // The text arrives verbatim — the transport renders nothing of its own.
    expect(new URLSearchParams(seen[0]?.body ?? "").get("text")).toBe(
      "⏳ твой ход: 002-courier-mute",
    );
    expect(new URLSearchParams(seen[0]?.body ?? "").get("chat_id")).toBe("42");
  });

  it("without credentials the same load answers UNCONFIGURED and touches no network", async () => {
    globalThis.fetch = (() => {
      throw new Error("the transport must not reach the network without credentials");
    }) as unknown as typeof globalThis.fetch;

    const transport = await loadTransport(SPECIFIER, { options: {}, secrets: {} });
    const outcome = await transport.send("a probe");

    expect(outcome.state).toBe("unconfigured");
  });
});
