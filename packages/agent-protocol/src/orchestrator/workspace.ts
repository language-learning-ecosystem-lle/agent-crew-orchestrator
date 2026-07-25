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
 * WHY A DIRTY WORKSPACE IS A REFUSAL AND NEVER A REPAIR. The same rule the mail
 * checkout has followed since S8: we do not repair at somebody else's expense.
 * Uncommitted changes in a role's workspace are the work of a session that broke off
 * mid-edit, and `checkout --detach` over them would destroy exactly the material a
 * human needs in order to understand the break. The circuit steps aside and says so.
 *
 * This module is the pure core: facts in, a plan and a verdict out. The git calls
 * live in the CLI, where the IO is.
 */
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
 * WHAT THE ORCHESTRATOR IS ABOUT TO DO WITH THE WORKSPACE. Four outcomes, and the
 * split matters because two of them are actions on somebody's disk:
 *
 *  - `ready` — it is already detached at the base commit; nothing to do;
 *  - `create` — there is no worktree yet (a new role, a fresh clone, a new machine);
 *  - `rebase` — it exists, it is clean, and it sits somewhere else (the previous
 *    package's branch): move it to the base commit. Nothing is lost — the branch it
 *    is leaving still exists and still points where it did;
 *  - `keep` — a RESUMED run (R18): the session is being continued, and its tree is
 *    the state it was continuing from. Moving it would be the one thing a resume must
 *    never do;
 *  - `refuse` — a dirty tree with nothing to resume. Named with the repair, because
 *    the repair is a judgement call (commit it, stash it, or read it and delete it)
 *    and the package must not make it.
 */
export type WorkspacePlan =
  | { readonly action: "ready" }
  | { readonly action: "create" }
  | { readonly action: "rebase" }
  | { readonly action: "keep" }
  | { readonly action: "refuse"; readonly reason: string };

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
}): WorkspacePlan => {
  const { facts, base, resuming } = input;
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
    return {
      action: "refuse",
      reason:
        "the workspace has uncommitted changes — they are the leftovers of a session that broke off, and moving the tree to the base would destroy them. Commit, stash or discard them by hand",
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
