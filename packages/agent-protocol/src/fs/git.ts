/**
 * The previous state of the feed — from git.
 *
 * The immutability check on messages cannot rely on disk: disk only holds "now".
 * The question "was an already committed file changed" only makes sense relative
 * to a point in history, and the only one who knows that point is git.
 *
 * Why this does not break the layering: the core (`thread/`) stays a set of
 * "string → string" functions and knows nothing about git; `checkImmutable` takes
 * two "path → content" maps. This module is the thin wrapper that obtains the
 * second map.
 *
 * Failure is loud: wrong ref, not a repository, no git on PATH — an exception
 * with a message, not an empty map. An empty map would mean "nothing changed",
 * i.e. the check would silently turn into its own opposite.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";

const git = (root: string, args: readonly string[]): string => {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} in '${root}': ${(error as Error).message}`);
  }
};

const MESSAGE_PATH = /\/messages\/[^/]+\.md$/;

/**
 * Message files as of `ref`, keyed by path relative to `root`
 * (the same shape as on-disk paths, otherwise the maps cannot be compared).
 */
export const messagesAtRef = (root: string, ref: string): Map<string, string> => {
  // Every git call is made FROM THE REPOSITORY ROOT, not from the mail directory:
  // pathspecs and `ls-tree` output resolve relative to the current directory, and
  // running from a subdirectory produced an empty list — that is, "nothing
  // changed" instead of an answer. Caught by a test, not by reasoning.
  const top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const prefix = relative(top, realpathSync(root));

  const listed = git(top, ["ls-tree", "-r", "--name-only", "--full-name", ref, "--", prefix || "."])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && MESSAGE_PATH.test(line));

  const files = new Map<string, string>();
  for (const path of listed) {
    const key = prefix === "" ? path : relative(prefix, path);
    files.set(key, git(top, ["show", `${ref}:${path}`]));
  }
  return files;
};

/**
 * File contents as of `ref`.
 *
 * The protocol config is read ONLY this way and never from the working copy on
 * disk: an agent's worktree sits on that agent's own feature branch, so a
 * permissions change living in that branch would look effective to the circuit.
 * The same class as cwd blindness (008), only more dangerous — this one is about
 * permissions.
 */
export const readFileAtRef = (repo: string, ref: string, path: string): string =>
  git(repo, ["show", `${ref}:${path}`]);

/** Whether a file exists as of `ref`. Needed to verify the declared role instructions. */
export const fileExistsAtRef = (repo: string, ref: string, path: string): boolean => {
  try {
    execFileSync("git", ["-C", repo, "cat-file", "-e", `${ref}:${path}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * Refresh the remote-tracking ref before reading.
 *
 * `git show origin/main:…` reads the local copy of the branch, which without a
 * fetch goes stale SILENTLY: a month-old config is indistinguishable from a fresh
 * one. Hence refreshing is part of the read operation, and declining it
 * (`--no-fetch`) must come with a loud note at the caller.
 */
export const fetchRef = (repo: string, ref: string): void => {
  const at = ref.indexOf("/");
  if (!ref.startsWith("origin/") || at === -1) return;
  git(repo, ["fetch", "--quiet", "origin", ref.slice(at + 1)]);
};

/**
 * State of the mail checkout: branch, cleanliness, how far behind and ahead of
 * `origin/<branch>` it is. The daemon reads mail FROM DISK, so "is it fresh" is a
 * question about this checkout, and the answer must be a fact rather than faith.
 *
 * Updating is fast-forward ONLY. `reset --hard` would fix being behind and wipe
 * out the message a role is writing right now; we neither can nor will repair
 * things at someone else's expense — divergence stays a refusal.
 */
export const mailCheckoutState = (
  checkout: string,
  branch: string,
): { branch: string; dirty: boolean; behind: number; ahead: number } => {
  git(checkout, ["fetch", "--quiet", "origin", branch]);
  const current = git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (current === branch) {
    // This may fail (divergence, dirt) — a legitimate outcome, named by the
    // fact-based verdict below rather than by an exception from here.
    try {
      git(checkout, ["merge", "--ff-only", "--quiet", `origin/${branch}`]);
    } catch {
      // stay with what we have — the counters will show the divergence
    }
  }
  const dirty = git(checkout, ["status", "--porcelain"]).trim() !== "";
  const counts = git(checkout, [
    "rev-list",
    "--left-right",
    "--count",
    `origin/${branch}...HEAD`,
  ]).trim();
  const [behind = "0", ahead = "0"] = counts.split(/\s+/);
  return { branch: current, dirty, behind: Number(behind), ahead: Number(ahead) };
};

/**
 * State of the WORKING repository — the one a launched session lands in. It
 * inherits the working directory as is, and "started work from a foreign branch"
 * is not visible from the outside at all: unlike stale mail, there is nothing to
 * diverge from. Hence the fact is obtained and printed always.
 */
export const workdirState = (repo: string): { branch: string; dirty: boolean } => ({
  branch: git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
  dirty: git(repo, ["status", "--porcelain"]).trim() !== "",
});
