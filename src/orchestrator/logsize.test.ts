import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOG_MAX_BYTES,
  epochBanner,
  planLogRotation,
  rotateDaemonLog,
  writeEpochBanner,
} from "./logsize.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "agent-protocol-logsize-"));

describe("the daemon log is bounded at the start", () => {
  it("a log under the cap is left alone — nothing is said and nothing is moved", () => {
    expect(planLogRotation({ path: "/l/daemon.log", size: 10, cap: 100 })).toEqual({
      rotate: false,
      rotated: "/l/daemon.log.1",
    });
  });

  it("the first start of a box has no file to rotate", () => {
    expect(planLogRotation({ path: "/l/daemon.log", size: undefined }).rotate).toBe(false);
  });

  it("a log at or over the cap moves aside, into the ONE generation that is kept", () => {
    const plan = planLogRotation({ path: "/l/daemon.log", size: 100, cap: 100 });
    expect(plan.rotate).toBe(true);
    expect(plan.rotated).toBe("/l/daemon.log.1");
    expect(plan.said).toContain("rotated");
  });

  it("the default cap leaves the footprint bounded by two generations", () => {
    expect(DEFAULT_LOG_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("rotation on disk", () => {
  it("moves the fat log to '.1' and leaves the live path free", () => {
    const home = dir();
    const log = join(home, "daemon.log");
    writeFileSync(log, "x".repeat(200), "utf8");

    const said = rotateDaemonLog({ path: log, cap: 100 });

    expect(said).toContain(`${log}.1`);
    expect(existsSync(log)).toBe(false);
    expect(readFileSync(`${log}.1`, "utf8")).toHaveLength(200);
  });

  it("keeps ONE generation: the second rotation replaces the first, it does not pile up", () => {
    const home = dir();
    const log = join(home, "daemon.log");
    writeFileSync(log, "old".repeat(100), "utf8");
    rotateDaemonLog({ path: log, cap: 100 });
    writeFileSync(log, "new".repeat(100), "utf8");

    rotateDaemonLog({ path: log, cap: 100 });

    expect(readFileSync(`${log}.1`, "utf8").startsWith("new")).toBe(true);
    expect(existsSync(`${log}.2`)).toBe(false);
  });

  it("an absent log rotates nothing and says nothing", () => {
    expect(rotateDaemonLog({ path: join(dir(), "daemon.log") })).toBeUndefined();
  });
});

describe("the epochs stay legible", () => {
  it("the banner names the moment, the pid and the mode", () => {
    const line = epochBanner({
      pid: 42,
      startedAt: "2026-07-31T10:00:00.000Z",
      mode: "foreground",
    });
    expect(line).toContain("daemon epoch");
    expect(line).toContain("pid 42");
    expect(line).toContain("foreground");
    expect(line.startsWith("\n")).toBe(true);
  });

  it("it is appended, so the previous daemon's lines survive under it", () => {
    const home = dir();
    const log = join(home, "daemon.log");
    writeFileSync(log, "the daemon before\n", "utf8");

    writeEpochBanner({
      path: log,
      pid: 7,
      startedAt: "2026-07-31T10:00:00.000Z",
      mode: "background",
    });

    const text = readFileSync(log, "utf8");
    expect(text).toContain("the daemon before");
    expect(text).toContain("pid 7");
  });
});
