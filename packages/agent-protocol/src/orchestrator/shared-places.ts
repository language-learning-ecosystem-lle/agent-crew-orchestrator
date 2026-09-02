/**
 * WHAT A RUN LEFT IN A PLACE THAT IS NOT ITS OWN (thread `056-shared-tmp-mechanism`,
 * step 1 of john's order of 2026-09-02: VISIBILITY FIRST, and it forbids nothing).
 *
 * THE FACT THIS ANSWERS. Every one of the eight known cases of the class was found by a
 * role CATCHING ITSELF — the write happens, the role notices, the role reports it in its
 * own letter. That is not a measurement, it is a confession: the class is visible exactly
 * as often as an executor happens to be honest and awake, and invisible the rest of the
 * time. `TMPDIR` per run (the same thread, PR #172) closed the half of the class where the
 * command names no destination (`mktemp`); it cannot close — and was never able to close —
 * the half where the session TYPES a path: `> /tmp/.nothing`, `> "$HOME/.marker_$$"`. Both
 * of those happened, both under the merged mechanism, and the second one is why the shared
 * place here is not only `/tmp`: the trap is the literal path as a convenient form of a
 * command, not the directory `/tmp`.
 *
 * WHAT IS AND IS NOT CLAIMED, because a shared place is SHARED and the honesty of the line
 * is the whole value of it:
 *
 * - what is measured is that an entry APPEARED between the spawn and the close of THIS
 *   run. On a box with several live sessions that is a window, not an owner, and the line
 *   says so in its own words rather than accusing the run it is written under. This is the
 *   same property that made the statement of work's first shape (diff the shared `/tmp`,
 *   attribute it to the session) refusable in msg-002 — what makes it worth writing anyway
 *   is that the alternative on the table is nothing at all, and a window is a fact where a
 *   confession is a mood;
 * - the listing is the TOP LEVEL of each place and deliberately not a walk. The class is
 *   about a path typed by hand, and a typed path is short: `/tmp/x`, `$HOME/.marker`. A
 *   recursive walk of a home directory would cost every run a whole tree for entries no
 *   case has ever produced;
 * - NOTHING IS REMOVED. The run's own `TMPDIR` is swept because it belongs to the run;
 *   an entry in a shared place belongs to whoever made it, and deleting somebody's file on
 *   the strength of a window would be a worse defect than the one being measured.
 */
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The listing of one place, taken once — a name is enough, the fact is «it appeared». */
export type PlaceListing = { readonly names: readonly string[] } | { readonly unreadable: string };

/** What each shared place held at a moment: the place's path → its top-level listing. */
export type SharedSnapshot = ReadonlyMap<string, PlaceListing>;

/** How many names are worth printing before the count takes over — as in the run's own sweep. */
const SHARED_NAMED = 20;

/**
 * THE PLACES THAT BELONG TO NOBODY IN PARTICULAR, and the list is short on purpose: the
 * statement of work names `/tmp` and the home directory of the box's user, and those are
 * the two every measured case landed in.
 *
 * The shared temp is taken as the PLATFORM resolves it for the supervisor (`os.tmpdir()`,
 * i.e. `TMPDIR` or `/tmp`) rather than spelled `/tmp` here: on the box that runs the
 * circuit that is `/tmp`, and where it is not, the supervisor's own inherited scratch is
 * precisely the place a session would have written into had the launch not overridden the
 * variable. The run's own directory is never one of these — it is a child of the state
 * directory and gets swept by its own owner.
 */
export const sharedPlaces = (env: { readonly HOME?: string }): readonly string[] => {
  const places = [tmpdir(), env.HOME].filter((place): place is string => !!place);
  return [...new Set(places)];
};

/**
 * WHAT THE PLACES HELD, taken before the spawn and again at the close. A place that cannot
 * be listed is recorded AS SUCH rather than as empty: an unreadable place read as empty
 * would make every entry in it look new at the close, which is a door inventing findings.
 */
export const snapshotShared = (
  places: readonly string[],
  list: (place: string) => readonly string[] = (place) => readdirSync(place),
): SharedSnapshot => {
  const snapshot = new Map<string, PlaceListing>();
  for (const place of places) {
    try {
      snapshot.set(place, { names: [...list(place)] });
    } catch (error) {
      snapshot.set(place, { unreadable: (error as Error).message });
    }
  }
  return snapshot;
};

/**
 * WHAT ONE ENTRY IS, in the words the operator needs to judge it without going to look:
 * its size, or that it is a directory. An entry that has vanished again by the time the
 * line is written (a scratch file the session removed itself) is named without a size —
 * it still appeared, and «appeared and was cleaned up» is a different fact from «left».
 */
const describeEntry = (
  path: string,
  stat: (p: string) => { size: number; dir: boolean } | undefined,
): string => {
  const fact = stat(path);
  if (fact === undefined) return `${path} (gone by the close of the run)`;
  return fact.dir ? `${path} (directory)` : `${path} (${fact.size} bytes)`;
};

const statEntry = (path: string): { size: number; dir: boolean } | undefined => {
  try {
    const stat = statSync(path);
    return { size: stat.size, dir: stat.isDirectory() };
  } catch {
    return undefined;
  }
};

/**
 * THE LINES THE RUN'S LOG GAINS — one per place that changed, none at all for the ordinary
 * run. Silence is the answer for a session that left nothing, so a line here always means
 * something appeared, and the role and thread are IN the line: the digest of the class is
 * read across runs, where a log's own file name is not carried along.
 */
export const namedSharedLeftovers = (input: {
  readonly before: SharedSnapshot;
  readonly places: readonly string[];
  readonly roleId: string;
  readonly thread: string;
  readonly list?: (place: string) => readonly string[];
  readonly stat?: (path: string) => { size: number; dir: boolean } | undefined;
}): readonly string[] => {
  const after = snapshotShared(input.places, input.list);
  const stat = input.stat ?? statEntry;
  const lines: string[] = [];
  for (const place of input.places) {
    const was = input.before.get(place);
    const now = after.get(place);
    if (was === undefined || now === undefined) continue;
    // SAID, NOT SWALLOWED: a place that could not be listed is a hole in the measurement,
    // and a measurement with a silent hole reads as «nothing was left».
    const hole = "unreadable" in now ? now : "unreadable" in was ? was : undefined;
    if ("unreadable" in was || "unreadable" in now) {
      lines.push(
        `the shared place ${place} could not be listed (${hole?.unreadable ?? "unknown reason"}) — what ${input.roleId}/${input.thread} left there is NOT named`,
      );
      continue;
    }
    const seen = new Set(was.names);
    const fresh = now.names.filter((name) => !seen.has(name)).sort();
    if (fresh.length === 0) continue;
    const named = fresh
      .slice(0, SHARED_NAMED)
      .map((name) => describeEntry(join(place, name), stat))
      .join(", ");
    lines.push(
      `SHARED PLACE ${place} gained ${fresh.length} ${fresh.length === 1 ? "entry" : "entries"} while ${input.roleId}/${input.thread} ran: ${named}${
        fresh.length > SHARED_NAMED ? `, … and ${fresh.length - SHARED_NAMED} more` : ""
      }. A shared place is shared: this run's window is what is measured, not its authorship — another session alive in the same window could have written them. Nothing was removed.`,
    );
  }
  return lines;
};
