/**
 * THE MAIL CHECKOUT IS ONE PLACE, AND ONLY ONE WRITER MAY BE INSIDE IT (D-0, thread
 * `023-daemon-parallelism`).
 *
 * WHAT IS BROKEN WITHOUT THIS. Delivery (`deliver.ts`) owns the whole
 * `write → add → commit → push` sequence, and between the write and the commit the
 * checkout is DIRTY BY CONSTRUCTION. Two facts of the delivery meet there:
 *
 *  - it REFUSES a dirty checkout (it must: the retry path resets hard, and doing that
 *    over somebody's unfinished message destroys work to deliver ours);
 *  - on a rejected push it does `reset --hard origin/<branch>`.
 *
 * So two deliveries overlapping inside one checkout end in exactly one of two ways:
 * the second refuses with "the mail checkout has uncommitted changes", or the first
 * one's retry wipes the second one's half-written message. The mail checkout is ONE
 * directory per instance (`orchestrator.mailCheckout` + `mail.dir`, see `paths.ts`) —
 * not one per role — so the moment the daemon raises two roles at once, or a human
 * writes beside a live session, that collision is the normal case rather than the
 * unlucky one. It does not fire today only because the circuit runs one session.
 *
 * WHY A LOCK AND NOT A CHECKOUT PER ROLE. R13 gives the guarantee that makes the cheap
 * answer sufficient: the roles of a box are raised by ONE daemon on ONE machine, so
 * the contenders are local processes and a local mutex covers all of them. A checkout
 * per role would pay for the same property in worktrees, fast-forwards on every
 * preflight and a second place for the "inside the repo tree" requirement to bite.
 * (john's decision, thread `023-daemon-parallelism`,
 * `messages/2026-07-27T18-52-00Z-curator.md`: the ordinal is a position in a view and
 * moves with `--tail` and with an unreadable file, so a doc-block cites the file name.)
 *
 * WHY THE LOCK FILE LIVES IN THE GIT DIR. It must not be visible to
 * `git status --porcelain` — a lock inside the working tree would be untracked dirt,
 * and delivery would refuse the very thing the lock exists to allow. The git directory
 * of the checkout (`git rev-parse --absolute-git-dir`) is private, per-checkout and
 * never part of the tree, which is exactly the scope of the race: the contention is
 * over a DIRECTORY, not over the branch. Two boxes with two clones are two locks, and
 * that is correct — what they race over is the remote, and the push retry already
 * settles that.
 *
 * A DEAD HOLDER IS STOLEN FROM, A LIVE ONE IS WAITED FOR. A lock that outlives the
 * process holding it would be worse than the race it prevents: one killed session and
 * the mail of the whole box is down until a human notices. So the record carries the
 * pid, and a holder that no longer exists is taken over LOUDLY. A living holder is
 * waited for up to a ceiling and then REFUSED BY NAME, with who is inside and for how
 * long — "the mail is busy" must never look like the mail being silent.
 */
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";

/** Whoever wants the checkout runs its whole sequence inside `hold`. */
export type MailLock = {
  readonly hold: <T>(body: () => T) => T;
};

/**
 * The lock a caller uses when there is nothing to share the checkout with — the pure
 * unit tests of delivery, and any caller that owns the directory outright. It is a
 * value rather than a default so that a NEW call site has to say which one it means:
 * forgetting the lock is exactly the defect this module exists to prevent.
 */
export const unlockedMail: MailLock = { hold: (body) => body() };

/** The ceiling ran out with somebody else inside the checkout. */
export class MailCheckoutBusyError extends Error {}

/** How long a delivery waits for the checkout before refusing (ms). */
export const MAIL_LOCK_WAIT_MS = 120_000;

/** How often the waiter looks at the lock (ms). */
export const MAIL_LOCK_POLL_MS = 200;

type LockRecord = {
  readonly pid: number;
  readonly holder: string;
  readonly since: string;
};

const readRecord = (path: string): LockRecord | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockRecord>;
    if (typeof parsed.pid !== "number" || typeof parsed.holder !== "string") return undefined;
    return { pid: parsed.pid, holder: parsed.holder, since: parsed.since ?? "unknown" };
  } catch {
    // Unreadable means either "being written right now" or "damaged": both are
    // answered by waiting, never by assuming the checkout is free.
    return undefined;
  }
};

/** Signal 0 asks the kernel about a pid without touching the process. */
const livePid = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else — that is alive for us.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A synchronous wait: the delivery is synchronous end to end, so the poll must be too. */
const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export const fileMailLock = (input: {
  /** The lock file — OUTSIDE the working tree (see the header). */
  readonly path: string;
  /** Who we are, in the words a human needs to read in a refusal: role, thread, command. */
  readonly holder: string;
  readonly note: (line: string) => void;
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly alive?: (pid: number) => boolean;
  readonly sleep?: (ms: number) => void;
}): MailLock => {
  const waitMs = input.waitMs ?? MAIL_LOCK_WAIT_MS;
  const pollMs = input.pollMs ?? MAIL_LOCK_POLL_MS;
  const now = input.now ?? (() => Date.now());
  const alive = input.alive ?? livePid;
  const sleep = input.sleep ?? sleepSync;

  const take = (): string => {
    const started = now();
    const mine = JSON.stringify({
      pid: process.pid,
      holder: input.holder,
      since: new Date(now()).toISOString(),
    } satisfies LockRecord);

    for (;;) {
      try {
        const fd = openSync(input.path, "wx");
        try {
          writeSync(fd, mine);
        } finally {
          closeSync(fd);
        }
        return mine;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }

      const held = readRecord(input.path);
      if (held !== undefined && !alive(held.pid)) {
        input.note(
          `agent-protocol: the mail checkout was left locked by a process that is gone (pid ${held.pid}, ${held.holder}, since ${held.since}) — taking it over`,
        );
        // Unlink and go round: whoever wins the next exclusive create owns it, so two
        // simultaneous stealers cannot both walk in.
        try {
          rmSync(input.path);
        } catch {
          // Somebody unlinked it first — that is the same outcome.
        }
        continue;
      }

      const waited = now() - started;
      if (waited >= waitMs) {
        throw new MailCheckoutBusyError(
          held === undefined
            ? `the mail checkout is locked by another process and stayed locked for ${Math.round(waited / 1000)}s (lock file '${input.path}', its record is unreadable) — nothing was written`
            : `the mail checkout is held by ${held.holder} (pid ${held.pid}, since ${held.since}) and did not free up in ${Math.round(waited / 1000)}s — nothing was written; that delivery is either very slow or stuck, look at it before removing '${input.path}' by hand`,
        );
      }
      sleep(pollMs);
    }
  };

  return {
    hold: (body) => {
      const mine = take();
      try {
        return body();
      } finally {
        // Only our own record is removed. If it is not ours any more, somebody stole it
        // believing us dead — say so rather than delete their lock on the way out.
        if (existsSync(input.path) && readFileSync(input.path, "utf8") !== mine) {
          input.note(
            `agent-protocol: the mail lock '${input.path}' is no longer ours — it was taken over while we held it; leaving it alone`,
          );
        } else {
          try {
            rmSync(input.path);
          } catch {
            // Already gone: nothing to release.
          }
        }
      }
    },
  };
};
