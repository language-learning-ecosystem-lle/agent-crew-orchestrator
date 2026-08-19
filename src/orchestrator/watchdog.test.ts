import { describe, expect, it } from "vitest";

import {
  type BeatOutcome,
  BOX_URL_KEY,
  CIRCUIT_URL_KEY,
  describeBeat,
  describeWatchdog,
  type FetchLike,
  resolveWatchdog,
  watchdogBeacon,
} from "./watchdog.js";

const URL_OF_CIRCUIT = "https://hc.example/ping/circuit-uuid";
const URL_OF_BOX = "https://hc.example/ping/box-uuid";

/** A fetch that records its calls and answers however the test says. */
const recorder = (
  answer: (url: string, signal: AbortSignal) => Promise<{ ok: boolean; status: number }>,
): { readonly fetch: FetchLike; readonly calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push(url);
      return answer(url, init.signal);
    },
  };
};

const ok = (): ReturnType<FetchLike> => Promise.resolve({ ok: true, status: 200 });

describe("resolveWatchdog", () => {
  it("takes the url out of the secrets and says nothing about its value", () => {
    const state = resolveWatchdog({
      secrets: { [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT },
      source: "/home/op/.config/agent-protocol/secrets.env",
    });
    expect(state).toEqual({ kind: "on", url: URL_OF_CIRCUIT });
    expect(describeWatchdog(state)).toContain(CIRCUIT_URL_KEY);
    expect(describeWatchdog(state)).not.toContain(URL_OF_CIRCUIT);
  });

  it("is OFF when the key is absent, and the reason names the key and the file", () => {
    const state = resolveWatchdog({ secrets: {}, source: "/etc/secrets.env" });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    expect(state.reason).toContain(CIRCUIT_URL_KEY);
    expect(state.reason).toContain("/etc/secrets.env");
  });

  it("names the environment when no secrets file was given at all", () => {
    const state = resolveWatchdog({ secrets: {} });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    expect(state.reason).toContain("no secrets file");
  });

  it("REFUSES the box's own url — one monitor beaten by two senders never goes silent", () => {
    const state = resolveWatchdog({
      secrets: { [CIRCUIT_URL_KEY]: URL_OF_BOX, [BOX_URL_KEY]: URL_OF_BOX },
      source: "/etc/secrets.env",
    });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    expect(state.reason).toContain(BOX_URL_KEY);
    expect(state.reason).toContain("second monitor");
  });

  it("lets the two keys coexist as long as they are different monitors", () => {
    expect(
      resolveWatchdog({
        secrets: { [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT, [BOX_URL_KEY]: URL_OF_BOX },
      }),
    ).toEqual({ kind: "on", url: URL_OF_CIRCUIT });
  });

  it("refuses a value that is not a url, and a url that is not http, BY NAME", () => {
    const notAUrl = resolveWatchdog({ secrets: { [CIRCUIT_URL_KEY]: "paste-me-here" } });
    expect(notAUrl.kind).toBe("off");
    if (notAUrl.kind !== "off") throw new Error("unreachable");
    expect(notAUrl.reason).toContain("not a URL");
    // The value is a credential: even while refusing it, it is not echoed.
    expect(notAUrl.reason).not.toContain("paste-me-here");

    const wrongScheme = resolveWatchdog({ secrets: { [CIRCUIT_URL_KEY]: "ftp://hc.example/x" } });
    expect(wrongScheme.kind).toBe("off");
    if (wrongScheme.kind !== "off") throw new Error("unreachable");
    expect(wrongScheme.reason).toContain("ftp:");
  });

  it("treats a blank value as absence, not as a defect", () => {
    const state = resolveWatchdog({ secrets: { [CIRCUIT_URL_KEY]: "   " } });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    expect(state.reason).toContain(`no '${CIRCUIT_URL_KEY}'`);
  });
});

describe("watchdogBeacon", () => {
  it("pings EXACTLY ONCE per tick when the key is there", async () => {
    const http = recorder(ok);
    const beacon = watchdogBeacon({
      state: resolveWatchdog({ secrets: { [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT } }),
      fetch: http.fetch,
      note: () => {},
    });
    beacon.start();
    await beacon.settle();
    beacon.start();
    await beacon.settle();
    expect(http.calls).toEqual([URL_OF_CIRCUIT, URL_OF_CIRCUIT]);
  });

  it("does not ping at all when the key is absent, and settling is still a no-op", async () => {
    const http = recorder(ok);
    const notes: string[] = [];
    const beacon = watchdogBeacon({
      state: resolveWatchdog({ secrets: {} }),
      fetch: http.fetch,
      note: (line) => notes.push(line),
    });
    beacon.start();
    await expect(beacon.settle()).resolves.toBeUndefined();
    expect(http.calls).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("does not double a beat that is still in flight", async () => {
    let release: (() => void) | undefined;
    const http = recorder(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, status: 200 }))),
    );
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT },
      fetch: http.fetch,
      note: () => {},
    });
    beacon.start();
    beacon.start();
    expect(http.calls).toHaveLength(1);
    release?.();
    await beacon.settle();
  });

  it("SURVIVES a dead network — settling resolves and the line names the failure", async () => {
    const notes: string[] = [];
    const http = recorder(() => Promise.reject(new Error("getaddrinfo ENOTFOUND hc.example")));
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT },
      fetch: http.fetch,
      note: (line) => notes.push(line),
    });
    beacon.start();
    await expect(beacon.settle()).resolves.toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("ENOTFOUND");
    expect(notes[0]).toContain("keeps working");
  });

  it("SURVIVES a 5xx from the monitor and says which one", async () => {
    const notes: string[] = [];
    const http = recorder(() => Promise.resolve({ ok: false, status: 503 }));
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT },
      fetch: http.fetch,
      note: (line) => notes.push(line),
    });
    beacon.start();
    await beacon.settle();
    expect(notes[0]).toContain("503");
  });

  it("SURVIVES a monitor that never answers — the beat is abandoned on its own timeout", async () => {
    const notes: string[] = [];
    const http = recorder(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      timeoutMs: 10,
    });
    beacon.start();
    await beacon.settle();
    expect(notes[0]).toContain("no answer in 0.01s");
  });

  it("never leaks the url into the line, even when the failure names it", async () => {
    const notes: string[] = [];
    const http = recorder(() =>
      Promise.reject(new Error(`connect ECONNREFUSED ${URL_OF_CIRCUIT}`)),
    );
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT },
      fetch: http.fetch,
      note: (line) => notes.push(line),
    });
    beacon.start();
    await beacon.settle();
    expect(notes[0]).not.toContain(URL_OF_CIRCUIT);
    expect(notes[0]).toContain("names the url and is not shown");
  });
});

describe("describeBeat", () => {
  const good: BeatOutcome = { kind: "beat", status: 200 };
  const bad: BeatOutcome = { kind: "refused", detail: "the monitor answered 503" };

  it("says nothing on a routine success", () => {
    expect(describeBeat(good)).toBeUndefined();
    expect(describeBeat(good, good)).toBeUndefined();
  });

  it("says a failure once, not every tick", () => {
    expect(describeBeat(bad)).toBeDefined();
    expect(describeBeat(bad, bad)).toBeUndefined();
    expect(describeBeat(bad, { kind: "refused", detail: "no answer in 5s" })).toBeDefined();
  });

  it("says the recovery — an outage nobody saw end is an outage nobody believes", () => {
    expect(describeBeat(good, bad)).toContain("answers again");
  });
});
