/**
 * WHAT THE OTHER BOX IS DOING — the instance digest (R13, second half, thread
 * `016-protocol-roadmap`).
 *
 * The first half of R13 (`scope.ts`) settled which roles a box raises AT ALL. That
 * makes the circuit correct across machines but BLIND: every instance knows its own
 * leases from its own local journal, and about the others it knows only that they
 * exist. A human looking at one box cannot tell "the other machine is running dev-core
 * right now" from "the other machine has been down since Tuesday", and both look like
 * the same silence.
 *
 * THE ANSWER IS PUBLISHED, NEVER ASKED FOR. Nothing here opens a socket to another
 * instance: each box WRITES a small state file about itself into the mail branch, and
 * everyone else READS it out of git. That is the same shape the rest of the protocol
 * already has — the mail branch is the only shared surface, it is free to audit, and an
 * offline box degrades into a stale file instead of a hung request.
 *
 * ONE FILE PER BOX, `_instances/<id>.json`, and the writer only ever touches its own.
 * Two instances therefore never write one path — conflicts are gone by construction,
 * exactly as they are for messages (one file per message). The `_` prefix puts the
 * directory outside `THREAD_DIR` (`^\d{3}-`), so the thread walker never sees it.
 *
 * IT IS DERIVED AND MUTABLE, and that is the one place it differs from everything else
 * in an append-only branch. A digest is a STATE, not history: the writer rewrites its
 * own file whenever the state changes, and nobody may read that rewrite as a
 * retroactive edit. This is why `check` has to know `_instances/` as a CLASS rather
 * than meet it as a stray file — an unknown mutable path in an append-only branch is
 * indistinguishable from the very thing the immutability check exists to catch.
 *
 * STALENESS IS THE READER'S JUDGEMENT, not the writer's claim. A box that died cannot
 * update its own file to say so, so "is this current" can only be decided against
 * `writtenAt` by whoever is reading, with their own tolerance. A digest never says "I
 * am alive"; it says "at this moment I was doing this", and the reader does the rest.
 */
import type { LeaseView } from "./lease.js";
import { isLeaseAlive } from "./lease.js";
import { describeQuotaShelf, type QuotaShelf } from "./quota.js";

/** A (role, thread) pair this instance holds a live lease on — the working part of the state. */
export type DigestLease = {
  readonly role: string;
  readonly thread: string;
  readonly state: string;
  /** The wall-clock limit of the run, as the writer knew it; null when there is none. */
  readonly deadline: string | null;
};

/**
 * What one instance publishes about itself. Deliberately small: the roles it answers
 * for and what it is doing with them. NOT the journal — history stays local, because
 * the question the other boxes have is about now, and a growing file in a shared branch
 * would be paid for by every clone of the mail forever.
 */
export type InstanceDigest = {
  readonly instance: string;
  /** When the writer produced this state — the ONLY basis a reader has for staleness. */
  readonly writtenAt: string;
  /** The roles this run raises, after the topology and the operator's flags. */
  readonly roles: readonly string[];
  /** Live leases at that moment, in a stable order. */
  readonly leases: readonly DigestLease[];
  /**
   * The rate-limit windows CLOSED on this box (D-3 part 2), when there are any. The
   * window belongs to the account, and an account is not necessarily one box: a
   * neighbour that has stood down for four hours would otherwise look, from here, exactly
   * like a neighbour with nothing to do. Optional and omitted when empty, so a digest
   * written before part 2 — and an ordinary digest of a working box — is byte-identical
   * to what it was and `digestChanged` does not fire on the addition.
   */
  readonly quota?: readonly QuotaShelf[];
};

/** Where the digest of an instance lives, relative to the mail root. */
export const digestPath = (instance: string): string => `_instances/${instance}.json`;

/** The directory of the whole class — the name `check` and the writer share. */
export const DIGEST_DIR = "_instances";

/** True for a path inside the digest class, relative to the mail root. */
export const isDigestPath = (path: string): boolean =>
  path === DIGEST_DIR || path.startsWith(`${DIGEST_DIR}/`);

/**
 * The state of this box, from the fold of its own journal. Only LIVE leases are
 * published: a released pair is history, and history is exactly what the digest is not.
 * The order is the fold's, which is the order the events arrived in — stable between
 * two writes with the same state, so an unchanged state serialises byte for byte and
 * `hasChanged` below can be an equality.
 */
export const digestOf = (input: {
  readonly instance: string;
  readonly roles: readonly string[];
  readonly leases: readonly LeaseView[];
  readonly quota?: readonly QuotaShelf[];
  readonly now: Date;
}): InstanceDigest => ({
  instance: input.instance,
  writtenAt: input.now.toISOString(),
  roles: [...input.roles],
  ...(input.quota === undefined || input.quota.length === 0 ? {} : { quota: [...input.quota] }),
  leases: input.leases
    .filter((view) => isLeaseAlive(view.state))
    .map((view) => ({
      role: view.role,
      thread: view.thread,
      state: view.state,
      deadline: view.deadline,
    })),
});

/** The file body. Trailing newline: it is a text file in a branch humans read in diffs. */
export const renderDigest = (digest: InstanceDigest): string =>
  `${JSON.stringify(digest, null, 2)}\n`;

/**
 * WHETHER THIS WRITE IS WORTH A COMMIT. `writtenAt` moves every tick, so comparing the
 * rendered files would make every tick a commit — a heartbeat in the mail branch,
 * hundreds of empty diffs a day, and a `git log` nobody can read. The digest is
 * rewritten when the STATE changes; the timestamp rides along with it.
 *
 * The cost is honest and stated here: a digest whose state is unchanged also stops
 * being refreshed, so a busy box and a dead box that were both idle look alike for as
 * long as neither moves. That is the right trade — the reader's tolerance is measured
 * in the length of a session, not of a tick — but it means a heartbeat, if one is ever
 * wanted, is a SEPARATE decision and not a smaller interval here.
 *
 * IT ONLY WORKS IF THE WRITER ASKS AT THE RIGHT MOMENTS, and that is where thread
 * `025-stale-instance-digest` found it broken: the daemon asked once per tick, at the
 * end, by which point the session raised in that tick had already released its lease.
 * The answer was `leases: []` every time, so this function said "unchanged" every time,
 * and a box that ran six sessions in four hours published nothing at all — a file whose
 * whole purpose is to say what the box is doing, that had never once said it. The rule
 * the writer owes this function: ask whenever the LEASE moves, not whenever the loop
 * comes round.
 */
export const digestChanged = (
  previous: InstanceDigest | undefined,
  next: InstanceDigest,
): boolean => {
  if (previous === undefined) return true;
  return (
    previous.instance !== next.instance ||
    JSON.stringify(previous.roles) !== JSON.stringify(next.roles) ||
    JSON.stringify(previous.leases) !== JSON.stringify(next.leases) ||
    // The shelf is part of the state for the same reason a lease is: "this box is
    // standing down until 21:40" is what the neighbours are reading the file for, and a
    // digest that only moved when a lease moved would never publish it — a box that is
    // raising nobody has no leases to move.
    JSON.stringify(previous.quota ?? []) !== JSON.stringify(next.quota ?? [])
  );
};

/**
 * Reading somebody else's digest. A malformed file is NOT an exception: one box writing
 * garbage must not blind the reader to the other five, the same isolation `loadThreads`
 * has. The caller gets a reason instead of a throw and says it out loud.
 */
export type DigestRead =
  | { readonly ok: true; readonly digest: InstanceDigest }
  | { readonly ok: false; readonly problem: string };

/** A shelf as it comes off somebody else's disk — the four fields the reader prints. */
const isShelf = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const shelf = value as Record<string, unknown>;
  return (
    typeof shelf.window === "string" &&
    typeof shelf.until === "string" &&
    typeof shelf.since === "string" &&
    typeof shelf.role === "string" &&
    typeof shelf.stated === "boolean"
  );
};

export const parseDigest = (raw: string): DigestRead => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, problem: `not JSON: ${(error as Error).message}` };
  }
  // An array passes `typeof === "object"`, so it is ruled out by name: a JSON list where
  // a digest is expected would otherwise fall through to the field checks and be
  // reported as a missing 'instance', which sends the reader looking at the wrong thing.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "not an object" };
  }
  const record = value as Record<string, unknown>;
  if (typeof record.instance !== "string" || record.instance === "") {
    return { ok: false, problem: "'instance' is missing or not a string" };
  }
  if (typeof record.writtenAt !== "string" || Number.isNaN(Date.parse(record.writtenAt))) {
    return { ok: false, problem: "'writtenAt' is missing or does not parse as a date" };
  }
  if (!Array.isArray(record.roles) || record.roles.some((role) => typeof role !== "string")) {
    return { ok: false, problem: "'roles' is missing or is not a list of role ids" };
  }
  if (!Array.isArray(record.leases)) return { ok: false, problem: "'leases' is missing" };
  const leases: DigestLease[] = [];
  for (const entry of record.leases) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, problem: "a lease entry is not an object" };
    }
    const lease = entry as Record<string, unknown>;
    if (typeof lease.role !== "string" || typeof lease.thread !== "string") {
      return { ok: false, problem: "a lease entry has no 'role'/'thread' pair" };
    }
    if (typeof lease.state !== "string")
      return { ok: false, problem: "a lease entry has no state" };
    leases.push({
      role: lease.role,
      thread: lease.thread,
      state: lease.state,
      deadline: typeof lease.deadline === "string" ? lease.deadline : null,
    });
  }
  return {
    ok: true,
    digest: {
      instance: record.instance,
      writtenAt: record.writtenAt,
      roles: record.roles as string[],
      leases,
      // Read PERMISSIVELY and dropped when it is not what we expect: a neighbour on an
      // older version has no such field, and a neighbour on a newer one may have widened
      // it. Neither is a reason to stop reading its leases — the isolation this parser
      // exists for is exactly "one box's file must not blind the reader to the rest".
      ...(Array.isArray(record.quota) && record.quota.every(isShelf)
        ? { quota: record.quota as QuotaShelf[] }
        : {}),
    },
  };
};

/** How old a digest may be before the reader stops treating it as the other box's state. */
export const DEFAULT_STALE_AFTER_SECONDS = 3600;

export const digestAgeSeconds = (digest: InstanceDigest, now: Date): number =>
  Math.round((now.getTime() - Date.parse(digest.writtenAt)) / 1000);

/**
 * WHAT `check` KNOWS ABOUT THE CLASS. Three things, and each of them is a way the
 * directory silently stops meaning anything:
 *
 *  - a file that is not `<id>.json` — something other than a digest was put in the
 *    class directory, and the reader would either ignore it or read it as a box;
 *  - a digest whose file name and `instance` field disagree — the file name is the
 *    identity, exactly as it is for a message;
 *  - a digest for an instance the repository does not declare — a box that has been
 *    removed from the topology (or was never in it) keeps publishing, and its state
 *    reads as current.
 *
 * A REPOSITORY WITH NO TOPOLOGY IS NOT AN ERROR HERE either (the same rule as
 * `ownershipIssues`): with no declared instances the last check has nothing to judge
 * against, so it is not made.
 */
export const digestIssues = (input: {
  /** File names directly inside `_instances/`, as they are on disk. */
  readonly files: readonly string[];
  /** Contents by file name — a name absent from the map is reported as unreadable. */
  readonly contents: ReadonlyMap<string, string>;
  /** Instance ids the repository declares; empty means no topology is declared. */
  readonly declared: readonly string[];
}): readonly string[] => {
  const issues: string[] = [];
  for (const name of [...input.files].sort()) {
    if (!name.endsWith(".json")) {
      issues.push(
        `'${DIGEST_DIR}/${name}' is not a digest — the directory is a CLASS of derived state files named '<instance>.json', not a place for anything else`,
      );
      continue;
    }
    const raw = input.contents.get(name);
    if (raw === undefined) {
      issues.push(`'${DIGEST_DIR}/${name}' could not be read`);
      continue;
    }
    const read = parseDigest(raw);
    if (!read.ok) {
      issues.push(`'${DIGEST_DIR}/${name}' is not a readable digest — ${read.problem}`);
      continue;
    }
    const id = name.slice(0, -".json".length);
    if (read.digest.instance !== id) {
      issues.push(
        `'${DIGEST_DIR}/${name}' declares instance '${read.digest.instance}' — the file name is the identity, they must agree`,
      );
    }
    if (input.declared.length > 0 && !input.declared.includes(id)) {
      issues.push(
        `'${DIGEST_DIR}/${name}' belongs to instance '${id}', which the repository does not declare (${input.declared.join(", ")}) — a box removed from the topology that keeps publishing reads as current state`,
      );
    }
  }
  return issues;
};

/**
 * The other boxes, for `status` — beside this box's own leases, because "why is nobody
 * raising dev-core" is answered by the two together and by neither alone.
 *
 * THE OWN INSTANCE IS SHOWN TOO, and marked: its digest is the only proof that this box
 * is publishing at all, and a writer that has silently stopped is precisely the failure
 * that makes everyone else's view wrong.
 */
export const renderInstances = (input: {
  readonly digests: readonly InstanceDigest[];
  /** Files that did not read, name → reason — never swallowed. */
  readonly unreadable?: ReadonlyMap<string, string>;
  readonly self?: string | undefined;
  readonly now: Date;
  readonly staleAfterSeconds?: number;
}): string => {
  const stale = input.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;
  const lines: string[] = ["instances:"];
  if (input.digests.length === 0 && (input.unreadable?.size ?? 0) === 0) {
    // Silence here would read as "no other boxes", which is a claim. The absence of
    // digests means nobody has published — including, possibly, this box.
    lines.push(
      `  no digests published (${DIGEST_DIR}/ is empty or absent) — either the topology is one box, or no daemon has written its state yet`,
    );
    return lines.join("\n");
  }
  for (const digest of [...input.digests].sort((a, b) => a.instance.localeCompare(b.instance))) {
    const age = digestAgeSeconds(digest, input.now);
    const mark = digest.instance === input.self ? " (this box)" : "";
    const staleMark =
      age > stale
        ? `  ⚠ STALE — nothing published for ${age}s, treat the state below as last known`
        : "";
    lines.push(
      `  ${digest.instance}${mark}: ${digest.leases.length} live · roles ${digest.roles.join(", ") || "—"} · written ${digest.writtenAt} (${age}s ago)${staleMark}`,
    );
    for (const shelf of digest.quota ?? []) {
      lines.push(`    ⏸ ${describeQuotaShelf(shelf)}`);
    }
    for (const lease of digest.leases) {
      lines.push(
        `    ${lease.role}/${lease.thread}  ·  ${lease.state}${lease.deadline === null ? "" : `  ·  deadline ${lease.deadline}`}`,
      );
    }
  }
  for (const [name, problem] of input.unreadable ?? new Map()) {
    lines.push(`  ⚠ ${DIGEST_DIR}/${name} was not read: ${problem}`);
  }
  return lines.join("\n");
};
