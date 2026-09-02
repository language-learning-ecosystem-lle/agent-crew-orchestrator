/**
 * ONE FACT — ONE PHRASE IN EVERY FRAME (thread 063, §2.6 of the statement of work).
 *
 * WHAT THIS TESTS THAT THE PER-RENDERER TESTS DO NOT. Each of the four frames has its
 * own file and its own assertions, and every one of them passed on 2026-08-30 while the
 * defect was live: `status` said `working on — already reported, turn passed` about a
 * pair and the parallelism block, two sections lower in the SAME output, said `draining`
 * about the same pair. Nothing in a per-renderer test can fail on that, because the fact
 * a reader compares lives BETWEEN the renderers. So the fixture here is ONE pair, built
 * once, and every frame a human can look at is rendered from it.
 *
 * THE FOUR SURFACES, and they are the whole set an operator has:
 *   1. `renderLeaseLine`  — the first section of `orchestrator status`;
 *   2. `renderParallelism` — the `parallelism` block of the same frame and of the daemon's
 *      own stream;
 *   3. `renderInstances`  — the line about a pair on a NEIGHBOURING box, off its digest;
 *   4. `renderTui`        — the observer's top panel.
 *
 * THE STATE UNDER TEST IS `draining` ON PURPOSE: it is the one that cost three explanations
 * in a day, the one whose data word and screen word differ most, and therefore the one a
 * frame that quietly kept its own vocabulary would print differently.
 *
 * WHAT IS ASSERTED IS THE PHRASE, NOT THE CALL. A test that checked "all four import
 * `stateWord`" would pass on a frame that imported it and then printed something else;
 * this one reads the rendered text, which is what the human reads.
 */
import { describe, expect, it } from "vitest";

import type { HoldView } from "./hold.js";
import type { InstanceDigest } from "./instances.js";
import { renderInstances } from "./instances.js";
import type { LeaseView } from "./lease.js";
import type { OperatorFrame } from "./snapshot.js";
import { renderParallelism } from "./snapshot.js";
import { stateWord } from "./state-word.js";
import { renderLeaseLine } from "./status.js";
import { initialTuiState, renderTui } from "./tui.js";

const NOW = new Date("2026-08-30T19:00:00Z");
const DEADLINE = "2026-08-30T20:00:00Z";
const ROLE = "curator";
const THREAD = "063-state-model-rewrite";

/** THE ONE FACT: a pair that has reported and is still working. */
const PAIR: LeaseView = {
  role: ROLE,
  thread: THREAD,
  state: "draining",
  attempt: 1,
  ceiling: 3,
  deadline: DEADLINE,
  waitDeadline: null,
  reason: null,
  lastEvent: "handoff-detected",
  overdue: false,
  exhausted: false,
  launchable: false,
  sessionLog: "/state/sessions/2026-08-30T18-00-00Z-curator-063-state-model-rewrite.log",
};

const HOLD: HoldView = {
  role: "john",
  by: "john",
  taken: "2026-08-30T18:00:00Z",
  expires: "2026-08-30T21:00:00Z",
  active: false,
};

/** The same pair as a NEIGHBOUR publishes it: the digest carries the DATA word. */
const DIGEST: InstanceDigest = {
  instance: "hetzner",
  writtenAt: "2026-08-30T18:59:40Z",
  roles: [ROLE],
  leases: [{ role: ROLE, thread: THREAD, state: PAIR.state, deadline: DEADLINE }],
};

const FRAME: OperatorFrame = {
  now: NOW,
  leases: [PAIR],
  holds: [HOLD],
  parallelism: { raisable: [ROLE], live: [PAIR], held: [] },
  circuit: { launchesEnabled: true, stopFlag: false, forceFlag: false, pidFilePresent: false },
  queue: [],
  queueNotes: [],
  digests: [DIGEST],
  mail: { root: "/mail", fetchedAt: new Date("2026-08-30T18:59:50Z"), behind: 0 },
};

/** Every frame a human reads, rendered from the single fixture above. */
const frames = (): ReadonlyMap<string, string> =>
  new Map([
    ["status", renderLeaseLine(PAIR, false, NOW)],
    ["parallelism", renderParallelism(FRAME.parallelism, NOW)],
    ["neighbouring box", renderInstances({ digests: [DIGEST], now: NOW })],
    [
      "observer panel",
      // Eighty columns, not a wide screen: the panel cuts its lines to the terminal, and a
      // phrase that only survives on a 200-column display is not shown to anybody.
      renderTui({ frame: FRAME, state: initialTuiState, rows: 24, cols: 80 }).join("\n"),
    ],
  ]);

describe("one fact — one phrase in every frame", () => {
  it("all four frames say the same sentence about the same pair", () => {
    const phrase = stateWord(PAIR.state, PAIR.reason);
    // The vocabulary is asserted literally and not through the function alone: a rename
    // that silently made the phrase empty would satisfy `toContain(stateWord(...))` in
    // every frame at once.
    expect(phrase).toBe("working on — already reported, turn passed");
    for (const [where, text] of frames()) {
      expect(text, `the frame '${where}' does not carry the phrase`).toContain(phrase);
    }
  });

  it("and none of them still carries the raw data word", () => {
    // The data word stays in the journal and on the wire — that is what append-only means
    // — but no frame a human reads may print it. This is the half that actually failed in
    // the field: the parallelism block printed `draining` while the section above it had
    // already translated the very same lease.
    for (const [where, text] of frames()) {
      expect(text, `the frame '${where}' still prints the raw data word`).not.toMatch(
        /\bdraining\b/,
      );
    }
  });

  // THE MARKS ARE PART OF THE FACT, NOT DECORATION ON IT (found in review of #201). The two
  // frames that can carry a WINDOW — `status` and the observer's top row — are the two this
  // case holds together, because the other two surfaces have no place to put one: the
  // parallelism block is a census of pairs and the neighbouring box publishes a digest that
  // never crossed a wire carrying these facts. The defect this replaces: `renderStatus` was
  // given `speechless`/`mailLock` and `renderTui` was not, and because both parameters carry
  // defaults nothing failed to compile — the observer just went on printing `working —
  // nothing reported yet` about a pair `status` was already calling raised-and-silent.
  //
  // Asserted on the top ROW and not on the joined panel: the middle panel reprints the whole
  // of `renderFrame`, so a phrase found anywhere in `renderTui(...).join("\n")` proves
  // nothing about the row an operator actually reads.
  describe("a window on a pair is a fact, and both frames that can show one do", () => {
    const HEAD = (mark: string): string => (mark.split(" — ")[0] as string).trim();

    it("`restore`: raised, and the child has not spoken yet", () => {
      const pair: LeaseView = { ...PAIR, state: "running" };
      const speechless = new Set([pair.sessionLog as string]);
      const status = renderLeaseLine(pair, false, NOW, speechless);
      const head = HEAD(status.slice(status.indexOf("⏳")));
      expect(head).toBe("⏳ RAISED, AND THE CHILD HAS NOT SPOKEN YET");
      const frame: OperatorFrame = { ...FRAME, leases: [pair], speechless };
      const row = renderTui({ frame, state: initialTuiState, rows: 24, cols: 80 })[0] as string;
      expect(row, "the observer's top row is silent about a window `status` names").toContain(head);
    });

    it("`save`: the pair is over and its session is still writing its memory", () => {
      const mailLock = {
        holder: `memory of ${ROLE}`,
        pid: 4242,
        since: "2026-08-30T18:58:00Z",
        alive: true,
      };
      const pair: LeaseView = { ...PAIR, state: "released", reason: "completed" };
      const status = renderLeaseLine(pair, false, NOW, new Set(), mailLock);
      const head = HEAD(status.slice(status.indexOf("⏳")));
      expect(head).toBe("⏳ THIS PAIR IS OVER, ITS SESSION IS NOT");
      const frame: OperatorFrame = { ...FRAME, leases: [pair], mailLock };
      const row = renderTui({ frame, state: initialTuiState, rows: 24, cols: 80 })[0] as string;
      expect(row, "the observer's top row is silent about a window `status` names").toContain(head);
    });
  });

  it("a state this build has never heard of travels through all four unchanged", () => {
    // The forward rule of the vocabulary (PROTOCOL.md, the states dictionary): an unknown
    // word is printed AS IT CAME, in every frame, so a box running ahead of this one is
    // read rather than guessed at. Checked across the frames for the same reason as above
    // — a single renderer inventing a fallback of its own is exactly what would split the
    // two boxes' accounts of one pair.
    const unknown = "self-serving";
    // `as unknown as` and not a plain cast: the whole point of this case is a word this
    // build's union does NOT contain, so the type system is right to refuse the narrow
    // conversion — the fixture is deliberately a state from a NEWER box.
    const pair = { ...PAIR, state: unknown } as unknown as LeaseView;
    const digest: InstanceDigest = {
      ...DIGEST,
      leases: [{ role: ROLE, thread: THREAD, state: unknown, deadline: DEADLINE }],
    };
    const frame: OperatorFrame = {
      ...FRAME,
      leases: [pair],
      parallelism: { ...FRAME.parallelism, live: [pair] },
      digests: [digest],
    };
    const texts = [
      renderLeaseLine(pair, false, NOW),
      renderParallelism(frame.parallelism, NOW),
      renderInstances({ digests: [digest], now: NOW }),
      renderTui({ frame, state: initialTuiState, rows: 24, cols: 80 }).join("\n"),
    ];
    for (const text of texts) expect(text).toContain(unknown);
  });
});
