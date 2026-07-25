/**
 * The transport seam. The core never sees a vendor, so what is testable here is the
 * contract itself: a module that does not honour it is refused BY NAME, and a
 * refusal says which config line asked for it.
 */
import { describe, expect, it } from "vitest";

import { loadTransport, TRANSPORT_EXPORT, TransportError, transportFrom } from "./transport.js";

const input = { options: { a: "1" }, secrets: { S: "x" } };

describe("the transport contract", () => {
  it("builds a transport out of a module that exports the factory, passing options and secrets through", () => {
    const seen: unknown[] = [];
    const module = {
      [TRANSPORT_EXPORT]: (given: unknown) => {
        seen.push(given);
        return { send: async () => ({ state: "sent" as const, detail: "ok" }) };
      },
    };

    const transport = transportFrom(module, "transport-x", input);

    expect(seen).toEqual([input]);
    expect(typeof transport.send).toBe("function");
  });

  it("refuses a module without the factory, naming what is missing", () => {
    expect(() => transportFrom({ somethingElse: 1 }, "transport-x", input)).toThrow(TransportError);
    expect(() => transportFrom({}, "transport-x", input)).toThrow(/createTransport/);
  });

  it("a specifier that does not resolve names the config line that asked for it", async () => {
    // `ERR_MODULE_NOT_FOUND` on its own does not say who typed the name.
    await expect(loadTransport("no-such-transport-package", input)).rejects.toThrow(
      /notifications\.transport\.module/,
    );
  });
});
