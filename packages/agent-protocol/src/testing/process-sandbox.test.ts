/**
 * The sandbox is the thing every process test trusts to keep the developer's machine
 * config out of a launch, so the two ways it could fail silently are pinned here: it
 * could let an ambient `XDG_CONFIG_HOME` through, and `extra` could be overwritten by
 * the ambient environment instead of overwriting it.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { configHome, configHomeInside, sandbox } from "./process-sandbox.js";

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
