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

/**
 * ONE UNCOMMITTED PATH, AS GIT REPORTS IT (thread 099). The line counts are the ones
 * `git diff HEAD --numstat` gives, so they are absent for a file git has never seen —
 * "untracked, not counted" is a fact, and inventing a number for it by reading the file
 * would be the door guessing.
 */
export type WorkspaceDirtFile = {
  readonly path: string;
  /** `untracked` for a new file, otherwise git's porcelain code read into a word. */
  readonly what: string;
  readonly added?: number;
  readonly removed?: number;
};

/** Everything uncommitted in one tree — the whole list, never a pre-truncated one. */
export type WorkspaceDirt = {
  readonly files: readonly WorkspaceDirtFile[];
};

/** How many paths of the dirt a refusal spells out before it starts counting. */
export const DIRT_FILES_SHOWN = 5;

/**
 * THE DIRT READ TO A HUMAN WHO IS NOT AT THE MACHINE (thread 099, point 2 of the
 * statement) — the whole point is that the composition of the tree is decidable from the
 * refusal alone: on 2026-09-03 john learned what was in it only after three commands on
 * the box, and the tree meanwhile held the role on all of its threads.
 *
 * THE LIST IS CAPPED AND SAYS SO. A tree with two hundred changed paths would otherwise
 * push the repair command out of anybody's screen; a cap that printed five and fell
 * silent would read as "five files", which is the same defect one level quieter. So the
 * remainder is counted out loud.
 */
export const describeWorkspaceDirt = (dirt: WorkspaceDirt): string => {
  if (dirt.files.length === 0) return "nothing (git reported no changed path)";
  const shown = dirt.files.slice(0, DIRT_FILES_SHOWN).map((file) => {
    const lines =
      file.added === undefined && file.removed === undefined
        ? "not counted"
        : `+${file.added ?? 0}/-${file.removed ?? 0}`;
    return `${file.path} (${file.what}, ${lines})`;
  });
  const rest = dirt.files.length - shown.length;
  return `${dirt.files.length} path(s) — ${shown.join(", ")}${rest > 0 ? `, and ${rest} more not listed here ('git -C <workspace> status --porcelain' has all of them)` : ""}`;
};

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
   * WHAT exactly is uncommitted (thread 099) — absent when nothing is, and absent also
   * when nobody asked: a caller that only needs `dirty` does not pay for the second git
   * call. The refusal degrades to the count it can prove rather than to silence.
   */
  readonly dirt?: WorkspaceDirt;
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
  /**
   * WHAT GIT WOULD SIGN A COMMIT MADE HERE WITH — `user.name`/`user.email` as git
   * itself resolves them (worktree → local → global → system), not as a reader of
   * files guesses them.
   *
   * The absence of the whole field and an empty object are DIFFERENT facts, and the
   * difference is load-bearing: absent means "nobody asked" (a caller that builds
   * facts without probing git config), `{}` means "asked, and nothing is set" — a tree
   * whose commits would carry the machine owner's name or none at all.
   */
  readonly signature?: { readonly name?: string; readonly email?: string };
  /**
   * WHO WROTE THE COMMIT THE HEAD POINTS AT (thread 099) — the second proof that a
   * branch under a dirty tree is the role's own, for the branch names that carry no
   * role in them (`feat/…`, `fix/…`). Absent when nobody asked or when the head is
   * detached, and absence is simply "no such proof", never "not the role's".
   */
  readonly headAuthor?: string;
};

/**
 * WHAT THE ORCHESTRATOR IS ABOUT TO DO WITH THE WORKSPACE. Seven outcomes, and the
 * split matters because four of them are actions on somebody's disk:
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
 *  - `commit` — dirt left by a run that ENDED ITS OWN TURN, in a tree whose head the
 *    role owns: committed under the role's signature, onto that branch or onto a
 *    service branch this plan names (john, 2026-09-05, thread 099). Nothing is hidden
 *    and nothing is destroyed — the work keeps an address a human can read a week
 *    later, and the role starts on the next tick instead of on the next human;
 *  - `refuse` — dirt with an owner the package will not overrule: no known run at all
 *    (the changes may be a human's), or a head that is not the role's to commit onto.
 *    Named with the repair, because there the repair is a judgement call (commit it,
 *    stash it, or read it and delete it).
 */
export type WorkspacePlan =
  | { readonly action: "ready" }
  | { readonly action: "create" }
  | { readonly action: "rebase" }
  | { readonly action: "keep" }
  | { readonly action: "stash"; readonly label: string; readonly from: string }
  | {
      readonly action: "commit";
      /** Where it lands — an existing branch of the role, or one this plan names. */
      readonly branch: string;
      /** `true` — the branch does not exist yet and the commit starts it. */
      readonly create: boolean;
      readonly message: string;
      /** The release reason of the run that left the dirt — it goes into the message. */
      readonly from: string;
    }
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
  "auth-failed",
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
 * THE SAME FORK READ FROM THE OTHER END OF THE RUN (thread 023, requirement 5, second
 * half) — not "whose dirt is this" at the next launch, but "did THIS run leave any" at
 * its own release.
 *
 * Why both halves exist. The first one decides what to DO with a dirty tree; it runs at
 * the next launch, which may be an hour later, and it can only ever speak about the run
 * before it in the past tense. The requirement's second sentence is about the run
 * itself: a session that passes the turn on and leaves uncommitted changes has failed to
 * finish, and that failure must be NAMED IN THE RELEASE — not met later as a silent skip
 * of the next package. Four such skips in one morning were diagnosed by hand, each time
 * by a human reading a tree to find out which run made it; the release event is where
 * that answer already exists.
 *
 * The condition is the complement of `ABORTED_RUN_REASONS`, deliberately reusing that
 * one list rather than spelling out the endings: a reason the circuit did not cut off is
 * a turn the run ENDED — `completed`, `exited-without-handoff`, and both interactive
 * endings (R19), where the question is in the thread and the tree still should have been
 * clean. A future reason nobody here knows about falls on this side too, which is the
 * safe side: it is a line in a log, not a gesture on a disk.
 */
export const dirtLeftByFinish = (input: {
  readonly reason: string;
  readonly dirty: boolean;
}): boolean => input.dirty && !ABORTED_RUN_REASONS.includes(input.reason);

/**
 * What the release says about it — one sentence, and it names the NEXT consequence
 * rather than only the fact: the cost of this dirt is paid by the following package, and
 * whoever reads the line an hour later has to be told that without having to know R17.
 */
export const describeFinishDirt = (input: {
  readonly reason: string;
  readonly path: string;
}): string =>
  `the run ended its own turn ('${input.reason}') and LEFT ITS WORKSPACE DIRTY — ${input.path} has uncommitted changes. A session that passes the turn on commits or discards its work; the next package of this role will refuse to start until somebody reads that tree`;

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
 * WHOSE WORKSPACE THIS CHECKOUT IS — the inverse of `workspacePath`, and the ONE answer
 * every guard about "am I standing in a role's tree" is allowed to use (`zones check
 * --role-from-workspace`, `systemd install`). It exists as a function rather than as two
 * copies of the same four lines because the two guards disagreeing would be worse than
 * either of them being wrong: one would refuse what the other passes, in the same tree.
 *
 * The judgement is exactly as narrow as the layout it reads: the last path segment must
 * name a role OF THE CONFIG, and the whole path must be the one `workspacePath` builds
 * for that role. Anything else — the operator's own checkout, a CI checkout, the mail
 * worktree, a linked worktree somebody made by hand — is NOT a role workspace and gets
 * `undefined`; what a caller does with that (pass, note, refuse) is the caller's, and
 * this function never decides it.
 */
export const workspaceRoleOf = (input: {
  /** The checkout being judged, absolute and already at its top level. */
  readonly checkout: string;
  /** The home checkout the workspaces hang under (R26). */
  readonly repo: string;
  /** `orchestrator.workdir.worktrees` — `undefined` when the project declares none. */
  readonly worktrees?: string;
  /** The role ids of the config; a directory named after a non-role is not a workspace. */
  readonly roles: readonly string[];
}): string | undefined => {
  if (input.worktrees === undefined) return undefined;
  const here = input.checkout.replace(/\/+$/, "");
  const candidate = here.slice(here.lastIndexOf("/") + 1);
  if (!input.roles.includes(candidate)) return undefined;
  return workspacePath({ repo: input.repo, worktrees: input.worktrees, role: candidate }) === here
    ? candidate
    : undefined;
};

/**
 * THE REFUSAL THAT CAN BE ACTED ON WITHOUT GOING TO THE BOX (thread 099) — the second
 * half of "a door that stays silent is worse than none" (role card, discipline 4), and
 * the half this door was missing: it named the fault correctly and left the reader with
 * "read that tree, then commit or discard by hand" — not one command, not one file name.
 *
 * WHAT IT COST, MEASURED. 2026-09-03, consumer contour: one edit of `claude-review.yml`
 * left by a cut-off session held `dev-core` out of the circuit for sixteen minutes with
 * five threads waiting — and the sixteen minutes were not the reading, they were a human
 * finding out WHAT was there and inventing the gestures that clear it.
 *
 * THREE THINGS, AND THE THIRD IS THE ONE NOBODY KNEW. What lies in the tree; the two
 * repairs, spelled out as commands with this tree's own path in them; and that the tree
 * holds the role on EVERY thread it has a turn on, not on this one — the daemon skips
 * the role's every pair on the same fact, and the journal was the only place that said
 * so (`dev-core×124`, `×128`, `×130` in one tick).
 *
 * IT PROPOSES AND NEVER PERFORMS. Whether the circuit may park a role's uncommitted work
 * by itself is john's open question in that thread; until it is answered both gestures
 * belong to a human, and the door's job is to make them one paste each.
 */
export const describeDirtyWorkspaceRepair = (input: {
  readonly role: string;
  readonly path: string;
  /** The thread this launch was for — the branch name and the message are named after it. */
  readonly thread?: string;
  readonly dirt?: WorkspaceDirt;
}): string => {
  const branch = `${input.role}/${input.thread ?? "wip"}`;
  const message = `wip(${input.thread ?? "wip"}): what the interrupted run left`;
  const lies =
    input.dirt === undefined
      ? `What lies there did not read; ask the tree: git -C ${input.path} status --porcelain`
      : `What lies there: ${describeWorkspaceDirt(input.dirt)}`;
  return [
    lies,
    `Until it is clean '${input.role}' is skipped on EVERY thread it holds a turn on, not only this one — the workspace belongs to the role, not to the thread`,
    `Read it, then either KEEP it — git -C ${input.path} checkout -b ${branch} && git -C ${input.path} add -A && git -C ${input.path} commit -m '${message}' && git -C ${input.path} push -u origin ${branch} — or PARK it: git -C ${input.path} stash push -u -m '${message}'. Either one leaves the tree clean and the role starts on the next tick`,
  ].join(". ");
};

/**
 * WHOSE HEAD THE DIRTY TREE IS SITTING ON (thread 099, john's §2 of 2026-09-05) — the
 * fork the right to commit is decided by, and it is a DECISION for every state, not a
 * default for the ones nobody enumerated.
 *
 * THE STATES, MEASURED RATHER THAN REMEMBERED (the branches this contour actually made:
 * `dev-core/128-…`, `core/gate-checks-from-actions`, `feat/042-…`, `fix/122-…`, `main`):
 *
 *  - `detached` — the ordinary state, because every launch puts the tree back on the
 *    base COMMIT (`create`/`rebase` both `checkout --detach`). The dirt of a session
 *    that never branched lands here, and this is the field case john repaired by hand
 *    twice;
 *  - `own` — a branch the role itself is standing on. Two proofs, in THIS ORDER,
 *    because the branch names in the field carry no role (`feat/042-…` is as much
 *    dev-core's as `dev-core/128-…`): the NAME (`<role>/…`), and — only for a name that
 *    carries no role of the contour's at all — the AUTHOR of the commit the head points
 *    at, which is the role's own signature (`roleIdentity`) written by the very
 *    mechanism that signs this workspace;
 *  - `base` — the base branch itself. It is shared, and john's §2 point 3 is dead
 *    literal about it: never a common branch. (Git normally makes this unreachable —
 *    the base is checked out in the operator's own tree — which is exactly why it is
 *    written down as a decision rather than left to that accident.);
 *  - `foreign` — any other named branch: another role's, a human's, something checked
 *    out by hand. The right is narrow — "the role's own workspace, the role's own
 *    work" — and outside it the door keeps working the way it worked before.
 *
 * THE SIGNATURE DOES NOT OVERRULE ANOTHER ROLE'S NAME (curator, 2026-09-05, thread 099,
 * ruling on this very fork). A head on `curator/017-…` signed by `dev-core` is FOREIGN,
 * and the two errors cost different things: a false `own` commits and force-pushes into
 * a branch that carries another role's name — if a PR is open under it, the head moves
 * and a verdict is annulled — while a false `foreign` is the refusal that stood here
 * before this right existed. And the NAME is what a human reads: john's own hand-repairs
 * addressed the work by branch name, not by `git log`.
 *
 * WHICH MEANS THE CONTOUR'S ROLES ARE AN INPUT, and what happens without them is a
 * DECISION rather than an oversight: with no list, "carries no role's name" cannot be
 * told from "carries another role's name", so the signature is not consulted at all and
 * the head is `foreign` with `roles-unknown` on it — the refusal names that it judged
 * without the list. A forgotten argument on the live call must not quietly restore the
 * behaviour this ruling replaced.
 */
export type WorkspaceHeadOwner =
  | { readonly kind: "detached" }
  | { readonly kind: "own"; readonly branch: string }
  | { readonly kind: "base"; readonly branch: string }
  | {
      readonly kind: "foreign";
      readonly branch: string;
      readonly why: WorkspaceHeadForeignCause;
      /** The role the name belongs to — only on `another-role`, and only that role's id. */
      readonly owner?: string;
    };

/** Why a named head is not the role's — the three answers the refusal has to tell apart. */
export type WorkspaceHeadForeignCause =
  /** The first segment of the name is another role of this contour. Signature ignored. */
  | "another-role"
  /** No role's name in it, and the head is not signed by this role either. */
  | "not-signed"
  /** The contour's roles were not handed in, so the name could not be judged at all. */
  | "roles-unknown";

export const classifyWorkspaceHead = (input: {
  readonly role: string;
  /** `git rev-parse --abbrev-ref HEAD` — the literal `HEAD` when the head is detached. */
  readonly branch?: string;
  /** The base as the launch resolved it (`origin/main`), so `main` is recognised on both spellings. */
  readonly baseRef?: string;
  /** The author email of the commit the head points at, when it was read. */
  readonly headAuthor?: string;
  /**
   * The ids of the contour's roles — the daemon already parses the thread with them, so
   * this introduces no config key of its own. Absent is a named state, not a default:
   * see `roles-unknown` above.
   */
  readonly roles?: readonly string[];
}): WorkspaceHeadOwner => {
  const branch = input.branch;
  if (branch === undefined || branch === "" || branch === "HEAD") return { kind: "detached" };
  const base = input.baseRef;
  if (base !== undefined && (base === branch || base.endsWith(`/${branch}`)))
    return { kind: "base", branch };
  if (branch.startsWith(`${input.role}/`)) return { kind: "own", branch };
  if (input.roles === undefined) return { kind: "foreign", branch, why: "roles-unknown" };
  const owner = input.roles.find((id) => id !== input.role && branch.startsWith(`${id}/`));
  if (owner !== undefined) return { kind: "foreign", branch, why: "another-role", owner };
  return input.headAuthor === roleIdentity(input.role).email
    ? { kind: "own", branch }
    : { kind: "foreign", branch, why: "not-signed" };
};

/**
 * THE NAME OF A SERVICE BRANCH, AND THE NAME IS THE WHOLE ANSWER TO "how are they
 * visible" (john's §3 point 2, thread 099): role, thread, time — the three questions
 * somebody asks a week later, in that order, without opening the branch.
 *
 * `wip/` FIRST so that every one of them is one glob away (`git branch --list 'wip/*'`)
 * and none of them can ever be mistaken for a package's branch: a service branch is the
 * circuit's note to a role, not work anybody promised to finish.
 *
 * THE TIME COMES IN, it is never read here: a name that depends on the wall clock cannot
 * be asserted by a test, and this package has paid for that once already.
 */
export const serviceBranchName = (input: {
  readonly role: string;
  readonly thread?: string;
  /** An ISO instant — `2026-09-05T12:31:07Z`; only its date and minutes reach the name. */
  readonly at: string;
}): string =>
  `wip/${input.role}/${input.thread ?? "no-thread"}-${input.at
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z?$/, "")
    .replace(/(\d{8}T\d{4})\d{2}Z?$/, "$1Z")}`;

/**
 * WHOSE SERVICE BRANCH THIS IS, AND WHEN IT WAS MADE — the inverse of
 * `serviceBranchName` and the ONLY reader of that name (B.3, thread 099; john's §3
 * point 3: "ветка не живёт вечно молча — возраст называется в сводке").
 *
 * THE NAME IS THE SOURCE AND THERE IS NO SECOND ONE. The commit date of the branch
 * would be a second answer to the same question, and two readings of one fact is how
 * they start to differ: `serviceBranchName` PUT the instant into the name for exactly
 * this reader, so this reader takes it from there. It also means the summary costs one
 * `for-each-ref` and no per-branch git call.
 *
 * WHAT A NAME THAT DOES NOT PARSE MEANS. `wip/…` is a namespace, not a lock — a human
 * can push anything under it. Such a branch is NOT dropped from the count: it is listed
 * and said to be unreadable, because a service branch that vanishes from the summary is
 * the very silence B.3 exists to close.
 */
export type ServiceBranchFacts = {
  /** The ref name as git printed it. */
  readonly name: string;
  /** The role the name claims; absent when the name is not one this package made. */
  readonly role?: string;
  /** The thread the name claims; absent for `no-thread` and for an unreadable name. */
  readonly thread?: string;
  /** The instant the name carries, to the minute; absent when the name is unreadable. */
  readonly at?: Date;
};

/** `wip/<role>/<thread>-<YYYYMMDDTHHMMZ>` — the shape `serviceBranchName` writes. */
const SERVICE_BRANCH = /^wip\/([^/]+)\/(.+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/;

export const readServiceBranchName = (name: string): ServiceBranchFacts => {
  const parsed = SERVICE_BRANCH.exec(name);
  if (parsed === null) return { name };
  const [, role, thread, year, month, day, hour, minute] = parsed;
  const at = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  // A NAME CAN CARRY DIGITS AND STILL NOT CARRY A MOMENT (`…-20261305T1231Z`). The
  // regexp counts digits; only the calendar knows whether they are a date, and a row
  // that printed `Invalid Date` would be worse than one saying the name is unreadable.
  if (Number.isNaN(at.getTime())) return { name };
  return {
    name,
    role: role as string,
    ...(thread === "no-thread" ? {} : { thread: thread as string }),
    at,
  };
};

/**
 * An age a human reads rather than counts. Days appear because these branches are
 * measured in days by construction — one is made when a run ends without committing,
 * and it lives until a role comes back to its own workspace.
 */
export const serviceBranchAge = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 90) return `${whole}s`;
  const minutes = Math.round(whole / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

/**
 * THE SUMMARY'S ANSWER TO "AND WHAT IF THE ROLE NEVER CAME BACK" (B.3, thread 099).
 *
 * WHY IT SPEAKS WHEN THERE ARE NONE, unlike the merge-ready tier and the code age. Those
 * two are alarms and silence is their good news; this is an INVENTORY, and an inventory
 * that prints nothing leaves "no service branches exist" indistinguishable from "the
 * summary does not know about them" — which is the state this whole thread is about.
 *
 * NO THRESHOLD AND NO ⚠ ON AGE. john's requirement is that the age be NAMED, and a term
 * ("old after N days") would be a policy nobody has decided, plus a config key
 * curator's §5 forbids. The reader is given the number and the branch's own address; the
 * end of the branch stays the hand of the role that finds it (B.1).
 */
export const describeServiceBranches = (
  branches: readonly string[],
  now: Date,
): readonly string[] => {
  if (branches.length === 0) {
    return ["service branches: none — no run has left uncommitted work for the circuit to commit"];
  }
  const rows = [...branches].sort().map((name) => {
    const facts = readServiceBranchName(name);
    if (facts.role === undefined || facts.at === undefined) {
      return `  ${name} — ⚠ THIS NAME SAYS NEITHER WHOSE NOR WHEN: it is not one this package writes ('wip/<role>/<thread>-<YYYYMMDDTHHMMZ>'), so no role is named to take it or drop it`;
    }
    const age = serviceBranchAge((now.getTime() - facts.at.getTime()) / 1000);
    const thread = facts.thread === undefined ? "no thread named" : `thread ${facts.thread}`;
    return `  ${name} — ${facts.role} · ${thread} · ${age} old (made ${facts.at.toISOString()})`;
  });
  return [
    `service branches (${branches.length}) — what the circuit committed for a run that ended without committing it; the role that finds its own TAKES IT OR DROPS IT, saying why:`,
    ...rows,
  ];
};

/**
 * The message of that commit. It says what a reader of `git log` needs and nothing
 * else: the thread it belongs to, and that the run did not write it — the circuit did,
 * after that run ended without cleaning up.
 */
export const dirtCommitMessage = (input: {
  readonly thread?: string;
  readonly reason: string;
  readonly role: string;
}): string =>
  `wip(${input.thread ?? "no-thread"}): what the '${input.reason}' run of '${input.role}' left uncommitted`;

/**
 * THE TIDY-UP THAT DID NOT WORK (john's §4 exception, thread 099). john took the
 * repeat-lock off the SUCCESSFUL path — a tree that got committed is clean by the next
 * tick, and there is nothing to say twice — but a failed commit leaves the tree dirty,
 * and then the door is back where it was: refusing every tick.
 *
 * So the refusal keeps everything the refusal of #261 had — what lies there, that the
 * ROLE and not the thread is held, both repairs as one paste each — and adds the one
 * thing that is new: WHAT the circuit tried and how git answered. Without that line a
 * reader cannot tell "the circuit may not touch this" from "the circuit tried and
 * failed", and those two ask a human for opposite things.
 *
 * THIS TEXT IS FOR THE NARROW CASE WHERE NOTHING MOVED — the very first step of the
 * attempt (`checkout -b`) is what git refused, so the tree is still detached exactly
 * where the session left it and #261's repair is still literally true. The moment the
 * branch exists, it is not: see `describeFailedTidyUpOnItsBranch`.
 */
export const describeFailedTidyUp = (input: {
  readonly role: string;
  readonly path: string;
  readonly branch: string;
  readonly cause: string;
  readonly thread?: string;
  readonly dirt?: WorkspaceDirt;
}): string =>
  `the workspace has uncommitted changes the circuit was allowed to commit for '${input.role}' — and the commit FAILED before it started: ${input.cause} (branch '${input.branch}' was never created). The tree is still dirty and still detached, so this is the same stop as before, with a cause. ${describeDirtyWorkspaceRepair(
    {
      role: input.role,
      path: input.path,
      ...(input.thread === undefined ? {} : { thread: input.thread }),
      ...(input.dirt === undefined ? {} : { dirt: input.dirt }),
    },
  )}`;

/**
 * THE TIDY-UP THAT FAILED WITH THE TREE ALREADY ON A BRANCH — the third of the four
 * ends the attempt has, and the one that was speaking somebody else's text until the
 * reviewer of #279 measured it (2026-09-05).
 *
 * WHY IT CANNOT BE THE TEXT ABOVE. The attempt gets as far as `checkout -b` before
 * `add -A`/`commit` refuses, and git carries uncommitted work across that checkout — so
 * the tree is dirty ON THE SERVICE BRANCH, no longer detached, and the branch exists.
 * `describeDirtyWorkspaceRepair`'s `checkout -b <role>/<thread>` would then branch a
 * SECOND time off it and leave the first behind: a branch nothing has ever named out
 * loud, which the statement of this thread (curator, §2) forbids exactly — a service
 * branch owes a human its name, its end, and who sweeps it.
 *
 * AND IT COVERS THE OTHER HALF OF THE SAME SHAPE: a tree that was already standing on
 * the role's OWN branch (`create: false`) and whose commit failed. Nothing moved there,
 * but `checkout -b` onto a branch that exists refuses all the same — the repair has to
 * be "finish it where it stands" in both, and `created` is the one word that differs:
 * it tells a human whether this attempt made that branch (and may therefore take it
 * back) or found it already there.
 */
export const describeFailedTidyUpOnItsBranch = (input: {
  readonly role: string;
  readonly path: string;
  readonly branch: string;
  /** Did THIS attempt create the branch the tree now stands on, or was it already its own? */
  readonly created: boolean;
  /** The message the commit would have carried — the repair offers the same one. */
  readonly message: string;
  /** The base commit, so "take the branch back" is a command and not a placeholder. */
  readonly base: string;
  readonly cause: string;
  readonly dirt?: WorkspaceDirt;
}): string =>
  [
    `the workspace has uncommitted changes the circuit was allowed to commit for '${input.role}' — and the commit FAILED: ${input.cause}`,
    input.created
      ? `the attempt got as far as creating the service branch '${input.branch}' and moving the workspace onto it, so the tree is NO LONGER detached: it is dirty ON THAT BRANCH, and nothing is lost`
      : `the tree is still dirty on '${input.branch}', the role's own branch, where the session left it`,
    input.dirt === undefined
      ? `What lies there did not read; ask the tree: git -C ${input.path} status --porcelain`
      : `What lies there: ${describeWorkspaceDirt(input.dirt)}`,
    `Until it is clean '${input.role}' is skipped on EVERY thread it holds a turn on, not only this one — the workspace belongs to the role, not to the thread`,
    `Read why git refused, then either FINISH it WHERE IT NOW STANDS — git -C ${input.path} add -A && git -C ${input.path} commit -m '${input.message}' && git -C ${input.path} push -u origin ${input.branch} — or PARK it: git -C ${input.path} stash push -u -m '${input.message}'${
      input.created
        ? ` && git -C ${input.path} checkout --detach ${input.base} && git -C ${input.path} branch -D ${input.branch}, which also takes back the branch this attempt made`
        : ""
    }. Either one leaves the tree clean and the role starts on the next tick`,
  ].join(". ");

/**
 * THE TIDY-UP THAT WORKED AND THEN GOT STUCK — the commit landed, and the step AFTER it
 * (putting the workspace back on the base commit) is what git refused.
 *
 * IT IS A SEPARATE TEXT BECAUSE EVERY WORD OF THE OTHER ONE WOULD BE FALSE HERE
 * (reviewer's finding on #279, 2026-09-05): the commit did NOT fail, the tree is NOT
 * dirty, the dirt listing was taken BEFORE the commit and now names paths that are
 * safely inside it, and `describeDirtyWorkspaceRepair`'s `checkout -b` would refuse on a
 * branch that already exists. What a human has to do here is the opposite gesture — the
 * work is saved and the tree needs moving, not saving.
 *
 * The launch still stops: a workspace left on a branch is not a tree the next run may
 * rebase, and the refusal that says so is cheaper than a run that starts on the wrong
 * head.
 */
export const describeStrandedWorkspace = (input: {
  readonly role: string;
  readonly path: string;
  readonly branch: string;
  readonly head: string;
  readonly cause: string;
  /** How the push went, when it did not go: the same string the successful note carries. */
  readonly push?: string;
}): string =>
  [
    `the workspace had uncommitted changes and the circuit committed them for '${input.role}': they are commit ${input.head} on '${input.branch}'${input.push === undefined ? " and pushed" : ` — NOT pushed (${input.push}); it is on this box only`}`,
    `nothing is dirty and nothing is lost — what failed is the step after it, moving the workspace back to the base: ${input.cause}`,
    `so the tree is CLEAN and still standing on '${input.branch}'. Read why git refused, then put it back by hand — git -C ${input.path} status --porcelain && git -C ${input.path} checkout --detach <base> — and '${input.role}' starts on the next tick`,
  ].join(". ");

/**
 * WHY THIS HEAD IS NOT THE ROLE'S, IN THE REFUSAL ITSELF. A door that refuses without
 * naming what to fix is a defect even when the logic is right, and the three causes are
 * repaired by three different gestures: another role's branch is a tree somebody moved
 * by hand, an unsigned one is dirt of unknown authorship, and `roles-unknown` is a
 * caller that forgot an argument — a fault of ours, and it says so.
 */
const describeForeignHead = (input: {
  readonly role: string;
  readonly owner: Extract<WorkspaceHeadOwner, { kind: "foreign" }>;
}): string => {
  switch (input.owner.why) {
    case "another-role":
      return `a branch named for '${input.owner.owner}', another role of this contour — and a head signed by '${input.role}' does NOT make it this role's to write to: the name is the address a human reads, and a commit landing under it would move a head that is not ours`;
    case "roles-unknown":
      return `a branch this plan could not judge: the contour's roles were not handed to it, so a name carrying no role could not be told apart from one carrying another role's, and the head was taken as foreign rather than guessed at (the caller owes the plan its role ids)`;
    default:
      return `a branch that is not '${input.role}'s to write to (neither named for the role nor signed by it)`;
  }
};

/**
 * The decision, from the facts and from whether this run is a continuation. Pure, so
 * that the one branch that destroys work if it is wrong (`rebase` over a dirty tree)
 * is decided by something a test can hold.
 */
export const planWorkspace = (input: {
  /** The role whose tree this is — it names the branch a human is offered for the dirt. */
  readonly role: string;
  /** The workspace itself, so that every command in a refusal is a paste and not a template. */
  readonly path: string;
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
  /**
   * The base as the launch names it (`origin/main`) — read only to recognise the base
   * BRANCH under a dirty head, which is the one head a commit may never land on.
   */
  readonly baseRef?: string;
  /**
   * NOW, as an ISO instant, passed in and never read here: it names the service branch
   * (`serviceBranchName`). Absent — the plan cannot name one, and a detached dirty tree
   * falls back to the refusal, out loud rather than under a made-up name.
   */
  readonly at?: string;
  /**
   * The ids of the contour's roles — handed straight to `classifyWorkspaceHead`, which
   * needs them to keep another role's NAME from being overruled by this role's
   * signature. Absent is a named state and it refuses: see `roles-unknown` there.
   */
  readonly roles?: readonly string[];
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
    const repair = describeDirtyWorkspaceRepair({
      role: input.role,
      path: input.path,
      ...(input.thread === undefined ? {} : { thread: input.thread }),
      ...(facts.dirt === undefined ? {} : { dirt: facts.dirt }),
    });
    // THE RIGHT, AND EXACTLY AS WIDE AS IT WAS GIVEN (john, 2026-09-05, thread 099):
    // dirt of a run that ENDED ITS OWN TURN, in a tree whose head the role owns, is
    // committed for it. Everything outside that — unattributed dirt just below, a
    // shared or foreign head just after — keeps the refusal it had, because outside it
    // the package would be committing somebody else's work under a role's name.
    if (previousReason !== undefined) {
      const owner = classifyWorkspaceHead({
        role: input.role,
        ...(facts.branch === undefined ? {} : { branch: facts.branch }),
        ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
        ...(facts.headAuthor === undefined ? {} : { headAuthor: facts.headAuthor }),
        ...(input.roles === undefined ? {} : { roles: input.roles }),
      });
      const message = dirtCommitMessage({
        role: input.role,
        reason: previousReason,
        ...(input.thread === undefined ? {} : { thread: input.thread }),
      });
      if (owner.kind === "own")
        return {
          action: "commit",
          branch: owner.branch,
          create: false,
          message,
          from: previousReason,
        };
      if (owner.kind === "detached" && input.at !== undefined)
        return {
          action: "commit",
          branch: serviceBranchName({
            role: input.role,
            at: input.at,
            ...(input.thread === undefined ? {} : { thread: input.thread }),
          }),
          create: true,
          message,
          from: previousReason,
        };
      if (owner.kind === "base" || owner.kind === "foreign")
        return {
          action: "refuse",
          reason: `the workspace has uncommitted changes left by a run that ENDED ITS OWN TURN ('${previousReason}'), and its head is on '${owner.branch}' — ${
            owner.kind === "base"
              ? "the BASE branch, which every role shares"
              : describeForeignHead({ role: input.role, owner })
          }: the circuit commits a role's leftovers onto the role's own head and never onto a common or a foreign one. ${repair}`,
        };
    }
    return {
      action: "refuse",
      reason:
        previousReason === undefined
          ? `the workspace has uncommitted changes and no finished run of this pair to attribute them to — they may be a human's, and the circuit does not park work whose owner it does not know. ${repair}`
          : `the workspace has uncommitted changes left by a run that ENDED ITS OWN TURN ('${previousReason}'), and the plan was given no timestamp to name a service branch with — the tree is detached, so there is no head of the role's to commit onto either. ${repair}`,
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
    case "commit":
      return `${input.role}: ${input.path} — committing what the '${input.plan.from}' run left uncommitted ${input.plan.create ? "onto a new service branch" : "onto its own branch"} '${input.plan.branch}', then moving to ${at}`;
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
  // NAMED HERE TOO, AND NOT ONLY IN THE REFUSAL (thread 099). Preflight is the surface a
  // human reads BEFORE a tick rather than after a skip, and "has unsaved changes" without
  // the paths is the same "go and look" the refusal has stopped saying.
  const dirt =
    input.facts.dirty === true
      ? `, has unsaved changes: ${input.facts.dirt === undefined ? "not read" : describeWorkspaceDirt(input.facts.dirt)}`
      : "";
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
  // THE SIGNATURE IS SHOWN HERE AND REFUSED AT THE DOOR (thread 052). Preflight's rule
  // holds — never a `fail`, because this belongs to one role and not to the circuit —
  // but a mismatch demotes the tick: the run of THIS role will not start, and a row
  // that ticks while the launch refuses is exactly the disagreement R12 removed.
  const signature =
    input.facts.signature === undefined
      ? undefined
      : checkWorkspaceSignature({
          role: input.role,
          path: input.path,
          signature: input.facts.signature,
        });
  if (signature?.ok === false) {
    return {
      name,
      status: "info",
      detail: `${input.path} — SIGNED BY ${describeSignature(input.facts.signature ?? {})}, not by '${input.role}': a run refuses here. ${signature.reason}`,
    };
  }
  const signed = signature === undefined ? "" : `, signed by ${input.role}`;
  if (input.facts.head === input.base && input.facts.dirty !== true) {
    return {
      name,
      status: "ok",
      detail: `${input.path} — ${where} at ${input.baseRef}, clean${signed}`,
    };
  }
  return {
    name,
    status: "info",
    detail: `${input.path} — ${where} ${(input.facts.head ?? "?").slice(0, 8)}${dirt}${signed}; a fresh run moves it to ${input.baseRef}`,
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

/**
 * THE WORKSPACE IS SIGNED BY THE ROLE WHOSE NAME IT BEARS — checked at the door
 * (thread 052, curator's point 2), not read off a commit afterwards.
 *
 * WHY A CHECK AT ALL WHEN THE LAUNCH SETS IT ITSELF. `applyWorkspaceIdentity` writes
 * the identity at every start, so the ordinary path heals itself — and every way it
 * can fail is silent: `--worktree` writes into a file git only reads with
 * `extensions.worktreeConfig` on (the launch turns it on, a human or a re-clone can
 * turn it off), the extension is deliberately NOT turned on where `core.bare` or
 * `core.worktree` are in the way, and `GIT_AUTHOR_*` in the environment outranks
 * configuration entirely. In all three the setting looks applied and the commits come
 * out under somebody else's name — visible only in the history, after the fact.
 *
 * WHY A REFUSAL AND NOT A REPAIR. The repair was already attempted a moment earlier
 * and did not take; doing it again is a loop, and doing it harder (turning the
 * extension on over `core.bare`) is the one gesture this package refuses to make on
 * somebody's repository. What is left is a door: the same shape as a dirty tree — the
 * run does not start, and the line says whose signature was found, whose it should be,
 * and the two commands that fix it in the tree that has the problem.
 */
export const checkWorkspaceSignature = (input: {
  readonly role: string;
  readonly path: string;
  readonly signature?: { readonly name?: string; readonly email?: string };
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } => {
  const want = roleIdentity(input.role);
  const found = input.signature ?? {};
  if (found.name === want.name && found.email === want.email) return { ok: true };
  return {
    ok: false,
    reason: `the workspace '${input.path}' is not signed by '${input.role}': git would commit there as ${describeSignature(found)}, and the tree of a role signs with ${want.name} <${want.email}>. The launch sets that at every start, so a signature that survived it is not being read — check 'git -C ${input.path} config --get extensions.worktreeConfig' (it must be 'true'; it is left off when 'core.bare' or 'core.worktree' sit in the shared config, and those have to be moved by hand first), then: git -C ${input.path} config --worktree user.name ${want.name} && git -C ${input.path} config --worktree user.email ${want.email}`,
  };
};

/** A signature as it is read to a human — including the one that is not there at all. */
export const describeSignature = (signature: {
  readonly name?: string;
  readonly email?: string;
}): string => {
  if (signature.name === undefined && signature.email === undefined) return "nobody (nothing set)";
  return `${signature.name ?? "(no name)"} <${signature.email ?? "(no email)"}>`;
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
 * THE CHECKOUT NOBODY WORKS IN — AND THE CODE EVERYBODY RUNS (thread 078).
 *
 * R17 moved the sessions into worktrees of their own and this line went with them: the
 * operator's tree stopped being anyone's workplace, so it was reported as a fact and
 * compared against nothing. That was the right half of a wrong conclusion. Nobody WORKS
 * in the main checkout, but the daemon is LOADED from it — node resolves the modules
 * there once, at start — and every module the circuit executes is whatever that tree
 * happens to be holding. "Not a workplace" and "not load-bearing" are different
 * statements, and for five hours and fifty-four minutes on 2026-09-02 the difference was
 * the whole contour: a hand created `core/gate-checks-from-actions` in the main checkout
 * at 09:09Z, committed onto it at 09:35Z, and the daemon raised afterwards ran that
 * commit — eleven commits of `main` it had never seen — while this line said `· main
 * checkout: … — on 'core/gate-checks-from-actions'` in the even tone of an inventory
 * entry, twenty lines deep in a passing preflight. It cost a false acceptance (`git
 * rev-parse HEAD` in that tree answered with the foreign tip, was read as "the fix is
 * rolled out", a workaround was removed on the strength of it and BOTH contours fell).
 *
 * SO IT REFUSES, and the refusal is not a new severity invented here: the pre-R17 sibling
 * `workdirVerdict` has failed on exactly this comparison since R12, and R17 dropped it by
 * accident rather than by decision. A daemon on a foreign branch cannot heal either — its
 * self-repair is `git pull --ff-only` on the CURRENT branch, which on a foreign one
 * succeeds, moves nothing, and leaves the drift against `origin/main` standing.
 *
 * THE DISTANCE IS MEASURED AGAINST THE MAIN BRANCH, ALWAYS — never against the tree's own
 * upstream. "I match my own origin" is true of a foreign branch and answers a question
 * nobody asked; "N commits of `origin/main` are missing from me" is true on every branch
 * and is the number the reader needs. It is a convenience and degrades on its own: an
 * uncountable distance costs the number and never the verdict.
 */
/**
 * WHERE A TREE STANDS, IN WORDS — `git rev-parse --abbrev-ref HEAD` answers a detached
 * tree with the literal `HEAD`, which inside a refusal reads as a branch somebody made.
 * It is named for what it is, in one place, because the repair refuses on the same
 * reading as the door (thread 096).
 */
export const describeWhereItStands = (branch: string): string =>
  branch === "HEAD" ? "is DETACHED (on no branch)" : `is on '${branch}'`;

/**
 * THE COMMAND THAT PUTS THE MAIN CHECKOUT BACK — one text, two speakers (thread 096).
 *
 * The preflight door says it before a daemon starts; the in-place repair says it when it
 * finds itself pulling a branch that is not the project's, because `git pull --ff-only`
 * runs on the CURRENT branch and a repair there moves nothing. Both refusals end in the
 * same two commands a hand must type, and a second copy of them would part ways with this
 * one on the first edit — so there is exactly this one, and it is exported for the sake of
 * the other caller rather than for its own.
 *
 * IT IS NOT SOMETHING THE PROCESS MAY RUN. The branch of the main checkout is moved by the
 * operator and by nobody else (`PROTOCOL.md`, "Главный чекаут трогает только оператор",
 * john's decision of 2026-09-03): under a foreign branch there is regularly work that is
 * not committed, and a daemon cannot tell that tree from an abandoned one.
 */
export const describePutItBack = (input: {
  readonly repo: string;
  readonly expectedBranch: string;
  /** Named only when it is true: a stash is a step, and a step nobody needs is noise. */
  readonly dirty?: boolean;
}): string =>
  `Put it back: git -C ${input.repo} checkout ${input.expectedBranch} && git -C ${input.repo} pull --ff-only${input.dirty === true ? " (save or stash the unsaved changes first)" : ""}`;

export const mainCheckoutVerdict = (input: {
  readonly repo: string;
  readonly branch: string;
  readonly dirty: boolean;
  /** The branch the project declared (`orchestrator.workdir.branch`) — the code of record. */
  readonly expectedBranch: string;
  /** Commits of `origin/<expectedBranch>` this tree does not have; absent when uncountable. */
  readonly behind?: number;
}): PreflightCheck => {
  const dirt = input.dirty ? ", has unsaved changes" : "";
  const distance =
    input.behind === undefined
      ? `the distance to 'origin/${input.expectedBranch}' did not read`
      : `${input.behind} commit(s) of 'origin/${input.expectedBranch}' are missing from it`;
  if (input.branch !== input.expectedBranch) {
    const where = describeWhereItStands(input.branch);
    return {
      name: "main checkout",
      status: "fail",
      detail: `${input.repo} ${where}, not the project's '${input.expectedBranch}' — ${distance}. The daemon loads its modules from this tree, so the circuit would execute THAT code, not what is merged${dirt}. ${describePutItBack({ repo: input.repo, expectedBranch: input.expectedBranch, dirty: input.dirty })}`,
    };
  }
  return {
    name: "main checkout",
    status: "ok",
    detail: `${input.repo} — on '${input.branch}'${dirt}, the project's branch; ${distance}; not a workplace of any role (the sessions land in their own worktrees)`,
  };
};
