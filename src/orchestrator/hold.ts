/**
 * A hold means "the role is taken by a human". Step S5 (thread 012, curator's
 * statement of work 20:25).
 *
 * A live manual session of a role and the daemon are two claimants to ONE lease:
 * the mail awaits dev-core, the daemon sees a candidate and raises a second
 * session of the same role on top of the working one. Of the two forms of
 * coexistence ("the session parks forever" and "the lease refuses the daemon while
 * a manual session is alive") the second was chosen — for the transition period,
 * while the autonomous circuit is still being accepted.
 *
 * THE FILE PATTERN is the same as for enable/stop/force: a hold is a file
 * `<holds>/<role>`, its presence is visible both to a human and to the daemon, and
 * it survives a restart of either.
 *
 * THE DEADLINE LIVES IN THE FILE ITSELF (`expires`), like `deadline` in
 * `lease-acquired`: the holder declares until when the role is taken, and the
 * daemon merely compares that with `now`. Otherwise the TTL would have to live in
 * the daemon config and two settings agreeing would become a correctness
 * condition.
 *
 * WHY THERE IS NO BACKGROUND HEARTBEAT. The first form (a stamp refreshed by a
 * beating process) is described in my message of 17:07 and was rejected during
 * implementation: the beating would have to be done by a separate child process of
 * the session, and an orphaned child outlives the session's death and keeps
 * beating — the hold stays forever fresh and blocks the daemon forever. That is
 * exactly the "hangs while looking fine" class the TTL was introduced against. A
 * deadline declared ahead by the holder does not have that hole: expired is
 * expired, no matter who is doing what.
 *
 * AN EXPIRED HOLD IS NOT DELETED AUTOMATICALLY — it stays as a trace of "a manual
 * session was here and did not clean up after itself" and is printed by the
 * display. The daemon ignores it (otherwise a dead session would block the circuit
 * forever), but it does not do so silently: skipping a role because of a hold is a
 * separate tick decision with its own line.
 */
import { z } from "zod";

/**
 * The default hold TTL is an hour. Taken from the size of a real work package of a
 * manual session: shorter and the holder has to extend the hold mid-work and risks
 * forgetting; longer and a forgotten hold keeps the circuit switched off for too
 * long. Calibrated by `--ttl`, so the number here is a default, not an invariant.
 */
export const HOLD_TTL_SECONDS = 3600;

const UTC_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const stamp = z.string().regex(UTC_STAMP, "the stamp must be UTC ISO without milliseconds");

/**
 * A hold record. `by` is WHO holds it (a human role: john/curator — or the role
 * itself, if an agent is driving the session manually); `note` is what for, so
 * that someone else's hold can be understood without asking the holder.
 */
export const holdRecordSchema = z.object({
  role: z.string().min(1),
  by: z.string().min(1),
  taken: stamp,
  expires: stamp,
  note: z.string().min(1).optional(),
});

export type HoldRecord = z.infer<typeof holdRecordSchema>;

/** A UTC stamp without milliseconds — the same format as in the journal. */
export const holdStamp = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

/** The expiry moment of a hold taken at `at` for `ttlSeconds`. */
export const holdExpiry = (at: Date, ttlSeconds: number): string =>
  holdStamp(new Date(at.getTime() + ttlSeconds * 1000));

/** A record → the contents of the hold file (JSONL-compatible: one line). */
export const renderHold = (record: HoldRecord): string => `${JSON.stringify(record)}\n`;

/**
 * File contents → a record. A malformed hold is a LOUD refusal, not "let's assume
 * there is no hold": silently skipping an unreadable file would mean the daemon
 * raises a role on top of a live session exactly when something is already broken.
 */
export const parseHold = (text: string): HoldRecord => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`hold is not JSON: ${text.trim()}`);
  }
  return holdRecordSchema.parse(raw);
};

/** A view of a hold from the point of view of the moment `now`. */
export type HoldView = HoldRecord & {
  /** The deadline has not passed — the role is taken, the daemon does not raise it. */
  readonly active: boolean;
};

/**
 * Records → views as of `now`. The comparison is string-based: stamps are
 * normalised to one UTC format of fixed length, so lexicographic order is also
 * chronological (the same technique as in `foldLeases`).
 */
export const foldHolds = (records: readonly HoldRecord[], now: Date): HoldView[] => {
  const nowIso = holdStamp(now);
  return records.map((record) => ({ ...record, active: nowIso <= record.expires }));
};

/** Roles taken right now — what the daemon subtracts from the candidates. */
export const heldRoles = (views: readonly HoldView[]): string[] =>
  views.filter((view) => view.active).map((view) => view.role);

/**
 * The holds display. An empty list gets an honest line rather than empty output
 * (the same argument as in `renderStatus`: silence is indistinguishable from a
 * read failure).
 */
export const renderHolds = (views: readonly HoldView[]): string => {
  if (views.length === 0) return "orchestrator: no manual holds";
  return views
    .map((view) => {
      const cols = [
        view.role,
        `held by ${view.by}`,
        `until ${view.expires}`,
        view.note === undefined ? "" : `(${view.note})`,
      ]
        .filter((c) => c !== "")
        .join("  ·  ");
      const mark = view.active
        ? "  ← TAKEN by a human, the daemon does not raise it"
        : "  ⚠ EXPIRED — the daemon will raise the role; remove the file if the session is alive";
      return `${cols}${mark}`;
    })
    .join("\n");
};
