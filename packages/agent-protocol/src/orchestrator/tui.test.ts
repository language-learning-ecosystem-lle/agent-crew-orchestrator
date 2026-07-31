import { describe, expect, it } from "vitest";

import type { HoldView } from "./hold.js";
import type { LeaseView } from "./lease.js";
import type { OperatorFrame } from "./snapshot.js";
import { decodeTuiInput, initialTuiState, reduceTui, renderTui, type TuiState } from "./tui.js";

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

describe("reduceTui — key + state → state + effect", () => {
  it("the selection moves and stops at both ends", () => {
    const two = 2;
    const down = reduceTui(initialTuiState, "down", two);
    expect(down.state.selected).toBe(1);
    // The bottom is the bottom: a selection past the last pair would point the transcript
    // panel at nothing while still looking like a choice.
    expect(reduceTui(down.state, "down", two).state.selected).toBe(1);
    expect(reduceTui(down.state, "up", two).state.selected).toBe(0);
    expect(reduceTui(initialTuiState, "up", two).state.selected).toBe(0);
  });

  it("a selection is clamped against the CURRENT pairs, not remembered as an offset", () => {
    // Leases come and go between frames. An index that survived a shrinking frame would
    // silently highlight a different pair than the one being watched — the worst outcome
    // for a panel whose whole job is "the log OF THIS PAIR".
    const state: TuiState = { selected: 5, panel: "log", overlay: false };
    expect(reduceTui(state, "down", 2).state.selected).toBe(1);
    expect(reduceTui(state, "refresh", 2).state.selected).toBe(1);
    expect(reduceTui(state, "up", 0).state.selected).toBe(0);
  });

  it("tab flips the half of the transcript and nothing else", () => {
    const first = reduceTui(initialTuiState, "tab", 1);
    expect(first.state.panel).toBe("supervisor");
    expect(first.effect).toBe("none");
    expect(reduceTui(first.state, "tab", 1).state.panel).toBe("log");
  });

  it("l toggles the overlay, r asks for a frame now, q leaves", () => {
    const opened = reduceTui(initialTuiState, "log", 1);
    expect(opened.state.overlay).toBe(true);
    expect(reduceTui(opened.state, "log", 1).state.overlay).toBe(false);
    // `r` is the only key that reaches past the interval — and it is an EFFECT, because
    // the reducer itself never reads the world.
    expect(reduceTui(initialTuiState, "refresh", 1).effect).toBe("collect");
    expect(reduceTui(initialTuiState, "quit", 1).effect).toBe("quit");
  });

  it("no key of T-1 mutates anything — the effects are exactly leave and collect", () => {
    const effects = (["up", "down", "tab", "log", "refresh", "quit"] as const).map(
      (key) => reduceTui(initialTuiState, key, 3).effect,
    );
    expect(new Set(effects)).toEqual(new Set(["none", "collect", "quit"]));
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
