import { describe, expect, it } from "vitest";

import {
  BEAT_BUDGET_MS,
  BEAT_TIMEOUT_MS,
  type BeatOutcome,
  BOX_URL_KEY,
  beat,
  beatBudgetFor,
  CIRCUIT_URL_KEY,
  circuitKeyOf,
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
    expect(state).toEqual({ kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY });
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
    ).toEqual({ kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY });
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

/**
 * ONE FILE, TWO CIRCUITS (curator's statement of work of 2026-08-21).
 *
 * Every case here is about the same defect said twice: two daemons on one monitor look
 * exactly like one healthy daemon. The unit's whole job is that no configuration reaches
 * that state QUIETLY — either the right key is read, or the state is refused with the name
 * of the key that is missing. The seam of it (two real processes, two real paths) is in
 * `daemon.watchdog.process.test.ts`; what a unit can hold is the policy.
 */
describe("resolveWatchdog · one secrets file, several instances", () => {
  const URL_OF_LLE = "https://hc.example/ping/lle-uuid";
  const SUFFIXED = `${CIRCUIT_URL_KEY}_HETZNER`;
  const FILE = "/home/op/.config/agent-protocol/secrets.env";

  it("normalises the instance name into the key's suffix, UPPER_SNAKE and '-' → '_'", () => {
    expect(circuitKeyOf("lle-hetzner")).toEqual({
      kind: "key",
      key: `${CIRCUIT_URL_KEY}_LLE_HETZNER`,
    });
    expect(circuitKeyOf("hetzner")).toEqual({ kind: "key", key: SUFFIXED });
  });

  it("a NAMED instance beats the monitor of its own key", () => {
    const state = resolveWatchdog({
      secrets: { [SUFFIXED]: URL_OF_CIRCUIT },
      names: [SUFFIXED],
      source: FILE,
      instance: "hetzner",
    });
    expect(state).toEqual({ kind: "on", url: URL_OF_CIRCUIT, key: SUFFIXED });
    expect(describeWatchdog(state)).toContain(SUFFIXED);
    expect(describeWatchdog(state)).not.toContain(URL_OF_CIRCUIT);
  });

  it("a named instance with ONLY the bare key is OFF, and the reason names the key it wants", () => {
    const state = resolveWatchdog({
      secrets: { [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT },
      names: [CIRCUIT_URL_KEY],
      source: FILE,
      instance: "hetzner",
    });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    // Not a fallback that failed: this IS the collision, and it is said by name.
    expect(state.reason).toContain(SUFFIXED);
    expect(state.reason).toContain("hetzner");
    expect(state.reason).not.toContain(URL_OF_CIRCUIT);
  });

  it("an UNNAMED box goes on reading the bare key, exactly as before", () => {
    // The guard against the regression that would matter most: a one-circuit box must not
    // notice this change at all.
    for (const instance of [undefined, null]) {
      expect(
        resolveWatchdog({
          secrets: { [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT },
          names: [CIRCUIT_URL_KEY],
          source: FILE,
          ...(instance === undefined ? {} : { instance }),
        }),
      ).toEqual({ kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY });
    }
  });

  it("with BOTH keys the suffixed one wins and the bare one is named as ignored", () => {
    const state = resolveWatchdog({
      secrets: { [SUFFIXED]: URL_OF_CIRCUIT, [CIRCUIT_URL_KEY]: URL_OF_LLE },
      names: [SUFFIXED, CIRCUIT_URL_KEY],
      source: FILE,
      instance: "hetzner",
    });
    expect(state.kind).toBe("on");
    if (state.kind !== "on") throw new Error("unreachable");
    expect(state.url).toBe(URL_OF_CIRCUIT);
    expect(state.key).toBe(SUFFIXED);
    expect(describeWatchdog(state)).toContain("IGNORED");
    expect(describeWatchdog(state)).toContain(CIRCUIT_URL_KEY);
  });

  it("the migration order is legitimate: the bare key may hold the SAME url and is not refused", () => {
    // The keys are laid down BEFORE the restart, so for a while the bare key holds this
    // instance's own url for the daemon that is still running the old code. Refusing that
    // would forbid the only migration with no window of silence.
    const state = resolveWatchdog({
      secrets: { [SUFFIXED]: URL_OF_CIRCUIT, [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT },
      names: [SUFFIXED, CIRCUIT_URL_KEY],
      source: FILE,
      instance: "hetzner",
    });
    expect(state.kind).toBe("on");
    if (state.kind !== "on") throw new Error("unreachable");
    expect(state.key).toBe(SUFFIXED);
  });

  it("REFUSES a value that another key of the same file already holds, by both NAMES", () => {
    const other = `${CIRCUIT_URL_KEY}_LLE_HETZNER`;
    const state = resolveWatchdog({
      secrets: { [SUFFIXED]: URL_OF_CIRCUIT, [other]: URL_OF_CIRCUIT },
      names: [SUFFIXED, other],
      source: FILE,
      instance: "hetzner",
    });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    expect(state.reason).toContain(SUFFIXED);
    expect(state.reason).toContain(other);
    // Two names and not one value: the url is a credential even inside a refusal.
    expect(state.reason).not.toContain(URL_OF_CIRCUIT);
  });

  it("the duplicate refusal is scoped to the FILE, not to the environment it was merged into", () => {
    // `loadSecrets` hands over the process environment with the file laid on top; an
    // ambient variable carrying the same value is not a second sender.
    const state = resolveWatchdog({
      secrets: { [SUFFIXED]: URL_OF_CIRCUIT, SOME_AMBIENT_COPY: URL_OF_CIRCUIT },
      names: [SUFFIXED],
      source: FILE,
      instance: "hetzner",
    });
    expect(state).toEqual({ kind: "on", url: URL_OF_CIRCUIT, key: SUFFIXED });
  });

  it("an instance name that is not a legal key suffix is REFUSED, never mangled into one", () => {
    const bad = circuitKeyOf("lle.hetzner");
    expect(bad.kind).toBe("bad");
    const state = resolveWatchdog({
      secrets: { [CIRCUIT_URL_KEY]: URL_OF_CIRCUIT },
      names: [CIRCUIT_URL_KEY],
      source: FILE,
      instance: "lle.hetzner",
    });
    expect(state.kind).toBe("off");
    if (state.kind !== "off") throw new Error("unreachable");
    expect(state.reason).toContain("lle.hetzner");
    expect(describeWatchdog(state)).toContain("circuit watchdog OFF");
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
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
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
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      retryPauseMs: 0,
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
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      retryPauseMs: 0,
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
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      timeoutMs: 10,
      retryPauseMs: 0,
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
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      retryPauseMs: 0,
    });
    beacon.start();
    await beacon.settle();
    expect(notes[0]).not.toContain(URL_OF_CIRCUIT);
    expect(notes[0]).toContain("names the url and is not shown");
  });
});

/**
 * THE FLAP (thread `057-circuit-ping-flaps`, measured 2026-08-30): one 5 s attempt with no
 * retry, a tick that blocks its own event loop with synchronous git, and 182 alternating
 * lines in one log — every one of them a false alarm about a healthy box.
 *
 * These cases are the "Проверяемость" section of the statement of work, word for word: an
 * answer slower than one attempt but inside the beat as a whole is a DELIVERY and prints
 * NOTHING, and a monitor that never answers at all still prints — ONE line. The threshold
 * moves; the class does not.
 */
describe("the beat retries — a slow answer is not a dead monitor", () => {
  it("counts a delivery when the FIRST attempt times out and the second answers", async () => {
    const notes: string[] = [];
    let call = 0;
    const http = recorder((_url, signal) => {
      call += 1;
      // The first attempt is the blocked tick: nothing comes back until its abort fires.
      if (call === 1)
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      return Promise.resolve({ ok: true, status: 204 });
    });
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      timeoutMs: 20,
      retryPauseMs: 0,
    });
    beacon.start();
    await beacon.settle();
    expect(http.calls).toHaveLength(2);
    // The whole of the repair: no line at all. Before this, the tick above was an alarm.
    expect(notes).toEqual([]);
  });

  it("still says it — ONCE — when no attempt is answered, and names how many were spent", async () => {
    const notes: string[] = [];
    const http = recorder(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const beacon = watchdogBeacon({
      state: { kind: "on", url: URL_OF_CIRCUIT, key: CIRCUIT_URL_KEY },
      fetch: http.fetch,
      note: (line) => notes.push(line),
      timeoutMs: 20,
      retryPauseMs: 0,
    });
    beacon.start();
    await beacon.settle();
    // Silence is not bought with silence: the real failure keeps its line...
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("3 attempts");
    // ...and the tick after it does not repeat it.
    beacon.start();
    await beacon.settle();
    expect(notes).toHaveLength(1);
    expect(http.calls).toHaveLength(6);
  });

  it("spends no more than the budget it was given", async () => {
    const http = recorder(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const started = Date.now();
    const outcome = await beat({
      url: URL_OF_CIRCUIT,
      fetch: http.fetch,
      timeoutMs: 60,
      retryPauseMs: 10,
      budgetMs: 100,
    });
    expect(Date.now() - started).toBeLessThan(300);
    // 60ms, a 10ms pause, then 30ms of budget left — a second attempt fits, a third does not.
    expect(http.calls).toHaveLength(2);
    if (outcome.kind !== "refused") throw new Error("unreachable");
    expect(outcome.attempts).toBe(2);
  });

  it("clips the budget to the tick — a box that ticks faster than one attempt does not retry", () => {
    expect(beatBudgetFor(30_000)).toBe(BEAT_BUDGET_MS);
    expect(beatBudgetFor(15_000)).toBe(15_000);
    // Below one attempt the floor holds: a shorter budget could only clip an attempt to a
    // number the monitor was never given a chance to answer in.
    expect(beatBudgetFor(5_000)).toBe(BEAT_TIMEOUT_MS);
  });
});

describe("describeBeat", () => {
  const good: BeatOutcome = { kind: "beat", status: 200, attempts: 1 };
  const bad: BeatOutcome = {
    kind: "refused",
    detail: "the monitor answered 503",
    attempts: 3,
    elapsedMs: 1_200,
    starved: false,
  };

  it("says nothing on a routine success", () => {
    expect(describeBeat(good)).toBeUndefined();
    expect(describeBeat(good, good)).toBeUndefined();
  });

  it("says a failure once, not every tick", () => {
    expect(describeBeat(bad)).toBeDefined();
    expect(describeBeat(bad, bad)).toBeUndefined();
    expect(
      describeBeat(bad, {
        kind: "refused",
        detail: "no answer in 10s",
        attempts: 2,
        elapsedMs: 21_000,
        starved: false,
      }),
    ).toBeDefined();
  });

  /**
   * THE COUNTS ARE PRINTED AND NOT COMPARED. A beat that fails the same way with a different
   * number of attempts is the SAME outage, and comparing over the moving parts would put a
   * line on the stream every tick of it — the noise `describeBeat` exists to refuse.
   */
  it("does not repeat itself when only the attempts and the clock moved", () => {
    expect(
      describeBeat({ ...bad, attempts: 2, elapsedMs: 9_000 }, { ...bad, attempts: 3 }),
    ).toBeUndefined();
  });

  /**
   * The `057-circuit-ping-flaps` class, named IN THE LINE: a beat that outran its own
   * timeouts on the wall clock was starved by this process, and the operator is told to look
   * at the tick rather than at the monitor.
   */
  it("blames the process, not the monitor, when the beat outran its own timeouts", () => {
    const line = describeBeat({ ...bad, detail: "no answer in 10s", starved: true });
    expect(line).toContain("THIS PROCESS");
    expect(line).toContain("synchronously");
    expect(describeBeat(bad)).not.toContain("THIS PROCESS");
  });

  it("says the recovery — an outage nobody saw end is an outage nobody believes", () => {
    expect(describeBeat(good, bad)).toContain("answers again");
  });
});
