/**
 * WHAT A RUN LEFT IN THE CHECKOUT OF ANOTHER CONTOUR (measure 4 of thread
 * `062-contour-boundary`, the form settled in `docs/contour-user-separation-plan.md` §6
 * and bought by john on 2026-09-03: it is put in WITHOUT waiting for the date of the
 * user separation, because it is the only one of the five that works until that hour).
 *
 * THE FACT THIS ANSWERS. Both measured breaches of the boundary were found by a HUMAN
 * reading a foreign repository afterwards — #453/#454 (a PR opened in the neighbour's
 * house) and #181 (a role of the consumer contour committing and pushing into THIS
 * contour's checkout with this contour's credentials). Measure 1 is a door in the
 * package's own commands and judges the tree a command was pointed at; it cannot see a
 * plain `git -C /somewhere/else commit`, because that command never enters this package.
 * So the class is visible exactly as often as somebody happens to look, which is not a
 * measurement at all.
 *
 * WHERE THE LIST OF FOREIGN CHECKOUTS COMES FROM, and this is the question curator asked
 * to have answered before the label: FROM ALREADY-DECLARED DATA, no new config key, no
 * new message field, no new step of the route. A box that hosts more than one contour
 * says so itself — one named machine config per instance, `instances/<name>.json`, and
 * `repo` in it is «which checkout this instance serves» (thread 055, the field that
 * already lets a command typed inside a project pick that project's instance). Every
 * declared `repo` that is not the checkout of THIS run is, by that same declaration, the
 * checkout of another contour. A box with one contour has no named configs at all, gets
 * an empty list, and pays nothing.
 *
 * WHAT IS AND IS NOT CLAIMED — the same honesty the shared-place listing next door is
 * built on ({@link namedSharedLeftovers}), for the same reason:
 *
 * - what is measured is that a ref MOVED OR APPEARED between the spawn and the close of
 *   THIS run. On a box where the neighbour's own daemon is alive that is a window and not
 *   an owner, and the line says so in its own words instead of accusing the run it is
 *   written under. A window is a fact; a confession is a mood;
 * - the refs are the whole listing — a new branch, a moved branch and a moved `HEAD`
 *   are what a commit, a push or a checkout leaves behind, and all three are named. What
 *   is NOT looked at is the working tree: an uncommitted edit in somebody else's checkout
 *   is a fact of that contour's own R17 refusal, not of this run's journal;
 * - NOTHING IS CHANGED. Not a ref, not a file, not a stash. Reading is the entire
 *   mandate: a door that repairs a foreign checkout on the strength of a window would be
 *   a worse defect than the one being measured;
 * - IT IS NOT FAIL-CLOSED, and that is a decision (§6 of the plan, restated in the
 *   statement of work): the finding does not change the outcome of the tick and does not
 *   stop the contour. Blocking is the work of measure 1 and measure 5; a watchman that
 *   halts a circuit on suspicion is switched off by its first false positive.
 *
 * WHAT IT CANNOT SEE, named here rather than left to be discovered: an action taken
 * through the API against a repository that has no checkout on this box. That is the
 * boundary of the mechanism — this one catches the footprint ON THE BOX — and the rest is
 * closed by measure 2 (separate tokens) and measure 5 (separate system users).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { listInstanceConfigs, parseLocalConfig } from "../config/local.js";

/** A checkout of ANOTHER contour, as the box's own machine configs declare it. */
export type ForeignCheckout = {
  /** The instance whose config declared it — the name a reader needs to go and look. */
  readonly instance: string;
  /** The absolute path of the checkout. */
  readonly path: string;
};

/**
 * The list, plus the holes in it. A machine config that could not be read is NOT silently
 * dropped: an unreadable declaration means a checkout this box may host and this
 * measurement did not look at, and a hole read as «nothing there» is the door lying.
 */
export type ForeignCheckouts = {
  readonly checkouts: readonly ForeignCheckout[];
  /** One line per config that could not be read — said, not swallowed. */
  readonly holes: readonly string[];
};

/** What one checkout's refs were at a moment; a checkout that cannot be read says so. */
export type RefListing =
  | { readonly refs: ReadonlyMap<string, string> }
  | { readonly unreadable: string };

/** The refs of every foreign checkout at a moment: its path → its listing. */
export type ForeignSnapshot = ReadonlyMap<string, RefListing>;

/** How many refs are named before the count takes over — as in the shared-place listing. */
const REFS_NAMED = 20;

/** Two paths are the same house when one of them is the other or lies under it. */
const sameHouse = (a: string, b: string): boolean => {
  const one = resolve(a);
  const two = resolve(b);
  return one === two || one.startsWith(`${two}${sep}`) || two.startsWith(`${one}${sep}`);
};

/**
 * THE CHECKOUTS OF OTHER CONTOURS KNOWN TO THIS BOX. `own` is the working directory of
 * the run — a role's worktree (`.worktrees/<role>`) answers with its home checkout by
 * containment, which is the same rule `resolveLocalConfig` already uses to pick an
 * instance from a path.
 */
export const foreignCheckouts = (input: {
  readonly own: string;
  readonly env: NodeJS.ProcessEnv;
  readonly configs?: readonly { readonly name: string; readonly path: string }[];
  readonly read?: (path: string) => string;
}): ForeignCheckouts => {
  const read = input.read ?? ((path: string) => readFileSync(path, "utf8"));
  const checkouts: ForeignCheckout[] = [];
  const holes: string[] = [];
  for (const named of input.configs ?? listInstanceConfigs(input.env)) {
    let repo: string | undefined;
    try {
      repo = parseLocalConfig(JSON.parse(read(named.path)), named.path).repo;
    } catch (error) {
      holes.push(
        `the machine config ${named.path} could not be read (${(error as Error).message}) — whether instance '${named.name}' serves a checkout on this box is NOT known, and it was not looked at`,
      );
      continue;
    }
    if (repo === undefined || sameHouse(repo, input.own)) continue;
    checkouts.push({ instance: named.name, path: resolve(repo) });
  }
  return { checkouts, holes };
};

/** The refs of a checkout, by `git for-each-ref` plus the checked-out `HEAD` itself. */
const refsOfCheckout = (path: string): ReadonlyMap<string, string> => {
  const said = execFileSync(
    "git",
    ["-C", path, "for-each-ref", "--format=%(refname) %(objectname)"],
    {
      encoding: "utf8",
    },
  );
  const refs = new Map<string, string>();
  for (const line of said.split("\n")) {
    const [name, object] = line.trim().split(" ");
    if (name !== undefined && name !== "" && object !== undefined) refs.set(name, object);
  }
  const head = execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== "") refs.set("HEAD", head);
  return refs;
};

/**
 * WHAT THE FOREIGN CHECKOUTS HELD, taken before the spawn and again at the close. A
 * checkout that cannot be read is recorded AS SUCH rather than as empty: read as empty,
 * every ref in it would look new at the close, which is a door inventing findings.
 */
export const snapshotForeign = (
  checkouts: readonly ForeignCheckout[],
  refsOf: (path: string) => ReadonlyMap<string, string> = refsOfCheckout,
): ForeignSnapshot => {
  const snapshot = new Map<string, RefListing>();
  for (const checkout of checkouts) {
    try {
      snapshot.set(checkout.path, { refs: new Map(refsOf(checkout.path)) });
    } catch (error) {
      snapshot.set(checkout.path, { unreadable: (error as Error).message });
    }
  }
  return snapshot;
};

/** The short form of an object id — enough to go and look, short enough to read. */
const short = (object: string): string => object.slice(0, 8);

/**
 * THE LINES THE OPERATOR HEARS — one per foreign checkout that moved, none at all for the
 * ordinary run. Silence is the answer for a tick that stayed at home, so a line here
 * always means something happened outside the contour.
 *
 * Every line names the four things the statement of work requires: the ROLE and thread,
 * the WINDOW of the tick, the FOREIGN ADDRESS (path and the instance that declared it),
 * and WHAT was found (which refs, from what to what).
 */
export const namedForeignFootprints = (input: {
  readonly before: ForeignSnapshot;
  readonly checkouts: readonly ForeignCheckout[];
  readonly roleId: string;
  readonly thread: string;
  readonly since: Date;
  readonly until: Date;
  readonly refsOf?: (path: string) => ReadonlyMap<string, string>;
}): readonly string[] => {
  const after = snapshotForeign(input.checkouts, input.refsOf);
  const window = `${input.roleId}/${input.thread} ran (${input.since.toISOString()} → ${input.until.toISOString()})`;
  const lines: string[] = [];
  for (const checkout of input.checkouts) {
    const was = input.before.get(checkout.path);
    const now = after.get(checkout.path);
    if (was === undefined || now === undefined) continue;
    if ("unreadable" in was || "unreadable" in now) {
      const hole = "unreadable" in now ? now : "unreadable" in was ? was : undefined;
      lines.push(
        `the checkout ${checkout.path} of contour '${checkout.instance}' could not be read (${hole?.unreadable ?? "unknown reason"}) — what ${window} did there is NOT named`,
      );
      continue;
    }
    const moved: string[] = [];
    for (const [name, object] of [...now.refs].sort(([a], [b]) => a.localeCompare(b))) {
      const had = was.refs.get(name);
      if (had === undefined) moved.push(`${name} (new, ${short(object)})`);
      else if (had !== object) moved.push(`${name} (was ${short(had)}, now ${short(object)})`);
    }
    if (moved.length === 0) continue;
    const named = moved.slice(0, REFS_NAMED).join(", ");
    lines.push(
      `CONTOUR BOUNDARY: the checkout ${checkout.path} of another contour ('${checkout.instance}') moved ${moved.length} ${moved.length === 1 ? "ref" : "refs"} while ${window}: ${named}${
        moved.length > REFS_NAMED ? `, … and ${moved.length - REFS_NAMED} more` : ""
      }. A role works only inside the repository of its own contour — this is the window of this run, not proof of its authorship: the neighbour's own circuit alive in the same window could have moved them. Nothing was changed there, and this finding stops nothing.`,
    );
  }
  return lines;
};
