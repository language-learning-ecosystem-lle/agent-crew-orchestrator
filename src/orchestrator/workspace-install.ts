/**
 * THE BOX PUTS THE TREE RIGHT ITSELF (thread `180-selfheal-leaves-the-workspaces-behind`,
 * john's decision of 2026-09-12, half (а)) — the half the two doors above deliberately
 * left to a hand, given back to the circuit inside borders john named with it.
 *
 * WHAT WAS MEASURED, AND IT IS THE ARGUMENT. The class fired THREE TIMES IN FOUR DAYS.
 * 2026-09-09: a consuming contour stood ~30 minutes with its role trees on `agent-protocol`
 * 0.2.13 against a daemon on 0.2.14; the same hour the producing contour stood ~20 minutes
 * on a build behind its own schema; and on 2026-09-12 a speech role stood A WHOLE DAY on
 * the same fault while its contour ran the entire time. Every one of the three was found by
 * john's eye, and every one of the three was repaired by the one line the doors had already
 * printed — `pnpm --dir <tree> install --frozen-lockfile`. A door that names a repair
 * nobody is watching for is a door that stops the circuit until a human walks past it.
 *
 * AND THE PARADOX THE FIX IS AGAINST, in john's words: the better the automatic rollout
 * works, the surer the contour stands after it. The trees used to be levelled by the same
 * hand that rolled the release out; the rollout no longer needs that hand, and the levelling
 * was left behind with it.
 *
 * WHY THE DECISION IS A FUNCTION AND THE INSTALL IS NOT IN IT. Everything here is the
 * question "MAY this tree be written into at all", and that question is the whole of john's
 * grant: the borders are the decision, the package manager is a detail of carrying it out.
 * The caller runs the command; this module cannot, which is what lets a test hold all four
 * outcomes in one file without a disk.
 *
 * THE THREE BORDERS ARE JOHN'S AND THEY ARE NAMED ONE BY ONE (msg-027 §1):
 *
 *  1. A TREE ON THE ROLE'S OWN BRANCH IS NOT TOUCHED — there is unlanded work there, and
 *     this is not a hypothesis: it was the state of `dev-speech` of the consuming contour
 *     on 2026-09-12 and of a role tree on 2026-09-09. The install itself would not eat a
 *     commit, and that is beside the point: the grant was given for trees the orchestrator
 *     issued and nobody owns, and a module that widened it "because it is harmless" would
 *     be deciding the border instead of reading it.
 *  2. A DIRTY TREE GOES BY THE RULES OF THREAD `099` — the leftovers are committed onto the
 *     role's head by `planWorkspace`, and nothing else is done to that tree on the way. The
 *     stale build is still named by its door; the circuit simply does not also write into a
 *     tree whose state a human may still be reading.
 *  3. LEVELLING IS PART OF THE REPAIR, so it runs where no session is — never over one.
 *     THE FACT THAT CLOSES THIS BORDER AT THE CALL SITE, and it is a fact and not a
 *     promise: the caller is `settleRun`, which stands BEFORE the session of this pair
 *     exists, holds the workspace lock while it writes, and is refused outright when another
 *     run holds it. A resumed run is the one case where a session's own state is already in
 *     that tree, and it is declined below by name.
 *
 * WHAT IS NOT HERE, AND WHY NOT. No config key — the grant is for the ACTION, and a switch
 * for it would be a new key, which is john's button and not this thread's (curator, msg-028
 * §4). No new right of a role, no new step of the route, no schema bump: this module is read
 * by the launch door alone, and the launch door already had the right to write into the tree
 * it issues (it creates it, it moves its head, it commits its dirt).
 */

/** What the circuit is about to do to somebody's tree — or the named reason it will not. */
export type WorkspaceInstallPlan =
  | {
      readonly install: true;
      /** The tree it is done to, absolute — the caller runs the install there. */
      readonly path: string;
      /** One line, for the journal and for the letter: what is done and to what. */
      readonly note: string;
    }
  | {
      readonly install: false;
      /**
       * WHY NOT, BY NAME — absent only when there was nothing to do. A border that declined
       * silently would be indistinguishable from a border that was never asked, and the
       * next standstill would be diagnosed twice.
       */
      readonly why?: string;
    };

/**
 * THE DECISION, from what the launch door has already measured and from nothing else.
 *
 * `needed` is the ONLY input that says the tree is behind — and it deliberately says only
 * THAT. Which fault it is (a missing `node_modules`, a build behind the home checkout's)
 * is the doors' business and each of them has its own text; the borders are the same for
 * both, and a decision function that re-derived the fault would be a third opinion about
 * it.
 */
export const planWorkspaceInstall = (input: {
  readonly role: string;
  /** The role's workspace, absolute. */
  readonly path: string;
  /** A door has measured this tree as behind the circuit that raises it. */
  readonly needed: boolean;
  /**
   * The branch the tree's head stood on when the launch read it, absent when the head is
   * detached — which is the state of every tree the orchestrator issues. Border 1.
   */
  readonly branch?: string;
  /** The tree had uncommitted changes when the launch read it. Border 2. */
  readonly dirty: boolean;
  /** This run continues a session that was already in that tree. Border 3. */
  readonly resuming: boolean;
}): WorkspaceInstallPlan => {
  // NOTHING MEASURED, NOTHING DONE — and no `why`: this is not a border standing aside,
  // it is the normal tick, and the silence of a tick where everything is in order is the
  // point of the whole thread (msg-027 §2, requirement 3).
  if (!input.needed) return { install: false };
  if (input.resuming)
    return {
      install: false,
      why: `the run resumes a session already in '${input.path}' — the circuit levels a tree nobody is working in, and this one has somebody's state in it`,
    };
  if (input.dirty)
    return {
      install: false,
      why: `the workspace of '${input.role}' has uncommitted changes — its leftovers are committed onto the role's own head first (thread 099), and the circuit does not write into a tree a human may still be reading`,
    };
  if (input.branch !== undefined)
    return {
      install: false,
      why: `the workspace of '${input.role}' stands on '${input.branch}' and not on a head the orchestrator issued — there may be unlanded work there, and the circuit levels only the trees it owns`,
    };
  return {
    install: true,
    path: input.path,
    note: `levelling the workspace of '${input.role}' onto the build the circuit runs — installing into '${input.path}'`,
  };
};

/** What actually happened, as the caller measured it — the text is the journal's line. */
export type WorkspaceInstallOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly cause: string };

/**
 * THE LINE THAT IS PRINTED AFTER, and it says the OUTCOME rather than the intention. An
 * install that failed leaves the tree exactly as behind as it was, and the door's own note
 * (which carries the repair a hand runs) is still said — so the fault is never quieter
 * after this module exists than it was before it.
 */
export const describeWorkspaceInstall = (input: {
  readonly role: string;
  readonly path: string;
  readonly outcome: WorkspaceInstallOutcome;
}): string =>
  input.outcome.ok
    ? `levelled the workspace of '${input.role}' — '${input.path}' now runs the build of the home checkout`
    : `levelling the workspace of '${input.role}' FAILED — '${input.path}' is still behind the circuit that raises it, and the note below is what repairs it by hand: ${input.outcome.cause}`;
