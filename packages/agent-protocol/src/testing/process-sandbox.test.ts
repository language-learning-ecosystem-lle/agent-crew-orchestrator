/**
 * The sandbox is the thing every process test trusts to keep the developer's machine
 * config out of a launch, so the two ways it could fail silently are pinned here: it
 * could let an ambient `XDG_CONFIG_HOME` through, and `extra` could be overwritten by
 * the ambient environment instead of overwriting it.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LAUNCH_ENV } from "../orchestrator/launch.js";
import { BOX_URL_KEY, CIRCUIT_URL_KEY } from "../orchestrator/watchdog.js";
import { configHome, configHomeInside, sandbox } from "./process-sandbox.js";

/** Sets a variable for the body and puts the ambient value back, absent or not. */
const withAmbient = (name: string, value: string, body: () => void): void => {
  const ambient = process.env[name];
  process.env[name] = value;
  try {
    body();
  } finally {
    if (ambient === undefined) delete process.env[name];
    else process.env[name] = ambient;
  }
};

describe("the config home of a process test (R14)", () => {
  it("replaces an ambient XDG_CONFIG_HOME rather than deferring to it", () => {
    const ambient = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/the/developers/config";
    try {
      expect(sandbox("/the/tests/home").XDG_CONFIG_HOME).toBe("/the/tests/home");
    } finally {
      if (ambient === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = ambient;
    }
  });

  it("carries the ambient environment through — a launch still finds PATH", () => {
    expect(sandbox("/home").PATH).toBe(process.env.PATH);
  });

  it("extra wins over the ambient environment — a test that says more keeps saying it", () => {
    expect(sandbox("/home", { PATH: "/only/here" }).PATH).toBe("/only/here");
  });

  // The launch channel is the supervisor's, so on the box that runs the circuit every
  // one of its variables is ambient and on a runner none of them is. A sandbox that let
  // them through would hand a spawned CLI the provenance of the session running the
  // suite — which is what happened on 2026-08-19: three cases green on the box and red
  // on the runner, at the door that requires `--worker`.
  it("drops every variable of the launch channel — a suite raised by the circuit is not a session", () => {
    for (const name of Object.values(LAUNCH_ENV)) {
      withAmbient(name, "the ambient session", () => {
        expect(sandbox("/home")[name]).toBeUndefined();
      });
    }
  });

  it("a test that is ABOUT the launch channel still passes the value through extra", () => {
    withAmbient(LAUNCH_ENV.worker, "the ambient session", () => {
      expect(sandbox("/home", { [LAUNCH_ENV.worker]: "claude-code" })[LAUNCH_ENV.worker]).toBe(
        "claude-code",
      );
    });
  });

  // The monitors of the box (thread 071, measured 2026-09-02): the secrets file is merged
  // OVER the environment, so a key the file leaves out is answered by the box — and the box
  // that runs the circuit names its daemon's own monitor standingly. The suffixed form is
  // the one that was measured red; the bare one and the box's cron key go the same way,
  // because all three are read by `resolveWatchdog` off the same merged map.
  it("drops the monitors of the box — a spawned daemon beats the test's server or nothing", () => {
    for (const name of [BOX_URL_KEY, CIRCUIT_URL_KEY, `${CIRCUIT_URL_KEY}_HETZNER`]) {
      withAmbient(name, "https://the.box/ping/live", () => {
        expect(sandbox("/home")[name]).toBeUndefined();
      });
    }
  });

  it("a test that is ABOUT a monitor still passes it through extra", () => {
    withAmbient(`${CIRCUIT_URL_KEY}_HETZNER`, "https://the.box/ping/live", () => {
      const env = sandbox("/home", { [`${CIRCUIT_URL_KEY}_HETZNER`]: "http://127.0.0.1:1/ping" });
      expect(env[`${CIRCUIT_URL_KEY}_HETZNER`]).toBe("http://127.0.0.1:1/ping");
    });
  });

  it("a name that only LOOKS like a monitor is left alone — the prefix is not a substring", () => {
    withAmbient(`${CIRCUIT_URL_KEY}S_OWN`, "not a monitor", () => {
      expect(sandbox("/home")[`${CIRCUIT_URL_KEY}S_OWN`]).toBe("not a monitor");
    });
  });

  it("the two layouts name different homes, and both stay inside the test's own base", () => {
    expect(configHome("/tmp/base/work")).toBe(join("/tmp/base", "work-xdg"));
    expect(configHomeInside("/tmp/checkout")).toBe(join("/tmp/checkout", "xdg"));
  });

  it("a checkout that IS an mkdtemp root gets a home of its own, not one shared by the box", () => {
    // The defect of 2026-08-02: half the callers pass `mkdtempSync(join(tmpdir(), …))`
    // straight in, and a fixed sibling name put every one of them on `<tmpdir>/xdg` —
    // shared by every run and by every user of the machine (the self-hosted runner owns
    // that directory here, and the operator's runs died with EACCES on it).
    expect(configHome("/tmp/agent-protocol-check-a1b2")).toBe("/tmp/agent-protocol-check-a1b2-xdg");
    expect(configHome("/tmp/agent-protocol-check-a1b2")).not.toBe(
      configHome("/tmp/agent-protocol-check-c3d4"),
    );
  });

  it("two checkouts of the same run never share a home, whatever the layout", () => {
    const homes = [
      configHome("/tmp/agent-protocol-x-1/work"),
      configHome("/tmp/agent-protocol-x-2/work"),
      configHome("/tmp/agent-protocol-x-3"),
      configHomeInside("/tmp/agent-protocol-x-4"),
    ];
    expect(new Set(homes).size).toBe(homes.length);
  });
});
