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
import type { Launch, Role } from "../roles/schema.js";
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
 */
export const buildLaunchArgv = (input: {
  readonly prompt: string;
  readonly maxTurns: string;
  readonly launch: Launch;
}): string[] => [
  "-p",
  input.prompt,
  "--allowedTools",
  input.launch.allowedTools.join(","),
  "--max-turns",
  input.maxTurns,
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
