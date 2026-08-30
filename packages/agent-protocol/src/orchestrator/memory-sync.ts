/**
 * A ROLE'S MEMORY TRAVELS WITH THE MAIL — the third third of form D (LLE thread
 * `116-role-memory-cost`, curator's postановка msg-008 §3, john's word «D, рядом с
 * почтой, с потолком»).
 *
 * WHAT WAS MISSING WITHOUT IT. `memory.ts` answered WHICH directory a session is
 * pointed at and put the ceiling on the index, but the directory it named lives in the
 * daemon's state directory — that is, on ONE box. Three things follow and all three are
 * the point of this module: john cannot see a role's notes in the feed; a role moved to
 * another box arrives with an empty head; and curator's deletion of a note is a
 * DECORATION, because the live copy the vendor reads is not the copy that was deleted
 * (constraint К-3). The branch is the source of truth, the box holds a working copy.
 *
 * THE TWO MOMENTS, AND WHY THEY ARE THESE TWO. Restore runs at the RAISE, before the
 * session exists — that is the one moment the directory can be replaced wholesale
 * without racing the vendor, which writes when it pleases. Save runs at the RELEASE,
 * after the child is gone, for the same reason read the other way round.
 *
 * WHY NOTHING HERE TOUCHES THE MAIL CHECKOUT'S WORKING TREE ON THE WAY IN. The restore
 * reads the branch through `ls-tree`/`show` against `origin/<branch>` — refs, never the
 * tree. Delivery refuses a mail checkout with a single dirty line and its retry runs
 * `reset --hard` (`thread/deliver.ts`), and the checkout is shared by every role on the
 * box: a restore that checked files out into it would block, or destroy, another role's
 * message. The save does write into that tree — and it does it THROUGH `deliverMessage`,
 * which owns the lock, the dirty check, the retry and the undo, rather than beside it.
 *
 * FIRST-WRITE-WINS, PER FILE, AND IT IS NOT A PREFERENCE (phase G of the LLE, quoted in
 * the постановка: «конфликтов двух версий состояния не бывает, бывает конфликт двух
 * намерений над одним состоянием»). The save carries ONLY what this session changed
 * against what it restored. A file the session did not touch is not staged at all, so
 * a deletion somebody else made in the branch while the session ran STANDS — which is
 * exactly the test of death: a note deleted in `comms` must not be resurrected by the
 * next save from a box. A file the session did change and somebody else moved too is
 * refused with a loud line: theirs landed first, ours is not written over it.
 *
 * MEMORY IS SELF-SERVICE, NOT WORK, and that decides every failure here (curator,
 * msg-008 §3). Nothing in this module may end a run: a branch that cannot be read, a
 * push that will not land, a directory that will not be written — each is a LOUD line
 * and a run that continues. What is not allowed is silence: a note lost without a word
 * is the one outcome the whole form was built to prevent.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import type { GitIdentity } from "../roles/identity.js";
import type { MailLock } from "../thread/checkout-lock.js";
import { unlockedMail } from "../thread/checkout-lock.js";
import { deliverMessage, type GitRun } from "../thread/deliver.js";
import { MEMORY_DIR } from "./memory.js";

/**
 * A DIRECTORY OF NOTES AS ONE VALUE: the path of a note relative to the role's own
 * directory, against its bytes. Content and not a hash, because the pile is small by
 * construction (the ceiling of `memory.ts` is 24 KB for the index that dominates it) and
 * a hash would buy nothing but a second thing to be wrong about.
 */
export type MemorySnapshot = ReadonlyMap<string, string>;

/** What one side of a synchronisation decided to do, in paths relative to the role's directory. */
export type MemoryPlan = {
  readonly writes: readonly { readonly path: string; readonly content: string }[];
  readonly removals: readonly string[];
  /** Files this side WANTED to write and did not, because somebody else got there first. */
  readonly conflicts: readonly string[];
};

/** Nothing to do — asked as a question rather than by counting three arrays at every caller. */
export const isEmptyPlan = (plan: MemoryPlan): boolean =>
  plan.writes.length === 0 && plan.removals.length === 0;

/**
 * WHERE THE NOTES OF A ROLE LIVE IN THE BRANCH, as a path relative to the root of the
 * mail checkout: `<mail.dir>/memory/<role>`. Posix separators and not `join`, because
 * this string is handed to git (`ls-tree`, `show`, `add`), and git speaks one separator
 * on every platform.
 *
 * The mail DIRECTORY comes from the config for the reason `deliverySubject` states: the
 * literal `agent-comms` is one project's name for it (thread 080).
 */
export const memoryBranchPrefix = (input: {
  readonly mailDir: string;
  readonly role: string;
}): string => `${input.mailDir}/${MEMORY_DIR}/${input.role}`;

/** The same place on disk, inside the mail checkout — what delivery stages and commits. */
export const memoryBranchDirectory = (input: {
  readonly mailRoot: string;
  readonly role: string;
}): string => join(input.mailRoot, MEMORY_DIR, input.role);

/**
 * WHAT THE RESTORE HANDED OVER, kept so that the save can tell "this session wrote it"
 * from "it was already there". Beside the role directories rather than inside one: the
 * vendor reads that directory and everything in it is a note to it, so bookkeeping of
 * ours has no business being there. A dot in the name is what keeps it from ever
 * colliding with a role id.
 */
export const roleMemorySnapshotFile = (input: {
  readonly memory: string;
  readonly role: string;
}): string => join(input.memory, `.restored-${input.role}.json`);

/**
 * THE RESTORE IS A MIRROR, NOT A MERGE, and that is the whole death mechanism: what the
 * branch does not have, the box does not keep. The cost is named rather than hidden — a
 * note written by a session whose save never landed is gone at the next raise, and the
 * save says so loudly at the moment it fails.
 */
export const planRestore = (input: {
  readonly branch: MemorySnapshot;
  readonly live: MemorySnapshot;
}): MemoryPlan => {
  const writes: { path: string; content: string }[] = [];
  const removals: string[] = [];
  for (const [path, content] of input.branch) {
    if (input.live.get(path) !== content) writes.push({ path, content });
  }
  for (const path of input.live.keys()) {
    if (!input.branch.has(path)) removals.push(path);
  }
  return { writes, removals: removals.sort(), conflicts: [] };
};

/**
 * THE SAVE CARRIES THE SESSION'S OWN CHANGES AND NOTHING ELSE (see the note at the top).
 * Three questions per path, in this order, and the order is the semantics:
 *
 * 1. did THIS session change it (live ≠ restored)? no → it is not ours to carry, and the
 *    branch keeps whatever it now says, deletion included;
 * 2. does the branch still say what we restored? no → somebody wrote first, and their
 *    write stands (a conflict, loud, not overwritten);
 * 3. then write it, or remove it if the session removed it.
 *
 * A session that made the same edit somebody else already pushed is NOT a conflict — the
 * feed already carries the byte the session meant, so there is nothing to report and
 * nothing to do.
 */
export const planSave = (input: {
  readonly restored: MemorySnapshot;
  readonly live: MemorySnapshot;
  readonly branch: MemorySnapshot;
}): MemoryPlan => {
  const writes: { path: string; content: string }[] = [];
  const removals: string[] = [];
  const conflicts: string[] = [];
  const paths = new Set<string>([...input.restored.keys(), ...input.live.keys()]);
  for (const path of [...paths].sort()) {
    const ours = input.live.get(path);
    const was = input.restored.get(path);
    if (ours === was) continue;
    const theirs = input.branch.get(path);
    if (ours === theirs) continue;
    if (theirs !== was) {
      conflicts.push(path);
      continue;
    }
    if (ours === undefined) removals.push(path);
    else writes.push({ path, content: ours });
  }
  return { writes, removals, conflicts };
};

/**
 * THE LOUD LINE OF A CONFLICT — pinned by a test, because a line nobody can quote is a
 * line that gets reworded into uselessness. It names the loser AND where the loser's
 * bytes still are, because the reader's next question is always "so where is my note".
 */
export const conflictLine = (input: {
  readonly role: string;
  readonly paths: readonly string[];
  readonly directory: string;
}): string =>
  `memory: ${input.paths.length} note(s) of '${input.role}' were NOT saved — the branch moved under them while the session ran, and the write that landed first stands (${input.paths.join(", ")}). This box's version is still in ${input.directory} and the next raise will replace it with the branch's — copy it out now if it matters.`;

/** The loud line of a save that could not land at all. Same rule: never silent, never fatal. */
export const saveFailureLine = (input: {
  readonly role: string;
  readonly reason: string;
  readonly directory: string;
}): string =>
  `memory: the notes of '${input.role}' could not be saved to the mail branch (${input.reason}) — they are still in ${input.directory}, and the next raise of this role will replace that directory with the branch's copy. Memory is self-service, so the run is not failed over it.`;

/** The loud line of a restore that could not read the branch at all. */
export const restoreFailureLine = (input: {
  readonly role: string;
  readonly reason: string;
}): string =>
  `memory: the notes of '${input.role}' could NOT be restored (${input.reason}) — the session is raised on this box's own copy. Memory is self-service, so the raise is not refused over it.`;

/**
 * WHAT A RESTORE SAYS, DECIDED AWAY FROM GIT (reviewer's finding on PR #159). The wiring
 * in `cli.ts` holds the git handles and nothing else; the rule lives here, where it can
 * be asked questions:
 *
 *  - a restore that THREW still measures the ceiling. The alarm asks nothing of the
 *    branch — only of the directory the session is about to read — and a failed restore
 *    is exactly when that directory is the previous round's copy: unreplaced, and now
 *    unmeasured too. Silence there is indistinguishable from "the ceiling holds", which
 *    is the one thing a loud ceiling exists not to be;
 *  - neither half can refuse the raise: memory is self-service, so both are only lines.
 */
export const restoreLines = (input: {
  readonly role: string;
  readonly restore: () => { readonly lines: readonly string[] };
  readonly alarm: () => string | undefined;
}): readonly string[] => {
  const said = ((): readonly string[] => {
    try {
      return input.restore().lines;
    } catch (error) {
      return [restoreFailureLine({ role: input.role, reason: (error as Error).message })];
    }
  })();
  const alarm = input.alarm();
  return alarm === undefined ? said : [...said, alarm];
};

/** Reading a directory of notes: every file under it, by path relative to it. */
export const readSnapshot = (directory: string): MemorySnapshot => {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        files.set(relative(directory, path).split(sep).join("/"), readFileSync(path, "utf8"));
    }
  };
  if (existsSync(directory)) walk(directory);
  return files;
};

/**
 * READING THE BRANCH WITHOUT TOUCHING THE TREE (see the note at the top). `-z` and not
 * plain `--name-only`: git quotes exotic names in the unterminated form and a note whose
 * name we cannot parse is a note we would silently drop.
 */
export const readBranchSnapshot = (input: {
  readonly git: GitRun;
  readonly ref: string;
  readonly prefix: string;
}): MemorySnapshot => {
  const listed = input.git(["ls-tree", "-r", "-z", "--name-only", input.ref, "--", input.prefix]);
  const files = new Map<string, string>();
  for (const path of listed.split("\0")) {
    if (path === "") continue;
    const relativePath = path.slice(input.prefix.length + 1);
    if (relativePath === "") continue;
    files.set(relativePath, input.git(["show", `${input.ref}:${path}`]));
  }
  return files;
};

/** Applying a plan to the live directory — the only writer of the box's working copy. */
export const applySnapshotPlan = (input: {
  readonly directory: string;
  readonly plan: MemoryPlan;
}): void => {
  for (const path of input.plan.removals) rmSync(join(input.directory, path), { force: true });
  for (const file of input.plan.writes) {
    const at = join(input.directory, file.path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file.content);
  }
};

const readManifest = (path: string): MemorySnapshot => {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    // NO MANIFEST IS NOT AN ERROR AND NOT AN EMPTY ONE EITHER — see `restoreRoleMemory`,
    // which is the only reason this can be absent: a save whose restore never ran.
    return new Map();
  }
};

const writeManifest = (path: string, snapshot: MemorySnapshot): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(Object.fromEntries([...snapshot].sort()), null, 2)}\n`);
};

/**
 * THE RAISE SIDE. Fetches the branch, mirrors it into the role's directory and records
 * what it handed over. Returns the lines to say — it neither prints nor throws, because
 * its caller is the launch path and a launch must not die of a table of contents.
 */
export const restoreRoleMemory = (input: {
  readonly git: GitRun;
  readonly branch: string;
  readonly mailDir: string;
  readonly role: string;
  readonly directory: string;
  readonly snapshotFile: string;
  /** Injected in tests; live it is the fetch that makes `origin/<branch>` mean today. */
  readonly fetch?: boolean;
}): { readonly lines: readonly string[]; readonly restored: MemorySnapshot } => {
  try {
    if (input.fetch !== false) input.git(["fetch", "--quiet", "origin", input.branch]);
    const branch = readBranchSnapshot({
      git: input.git,
      ref: `origin/${input.branch}`,
      prefix: memoryBranchPrefix({ mailDir: input.mailDir, role: input.role }),
    });
    const plan = planRestore({ branch, live: readSnapshot(input.directory) });
    mkdirSync(input.directory, { recursive: true });
    applySnapshotPlan({ directory: input.directory, plan });
    writeManifest(input.snapshotFile, branch);
    return {
      restored: branch,
      lines: isEmptyPlan(plan)
        ? []
        : [
            `memory: the notes of '${input.role}' were restored from the mail branch — ${plan.writes.length} written, ${plan.removals.length} removed (the branch is the source of truth; a note deleted there is deleted here)`,
          ],
    };
  } catch (error) {
    // A BOX THAT CANNOT READ THE BRANCH STILL RAISES ITS ROLE. The session then runs on
    // whatever the directory holds, which is the previous round's copy — stale, and said
    // so out loud rather than quietly presented as today's.
    return {
      restored: readSnapshot(input.directory),
      lines: [
        `memory: the notes of '${input.role}' could NOT be restored from the mail branch (${(error as Error).message}) — the session is being raised on this box's previous copy, which may be stale. Memory is self-service, so the raise is not refused over it.`,
      ],
    };
  }
};

/**
 * THE RELEASE SIDE. Carries this session's own changes into the branch as one commit,
 * through the delivery that owns the checkout's lock, dirty check, retry and undo.
 *
 * IT RUNS AFTER THE CHILD IS GONE AND NEVER FROM AN EXIT HANDLER. `recordSupervisorGone`
 * is a process-exit handler and a git push started there has no time to finish (the same
 * measured reason the digest is not published from it) — so a supervisor killed under a
 * run loses that round's notes, and that is a named cost, not an oversight.
 */
export const saveRoleMemory = (input: {
  readonly git: GitRun;
  readonly branch: string;
  readonly mailDir: string;
  readonly mailRoot: string;
  readonly role: string;
  readonly directory: string;
  readonly snapshotFile: string;
  readonly identity: GitIdentity;
  readonly lock?: MailLock;
  readonly write?: (path: string, content: string) => void;
  readonly remove?: (path: string) => void;
}): readonly string[] => {
  const prefix = memoryBranchPrefix({ mailDir: input.mailDir, role: input.role });
  const at = memoryBranchDirectory({ mailRoot: input.mailRoot, role: input.role });
  const restored = readManifest(input.snapshotFile);
  const live = readSnapshot(input.directory);
  const said: string[] = [];
  try {
    // PLANNED INSIDE THE ATTEMPT, like every other delivery: the branch is read AFTER the
    // fetch and the fast-forward this call makes, so "somebody wrote first" is answered
    // against the feed as it is now and not as it was when the session started.
    let conflicts: readonly string[] = [];
    const delivered = deliverMessage({
      git: input.git,
      write:
        input.write ??
        ((path, content) => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
        }),
      ...(input.remove === undefined ? {} : { remove: input.remove }),
      branch: input.branch,
      subject: `docs(${input.mailDir}): память роли ${input.role}`,
      identity: input.identity,
      lock: input.lock ?? unlockedMail,
      note: (line) => said.push(line),
      stage: () => {
        const branch = readBranchSnapshot({
          git: input.git,
          ref: `origin/${input.branch}`,
          prefix,
        });
        const plan = planSave({ restored, live, branch });
        conflicts = plan.conflicts;
        return {
          files: plan.writes.map((file) => ({ path: join(at, file.path), content: file.content })),
          removals: plan.removals.map((path) => join(at, path)),
          label: `${prefix} (${plan.writes.length} written, ${plan.removals.length} removed)`,
        };
      },
    });
    if (conflicts.length > 0)
      said.push(conflictLine({ role: input.role, paths: conflicts, directory: input.directory }));
    if (delivered.written) {
      said.push(
        `memory: the notes of '${input.role}' were saved to the mail branch — ${delivered.label}`,
      );
      writeManifest(input.snapshotFile, live);
    }
    return said;
  } catch (error) {
    said.push(
      saveFailureLine({
        role: input.role,
        reason: (error as Error).message,
        directory: input.directory,
      }),
    );
    return said;
  }
};

/** Whether this box has anything to say about a role's memory at all — cheap, for callers. */
export const hasMemory = (directory: string): boolean => {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
};
