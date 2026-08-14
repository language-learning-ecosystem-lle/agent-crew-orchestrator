/**
 * SENDING A MESSAGE IS ONE ACTION (R3).
 *
 * Until now the package wrote the file and the agent finished the job by hand:
 * `git add && git commit && git push`, plus the retry when somebody else pushed
 * first. That tail is storage mechanics, and mechanics is the layer an agent must
 * not have to know (john's decomposition, 2026-07-25): it knows the CONTENT of the
 * conversation, it understands the SEMANTICS of the turn, and how a message becomes
 * a commit is the package's business.
 *
 * It was also the tail that actually failed. Two facts from this repository's own
 * history: a heredoc inside an `&&` chain silently lost the body while the chain
 * reported success, and a rejected push left the writer with a committed message
 * that existed on one disk only. Both are impossible to hit through a command that
 * owns the whole sequence.
 *
 * WHY THE RETRY REPLANS INSTEAD OF REBASING. The feed is append-only and its stamps
 * are monotonic (`nextMessageTimestamp`), so a message that lost the race must be
 * renamed as well as moved: its file name is derived from a stamp that has to fall
 * after the message that beat it. A rebase would carry the old name across, and two
 * messages would sit out of order with names that say otherwise. Hence the loop:
 * refresh, replan against the fresh state, write, commit, push.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: `_thread.md` and `INDEX.md`. They are
 * derived, they are rebuilt by the generator on the same push, and staging them
 * here would make every concurrent write a conflict in a file nobody authored.
 *
 * A DIRTY CHECKOUT IS A REFUSAL, NEVER A REPAIR — the same rule as the workspace of
 * a run (R17). The retry path resets the checkout hard, and doing that over somebody
 * else's unfinished message is destroying work to deliver ours.
 *
 * AND BECAUSE OF THAT RULE, THE WHOLE SEQUENCE RUNS UNDER A LOCK ON THE CHECKOUT
 * (`checkout-lock.ts`): between the write and the commit the directory is dirty by
 * construction, so a second delivery arriving there either refuses on OUR dirt or gets
 * its half-written message reset away by our retry. The lock is not the delivery's
 * private business — it is a property of the place — so it comes IN, and `unlockedMail`
 * is what a caller passes when it owns the directory outright.
 *
 * AND FOR THE SAME REASON — ONE CHECKOUT, MANY WRITERS — THE AUTHOR OF THE COMMIT IS
 * PER-COMMIT (thread 027). The identity of a shared directory cannot be configured:
 * whoever configured it last would sign the next role's message. So the signature
 * travels with the one git call that makes the commit, out of `--from`, and the commit
 * finally says what the header of the message inside it says.
 */
import { type GitIdentity, identityEnv } from "../roles/identity.js";
import type { MailLock } from "./checkout-lock.js";

/**
 * A git invocation. `env` is added to the inherited environment for THAT call only —
 * the identity of a commit lives there (see the note above), and nothing else does.
 */
export type GitRun = (args: readonly string[], env?: Readonly<Record<string, string>>) => string;

/** The write of ONE attempt, planned against the state of the checkout as it is now. */
export type StagedMessage = {
  /**
   * The files this attempt writes and stages, by absolute path. USUALLY ONE — a message
   * — but a NEW THREAD is born as two (`_meta.md` and its first message) and they are
   * one delivery, not two: a thread whose meta landed without its first message is a
   * half-created conversation, and the retry that replans the message would then be
   * replanning it beside a meta that is already pushed.
   */
  readonly files: readonly { readonly path: string; readonly content: string }[];
  /** What is said about the write in the output — the thread-relative path. */
  readonly label: string;
};

export class DeliveryRefusedError extends Error {}

/**
 * WHAT A DELIVERY CAME BACK WITH.
 *
 * `written: false` is "the feed already says exactly this" — the plan, made on top of
 * the FRESH state inside the attempt, turned out byte-for-byte identical to what is
 * already committed. It is not an error and not a silent success: the caller says so in
 * its own words, because only the caller knows what the sameness means (for a status
 * flip it is the normal race of two roles closing one thread; for a machine digest it is
 * a box whose state has not moved).
 *
 * IT EXISTS BECAUSE THE ALTERNATIVE WAS A RAW GIT FAILURE (thread 065, the verdict on
 * PR #266). `git commit` on an empty index exits 1 with `nothing to commit, working tree
 * clean`, and that error is neither `DeliveryRefusedError` nor `MailCheckoutBusyError` —
 * it went through the callers' catch untouched and reached the operator as a git message
 * about a scenario the command explicitly promised as a no-op. Reproduced live with two
 * checkouts of one origin: the second closer got `git commit --quiet … failed (code 1)`.
 * The check sits HERE and not in one caller on purpose — all five deliveries write plans
 * that can coincide with the feed, and the two that write a MUTABLE file (`_meta.md`, the
 * instance digest) can do it whenever somebody else got there first.
 */
export type Delivered = {
  readonly label: string;
  readonly attempts: number;
  readonly written: boolean;
};

/** How many times delivery replans on top of a concurrent write before giving up. */
export const DELIVERY_ATTEMPTS = 3;

export const deliverMessage = (input: {
  readonly git: GitRun;
  readonly write: (path: string, content: string) => void;
  /** The mail branch from the config — the same one the checkout is expected to sit on. */
  readonly branch: string;
  /** Subject of the commit; Conventional Commits, because the checkout has the hook. */
  readonly subject: string;
  /** Replanned per attempt: the stamp and therefore the file name depend on what is already there. */
  readonly stage: () => StagedMessage;
  readonly note: (line: string) => void;
  /** ONE writer inside the checkout at a time; `unlockedMail` when there is nobody to race. */
  readonly lock: MailLock;
  /** Who this commit is BY — the role of `--from`, never the owner of the machine (027). */
  readonly identity: GitIdentity;
  readonly attempts?: number;
}): Delivered =>
  // The lock is taken BEFORE the dirty check, not after: our own transient dirt is
  // precisely what another delivery would read as somebody's unfinished message.
  input.lock.hold(() => deliverUnderLock(input));

const deliverUnderLock = (input: {
  readonly git: GitRun;
  readonly write: (path: string, content: string) => void;
  readonly branch: string;
  readonly subject: string;
  readonly stage: () => StagedMessage;
  readonly note: (line: string) => void;
  readonly identity: GitIdentity;
  readonly attempts?: number;
}): Delivered => {
  const limit = input.attempts ?? DELIVERY_ATTEMPTS;
  const dirty = input.git(["status", "--porcelain"]).trim();
  if (dirty !== "") {
    throw new DeliveryRefusedError(
      `the mail checkout has uncommitted changes — delivery refuses to touch them (it resets the checkout when a push is rejected; a body file left inside the checkout counts, write it outside):\n${dirty}`,
    );
  }

  for (let attempt = 1; attempt <= limit; attempt += 1) {
    // FRESH STATE FIRST, then plan on top of it: the stamp must fall after the last
    // message that actually exists, and a fast-forward is the only update allowed —
    // a divergent checkout is somebody's problem to look at, not ours to flatten.
    input.git(["fetch", "--quiet", "origin", input.branch]);
    try {
      input.git(["merge", "--ff-only", "--quiet", `origin/${input.branch}`]);
    } catch (error) {
      throw new DeliveryRefusedError(
        `the mail checkout will not fast-forward onto origin/${input.branch} — it has diverged, and delivery does not resolve that: ${(error as Error).message}`,
      );
    }

    const staged = input.stage();
    const paths = staged.files.map((file) => file.path);
    for (const file of staged.files) input.write(file.path, file.content);
    input.git(["add", "--", ...paths]);
    // NOTHING TO COMMIT IS AN ANSWER, NOT A FAILURE (see `Delivered`). The plan is made
    // against the state fetched inside THIS attempt, so an empty index means the feed
    // already carries exactly it — asking git to commit that gives code 1 and a message
    // about a clean tree, which is the wrong shape of answer for the right situation.
    // The index is asked, not the working tree: `write` may well have changed no byte.
    if (input.git(["diff", "--cached", "--name-only", "--", ...paths]).trim() === "") {
      return { label: staged.label, attempts: attempt, written: false };
    }
    input.git(["commit", "--quiet", "-m", input.subject], identityEnv(input.identity));

    try {
      input.git(["push", "--quiet", "origin", `HEAD:${input.branch}`]);
      return { label: staged.label, attempts: attempt, written: true };
    } catch (error) {
      if (attempt === limit) {
        throw new DeliveryRefusedError(
          `the push was rejected ${limit} times in a row — somebody is writing into the feed continuously, or the remote refuses us: ${(error as Error).message}`,
        );
      }
      input.note(
        `agent-protocol: the push was rejected (attempt ${attempt} of ${limit}) — refreshing the mail and replanning the message on top of the fresh feed`,
      );
      // The message is dropped along with the commit and written again by the next
      // attempt: its content is in memory, its NAME is not ours to keep.
      input.git(["fetch", "--quiet", "origin", input.branch]);
      input.git(["reset", "--hard", "--quiet", `origin/${input.branch}`]);
    }
  }
  // Unreachable: the last attempt either returns or throws above.
  throw new DeliveryRefusedError("delivery ended without a result");
};

/**
 * The commit subject of a delivered message. Conventional Commits because the mail
 * checkout carries the commit-msg hook, and THE MAIL DIRECTORY as the scope because
 * that is what the diff touches — the body of the message is in the file, so the
 * subject only has to say who wrote where.
 *
 * THE DIRECTORY IS TAKEN FROM THE CONFIG, NOT FROM THIS PACKAGE (thread 080). It used
 * to be the literal `agent-comms`, which is the name of ONE project's mail directory —
 * a project that adopts the protocol with another `mail.dir` would get commits whose
 * scope names a path its tree does not have. `mail.dir` already exists in the config
 * (`mail: {branch, dir}`), so nothing is added to the shape and no version moves.
 *
 * `detail` is what the three `_meta.md` writers add after the thread (head repair, the
 * turn, the status): they used to spell the whole subject by hand, four copies of one
 * literal, and a copy is exactly what did not get fixed when the literal was wrong.
 */
export const deliverySubject = (input: {
  readonly from: string;
  readonly thread: string;
  readonly mailDir: string;
  readonly detail?: string;
}): string =>
  `docs(${input.mailDir}): ${input.from} → ${input.thread}${input.detail === undefined ? "" : ` ${input.detail}`}`;
