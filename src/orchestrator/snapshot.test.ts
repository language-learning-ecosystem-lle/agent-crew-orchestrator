/**
 * The frame is a PURE function of the model, and that is the whole reason it can be
 * tested at all: the collector does IO in `cli.ts`, the judgements live here. What is
 * checked is what an operator is entitled to read off the frame — the three facts that
 * used to be nowhere (stop flag, force flag, a live daemon), the reason for the queue's
 * order, and the staleness mark, which must fail LOUDLY in the case it exists for: a
 * fetch that happened and did not land.
 *
 * The uncovered half is named rather than hidden: the redraw itself (raw writes, the
 * timer, `resize`) has no test — the same declared gap as `up`/`down`.
 */
import { describe, expect, it } from "vitest";

import type { HoldView } from "./hold.js";
import type { LeaseView } from "./lease.js";
import type { RankedCandidate } from "./priority.js";
import {
  type CircuitState,
  type OperatorFrame,
  renderCircuit,
  renderFrame,
  renderFreshness,
  renderQueue,
  renderQuota,
} from "./snapshot.js";

const NOW = new Date("2026-07-27T18:00:00Z");

const circuit = (over: Partial<CircuitState> = {}): CircuitState => ({
  launchesEnabled: true,
  stopFlag: false,
  forceFlag: false,
  pidFilePresent: false,
  ...over,
});

describe("renderCircuit", () => {
  it("names the gate, both flags and the daemon — the three facts status never showed", () => {
    const text = renderCircuit(circuit({ daemonPid: 4242, pidFilePresent: true }));
    expect(text).toContain("launches: enabled");
    expect(text).toContain("stop flag: absent");
    expect(text).toContain("force flag: absent");
    expect(text).toContain("daemon: pid 4242, alive");
  });

  it("a present stop flag says what it does and how it is cleared", () => {
    const text = renderCircuit(circuit({ stopFlag: true }));
    expect(text).toContain("stop flag: PRESENT");
    expect(text).toContain("orchestrator up");
  });

  it("distinguishes a stale pid file from a daemon that was never started", () => {
    expect(renderCircuit(circuit({ pidFilePresent: true }))).toContain("NOT RUNNING");
    expect(renderCircuit(circuit())).toContain("no pid file");
  });

  it("carries the reboot mode when it was asked for", () => {
    expect(renderCircuit(circuit({ reboot: "manual" }))).toContain("BY HAND");
  });
});

describe("renderQueue", () => {
  const candidate = (over: Partial<RankedCandidate> = {}): RankedCandidate => ({
    role: "dev-core",
    thread: "019-operator-ux",
    priority: "normal",
    ...over,
  });

  it("says why each candidate stands where it stands", () => {
    const text = renderQueue([
      candidate({ priority: "high" }),
      candidate({ thread: "020-zones", since: "2026-07-27T10:00:00Z" }),
    ]);
    expect(text).toContain("queue 1/2: dev-core×019-operator-ux — priority high");
    expect(text).toContain("waiting since 2026-07-27T10:00:00Z");
  });

  it("an empty queue is a statement, not empty output", () => {
    expect(renderQueue([])).toContain("nobody is waiting");
  });

  it("what was dropped while ranking is repeated in the panel, not swallowed", () => {
    expect(renderQueue([candidate()], ["019 — priority from an unauthorized role"])).toContain(
      "⚠ 019 — priority from an unauthorized role",
    );
  });
});

describe("renderFreshness", () => {
  it("a recent pull that landed is simply fresh", () => {
    const text = renderFreshness(
      { root: "/mail", fetchedAt: new Date("2026-07-27T17:59:30Z"), behind: 0 },
      NOW,
    );
    expect(text).toContain("pulled 30s ago");
    expect(text).not.toContain("⚠");
  });

  it("an old pull is marked, and the mark asks the question that explains it", () => {
    const text = renderFreshness(
      { root: "/mail", fetchedAt: new Date("2026-07-27T17:00:00Z"), behind: 0 },
      NOW,
    );
    expect(text).toContain("⚠ STALE");
    expect(text).toContain("is a daemon alive?");
  });

  it("A FETCH THAT DID NOT LAND is marked even though the pull is fresh", () => {
    // The case correction 5 exists for: `FETCH_HEAD` is seconds old, the ff-merge
    // failed (divergence, dirt, another branch), and the tree — hence the queue above
    // — is arbitrarily old. One fact alone would have called this frame fresh.
    const text = renderFreshness(
      { root: "/mail", fetchedAt: new Date("2026-07-27T17:59:55Z"), behind: 4 },
      NOW,
    );
    expect(text).toContain("pulled 5s ago");
    expect(text).toContain("4 commit(s) BEHIND");
  });

  it("an unreadable checkout is reported, never passed off as fresh", () => {
    const text = renderFreshness({ root: "/mail", problem: "not a git repository" }, NOW);
    expect(text).toContain("never pulled");
    expect(text).toContain("behind unknown");
    expect(text).toContain("not a git repository");
  });
});

describe("renderFrame", () => {
  const lease: LeaseView = {
    role: "dev-core",
    thread: "019-operator-ux",
    state: "running",
    attempt: 1,
    ceiling: 3,
    deadline: "2026-07-27T18:18:32Z",
    waitDeadline: null,
    reason: null,
    lastEvent: "lease-acquired",
    overdue: false,
    exhausted: false,
    launchable: false,
  };

  const hold: HoldView = {
    role: "curator",
    by: "john",
    taken: "2026-07-27T17:00:00Z",
    expires: "2026-07-27T18:00:00Z",
    active: true,
  };

  const frame: OperatorFrame = {
    now: NOW,
    leases: [lease],
    holds: [hold],
    circuit: circuit({ daemonPid: 7, pidFilePresent: true }),
    queue: [{ role: "dev-core", thread: "019-operator-ux", priority: "normal" }],
    queueNotes: [],
    digests: [],
    mail: { root: "/mail", fetchedAt: new Date("2026-07-27T17:59:50Z"), behind: 0 },
  };

  it("is the five panels in the order a watch is read", () => {
    const lines = renderFrame(frame).split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("dev-core")).toBeLessThan(at("held by john"));
    expect(at("held by john")).toBeLessThan(at("circuit:"));
    expect(at("circuit:")).toBeLessThan(at("queue:"));
    expect(at("queue:")).toBeLessThan(at("instances:"));
    expect(at("instances:")).toBeLessThan(at("mail on disk:"));
  });

  it("says out loud that nobody has published, instead of showing an empty panel", () => {
    expect(renderFrame(frame)).toContain("no digests published");
  });
});

/**
 * D-3 PART 2, curator's acceptance (в): the closed window is visible where a human
 * looks — not only on the stream of the tick that met it.
 */
describe("renderQuota — the shelf in the operator's frame", () => {
  const shelf = {
    window: "five_hour",
    until: "2026-07-29T21:40:00Z",
    since: "2026-07-29T16:40:00Z",
    stated: true,
    role: "dev-core",
  };

  it("says the window IS open when it is — an absent section teaches nothing", () => {
    expect(renderQuota([])).toContain("no window is closed");
  });

  it("names the window type and when it opens", () => {
    const text = renderQuota([shelf]);
    expect(text).toContain("five_hour");
    expect(text).toContain("2026-07-29T21:40:00Z");
  });

  it("marks a shelf whose time we invented, so it is not read as the vendor's", () => {
    expect(renderQuota([{ ...shelf, stated: false }])).toContain("short default shelf");
  });

  it("is a panel of the frame, above the queue", () => {
    const bare: OperatorFrame = {
      now: NOW,
      leases: [],
      holds: [],
      circuit: circuit({ pidFilePresent: false }),
      queue: [],
      queueNotes: [],
      digests: [],
      quota: [shelf],
      mail: { root: "/mail", fetchedAt: NOW, behind: 0 },
    };
    const lines = renderFrame(bare).split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("circuit:")).toBeLessThan(at("quota:"));
    expect(at("quota:")).toBeLessThan(at("queue:"));
  });
});
