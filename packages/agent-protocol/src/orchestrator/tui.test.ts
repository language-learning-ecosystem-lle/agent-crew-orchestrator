import { describe, expect, it } from "vitest";

import { USAGE } from "../usage.js";
import { parseUsage } from "./argv.js";
import type { HoldView } from "./hold.js";
import type { LeaseView } from "./lease.js";
import type { OperatorFrame } from "./snapshot.js";
import {
  argvOf,
  commandOf,
  decodeTuiInput,
  INHERITED,
  initialTuiState,
  invocationOf,
  reduceTui,
  renderTui,
  subjectOf,
  type TuiState,
  type TuiSubject,
} from "./tui.js";

const ESC = "\u001b";
const NOW = new Date("2026-07-31T09:00:00Z");

const lease = (partial: Partial<LeaseView> = {}): LeaseView => ({
  role: "dev-core",
  thread: "019-operator-ux",
  state: "running",
  attempt: 1,
  ceiling: 3,
  deadline: "2026-07-31T10:00:00Z",
  waitDeadline: null,
  reason: null,
  lastEvent: "lease-acquired",
  overdue: false,
  exhausted: false,
  launchable: false,
  sessionLog: "/state/sessions/2026-07-31T09-00-00Z-dev-core-019-operator-ux.log",
  ...partial,
});

const hold: HoldView = {
  role: "curator",
  by: "john",
  taken: "2026-07-31T08:00:00Z",
  expires: "2026-07-31T10:00:00Z",
  active: true,
};

const frameOf = (leases: readonly LeaseView[]): OperatorFrame => ({
  now: NOW,
  leases,
  holds: [hold],
  parallelism: { raisable: ["dev-core", "curator"], live: [...leases], held: ["curator"] },
  circuit: { launchesEnabled: true, stopFlag: false, forceFlag: false, pidFilePresent: false },
  queue: [{ role: "dev-core", thread: "019-operator-ux", priority: "normal" }],
  queueNotes: [],
  digests: [],
  mail: { root: "/mail", fetchedAt: new Date("2026-07-31T08:59:50Z"), behind: 0 },
});

/** A world of `n` unparked pairs with no daemon — what the reading keys are judged in. */
const seen = (n: number, over: Partial<TuiSubject> = {}): TuiSubject => ({
  pairs: Array.from({ length: n }, (_, at) => ({ role: `role-${at}`, held: false })),
  daemonAlive: false,
  ...over,
});

describe("reduceTui — key + state → state + effect", () => {
  it("the selection moves and stops at both ends", () => {
    const two = 2;
    const down = reduceTui(initialTuiState, "down", seen(two));
    expect(down.state.selected).toBe(1);
    // The bottom is the bottom: a selection past the last pair would point the transcript
    // panel at nothing while still looking like a choice.
    expect(reduceTui(down.state, "down", seen(two)).state.selected).toBe(1);
    expect(reduceTui(down.state, "up", seen(two)).state.selected).toBe(0);
    expect(reduceTui(initialTuiState, "up", seen(two)).state.selected).toBe(0);
  });

  it("a selection is clamped against the CURRENT pairs, not remembered as an offset", () => {
    // Leases come and go between frames. An index that survived a shrinking frame would
    // silently highlight a different pair than the one being watched — the worst outcome
    // for a panel whose whole job is "the log OF THIS PAIR".
    const state: TuiState = { selected: 5, panel: "log", overlay: false };
    expect(reduceTui(state, "down", seen(2)).state.selected).toBe(1);
    expect(reduceTui(state, "refresh", seen(2)).state.selected).toBe(1);
    expect(reduceTui(state, "up", seen(0)).state.selected).toBe(0);
  });

  it("tab flips the half of the transcript and nothing else", () => {
    const first = reduceTui(initialTuiState, "tab", seen(1));
    expect(first.state.panel).toBe("supervisor");
    expect(first.effect).toBe("none");
    expect(reduceTui(first.state, "tab", seen(1)).state.panel).toBe("log");
  });

  it("l toggles the overlay, r asks for a frame now, q leaves", () => {
    const opened = reduceTui(initialTuiState, "log", seen(1));
    expect(opened.state.overlay).toBe(true);
    expect(reduceTui(opened.state, "log", seen(1)).state.overlay).toBe(false);
    // `r` is the only key that reaches past the interval — and it is an EFFECT, because
    // the reducer itself never reads the world.
    expect(reduceTui(initialTuiState, "refresh", seen(1)).effect).toBe("collect");
    expect(reduceTui(initialTuiState, "quit", seen(1)).effect).toBe("quit");
  });

  it("no key of T-1 mutates anything — the effects are exactly leave and collect", () => {
    const effects = (["up", "down", "tab", "log", "refresh", "quit"] as const).map(
      (key) => reduceTui(initialTuiState, key, seen(3)).effect,
    );
    expect(new Set(effects)).toEqual(new Set(["none", "collect", "quit"]));
  });
});

describe("reduceTui — the three mutating keys (T-2)", () => {
  const alive = (n: number, over: Partial<TuiSubject> = {}): TuiSubject =>
    seen(n, { daemonAlive: true, ...over });

  it("h parks the SELECTED pair's role at once, and unparks one that is parked", () => {
    // `h` acts on the first press by design (§4): a hold is visible in one command and
    // undone in one word, so a confirmation would make the cheap half expensive.
    const world = seen(2);
    const first = reduceTui(initialTuiState, "park", world);
    expect(first.effect).toBe("act");
    expect(first.action).toEqual({ kind: "hold", role: "role-0" });

    const moved = reduceTui(initialTuiState, "down", world).state;
    const parked: TuiSubject = {
      pairs: [
        { role: "role-0", held: false },
        { role: "role-1", held: true },
      ],
      daemonAlive: false,
    };
    // The SAME key on a parked role means the other command — one key, because the
    // operator's question is "is this pair to be raised or not", not "which verb".
    expect(reduceTui(moved, "park", parked).action).toEqual({ kind: "resume", role: "role-1" });
  });

  it("h with no pair to act on refuses in words instead of doing nothing", () => {
    const step = reduceTui(initialTuiState, "park", seen(0));
    expect(step.effect).toBe("none");
    expect(step.action).toBeUndefined();
    expect(step.state.notice).toContain("no pair is selected");
  });

  it("s and u need a second press, and the first one only asks", () => {
    const asked = reduceTui(initialTuiState, "stop", alive(1));
    expect(asked.effect).toBe("none");
    expect(asked.state.pending).toBe("stop");
    expect(asked.state.notice).toContain("press 's' again");
    const done = reduceTui(asked.state, "stop", alive(1));
    expect(done.effect).toBe("act");
    expect(done.action).toEqual({ kind: "down" });

    const raise = reduceTui(initialTuiState, "raise", seen(1));
    expect(raise.state.pending).toBe("raise");
    expect(reduceTui(raise.state, "raise", seen(1)).action).toEqual({ kind: "up" });
  });

  it("ANY other key cancels a pending confirmation — including the other mutating one", () => {
    // A confirmation that survives an unrelated keystroke is a trap: the operator who
    // pressed `s` and thought better of it must not have to know which key is safe.
    const asked = reduceTui(initialTuiState, "stop", alive(2));
    for (const key of ["down", "tab", "log", "refresh"] as const) {
      const after = reduceTui(asked.state, key, alive(2));
      expect(after.state.pending).toBeUndefined();
      expect(after.state.notice).toBeUndefined();
      // …and the second press then means the FIRST press again, not the confirmation.
      expect(reduceTui(after.state, "stop", alive(2)).effect).toBe("none");
    }
    // `u` cancels a pending `s` too — and, the daemon being alive, refuses on its own.
    const crossed = reduceTui(asked.state, "raise", alive(2));
    expect(crossed.effect).toBe("none");
    expect(crossed.state.pending).toBeUndefined();
    expect(crossed.state.notice).toContain("already alive");
  });

  it("a key with nothing to do refuses and names the other one", () => {
    const stop = reduceTui(initialTuiState, "stop", seen(1));
    expect(stop.effect).toBe("none");
    expect(stop.state.pending).toBeUndefined();
    expect(stop.state.notice).toContain("'u' raises one");
    const up = reduceTui(initialTuiState, "raise", alive(1));
    expect(up.effect).toBe("none");
    expect(up.state.notice).toContain("'s' stops it");
  });

  it("the mutating keys leave the reading state alone", () => {
    const looking: TuiState = { selected: 1, panel: "supervisor", overlay: true };
    const after = reduceTui(looking, "park", seen(3)).state;
    expect(after.selected).toBe(1);
    expect(after.panel).toBe("supervisor");
    expect(after.overlay).toBe(true);
  });
});

describe("what a key is short for — the echoed command IS the executed one", () => {
  it("every action is an operator short form, spelled as it is typed", () => {
    expect(commandOf({ kind: "hold", role: "dev-core" })).toEqual([
      "orchestrator",
      "hold",
      "dev-core",
    ]);
    expect(commandOf({ kind: "resume", role: "dev-core" })).toEqual([
      "orchestrator",
      "resume",
      "dev-core",
    ]);
    expect(commandOf({ kind: "down" })).toEqual(["orchestrator", "down"]);
    expect(commandOf({ kind: "up" })).toEqual(["orchestrator", "up"]);
  });

  it("the action inherits the observer's own flags — it acts on the circuit being watched", () => {
    // A TUI pointed at a holds directory that is not the config's must not park a role
    // somewhere else while the screen goes on showing the untouched one.
    const argv = ["--ref", "origin/main", "--holds", "/tmp/holds", "--interval", "5"];
    expect(argvOf({ kind: "hold", role: "curator" }, argv)).toEqual([
      "orchestrator",
      "hold",
      "curator",
      "--ref",
      "origin/main",
      "--holds",
      "/tmp/holds",
    ]);
    // …and only the flags the TARGET's usage declares: `down` knows nothing of `--holds`,
    // and its own door would refuse the flag this window passed it.
    expect(argvOf({ kind: "down" }, argv)).toEqual([
      "orchestrator",
      "down",
      "--ref",
      "origin/main",
    ]);
  });

  it("a flag left without a value is not passed on as one", () => {
    // `--holds --ref origin/main` is a typo, and the child must meet the typo's absence
    // rather than a directory called `--ref`.
    expect(argvOf({ kind: "resume", role: "curator" }, ["--holds", "--ref"])).toEqual([
      "orchestrator",
      "resume",
      "curator",
    ]);
  });

  it("the inherited flags are EVERY flag both lines declare — the list cannot fall behind", () => {
    // The defect this pins (found in review of #125): `up` inherited `--ref` and
    // `--pid-file` out of the thirteen flags it shares with the observer, so a window
    // pointed at a journal, a holds directory or a roles scope of its own raised the
    // daemon on the CONFIG's paths — a second source of truth inside the very mechanism
    // meant to abolish one. The expectation is computed from the usage block rather than
    // retyped: a flag added to `tui` or to a target later is inherited or this goes red.
    const table = parseUsage(USAGE);
    const valueFlagsOf = (key: string): readonly string[] => [
      ...(table.get(key)?.value ?? []),
      // `up` re-executes itself as `orchestrator daemon`, and its door merges the two.
      ...(key === "orchestrator up" ? (table.get("orchestrator daemon")?.value ?? []) : []),
    ];
    const observer = valueFlagsOf("orchestrator tui");
    for (const kind of ["hold", "resume", "down", "up"] as const) {
      const target = valueFlagsOf(`orchestrator ${kind}`);
      expect([kind, [...INHERITED[kind]].sort()]).toEqual([
        kind,
        observer.filter((name) => target.includes(name)).sort(),
      ]);
    }
    // …and the intersection is not empty by accident of a mistyped key.
    expect(INHERITED.up).toContain("--holds");
    expect(INHERITED.up).toContain("--journal");
    expect(INHERITED.up).toContain("--roles");
  });

  it("what is printed IS what is spawned — one array, inherited flags and all", () => {
    // `perform()` used to build the child's argv from `argvOf` and the status line from
    // `commandOf`, and the two differ by exactly the inherited flags: the operator read
    // `orchestrator hold curator` while a hold landed in `/tmp/holds`. `invocationOf`
    // returns both from one array, so the line can be retyped character for character.
    const argv = ["--ref", "origin/main", "--holds", "/tmp/holds", "--now", "2026-07-31T13:00:00Z"];
    const { words, typed } = invocationOf({ kind: "hold", role: "curator" }, argv);
    expect(words).toEqual(argvOf({ kind: "hold", role: "curator" }, argv));
    expect(typed).toBe(
      // The order is the observer's usage line, not the order they were typed in.
      "$ agent-protocol orchestrator hold curator --ref origin/main --holds /tmp/holds --now 2026-07-31T13:00:00Z",
    );
    // Nothing inherited — the line is the bare command, with no trailing space to retype.
    expect(invocationOf({ kind: "up" }, []).typed).toBe("$ agent-protocol orchestrator up");
  });
});

describe("subjectOf — the keys judge exactly what is on the screen", () => {
  it("the parking of a pair's role and the daemon's life come from the frame", () => {
    const frame = frameOf([lease(), lease({ role: "curator", thread: "016-protocol-roadmap" })]);
    expect(subjectOf(frame)).toEqual({
      pairs: [
        { role: "dev-core", held: false },
        // `curator` is the role the fixture's hold is taken on, and it is ACTIVE.
        { role: "curator", held: true },
      ],
      daemonAlive: false,
    });
    const withDaemon = { ...frame, circuit: { ...frame.circuit, daemonPid: 4242 } };
    expect(subjectOf(withDaemon).daemonAlive).toBe(true);
  });

  it("an EXPIRED hold is not a parking — the key would offer to lift what is not down", () => {
    const frame = frameOf([lease({ role: "curator" })]);
    const stale = { ...frame, holds: [{ ...frame.holds[0], active: false }] } as OperatorFrame;
    expect(subjectOf(stale).pairs[0]?.held).toBe(false);
  });
});

describe("decodeTuiInput — the paste executes nothing (§4)", () => {
  it("reads the five keys, arrows included", () => {
    expect(decodeTuiInput(`${ESC}[B${ESC}[A\tlrq`).keys).toEqual([
      "down",
      "up",
      "tab",
      "log",
      "refresh",
      "quit",
    ]);
  });

  it("reads the three mutating keys too", () => {
    expect(decodeTuiInput("hsu").keys).toEqual(["park", "stop", "raise"]);
  });

  it("THE ACCEPTANCE FACT OF T-2: a pasted block STOPS NOTHING and PARKS NOBODY", () => {
    // The same guard as below, now standing in front of keys that spend money. It is one
    // filter for both because that is the point of having written it before T-2 existed.
    const pasted = `${ESC}[200~please stop the daemon: press s, then s${ESC}[201~`;
    expect(decodeTuiInput(pasted)).toEqual({ keys: [], pasting: false });
    const half = decodeTuiInput(`${ESC}[200~hold dev-core and`);
    expect(decodeTuiInput(" then raise: u, u", half.pasting)).toEqual({ keys: [], pasting: true });
  });

  it("THE ACCEPTANCE FACT: a pasted block containing a q does not close the window", () => {
    // The thread exists because a watch was killed by an accidental paste. Everything
    // between the paste markers is text meant for somewhere else, and it is dropped —
    // not filtered later, because "later" is where the accident happened.
    const pasted = `${ESC}[200~this text has a q and an r in it${ESC}[201~`;
    expect(decodeTuiInput(pasted)).toEqual({ keys: [], pasting: false });
  });

  it("keys typed around a paste still work", () => {
    const chunk = `j${ESC}[200~qqq${ESC}[201~k`;
    expect(decodeTuiInput(chunk).keys).toEqual(["down", "up"]);
  });

  it("a paste split across chunks stays swallowed to its very end", () => {
    // A long paste arrives in pieces as often as not; a decoder that only recognised
    // whole ones would let the TAIL through as keys — the same accident, one chunk later.
    const first = decodeTuiInput(`${ESC}[200~quit the`);
    expect(first).toEqual({ keys: [], pasting: true });
    const second = decodeTuiInput(" watch please", first.pasting);
    expect(second).toEqual({ keys: [], pasting: true });
    const third = decodeTuiInput(`q${ESC}[201~r`, second.pasting);
    expect(third.keys).toEqual(["refresh"]);
    expect(third.pasting).toBe(false);
  });

  it("Ctrl+C means what q means — in raw mode it arrives as a byte, not as a signal", () => {
    expect(decodeTuiInput("\u0003").keys).toEqual(["quit"]);
  });

  it("an unknown key is ignored, not guessed at", () => {
    expect(decodeTuiInput("xyz1").keys).toEqual([]);
  });
});

describe("renderTui — the frame as three panels", () => {
  const rows = 24;
  const cols = 100;

  it("is exactly the terminal's size, whatever the frame's length", () => {
    const lines = renderTui({ frame: frameOf([lease()]), state: initialTuiState, rows, cols });
    expect(lines).toHaveLength(rows);
    expect(lines.every((line) => [...line].length <= cols)).toBe(true);
  });

  it("draws the very lines status prints — the same renderers, not a second layout", () => {
    const lines = renderTui({ frame: frameOf([lease()]), state: initialTuiState, rows, cols });
    const text = lines.join("\n");
    expect(text).toContain("dev-core");
    expect(text).toContain("attempt 1/3");
    expect(text).toContain("circuit:");
    expect(text).toContain("queue:");
  });

  // Thread 063, john's requirement 5. The top panel used to call `renderLeaseLine` without
  // the frame's `now`, so `status` said "60m left of its window" about a pair and the
  // observer, looking at the SAME frame, said only a stamp. Two renderers of one fact
  // differing is the defect this thread exists to end, so the phrase is asserted at a real
  // terminal's width — a countdown that only survives on a 200-column screen is not shown.
  it("the top panel says how much is left, in the same words status uses", () => {
    const lines = renderTui({ frame: frameOf([lease()]), state: initialTuiState, rows, cols });
    expect(lines.join("\n")).toContain("60m left of its window");
  });

  it("the selected pair is marked, and only it", () => {
    const frame = frameOf([lease({ thread: "a" }), lease({ thread: "b" })]);
    const lines = renderTui({
      frame,
      state: { selected: 1, panel: "log", overlay: false },
      rows,
      cols,
    });
    const marked = lines.filter((line) => line.startsWith("▸ "));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("b");
  });

  it("the bottom panel names the file it is showing, and tab picks the other half", () => {
    const frame = frameOf([lease()]);
    const log = renderTui({ frame, state: initialTuiState, rows, cols }).join("\n");
    expect(log).toContain(".log");
    const supervisor = renderTui({
      frame,
      state: { selected: 0, panel: "supervisor", overlay: false },
      rows,
      cols,
    }).join("\n");
    expect(supervisor).toContain(".supervisor");
  });

  it("a pair that has never been launched says so instead of naming a file that is not there", () => {
    const never = lease();
    const { sessionLog: _dropped, ...withoutLog } = never;
    const frame = frameOf([withoutLog]);
    const text = renderTui({ frame, state: initialTuiState, rows, cols }).join("\n");
    expect(text).toContain("no run has been launched yet");
  });

  it("the transcript tail is the NEWEST lines — a panel showing the top of a growing file is useless", () => {
    const frame = frameOf([lease()]);
    const transcript = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const text = renderTui({ frame, state: initialTuiState, rows, cols, transcript }).join("\n");
    expect(text).toContain("line 199");
    expect(text).not.toContain("line 0\n");
  });

  it("a panel that had to drop lines SAYS how many", () => {
    // Silent truncation is how an operator concludes there are three pairs when there
    // are nine — the one reading mistake this whole frame exists to prevent.
    const frame = frameOf(Array.from({ length: 30 }, (_, i) => lease({ thread: `t${i}` })));
    const text = renderTui({ frame, state: initialTuiState, rows, cols }).join("\n");
    expect(text).toContain("more line(s)");
  });

  it("the overlay covers the panels and says how to close itself", () => {
    const frame = frameOf([lease()]);
    const text = renderTui({
      frame,
      state: { selected: 0, panel: "log", overlay: true },
      rows,
      cols,
      overlayLines: ["journal line one", "journal line two"],
    }).join("\n");
    expect(text).toContain("history (l closes it)");
    expect(text).toContain("journal line two");
    expect(text).not.toContain("circuit:");
  });

  it("an empty journal draws the honest line rather than an empty top panel", () => {
    const text = renderTui({ frame: frameOf([]), state: initialTuiState, rows, cols }).join("\n");
    expect(text).toContain("no sessions in the journal");
    expect(text).toContain("no pair is selected");
  });
});
