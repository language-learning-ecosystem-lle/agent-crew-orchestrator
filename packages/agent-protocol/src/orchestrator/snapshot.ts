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
import { DEFAULT_PAIRS_PER_ROLE } from "../config/config.js";
import type { MailFreshness } from "../fs/git.js";
import type { HeldMailLock } from "../thread/checkout-lock.js";
import { type AuthShelf, describeAuthShelf } from "./auth.js";
import {
  type CodeAgeView,
  describeCodeDrift,
  describeUnpublishedCode,
  describeUnreadableCodeAge,
} from "./code-age.js";
import { chooseAccount, type DeclaredAccount } from "./failover.js";
import type { HoldView } from "./hold.js";
import { renderHolds } from "./hold.js";
import type { InstanceDigest } from "./instances.js";
import { renderInstances } from "./instances.js";
import { CLAUDE_CODE, kindOf } from "./kind.js";
import type { LeaseView } from "./lease.js";
import { describeGhOutage, type GhOutage, ghAlarmDue } from "./outage.js";
import type { RankedCandidate, RoleElsewhere, SpentCeiling } from "./priority.js";
import { describeOrder, spentCeilings } from "./priority.js";
import { describeQuotaShelf, type QuotaShelf } from "./quota.js";
import { type ResidentWait, renderResidentWaits } from "./resident.js";
import { stateWord, timeLeftWord } from "./state-word.js";
import { renderStatus } from "./status.js";
import type { RunningPair } from "./tick.js";

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
 * The degree of parallelism was never a parameter WHILE IT WAS ONE PER ROLE: the capacity was
 * the number of roles this box raises, because a role had one workspace (R17) and a second
 * session in it was refused at the door. Since thread 177 the number is DECLARED
 * (`parallelism.pairsPerRole` of the config, v27) and the workspace is keyed by the pair, so
 * the capacity is a fact the config states rather than one the file system enforces. What has
 * not changed is the only question an operator has in front of a running circuit — which part
 * of it is spent — and that is why the numbers are one line and not three sections.
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
  /**
   * HOW MANY PAIRS OF ONE ROLE MAY BE LIVE AT ONCE — `parallelism.pairsPerRole` of the config
   * (v27, thread 177), carried so the queue rows below can tell "the role's places are FULL"
   * from "the role is doing something and has room left".
   *
   * Optional, and absent means the config's own default rather than "no ceiling": a frame
   * built by a reader that has not read the config says what it always said, and a caller
   * cannot make the row silent by forgetting the number.
   */
  readonly pairsPerRole?: number | undefined;
  /**
   * HOW MANY PAIRS THIS BOX MAY RUN AT ONCE, SUMMED ACROSS ITS ROLES —
   * `parallelism.pairsPerInstance` of the config (v27, thread 177), carried for the same
   * reason as the number above: the head of this block counts PLACES, and a renderer that
   * read the config itself would be a second source of the number the tick counts to
   * (`describeSkip`, `box-busy`).
   *
   * Absent means the project declared no `parallelism` at all — the schema refuses half a
   * declaration (v27), so a box with no ceiling of its own is a box at one pair per role,
   * and the places are then the roles. Not "no ceiling".
   */
  readonly pairsPerInstance?: number | undefined;
};

export type OperatorFrame = {
  readonly now: Date;
  readonly leases: readonly LeaseView[];
  /**
   * THE THREADS THAT ARE OVER (thread 016), from the same scan the queue is built from —
   * a lease line whose thread is closed keeps its row and loses its `⚠ EXHAUSTED` mark,
   * because a mark is a call to a hand and a closed thread has nothing to call one for.
   * Absent for a reader with no mail in its hands; the frame then reads as it always did.
   */
  readonly closedThreads?: ReadonlySet<string>;
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
   * Of those, the ones that ask NOBODY — a park that is a MODE and not a question
   * (`modeParks`, thread 063). Absent, the frame says what is true of both parks; the two
   * are told apart only where the fact is actually available, never guessed.
   */
  readonly modeParked?: ReadonlySet<string>;
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
  /**
   * THE BOX'S OWN CREDENTIALS (thread 023, the OAuth episode) — absent when they work.
   * Beside the windows rather than inside them: both stand the circuit down and only one
   * of them ends by itself.
   */
  readonly auth?: readonly AuthShelf[] | undefined;
  /**
   * WHOSE ACCOUNT EACH DECLARED ID IS (`accounts.<id>.kind`, thread 026, П3-3) — carried
   * in the frame because the shelf above dictates a repair and the repair belongs to the
   * kind, while this module holds no config and may not learn to read one.
   */
  readonly accountKinds?: Readonly<Record<string, string>> | undefined;
  /**
   * WHAT THIS MACHINE DECLARES ABOUT ITS ACCOUNTS (`accounts` of the machine config) — the
   * same half of the join the tick judges a fall-back chain by, carried so `shelvedRoles`
   * can ask the tick's own question instead of a weaker one of its own. It is the CONFIG
   * READING the frame already does for `accountKinds` above and not a new statement about a
   * pair: the mark on the queue row is still computed here, out of sections this frame
   * carries. A box that declares nothing hands nothing, and a chain is then judged exactly
   * as `chooseAccount` judges one on a box with no declarations.
   */
  readonly accounts?: Readonly<Record<string, DeclaredAccount>> | undefined;
  /**
   * THE RUNS WHOSE VENDOR SESSION ID IS NOT ON DISK YET (thread 063, §2.2; curator's answer
   * of 2026-09-02 on `restore`), by the path of their own log — a `running` pair whose child
   * has not said its first word. The MARK is computed in `renderLeaseLine`, out of this fact
   * and the state the row already prints; what travels here is only what a file system was
   * asked (`existsSync` of `sessionIdPath`), because a reader of a frame may not touch a
   * disk and the layer that fills the frame already does.
   *
   * Absent, every row reads exactly as it did before — the same rule the two fields above
   * live by: a state whose signal is not in hand is not invented.
   */
  readonly speechless?: ReadonlySet<string> | undefined;
  /**
   * WHO HOLDS THE MAIL CHECKOUT RIGHT NOW (thread 063, §2.2; curator's answer of 2026-09-02
   * on `save`), verbatim as the record lies on disk and with the liveness of its pid already
   * MEASURED (`readMailLock`). One lock for the whole box, so a session still writing its own
   * memory after a handoff is the answer to "why is every other delivery slow" — and the pair
   * it belongs to reads `released · completed` while it lasts.
   *
   * A machine fact and nothing else: the holder string is what its writer wrote, and which
   * row (if any) it belongs to is decided in the renderer. Absent — the lock is free, or was
   * not asked about — and every row reads as it did before.
   */
  readonly mailLock?: HeldMailLock | undefined;
  /**
   * The run of `gh` refusals in the merge-ready tier (thread 051), read from the file the
   * daemon writes. Undefined means the tier answered on the last tick that asked it.
   */
  readonly ghOutage?: GhOutage | undefined;
  /**
   * THE ROLES THIS CIRCUIT NEVER RAISES, and the threads waiting on one (R23-1) — in
   * the FRAME since T-1 (thread 019), where until now it was printed beside the frame
   * by `status` alone. "A thread waits on a role nobody will pick up" is a live fact of
   * exactly the class the frame exists for ("silent ≠ idle"), and a fact visible in
   * `status` but not in the observer is the divergence the shared frame was built to
   * make impossible. The residents are MARKED, never filtered (R23-1).
   *
   * Absent when the project declares no resident roles — there is no question to answer,
   * and the mail is not scanned for a section that would not be printed.
   */
  readonly residents?: {
    readonly roles: readonly string[];
    readonly waits: readonly ResidentWait[];
  };
  /**
   * THE CODE THE LIVE DAEMON IS RUNNING, when there is something to say about it
   * (023.2, `codeAgeView`). Present only while a daemon is alive — a vintage left by a
   * process that is gone describes nothing that is happening, and the circuit section
   * above already says the daemon is not there — and absent when the live daemon's own
   * code IS the ref, because good news repeated every frame is noise.
   */
  readonly codeAge?: CodeAgeView | undefined;
  readonly digests: readonly InstanceDigest[];
  readonly unreadableDigests?: ReadonlyMap<string, string>;
  /** This box's instance id, when the topology declares one. */
  readonly self?: string | undefined;
  /** Declared instances with no roles — their old digest is a bench, not an alarm (055). */
  readonly benchedInstances?: readonly string[];
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
  /** Which of those parks ask nobody (`modeParks`, thread 063) — carried, not re-decided. */
  modeParked: ReadonlySet<string> = new Set(),
  /** What each role is spending its places on (threads 063/177) — role → its live pairs and its hold. */
  busy: ReadonlyMap<string, RoleElsewhere> = new Map(),
  /** Roles whose every account is shelved (thread 063) — role → the window that reopens first. */
  shelved: ReadonlyMap<string, string> = new Map(),
  /** Pairs the box has stopped raising (thread 140) — carried, not re-derived. */
  outOfAttempts: ReadonlyMap<string, SpentCeiling> = new Map(),
  /**
   * The ceiling the rows judge "full" by (`parallelism.pairsPerRole`, thread 177). Carried
   * through rather than read here: this renderer is pure and a config read inside it would be
   * a second source of the number the planner already counts to.
   */
  pairsPerRole?: number,
): string => {
  const lines = ["queue:"];
  if (queue.length === 0) {
    lines.push("  nobody is waiting on a role this box raises");
  } else {
    for (const line of describeOrder(
      queue,
      parked,
      modeParked,
      busy,
      shelved,
      outOfAttempts,
      pairsPerRole,
    ))
      lines.push(`  ${line}`);
  }
  for (const note of notes) lines.push(`  ⚠ ${note}`);
  return lines.join("\n");
};

/**
 * WHY A ROLE IN THE QUEUE IS NOT GOING TO BE RAISED — role id → what it is doing instead
 * (thread 063, §2.3 row 2).
 *
 * Two different things read as one row in this frame until it existed: a pair standing because
 * ITS ROLE HAS NO PLACE LEFT, and a pair standing for no reason at all. The daemon says the
 * first out loud in a skip line; the operator's frame has no skip lines, so the two looked
 * identical there — and the second one is a defect while the first one is the circuit working
 * exactly as designed.
 *
 * EVERY LIVE PAIR IS KEPT, NOT THE LAST ONE (thread 177). The value used to be one sentence
 * about one session, because a role had one workspace and could not hold two; `busy.set(role, …)`
 * inside a loop over `parallelism.live` was therefore lossless by construction. With
 * `parallelism.pairsPerRole` above one it silently overwrites: measured 2026-09-09 with
 * `dev-core` live on two threads, the map came back with a single entry and the FIRST pair was
 * gone — after which the row compared its own thread against a stranger's, the count the row
 * needs was off by one, and neither could be repaired by rewording the sentence.
 *
 * A LIVE SESSION AND A HOLD ARE NAMED APART, because they are repaired apart: the first ends by
 * itself, the second ends when a human gives the role back. They are two FIELDS and not two
 * writes to one, for the same loss: a role can be both held and live, and the last writer used
 * to decide which of the two an operator was told about. An ACTIVE hold only — an expired one
 * is not capacity spent, and `renderHolds` already says so two blocks above.
 *
 * THE THREADS OF THE LIVE SESSIONS RIDE ALONG (thread 063, states 4/5) so the row can compare
 * its own against all of them — the whole difference between "the role's places are spent" and
 * "the mail handed the turn back to a session that is still running". The hold carries none: it
 * is not a session standing on a thread, and inventing one would be the frame guessing.
 */
export const busyRoles = (
  parallelism: Parallelism,
  holds: readonly HoldView[] = [],
): ReadonlyMap<string, RoleElsewhere> => {
  const live = new Map<string, RunningPair[]>();
  for (const view of parallelism.live) {
    const mine = live.get(view.role) ?? [];
    // NO `since`: a `LeaseView` carries the DEADLINE of its run, not the moment it was
    // raised, and "since" derived from a deadline would be a time this frame made up.
    // `describeOccupants` leaves the clause out when it is not told — the same silence the
    // planner's refusal keeps.
    mine.push({ role: view.role, thread: view.thread });
    live.set(view.role, mine);
  }
  const busy = new Map<string, RoleElsewhere>();
  for (const [role, pairs] of live) busy.set(role, { live: pairs });
  for (const hold of holds) {
    if (!hold.active) continue;
    busy.set(hold.role, { live: busy.get(hold.role)?.live ?? [], heldBy: hold.by });
  }
  return busy;
};

/**
 * WHY A ROLE IN THE QUEUE IS NOT GOING TO BE RAISED, SECOND ANSWER — role id → the window
 * that holds it and when it reopens (thread 063, §2.2 state 3: "held by quota").
 *
 * IT IS A MARK BUILT OUT OF SECTIONS THE FRAME ALREADY CARRIES, not a new fact asked of the
 * caller (curator's answer of 2026-09-02): the shelves are `frame.quota` — the very ones
 * `renderQuota` prints two blocks up — and the chain rides on the candidate, so the queue row
 * and the shelf list cannot come to say different things about one subscription.
 *
 * THE PREDICATE IS THE TICK'S OWN, `chooseAccount`, and not a re-derivation of it: "shelved"
 * is not "some window is closed" but "every link of this role's chain is closed", and a frame
 * that answered the first would call a role held while the tick raised it on a spare. Measured
 * before the mark existed: the signal was never missing — `tick.ts` pushes `skipped` with the
 * reason `quota` and the journal takes `launch-refused` — it just never reached the operator's
 * frame, which has no skip lines at all.
 *
 * The named window is the FIRST TO REOPEN of the shut chain (`chooseAccount`'s own `until`),
 * because that is the moment the pair can move, and a row naming any other shelf would send
 * the reader to wait out a door the role is not standing at.
 */
export const shelvedRoles = (
  now: Date,
  queue: readonly RankedCandidate[],
  shelves: readonly QuotaShelf[] = [],
  /** What the machine declares about its accounts — the same half of the join the tick judges a chain by. */
  accounts?: Readonly<Record<string, DeclaredAccount>> | undefined,
): ReadonlyMap<string, string> => {
  const held = new Map<string, string>();
  if (shelves.length === 0) return held;
  for (const candidate of queue) {
    if (held.has(candidate.role)) continue;
    const choice = chooseAccount({
      ...(candidate.account === undefined ? {} : { primary: candidate.account }),
      ...(candidate.fallback === undefined ? {} : { fallback: candidate.fallback }),
      worker: candidate.worker ?? CLAUDE_CODE.id,
      ...(accounts === undefined ? {} : { accounts }),
      shelves,
    });
    if (choice.kind === "paused") held.set(candidate.role, describeQuotaShelf(choice.until, now));
  }
  return held;
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
 *
 * THE HEAD COUNTS PLACES, NOT ROLES (thread 177, curator's acceptance of 2026-09-09).
 * It counted roles — `new Set(live.map(v => v.role))` — which was lossless while a role
 * had one workspace and could not hold two. Measured on the merged tree of #359 with
 * `pairsPerRole: 2`: TWO live pairs of `dev-core` and ONE live pair of `dev-core` print
 * the same head (`1 of 3 role(s) live`) and the same `free:` line, and the two states
 * differ in what the box has left — no place for that role in the first, one place in the
 * second. The operator was left to count the `▶` rows by hand, which is the very thing
 * D-4 exists to spare them.
 *
 * AND THE TWO NUMBERS ARE NOT ONE. `raisable.length` and `parallelism.pairsPerInstance`
 * are both 3 in the field config of this box today, and they answer different questions —
 * how many roles this run may raise (R13, narrowed by the operator's flags) and how many
 * pairs the box may hold at once. Each is printed with the word that names it, so a
 * reader who does not know the code tells them apart by the text and not by the accident
 * of the values agreeing.
 *
 * WHAT IS STILL COUNTED IN ROLES, on purpose: a hold is taken on a ROLE (S5) — a human
 * takes `curator`, not one of `curator`'s places — and `free:` names roles because "room
 * for WHOM" is answered by a name to raise, not by a number.
 */
export const renderParallelism = (p: Parallelism, now?: Date): string => {
  const roles = p.raisable.length;
  const pairsPerRole = p.pairsPerRole ?? DEFAULT_PAIRS_PER_ROLE;
  // The places this run could spend. With no declared `parallelism` the box has no
  // ceiling of its own and every role holds one pair, so the places ARE the roles — the
  // number this block has always printed, under a word that now says what it counts.
  const places = p.pairsPerInstance ?? roles * pairsPerRole;
  // How many of a role's own places are live — the count `free:` judges room by. A role
  // with one live pair out of two allowed is neither busy nor free-by-the-old-rule, and
  // that is exactly the state the old subtraction had no name for.
  const spentBy = new Map<string, number>();
  for (const view of p.live) spentBy.set(view.role, (spentBy.get(view.role) ?? 0) + 1);
  const heldHere = p.raisable.filter((role) => p.held.includes(role));
  // THE BOX CEILING IS A SEPARATE DOOR FROM THE ROLE'S (v27): a role can have a place
  // left while the box has none, and `describeSkip` already tells those two apart in the
  // daemon's stream (`role-busy` against `box-busy`). A `free:` line naming a role the
  // tick cannot raise this minute would send the reader to wait for a launch that is not
  // coming.
  //
  // ONLY WHERE THE BOX HAS A CEILING OF ITS OWN. With no declared `parallelism` the places
  // ARE the roles, so "the box is full" and "every role is busy" are one state said twice —
  // and of the two wordings the role one is the one that names somebody to go and look at.
  const boxFull = p.pairsPerInstance !== undefined && p.live.length >= places;
  /** Places of its OWN this role has left — the quantity `free:` judges a name by. */
  const roomFor = (role: string): number => Math.max(0, pairsPerRole - (spentBy.get(role) ?? 0));
  const free = boxFull
    ? []
    : p.raisable.filter((role) => roomFor(role) > 0 && !heldHere.includes(role));
  /**
   * HOW MUCH ROOM THE NUMBER IN THE HEAD IS ABOUT, AND IT IS THE SAME ARITHMETIC THE LIST
   * BELOW IS BUILT FROM (reviewer, PR #362). It was a second, independent formula —
   * `places - live - held × pairsPerRole` — and with a declared `pairsPerInstance` the two
   * disagreed in the open: `nobody is live — 3 place(s), 1 free` printed directly above
   * `free: dev-core, dev-acme`, two names under the number one. One state, two answers, in
   * one frame, which is the very defect this block was rewritten to remove.
   *
   * IT IS THE SMALLER OF TWO CEILINGS, because a place is only room if somebody may take
   * it: what the BOX has left (`pairsPerInstance` minus what is live) and what the roles
   * NAMED on the `free:` line could take between them. Either alone lies — the box number
   * counts room no raisable role may use, the roles' number counts room the box will not
   * give out.
   *
   * A HOLD IS NO LONGER SUBTRACTED AS SPENT CAPACITY, and that reverses no earlier ruling
   * of PR #100: there the number counted ROLES, and a held role plainly was not a free
   * role. This number counts PLACES of the box, and a hold spends none of them — nothing
   * is live. What the hold does is take its role off the `free:` line, and that is exactly
   * how it enters this number now: through the list, not beside it.
   */
  const freePlaces = Math.min(
    Math.max(0, places - p.live.length),
    free.reduce((sum, role) => sum + roomFor(role), 0),
  );
  // Where the capacity comes from, in the words of the config that declares it — and the
  // roles named as roles beside it, so the two numbers never stand bare next to each other.
  const spread =
    p.pairsPerInstance === undefined
      ? `one place per role, ${roles} role(s) this box raises — the project declares no 'parallelism'`
      : `'parallelism.pairsPerInstance', spread over ${roles} role(s) this box raises at up to ${pairsPerRole} pair(s) each`;
  // FREE IS ONE SUBTRACTION, NOT TWO WORDINGS (reviewer, PR #100): a hold is capacity
  // spent whether or not anything is live, so the zero case says "all free" only when
  // nothing is held — otherwise the head counted the held role as room and the very
  // next line called it taken.
  const head =
    p.live.length > 0
      ? `parallelism: ${p.live.length} of ${places} place(s) live — ${spread}`
      : heldHere.length === 0
        ? `parallelism: nobody is live — ${places} place(s), all free (${spread})`
        : // A HOLD TAKES ITS ROLE OFF THE `free:` LINE (S5): a human takes `curator`, not
          // one of `curator`'s two seats, and the circuit raises none of them until it is
          // given back. The number beside it is `freePlaces` — the same arithmetic the
          // list is built from, so the head and the line under it cannot disagree.
          `parallelism: nobody is live — ${places} place(s), ${freePlaces} free, ${heldHere.length} role(s) held by a human (${spread})`;
  const lines = [head];
  for (const view of p.live) {
    // THE SAME VOCABULARY AS THE LINE ABOVE THIS BLOCK (thread 063). This renderer printed
    // the raw lifecycle word while `status` two sections up already translated it, so one
    // frame said `draining` and `working past handoff` about one pair — and the list john
    // read the word in on 2026-08-30 was this one.
    const left = now === undefined ? "" : timeLeftWord(view, now);
    lines.push(
      `  ▶ ${view.role}×${view.thread} — ${stateWord(view.state, view.reason)}${left === "" ? "" : `, ${left}`}`,
    );
  }
  if (p.live.length > 0 || heldHere.length > 0) {
    // Where the room went is named, not implied: busy, held, or both — and the box
    // ceiling is named apart from either, because it is the one reason a role with a
    // place of its own left is still not raisable.
    const spent = [
      spentBy.size > 0 ? "out of places of its own" : undefined,
      heldHere.length > 0 ? "held by a human" : undefined,
    ]
      .filter((word) => word !== undefined)
      .join(" or ");
    const none = boxFull
      ? `none — the ceiling of this BOX is full, ${p.live.length} of ${places} place(s) live ('parallelism.pairsPerInstance'); a role of it may still be idle`
      : `none — every role this box raises is ${spent}`;
    lines.push(`  free: ${free.length === 0 ? none : free.join(", ")}`);
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
export const renderQuota = (now: Date, shelves: readonly QuotaShelf[] = []): string =>
  shelves.length === 0
    ? "quota:\n  no window is closed — the circuit raises on the ordinary rules"
    : ["quota:", ...shelves.map((shelf) => `  ⏸ ${describeQuotaShelf(shelf, now)}`)].join("\n");

/**
 * THE BOX'S CREDENTIALS, one line. Spoken in the open case too, for the reason the windows
 * are: the reader's question is "why is nothing running", and a section that only appears
 * on bad news teaches them to conclude nothing from its absence.
 */
export const renderAuth = (
  shelves: readonly AuthShelf[] = [],
  /**
   * WHOSE ACCOUNT EACH SHELVED ID IS, as this box declares it (`accounts.<id>.kind`,
   * thread 026, П3-3) — the shelf line dictates a login, and a login is the kind's
   * word. An id absent from the map keeps the answer this line gave before the field
   * existed; the map is never guessed at, because a wrong login reads as the shelf lying.
   */
  kinds: Readonly<Record<string, string>> = {},
): string =>
  shelves.length === 0
    ? "auth:\n  the box authenticates — no run has died on the vendor's credentials since its last delivery"
    : [
        "auth:",
        ...shelves.map((shelf) => {
          const declared = kinds[shelf.account];
          const kind = declared === undefined ? undefined : kindOf(declared);
          return `  ⏸ ${kind === undefined ? describeAuthShelf(shelf) : describeAuthShelf(shelf, kind)}`;
        }),
      ].join("\n");

/**
 * THE MERGE-READY TIER, and the ONE section of the frame that is silent when the news is
 * good — the opposite of the rule the two above follow, decided by the test that came
 * before it ("a frame that grew a line because GitHub was quiet would be worse than no
 * tier at all"): the tier fails OPEN, so its healthy state is INDISTINGUISHABLE from a
 * circuit that has no tier at all, and printing a line about it every frame would be
 * printing a line about nothing. A refusal that has RUN — that is news, and it says the
 * threshold BESIDE THE COUNT (`describeGhOutage`), because a bare "6 ticks" is a number
 * the reader would have to go and look up the meaning of.
 *
 * "A REFUSAL THAT HAS RUN" IS THE SAME PREDICATE THE ALARM RINGS ON — `ghAlarmDue`, and
 * not "an outage object exists" (reviewer's finding 1 on #161). One flaky call put a line
 * into the frame under the earlier reading, which is precisely the line this section
 * exists NOT to grow; the frame and the phone now say the same thing at the same moment,
 * and the state below the threshold lives in the state file the daemon writes.
 */
export const renderMergeReady = (outage?: GhOutage): string =>
  outage === undefined || !ghAlarmDue(outage)
    ? ""
    : `merge-ready:\n  ⚠ ${describeGhOutage(outage)}`;

/**
 * THE SECOND SECTION THAT IS SILENT WHEN THE NEWS IS GOOD, and for the reason the
 * merge-ready tier is (`renderMergeReady` above): a daemon running current code is the
 * ordinary state, and a line repeating it every frame is a line the reader learns to
 * skip — which is how the six-hour silence of 2026-08-03 stayed invisible in the first
 * place. The gate is `codeAge` being present at all — and it is present for every state
 * except a measured match, which is the point: not knowing is not good news.
 *
 * THE WORDS ARE THE DAEMON'S OWN in every state that has a counterpart in the stream
 * (`describeCodeDrift`, `describeUnreadableCodeAge` — the tick calls the same two), so
 * the stream and the frame cannot say different things. `unpublished` has no counterpart
 * by construction: a process that published nothing is not a process that can complain
 * about it. `unreadable` HAD no counterpart here and did have one in the stream, which is
 * exactly how the two came to disagree (#190 review, 2026-08-03) — the frame drew silence
 * over an unresolvable ref while the tick was naming it.
 */
export const renderCodeAge = (view: CodeAgeView | undefined, now: Date): string => {
  if (view === undefined) return "";
  const said =
    view.kind === "drift"
      ? describeCodeDrift(view.drift, now)
      : view.kind === "unpublished"
        ? describeUnpublishedCode(view.pid)
        : describeUnreadableCodeAge(view.problem);
  return `code: ⚠ ${said}`;
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
 * THE FRAME — the whole live view, in the order a watch is read: who is running, how
 * much of the box that spends (D-4), who is parked, what the circuit is able to do, who
 * is next, what the neighbours say, and how old all of that is. `status` prints exactly this and then adds its static
 * sections; `--watch` prints exactly this and nothing else. That is what makes "the
 * frame never differs from `status` by a line" a construction and not a promise.
 */
export const renderFrame = (frame: OperatorFrame): string =>
  [
    renderStatus(frame.leases, frame.closedThreads, frame.now, frame.speechless, frame.mailLock),
    renderParallelism(frame.parallelism, frame.now),
    renderHolds(frame.holds),
    renderCircuit(frame.circuit),
    // Beside the circuit, because it is a fact ABOUT the daemon named just above — and
    // dropped rather than joined as a blank line when the code is current, exactly like
    // the merge-ready tier below.
    renderCodeAge(frame.codeAge, frame.now) || undefined,
    renderQuota(frame.now, frame.quota),
    renderAuth(frame.auth, frame.accountKinds),
    // The empty string a quiet tier renders is dropped here rather than joined as a
    // blank line: the gate is `renderMergeReady`'s alone, so the frame and the section
    // cannot disagree about when the tier is news.
    frame.ghOutage === undefined ? undefined : renderMergeReady(frame.ghOutage) || undefined,
    renderQueue(
      frame.queue,
      frame.queueNotes,
      frame.parked,
      frame.modeParked,
      // FROM THE FRAME'S OWN TWO SECTIONS, not from a new field (thread 063, §2.3 row 2): the
      // live pairs and the holds are already here, printed two blocks above, and a queue row
      // that promised a launch the box cannot make was the one reading that contradicted them.
      // Computed here rather than by the caller so the three sections cannot disagree.
      busyRoles(frame.parallelism, frame.holds),
      // AND FROM THE SHELF LIST SIX LINES ABOVE, for the same reason (thread 063, §2.2 state 3):
      // `renderQuota` and this row are two readings of one fact, and the second one is the one
      // read in front of a stalled contour. The declared accounts ride in the frame already —
      // `renderAuth` dictates a login off them — so no new field enters the frame for this mark.
      shelvedRoles(frame.now, frame.queue, frame.quota, frame.accounts),
      // AND FROM THE LEASES THE FIRST SECTION IS PRINTED FROM (thread 140), by the rule the
      // two marks above follow: the frame already holds the fold, and a queue row that reads
      // like a promise of a launch for a pair the box will never raise is the one reading that
      // contradicts what `renderStatus` says three blocks up.
      spentCeilings(frame.leases),
      // AND THE CEILING FROM THE SECTION THAT ALREADY CARRIES THE CAPACITY (thread 177), by
      // the same rule as the three marks above: `renderParallelism` prints the places and
      // this row judges whether they are spent, and two readings of one number is how the
      // frame comes to refuse a launch the tick is about to make.
      frame.parallelism.pairsPerRole,
    ),
    // Beside the queue, because it is the same question answered for the pairs that are
    // NOT in it: `renderResidentWaits` returns nothing when the project has no resident
    // roles, and that undefined is dropped rather than printed as a blank section.
    frame.residents === undefined
      ? undefined
      : renderResidentWaits({ residents: frame.residents.roles, waits: frame.residents.waits }),
    renderInstances({
      digests: frame.digests,
      ...(frame.unreadableDigests === undefined ? {} : { unreadable: frame.unreadableDigests }),
      ...(frame.self === undefined ? {} : { self: frame.self }),
      ...(frame.benchedInstances === undefined ? {} : { benched: frame.benchedInstances }),
      now: frame.now,
    }),
    renderFreshness(frame.mail, frame.now),
  ]
    .filter((section): section is string => section !== undefined)
    .join("\n");
