/**
 * THE WORKSPACE OF A ROLE (R17, thread `016-protocol-roadmap`) — where a raised
 * session lands, and who owns that place.
 *
 * WHAT IT WAS BEFORE, AND WHY THAT WAS NEVER A DESIGN. A spawned process inherits
 * the working directory of whoever spawned it, and nobody ever chose one: the
 * sessions worked in the OPERATOR'S main checkout because that is where the daemon
 * happened to be started. Three consequences, all of them observed rather than
 * imagined:
 *
 *  1. **A session takes the shared checkout onto its own branch.** A package ends
 *     with the tree on `agent-protocol/<something>`, and the next preflight refuses
 *     on `workdir.branch` — john met that refusal after every package of the first
 *     wave and repaired it by hand every time.
 *  2. **Dirt is inherited between runs.** Whatever the previous session left
 *     uncommitted is what the next one starts from, and neither of them said so.
 *  3. **Parallel roles are impossible by construction.** Two sessions in one
 *     checkout would be two agents editing one tree — so the circuit could only ever
 *     raise one role at a time, and the reason was never written down anywhere.
 *
 * WHAT REPLACES IT. The orchestrator HANDS the role a workspace:
 * `<worktrees>/<role id>`, a git worktree of the same repository. The project says
 * where those live (`orchestrator.workdir.worktrees`), the package says that one
 * role gets one directory named after it. The main checkout stops being anybody's
 * workplace — which is also what makes it safe for the operator to keep using it.
 *
 * WHY DETACHED AT THE BASE AND NOT "on the base branch". Git refuses to check out
 * one branch in two worktrees, and the base branch (`main`) is normally checked out
 * in the operator's own tree. A detached head at the base COMMIT is the same
 * starting point without the collision — and it is honest about what a package
 * start is: a point in history to branch from, not a branch to work on.
 *
 * WHY A DIRTY WORKSPACE IS NEVER OVERWRITTEN. The same rule the mail checkout has
 * followed since S8: we do not repair at somebody else's expense. Uncommitted changes
 * in a role's workspace are somebody's work, and `checkout --detach` over them would
 * destroy exactly the material a human needs in order to understand the break.
 *
 * WHAT THAT RULE COST, AND WHAT SPLITS IT IN TWO (thread 023, requirement 5). "Never
 * overwritten" was implemented as "always refuse", and the refusal is paid for by the
 * NEXT package: the role silently stands still until a human stashes the tree by hand
 * — four such stashes in one morning, none of them a judgement call, because in every
 * one of them the dirt belonged to a run the circuit itself had cut off. So the
 * question the plan asks is no longer "is it dirty" but WHOSE DIRT IT IS, and the
 * answer is already in hand — the reason the previous run of this pair was released:
 *
 *  - the circuit cut the run off (`quota-exhausted`, `timeout`, `supervisor-gone`,
 *    `stalled`) — the leftovers are an interrupted session's, nobody chose to leave
 *    them, and they are PARKED IN A STASH labelled with the run that made them. Nothing
 *    is lost and nothing is decided: a stash is the one gesture that is both reversible
 *    and complete;
 *  - the run ended its own turn (`completed` and every other handoff) and left dirt
 *    behind — that is an ERROR OF FINISHING, and the refusal names it as one. A session
 *    that passes the turn on leaves a clean tree; anything else is a defect to read;
 *  - there is no previous run to attribute the dirt to — it may be a human's, and the
 *    package does not stash a human's work on a guess.
 *
 * This module is the pure core: facts in, a plan and a verdict out. The git calls
 * live in the CLI, where the IO is.
 */
import { type GitIdentity, roleIdentity } from "../roles/identity.js";
import type { PreflightCheck } from "./preflight.js";

/** What git can tell about a workspace directory before anything is done to it. */
export type WorkspaceFacts = {
  /** The directory exists AND git knows it as a worktree of this repository. */
  readonly exists: boolean;
  /** Where its head is, as a symbolic name (`HEAD` for a detached one). Absent if it does not exist. */
  readonly branch?: string;
  /** The commit its head points at. Absent if it does not exist. */
  readonly head?: string;
  /** Uncommitted changes, tracked or not. */
  readonly dirty?: boolean;
  /**
   * The reason text of `git worktree lock`, when the tree is locked; absent when it is
   * not. A lock means "a run is living here" (see `lockReason`), and it is a FACT about
   * somebody else's run — the one this process is planning has not taken its own yet.
   */
  readonly locked?: string;
  /**
   * Whether the process named in that text is still alive. `undefined` when the text
   * names no pid (a lock somebody set by hand) — the difference matters, because "a
   * live run" and "a lock left behind by a killed one" ask a human for opposite things.
   */
  readonly lockHolderAlive?: boolean;
};

/**
 * WHAT THE ORCHESTRATOR IS ABOUT TO DO WITH THE WORKSPACE. Six outcomes, and the
 * split matters because three of them are actions on somebody's disk:
 *
 *  - `ready` — it is already detached at the base commit; nothing to do;
 *  - `create` — there is no worktree yet (a new role, a fresh clone, a new machine);
 *  - `rebase` — it exists, it is clean, and it sits somewhere else (the previous
 *    package's branch): move it to the base commit. Nothing is lost — the branch it
 *    is leaving still exists and still points where it did;
 *  - `keep` — a RESUMED run (R18): the session is being continued, and its tree is
 *    the state it was continuing from. Moving it would be the one thing a resume must
 *    never do;
 *  - `stash` — dirt left by a run THE CIRCUIT CUT OFF: parked under a label that names
 *    the run that made it, then the tree is moved to the base like any other. The one
 *    branch here that touches work nobody committed, which is why it is decided by a
 *    pure function and carried out by a single reversible git command;
 *  - `refuse` — dirt with an owner the package will not overrule: a run that ended its
 *    own turn, or no known run at all. Named with the repair, because there the repair
 *    is a judgement call (commit it, stash it, or read it and delete it).
 */
export type WorkspacePlan =
  | { readonly action: "ready" }
  | { readonly action: "create" }
  | { readonly action: "rebase" }
  | { readonly action: "keep" }
  | { readonly action: "stash"; readonly label: string; readonly from: string }
  | { readonly action: "refuse"; readonly reason: string };

/**
 * THE RELEASE REASONS THAT MEAN "THE CIRCUIT CUT THE RUN OFF" — the whole list, and no
 * more. Every other reason in `RELEASE_REASONS` is a turn that ENDED: `completed` and
 * the two interactive endings (`input-timeout`, `exited-while-waiting`) pass the turn
 * on, `exited-without-handoff` is a session that stopped talking of its own accord, and
 * `forced` is a human's decision about that tree — none of the five is a break the
 * package may tidy up after on its own.
 *
 * Kept as strings rather than as `ReleaseReason` so that a journal line from a future
 * version does not have to be understood before it can be judged: an unknown reason is
 * simply not in this set, and falls to the refusal.
 */
export const ABORTED_RUN_REASONS: readonly string[] = [
  "quota-exhausted",
  "timeout",
  "supervisor-gone",
  "stalled",
];

/**
 * The label a parked tree is found by. It is an ADDRESS, not a note: thread, session
 * and cause, in the order somebody looking for their work would ask for them
 * (`git stash list` prints it whole). A run that never announced a session id still
 * gets a label — `no-session` is a fact about that run, and a stash without a name
 * would be worse than one with an incomplete one.
 */
export const stashLabel = (input: {
  readonly thread?: string;
  readonly session?: string;
  readonly reason: string;
}): string => `wip ${input.thread ?? "no-thread"} ${input.session ?? "no-session"} ${input.reason}`;

/**
 * The path of a role's workspace. One role — one directory named after the role, and
 * the name is not configurable: the whole value of the layout is that "whose tree is
 * this" is answerable by reading the path.
 */
export const workspacePath = (input: {
  readonly repo: string;
  readonly worktrees: string;
  readonly role: string;
}): string => `${input.repo}/${input.worktrees}/${input.role}`.replace(/\/+/g, "/");

/**
 * The decision, from the facts and from whether this run is a continuation. Pure, so
 * that the one branch that destroys work if it is wrong (`rebase` over a dirty tree)
 * is decided by something a test can hold.
 */
export const planWorkspace = (input: {
  readonly facts: WorkspaceFacts;
  /** The commit the base branch resolves to right now. */
  readonly base: string;
  /** The run is a resume — the tree must be left exactly as the previous session left it. */
  readonly resuming: boolean;
  /**
   * How the PREVIOUS run of this (role, thread) ended — the whole input the dirt
   * question is answered from. Absent when the pair has no finished run behind it, and
   * that absence is meaningful: unattributed dirt is never parked.
   */
  readonly previousReason?: string;
  /** The session id of that run, when it announced one; it goes into the stash label. */
  readonly previousSession?: string;
  /** The thread this run is for — the other half of the label. */
  readonly thread?: string;
}): WorkspacePlan => {
  const { facts, base, resuming, previousReason } = input;
  if (facts.exists && facts.locked !== undefined) {
    // A LOCK IS CHECKED BEFORE EVERYTHING ELSE, including a resume. Whatever this run
    // wanted to do with the tree — move it, keep it, or merely put a session into it —
    // it would be doing it to a tree somebody else declared theirs. The refusal is the
    // same shape as the dirty one, and for the same reason: the package steps aside
    // and says whose it is (john's decision of 2026-07-25 22:20).
    return {
      action: "refuse",
      reason:
        facts.lockHolderAlive === false
          ? `the workspace is locked and the process that locked it is gone — '${facts.locked}'. A run was killed before it could release; read the tree, then 'git worktree unlock' it by hand — the circuit does not clear a lock it did not set`
          : `the workspace is locked by another run — '${facts.locked}'. Two sessions in one tree is exactly what a workspace exists to prevent; wait for it or stop it`,
    };
  }
  if (!facts.exists) {
    if (resuming) {
      // A session cannot be continued in a workspace that no longer exists: its
      // uncommitted state was the point of continuing. Loud, because the alternative
      // is a resume that quietly starts from nothing.
      return {
        action: "refuse",
        reason:
          "the workspace does not exist, yet the run was planned as a resume — the state the session would continue from is gone",
      };
    }
    return { action: "create" };
  }
  if (resuming) return { action: "keep" };
  if (facts.dirty === true) {
    if (previousReason !== undefined && ABORTED_RUN_REASONS.includes(previousReason)) {
      return {
        action: "stash",
        from: previousReason,
        label: stashLabel({
          ...(input.thread === undefined ? {} : { thread: input.thread }),
          ...(input.previousSession === undefined ? {} : { session: input.previousSession }),
          reason: previousReason,
        }),
      };
    }
    return {
      action: "refuse",
      reason:
        previousReason === undefined
          ? "the workspace has uncommitted changes and no finished run of this pair to attribute them to — they may be a human's, and the circuit does not park work whose owner it does not know. Commit, stash or discard them by hand"
          : `the workspace has uncommitted changes left by a run that ENDED ITS OWN TURN ('${previousReason}') — that is a failure to finish, not the leftovers of a break: a session that passes the turn on leaves its tree clean. Read them before anything else, then commit or discard them by hand`,
    };
  }
  return facts.head === base ? { action: "ready" } : { action: "rebase" };
};

/** The plan in one line — printed before it is carried out, never after. */
export const describeWorkspacePlan = (input: {
  readonly role: string;
  readonly path: string;
  readonly plan: WorkspacePlan;
  readonly base: string;
  readonly baseRef: string;
}): string => {
  const at = `${input.baseRef} ${input.base.slice(0, 8)}`;
  switch (input.plan.action) {
    case "ready":
      return `${input.role}: ${input.path} — already at ${at}`;
    case "create":
      return `${input.role}: ${input.path} — creating the worktree at ${at}`;
    case "rebase":
      return `${input.role}: ${input.path} — moving to ${at}`;
    case "keep":
      return `${input.role}: ${input.path} — kept as it is (the run is a resume)`;
    case "stash":
      return `${input.role}: ${input.path} — parking what the '${input.plan.from}' run left uncommitted as a stash ('${input.plan.label}'), then moving to ${at}`;
    case "refuse":
      return `${input.role}: ${input.path} — ${input.plan.reason}`;
  }
};

/**
 * THE PREFLIGHT LINE, and it is deliberately never a `fail`.
 *
 * A workspace that is dirty, or on a foreign branch, or missing altogether, is not a
 * reason to stop the whole circuit: it belongs to ONE role, and the daemon raises
 * several. The refusal happens where it applies — in that role's launch, with a
 * reason of its own — while preflight's job here is to make the state visible before
 * anything is raised.
 *
 * `ok` when the workspace is where it should be, `info` otherwise: a tick on a line
 * nobody compared is the defect R12 removed from this very file, and "there is no
 * workspace yet" is a legitimate state on a fresh machine.
 */
export const workspaceVerdict = (input: {
  readonly role: string;
  readonly path: string;
  readonly facts: WorkspaceFacts;
  readonly base: string;
  readonly baseRef: string;
}): PreflightCheck => {
  const name = `workspace: ${input.role}`;
  if (!input.facts.exists) {
    return {
      name,
      status: "info",
      detail: `${input.path} — no worktree yet; it is created at the launch, from ${input.baseRef}`,
    };
  }
  const where = input.facts.branch === "HEAD" ? "detached" : `on '${input.facts.branch}'`;
  const dirt = input.facts.dirty === true ? ", has unsaved changes" : "";
  if (input.facts.locked !== undefined) {
    // A LOCK IS SHOWN, NEVER CLEARED (john, 2026-07-25 22:20). A live run and a lock
    // left behind by a killed one look identical on disk, so the line says which of the
    // two git is holding — and the second one names the gesture that ends it. Automatic
    // clearing would be the circuit deciding, on a guess, that nobody is working there.
    return {
      name,
      status: "info",
      detail:
        input.facts.lockHolderAlive === false
          ? `${input.path} — LOCKED, and the process that locked it is gone: '${input.facts.locked}'. A run was killed before it could release; 'git worktree unlock ${input.path}' by hand`
          : `${input.path} — locked by a live run: '${input.facts.locked}'`,
    };
  }
  if (input.facts.head === input.base && input.facts.dirty !== true) {
    return {
      name,
      status: "ok",
      detail: `${input.path} — ${where} at ${input.baseRef}, clean`,
    };
  }
  return {
    name,
    status: "info",
    detail: `${input.path} — ${where} ${(input.facts.head ?? "?").slice(0, 8)}${dirt}; a fresh run moves it to ${input.baseRef}`,
  };
};

/**
 * WHOSE COMMITS COME OUT OF THIS TREE (thread 027) — the identity is a property of the
 * DIRECTORY here, because a workspace has exactly one writer for its whole life, and a
 * setting on disk survives what an environment variable does not: a resumed session, a
 * human who steps into the tree to look, a hook that commits on its own.
 *
 * IT IS SET WITH `--worktree`, AND THAT IS THE WHOLE DIFFICULTY. Linked worktrees SHARE
 * `.git/config` — a plain `git config user.name` in `.worktrees/dev-core` would sign
 * the operator's own checkout and every other role's tree as well, which is the exact
 * opposite of what this is for. The per-worktree file exists, but git only reads it
 * when `extensions.worktreeConfig` is enabled, so enabling it is part of the gesture.
 *
 * THE ONE CASE WHERE WE DO NOT ENABLE IT is the caveat git states itself: with the
 * extension on, `core.bare` and `core.worktree` become per-worktree, so a repository
 * that has them set in the common config needs them MOVED by hand first. Doing that
 * move on somebody's repository is not a package's business — it steps aside and says
 * so, and the launch goes on unsigned rather than half-configured.
 *
 * Applying it at EVERY launch and not once at creation is deliberate: a workspace that
 * was moved, re-created, or cloned onto another machine would otherwise be silently
 * back to the machine owner's name, and nothing would ever say so.
 */
export type WorkspaceIdentityPlan =
  | { readonly action: "set"; readonly identity: GitIdentity }
  | { readonly action: "skip"; readonly reason: string };

export const planWorkspaceIdentity = (input: {
  readonly role: string;
  /** `core.bare` of the repository's common config, as git prints it; absent when unset. */
  readonly bare?: string;
  /** `core.worktree` of the common config; absent when unset. */
  readonly coreWorktree?: string;
}): WorkspaceIdentityPlan => {
  const inTheWay = [
    ...(input.bare === "true" ? ["core.bare"] : []),
    ...(input.coreWorktree === undefined ? [] : ["core.worktree"]),
  ];
  if (inTheWay.length > 0) {
    return {
      action: "skip",
      reason: `${inTheWay.join(" and ")} is set in the shared config, and per-worktree identity needs 'extensions.worktreeConfig', which would change where git reads ${inTheWay.length > 1 ? "those" : "that"} from — move ${inTheWay.length > 1 ? "them" : "it"} to the main worktree's config.worktree by hand, then the commits will be signed by the role`,
    };
  }
  return { action: "set", identity: roleIdentity(input.role) };
};

/** The identity line printed beside the workspace plan — before the launch, never after. */
export const describeWorkspaceIdentity = (input: {
  readonly path: string;
  readonly plan: WorkspaceIdentityPlan;
}): string =>
  input.plan.action === "set"
    ? `${input.path} — commits as ${input.plan.identity.name} <${input.plan.identity.email}>`
    : `${input.path} — commits stay with the owner of the machine: ${input.plan.reason}`;

/**
 * THE LOCK HELD FOR THE DURATION OF A RUN (john's decisions of 2026-07-25, 21:10
 * requirement 1 and 22:20) — `git worktree lock`, taken BEFORE the tree is mutated and
 * held until the lease is released, by every path including the supervisor's own death.
 *
 * WHAT IT GUARDS, IN TWO PARTS, because they are two different failures:
 *
 *  1. **Cleanup under a live session.** `git worktree prune`/`remove`, and the human
 *     equivalents, refuse to touch a locked worktree. This is the part git enforces.
 *  2. **A second mutator.** A git lock does NOT stop another process from writing into
 *     the tree — nothing does. What stops it is THIS package refusing to start a run in
 *     a tree somebody else locked (`planWorkspace`), the same way it refuses a dirty
 *     one. The lease guards the pair (role, thread); the lock guards the TREE, which is
 *     shared by every thread of the role and by a manual run racing the daemon.
 *
 * The reason text is what a human sees in `git worktree list --porcelain`, so it names
 * the pair, the supervisor's pid and the moment: a lock left behind by a killed run is
 * then identifiable as stale — `lockHolderPid` reads that pid back out, and nobody has
 * to guess whether the run is alive.
 *
 * THE SESSION ID IS NOT IN IT, and that is not an omission: the lock is taken before
 * the spawn, and the id does not exist until the tool prints its own init line. The
 * pid is what identifies the holder at lock time; the journal ties pid to session
 * afterwards.
 */
export const lockReason = (input: {
  readonly role: string;
  readonly thread: string;
  readonly pid: number;
  readonly at: string;
}): string =>
  `agent-protocol: ${input.role} is running on ${input.thread} (supervisor pid ${input.pid}, since ${input.at})`;

/**
 * The pid out of a lock text, when it is one of ours. `undefined` for a lock a human
 * set by hand — and the caller must keep that case distinct from "the pid is dead":
 * a lock nobody can attribute is not evidence that it is stale.
 */
export const lockHolderPid = (reason: string): number | undefined => {
  const found = /supervisor pid (\d+)/.exec(reason);
  return found === null ? undefined : Number(found[1]);
};

/**
 * THE LOCKS THIS PROCESS HOLDS — a registry keyed by workspace PATH, not a single
 * slot (finding B of thread 023).
 *
 * It used to be one variable: "one per process by construction — the daemon raises
 * sessions one at a time". That construction is exactly what D-2 removes. With N
 * supervisors inside one daemon the second `take` overwrote the first one's entry,
 * and the release — which has only ever been able to release what it remembers —
 * then unlocked the LAST tree and left the earlier one locked forever. R17 reads a
 * foreign lock as a refusal to start, so the failure mode was roles dropping out of
 * the circuit one by one, silently, for a reason no journal names. Keyed by path,
 * every holder releases its own and nobody else's.
 *
 * Why path and not role: the lock is a fact about a TREE (see `lockReason`), and the
 * path is what `git worktree lock` is given. A role owns one workspace today, but the
 * registry must agree with the thing it mirrors, not with the layout above it.
 *
 * The git calls are injected rather than imported so the registry is testable without
 * a repository: `lock` returns whether git took it (it FAILS on an already-locked
 * tree — that failure is the atomic check the caller relies on), `unlock` is
 * best-effort.
 */
export type WorkspaceLockGit = {
  readonly lock: (input: {
    readonly repo: string;
    readonly path: string;
    readonly reason: string;
  }) => boolean;
  readonly unlock: (input: { readonly repo: string; readonly path: string }) => void;
};

export type WorkspaceLocks = {
  /** `false` — somebody won the race; nothing was recorded and the caller refuses. */
  readonly take: (input: {
    readonly repo: string;
    readonly path: string;
    readonly reason: string;
  }) => boolean;
  /**
   * Release ONE path — idempotent, and safe on a path that never took a lock (the
   * pre-R17 mode runs in the supervisor's own tree and takes none). A path this
   * process does not hold is left alone: unlocking somebody else's tree is the very
   * failure the registry exists to prevent.
   */
  readonly release: (path: string) => void;
  /**
   * Release EVERYTHING still held — the process-exit backstop, and the only caller
   * that is allowed not to name a path: at `exit` there is nobody left to ask which
   * of the live supervisors this is.
   */
  readonly releaseAll: () => void;
  /** What is held right now, for tests and for a status line. */
  readonly held: () => readonly string[];
};

export const createWorkspaceLocks = (git: WorkspaceLockGit): WorkspaceLocks => {
  const held = new Map<string, string>(); // path → repo
  return {
    take: (input) => {
      if (!git.lock(input)) return false;
      held.set(input.path, input.repo);
      return true;
    },
    release: (path) => {
      const repo = held.get(path);
      if (repo === undefined) return;
      held.delete(path);
      git.unlock({ repo, path });
    },
    releaseAll: () => {
      for (const [path, repo] of [...held]) {
        held.delete(path);
        git.unlock({ repo, path });
      }
    },
    held: () => [...held.keys()],
  };
};

/**
 * The line for the checkout NOBODY works in any more. It is printed for exactly as
 * long as it takes to notice that it changed meaning: with workspaces declared, the
 * branch of the operator's own tree stops deciding anything, and comparing it against
 * `workdir.branch` would resurrect the refusal R17 was written to remove.
 */
export const mainCheckoutVerdict = (input: {
  readonly repo: string;
  readonly branch: string;
  readonly dirty: boolean;
}): PreflightCheck => ({
  name: "main checkout",
  status: "info",
  detail: `${input.repo} — on '${input.branch}'${input.dirty ? ", has unsaved changes" : ""}; not a workplace of any role (the sessions land in their own worktrees)`,
});
