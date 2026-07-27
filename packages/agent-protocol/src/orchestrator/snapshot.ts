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

export type OperatorFrame = {
  readonly now: Date;
  readonly leases: readonly LeaseView[];
  readonly holds: readonly HoldView[];
  readonly circuit: CircuitState;
  readonly queue: readonly RankedCandidate[];
  /**
   * What was dropped while the queue was being built — unreadable threads, priorities
   * written by roles that may not set them. The daemon says these every tick; a frame
   * that swallowed them would show a queue ordered by a statement nobody honoured and
   * look exactly like a queue that was.
   */
  readonly queueNotes: readonly string[];
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
): string => {
  const lines = ["queue:"];
  if (queue.length === 0) {
    lines.push("  nobody is waiting on a role this box raises");
  } else {
    for (const line of describeOrder(queue)) lines.push(`  ${line}`);
  }
  for (const note of notes) lines.push(`  ⚠ ${note}`);
  return lines.join("\n");
};

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
 * THE FRAME — the whole live view, in the order a watch is read: who is running, who
 * is parked, what the circuit is able to do, who is next, what the neighbours say,
 * and how old all of that is. `status` prints exactly this and then adds its static
 * sections; `--watch` prints exactly this and nothing else. That is what makes "the
 * frame never differs from `status` by a line" a construction and not a promise.
 */
export const renderFrame = (frame: OperatorFrame): string =>
  [
    renderStatus(frame.leases),
    renderHolds(frame.holds),
    renderCircuit(frame.circuit),
    renderQueue(frame.queue, frame.queueNotes),
    renderInstances({
      digests: frame.digests,
      ...(frame.unreadableDigests === undefined ? {} : { unreadable: frame.unreadableDigests }),
      ...(frame.self === undefined ? {} : { self: frame.self }),
      now: frame.now,
    }),
    renderFreshness(frame.mail, frame.now),
  ].join("\n");
