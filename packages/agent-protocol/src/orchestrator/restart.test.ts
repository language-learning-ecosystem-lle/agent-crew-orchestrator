import { describe, expect, it } from "vitest";

import {
  awaitDaemonExit,
  daemonArgvFor,
  daemonArgvPath,
  parseDaemonArgv,
  renderDaemonArgv,
  withoutRestartFlags,
} from "./restart.js";

describe("the argv the new daemon is raised with", () => {
  it("takes the flags of the stopped daemon when the state has them", () => {
    const chosen = daemonArgvFor({
      saved: ["--ref", "origin/main", "--max-runs", "2"],
      typed: ["--pull", "--wait", "60"],
    });
    expect(chosen).toEqual({
      argv: ["--ref", "origin/main", "--max-runs", "2"],
      source: "state",
    });
  });

  it("falls back to what was typed — without restart's own flags — when there is no state", () => {
    const chosen = daemonArgvFor({
      saved: undefined,
      typed: ["--pull", "--ref", "origin/main", "--wait", "900", "--max-runs", "2"],
    });
    expect(chosen).toEqual({ argv: ["--ref", "origin/main", "--max-runs", "2"], source: "typed" });
  });

  it("treats an empty saved argv as no answer, not as 'raise it with nothing'", () => {
    expect(daemonArgvFor({ saved: [], typed: ["--ref", "origin/main"] }).source).toBe("typed");
  });

  it("strips restart's own value flags together with their values", () => {
    expect(
      withoutRestartFlags([
        "--mode",
        "force",
        "--thread",
        "019-operator-ux",
        "--reason",
        "hung",
        "--by",
        "john",
        "--pull",
        "--ref",
        "origin/main",
      ]),
    ).toEqual(["--ref", "origin/main"]);
  });

  it("round-trips through the file beside the pid", () => {
    expect(daemonArgvPath("/s/daemon.pid")).toBe("/s/daemon.pid.args");
    const argv = ["--ref", "origin/main", "--effort", "high"];
    expect(parseDaemonArgv(renderDaemonArgv(argv))).toEqual(argv);
  });

  it("refuses to read anything that is not a list of strings", () => {
    expect(parseDaemonArgv("not json")).toBeUndefined();
    expect(parseDaemonArgv('{"ref":"origin/main"}')).toBeUndefined();
    expect(parseDaemonArgv("[1,2]")).toBeUndefined();
  });
});

describe("the wait for the old daemon to leave", () => {
  const clock = () => {
    let seconds = 0;
    return {
      now: () => seconds,
      sleep: async (ms: number) => {
        seconds += ms / 1000;
      },
    };
  };

  it("is over before it starts when no backgrounded daemon is running", async () => {
    expect(
      await awaitDaemonExit({
        pid: undefined,
        alive: () => true,
        sleep: async () => undefined,
        now: () => 0,
        waitSec: 10,
        pollSec: 1,
      }),
    ).toEqual({ kind: "absent" });
  });

  it("returns as soon as the pid is gone, with how long it took", async () => {
    const { now, sleep } = clock();
    const outcome = await awaitDaemonExit({
      pid: 4242,
      alive: () => now() < 12,
      sleep,
      now,
      waitSec: 600,
      pollSec: 5,
    });
    expect(outcome).toEqual({ kind: "gone", waitedSec: 15 });
  });

  it("gives up at the ceiling instead of waiting forever", async () => {
    const { now, sleep } = clock();
    const outcome = await awaitDaemonExit({
      pid: 4242,
      alive: () => true,
      sleep,
      now,
      waitSec: 30,
      pollSec: 5,
    });
    expect(outcome).toEqual({ kind: "timeout", waitedSec: 30 });
  });

  it("says it is still waiting once a minute — a silent wait reads as a hang", async () => {
    const { now, sleep } = clock();
    const said: number[] = [];
    await awaitDaemonExit({
      pid: 4242,
      alive: () => now() < 150,
      sleep,
      now,
      waitSec: 600,
      pollSec: 30,
      note: (waited) => said.push(waited),
    });
    expect(said).toEqual([60, 120]);
  });
});
