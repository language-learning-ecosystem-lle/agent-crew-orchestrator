/**
 * The transport seam. The core never sees a vendor, so what is testable here is the
 * contract itself: a module that does not honour it is refused BY NAME, and a
 * refusal says which config line asked for it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadTransport, TRANSPORT_EXPORT, TransportError, transportFrom } from "./transport.js";

const input = { options: { a: "1" }, secrets: { S: "x" } };

/** This repository's own config — the one that names the courier of this circuit. */
const CONFIG = fileURLToPath(new URL("../../../../agent-protocol.json", import.meta.url));

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

  /**
   * THE COURIER OF THIS REPOSITORY LOADS — the regression for thread `002-courier-mute`.
   *
   * A name in the config that nothing in the workspace can resolve is not a config
   * defect and not a code defect: the module is there, the name is right, and the
   * import still fails because nobody DECLARED it as a dependency. That is invisible
   * to every test that hands the loader a module object or an absolute path (both
   * resolve without a dependency), and it cost this circuit its whole notification
   * channel — "your turn" silent, john's escalation button silent, `stalled` silent.
   *
   * THE VENDOR IS NOT NAMED HERE, deliberately: the specifier is read from the config,
   * exactly as the notifier reads it. The core stays blind to who the courier is and
   * the claim stays "whatever this repository names, this repository can load".
   */
  it("loads the transport THIS repository names in its config — by name, from the workspace", async () => {
    const config = JSON.parse(readFileSync(CONFIG, "utf8")) as {
      notifications?: { transport?: { module?: string; options?: Record<string, string> } };
    };
    const specifier = config.notifications?.transport?.module;
    expect(specifier, `${CONFIG} declares no notifications.transport.module`).toBeTypeOf("string");

    const transport = await loadTransport(specifier as string, {
      options: config.notifications?.transport?.options ?? {},
      // No secrets: a transport must answer without credentials (`unconfigured`),
      // and an empty map is what keeps this test off the network.
      secrets: {},
    });

    expect(typeof transport.send).toBe("function");
    const outcome = await transport.send("a probe from the test suite");
    expect(outcome.state).toBe("unconfigured");
    expect(outcome.detail).not.toBe("");
  });
});
