/**
 * Launching a role as a session — the core of step S1 (thread 012). The pure
 * part: WHO may be launched, with WHICH prompt and WHETHER it is allowed right
 * now (the ceilings). The `claude -p` spawn itself and the journal write live in
 * the CLI above this (where the IO is).
 *
 * The three requirements of curator (thread 012, msg 14:15) are closed here by
 * construction:
 *  1. the prompt is assembled from the role's `instructions` — `buildLaunchPrompt`,
 *     no "role → this particular file" in the code;
 *  2. the journal write happens BEFORE the spawn — `planLaunch` returns the
 *     `lease-acquired`+`launch` events, which the CLI writes BEFORE starting the
 *     process;
 *  3. one thread per run — both the decision and the prompt take exactly one
 *     `thread`.
 *
 * The ceiling comes in two layers (both against "launch → break → launch ate the
 * quota"), and both count runs in a row since the last DELIVERY — the same word, from
 * the same predicate (`isDelivery` in `lease.ts`): a `completed` release OR a handoff:
 *  - per (role, thread) pair: we reuse `exhausted` from S0 — `MAX_ATTEMPTS` failures
 *    since that pair last delivered;
 *  - global: `consecutiveLaunchesWithoutDelivery` for the S3 auto loop — no more than
 *    `MAX_CONSECUTIVE_RUNS` launches in a row since ANY pair delivered.
 *
 * They agree since 2026-07-26 (curator's decision, thread 016). Until then the global
 * one reset on `completed` only, and its cost was known and stated here: a run of
 * "handed off, then the supervisor died" (`supervisor-gone` after a handoff, no
 * `completed`) walked the counter to its ceiling even though every one of those runs
 * delivered — a whole auto loop stopped for someone else's crash, the same class of
 * defect the per-pair counter had been fixed for a day earlier, and a global gate is
 * not a different class from a per-pair one just because it is wider.
 *
 * Both are operator flags (`--max-attempts`, `--max-runs`) resolved with their source
 * by `resolveGates`: until 2026-07-26 the first was a constant no flag could reach,
 * and a ceiling nobody can move or attribute is indistinguishable from a bug.
 */
import type { LocalConfig } from "../config/local.js";
import {
  claudeCodeEffortSchema,
  type Launch,
  type LaunchLimits,
  type Role,
} from "../roles/schema.js";
import { denySettings } from "../roles/zones.js";
import { type DeliveryMarks, NO_DELIVERY_MARKS, pairKey } from "../thread/index-doc.js";
import type { LaunchDirective } from "../thread/message.js";
import { DEFAULT_IDLE_MS } from "./activity.js";
import type { Continuation } from "./continuation.js";
import { DEFAULT_WAIT_INPUT_SECONDS } from "./interactive.js";
import { eventTimestamp, MAX_ATTEMPTS, type OrchestratorEvent, type World } from "./journal.js";
// TYPE-ONLY, AND THAT IS THE WHOLE POINT: `kind.ts` is built on this module, so a value
// imported from it here would close a runtime cycle. A type is erased at build.
import type { AgentKind } from "./kind.js";
import { foldLeases, isDelivery, isLeaseAlive, isSelfTurnDelivery } from "./lease.js";

/**
 * The ceiling of the global auto loop: how many runs in a row WITHOUT A SINGLE
 * DELIVERY the orchestrator may launch before it stops and calls a human (curator's
 * requirement). A healthy system delivers its runs; a batch of launches with nothing
 * handed over is precisely the break loop burning quota. Calibratable.
 */
export const MAX_CONSECUTIVE_RUNS = 10;

/**
 * THE ROLES OF THE CEILINGS after idle detection arrived (R6 part 3, thread 016) and
 * the interactive turn made a fourth of them (R19). Each catches a different failure
 * — before R6 the wall clock was doing three jobs badly at once:
 *
 *  - `stalled` (the idle ceiling, `activity.ts`) — the MAIN catcher of a hang: a
 *    session that produces no traces at all;
 *  - `--wall-clock` — the backstop against the opposite failure, a session that
 *    stays busy forever (circling and burning quota produces traces, so only an
 *    absolute limit and `--max-runs` hold it). Its default is RAISED from 15 to 60
 *    minutes: it is no longer the instrument that notices a hang, and at 15 minutes
 *    it was cutting live work — both breaks on 2026-07-25 were sessions that were
 *    working, not stuck;
 *  - `--max-turns` — a ceiling on the length of the dialogue, not on time. The
 *    default of 60 was calibrated for short packages, and a mechanically large one
 *    (the R1 translation) hit it mid-work: `Reached max turns (60)`, a run lost to a
 *    limit that protects nothing here. 300 is the value john ran the real packages
 *    at by hand.
 *  - `--wait-input` (R19) — the ceiling of a DECLARED WAIT for input, and the reason
 *    it is a fourth clock rather than a share of the wall clock: the two measure
 *    different things and must fail differently. Time spent waiting for a human is
 *    not time the session was given to work, so it does not come out of the work
 *    window (the fold shifts the deadline by it) and it has its own refusal,
 *    `input-timeout`.
 *
 * They are defaults, not policy: every one of them is a flag, and since R12 also a
 * per-role field of the config (`launch.limits`) — see `resolveCeilings` below.
 */
export const DEFAULT_WALL_CLOCK_SECONDS = 3600;
export const DEFAULT_MAX_TURNS = 300;

/**
 * HOW LONG BEFORE THE DEADLINE A SESSION IS EXPECTED TO START WINDING DOWN (R20,
 * john's decision) — the one ceiling of the four that is a NORM rather than a
 * mechanism: nothing fires at this point, it is what the session was asked to do on
 * its own, and the wall clock behind it only catches whoever ignored it.
 *
 * WHY IT IS DERIVED FROM THE WALL CLOCK AND NOT A CONSTANT. Winding down costs what it
 * costs — commit, write the state into the thread, push, pass the turn — but a fixed
 * fifteen minutes would be a quarter of an hour-long window and the WHOLE of a
 * ten-minute probe. A share with two stops keeps it proportionate at both ends:
 *  - 20% of the window, so a longer run gets a longer landing;
 *  - never more than 15 minutes — beyond that it is not landing, it is idling;
 *  - never less than 2 minutes — below that the norm cannot physically be met, and a
 *    norm nobody can meet teaches sessions to ignore it.
 * An hour (the default window) lands on 12 minutes, inside the 10–15 curator asked for.
 *
 * The number is calibratable from both sides: `--wind-down` for one run,
 * `launch.limits.windDownSeconds` for a role that always needs longer (a role that
 * finishes by pushing a branch and waiting for CI, say).
 */
export const WIND_DOWN_SHARE = 0.2;
export const WIND_DOWN_MIN_SECONDS = 120;
export const WIND_DOWN_MAX_SECONDS = 900;

export const defaultWindDownSeconds = (wallClockSeconds: number): number =>
  // The last `min` is for windows shorter than the floor (a two-minute probe): the
  // margin can never exceed the window itself, or the arithmetic would put the landing
  // point before the launch.
  Math.min(
    wallClockSeconds,
    Math.min(
      WIND_DOWN_MAX_SECONDS,
      Math.max(WIND_DOWN_MIN_SECONDS, Math.round(wallClockSeconds * WIND_DOWN_SHARE)),
    ),
  );

/**
 * WHAT THE SESSION IS TOLD ABOUT ITSELF (R7, thread 016) — the launch contract's
 * environment half. Two variables, and they are shaped differently on purpose:
 *
 *  - `AGENT_PROTOCOL_WORKER` carries a VALUE (`claude-code`): the supervisor knows
 *    what it is about to raise before it raises it;
 *  - `AGENT_PROTOCOL_SESSION_FILE` carries a PATH, because the value does not exist
 *    yet. A session id is minted by the agent itself and first appears in the init
 *    line of its stream, seconds after the spawn — and the environment of a running
 *    process cannot be amended. So the supervisor promises a file and fills it in.
 *
 * `new-message` reads both, so a raised session records its provenance without being
 * asked to remember anything. The same pair is where a lease deadline would go when
 * graceful wind-down is taken up (curator, deferred out of R6).
 */
export const LAUNCH_ENV = {
  worker: "AGENT_PROTOCOL_WORKER",
  sessionFile: "AGENT_PROTOCOL_SESSION_FILE",
  /**
   * THE CEILING OF ITS OWN WAIT (R19), so that the session's clock and the
   * supervisor's cannot disagree: `await-input` defaults its timeout to this number.
   * The session's clock starts FIRST (it begins waiting; the supervisor notices at the
   * next poll), so with the same number the session always expires first and gets its
   * turn back to wrap up — the supervisor's ceiling stays as the backstop for a wait
   * that never returns at all.
   */
  waitSeconds: "AGENT_PROTOCOL_WAIT_SECONDS",
  /**
   * WHEN THIS RUN'S LEASE RUNS OUT (R20), ISO, as materialised by `planLaunch`. Until
   * it existed a session had no way of knowing its own deadline — the acceptance run of
   * 012 found `--wall-clock` being read out of a leaked `npm_lifecycle_script`, which is
   * not a channel, it is a coincidence. A session that cannot see the end of its window
   * cannot wind down before it, and every long run ended by being cut off.
   *
   * A VALUE, not a path, even though R19 can MOVE it: the deadline exists at the spawn,
   * and a run that parks gets time ADDED (the fold shifts it by the wait). So the value
   * handed over is a floor — never later than the truth — and a session that trusts it
   * literally winds down early rather than late. `await-input` says how much the window
   * moved when the answer comes back, which is the one moment it changes.
   */
  leaseDeadline: "AGENT_PROTOCOL_LEASE_DEADLINE",
} as const;

/**
 * What the orchestrator says it is raising. A DEFAULT rather than a config field:
 * the shape of a per-role launch section is R12's question (curator, 15:25), and
 * `--worker` is the same kind of override as `--exec` beside it — the one place
 * where "which binary" and "what to call it" belong together.
 */
export const DEFAULT_WORKER = "claude-code";

/**
 * WHERE ONE CEILING CAME FROM. Printed beside the number, and that is the whole
 * reason the source is carried at all: a run cut short at 15 minutes is a different
 * fact depending on whether the project asked for that or the package did, and
 * until R12 the output said only "timeout".
 */
export type CeilingSource = "flag" | "role" | "default";

export type Ceiling = {
  /** Seconds for the two clocks, a count of turns for the third — the unit belongs to the field, not here. */
  readonly value: number;
  readonly source: CeilingSource;
};

export type ResolvedCeilings = {
  readonly idle: Ceiling;
  readonly wallClock: Ceiling;
  readonly maxTurns: Ceiling;
  /** The ceiling of a declared wait for input (R19). */
  readonly waitInput: Ceiling;
  /**
   * How long before the deadline the session is expected to start landing (R20). The
   * odd one out: `source: "default"` here means DERIVED FROM THE RESOLVED WALL CLOCK,
   * not a package constant — so overriding the window alone moves the landing point
   * with it, and a role does not have to restate both.
   */
  readonly windDown: Ceiling;
};

/**
 * THE THREE CEILINGS OF A RUN, resolved once (R12, curator's statement of work,
 * thread 016) — the flag of the operator, then the role's `launch.limits`, then the
 * package default.
 *
 * WHY THAT ORDER. The flag is the most specific statement there is: a human typed
 * it for THIS run, usually because this run is not like the others (a mechanically
 * large package, a probe with a stub). The config is the project's standing
 * calibration, and the default is what a project that has said nothing gets. The
 * reverse order would make the config unoverridable and turn every exception into
 * an edit of a committed file.
 *
 * WHY A PURE FUNCTION AND NOT THREE `??` IN THE CLI. The three ceilings are read in
 * two places (`run` and the daemon's launch branch), and the daemon resolves them
 * PER ROLE inside the loop — with the numbers inlined, the manual path and the
 * autonomous one would drift the moment one of them gained a fourth source. It also
 * makes the source printable, which the inline form cannot be.
 *
 * `idleSeconds: 0` survives on purpose: zero is a meaningful value (the detector
 * off), so the fall-through tests for `undefined` rather than for falsiness.
 */
export const resolveCeilings = (input: {
  readonly flags: {
    readonly idleSeconds?: number;
    readonly wallClockSeconds?: number;
    readonly maxTurns?: number;
    readonly waitInputSeconds?: number;
    readonly windDownSeconds?: number;
  };
  readonly limits?: LaunchLimits;
  readonly defaults?: {
    readonly idleSeconds: number;
    readonly wallClockSeconds: number;
    readonly maxTurns: number;
    readonly waitInputSeconds: number;
  };
}): ResolvedCeilings => {
  const defaults = input.defaults ?? {
    idleSeconds: DEFAULT_IDLE_MS / 1000,
    wallClockSeconds: DEFAULT_WALL_CLOCK_SECONDS,
    maxTurns: DEFAULT_MAX_TURNS,
    waitInputSeconds: DEFAULT_WAIT_INPUT_SECONDS,
  };
  const pick = (
    flagValue: number | undefined,
    roleValue: number | undefined,
    fallback: number,
  ): Ceiling => {
    if (flagValue !== undefined) return { value: flagValue, source: "flag" };
    if (roleValue !== undefined) return { value: roleValue, source: "role" };
    return { value: fallback, source: "default" };
  };
  const wallClock = pick(
    input.flags.wallClockSeconds,
    input.limits?.wallClockSeconds,
    defaults.wallClockSeconds,
  );
  return {
    idle: pick(input.flags.idleSeconds, input.limits?.idleSeconds, defaults.idleSeconds),
    wallClock,
    maxTurns: pick(input.flags.maxTurns, input.limits?.maxTurns, defaults.maxTurns),
    waitInput: pick(
      input.flags.waitInputSeconds,
      input.limits?.waitInputSeconds,
      defaults.waitInputSeconds,
    ),
    // The fall-through is COMPUTED from the window resolved just above (R20): whoever
    // shortens a run to ten minutes with a flag has not thereby asked for a landing
    // longer than the run, and would not think to say so.
    windDown: pick(
      input.flags.windDownSeconds,
      input.limits?.windDownSeconds,
      defaultWindDownSeconds(wallClock.value),
    ),
  };
};

/**
 * The ceilings in one line, for the operator and for the session log. It is printed
 * on EVERY launch rather than only when something is unusual: "which window this
 * run had" is the first question asked of a break, and the answer must be in the
 * log of that run, not in whoever's shell history.
 */
export const describeCeilings = (ceilings: ResolvedCeilings): string =>
  [
    `idle ${ceilings.idle.value === 0 ? "off" : `${ceilings.idle.value}s`} (${ceilings.idle.source})`,
    `wall-clock ${ceilings.wallClock.value}s (${ceilings.wallClock.source})`,
    `max-turns ${ceilings.maxTurns.value} (${ceilings.maxTurns.source})`,
    `wait-input ${ceilings.waitInput.value}s (${ceilings.waitInput.source})`,
    `wind-down ${ceilings.windDown.value}s before the deadline (${ceilings.windDown.source})`,
  ].join(" · ");

/**
 * THE TWO GATES OF THE LOOP — how many failed attempts one pair gets
 * (`--max-attempts`) and how many launches in a row the circuit gets without a
 * single delivery (`--max-runs`). They are ceilings on LAUNCHING, not on a run,
 * which is why they are resolved apart from `ResolvedCeilings`; everything else about
 * them follows R12 — a flag beats the default, and the source is printed beside the
 * number.
 *
 * WHY `role` NEVER COMES OUT OF HERE YET. The gates have no field in `launch.limits`:
 * the config's ceilings describe a RUN (its clocks and its turns), while these two
 * describe how the orchestrator treats a PAIR and the circuit as a whole. Adding them
 * to the role config costs a schema version, and nobody has asked for a per-role
 * attempt ceiling — when someone does, it slots in here exactly like `resolveCeilings`
 * does it, and `describeGates` starts printing `role` with no other change.
 */
export type ResolvedGates = {
  readonly maxAttempts: Ceiling;
  readonly maxConsecutive: Ceiling;
};

export const resolveGates = (input: {
  readonly flags: {
    readonly maxAttempts?: number;
    readonly maxRuns?: number;
  };
  readonly defaults?: {
    readonly maxAttempts: number;
    readonly maxRuns: number;
  };
}): ResolvedGates => {
  const defaults = input.defaults ?? {
    maxAttempts: MAX_ATTEMPTS,
    maxRuns: MAX_CONSECUTIVE_RUNS,
  };
  const pick = (flagValue: number | undefined, fallback: number): Ceiling =>
    flagValue === undefined
      ? { value: fallback, source: "default" }
      : { value: flagValue, source: "flag" };
  return {
    maxAttempts: pick(input.flags.maxAttempts, defaults.maxAttempts),
    maxConsecutive: pick(input.flags.maxRuns, defaults.maxRuns),
  };
};

/**
 * The gates in one line, printed by the daemon at start-up and by `run`. The defect of
 * 2026-07-26 is the argument for printing them: an operator passed `--max-runs 20`
 * against a gate that was never reading it, and nothing in the output could have told
 * them so.
 */
export const describeGates = (gates: ResolvedGates): string =>
  [
    `attempts-per-pair ≤ ${gates.maxAttempts.value} (${gates.maxAttempts.source})`,
    `runs-without-delivery ≤ ${gates.maxConsecutive.value} (${gates.maxConsecutive.source})`,
  ].join(" · ");

/**
 * WHAT IS RAISED, FROM WHERE, AND WITH WHICH PARAMETERS (R14 + R15, thread 016) —
 * three resolutions that share one join key, and that is why they were built in one
 * pass. The key is the TOOL ID (`claude-code`): the role config says which tool
 * raises it and with what, the machine config says where that tool's binary is, and
 * a message header says which tool wrote it. One vocabulary, three uses.
 *
 * Each resolution follows the pattern R12 set for the ceilings — the operator's flag,
 * then the standing declaration, then the package default — and each one PRINTS ITS
 * SOURCE. The reason is unchanged and has been paid for: a run that behaved oddly is
 * a different fact depending on whether the project asked for it, the machine did, or
 * nobody did.
 */
export type WorkerSource = "flag" | "role" | "default";
/**
 * Where the binary path came from. `machine` is the R14 layer — the only one of the
 * four that is a path rather than a name.
 *
 * THERE IS NO `default` HERE, AND THAT IS THE POINT (thread 026). A package-wide
 * default named ONE vendor (`claude`), so a role declaring `kind: codex` on a box whose
 * machine config says nothing about codex was raised by the claude binary, and
 * preflight printed it as a TICK: `✓ agent: binary (codex): …/claude (default)`. The
 * last layer is now the KIND's own declaration, and the two answers it can give are
 * told apart by name, because they are different facts to a reader chasing a wrong
 * binary: `kind` — this package implements the tool and this is the name it declares;
 * `worker-id` — it does not, so the worker id itself is the guess being looked up.
 */
export type ExecSource = "flag" | "machine" | "kind" | "worker-id";
/**
 * The layers a launch parameter can come from, in the order they win (R21 adds the
 * middle one). `thread` is a directive from the feed of the thread this run is bound
 * to — an authorized role saying what the work from here on is to be raised with.
 *
 * WHY IT SITS UNDER THE FLAG AND OVER THE ROLE. The flag is still the most specific
 * statement there is: a human typed it for THIS run, at the terminal, usually because
 * this run is not like the others — and a directive written into a thread yesterday
 * must not override a decision taken about the run being started right now. The role
 * config is the opposite end: the project's standing calibration for every thread at
 * once, which is exactly what a per-thread directive exists to specialize.
 */
export type ParamSource = "flag" | "thread" | "role";

export type Resolved<T, S> = { readonly value: T; readonly source: S };
export type ResolvedWorker = Resolved<string, WorkerSource>;
export type ResolvedExec = Resolved<string, ExecSource>;

/**
 * THE BINARY OF `claude-code`, and of that kind only — it is what `CLAUDE_CODE.defaultExec`
 * is built from, not a fallback for tools that named nothing (thread 026: it was both, and
 * being both is how a codex role got spawned as claude).
 *
 * A machine that has the agent installed normally still needs no config at all: a bare
 * name is found on the child's `PATH`, which is what keeps the machine file honest as an
 * ANSWER to a problem rather than a tax.
 */
export const DEFAULT_EXEC = "claude";

/**
 * WHICH TOOL RAISES THIS ROLE. `--worker` was born as a provenance override ("what
 * the session calls itself in the messages it writes") and now also selects the
 * parameters and the binary — deliberately the same field, because they are the same
 * question asked three times. A run raises one tool; splitting the answer across two
 * flags would let a session write `claude-code` in its header while `cursor` did the
 * work.
 */
export const resolveWorker = (input: {
  readonly flag?: string;
  readonly launch?: Launch;
}): ResolvedWorker => {
  if (input.flag !== undefined) return { value: input.flag, source: "flag" };
  const kind = input.launch?.agent?.kind;
  if (kind !== undefined) return { value: kind, source: "role" };
  return { value: DEFAULT_WORKER, source: "default" };
};

/**
 * WHERE THAT TOOL'S BINARY IS — `resolveExec`, and it LIVES IN `kind.ts` (thread 026).
 * The last layer of that resolution is the KIND's own `defaultExec`, so the function
 * has to read the kind table; this module is what the kind table builds its argv from,
 * and importing it back here as a value would close a cycle. The type of its answer
 * stays here, with the other two resolutions of R14 it is read beside.
 */

/**
 * WHICH ACCOUNT THIS RUN SPENDS, AND WHERE IT LIVES (thread 055) — the second join
 * of R14 in this file, and it reads in the opposite direction from `resolveExec`.
 *
 * `exec` asks the machine a question the repository has no business answering (where
 * a binary is). The account asks BOTH: the repository names WHICH account
 * (`launch.account` — policy, it decides whose quota a role burns and a reviewer
 * sees it in a diff), the machine names WHERE that account's directory sits. Neither
 * file names the subscription itself.
 *
 * THE THREE ANSWERS ARE THREE DIFFERENT FACTS, and each is said in its own words:
 *  · nobody names an account — the run inherits the box's own, exactly as every
 *    run did before this field existed. Not an error, and not printed as one;
 *  · an account this box declares is named — that directory, said out loud
 *    beside the model and the effort;
 *  · an account this box does NOT declare is named — a refusal BY NAME. The
 *    quiet fall-back to the box's own account is the one answer that must not
 *    exist: it raises a role on a subscription nobody assigned it, and it looks
 *    from the outside exactly like a run that obeyed.
 *
 * WHO NAMES IT — TWO LAYERS, IN THE R21 ORDER (thread 055, the second half of B.2). The
 * ROLE's own `launch.account` wins; the INSTANCE's `instances[].account` is the
 * fall-back for every role of that box that named none. The default exists because the
 * unit a subscription is bought for is the project: on a box hosting two instances the
 * true sentence is "the crew instance runs on the second subscription", said once —
 * written per role it is the same sentence N times, and the N+1st role is then added
 * without it and quietly spends the other subscription.
 *
 * WHICH LAYER ANSWERED IS CARRIED, not just the answer, and it is printed on the launch
 * line: a default nobody can see is a default nobody can audit, and this one decides
 * whose money a run spends. The refusal names the layer too — "the role asks for 'x'"
 * and "this instance defaults to 'x'" send whoever reads it to two different files.
 */
export type AccountSource = "role" | "instance";

export type ResolvedAccount = {
  /** The id as the repository names it — a label, never the account itself. */
  readonly id: string;
  /** The directory this box keeps it in; goes to the session under the account variable of its kind. */
  readonly configDir: string;
  /** Which of the two layers named it — see above for why this travels with the answer. */
  readonly source: AccountSource;
  /**
   * WHOSE ACCOUNT THIS BOX SAYS IT IS (`accounts.<id>.kind`, thread 026, П3), when it
   * says anything at all. Carried rather than re-read because the four desks that
   * dictate a repair to a human hold the resolution and not the machine config.
   */
  readonly kind?: string;
};

export type AccountResolution =
  | { readonly ok: true; readonly account?: ResolvedAccount }
  | { readonly ok: false; readonly reason: string };

export const resolveAccount = (input: {
  readonly launch?: Launch;
  readonly local?: LocalConfig;
  /**
   * The default of the instance this box IS (`instances[].account`) — already picked by
   * the caller, because which instance a box is is the machine's answer (R14) and this
   * function is about the join, not about the topology.
   */
  readonly instanceAccount?: string;
  /**
   * THE TOOL THIS RUN WOULD BE RAISED AS, with the layer that said so (thread 026, П3).
   * Optional so that every caller that had no kind to give before this argument existed
   * behaves as it did: with nothing to compare, there is nothing to disagree about.
   */
  readonly worker?: ResolvedWorker;
}): AccountResolution => {
  const named =
    input.launch?.account !== undefined
      ? ({ id: input.launch.account, source: "role" } as const)
      : input.instanceAccount !== undefined
        ? ({ id: input.instanceAccount, source: "instance" } as const)
        : undefined;
  if (named === undefined) return { ok: true };
  const account = input.local?.accounts?.[named.id];
  const declared = account?.configDir;
  if (declared === undefined) {
    const who =
      named.source === "role"
        ? `the role is to be raised on account '${named.id}'`
        : `this instance defaults its roles to account '${named.id}' ('instances[].account')`;
    return {
      ok: false,
      reason: `${who}, and this machine declares no such account — say where it lives ('accounts.${named.id}.configDir' of the machine config) or the run would silently spend the box's own`,
    };
  }
  if (
    account?.kind !== undefined &&
    input.worker !== undefined &&
    account.kind !== input.worker.value
  ) {
    return {
      ok: false,
      reason: accountKindConflict({
        id: named.id,
        accountKind: account.kind,
        configDir: declared,
        worker: input.worker,
      }),
    };
  }
  return {
    ok: true,
    account: {
      id: named.id,
      configDir: declared,
      source: named.source,
      ...(account?.kind === undefined ? {} : { kind: account.kind }),
    },
  };
};

/** Where a `--worker`/`agent.kind` answer came from, in the words its reader would grep for. */
const workerSaidBy: Readonly<Record<WorkerSource, string>> = {
  flag: "'--worker' on this command",
  role: "'launch.agent.kind' of the role's card",
  default: "the package default, nobody having named a kind",
};

/**
 * THE TWO HALVES OF THE JOIN DISAGREEING (thread 026, П3-2) — refused by name, and
 * never resolved by picking one.
 *
 * A quiet winner here is the same failure the missing-account refusal exists against,
 * one step further in: the run would be raised as one tool while pointed at the home
 * directory of another. Both plausible picks are wrong in their own way — obeying the
 * card spends a directory holding no credentials for that vendor (a run that dies on
 * auth and reads as a dead token), obeying the machine raises a tool the project never
 * assigned the role. Neither belongs to this package: WHICH tool raises a role is the
 * repository's statement, WHOSE account a directory holds is the machine's, and a
 * contradiction between two authorities is answered by naming both.
 *
 * THREE THINGS THE READER NEEDS, and the refusal carries exactly them: the kind the
 * run would take AND the layer that said so (the card and the flag are two different
 * files to open), the account with its declared kind, and the directory — which is the
 * fact that identifies which line of `local.json` is the other side of the argument.
 */
export const accountKindConflict = (input: {
  readonly id: string;
  readonly accountKind: string;
  readonly configDir: string;
  readonly worker: ResolvedWorker;
}): string =>
  `would be raised as '${input.worker.value}' (${workerSaidBy[input.worker.source]}) on account '${input.id}', which this machine declares as '${input.accountKind}' ('accounts.${input.id}.kind', directory '${input.configDir}'). The two halves of the join disagree and this box will not pick a winner: raising it would point one tool at another's home. Either name the same kind on both sides, or send the role to an account of its own kind`;

/**
 * THE DEFAULT OF THE BOX THIS IS — the R13 join, and the reason `resolveAccount` takes an
 * id rather than the topology: the repository declares the instances, the machine says
 * which of them it is, and this is the one line where those two facts meet.
 *
 * Both halves have to be there for an answer. A box that calls itself nothing (no
 * `instance` in the machine config) and a repository that declares no instances are both
 * legitimate states — the pre-R13 single-box shape — and neither is guessed into a
 * default: silence means the role's own field is the whole of the resolution.
 */
export const instanceAccountOf = (input: {
  readonly instances?:
    | readonly { readonly id: string; readonly account?: string | undefined }[]
    | undefined;
  readonly instance?: string | undefined;
}): string | undefined =>
  input.instance === undefined
    ? undefined
    : input.instances?.find((instance) => instance.id === input.instance)?.account;

/** The launch parameters of the resolved tool, each with the layer it came from. */
export type AgentParams = {
  readonly model?: Resolved<string, ParamSource>;
  readonly effort?: Resolved<string, ParamSource>;
};

export type AgentResolution =
  | { readonly ok: true; readonly params: AgentParams }
  | { readonly ok: false; readonly reason: string };

/**
 * THE PARAMETERS, AND THE DOOR THEY ARE REFUSED AT (R15). A parameter the tool does
 * not understand must not be dropped in silence: silence here means a run that cost
 * money and thought with settings nobody chose, and it looks exactly like a run that
 * obeyed them. Three refusals, all of that one shape:
 *
 *  - the role declares parameters for one tool while the run raises another (a
 *    `--worker` override contradicting `launch.agent.kind`) — that is not "this run
 *    is a bit different", it is a different contract;
 *  - `--model`/`--effort` typed for a tool the package cannot pass them to — which
 *    since thread 026 is asked OF THE KIND (`kind.cannot`, `buildArgv`) instead of
 *    compared against the string "claude-code". The literal comparison was written
 *    when there was one kind, and it outlived that: codex builds `-m` and
 *    `-c model_reasoning_effort=` in its own argv, and a door refusing them was the
 *    package lying about a tool it had already implemented;
 *  - an `--effort` level outside the tool's own vocabulary — the config path is
 *    guarded by the schema, and the flag path has to be guarded here or it would be
 *    the one way in.
 */
export const resolveAgentParams = (input: {
  readonly flags: { readonly model?: string; readonly effort?: string };
  readonly worker: ResolvedWorker;
  /**
   * THE KIND BEING RAISED, when the package implements one under that id (thread 026).
   * Passed in rather than looked up here on purpose: `kind.ts` is built ON this module
   * (`buildLaunchArgv`, `DEFAULT_WORKER`), so a runtime import back would be a cycle
   * whose first symptom is an initialisation order bug, not a compile error. The type
   * costs nothing — it is erased.
   *
   * `undefined` MEANS "an id this package does not implement", and that is a real
   * state: `--worker` has always been free-form provenance. Parameters are refused for
   * such an id by name, because there is no argv builder to pass them to.
   *
   * The key is REQUIRED and the value nullable, rather than an optional key: a caller
   * who forgets it would otherwise get the refusal meant for an unimplemented tool on
   * the one that raises this repository, and would get it at runtime instead of from
   * `tsc`.
   */
  readonly kind: AgentKind | undefined;
  readonly launch?: Launch;
  /**
   * THE DIRECTIVE IN FORCE ON THIS THREAD (R21) — already filtered by permission
   * (`resolveThreadDirective`), so what arrives here is a statement somebody was
   * entitled to make. It is a MERGE LAYER and not a refusal path: see below for why
   * this one is dropped with a word rather than refused when it makes no sense.
   */
  readonly directive?: LaunchDirective;
}): AgentResolution => {
  const declared = input.launch?.agent;
  const worker = input.worker.value;

  if (declared !== undefined && declared.kind !== worker) {
    return {
      ok: false,
      reason: `the role declares launch parameters for '${declared.kind}', but the run is being raised as '${worker}' (${input.worker.source}) — the parameters would be passed to a tool they were not written for, or dropped in silence`,
    };
  }

  const typed = input.flags.model !== undefined || input.flags.effort !== undefined;
  if (typed && input.kind === undefined) {
    return {
      ok: false,
      reason: `--model/--effort were given, but the run is being raised as '${worker}' — a kind this package does not implement, so there is no argv of its to pass them in`,
    };
  }
  // THE LEVER, ASKED OF THE KIND. `effort` stands in `cannot` of a tool that has no
  // such parameter at all; codex is not one of those (it spells effort as a config
  // override), and the day a kind without it arrives this refusal names the tool and
  // the flag instead of dropping the value into an argv that has nowhere to put it.
  if (input.flags.effort !== undefined && input.kind?.cannot.includes("effort") === true) {
    return {
      ok: false,
      reason: `--effort was given, but the run is being raised as '${worker}' (${input.worker.source}), which has no lever for effort — passing it would drop it in silence`,
    };
  }
  // THE VOCABULARY IS THE VENDOR'S, AND THE PACKAGE NOW KNOWS TWO OF THEM — so the door
  // asks the KIND for its levels instead of naming one tool (thread 026, П2-2). The
  // literal comparison against `claude-code` that stood here was written when there was
  // one vocabulary, and it had a price: `--effort max` on codex — a level of the OTHER
  // vendor — passed through unchecked and became a dead run with a spent lease, whose
  // error message came from a tool the operator was not reading. The list is printed, so
  // the refusal is also the answer.
  //
  // A kind that names NO list still passes the string through, and that is the same
  // honest state as before: the vendor with the list gives the worse message and the true
  // one. The config path stays guarded by the schema, which now carries both vocabularies.
  const levels = input.kind?.effortLevels;
  if (
    input.flags.effort !== undefined &&
    levels !== undefined &&
    !levels.includes(input.flags.effort)
  ) {
    return {
      ok: false,
      reason: `--effort '${input.flags.effort}' — allowed levels of '${worker}' are ${levels.join(", ")}`,
    };
  }

  // The kinds already agree (the mismatch above is fatal), so the role's parameters are
  // this run's parameters whatever the tool is; `effort` exists on the claude-code
  // member alone, which is why it is read through a presence check rather than a cast.
  const fromRole = declared;
  const roleEffort = fromRole !== undefined && "effort" in fromRole ? fromRole.effort : undefined;
  // A DIRECTIVE ADDRESSED TO ANOTHER TOOL IS DROPPED, NOT REFUSED (R21) — the one
  // asymmetry with the flag path above, and it is deliberate. A flag can be retyped;
  // a message cannot be unwritten, so refusing here would wedge the thread for good:
  // the role could never be raised on it again. The drop is announced by the caller
  // (`ignoredDirective`), so it is never a silent fall-back to something else.
  //
  // IT STAYS `claude-code`-ONLY WHILE THE FLAG PATH OPENED UP, and the asymmetry is
  // named rather than inherited: a directive is written as ONE statement (a model and
  // an effort together, by whoever holds `launch-params`), its effort is checked at the
  // writing door against the only vocabulary the package knows, and applying half of it
  // to a tool whose vocabulary is still an open question of thread 026 would be the
  // silent drop this module exists against. When that question is answered, this line
  // is where the answer lands.
  const fromThread = worker === DEFAULT_WORKER ? input.directive : undefined;
  const pick = <T extends string>(
    flagValue: T | undefined,
    threadValue: T | undefined,
    roleValue: T | undefined,
  ): Resolved<T, ParamSource> | undefined => {
    if (flagValue !== undefined) return { value: flagValue, source: "flag" };
    if (threadValue !== undefined) return { value: threadValue, source: "thread" };
    if (roleValue !== undefined) return { value: roleValue, source: "role" };
    return undefined;
  };
  // An effort level from the feed that the tool does not know is dropped for the same
  // reason and by the same rule as the whole directive: the door of the writer refuses
  // it while it can still be retyped, and whatever got in earlier (a message written by
  // hand, a value the vocabulary later lost) must not decide the run in silence.
  const threadEffort =
    fromThread?.effort !== undefined && claudeCodeEffortSchema.safeParse(fromThread.effort).success
      ? fromThread.effort
      : undefined;
  const model = pick(input.flags.model, fromThread?.model, fromRole?.model);
  const effort = pick(input.flags.effort, threadEffort, roleEffort);
  return {
    ok: true,
    params: {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    },
  };
};

/**
 * WHY A DIRECTIVE THAT WAS FOUND DID NOT REACH THE RUN — the words that go beside the
 * resolved parameters when the merge dropped one. Two cases, both of them the kind of
 * thing an operator learns about from a post-mortem otherwise: the thread is being
 * raised as a tool the parameters were not written for, and an effort level outside
 * the tool's vocabulary.
 */
export const ignoredDirective = (input: {
  readonly directive?: LaunchDirective;
  readonly worker: ResolvedWorker;
}): readonly string[] => {
  const directive = input.directive;
  if (directive === undefined) return [];
  const worker = input.worker.value;
  if (worker !== "claude-code") {
    return [
      `the thread's launch directive is NOT applied: the run is being raised as '${worker}' (${input.worker.source}), and the package knows how to pass model/effort to 'claude-code' only`,
    ];
  }
  if (
    directive.effort !== undefined &&
    !claudeCodeEffortSchema.safeParse(directive.effort).success
  ) {
    return [
      `the effort '${directive.effort}' from the thread's launch directive is NOT applied: the levels are ${claudeCodeEffortSchema.options.join(", ")}`,
    ];
  }
  return [];
};

/**
 * The launch line beside the ceilings: what is raised, from where, with what. Printed
 * on every launch for the same reason `describeCeilings` is — the first question of a
 * post-mortem is "what was this run actually given", and the answer belongs in the
 * log of that run.
 */
export const describeAgent = (input: {
  readonly worker: ResolvedWorker;
  readonly exec: ResolvedExec;
  readonly params: AgentParams;
  /** Thread 055: absent means the box's own account — which is what silence meant before. */
  readonly account?: ResolvedAccount;
}): string =>
  [
    `${input.worker.value} (${input.worker.source})`,
    `exec ${input.exec.value} (${input.exec.source})`,
    ...(input.account === undefined
      ? []
      : [`account ${input.account.id} (${input.account.source}, ${input.account.configDir})`]),
    ...(input.params.model === undefined
      ? []
      : [`model ${input.params.model.value} (${input.params.model.source})`]),
    ...(input.params.effort === undefined
      ? []
      : [`effort ${input.params.effort.value} (${input.params.effort.source})`]),
  ].join(" · ");

/** Why a role is NOT launched by the orchestrator — mechanically, not "claude.ai" by eye. */
export type LaunchBlock =
  | "inactive"
  /**
   * The role is hosted by a process that is already alive (R23-1). Told apart from
   * `wake-not-watch` on purpose: the rest of that reason means "the circuit cannot
   * raise this one", while a resident means "the circuit MUST NOT — somebody is
   * already doing it". A human reading a thread that is going nowhere needs the
   * difference: the first sends them to the config, the second to the resident's
   * process.
   */
  | "resident"
  | "wake-not-watch"
  | "no-instructions"
  | "external-instructions"
  | "no-launch-profile";

export type Launchability = { launchable: true } | { launchable: false; reason: LaunchBlock };

/**
 * Whether the orchestrator may launch a role as a session. The decision is taken
 * from MACHINE-MEANINGFUL fields (`status`, `wake`, `instructions[].kind`) and NOT
 * from `role.kind`: that one is a free-form project label ("claude.ai",
 * "gh-action") and the package does not interpret it (see the role schema doc
 * block). Hence:
 *  - `wake.mode === "resident"` — the role is hosted by a live process (R23-1): not a
 *    limitation of ours but somebody else's job, and the reason says so;
 *  - `wake.mode !== "watch"` otherwise — the role has no session of its own for us to
 *    raise: john (`self`, a human), reviewer-pr/github (`event`, woken by the platform)
 *    are not ours to spawn;
 *  - empty `instructions` — there is nothing to build a prompt from (that is
 *    dev-speech today): an honest refusal rather than a crash on a missing file;
 *  - `instructions` with `external` — the card is executed OUTSIDE (a skill on the
 *    chat side) and a local `claude -p` must not drive it. Note that this refusal
 *    is about ANY entry, not about the whole array, and that is what makes a role
 *    with two executors (a raised session AND a chat skill) impossible to express
 *    in one row: curator was such a role until R22 and was made launchable by
 *    moving the skill-only half OUT of the card, not by weakening this check.
 */
export const roleLaunchability = (role: Role): Launchability => {
  if (role.status !== "active") return { launchable: false, reason: "inactive" };
  // The resident check comes BEFORE the general one so that the reason a human reads is
  // the specific one: "already hosted" and "has no session of its own" are answered by
  // different people.
  if (role.wake.mode === "resident") return { launchable: false, reason: "resident" };
  if (role.wake.mode !== "watch") return { launchable: false, reason: "wake-not-watch" };
  const instructions = role.instructions ?? [];
  if (instructions.length === 0) return { launchable: false, reason: "no-instructions" };
  if (instructions.some((entry) => entry.kind === "external")) {
    return { launchable: false, reason: "external-instructions" };
  }
  // The permission profile is part of the launch contract: a role without one MUST
  // NOT be raised. The first production run showed what its absence leads to: the
  // session comes up, lives five minutes and exits having written nothing, because
  // it has nothing to write with. A default would be worse than a refusal —
  // "raised with permissions nobody assigned".
  if (role.launch === undefined) return { launchable: false, reason: "no-launch-profile" };
  return { launchable: true };
};

/**
 * The session launch arguments — ONE place where they are assembled, and it is
 * pinned by a test (curator's requirement 4). The P0 spike called the agent with
 * `--allowedTools` and stayed green while the code regressed: argv was pinned by
 * nothing, and the permissions fell out of the contract unnoticed. As long as the
 * argument list lives as an expression inside the spawn, it will fall out again
 * the same way.
 *
 * `--output-format stream-json --verbose` is part of the contract, not a display
 * preference (R6, thread 016). With the default format the agent prints its answer
 * ONCE, at the end of the run — so a session cut by a deadline or a turn ceiling
 * leaves nothing behind, and those are precisely the runs the log exists for. The
 * stream emits an event per step as the work happens; `--verbose` is what the
 * agent requires of `stream-json` in print mode.
 */
export type LaunchArgvInput = {
  readonly prompt: string;
  readonly maxTurns: string;
  readonly launch: Launch;
  /**
   * The resolved tool parameters (R15). Absent means "say nothing" rather than "pass
   * a default": the tool's own default is a value the package has no business
   * restating, and restating it would freeze today's default into our argv.
   */
  readonly params?: AgentParams;
  /**
   * THE SESSION BEING CONTINUED (R18). Present only when the continuation policy said
   * so, and it changes the run in two visible ways at once: `--resume` here, and a
   * short continuation prompt instead of the role card (`buildResumePrompt`). They are
   * assembled in the same place so that a resumed run cannot end up carrying the flag
   * with the wrong prompt or the prompt without the flag.
   */
  readonly resume?: string;
  /**
   * THE ZONE DENY RULES OF THE ROLE (door 1 of thread 020) — the session is raised
   * with them, so an edit outside the zone is refused by the tool at the moment it is
   * attempted rather than at the merge door. Empty (a role with no `zones`) means the
   * flag is not passed at all: a settings source that says nothing is still a settings
   * source, and it would shadow whatever the workspace configures on its own.
   */
  readonly denyRules?: readonly string[];
};

/**
 * The argv of a `claude-code` run. Reached through the kind contract
 * ({@link import("./kind.js").AgentKind}) rather than called by name from the
 * supervisor: every flag below is a claim about ONE vendor (thread 026, step 2).
 */
export const buildLaunchArgv = (input: LaunchArgvInput): string[] => {
  // THE WAIVER OF П1 IS NOT THIS TOOL'S TO TAKE. `launch.allowedTools` became optional in
  // the schema for kinds that have no such lever (thread 026, П1-1); claude-code has one,
  // and the doors above (the schema's own check, and the refusal of a card written for
  // another tool) are what keep an empty profile from arriving here. If one ever does, it
  // stops here loudly: passing no `--allowedTools` would raise the session that lives five
  // minutes and writes nothing, which is the defect this argv was pinned against.
  if (input.launch.allowedTools === undefined) {
    throw new Error(
      "a 'claude-code' run was assembled from a launch profile with no 'launch.allowedTools' — the waiver of thread 026 belongs to a kind with no such lever, and this tool has one; the run is refused rather than raised unable to write",
    );
  }
  const settings = denySettings(input.denyRules ?? []);
  return [
    ...(input.resume === undefined ? [] : ["--resume", input.resume]),
    "-p",
    input.prompt,
    "--allowedTools",
    input.launch.allowedTools.join(","),
    ...(settings === undefined ? [] : ["--settings", JSON.stringify(settings)]),
    "--max-turns",
    input.maxTurns,
    ...(input.params?.model === undefined ? [] : ["--model", input.params.model.value]),
    ...(input.params?.effort === undefined ? [] : ["--effort", input.params.effort.value]),
    "--output-format",
    "stream-json",
    "--verbose",
  ];
};

/** A role's permissions in one line — for the `status` display and the launch output. */
export const describeLaunch = (role: Role): string => {
  const profile = role.launch;
  if (profile === undefined) {
    const why = roleLaunchability(role);
    return why.launchable
      ? `${role.id}: no launch profile`
      : `${role.id}: not launched by the circuit (${why.reason})`;
  }
  // A PROFILE WITHOUT AN ALLOW-LIST SAYS SO, AND SAYS WHAT HOLDS IT INSTEAD (thread 026,
  // П1-2): a blank where the tools go would read as "no tools", which is the opposite of
  // what the card declares.
  return profile.allowedTools === undefined
    ? `${role.id}: no tool allow-list — held by ${leversHeldOutsideOf(profile)}`
    : `${role.id}: ${profile.allowedTools.join(", ")}`;
};

/** The words of the waiver for a display: what the card named, or the honest blank. */
const leversHeldOutsideOf = (profile: Launch): string =>
  profile.agent?.kind === "codex" && profile.agent.toolsHeldBy !== undefined
    ? profile.agent.toolsHeldBy
    : "nothing this config names";

export type InstructionDoc = { readonly path: string; readonly text: string };

/**
 * A TURN THAT ENDS, ENDS THE SESSION — the fact the runtime never tells the session,
 * stated in its prompt (curator's statement of work, thread 018).
 *
 * THE DEFECT IT CLOSES IS ESTABLISHED, NOT HYPOTHETICAL. Two autonomous runs out of two
 * on 2026-07-27 ended `exited-without-handoff` the same way: the session put the thing
 * it was waiting for (a reviewer verdict, a CI job) into a BACKGROUND task, finished its
 * turn with "I'll pick this back up when it reports" — and the notification arrived five
 * seconds later at a dead process. The log of the second one is unambiguous: 59 turns of
 * 300, 755s of 3600, exit 0. Ceilings had nothing to do with it; the session believed in
 * a resume-by-notification that does not exist in this runtime.
 *
 * WHY IT GOES IN THE PROMPT AND NOT IN A ROLE CARD. It is a property of the RUNTIME
 * every raised session lives in, not of any one project's way of working — the same
 * reason R19 is stated here (see `buildLaunchPrompt`): a role with no card at all is
 * still exposed to it. And it is the exact inverse of the line the prompt already
 * carries, "passing the turn is what ends the run": true both ways round, and only one
 * of the two directions was ever said out loud.
 *
 * WHY IT NAMES THE THIRD ENDING AS FORBIDDEN. "Block in the foreground" and "report and
 * pass the turn" are both already in the prompt, and the failing sessions had read them;
 * what they did was invent a third that reads like a reasonable blend of the two. A norm
 * that only lists the legal endings leaves that invention untouched, so the illegal one
 * is named in its own words.
 *
 * WHY THE FOREGROUND ENDING IS NARROWED TO THE SESSION'S OWN WORK (john's hard rule,
 * 2026-08-28, thread 037: "no role should ever wait for any run that is going to write
 * into the thread anyway"). The list of legal foreground waits used to read "a watch, a
 * command you run and wait out" without asking WHOSE job is being waited on — so the
 * prompt itself authorised the thing the rule forbids, and a session that sat in a CI run
 * could point at this paragraph. The field case: on 2026-08-28 curator labelled #83 and
 * stayed in the run; the labels for #81 and #82 — both green and ready — waited behind
 * that one session, because a role has ONE slot and a foreground wait holds it. The
 * outcome was going to arrive as an event either way (the norm above, thread 016), so the
 * wait bought nothing. Wording note: the ban is stated as its own sentence rather than by
 * deleting the examples, for the same reason the third ending is named out loud — the
 * sessions that get this wrong have read the legal list and reason by analogy from it.
 *
 * It is NOT repeated in `buildResumePrompt`: a resumed session already has this prompt
 * in its context (unlike the wind-down norm, whose NUMBER changes with the new lease).
 */
const runEndsNorm =
  "ENDING YOUR TURN ENDS THIS SESSION — there is no waking back up. When you stop with nothing queued, the process exits; anything that arrives afterwards (a background task finishing, a CI run, a reviewer's verdict) reaches a dead process, and no resume happens. So a run ends in exactly one of two ways: you WAIT IN THE FOREGROUND on a blocking call that holds the turn open (`cli await-input` above, or a command of YOUR OWN work you run and wait out), or you report in the thread and pass the turn on, leaving the waking-up to the circuit. Finishing your turn meaning to come back when something reports is never one of them — say what you are waiting for in the thread and hand the turn over instead. AND THE FOREGROUND ENDING IS NEVER FOR SOMEONE ELSE'S RUN: a CI job, a review round, a verdict on a PR you opened or labelled all report into the thread by themselves, so waiting one out here only burns the clock and holds your role's one slot against the queue. Started one? Say so in the thread, park on it (`--parked-on run:<N>` or `pr:<N>`) when nothing else can move, and pass the turn — the next tick reads the finished verdict.";

/**
 * THE NORM OF WINDING DOWN, in the session's own prompt (R20, john's decision) — the
 * part of R20 that does the actual work, because the two others only make it possible:
 * the deadline is in the environment and the wall clock stands behind it, but nobody
 * lands a run except the session itself.
 *
 * WHY IT IS A NORM AND NOT A MECHANISM. There is no supervisor gesture that can make a
 * session commit — a SIGTERM at the deadline is exactly what we have now, and what it
 * produces is the failure being fixed: two runs in two days (R1, R19) worked
 * productively to the last second and were cut off with a heap of uncommitted work.
 * Only the session knows what it is in the middle of, so only the session can decide
 * where to stop digging; what it lacked was the time and the instruction.
 *
 * WHY IT SAYS "COMMIT AS IT IS". The instinct at a deadline is to finish the thought
 * first — and that is precisely how the whole thing is lost instead. Committed
 * half-work with an honest report is worth more than a perfect uncommitted tree that
 * dies with the process, and the wording has to say so, or the norm reads as advice.
 *
 * IT IS SAID IN THE SAME BREATH AS R19 AND KEPT DISTINCT FROM IT, per curator: parking
 * for input is a PAUSE that the same session continues; winding down is an ENDING with
 * the turn passed on. Sharing a paragraph would blur the one difference that matters.
 */
const windDownNorm = (input: {
  readonly deadline: string;
  readonly windDownSeconds: number;
}): string =>
  [
    `YOUR RUN HAS A DEADLINE: ${input.deadline} (UTC; also in \`$${LAUNCH_ENV.leaseDeadline}\`, and \`date -u +%FT%TZ\` tells you the time now).`,
    `WINDING DOWN IS PART OF THE WORK: about ${Math.round(input.windDownSeconds / 60)} minutes before it, stop digging and land what you have — commit it AS IT IS (a partial commit beats a perfect tree that dies with the process), say in the thread what is done, what is not and what the next session should pick up, and pass the turn.`,
    "Being cut off at the deadline is a FAILURE, not a normal ending: everything uncommitted at that moment belongs to nobody. If your run parks for input, the window moves later by the time spent waiting — `await-input` tells you by how much when the answer arrives.",
    "This is not the same thing as parking for input above: parking is a pause your own session continues, winding down ends the run and passes the turn.",
  ].join(" ");

/**
 * The prompt for `claude -p` — from the role card (its `instructions`) and ONE
 * thread. Pure: the instruction texts are already read outside. "This thread
 * only" is stated firmly in the prompt: the S2 completion signal is bound to the
 * turn passing on that thread, and if a run handled the whole mailbox the
 * criterion would smear (curator's requirement 3).
 *
 * THE INTERACTIVE TURN IS STATED HERE, IN THE PROMPT (R19, requirement (а)): "need
 * input — say so and wait", with the threshold said out loud in the same breath. It
 * belongs in the package's own words rather than in a project's role card because the
 * MECHANISM is the package's (two commands and a marker), and because a capability
 * nobody was told about is a capability that does not exist — the session would go on
 * dying with its question, which is the whole failure R19 removes. What stays with the
 * project is when to use it, and its card may say more.
 */
export const buildLaunchPrompt = (input: {
  readonly role: string;
  readonly thread: string;
  readonly instructions: readonly InstructionDoc[];
  /** The lease deadline of THIS run (R20), ISO — the same value `planLaunch` materialised. */
  readonly deadline: string;
  /** How long before it the session is expected to start landing (R20). */
  readonly windDownSeconds: number;
}): string => {
  const cards = input.instructions.map((doc) => `# ${doc.path}\n\n${doc.text}`).join("\n\n---\n\n");
  return [
    `You are the \`${input.role}\` role of the agent-crew-orchestrator protocol. Your role card is below.`,
    "",
    `The turn was passed to you on thread \`${input.thread}\` — AND ON THAT ONE ONLY. Do NOT handle the rest of your mail: this run is bound to exactly one thread.`,
    "",
    "TWO COMMANDS ARE YOUR WHOLE INTERFACE TO THE MAIL (R3) — you never touch its files, its branch or its git yourself:",
    `- READ: \`cli thread show --thread ${input.thread}\` — the conversation in order (\`--tail <n>\` if it is long). It names any attachments in the folder;`,
    "- SEND: `cli new-message --thread <id> --from <your role> --expects <e> --waiting-on <who answers> --body-file <p> --write` — `--write` means SENT: the file, the commit and the push are one action, and a concurrent write is retried inside.",
    "",
    "Read the thread, carry out the statement of work and reply with a message at the end of it. `--waiting-on` is the FULL set of whoever is expected to act next, and passing the turn is what ends the run.",
    "",
    "IF YOU NEED INPUT IN THE MIDDLE OF THE TASK, SAY SO AND WAIT — do not die with the question. Send the question with `cli new-message --await-input` (name what is uncommitted and where exactly you stopped: the thread must stand on its own even if this session does not survive), then block on `cli await-input`. Your session stays alive with its context, and your working tree is untouched: you read the answer yourself and carry on. For a question at the END of the task this is NOT the cheaper path — there, answer, pass the turn and let the run finish.",
    "",
    runEndsNorm,
    "",
    windDownNorm(input),
    "",
    "--- ROLE CARD ---",
    "",
    cards,
  ].join("\n");
};

/**
 * THE PROMPT OF A RESUMED RUN (R18) — short, and it does NOT repeat the role card.
 *
 * The card is already in that session's context: that is the whole meaning of a
 * resume, and re-sending it would pay the tokens twice for the one thing continuing
 * was supposed to save. What the session cannot know by itself is the only thing said
 * here — that it was interrupted from outside, what has and has not moved underneath
 * it, and that the finish line is unchanged.
 *
 * THE THREAD MAY HAVE MOVED, AND THE PROMPT SAYS SO. Under john's narrowed rule
 * (2026-07-25) an answer arriving while the session was down does NOT block a resume —
 * it is the input the session was waiting for. Which means a resumed session can no
 * longer be told "nothing has moved" (the first version of this prompt said exactly
 * that, correctly for the rule it shipped with): it must go and read the tail of the
 * thread, or it will carry on past the very message it was raised to act on. What the
 * guard in `continuation.ts` HAS verified is narrower and is what is stated: nobody
 * wrote in its place, and its base has not moved.
 *
 * The last sentence is a repetition of the fresh prompt's, deliberately: the
 * completion signal is the turn being passed on THIS thread, and a continued session
 * that finished quietly instead would be recorded as a break.
 */
export const buildResumePrompt = (input: {
  readonly thread: string;
  /** How the previous attempt ended, in the journal's own vocabulary. */
  readonly reason: string;
  /** The deadline of THE NEW lease (R20) — a resumed run gets a fresh window, and its own landing. */
  readonly deadline: string;
  readonly windDownSeconds: number;
}): string =>
  [
    `Your previous session on thread \`${input.thread}\` was interrupted from the outside (${input.reason}) — this is that same session, resumed.`,
    "",
    "Your working directory is exactly as you left it, your base branch has not moved, and nobody has written in your place. THE THREAD MAY HAVE MOVED: read its tail before you carry on — a reply may have arrived while you were down, and acting on it is the work. Then carry on from where you stopped — do not start the work again, and do not take on the rest of your mail.",
    "",
    // The norm is repeated in full rather than assumed to be in context (R20): the
    // deadline is a NEW one — this lease is not the interrupted lease — and a resumed
    // session that lands by the old number would either stop far too early or, worse,
    // trust a moment that has already passed.
    windDownNorm(input),
    "",
    "The run is over once the reply is written at the end of the thread (`cli new-message`) and the turn is passed on.",
  ].join("\n");

/**
 * Launches in a row without a single DELIVERY. Every `launch` increments the counter,
 * a delivery (`isDelivery` — a `completed` release or a handoff) resets it. A
 * "launch → break" loop (releases with timeout/forced, nothing ever delivered)
 * accumulates — and that is what catches it.
 *
 * The reset used to hang on `completed` alone (curator's decision of 2026-07-26 brings
 * it in line with the per-pair ceiling, which was fixed for this four days earlier).
 * The turn passing IS the delivery, so a run of "the turn was passed, then the
 * supervisor died before it could write the release" drove the global counter to its
 * ceiling for someone else's crash — with the whole auto loop stopping, not one pair.
 * The name says "delivery" and not "completion" for the same reason: it is the word
 * `isDelivery` defines, and a counter whose name promises one rule while it applies
 * another is exactly how the two ceilings drifted apart.
 */
export const consecutiveLaunchesWithoutDelivery = (
  events: readonly OrchestratorEvent[],
  /** What the mail knows about deliveries (`isSelfTurnDelivery`, threads 023 and 021). */
  marks: DeliveryMarks = NO_DELIVERY_MARKS,
): number => {
  let count = 0;
  // The acquire each pair is currently inside — the left edge the SECOND delivery sign is
  // narrowed by (thread 021). Kept here rather than asked of the caller for the same reason
  // the lease fold keeps it: the journal states it, and a global counter that read the sign
  // without the window would zero itself on any old message of that role in that thread.
  const acquiredAt = new Map<string, string>();
  for (const event of events) {
    if (event.kind === "lease-acquired")
      acquiredAt.set(pairKey(event.role, event.thread), event.ts);
    if (event.kind === "launch") count += 1;
    else if (
      isDelivery(event) ||
      isSelfTurnDelivery(event, marks, acquiredAt.get(pairKey(event.role, event.thread)) ?? null)
    )
      count = 0;
    // THE CLOSED WINDOW TAKES ITS OWN LAUNCH BACK — the same reasoning that already
    // keeps it out of the per-pair `attempt` (`lease.ts`), applied to the ceiling it
    // was still reaching: the cause is not the pair's and not any pair's. It is
    // UNDONE rather than reset to zero, because a closed window is not a delivery: it
    // says nothing about the break loop of the other pairs, and erasing their history
    // would be inventing good news. Not doing this is what deadlocked the box on
    // 30.07 — the budget is reset by a delivery, a delivery is made by a session, and
    // a session is not raised while the budget is spent; it took a hand to break.
    else if (
      event.kind === "lease-released" &&
      (event.reason === "quota-exhausted" || event.reason === "auth-failed")
    ) {
      // A DEAD TOKEN TAKES ITS OWN LAUNCH BACK for the same reason a closed window does
      // (thread 023, the OAuth episode): the run never reached the work, the cause is the
      // box's and not any pair's, and leaving it counted is how the outage of 2026-08-01
      // walked the global budget towards the same deadlock — the budget is reset by a
      // delivery, a delivery is made by a session, and no session is raised on a spent
      // budget.
      count = Math.max(0, count - 1);
    }
  }
  return count;
};

export type LaunchRefusal = "already-running" | "exhausted" | "run-budget";

export type LaunchPlan =
  | { readonly ok: true; readonly deadline: string; readonly events: readonly OrchestratorEvent[] }
  | { readonly ok: false; readonly reason: LaunchRefusal };

/**
 * The launch decision + the events written BEFORE the spawn. A refusal if:
 *  - the pair is already active (`running`/`draining`) — we do not multiply runs;
 *  - the pair is `exhausted` — the attempt ceiling on (role, thread) is reached;
 *  - the global ceiling of runs without completion is used up.
 * Otherwise — `lease-acquired` (with a materialised `deadline`) + `launch`.
 */
export const planLaunch = (input: {
  readonly events: readonly OrchestratorEvent[];
  readonly role: string;
  readonly thread: string;
  readonly now: Date;
  readonly wallClockMs: number;
  readonly maxConsecutive?: number;
  /** The per-pair attempt ceiling (`--max-attempts`); the package default when absent. */
  readonly maxAttempts?: number;
  /**
   * How this run is being started and what it is starting from (R18). Recorded on the
   * `launch` event, which is written BEFORE the spawn — so the world a session saw is
   * on disk even if that session never gets to say anything at all, and the next
   * launch has something to compare against.
   */
  readonly continuation?: Continuation;
  readonly world?: World;
  /** Sessions that wrote into the mail (`isSelfTurnDelivery`, thread 023). */
  readonly deliveryMarks?: DeliveryMarks;
}): LaunchPlan => {
  const { events, role, thread, now, wallClockMs } = input;
  const maxConsecutive = input.maxConsecutive ?? MAX_CONSECUTIVE_RUNS;

  const view = foldLeases(events, now, input.maxAttempts, input.deliveryMarks).find(
    (v) => v.role === role && v.thread === thread,
  );
  // `isLeaseAlive` and not two comparisons: since R19 a lease also lives while it is
  // PARKED, and a parked pair is a launch candidate the moment its answer arrives —
  // the one moment when raising a second session would land it on top of a live one.
  if (view && isLeaseAlive(view.state)) {
    return { ok: false, reason: "already-running" };
  }
  if (view?.exhausted) return { ok: false, reason: "exhausted" };
  if (consecutiveLaunchesWithoutDelivery(events, input.deliveryMarks) >= maxConsecutive) {
    return { ok: false, reason: "run-budget" };
  }

  const ts = eventTimestamp(now);
  const deadline = eventTimestamp(new Date(now.getTime() + wallClockMs));
  const continuation = input.continuation;
  const events2: OrchestratorEvent[] = [
    { kind: "lease-acquired", ts, role, thread, deadline },
    {
      kind: "launch",
      ts,
      role,
      thread,
      ...(continuation === undefined ? {} : { mode: continuation.mode }),
      ...(continuation?.mode === "resume" ? { resumes: continuation.session } : {}),
      ...(input.world === undefined ? {} : { world: input.world }),
    },
  ];
  return { ok: true, deadline, events: events2 };
};
