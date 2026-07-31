/**
 * THE OBSERVER'S PURE CORE (T-1, thread `019-operator-ux`) — the keys and the screen,
 * as two functions over data. The dirty shell around them (raw mode, the alt-screen,
 * the timers, writing to a tty) is a NAMED GAP, exactly as it is for `up`/`down`: a pty
 * is not dragged into the package's dependencies to cover it, and the one process test
 * is the door — without a real TTY the command refuses in words instead of drawing
 * escape sequences into a pipe.
 *
 * THE TUI IS NOT A SECOND VIEW OF THE WORLD — IT IS A SECOND LAYOUT OF THE SAME FRAME.
 * Nothing here reads a file or computes a fact: `OperatorFrame` arrives already
 * collected by `operatorFrame`, and every line drawn comes from the very renderers
 * `status` prints (`renderLeaseLine` for the pairs, the section renderers for the
 * middle). That is what makes "the observer never differs from `status` by a line" a
 * construction rather than a promise — and it is why the resident waits had to move
 * INTO the frame before this file could exist (2.1).
 *
 * READ-ONLY BY CONSTRUCTION, AND THE INPUT IS ALREADY CLOSED. T-1 has five keys and all
 * five read; the mutating three (`h`/`s`/`u`) belong to T-2 together with their
 * second-press confirmation. The bracketed-paste guard is nevertheless written HERE,
 * where there is nothing to execute: this thread exists because a watch was killed by
 * an accidental paste, and T-2 must pour mutating keys into an input that is ALREADY
 * closed rather than reopen that question beside `s` and `u`.
 */
import { type OperatorFrame, renderFrame } from "./snapshot.js";
import { renderLeaseLine } from "./status.js";

/** The five reading keys of T-1 — the whole vocabulary of the observer. */
export type TuiKey = "up" | "down" | "tab" | "log" | "refresh" | "quit";

/** Which half of the session's transcript the bottom panel is showing. */
export type TranscriptPanel = "log" | "supervisor";

export type TuiState = {
  /** Index into the frame's leases — the pair whose line is highlighted. */
  readonly selected: number;
  readonly panel: TranscriptPanel;
  /** The `l` overlay is up, covering the three panels. */
  readonly overlay: boolean;
};

export const initialTuiState: TuiState = { selected: 0, panel: "log", overlay: false };

/**
 * What the shell must DO after a key, beyond redrawing: leave, or collect a frame right
 * now instead of waiting out the interval. Selection and panel changes need neither —
 * they redraw from the frame already in hand.
 */
export type TuiEffect = "none" | "quit" | "collect";

/**
 * KEY + STATE → STATE + EFFECT. The pure half of the observer, and the half worth
 * testing: everything a key can mean is decided here, and the shell only obeys.
 *
 * The selection is clamped against the CURRENT number of pairs rather than remembered
 * as an offset: leases appear and vanish between frames, and a selection that survived
 * as a raw index would highlight a different pair than the one the operator was looking
 * at — the worst possible outcome for a panel whose whole job is "this pair's log".
 */
export const reduceTui = (
  state: TuiState,
  key: TuiKey,
  /** How many pairs the frame currently holds — the selection's bound. */
  pairs: number,
): { readonly state: TuiState; readonly effect: TuiEffect } => {
  const last = Math.max(0, pairs - 1);
  const clamped = Math.min(state.selected, last);
  switch (key) {
    case "up":
      return { state: { ...state, selected: Math.max(0, clamped - 1) }, effect: "none" };
    case "down":
      return { state: { ...state, selected: Math.min(last, clamped + 1) }, effect: "none" };
    case "tab":
      return {
        state: { ...state, selected: clamped, panel: state.panel === "log" ? "supervisor" : "log" },
        effect: "none",
      };
    case "log":
      return { state: { ...state, selected: clamped, overlay: !state.overlay }, effect: "none" };
    // `r` is the one key that reaches past the interval. It looks redundant at one tempo
    // and is not: it is the only way to see the effect of a command typed in the next
    // terminal without waiting the interval out.
    case "refresh":
      return { state: { ...state, selected: clamped }, effect: "collect" };
    case "quit":
      return { state: { ...state, selected: clamped }, effect: "quit" };
  }
};

/** The sequences the input decoder knows BY NAME — no escape byte is ever typed inline. */
const ESC = "\u001b";
/** Bracketed paste on/off — the shell writes these at entry and at exit (§4). */
export const PASTE_ON = `${ESC}[?2004h`;
export const PASTE_OFF = `${ESC}[?2004l`;
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;
const ARROW_UP = `${ESC}[A`;
const ARROW_DOWN = `${ESC}[B`;
/** Ctrl+C arrives as a BYTE in raw mode, not as a signal — and it must mean `q`. */
const CTRL_C = "\u0003";

/**
 * BYTES → KEYS, WITH THE PASTE THROWN AWAY (§4 of the statement of work).
 *
 * A terminal in bracketed-paste mode wraps pasted text in `ESC[200~ … ESC[201~`, and
 * everything between those markers is TEXT THE OPERATOR MEANT FOR SOMEWHERE ELSE. It is
 * dropped here rather than filtered later, because "later" is where the accident
 * happened: a block of text containing a `q` closed the window it was pasted into.
 *
 * The paste flag is carried in and out because a paste arrives split across chunks as
 * often as not — a decoder that only recognised whole pastes would let the tail of a
 * long one through as keys.
 */
export const decodeTuiInput = (
  chunk: string,
  pasting = false,
): { readonly keys: readonly TuiKey[]; readonly pasting: boolean } => {
  const keys: TuiKey[] = [];
  let rest = chunk;
  let inside = pasting;
  while (rest.length > 0) {
    if (inside) {
      const end = rest.indexOf(PASTE_END);
      if (end === -1) return { keys, pasting: true };
      rest = rest.slice(end + PASTE_END.length);
      inside = false;
      continue;
    }
    const start = rest.indexOf(PASTE_START);
    const plain = start === -1 ? rest : rest.slice(0, start);
    keys.push(...typedKeys(plain));
    if (start === -1) return { keys, pasting: false };
    rest = rest.slice(start + PASTE_START.length);
    inside = true;
  }
  return { keys, pasting: inside };
};

/** The keys of one paste-free run of bytes; anything unrecognised is silently ignored. */
const typedKeys = (text: string): readonly TuiKey[] => {
  const keys: TuiKey[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(ARROW_UP, i)) {
      keys.push("up");
      i += ARROW_UP.length;
      continue;
    }
    if (text.startsWith(ARROW_DOWN, i)) {
      keys.push("down");
      i += ARROW_DOWN.length;
      continue;
    }
    const ch = text[i] as string;
    i += 1;
    // Ctrl+C means exactly what `q` means: the terminal is restored from one place.
    if (ch === CTRL_C || ch === "q") keys.push("quit");
    else if (ch === "\t") keys.push("tab");
    else if (ch === "k") keys.push("up");
    else if (ch === "j") keys.push("down");
    else if (ch === "l") keys.push("log");
    else if (ch === "r") keys.push("refresh");
  }
  return keys;
};

/**
 * A line cut to the terminal's width, by CHARACTERS — the frame is full of box marks,
 * and a byte-wise cut would slice one in half. Named `cutTo` rather than `fit`: `fit` is
 * a focused-test alias and the linter flags every call of it.
 */
const cutTo = (line: string, cols: number): string => [...line].slice(0, cols).join("");

/**
 * THE SCREEN — the frame laid out as three panels, exactly `rows` lines tall.
 *
 * The top panel is one `renderLeaseLine` per pair with the selected one marked; the
 * middle is the REST of `renderFrame`, unchanged and in its own order (which is why the
 * split below is a slice of the rendered frame and not a second assembly of sections);
 * the bottom is the tail of the selected pair's transcript, with its own header naming
 * which half of it is on screen and where the file lies.
 *
 * The height is divided rather than negotiated: the pairs and the transcript take what
 * they need up to a third each, the middle keeps the remainder, and every panel that
 * had to drop lines SAYS how many. A panel that silently truncates is how an operator
 * concludes there are three pairs when there are nine.
 */
export const renderTui = (input: {
  readonly frame: OperatorFrame;
  readonly state: TuiState;
  readonly rows: number;
  readonly cols: number;
  /** The tail of the selected transcript, newest last — read by the shell, not here. */
  readonly transcript?: readonly string[];
  /** What the overlay shows when it is up (`renderLog` of the journal). */
  readonly overlayLines?: readonly string[];
}): readonly string[] => {
  const { frame, state, rows, cols } = input;
  if (state.overlay) {
    const body = (input.overlayLines ?? ["the journal is empty"]).map((line) => cutTo(line, cols));
    return pad(["history (l closes it):", ...body.slice(-(rows - 1))], rows, cols);
  }

  const pairs = frame.leases.map((view, index) => {
    const line = cutTo(renderLeaseLine(view).split("\n")[0] as string, cols - 2);
    return `${index === state.selected ? "▸ " : "  "}${line}`;
  });
  const top = capped(
    pairs.length === 0 ? ["orchestrator: no sessions in the journal"] : pairs,
    Math.max(1, Math.floor(rows / 3)),
  );

  // The middle is the frame MINUS the lease lines it starts with — the same text
  // `status` prints, not a re-assembly of the same sections in a second order.
  const whole = renderFrame(frame).split("\n");
  const middleAll = whole.slice(Math.max(1, frame.leases.length));
  const selected = frame.leases[Math.min(state.selected, Math.max(0, frame.leases.length - 1))];
  // The header is TWO lines, and the path has one to itself: crammed onto the end of the
  // first it was the part an 80-column terminal cut off — the one thing on that line an
  // operator has to be able to copy into the next shell.
  const head =
    selected === undefined
      ? ["transcript: no pair is selected"]
      : selected.sessionLog === undefined
        ? [
            `transcript of ${selected.role}×${selected.thread} · ${state.panel} (tab switches)`,
            "  no run has been launched yet — nothing has been written for this pair",
          ]
        : [
            `transcript of ${selected.role}×${selected.thread} · ${state.panel} (tab switches)`,
            `  ${state.panel === "log" ? selected.sessionLog : supervisorOf(selected.sessionLog)}`,
          ];
  const tail = input.transcript ?? [];
  const bottomBudget = Math.max(head.length, Math.floor(rows / 3));
  const bottom = [
    ...head.map((line) => cutTo(line, cols)),
    ...tail.slice(-(bottomBudget - head.length)).map((l) => cutTo(l, cols)),
  ];
  const middle = capped(
    middleAll.map((l) => cutTo(l, cols)),
    rows - top.length - bottom.length,
  );
  return pad([...top, ...middle, ...bottom], rows, cols);
};

/** `.log` → `.supervisor`, by name — the same derivation `sessionSupervisorPath` makes. */
const supervisorOf = (logPath: string): string => logPath.replace(/\.log$/, ".supervisor");

/**
 * A panel cut to its budget, SAYING what it dropped. The last line is spent on the
 * count rather than on one more row of content: a truncation nobody announces reads
 * exactly like a circuit with fewer pairs in it.
 */
const capped = (lines: readonly string[], budget: number): readonly string[] => {
  if (budget <= 0) return [];
  if (lines.length <= budget) return [...lines];
  return [...lines.slice(0, budget - 1), `  … ${lines.length - (budget - 1)} more line(s)`];
};

/** Exactly `rows` lines, each within `cols` — the shell writes what it is given. */
const pad = (lines: readonly string[], rows: number, cols: number): readonly string[] => {
  const cut = lines.slice(0, rows).map((line) => cutTo(line, cols));
  while (cut.length < rows) cut.push("");
  return cut;
};
