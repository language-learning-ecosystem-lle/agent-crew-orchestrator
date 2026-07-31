/**
 * THE LIVE FRAME OF THE CIRCUIT (T-0, thread `019-operator-ux`) — the one operator
 * view that `status`, `status --watch` and, later, the TUI all draw from.
 *
 * WHY IT EXISTS AS A THING. The pure cores were already importable (`foldLeases`,
 * `foldHolds`, `orderCandidates`/`describeOrder`, `renderInstances`), but the
 * COMPOSITION — read the journal, fold it, read the holds, read the flags, scan the
 * mail, rank the queue — lived inside the `status` handler in `cli.ts`. A second
 * consumer would have had to repeat it, and a repeated composition is how a second
 * source of truth gets founded quietly: a watcher that counted the attempt ceiling
 * slightly differently from the daemon would show a human a picture the circuit does
 * not follow, and there would be nothing to argue with it. Here the model is one
 * type, `renderFrame` is one pure function, and the consumers have nowhere to differ.
 *
 * WHAT IS IN THE FRAME AND WHAT IS NOT (curator's correction 1). In: leases, holds,
 * the state of the circuit (launch gate, stop flag, force flag, whether the daemon is
 * alive), the queue with the reason for its order, the neighbours' digests with their
 * age, and how old the mail on disk is. Out — and staying in `status` alone: paths,
 * launch permissions, the machine config, the scope, the launch resolution, the
 * workspaces. Those are not live facts but the config read back, and one of them is
 * worse than merely static: `workspaces` calls `baseCommitOf`, i.e. `git fetch`, so a
 * frame containing it would fetch once a second.
 *
 * THE THREE FACTS THAT WERE NOWHERE. The stop flag, the force flag and the liveness
 * of the daemon existed as files and as `up`/`down` behaviour, and `status` printed
 * none of them — "why was nobody raised" could not be answered without opening files
 * by hand. They enter `status` in the same package that gives the watcher its frame,
 * so that the frame never becomes the only place where they are visible.
 *
 * ONE TEMPO, NOT TWO. The statement of work had the frame split into a local tempo
 * and a git tempo; the measurement (msg-008) killed that axis — `loadThreads` and
 * `loadDigests` are `readdirSync`/`readFileSync`, no git at all. Everything the frame
 * reads is disk. What remains of the two tempos is the STALENESS MARK: the mail
 * checkout is refreshed by the daemon, never by a reader, so a queue recomputed in a
 * second off a checkout nobody has touched for an hour looks fresh and lies harder
 * than a stale digest — because it has no age on screen. Hence `renderFreshness`,
 * and hence a frame that says "the checkout has not been pulled in N minutes,
 * because no daemon is alive" instead of quietly refreshing it (which a reader is
 * forbidden to do — see `mailCheckoutFreshness`).
 */
import type { MailFreshness } from "../fs/git.js";
import type { HoldView } from "./hold.js";
import { renderHolds } from "./hold.js";
import type { InstanceDigest } from "./instances.js";
import { renderInstances } from "./instances.js";
import type { LeaseView } from "./lease.js";
import type { RankedCandidate } from "./priority.js";
import { describeOrder } from "./priority.js";
import { describeQuotaShelf, type QuotaShelf } from "./quota.js";
import { renderStatus } from "./status.js";

/** Is the circuit able to raise anybody at all, and is anybody watching it. */
export type CircuitState = {
  /** The enable gate: launches were asked for (`enable`/`up`). */
  readonly launchesEnabled: boolean;
  /** The reboot mode, when `--mode-file` was given — the gate is read together with it. */
  readonly reboot?: "systemd" | "manual";
  readonly stopFlag: boolean;
  readonly forceFlag: boolean;
  /** The pid of the backgrounded daemon, if the file names one AND the process is there. */
  readonly daemonPid?: number;
  /** Whether a pid file exists at all — "stale pid file" and "never started" differ. */
  readonly pidFilePresent: boolean;
};

/**
 * HOW MANY SESSIONS THIS BOX CAN HOLD AT ONCE, AND WHAT IT IS HOLDING (D-4, thread 023).
 *
 * The degree of parallelism was never a parameter: it is the number of roles this box
 * raises, because a role has one workspace (R17) and a second session in it is refused
 * at the door. So the capacity is a FACT about the config, and the only question an
 * operator has in front of a running circuit is which part of it is spent — which is why
 * the three numbers are one line and not three sections.
 *
 * Until D-4 the frame printed every pair the journal knew, released ones included, and
 * left counting the LIVE ones to the reader. That is the number that decides whether the
 * box is saturated or idle, and a reader who has to derive it derives it wrong at 2am.
 */
export type Parallelism = {
  /** The roles this box may raise — the instance's, narrowed by the operator's flags (R13). */
  readonly raisable: readonly string[];
  /** The pairs with a LIVE lease right now, in the order the leases were folded. */
  readonly live: readonly LeaseView[];
  /** Roles taken by a human (S5) — capacity that exists but is not the circuit's. */
  readonly held: readonly string[];
};

export type OperatorFrame = {
  readonly now: Date;
  readonly leases: readonly LeaseView[];
  readonly holds: readonly HoldView[];
  /** The live count, the pairs behind it and what is left free (D-4). */
  readonly parallelism: Parallelism;
  readonly circuit: CircuitState;
  readonly queue: readonly RankedCandidate[];
  /**
   * The threads frozen behind a person (R27), thread id → whom — the SAME map the tick
   * plans by. Before D-4 this state was visible only as a skip line in the daemon's
   * stream: an operator reading `status` saw a parked pair at the head of the queue and
   * no reason it was not being raised.
   */
  readonly parked?: ReadonlyMap<string, string>;
  /**
   * What was dropped while the queue was being built — unreadable threads, priorities
   * written by roles that may not set them. The daemon says these every tick; a frame
   * that swallowed them would show a queue ordered by a statement nobody honoured and
   * look exactly like a queue that was.
   */
  readonly queueNotes: readonly string[];
  /**
   * The rate-limit windows that are closed right now (D-3 part 2). In the frame and not
   * only in the daemon's stream because the two questions differ: the stream answers
   * "why did this tick raise nobody", the frame answers "why has nothing happened for an
   * hour" — and that second one is asked by somebody who was not watching the stream.
   */
  readonly quota?: readonly QuotaShelf[];
  readonly digests: readonly InstanceDigest[];
  readonly unreadableDigests?: ReadonlyMap<string, string>;
  /** This box's instance id, when the topology declares one. */
  readonly self?: string | undefined;
  readonly mail: MailFreshness & { readonly root: string };
};

/**
 * The state of the circuit in words. Every line answers a question an operator asks
 * in front of a contour that raised nobody, and each is a fact on disk rather than an
 * inference: the gate, the two flags, and whether anything is watching.
 */
export const renderCircuit = (circuit: CircuitState): string => {
  const gate =
    circuit.reboot === undefined
      ? `launches: ${circuit.launchesEnabled ? "enabled" : "disabled"}`
      : `launches: ${circuit.launchesEnabled ? "enabled" : "disabled"} · reboot mode ${circuit.reboot}${
          circuit.reboot === "manual"
            ? " — after a reboot the daemon is brought up BY HAND"
            : " — the unit brings the daemon up after a reboot"
        }`;
  const daemon =
    circuit.daemonPid !== undefined
      ? `daemon: pid ${circuit.daemonPid}, alive`
      : circuit.pidFilePresent
        ? "daemon: NOT RUNNING — the pid file names a process that is gone ('orchestrator up' starts one)"
        : "daemon: not running — no pid file ('orchestrator up' starts one)";
  return [
    "circuit:",
    `  ${gate}`,
    `  stop flag: ${circuit.stopFlag ? "PRESENT — the daemon stops on its next tick ('orchestrator up' clears it)" : "absent"}`,
    `  force flag: ${circuit.forceFlag ? "PRESENT — the live session is put down and nobody is raised" : "absent"}`,
    `  ${daemon}`,
  ].join("\n");
};

/**
 * Who would be raised next, and why. The order is not recomputed here — it is
 * `orderCandidates`' output rendered by `describeOrder`, the very lines the daemon
 * prints each tick, so the queue a human reads is the queue the circuit follows.
 */
export const renderQueue = (
  queue: readonly RankedCandidate[],
  notes: readonly string[] = [],
  parked: ReadonlyMap<string, string> = new Map(),
): string => {
  const lines = ["queue:"];
  if (queue.length === 0) {
    lines.push("  nobody is waiting on a role this box raises");
  } else {
    for (const line of describeOrder(queue, parked)) lines.push(`  ${line}`);
  }
  for (const note of notes) lines.push(`  ⚠ ${note}`);
  return lines.join("\n");
};

/**
 * THE LIVE COUNT AND WHAT IT IS SPENT ON (D-4). Three facts in a fixed order, and the
 * zero case is spoken as loudly as the busy one: "nobody is live" in front of a queue
 * with work in it is the shape of a circuit that has stopped raising, and an operator
 * must be able to read it without counting lease lines.
 *
 * The FREE roles are named, not just counted. A number answers "is there room"; the
 * names answer the question actually asked in front of a stalled contour — "room for
 * WHOM" — and that is the one that gets acted on.
 */
export const renderParallelism = (p: Parallelism): string => {
  const capacity = p.raisable.length;
  const busy = new Set(p.live.map((view) => view.role));
  const heldHere = p.raisable.filter((role) => p.held.includes(role));
  const free = p.raisable.filter((role) => !busy.has(role) && !heldHere.includes(role));
  // FREE IS ONE SUBTRACTION, NOT TWO WORDINGS (reviewer, PR #100): a hold is capacity
  // spent whether or not anything is live, so the zero case says "all free" only when
  // nothing is held — otherwise the head counted the held role as room and the very
  // next line called it taken.
  const head =
    p.live.length > 0
      ? `parallelism: ${busy.size} of ${capacity} role(s) live`
      : heldHere.length === 0
        ? `parallelism: nobody is live — ${capacity} role(s) this box raises, all free`
        : `parallelism: nobody is live — ${capacity} role(s) this box raises, ${free.length} free, ${heldHere.length} held by a human`;
  const lines = [head];
  for (const view of p.live) {
    lines.push(`  ▶ ${view.role}×${view.thread} — ${view.state}`);
  }
  if (p.live.length > 0 || heldHere.length > 0) {
    // Where the room went is named, not implied: busy, held, or both.
    const spent = [
      busy.size > 0 ? "busy" : undefined,
      heldHere.length > 0 ? "held by a human" : undefined,
    ]
      .filter((word) => word !== undefined)
      .join(" or ");
    lines.push(
      `  free: ${free.length === 0 ? `none — every role this box raises is ${spent}` : free.join(", ")}`,
    );
  }
  if (heldHere.length > 0) {
    lines.push(`  held by a human: ${heldHere.join(", ")} — not the circuit's to raise (S5)`);
  }
  return lines.join("\n");
};

/**
 * THE CLOSED WINDOWS, one line each. The open case is spoken too — "the window is open"
 * is the answer to "is the box standing down?", and a section that only appears when the
 * news is bad teaches a reader to conclude nothing from its absence.
 */
export const renderQuota = (shelves: readonly QuotaShelf[] = []): string =>
  shelves.length === 0
    ? "quota:\n  no window is closed — the circuit raises on the ordinary rules"
    : ["quota:", ...shelves.map((shelf) => `  ⏸ ${describeQuotaShelf(shelf)}`)].join("\n");

/** Whole minutes, for an age a human reads rather than counts. */
const ageWords = (seconds: number): string =>
  seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;

/**
 * How old the mail on disk is — the age of the QUEUE and of the DIGESTS above, which
 * are computed off this checkout. Two facts, one verdict (curator's correction 5):
 * fresh means pulled recently AND landed; anything else is marked, saying which half
 * failed. A reader never repairs this — see the doc block of `mailCheckoutFreshness`.
 */
export const renderFreshness = (
  mail: MailFreshness & { readonly root: string },
  now: Date,
  staleAfterSeconds = 300,
): string => {
  const parts: string[] = [];
  if (mail.fetchedAt === undefined) {
    parts.push("never pulled (no FETCH_HEAD)");
  } else {
    const age = Math.max(0, Math.round((now.getTime() - mail.fetchedAt.getTime()) / 1000));
    parts.push(
      age > staleAfterSeconds
        ? `⚠ STALE — last pulled ${ageWords(age)} ago (is a daemon alive?)`
        : `pulled ${ageWords(age)} ago`,
    );
  }
  if (mail.behind === undefined) {
    parts.push("behind unknown");
  } else if (mail.behind > 0) {
    parts.push(
      `⚠ ${mail.behind} commit(s) BEHIND origin — the fetch did not land, the queue above is that old`,
    );
  }
  if (mail.problem !== undefined) parts.push(`⚠ ${mail.problem}`);
  return `mail on disk: ${mail.root}\n  ${parts.join(" · ")}`;
};

/**
 * THE FRAME — the whole live view, in the order a watch is read: who is running, how
 * much of the box that spends (D-4), who is parked, what the circuit is able to do, who
 * is next, what the neighbours say, and how old all of that is. `status` prints exactly this and then adds its static
 * sections; `--watch` prints exactly this and nothing else. That is what makes "the
 * frame never differs from `status` by a line" a construction and not a promise.
 */
export const renderFrame = (frame: OperatorFrame): string =>
  [
    renderStatus(frame.leases),
    renderParallelism(frame.parallelism),
    renderHolds(frame.holds),
    renderCircuit(frame.circuit),
    renderQuota(frame.quota),
    renderQueue(frame.queue, frame.queueNotes, frame.parked),
    renderInstances({
      digests: frame.digests,
      ...(frame.unreadableDigests === undefined ? {} : { unreadable: frame.unreadableDigests }),
      ...(frame.self === undefined ? {} : { self: frame.self }),
      now: frame.now,
    }),
    renderFreshness(frame.mail, frame.now),
  ].join("\n");
