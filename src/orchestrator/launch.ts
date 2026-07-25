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
 * quota"):
 *  - per (role, thread) pair: we reuse `exhausted` from S0 — three breaks and we
 *    stop trying;
 *  - global: `consecutiveLaunchesWithoutCompletion` for the S3 auto loop — no more
 *    than `MAX_CONSECUTIVE_RUNS` launches in a row without a single `completed`.
 */
import type { LocalConfig } from "../config/local.js";
import {
  claudeCodeEffortSchema,
  type Launch,
  type LaunchLimits,
  type Role,
} from "../roles/schema.js";
import { DEFAULT_IDLE_MS } from "./activity.js";
import { eventTimestamp, type OrchestratorEvent } from "./journal.js";
import { foldLeases } from "./lease.js";

/**
 * The ceiling of the global auto loop: how many runs in a row WITHOUT a single
 * successful completion the orchestrator may launch before it stops and calls a
 * human (curator's requirement). A healthy system completes its runs; a batch of
 * launches without a `completed` is precisely the break loop burning quota.
 * Calibratable.
 */
export const MAX_CONSECUTIVE_RUNS = 10;

/**
 * THE ROLES OF THE CEILINGS after idle detection arrived (R6 part 3, thread 016).
 * There are three of them and they catch different failures — before R6 the wall
 * clock was doing all three jobs badly at once:
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
 *
 * They are defaults, not policy: every one of them is a flag, and since R12 also a
 * per-role field of the config (`launch.limits`) — see `resolveCeilings` below.
 */
export const DEFAULT_WALL_CLOCK_SECONDS = 3600;
export const DEFAULT_MAX_TURNS = 300;

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
  };
  readonly limits?: LaunchLimits;
  readonly defaults?: {
    readonly idleSeconds: number;
    readonly wallClockSeconds: number;
    readonly maxTurns: number;
  };
}): ResolvedCeilings => {
  const defaults = input.defaults ?? {
    idleSeconds: DEFAULT_IDLE_MS / 1000,
    wallClockSeconds: DEFAULT_WALL_CLOCK_SECONDS,
    maxTurns: DEFAULT_MAX_TURNS,
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
  return {
    idle: pick(input.flags.idleSeconds, input.limits?.idleSeconds, defaults.idleSeconds),
    wallClock: pick(
      input.flags.wallClockSeconds,
      input.limits?.wallClockSeconds,
      defaults.wallClockSeconds,
    ),
    maxTurns: pick(input.flags.maxTurns, input.limits?.maxTurns, defaults.maxTurns),
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
/** Where the binary path came from. `machine` is the R14 layer — the only one of the three. */
export type ExecSource = "flag" | "machine" | "default";
export type ParamSource = "flag" | "role";

export type Resolved<T, S> = { readonly value: T; readonly source: S };
export type ResolvedWorker = Resolved<string, WorkerSource>;
export type ResolvedExec = Resolved<string, ExecSource>;

/**
 * The binary when nobody said anything: the bare name, found on the child's `PATH`.
 * A machine that has the agent installed normally needs no config at all — which is
 * what keeps the machine file honest as an ANSWER to a problem rather than a tax.
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
 * WHERE THAT TOOL'S BINARY IS — the machine layer sits BETWEEN the flag and the
 * default, and nowhere else. The repository is not consulted at all: a path in a
 * committed file would be a lie on every other machine, and the one place it lived
 * until now (a shell history) is not a place.
 */
export const resolveExec = (input: {
  readonly flag?: string;
  readonly worker: string;
  readonly local?: LocalConfig;
}): ResolvedExec => {
  if (input.flag !== undefined) return { value: input.flag, source: "flag" };
  const declared = input.local?.agents[input.worker]?.exec;
  if (declared !== undefined) return { value: declared, source: "machine" };
  return { value: DEFAULT_EXEC, source: "default" };
};

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
 *  - `--model`/`--effort` typed for a tool the package cannot pass them to;
 *  - an `--effort` level outside the tool's own vocabulary — the config path is
 *    guarded by the schema, and the flag path has to be guarded here or it would be
 *    the one way in.
 */
export const resolveAgentParams = (input: {
  readonly flags: { readonly model?: string; readonly effort?: string };
  readonly worker: ResolvedWorker;
  readonly launch?: Launch;
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
  if (typed && worker !== "claude-code") {
    return {
      ok: false,
      reason: `--model/--effort were given, but the run is being raised as '${worker}' — the package knows how to pass those to 'claude-code' only`,
    };
  }
  if (
    input.flags.effort !== undefined &&
    !claudeCodeEffortSchema.safeParse(input.flags.effort).success
  ) {
    return {
      ok: false,
      reason: `--effort '${input.flags.effort}' — allowed levels are ${claudeCodeEffortSchema.options.join(", ")}`,
    };
  }

  const fromRole = declared?.kind === "claude-code" ? declared : undefined;
  const pick = <T extends string>(
    flagValue: T | undefined,
    roleValue: T | undefined,
  ): Resolved<T, ParamSource> | undefined => {
    if (flagValue !== undefined) return { value: flagValue, source: "flag" };
    if (roleValue !== undefined) return { value: roleValue, source: "role" };
    return undefined;
  };
  const model = pick(input.flags.model, fromRole?.model);
  const effort = pick(input.flags.effort, fromRole?.effort);
  return {
    ok: true,
    params: {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    },
  };
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
}): string =>
  [
    `${input.worker.value} (${input.worker.source})`,
    `exec ${input.exec.value} (${input.exec.source})`,
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
 *  - `wake.mode !== "watch"` — the role has no session of its own for us to raise:
 *    john (`self`, a human), curator (`via-human`, comes alive through a human),
 *    reviewer-pr/github (`event`, woken by the platform) are not ours to spawn;
 *  - empty `instructions` — there is nothing to build a prompt from (that is
 *    dev-speech today): an honest refusal rather than a crash on a missing file;
 *  - `instructions` with `external` — the card is executed OUTSIDE (a skill on the
 *    chat side) and a local `claude -p` must not drive it (that is curator).
 */
export const roleLaunchability = (role: Role): Launchability => {
  if (role.status !== "active") return { launchable: false, reason: "inactive" };
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
export const buildLaunchArgv = (input: {
  readonly prompt: string;
  readonly maxTurns: string;
  readonly launch: Launch;
  /**
   * The resolved tool parameters (R15). Absent means "say nothing" rather than "pass
   * a default": the tool's own default is a value the package has no business
   * restating, and restating it would freeze today's default into our argv.
   */
  readonly params?: AgentParams;
}): string[] => [
  "-p",
  input.prompt,
  "--allowedTools",
  input.launch.allowedTools.join(","),
  "--max-turns",
  input.maxTurns,
  ...(input.params?.model === undefined ? [] : ["--model", input.params.model.value]),
  ...(input.params?.effort === undefined ? [] : ["--effort", input.params.effort.value]),
  "--output-format",
  "stream-json",
  "--verbose",
];

/** A role's permissions in one line — for the `status` display and the launch output. */
export const describeLaunch = (role: Role): string => {
  const profile = role.launch;
  if (profile === undefined) {
    const why = roleLaunchability(role);
    return why.launchable
      ? `${role.id}: no launch profile`
      : `${role.id}: not launched by the circuit (${why.reason})`;
  }
  return `${role.id}: ${profile.allowedTools.join(", ")}`;
};

export type InstructionDoc = { readonly path: string; readonly text: string };

/**
 * The prompt for `claude -p` — from the role card (its `instructions`) and ONE
 * thread. Pure: the instruction texts are already read outside. "This thread
 * only" is stated firmly in the prompt: the S2 completion signal is bound to the
 * turn passing on that thread, and if a run handled the whole mailbox the
 * criterion would smear (curator's requirement 3).
 */
export const buildLaunchPrompt = (input: {
  readonly role: string;
  readonly thread: string;
  readonly instructions: readonly InstructionDoc[];
}): string => {
  const cards = input.instructions.map((doc) => `# ${doc.path}\n\n${doc.text}`).join("\n\n---\n\n");
  return [
    `You are the \`${input.role}\` role of the agent-comms protocol. Your role card is below.`,
    "",
    `The turn was passed to you on thread \`${input.thread}\` — AND ON THAT ONE ONLY. Do NOT handle the rest of your mail: this run is bound to exactly one thread.`,
    "",
    "Read the whole thread (including the files in the conversation folder), carry out the statement of work and reply with a message at the end of the thread following the protocol rules (`cli new-message`). Once the reply is written and the turn is passed on, the run is over.",
    "",
    "--- ROLE CARD ---",
    "",
    cards,
  ].join("\n");
};

/**
 * Launches in a row without a single `completed`. Every `launch` increments the
 * counter, a successful `lease-released reason=completed` resets it. A
 * "launch → break" loop (releases with timeout/forced but never completed)
 * accumulates — and that is what catches it.
 */
export const consecutiveLaunchesWithoutCompletion = (
  events: readonly OrchestratorEvent[],
): number => {
  let count = 0;
  for (const event of events) {
    if (event.kind === "launch") count += 1;
    else if (event.kind === "lease-released" && event.reason === "completed") count = 0;
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
}): LaunchPlan => {
  const { events, role, thread, now, wallClockMs } = input;
  const maxConsecutive = input.maxConsecutive ?? MAX_CONSECUTIVE_RUNS;

  const view = foldLeases(events, now).find((v) => v.role === role && v.thread === thread);
  if (view && (view.state === "running" || view.state === "draining")) {
    return { ok: false, reason: "already-running" };
  }
  if (view?.exhausted) return { ok: false, reason: "exhausted" };
  if (consecutiveLaunchesWithoutCompletion(events) >= maxConsecutive) {
    return { ok: false, reason: "run-budget" };
  }

  const ts = eventTimestamp(now);
  const deadline = eventTimestamp(new Date(now.getTime() + wallClockMs));
  const events2: OrchestratorEvent[] = [
    { kind: "lease-acquired", ts, role, thread, deadline },
    { kind: "launch", ts, role, thread },
  ];
  return { ok: true, deadline, events: events2 };
};
