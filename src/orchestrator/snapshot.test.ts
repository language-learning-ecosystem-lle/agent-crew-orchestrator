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
import { GH_OUTAGE_TICKS, type GhOutage, ghAlarmDue } from "./outage.js";
import type { RankedCandidate } from "./priority.js";
import {
  type CircuitState,
  type OperatorFrame,
  type Parallelism,
  renderCircuit,
  renderFrame,
  renderFreshness,
  renderMergeReady,
  renderParallelism,
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
    parallelism: { raisable: ["dev-core", "curator"], live: [lease], held: ["curator"] },
    circuit: circuit({ daemonPid: 7, pidFilePresent: true }),
    queue: [{ role: "dev-core", thread: "019-operator-ux", priority: "normal" }],
    queueNotes: [],
    digests: [],
    mail: { root: "/mail", fetchedAt: new Date("2026-07-27T17:59:50Z"), behind: 0 },
  };

  it("is the five panels in the order a watch is read", () => {
    const lines = renderFrame(frame).split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("dev-core")).toBeLessThan(at("parallelism:"));
    expect(at("parallelism:")).toBeLessThan(at("held by john"));
    expect(at("held by john")).toBeLessThan(at("circuit:"));
    expect(at("circuit:")).toBeLessThan(at("queue:"));
    expect(at("queue:")).toBeLessThan(at("instances:"));
    expect(at("instances:")).toBeLessThan(at("mail on disk:"));
  });

  it("says out loud that nobody has published, instead of showing an empty panel", () => {
    expect(renderFrame(frame)).toContain("no digests published");
  });

  // T-1 (thread 019): a thread waiting on a role the circuit never raises used to be
  // printed by `status` BESIDE the frame — so the observer, which draws the frame and
  // nothing else, would not have shown it at all. It is a fact of the very class the
  // frame exists for, and the frame is the one place both readers share.
  it("a resident wait stands in the frame, beside the queue it is deliberately not in", () => {
    const lines = renderFrame({
      ...frame,
      residents: {
        roles: ["dev-speech"],
        waits: [{ role: "dev-speech", thread: "030-tts" }],
      },
    }).split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("resident roles")).toBeGreaterThan(at("queue:"));
    expect(at("resident roles")).toBeLessThan(at("instances:"));
    // MARKED, not filtered (R23-1): the pair is named, with whose process answers for it.
    expect(lines.some((line) => line.includes("030-tts") && line.includes("dev-speech"))).toBe(
      true,
    );
  });

  it("a project with resident roles and nobody waiting still gets the answer, not silence", () => {
    expect(renderFrame({ ...frame, residents: { roles: ["dev-speech"], waits: [] } })).toContain(
      "no thread is waiting on any of them",
    );
  });

  /**
   * 023.2: the code the LIVE DAEMON loaded, when it is not the ref. The frame's second
   * silent-on-good-news section, and the fact that was missing on 2026-08-03 — a pair
   * standing behind a park the running process had no code to lift.
   */
  it("a daemon running stale code says so, beside the circuit it is a fact about", () => {
    const lines = renderFrame({
      ...frame,
      codeAge: {
        kind: "drift",
        drift: {
          vintage: {
            sha: "a830761a1c0ffee0000000000000000000000000",
            checkout: "/home/lle/projects/language-learning-ecosystem",
            startedAt: "2026-08-03T05:13:11Z",
            pid: 710030,
          },
          ref: "origin/main",
          refSha: "951b7551ffffffffffffffffffffffffffffffff",
          behind: 13,
        },
      },
    }).split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("code: ⚠")).toBeGreaterThan(at("circuit:"));
    expect(at("code: ⚠")).toBeLessThan(at("queue:"));
    expect(lines[at("code: ⚠")]).toContain("13 commit(s) behind");
    expect(lines[at("code: ⚠")]).toContain("a830761a");
    expect(lines[at("code: ⚠")]).toContain("951b7551");
  });

  it("a daemon running the ref gets no line and no blank one either", () => {
    expect(renderFrame(frame)).not.toContain("code: ");
    expect(renderFrame(frame)).not.toContain("\n\n");
  });

  /**
   * The third state, and the one that keeps the silence above meaning something: a live
   * daemon that published no vintage of its own code. Silence here would be read as
   * "current", which is exactly the wrong answer for a process too old to publish.
   */
  it("a live daemon that published nothing is NAMED, not read as current", () => {
    const line = renderFrame({ ...frame, codeAge: { kind: "unpublished", pid: 3295463 } })
      .split("\n")
      .find((row) => row.includes("code: ⚠"));
    expect(line).toContain("3295463");
    expect(line).toContain("cannot be judged");
  });

  /**
   * The fourth state, and the disagreement it closes (#190 review): the tick printed the
   * unreadable reading into the daemon's stream while the frame drew nothing for it — the
   * two saying different things about the one subject this section exists to keep honest.
   * A ref that does not resolve is a measurement that did not happen, and the frame is
   * silent for exactly one reason: a measurement that did and came back clean.
   */
  it("a reading the frame could not take is NAMED, not drawn as a match", () => {
    const line = renderFrame({
      ...frame,
      codeAge: { kind: "unreadable", problem: "fatal: bad revision 'origin/mian^{commit}'" },
    })
      .split("\n")
      .find((row) => row.includes("code: ⚠"));
    expect(line).toContain("unreadable");
    expect(line).toContain("origin/mian");
  });

  it("a project with no resident roles gets no section and no blank line for one", () => {
    // There is no question to answer here, and an empty section would teach a reader to
    // conclude something from its absence. The frame must also not grow a stray newline.
    expect(renderFrame(frame)).not.toContain("resident roles");
    expect(renderFrame(frame)).not.toContain("\n\n");
  });
});

/**
 * D-4 (thread 023): the live count, its list, and what is left free. What is checked is
 * the thing the reader used to have to derive by hand — how much of the box is spent —
 * and the zero case, which is the state a stalled circuit is actually in.
 */
describe("renderParallelism — the live count and the room left", () => {
  const running = (role: string, thread: string): LeaseView => ({
    role,
    thread,
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
  });
  const p = (over: Partial<Parallelism> = {}): Parallelism => ({
    raisable: ["dev-core", "curator", "dev-speech"],
    live: [],
    held: [],
    ...over,
  });

  it("counts the LIVE roles against the capacity of the box", () => {
    const text = renderParallelism(
      p({ live: [running("dev-core", "023-daemon-parallelism"), running("curator", "026-merge")] }),
    );
    expect(text).toContain("parallelism: 2 of 3 role(s) live");
  });

  it("lists the live pairs with their state, not just a number", () => {
    const text = renderParallelism(p({ live: [running("dev-core", "023-daemon-parallelism")] }));
    expect(text).toContain("▶ dev-core×023-daemon-parallelism — running");
  });

  it("names the roles that are FREE — 'room for whom' is the question actually asked", () => {
    const text = renderParallelism(p({ live: [running("dev-core", "023-daemon-parallelism")] }));
    expect(text).toContain("free: curator, dev-speech");
  });

  it("says saturation out loud instead of printing an empty list", () => {
    const text = renderParallelism(
      p({
        raisable: ["dev-core"],
        live: [running("dev-core", "023-daemon-parallelism")],
      }),
    );
    expect(text).toContain("free: none — every role this box raises is busy");
  });

  it("nobody live is a SPOKEN state — that is what a stalled circuit looks like", () => {
    const text = renderParallelism(p());
    expect(text).toContain("parallelism: nobody is live — 3 role(s) this box raises, all free");
  });

  it("a role held by a human is capacity that is not the circuit's, and is said apart", () => {
    const text = renderParallelism(
      p({ live: [running("dev-core", "023-daemon-parallelism")], held: ["curator"] }),
    );
    expect(text).toContain("held by a human: curator");
    // ...and it is NOT counted as room the circuit can use.
    expect(text).toContain("free: dev-speech");
  });

  // The combination the two branches used to disagree on (reviewer, PR #100): a hold is
  // the ordinary reason for live=0 on that role — S5 forbids the circuit to raise it —
  // so this is the frame an operator meets, and it must not call the held role free.
  it("nobody live WITH a hold does not claim 'all free' — the hold is capacity spent", () => {
    const text = renderParallelism(p({ held: ["curator"] }));
    expect(text).not.toContain("all free");
    expect(text).toContain(
      "parallelism: nobody is live — 3 role(s) this box raises, 2 free, 1 held",
    );
    expect(text).toContain("free: dev-core, dev-speech");
    expect(text).toContain("held by a human: curator");
  });

  it("nobody live and every role held is saturation by the human, and says so", () => {
    const text = renderParallelism(p({ raisable: ["dev-core"], held: ["dev-core"] }));
    expect(text).toContain("0 free, 1 held");
    expect(text).toContain("free: none — every role this box raises is held by a human");
  });

  it("busy AND held together name both reasons the room is gone", () => {
    const text = renderParallelism(
      p({
        raisable: ["dev-core", "curator"],
        live: [running("dev-core", "023-daemon-parallelism")],
        held: ["curator"],
      }),
    );
    expect(text).toContain("free: none — every role this box raises is busy or held by a human");
  });
});

/**
 * D-4 (thread 023): the freeze behind a person (R27) used to live only on the daemon's
 * stream. A queue line promises a launch; the mark is what keeps that promise honest for
 * a reader who never sees the stream.
 */
describe("renderQueue — the parked candidate is marked where the queue is read", () => {
  const queue: RankedCandidate[] = [
    { role: "curator", thread: "030-consult-lane", priority: "normal" },
    { role: "dev-core", thread: "023-daemon-parallelism", priority: "normal" },
  ];

  it("names WHOSE decision the head of the queue is frozen behind", () => {
    const text = renderQueue(queue, [], new Map([["030-consult-lane", "john"]]));
    expect(text).toContain("PARKED behind a decision of john");
    expect(text).toContain("R27");
  });

  it("marks only the parked thread, and leaves the rest of the queue alone", () => {
    const text = renderQueue(queue, [], new Map([["030-consult-lane", "john"]]));
    const marked = text.split("\n").filter((line) => line.includes("PARKED"));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("030-consult-lane");
  });

  it("without a park nothing is added — the ordinary queue reads as before", () => {
    expect(renderQueue(queue)).not.toContain("PARKED");
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
      parallelism: { raisable: [], live: [], held: [] },
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

describe("renderMergeReady — the ONE section that is silent when the news is good", () => {
  const outage = (ticks: number): GhOutage => ({
    evidence: "Could not resolve to a Repository with the name 'owner/repo'.",
    since: "2026-08-01T19:00:00Z",
    ticks,
    last: "2026-08-01T19:0Z",
  });

  it("says nothing at all while the tier answers", () => {
    expect(renderMergeReady(undefined)).toBe("");
  });

  it("says nothing BELOW the threshold — one flaky call must not grow a line", () => {
    expect(ghAlarmDue(outage(GH_OUTAGE_TICKS - 1))).toBe(false);
    expect(renderMergeReady(outage(1))).toBe("");
    expect(renderMergeReady(outage(GH_OUTAGE_TICKS - 1))).toBe("");
  });

  it("speaks AT the threshold, with the threshold beside the count and the vendor's own words", () => {
    const text = renderMergeReady(outage(GH_OUTAGE_TICKS));
    expect(text).toContain("merge-ready:");
    expect(text).toContain(`rings at ${GH_OUTAGE_TICKS}`);
    expect(text).toContain("Could not resolve to a Repository");
  });

  it("the FRAME follows the same predicate — below the threshold it is byte-identical to no tier at all", () => {
    const bare: OperatorFrame = {
      now: NOW,
      leases: [],
      holds: [],
      parallelism: { raisable: [], live: [], held: [] },
      circuit: circuit(),
      queue: [],
      queueNotes: [],
      digests: [],
      mail: { root: "/mail", fetchedAt: NOW, behind: 0 },
    };
    expect(renderFrame({ ...bare, ghOutage: outage(GH_OUTAGE_TICKS - 1) })).toBe(renderFrame(bare));
    const ringing = renderFrame({ ...bare, ghOutage: outage(GH_OUTAGE_TICKS) });
    expect(ringing).toContain("merge-ready:");
    const lines = ringing.split("\n");
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("auth:")).toBeLessThan(at("merge-ready:"));
    expect(at("merge-ready:")).toBeLessThan(at("queue:"));
  });
});
