/**
 * WHETHER THE USER A ROLE IS RAISED AS CAN REACH THE ACCOUNT DIRECTORY IT IS POINTED AT
 * (thread `047-devops-role`, msg-089 point 2) — a refusal BY NAME, before the spawn.
 *
 * THE FIELD CASE THIS MODULE EXISTS FOR, measured on 2026-09-02. Role `devops` was the
 * first role to declare `systemUser` (`aco-devops`). The switch itself worked; the session
 * came up and died in 0 seconds with `Not logged in · Please run /login`, because its
 * account directory was `/home/lle/.claude-lle-second` — mode `600`, owner `lle`, and the
 * new user cannot read it BY CONSTRUCTION OF OUR OWN BOUNDARY. Everything downstream read
 * that as a dead token: the notifier said "this box cannot authenticate with the
 * credentials of account 'lle-second'", the account went on the shelf, and the shelf stood
 * down every pair spending it — including `dev-core`, which had not failed once. The
 * operator was sent to log two accounts in by hand, twice, and neither login could have
 * fixed it: a login under `lle` rewrites a file that stays `600 lle`.
 *
 * The build already SAID this could happen — `describeSpawnAs` prints "the account
 * directory must be one that user may write — neither is checked by this build". A warning
 * printed beside a launch that then fails at the vendor is the door of discipline 4 not
 * being a door: the refusal an operator got named the wrong layer, so the repair they
 * reached for was the wrong one. This module turns that sentence into a refusal that names
 * the path, the mode, the owner and the user that cannot reach it.
 *
 * WHY IT NO LONGER KEYS ON `systemUser` — the correction of thread `179`, and the sentence
 * this block used to carry is the defect. It said: a role without `systemUser` "takes no
 * branch here at all: the session is raised as this process's own user, the directory is
 * the one this process already reads". THE SECOND HALF DOES NOT FOLLOW FROM THE FIRST. An
 * account directory is named by the MACHINE config and may sit in any home on the box; the
 * user a role is raised as has nothing to do with who owns it. Measured on 2026-09-09 from
 * a session of this circuit (`uid=1002(aco-hetzner)` — the very user both `claude-code`
 * roles are raised as): `accounts.codex-main` is `/home/lle/.codex`, `0775 lle:lle`, and
 * role `pilot-codex` is `active`, points at it and declares no `systemUser`. Its next lift
 * would have died on the credentials exactly as `devops` did on 02.09 — same failure,
 * same wrong diagnosis, and this door would have watched it go by.
 *
 * And the door that DOES look at the filesystem today confirms it rather than catching it:
 * `doctor` on that same box answers `account: 'codex-main' token: … Permission denied` and
 * `account: 'lle-second' token: Not logged in · Please run /login` — the second one is the
 * vendor's word for a directory this box cannot READ, i.e. the misdiagnosis of thread 047
 * still being printed, now about a role nobody switches users for.
 *
 * WHAT STILL TAKES NO BRANCH. A role pointed at NO account: the tool falls back to its own
 * default home under the running user's `HOME`, which that user owns. There is no path
 * named by anybody, so there is nothing to judge.
 */

import type { Role } from "../roles/schema.js";
import type { SpawnAs } from "./launch.js";

/** The permission bits of one path, as the box answered — or why it could not answer. */
export type PathFacts = {
  readonly path: string;
  /** `false` when the path does not exist, or when `stat` refused to speak about it. */
  readonly present: boolean;
  /**
   * `true` when the box REFUSED THE SUPERVISOR AN ANSWER about this path (`EACCES`/`EPERM`)
   * rather than saying it is not there. The distinction is the whole point of this field:
   * `present: false` then means "this process is blind here", not "absent", and a door that
   * reads the first as the second refuses a correctly built box. `/home/aco-devops/.claude`
   * at `700 aco-devops` is exactly what `docs/box-setup.md` §0.1a asks for, and the daemon
   * running as `lle` cannot `stat` it BY CONSTRUCTION — the blindness is evidence FOR the
   * setup, not against it.
   */
  readonly blind?: boolean;
  /** Permission bits (`mode & 0o7777`), when the path is present. */
  readonly mode?: number;
  readonly uid?: number;
  readonly gid?: number;
  /** The box's own words when it could not answer — carried into the refusal verbatim. */
  readonly detail?: string;
};

/**
 * WHO THE TARGET USER IS TO THE KERNEL — the numbers the permission bits are judged
 * against. Supplementary groups are part of it: a directory opened to a shared group is a
 * legitimate way to grant this access, and judging by the primary group alone would refuse
 * a box that is set up correctly.
 */
export type UserIdentity = {
  readonly uid: number;
  readonly gids: readonly number[];
};

/** What the box answered about one (user, directory) pair. Assembled by the caller — this half is IO. */
export type AccountReach = {
  /** The system user the session would run as — the one the bits are judged for. */
  readonly user: string;
  /**
   * Absent when the box cannot say who that user is (no passwd entry). Not a detail: with
   * no uid there is nothing to judge, and guessing "probably fine" is exactly the silent
   * pass this module exists to end.
   */
  readonly identity?: UserIdentity;
  /** The box's words when the identity could not be resolved. */
  readonly identityDetail?: string;
  /** The account directory itself. */
  readonly dir: PathFacts;
  /**
   * Its ancestors, from the root DOWNWARDS to the immediate parent. They matter as much as
   * the directory: `/home/lle` at `750 lle:lle` denies traversal, and a directory that is
   * `777` behind it is unreachable all the same. The refusal has to name the component
   * that actually blocks, or the operator repairs the wrong one.
   */
  readonly ancestors: readonly PathFacts[];
};

/** What this module needs of a `stat` — the three numbers, and nothing about `fs`. */
export type StatLike = {
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
};

/**
 * ONE PATH, ASKED OF THE BOX — and the half where the mirror defect actually lived. The
 * caller passes `statSync`; the mapping from what the box threw to what the door reads is
 * here, where it can be asserted without a filesystem.
 *
 * THE WHOLE RULE IS IN THE `catch`: `EACCES`/`EPERM` means THIS PROCESS may not look, and
 * `ENOENT` means the path is not there. Reporting both as `present: false` and nothing
 * else made the door announce "does not exist on this box" about a `700` directory owned
 * by the role's own user — the shape `docs/box-setup.md` §0.1a asks for.
 */
export const pathFactsFrom = (path: string, stat: (path: string) => StatLike): PathFacts => {
  try {
    const facts = stat(path);
    return { path, present: true, mode: facts.mode & 0o7777, uid: facts.uid, gid: facts.gid };
  } catch (error) {
    const code = (error as { readonly code?: string }).code;
    return {
      path,
      present: false,
      ...(code === "EACCES" || code === "EPERM" ? { blind: true } : {}),
      detail: (error as Error).message,
    };
  }
};

const READ = 0o4;
const WRITE = 0o2;
const EXEC = 0o1;

/**
 * THE POSIX RULE, NOT THE UNION OF THE THREE CLASSES. The kernel picks the FIRST matching
 * class and stops: owner bits when the uid matches, group bits when it does not and a gid
 * does, other bits otherwise. A union would call `0o070` readable for its owner, which the
 * kernel does not — and a permission check that is wrong in the permissive direction is
 * this door failing open.
 */
export const permits = (facts: PathFacts, who: UserIdentity, need: number): boolean => {
  if (!facts.present || facts.mode === undefined) return false;
  const bits =
    facts.uid === who.uid
      ? (facts.mode >> 6) & 0o7
      : facts.gid !== undefined && who.gids.includes(facts.gid)
        ? (facts.mode >> 3) & 0o7
        : facts.mode & 0o7;
  return (bits & need) === need;
};

/**
 * WHAT THE DIRECTORY ITSELF HAS TO GRANT, in the order a refusal reads them out. Write is
 * in the list and not only read: the tool keeps the whole account under that directory —
 * credentials it refreshes, its config, the session store — so a read-only directory is a
 * run that authenticates once and then fails somewhere no operator would connect to this.
 */
const NEEDED: readonly (readonly [string, number])[] = [
  ["r", READ],
  ["w", WRITE],
  ["x", EXEC],
];

/** `0o750 lle:lle` — the shape of the fact an operator has to compare against `ls -ld`. */
const describePath = (facts: PathFacts): string =>
  facts.mode === undefined
    ? "unreadable"
    : `mode 0${facts.mode.toString(8).padStart(3, "0")}, owner uid ${facts.uid ?? "?"} gid ${facts.gid ?? "?"}`;

const REPAIR_SWITCHED = [
  "Repair: give this role an account directory of its OWN, owned by that user, and log in",
  "UNDER that user (docs/box-setup.md §0.1a) — 'accounts.<id>.configDir' of the machine config,",
  "named by 'launch.account' of the role's card. Opening the daemon user's directory to the",
  "role instead hands a sandboxed identity the live token of the account other roles spend,",
  "which is the isolation the declaration exists to build.",
].join(" ");

/**
 * THE OTHER REPAIR, and it is a different one on purpose. Nobody switched users here, so
 * the directory is simply in the wrong home: the fix is an account this user can reach
 * (log it in under THIS user, into a directory of this user's own home), or — when the
 * directory really does belong to another identity — a `systemUser` on the card so that
 * the role is raised as whoever owns it. Sending an operator to `chmod` a home that
 * belongs to somebody else is the one repair this door must not name.
 */
const REPAIR_OWN = [
  "Repair: point this role at an account this user can reach — log the account in UNDER this",
  "user, into a directory of its own home, and name it in 'accounts.<id>.configDir' of the",
  "machine config; or, when the directory belongs to another identity on purpose, declare",
  "'systemUser' on the role's card so the session is raised as whoever owns it. Opening",
  "another user's home to this one instead shares a live token across a boundary the box",
  "was set up to keep.",
].join(" ");

/**
 * THE DOOR. `undefined` — nothing to say, the launch proceeds exactly as it did before this
 * module existed. A string — the launch is refused and the string is what the operator reads.
 *
 * `reach` is REQUIRED rather than optional, deliberately, and it is the same argument that
 * made `RunParams.spawnAs` required: a caller that forgot to ask the box would raise the
 * session anyway, in silence, and the silence is the defect. `tsc` refuses instead.
 */
export const accountReachRefusal = (input: {
  readonly role: Role;
  readonly as: SpawnAs;
  /** The resolved account — absent when nobody named one and the session takes the box's own. */
  readonly account?: { readonly id: string; readonly configDir: string };
  readonly reach: AccountReach | undefined;
}): string | undefined => {
  // NO ACCOUNT NAMED — the tool falls back to its own default home under the target user's
  // `HOME`, which that user owns. Whether the account there is logged in is the vendor's
  // answer and not a fact about permissions; this door does not invent one.
  const as = input.as;
  const account = input.account;
  if (account === undefined) return undefined;
  // WHICH USER THE BITS ARE JUDGED FOR — the switch target when there is one, and otherwise
  // the user this supervisor already is. Both are read off `reach`, not off `as`: `SpawnAs`
  // carries no name in the `self` shape, and the name is the caller's answer either way.
  const who =
    as.mode === "sudo"
      ? `system user '${as.user}'`
      : `the supervisor's own user${input.reach === undefined ? "" : ` '${input.reach.user}'`}`;
  const said = (why: string): string =>
    [
      `role '${input.role.id}' is raised as ${who} and pointed at account`,
      `'${account.id}' in '${account.configDir}', ${why}.`,
      "Refused before the spawn rather than left to the vendor: the session would come up, fail to",
      "read its credentials and exit as 'Not logged in', which reads as a dead token and puts the",
      "whole account on the shelf — including roles that never failed (thread 047-devops-role).",
      as.mode === "sudo" ? REPAIR_SWITCHED : REPAIR_OWN,
    ].join(" ");
  if (input.reach === undefined) {
    return said("and this run did not ask the box whether that user can reach it");
  }
  const { identity, dir, ancestors } = input.reach;
  if (identity === undefined) {
    return said(
      `and this box cannot say who '${input.reach.user}' is — ${input.reach.identityDetail ?? "no passwd entry"}; with no uid there is nothing to judge the directory's bits against`,
    );
  }
  // ONLY PATHS THE BOX ACTUALLY SPOKE ABOUT ARE JUDGED. A blind path carries no bits, and
  // `permits` says `false` about everything it has no bits for — so judging one would turn
  // "this process may not look" into "this user may not pass", which is the same mistake in
  // the same door, one layer up.
  //
  // AND AN ANCESTOR THE BOX SAYS IS NOT THERE IS ABSENCE, not a permission fact — the same
  // rule the directory itself gets a few lines below, applied one layer up, and without it
  // the widening of thread `179` would refuse every unswitched role whose account has not
  // been logged in yet, naming a traversal that nothing denies. The switched case keeps
  // judging absent ancestors exactly as it has since thread 047: there the path was to be
  // MADE under that user's own home, so its absence is the defect being reported.
  const judged = as.mode === "sudo" ? ancestors : ancestors.filter((facts) => facts.present);
  const blocked = judged.find((facts) => !facts.blind && !permits(facts, identity, EXEC));
  if (blocked !== undefined) {
    return said(
      `which that user cannot traverse: '${blocked.path}' is ${blocked.present ? `${describePath(blocked)} — no 'x' for this user` : `absent or unreadable${blocked.detail === undefined ? "" : ` (${blocked.detail})`}`}`,
    );
  }
  // THE DIRECTORY THIS PROCESS IS NOT ALLOWED TO SEE — silence, and the launch proceeds as
  // it did before this module existed. It is the one branch where the door has NO FACT: the
  // bits exist, the supervisor is simply not permitted to read them, and every ancestor it
  // COULD read grants the target user its `x`. Refusing here would have refused the box
  // john built by hand this very day (`/home/aco-devops/.claude`, `700 aco-devops`, logged
  // in under that user) with the words "does not exist on this box" — the mirror image of
  // the field case this module was written for, and worse, because it would name a repair
  // that is already done. The vendor answers for what is inside the directory; this door
  // answers only for reaching it, and about this one it has nothing to say.
  //
  // AND THE ASYMMETRY IS THE WHOLE OF THE `self` CASE (thread `179`). When nobody switches
  // users, the process that cannot `stat` the directory IS the process the session runs as
  // — "the supervisor is not permitted to read the bits" and "the session will not be able
  // to read the credentials" stop being two different sentences and become one. There is no
  // second identity left for the blindness to be somebody else's, so silence here would be
  // this door failing open on the one shape it can answer with certainty.
  if (!dir.present && dir.blind === true) {
    if (as.mode === "sudo") return undefined;
    return said(
      `which THIS user is not permitted to look at${dir.detail === undefined ? "" : ` (${dir.detail})`} — and with no switch of identity there is nobody else for that blindness to belong to`,
    );
  }
  // ABSENCE IS NOT UNREADABILITY, and without a switch it is not this door's business
  // (thread `179`). A directory that is simply not there yet is what `config set` calls
  // ordinary — the login creates it — and a role may legitimately be pointed at one before
  // a human has logged that subscription in. `EACCES` is the opposite: no login repairs it,
  // because a login under the OTHER user rewrites a file that stays that user's. So the
  // widening of this thread carries exactly the refusals a login cannot fix, and the
  // switched case keeps the answer it has given since thread 047 — where the identity is
  // somebody else's, an absent directory IS the defect, since that user's own home is where
  // it was supposed to be made.
  if (!dir.present && as.mode !== "sudo") return undefined;
  if (!dir.present) {
    return said(
      `which does not exist on this box${dir.detail === undefined ? "" : ` (${dir.detail})`}`,
    );
  }
  const missing = NEEDED.filter(([, need]) => !permits(dir, identity, need));
  if (missing.length > 0) {
    return said(
      `which that user may not ${missing.map(([letter]) => letter).join("")} — the directory is ${describePath(dir)}, and the vendor keeps this account's credentials, config and session store inside it`,
    );
  }
  return undefined;
};
