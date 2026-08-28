/**
 * THE DAEMON PICKS UP ITS OWN NEW CODE (055.2, statement of curator by john's decision
 * of 2026-08-05 12:34Z — variant (3) of the fork left open in 023.2).
 *
 * WHY THIS EXISTS, measured rather than supposed. The daemon re-reads its CONFIG at
 * `--ref` every tick and loads its CODE once, at start (node), so a merge into `main`
 * moves one half of the process and not the other. Since the version gate of the
 * 037 family that gap is not merely stale code — it is a STOP: a config declaring a
 * protocol version the loaded build does not know shuts the circuit down fail-safe, and
 * on 2026-08-05 12:33Z that left a daemon raised on 04.08 standing in a legal refusal
 * for fifty minutes while two roles' turns waited and a human was the detector. Third
 * outage of that class in two days; and Д-4 (a version bump merged without a pause)
 * makes it the price of EVERY remaining package of this thread.
 *
 * WHAT IS AUTOMATED, AND WHAT IS DELIBERATELY NOT. Not a new way to restart: the tick
 * runs the SAME `orchestrator restart --pull` a hand would (`down` → pull --ff-only +
 * install → `up` with the flags the stopped daemon was raised with). The only thing this
 * module adds is the decision to type it — a verdict over facts the tick already has —
 * and the memory that keeps a failing repair from being typed forever.
 *
 * WHY THE VERDICT IS A PURE FUNCTION HERE AND NOT AN `if` IN THE TICK. Every condition
 * below is a safety condition, and the tests of a safety condition must not need a
 * daemon, a clock and a checkout to run. The tick supplies the facts and does exactly
 * one impure thing with the answer.
 *
 * THE CONDITIONS ARE ALL "AND", and each one is a fact of the box rather than an
 * opinion about it:
 *   1. `drift` — the loaded code is not the ref (023.2 measures it; silence on a match).
 *   2. no leases — nothing is running under this daemon. A graceful restart with a live
 *      session waits for it, and a wait of unknown length started by nobody is exactly
 *      the state a human should be present for; with zero leases the stop is immediate.
 *   3. THE DAEMON SERVES THE CHECKOUT ITS CODE CAME FROM. A repair is `git pull` plus a
 *      relaunch OF ONE TREE, and a daemon whose modules were loaded from somewhere else
 *      than the circuit home it serves would pull a tree it does not judge by — the case
 *      is not hypothetical: every process test of this package raises a real daemon over
 *      a temporary repository while node loaded the code from the developer's checkout,
 *      and `--ref` resolves there, so the drift is real and the repair would land on the
 *      role's own worktree. A worktree that R17 resets, locks and removes under the
 *      circuit is precisely the tree nothing may pull unattended (`systemd install`
 *      refuses in one for the neighbouring reason).
 *   4. clean state — no stop/force flag, no operator hold, and no uncommitted change in
 *      the checkout the code came from. The tree matters because phase 3 is `git pull
 *      --ff-only` in that very checkout: a pull over somebody's unsaved work is the one
 *      irreversible thing in the whole chain, and refusing it costs a line of log.
 *   5. the attempt ceiling — `SELF_RESTART_MAX_ATTEMPTS` per TARGET (see below).
 *   6. anything unmet → today's behaviour verbatim: stand, and say so every tick
 *      (variant (1) stays the floor; (3) only ever runs on top of a clean box).
 *
 * THE CEILING IS KEYED BY THE TARGET SHA, and that is what makes it self-clearing. A
 * counter of "attempts" alone would either need somebody to reset it (nobody would) or
 * would forgive itself on a timer (and loop). Keyed by the ref's SHA it answers the only
 * question worth asking — "has THIS repair already failed twice" — and a new commit on
 * the ref is a new target with a fresh count, because a pull that failed on one tree can
 * plainly succeed on the next.
 *
 * WHAT THE ORDER GUARANTEES (curator's condition 6: no half-death). The old daemon does
 * not kill itself and does not raise anything: it SPAWNS the restart process detached
 * and keeps ticking. That process sets the stop flag, waits for the old daemon to leave,
 * pulls and raises the new one — so the predecessor is gone only after its successor's
 * launcher is alive and holding the whole sequence. A spawn that fails changes nothing
 * at all: the daemon is still up, the attempt is counted, and the next tick says why.
 * A pull that fails leaves the circuit down and LOUD in `daemon.log` — the deliberate
 * refusal of the manual command, unchanged; this module does not invent a second policy
 * for it, because the operator asked for the NEW code to be running and the old one
 * quietly coming back would look exactly like success.
 *
 * AND THE TICK THAT HANDS OVER LAUNCHES NOTHING (the live acceptance of 2026-08-07,
 * curator's condition 6 again — and the defect it caught). "Zero leases" is condition 2,
 * and until 2026-08-07 the daemon judged it and then immediately broke it ITSELF: the
 * drift block runs in the middle of a tick whose plan has been computed but not yet
 * acted on, so the handover was followed, three lines later and in the same tick, by
 * `the plan of this tick: 1 launch`. On the box that morning that launch was a
 * nineteen-minute session; the repair set the stop flag one second later, waited its
 * 150s for a daemon that was now draining, gave up, and left. The predecessor then
 * finished the session and exited on the flag with nobody to succeed it — the circuit
 * lay dark until a human typed `up`. Exactly the half-death condition 6 forbids, reached
 * through the one door nobody guarded: the repair's short `--wait` is CORRECT, and its
 * premise ("zero leases, so the old process leaves at its next tick") is this process's
 * to keep. So the handover is now the last decision of the tick in fact and not only in
 * the comment: whatever the plan held stays in the queue, is named out loud, and is taken
 * by the successor, which is a fresher reading of the same mail seconds later.
 */

import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

/** How many times one target SHA may be attempted before the box stands and speaks. */
export const SELF_RESTART_MAX_ATTEMPTS = 2;

/**
 * THE FORM OF THE REPAIR IS DECIDED BY WHO OWNS THIS PROCESS (thread 003, 2026-08-18).
 *
 * MEASURED, not supposed. The detached form above — spawn `restart --pull`, keep ticking,
 * let the child stop this process — is correct for a daemon nobody supervises and is
 * IMPOSSIBLE under a systemd unit. The unit of this box carries `KillMode=control-group`
 * (`systemctl --user show`, 2026-08-18), and that setting kills the rest of the cgroup the
 * moment MainPID leaves. The child is in that cgroup: `detached: true` makes a new session,
 * not a new cgroup. Reproduced on a stand of two units differing in that one key
 * (2026-08-18): under `control-group` the child took SIGTERM within a second of the
 * parent's exit — one loop iteration in, mid-phase — while under `process` the same child
 * ran all its phases to the end. That is exactly the field trace of 17.08 on `lle-hetzner`
 * — `stopping pid … gracefully`, `the stop flag is set`, then nothing — and the box stood
 * without a daemon for eleven and a half hours, because the daemon had exited 0 and
 * `Restart=on-failure` is by construction blind to a clean exit.
 *
 * WHY NOT SIMPLY WEAKEN THE UNIT. `KillMode=process` would let the child live, but the
 * daemon it then raises would live inside the cgroup of a unit systemd believes is dead:
 * `systemctl status` would say inactive over a running circuit, `Restart=` would never
 * apply to it and the next `systemctl restart` would manage nothing. A supervised process
 * that wants a fresh copy of itself asks its supervisor, and the ask is an exit code.
 *
 * SO THE SUPERVISED FORM SPAWNS NOTHING AND SETS NO FLAG. This process does the two steps
 * `restart --pull` does — `git pull --ff-only`, then the install when the pull moved what
 * the install reads — and leaves with `SELF_RESTART_EXIT_CODE`. The supervisor raises the
 * replacement, which is a fresh `node` over the code that was just pulled. Nothing has to
 * outlive the exit, so nothing can be killed by it; there is no stop flag, so a repair that
 * fails leaves nothing behind that would kill the next start.
 *
 * AND A FAILING REPAIR NEVER PRETENDS. The pull is done BEFORE the exit and its failure
 * cancels the exit: the daemon stays up, behind and loud, and the attempt is already
 * counted, so the ceiling closes the loop after `SELF_RESTART_MAX_ATTEMPTS`. The only exit
 * this adds is one that a supervisor is guaranteed to answer.
 */
export type SelfRestartForm = "supervised" | "detached";

/**
 * WHAT ONE TICK'S REPAIR DID, in the three words the caller has to tell apart: it stood
 * (nothing happened, the plan is this daemon's to act on), it spawned (the detached form
 * handed over — withhold the plan and keep ticking), or it handed back (the supervised
 * form repaired the tree — withhold the plan and LEAVE).
 */
export type SelfRestartOutcome = "stood" | "spawned" | "handback";

/**
 * The exit code of a daemon asking its supervisor for a fresh process. Any non-zero code
 * satisfies `Restart=on-failure`; this one is `EX_TEMPFAIL`, whose meaning ("the thing
 * failed, try again") is the message exactly, and it is far enough from the codes this CLI
 * already uses (1 refusal, 2 argument door) to be read for what it is in a journal.
 */
export const SELF_RESTART_EXIT_CODE = 75;

/**
 * WHO OWNS THIS PROCESS, asked of the environment rather than of a flag. `INVOCATION_ID` is
 * set by systemd for every service it starts and by nothing else; a daemon backgrounded by
 * `up` never has it. It is read rather than configured on purpose: the answer is a fact of
 * how the process was started, and a flag would let the two get out of step exactly once,
 * on the box where it matters.
 */
export const selfRestartForm = (env: NodeJS.ProcessEnv): SelfRestartForm =>
  typeof env.INVOCATION_ID === "string" && env.INVOCATION_ID.trim() !== ""
    ? "supervised"
    : "detached";

/** Why a box that is behind is nevertheless not restarting itself right now. */
export type SelfRestartBlock =
  | { readonly kind: "leases"; readonly roles: readonly string[] }
  | { readonly kind: "stopping" }
  | { readonly kind: "held"; readonly roles: readonly string[] }
  | { readonly kind: "foreign-checkout"; readonly code: string; readonly served: string }
  | { readonly kind: "dirty"; readonly checkout: string; readonly paths: readonly string[] }
  | { readonly kind: "tree-unreadable"; readonly checkout: string; readonly problem: string }
  | { readonly kind: "attempts"; readonly attempts: number; readonly ceiling: number };

export type SelfRestartVerdict =
  | { readonly kind: "go"; readonly target: string; readonly attempt: number }
  | { readonly kind: "stand"; readonly block: SelfRestartBlock };

/**
 * WHAT THE BOX REMEMBERS BETWEEN TICKS AND BETWEEN PROCESSES — one target and its count.
 * It lives beside the pid in the state directory: disposable like everything there
 * (losing it costs one extra attempt, never a decision), and readable by a human who
 * wants to know why a box that is behind is standing still.
 */
export type SelfRestartMemory = {
  /** The SHA of the ref this box has been trying to reach. */
  readonly target: string;
  readonly attempts: number;
  /** When the last attempt was made — UTC ISO to the second. */
  readonly at: string;
};

export const renderSelfRestartMemory = (memory: SelfRestartMemory): string =>
  `${JSON.stringify(memory)}\n`;

export const parseSelfRestartMemory = (raw: string): SelfRestartMemory | undefined => {
  const text = raw.trim();
  if (text === "") return undefined;
  try {
    const value = JSON.parse(text) as Partial<SelfRestartMemory>;
    if (
      typeof value.target !== "string" ||
      typeof value.attempts !== "number" ||
      !Number.isInteger(value.attempts) ||
      value.attempts < 0 ||
      typeof value.at !== "string"
    )
      return undefined;
    return { target: value.target, attempts: value.attempts, at: value.at };
  } catch {
    return undefined;
  }
};

/** How many attempts this box has already spent ON THIS target — a memory of another is none. */
export const attemptsFor = (memory: SelfRestartMemory | undefined, target: string): number =>
  memory === undefined || memory.target !== target ? 0 : memory.attempts;

/**
 * THE WHOLE RULE. The order of the checks is the order a human would ask them in, and it
 * is not arbitrary: the two that describe WORK IN FLIGHT (leases, a stop already under
 * way) come before the two that describe the box's tidiness, so the line an operator
 * reads names the thing that will change on its own first.
 */
export const selfRestartVerdict = (input: {
  /** The SHA the ref resolves to on disk — the target of the repair, and the memory's key. */
  readonly target: string;
  /** Roles this daemon is running right now; empty is the condition. */
  readonly running: readonly string[];
  /** Leases left open by anybody (an orphaned supervisor counts) — same condition. */
  readonly openLeases: readonly string[];
  /** The stop or force flag is down — somebody is already stopping this box. */
  readonly stopping: boolean;
  /** Roles taken by manual sessions — an operator is at this box. */
  readonly held: readonly string[];
  /** The state of the checkout the loaded code came from — the tree `pull` would move. */
  readonly tree:
    | { readonly kind: "clean" }
    | { readonly kind: "dirty"; readonly paths: readonly string[] }
    | { readonly kind: "unreadable"; readonly problem: string };
  /** The checkout the loaded code came from — the tree `pull` would move. */
  readonly checkout: string;
  /** The circuit home this daemon actually serves; the repair is only ever about one tree. */
  readonly served: string;
  readonly attempts: number;
  readonly ceiling: number;
}): SelfRestartVerdict => {
  const live = [...input.running, ...input.openLeases.filter((id) => !input.running.includes(id))];
  if (live.length > 0) return { kind: "stand", block: { kind: "leases", roles: live } };
  if (input.stopping) return { kind: "stand", block: { kind: "stopping" } };
  if (input.held.length > 0) return { kind: "stand", block: { kind: "held", roles: input.held } };
  // Before anything is said about the tree: a complaint about the state of a checkout
  // this daemon does not serve would name a true fact for the wrong reason.
  if (input.served !== input.checkout)
    return {
      kind: "stand",
      block: { kind: "foreign-checkout", code: input.checkout, served: input.served },
    };
  if (input.tree.kind === "dirty")
    return {
      kind: "stand",
      block: { kind: "dirty", checkout: input.checkout, paths: input.tree.paths },
    };
  if (input.tree.kind === "unreadable")
    return {
      kind: "stand",
      block: { kind: "tree-unreadable", checkout: input.checkout, problem: input.tree.problem },
    };
  if (input.attempts >= input.ceiling)
    return {
      kind: "stand",
      block: { kind: "attempts", attempts: input.attempts, ceiling: input.ceiling },
    };
  return { kind: "go", target: input.target, attempt: input.attempts + 1 };
};

/** Short enough to read in a stream, long enough to paste into `git show`. */
const short = (sha: string): string => sha.slice(0, 8);

/**
 * THE LINE BEFORE (curator's condition 4). It states the three facts that made the
 * decision — how far behind, that nothing is running, that the box is clean — because
 * "restarting itself" without them is indistinguishable in a log from a crash loop.
 */
export const describeSelfRestartGo = (input: {
  readonly target: string;
  readonly behind?: number;
  readonly attempt: number;
  readonly ceiling: number;
}): string =>
  `SELF-RESTART: the loaded code is behind ${short(input.target)}${
    input.behind === undefined ? "" : ` (${input.behind} commit(s))`
  }, leases 0, state clean — running 'restart --pull' as this box would by hand (attempt ${input.attempt}/${input.ceiling})`;

/**
 * THE LINE INSTEAD (condition 5). Every tick, beside the drift line it explains: a box
 * that is behind AND not repairing itself is the state a human has to be able to read at
 * a glance, and it was the silence around exactly this that made john the detector.
 */
export const describeSelfRestartStand = (block: SelfRestartBlock): string => {
  switch (block.kind) {
    case "leases":
      return `no self-restart while sessions are live (${block.roles.join(", ")}) — a graceful restart would wait for them, and that wait needs a human`;
    case "stopping":
      return "no self-restart while a stop is already down — somebody is stopping this box";
    case "held":
      return `no self-restart while roles are held manually (${block.roles.join(", ")}) — an operator is at this box`;
    case "foreign-checkout":
      return `no self-restart — this daemon runs code loaded from '${block.code}' but serves '${block.served}'; a repair pulls and relaunches ONE tree, and these are two`;
    case "dirty": {
      const named = `${block.paths.slice(0, 5).join(", ")}${block.paths.length > 5 ? ", …" : ""}`;
      // UNTRACKED-ONLY IS A DIFFERENT REPAIR, and saying "uncommitted work" about it sends
      // the operator looking for work to commit (003): a checkout whose only dirt is the
      // circuit's own runtime is fixed by an ignore rule, and nothing here can be committed.
      return block.paths.every((line) => line.startsWith("??"))
        ? `no self-restart with untracked files in '${block.checkout}' (${named}) — 'git pull --ff-only' refuses over them; NOTHING HERE IS WORK TO COMMIT: if these are this circuit's own runtime ('orchestrator.state', 'orchestrator.workdir.worktrees'), the repair is an ignore rule in the served repository`
        : `no self-restart with uncommitted work in '${block.checkout}' (${named}) — 'git pull' would move that tree`;
    }
    case "tree-unreadable":
      return `no self-restart — the state of '${block.checkout}' could not be read (${block.problem}); a pull over an unknown tree is not something to do unattended`;
    case "attempts":
      return `no self-restart — this target has already been attempted ${block.attempts}/${block.ceiling} times; standing and saying so, as before (see 'daemon.log' for what the restart said)`;
  }
};

/**
 * THE LINE AFTER, from the spawning side. The other half of "after" is written by the
 * restart process itself into `daemon.log` and by the new daemon in its banner (it prints
 * the SHA it loaded) — this one exists so that the OLD process's stream ends with what it
 * did rather than simply stopping, which is what a crash looks like.
 */
export const describeSelfRestartSpawned = (pid: number, logPath: string): string =>
  `SELF-RESTART: handed over to the restart process (pid ${pid}) — it sets the stop flag, waits for this process to leave, pulls and raises the new daemon; its phases go to '${logPath}'`;

/** The spawn itself failed — nothing was handed over, and this box is still the live one. */
export const describeSelfRestartUnspawned = (problem: string): string =>
  `SELF-RESTART FAILED to start (${problem}) — nothing was stopped, this daemon stays up and behind; the attempt is counted`;

/**
 * WHICH FORM WAS CHOSEN AND WHY, said before either of them acts. A log that shows a
 * daemon leaving without saying which mechanism it was counting on is the log of 17.08.
 */
export const describeSelfRestartForm = (form: SelfRestartForm): string =>
  form === "supervised"
    ? "SELF-RESTART: this process is supervised (INVOCATION_ID is set) — repairing in place and leaving for the supervisor to raise the replacement; nothing is spawned and no stop flag is set, because a child of this process would be killed with its cgroup the moment it exits"
    : "SELF-RESTART: this process is not supervised — spawning the restart the way a hand would type it";

/** One step of the in-place repair, named before it runs — phases, not a silence. */
export const describeSelfRestartStep = (step: string, checkout: string): string =>
  `SELF-RESTART: ${step} in '${checkout}'`;

/** It worked, and what it said (tail only — the log is a stream, not a transcript). */
export const describeSelfRestartStepOk = (step: string, tail: string): string =>
  `SELF-RESTART: ${step} — ok${tail === "" ? "" : `: ${tail}`}`;

/**
 * THE REPAIR FAILED AND THE EXIT IS CANCELLED — the daemon stays up rather than leaving on
 * a lie. Leaving here would hand the supervisor a process that comes back on the SAME code
 * and drifts again in a tick: a loop at restart speed, bounded only by systemd's start
 * limit, which ends in a unit nobody raises again.
 */
export const describeSelfRestartStepFailed = (step: string, why: string): string =>
  `SELF-RESTART: ${step} FAILED (${why}) — NOT leaving: this daemon stays up and behind on the old code, the attempt is counted, and the supervisor is not asked for a process that would come back to the same drift`;

/** The last line of a supervised daemon — the one the log of 17.08 did not have. */
export const describeSelfRestartHandback = (target: string, code: number): string =>
  `SELF-RESTART: the tree is on ${short(target)} — leaving with code ${code} so the supervisor raises a fresh process over the pulled code. A supervisor that does NOT (no 'Restart=' on this unit, or none at all) leaves this box DOWN and says so in its own journal — which is the point: an exit that failed to be replaced must not look like a clean shutdown`;

/**
 * WHETHER THE INSTALL HAS ANYTHING TO RECONCILE. `pnpm install` exists in this chain to
 * make the node_modules of the tree match what the tree declares, so what decides is
 * whether the pull moved a file the installer reads. A pull that touched only sources is
 * the ordinary case here (this repository merges code far more often than dependencies),
 * and running the installer over it costs the repair tens of seconds and adds a failure
 * mode — a network hiccup — to a path whose whole job is to come back up.
 */
export const INSTALL_INPUTS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"] as const;

export const installNeeded = (changed: readonly string[]): boolean =>
  changed.some((path) =>
    (INSTALL_INPUTS as readonly string[]).some(
      (input) => path === input || path.endsWith(`/${input}`),
    ),
  );

/** Why the installer was not run — silence here would read as "it ran and said nothing". */
export const describeInstallSkipped = (): string =>
  `SELF-RESTART: pnpm install skipped — the pull moved none of ${INSTALL_INPUTS.join(", ")}, so what is installed already matches what the tree declares`;

/**
 * THE LINE THAT NAMES WHAT THE HANDOVER COST THIS TICK (condition 6, 2026-08-07). It is
 * said even when the plan was empty, and that is deliberate: "the tick that hands over
 * launches nothing" is the invariant a reader has to be able to CHECK in a log, and an
 * invariant that only speaks when it bites is one nobody can tell from an absent one.
 *
 * Nothing is lost by withholding: the pairs are not consumed, not counted as attempts and
 * not recorded — they stay in the mail, which is what the successor reads seconds later
 * with the queue in front of it. Losing a tick is the price of never losing the circuit.
 */
export const describeSelfRestartWithheld = (pairs: readonly string[]): string =>
  pairs.length === 0
    ? "SELF-RESTART: this tick launches nothing — there was nothing to withhold, and the zero-lease condition the handover stands on holds by itself"
    : `SELF-RESTART: this tick launches NOTHING (${pairs.join(", ")} stay in the queue for the successor) — the handover was judged on zero leases and a session started now would make this daemon drain for as long as it lasts, outliving the repair's wait`;

/**
 * THE ARGV OF THE SPAWNED REPAIR. It is the manual command verbatim plus `--self`, which
 * changes nothing but the words in the log — the fact of a self-restart has to be
 * distinguishable from a hand-typed one when the two are read a day later, and the flags
 * of the daemon itself come from the state file the way they do for a human (`restart.ts`).
 * `--wait` is short on purpose: this box has zero leases by the condition above, so the
 * old process leaves at its next tick; a long wait here would only hide a hang.
 *
 * THE IDENTITY OF THE INSTANCE RIDES VERBATIM (curator, thread 055, 2026-08-05). Whatever
 * selected the machine config for the DAEMON — `--instance <name>`, `--local-config <p>` —
 * is typed into the repair unchanged, because nothing else reproduces it: the env layer is
 * only ever read (`AGENT_PROTOCOL_INSTANCE` is set by nobody in this package), and the
 * checkout layer answers about `--repo`, which is the served tree and not the name the
 * daemon was raised under. Two cases where the difference is real and silent: a daemon
 * raised with `--local-config` (the repair would resolve ANOTHER config, i.e. another
 * state directory — another pid file, another `daemon.log`, other holds, and `restart`
 * reads the stopped daemon's flags from beside that pid, so the mistake is invisible by
 * construction), and a multi-instance box, where the unit's own `ExecStart` carries
 * `--instance <name>` and the repair it spawns carried none. The norm this thread set is
 * that two layers which disagree refuse by name; here they did not refuse, they chose
 * quietly — so the repair stops guessing and is told.
 */
export const selfRestartArgv = (input: {
  readonly ref: string;
  readonly repo: string;
  readonly waitSec: number;
  readonly instance?: string;
  readonly localConfig?: string;
}): readonly string[] => [
  "orchestrator",
  "restart",
  "--pull",
  "--self",
  "--ref",
  input.ref,
  "--repo",
  input.repo,
  ...(input.instance === undefined ? [] : ["--instance", input.instance]),
  ...(input.localConfig === undefined ? [] : ["--local-config", input.localConfig]),
  "--wait",
  String(input.waitSec),
];

/**
 * THE SPAWN ITSELF, AND WHY IT IS HERE RATHER THAN INLINE IN THE TICK (the verdict of
 * reviewer-pr on 5d7c6751, 2026-08-05).
 *
 * The child's streams go into the daemon's OWN log, the way `up` gives its daemon that
 * file and `detachRun` gives a supervisor its own. With `stdio: "ignore"` — the form this
 * replaces — everything the repair said before `orchestrator restart` reached its `say()`
 * went nowhere, and the argument door stands exactly there: `guardArguments` runs in
 * `main()`, before the dispatch. So a refusal at the door (`--self` on 2026-08-05, and
 * equally any future flag, a broken loader, any throw before `say`) left the box with
 * `attempted N/2` and no cause — while `describeSelfRestartStand` was telling the reader
 * to look in `daemon.log` for what the restart said.
 *
 * It is a function of this module, not four lines in `cli.ts`, for one reason: this is the
 * class the test has to be able to drive. Given a deliberately impossible argv it must be
 * observable that the REASON reaches the log — and a test cannot assert that about a spawn
 * written inside a daemon tick it is not allowed to raise (condition 3).
 *
 * A log that cannot be opened does NOT cancel the repair: the box is behind, and losing
 * the words is worse than nothing but not worse than staying behind.
 */
export const spawnSelfRestart = (input: {
  readonly node: string;
  readonly nodeArgs: readonly string[];
  readonly entry: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly logPath: string;
  readonly env: NodeJS.ProcessEnv;
}): number | undefined => {
  let sink: number | undefined;
  try {
    sink = openSync(input.logPath, "a");
  } catch {
    sink = undefined;
  }
  const child = spawn(input.node, [...input.nodeArgs, input.entry, ...input.argv], {
    detached: true,
    stdio: sink === undefined ? "ignore" : ["ignore", sink, sink],
    cwd: input.cwd,
    env: input.env,
  });
  child.unref();
  if (sink !== undefined) closeSync(sink);
  return child.pid;
};

/**
 * THE VERDICT THAT KILLED THE BOX INSTEAD OF REPAIRING IT (thread 040, measured on this
 * repository 2026-08-28 ~19:45Z — the third outage of the class in a week).
 *
 * WHAT THE LOG SAYS, verbatim and in this order: a whole ordinary tick ("no candidate is
 * launchable … waiting 30s"), and then one line —
 *
 *   agent-protocol: 'agent-protocol.json' at origin/main: restart required: the
 *   repository declares protocol version 21, the package supports only 20 …
 *
 * — and the stream ENDS. No drift line, no `SELF-RESTART`, no handback. That line is
 * `configFrom` answering a `ProtocolVersionError` with `fail(message, 2)`, i.e.
 * `process.exit(2)`, from inside the courier read at the TOP of the tick — thirty lines
 * of tick before the drift block that owns the repair. So the class was never a
 * supervisor problem at all:
 *
 *   - the daemon did not loop and did not burn `StartLimitBurst`; it left ONCE;
 *   - it left with 2, which is this CLI's argument door — and the unit of this box
 *     carries `RestartPreventExitStatus=2` (measured by john 2026-08-28 20:05Z), because
 *     an invocation that is wrong stays wrong however often it is raised. So systemd did
 *     exactly what it was told: it never raised a replacement;
 *   - and the tree never moved, which is why the pull was a human's (the observed fact
 *     curator reports: the checkout stood on `2863d55` until john typed `git pull`).
 *
 * A VERSION VERDICT IS THE ONE REFUSAL THAT NAMES ITS OWN REPAIR — "pull and restart what
 * is running on it" — and that repair is this module. Answering it with the code that
 * means "do not raise me again" is the defect: the daemon asked a human for the one thing
 * it can do for itself.
 *
 * SO A DAEMON MEETING IT DECIDES BETWEEN EXACTLY TWO ENDINGS, and neither of them is a
 * loop: repair the tree and hand back for a fresh process over the pulled code, or fall
 * over ONCE, loudly, naming the command a hand must type. The three facts that choose are
 * the ones the repair itself stands on, and nothing here reads the config — which is the
 * point, since the config is precisely what could not be read.
 */
export type VersionRepairVerdict =
  | { readonly kind: "repair"; readonly target: string }
  | { readonly kind: "stand"; readonly why: string };

export const versionRepairVerdict = (input: {
  /** How the loaded code stands against the ref the config was read at. */
  readonly code:
    | { readonly kind: "drift"; readonly refSha: string }
    | { readonly kind: "match" }
    | { readonly kind: "unknown"; readonly problem: string };
  /** The state of the checkout the loaded code came from — the tree `pull` would move. */
  readonly tree: WorkingTreeState;
  readonly checkout: string;
  readonly ref: string;
}): VersionRepairVerdict => {
  if (input.code.kind === "unknown")
    return {
      kind: "stand",
      why: `the loaded code could not be dated (${input.code.problem}), so it is not known whether '${input.ref}' carries a build that would support this config — and a pull decided on nothing is not something to do unattended`,
    };
  // THE CASE THAT MUST NOT BE ANSWERED WITH A RESTART, and the reason this is a verdict
  // rather than an unconditional `git pull`. Code that already IS the ref and still does
  // not know the declared version is not behind anything: the repair is a NEWER BUILD
  // (the config was merged ahead of the code that reads it), and a process that kept
  // exiting for a supervisor here would be the crash loop this thread exists to end.
  if (input.code.kind === "match")
    return {
      kind: "stand",
      why: `the loaded code IS '${input.ref}' — a pull would move nothing, so this build genuinely does not know the declared version; what fixes it is a NEWER BUILD on the ref, not another process over the same one`,
    };
  if (input.tree.kind === "dirty")
    return {
      kind: "stand",
      why: `there is uncommitted work in '${input.checkout}' (${input.tree.paths.slice(0, 5).join(", ")}${input.tree.paths.length > 5 ? ", …" : ""}) — 'git pull' would move that tree, and that is the one irreversible step of the chain`,
    };
  if (input.tree.kind === "unreadable")
    return {
      kind: "stand",
      why: `the state of '${input.checkout}' could not be read (${input.tree.problem}) — a pull over an unknown tree is not something to do unattended`,
    };
  return { kind: "repair", target: input.code.refSha };
};

/** The verdict met, named before anything is decided about it — the line that was silent. */
export const describeVersionVerdictMet = (message: string, ref: string): string =>
  `VERSION VERDICT while running: ${message} — NOT exiting on the argument door (code 2): a supervisor is told never to raise that again, and this is the one refusal whose repair ('pull and restart') is exactly what this daemon does for itself. Deciding against '${ref}' now`;

/** It can be repaired, and the two steps are the ones a hand would type. */
export const describeVersionRepair = (target: string, checkout: string): string =>
  `VERSION VERDICT: the loaded code is behind ${short(target)} — pulling '${checkout}' and leaving for the supervisor, exactly as a drift is repaired`;

/**
 * IT CANNOT, AND THIS BOX FALLS OVER ONCE (curator's second option, thread 040). The exit
 * code is deliberately the argument door: `RestartPreventExitStatus=2` means the
 * supervisor stops here instead of raising four more processes into the same wall — the
 * start limit stays intact, and what an operator finds is one line naming one command.
 */
export const describeVersionStand = (why: string, checkout: string): string =>
  `VERSION VERDICT: this box CANNOT repair itself — ${why}. Leaving with code 2 so the supervisor stops rather than looping (the start limit stays intact). A hand is needed: cd '${checkout}' && git pull --ff-only && pnpm install && systemctl --user restart agent-protocol@<instance>`;

/** What `git status --porcelain` says about the tree a pull is about to move. */
export type WorkingTreeState =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty"; readonly paths: readonly string[] }
  | { readonly kind: "unreadable"; readonly problem: string };

/**
 * THE ONE READ THE RULE CANNOT DO FOR ITSELF. `--porcelain` is used rather than a
 * human-readable status for the obvious reason and one less obvious: untracked files
 * count as dirty here, because `pull --ff-only` refuses over an untracked file it would
 * overwrite, and a repair that dies half-way through phase 3 is worse than one that never
 * started. A read that FAILS is not "clean": it becomes its own refusal.
 */
export const workingTreeState = (checkout: string): WorkingTreeState => {
  let said: string;
  try {
    said = execFileSync("git", ["-C", checkout, "status", "--porcelain"], { encoding: "utf8" });
  } catch (error) {
    return { kind: "unreadable", problem: (error as Error).message.replace(/\s+/g, " ").trim() };
  }
  const lines = said
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length === 0 ? { kind: "clean" } : { kind: "dirty", paths: lines };
};
