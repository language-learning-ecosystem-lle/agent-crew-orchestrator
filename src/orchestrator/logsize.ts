/**
 * THE DAEMON LOG DOES NOT GROW WITHOUT END (thread `019-operator-ux`, addendum to the
 * systemd statement of 2026-07-31 10:50Z: john found `daemon.log` at 18 MB after about
 * a week, with the epochs of every daemon that ever ran mixed into it without a seam).
 *
 * The file is not a courtesy — a measurement of thread 024 was assembled out of its
 * lines — so the answer is not "stop writing it". Two shapes were on the table and the
 * choice is written down here:
 *
 * CUT BY STARTS (`daemon-<start>.log`) gives perfect epoch boundaries and an UNBOUNDED
 * NUMBER of files: `restart` alone makes one per pickup of fresh code, and the box that
 * restarts nightly ends the month with thirty of them and no policy about the oldest.
 * The requirement is a bound on the TOTAL, and a growing directory does not have one
 * unless something prunes it — a second mechanism, with its own way of going wrong.
 *
 * ROTATE AT THE START, KEEP ONE GENERATION (what is implemented). Every start looks at
 * the file it is about to write into: over the cap, it becomes `daemon.log.1`
 * (replacing the previous one), and the daemon writes into a fresh file. The total is
 * bounded BY CONSTRUCTION at twice the cap plus the current epoch — no cron, no
 * logrotate config to install per box, nothing to prune. The epochs stay legible
 * because every start also writes a BANNER: one line naming the pid, the moment and the
 * mode, so "which daemon said this" is answered by reading upwards to the nearest one.
 *
 * Under a unit the PRIMARY channel is journald, which rotates by itself and puts a
 * boundary at every start — this file is the mirror `orchestrator log` reads, and it is
 * the one that needed a bound of its own.
 */

import { appendFileSync, renameSync, rmSync, statSync } from "node:fs";

/** The cap on ONE generation. Two of them plus the live epoch is the whole footprint. */
export const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;

/** The suffix of the one generation that is kept. */
export const ROTATED_SUFFIX = ".1";

export type LogRotationPlan = {
  /** Whether the live file is moved aside before this start writes into it. */
  readonly rotate: boolean;
  /** Where it goes when it is. */
  readonly rotated: string;
  /** What the operator is told, or `undefined` when nothing happens (the quiet case). */
  readonly said?: string;
};

/**
 * The decision, as a pure function: the size on disk against the cap. A missing file
 * (`size: undefined`) is the first start on this box and rotates nothing.
 */
export const planLogRotation = (input: {
  readonly path: string;
  readonly size: number | undefined;
  readonly cap?: number;
}): LogRotationPlan => {
  const cap = input.cap ?? DEFAULT_LOG_MAX_BYTES;
  const rotated = `${input.path}${ROTATED_SUFFIX}`;
  if (input.size === undefined || input.size < cap) return { rotate: false, rotated };
  return {
    rotate: true,
    rotated,
    said: `the daemon log passed its cap (${Math.round(input.size / 1024)} KB ≥ ${Math.round(cap / 1024)} KB) and was rotated to '${rotated}' — one generation is kept, so the two files together stay bounded`,
  };
};

/** The banner that separates one daemon's lines from the next one's. */
export const epochBanner = (input: {
  readonly pid: number;
  readonly startedAt: string;
  readonly mode: "foreground" | "background";
}): string => `\n=== daemon epoch · ${input.startedAt} · pid ${input.pid} · ${input.mode} ===\n`;

/**
 * The decision, performed. Returns what to say, or `undefined` when the file was under
 * the cap. A log that cannot be rotated must NEVER take the start down — the same rule
 * the mirror in `up --foreground` follows: the file is the convenience, not the channel.
 */
export const rotateDaemonLog = (input: {
  readonly path: string;
  readonly cap?: number;
}): string | undefined => {
  let size: number | undefined;
  try {
    size = statSync(input.path).size;
  } catch {
    return undefined;
  }
  const plan = planLogRotation({
    path: input.path,
    size,
    ...(input.cap === undefined ? {} : { cap: input.cap }),
  });
  if (!plan.rotate) return undefined;
  try {
    rmSync(plan.rotated, { force: true });
    renameSync(input.path, plan.rotated);
  } catch {
    return undefined;
  }
  return plan.said;
};

/** The banner, appended where the daemon writes. Failure here is not a failure to start. */
export const writeEpochBanner = (input: {
  readonly path: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly mode: "foreground" | "background";
}): void => {
  try {
    appendFileSync(
      input.path,
      epochBanner({ pid: input.pid, startedAt: input.startedAt, mode: input.mode }),
    );
  } catch {
    // See above: the stream systemd reads is the one that matters.
  }
};
