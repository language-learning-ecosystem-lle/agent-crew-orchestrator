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
 * THE THREE MUTATING KEYS (T-2) POUR INTO AN INPUT THAT WAS ALREADY CLOSED. The
 * bracketed-paste guard below was written for T-1, where there was nothing to execute,
 * precisely so that `h`/`s`/`u` would not reopen that question beside themselves: a
 * pasted block containing an `s` reaches no reducer, and that is a property of the
 * decoder rather than of a check somebody remembered to add here.
 *
 * WHAT THE KEYS DO IS NOT DONE HERE, AND NOT IN-PROCESS EITHER. A key decides ONE thing:
 * which existing operator command it is short for (`TuiAction` → `commandOf`). The shell
 * runs that command as a CHILD of this CLI and echoes it into the status line, so the
 * TUI owns no second implementation of parking or of the daemon's door — the same
 * refusals (a role the config does not know, a force flag on the floor, a daemon already
 * up) come back in the same words, and "every action performed is printed as the command
 * in the status line" (the acceptance fact of T-2) is what the operator can retype.
 *
 * THE CONFIRMATION IS ASYMMETRIC ON PURPOSE (§4 of the statement of work): `s` and `u`
 * take a second press, `h` does not. A key is cheaper than a typed command, and the two
 * that spend money — stopping the circuit and raising it — must not be one twitch away;
 * a hold is visible in one command and undone in one word.
 */
import { USAGE } from "../usage.js";
import { parseUsage } from "./argv.js";
import type { HoldView } from "./hold.js";
import { type OperatorFrame, renderFrame } from "./snapshot.js";
import { renderLeaseLine } from "./status.js";

/**
 * The eight keys of the observer: five that read (T-1) and three that act (T-2).
 * `park`/`stop`/`raise` are named by what they mean rather than by the letter typed —
 * the letters live in `typedKeys` and nowhere else.
 */
export type TuiKey = "up" | "down" | "tab" | "log" | "refresh" | "quit" | "park" | "stop" | "raise";

/** Which half of the session's transcript the bottom panel is showing. */
export type TranscriptPanel = "log" | "supervisor";

export type TuiState = {
  /** Index into the frame's leases — the pair whose line is highlighted. */
  readonly selected: number;
  readonly panel: TranscriptPanel;
  /** The `l` overlay is up, covering the three panels. */
  readonly overlay: boolean;
  /**
   * The key that asked for a confirmation and is waiting for its second press. ANY other
   * key clears it — a confirmation that survives an unrelated keystroke is a trap, and
   * the operator who pressed `s` then thought better of it must not have to know which
   * key is safe to press next.
   */
  readonly pending?: "stop" | "raise";
  /** What the status line says about the LAST key — the confirmation prompt, a refusal. */
  readonly notice?: string;
};

export const initialTuiState: TuiState = { selected: 0, panel: "log", overlay: false };

/**
 * What the shell must DO after a key, beyond redrawing: leave, collect a frame right now
 * instead of waiting out the interval, or run a command. Selection and panel changes
 * need none of the three — they redraw from the frame already in hand.
 */
export type TuiEffect = "none" | "quit" | "collect" | "act";

/**
 * WHICH OPERATOR COMMAND A KEY IS SHORT FOR. Four, and each of them exists already as a
 * short form the operator types by hand (thread 019): the TUI adds a way to invoke them,
 * never a second meaning for them.
 */
export type TuiAction =
  | { readonly kind: "hold"; readonly role: string }
  | { readonly kind: "resume"; readonly role: string }
  | { readonly kind: "down" }
  | { readonly kind: "up" };

/**
 * WHAT THE REDUCER NEEDS TO KNOW ABOUT THE WORLD — the pairs' roles with their parking,
 * and whether a daemon is alive. Derived from the frame by `subjectOf`, so the keys
 * judge exactly the state that is on the screen: a `h` decided against a fact the
 * operator cannot see is the divergence this whole layer was built to prevent.
 */
export type TuiSubject = {
  readonly pairs: readonly { readonly role: string; readonly held: boolean }[];
  readonly daemonAlive: boolean;
};

/** The frame's own answer to the three questions above — one derivation, no second one. */
export const subjectOf = (frame: OperatorFrame): TuiSubject => ({
  pairs: frame.leases.map((view) => ({
    role: view.role,
    held: frame.holds.some((hold: HoldView) => hold.active && hold.role === view.role),
  })),
  daemonAlive: frame.circuit.daemonPid !== undefined,
});

/**
 * KEY + STATE → STATE + EFFECT (+ the action to run). The pure half of the observer, and
 * the half worth testing: everything a key can mean is decided here, and the shell only
 * obeys.
 *
 * The selection is clamped against the CURRENT number of pairs rather than remembered
 * as an offset: leases appear and vanish between frames, and a selection that survived
 * as a raw index would highlight a different pair than the one the operator was looking
 * at — the worst possible outcome for a panel whose whole job is "this pair's log".
 *
 * A REFUSED KEY SAYS WHY. `s` with no daemon alive and `u` with one already up do
 * nothing and put a sentence in the status line naming the other key: silence there
 * reads as a broken keyboard, and the operator's next move is to press it harder.
 */
export const reduceTui = (
  state: TuiState,
  key: TuiKey,
  subject: TuiSubject,
): { readonly state: TuiState; readonly effect: TuiEffect; readonly action?: TuiAction } => {
  const last = Math.max(0, subject.pairs.length - 1);
  const clamped = Math.min(state.selected, last);
  // Every key arrives at a state with no confirmation and no notice pending: the three
  // that set one set it below, and the other five cancel by simply not doing so.
  const base: TuiState = { selected: clamped, panel: state.panel, overlay: state.overlay };
  switch (key) {
    case "up":
      return { state: { ...base, selected: Math.max(0, clamped - 1) }, effect: "none" };
    case "down":
      return { state: { ...base, selected: Math.min(last, clamped + 1) }, effect: "none" };
    case "tab":
      return {
        state: { ...base, panel: state.panel === "log" ? "supervisor" : "log" },
        effect: "none",
      };
    case "log":
      return { state: { ...base, overlay: !state.overlay }, effect: "none" };
    // `r` is the one key that reaches past the interval. It looks redundant at one tempo
    // and is not: it is the only way to see the effect of a command typed in the next
    // terminal without waiting the interval out.
    case "refresh":
      return { state: base, effect: "collect" };
    case "quit":
      return { state: base, effect: "quit" };
    // `h` acts on the FIRST press (§4): a hold is visible in `status` and undone in one
    // word, and asking twice for it would make the cheap half of the pair expensive.
    case "park": {
      const pair = subject.pairs[clamped];
      if (pair === undefined) {
        return {
          state: { ...base, notice: "no pair is selected — 'h' parks the role of a pair" },
          effect: "none",
        };
      }
      return {
        state: base,
        effect: "act",
        action: { kind: pair.held ? "resume" : "hold", role: pair.role },
      };
    }
    case "stop":
      if (!subject.daemonAlive) {
        return {
          state: { ...base, notice: "no daemon is alive on this box — 'u' raises one" },
          effect: "none",
        };
      }
      if (state.pending !== "stop") {
        return {
          state: {
            ...base,
            pending: "stop",
            notice: "stop the daemon gracefully? press 's' again — any other key cancels",
          },
          effect: "none",
        };
      }
      return { state: base, effect: "act", action: { kind: "down" } };
    case "raise":
      if (subject.daemonAlive) {
        return {
          state: { ...base, notice: "a daemon is already alive here — 's' stops it" },
          effect: "none",
        };
      }
      if (state.pending !== "raise") {
        return {
          state: {
            ...base,
            pending: "raise",
            notice: "raise the daemon? press 'u' again — any other key cancels",
          },
          effect: "none",
        };
      }
      return { state: base, effect: "act", action: { kind: "up" } };
  }
};

/**
 * THE COMMAND WORDS OF AN ACTION, WITHOUT THE INHERITED FLAGS. This is the naked verb —
 * what is RUN and what is ECHOED are both built from `invocationOf` below, never from
 * here: the acceptance fact of T-2 ("every action performed is printed as the command")
 * is only worth anything if the printed command is the executed one rather than a
 * description of it, and two call sites reading two different functions is exactly how
 * the description drifts from the deed.
 */
export const commandOf = (action: TuiAction): readonly string[] => {
  switch (action.kind) {
    case "hold":
      return ["orchestrator", "hold", action.role];
    case "resume":
      return ["orchestrator", "resume", action.role];
    case "down":
      return ["orchestrator", "down"];
    case "up":
      return ["orchestrator", "up"];
  }
};

/**
 * WHICH OF THE OBSERVER'S OWN FLAGS THE ACTION INHERITS — READ OFF THE USAGE BLOCK, NOT
 * LISTED BY HAND. The TUI may be pointed at a journal, a holds directory, a mail root or
 * a pid file that are not the config's, and an action that ignored them would mutate a
 * different circuit than the one being watched — while the screen went on showing the
 * untouched one.
 *
 * A hand-written list is the wrong shape for that answer twice over: a flag added to the
 * observer later is silently NOT inherited (the exact defect found in review — `up`
 * inherited two of its thirteen and would have been raised on the config's default paths
 * while the screen showed others), and a flag the target does not declare would meet its
 * own door (`guardArguments`) as a stray. So the table is the INTERSECTION of the two
 * usage lines, computed from the same text the checker reads.
 *
 * `up` is merged with `daemon` here for the same reason its door merges them: `up`
 * re-executes itself as `orchestrator daemon <what was typed>`, so the daemon's flags are
 * `up`'s too — see `guardArguments` in `cli.ts`.
 *
 * The assumption this makes explicit: within this CLI a flag NAME is one answer. Where two
 * commands mean different things they are already spelled differently (the observer's
 * redraw is `--interval`, the daemon's cadence is `--tick`), so nothing crosses over by
 * accident of naming.
 */
const USAGE_FLAGS = parseUsage(USAGE);
const valueFlagsOf = (key: string): readonly string[] => [
  ...(USAGE_FLAGS.get(key)?.value ?? []),
  ...(key === "orchestrator up" ? (USAGE_FLAGS.get("orchestrator daemon")?.value ?? []) : []),
];
const OBSERVER_FLAGS = valueFlagsOf("orchestrator tui");
const inheritedFor = (kind: TuiAction["kind"]): readonly string[] => {
  // The kind IS the command word — `hold`, `resume`, `down`, `up` are the names the usage
  // block spells, and a mapping table beside them would be one more thing to fall behind.
  const target = valueFlagsOf(`orchestrator ${kind}`);
  return OBSERVER_FLAGS.filter((name) => target.includes(name));
};
export const INHERITED: Readonly<Record<TuiAction["kind"], readonly string[]>> = {
  hold: inheritedFor("hold"),
  resume: inheritedFor("resume"),
  down: inheritedFor("down"),
  up: inheritedFor("up"),
};

/** The full argv of the child: the command, then the inherited flags with their values. */
export const argvOf = (action: TuiAction, argv: readonly string[]): readonly string[] => {
  const inherited: string[] = [];
  for (const name of INHERITED[action.kind]) {
    const at = argv.indexOf(name);
    const value = at === -1 ? undefined : argv[at + 1];
    if (value !== undefined && !value.startsWith("--")) inherited.push(name, value);
  }
  return [...commandOf(action), ...inherited];
};

/**
 * THE ONE PLACE THE ACTION BECOMES WORDS — what is run and what is printed, from a single
 * array. The status line of T-2 promises the operator a command they can retype, and a
 * line built from `commandOf` beside a child spawned from `argvOf` breaks that promise the
 * moment the observer carries any flag of its own: the child would go to `--holds
 * /tmp/holds`, the screen would say `orchestrator hold curator`, and the difference — the
 * whole point of inheriting the flag — would be the invisible part.
 */
export const invocationOf = (
  action: TuiAction,
  argv: readonly string[],
): { readonly words: readonly string[]; readonly typed: string } => {
  const words = argvOf(action, argv);
  return { words, typed: `$ agent-protocol ${words.join(" ")}` };
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
    else if (ch === "h") keys.push("park");
    else if (ch === "s") keys.push("stop");
    else if (ch === "u") keys.push("raise");
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
    // The observer and `status` are one frame (T-1), the closures included: a pair whose
    // thread is closed loses its mark here for the same reason it loses it there. The
    // frame's `now` goes with it: without it the top panel dropped the "how much is left"
    // phrase while `status` printed it (thread 063, john's requirement 5), and two frames
    // of one fact saying different things is the very defect this thread is about.
    const line = cutTo(
      renderLeaseLine(view, frame.closedThreads?.has(view.thread) ?? false, frame.now).split(
        "\n",
      )[0] as string,
      cols - 2,
    );
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
