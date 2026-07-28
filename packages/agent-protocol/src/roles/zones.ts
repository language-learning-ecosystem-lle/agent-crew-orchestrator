/**
 * ZONES GET AN ENFORCER (thread `020-zones-enforcement`, john's decision of
 * 2026-07-27). Until now `zones` was a declaration with no code consumer at all —
 * the role card held it, the reviewer held it, the merge door held it, and at the
 * MOMENT OF THE EDIT nothing held it: a raised session can physically write any
 * file of the workspace.
 *
 * THE THREAT MODEL IS A FORGETFUL COOPERATIVE AGENT, not a malicious one. That is
 * what makes cheap doors worth building and expensive ones (OS isolation, read-only
 * mounts) out of scope — those belong to the VPS move, where containers appear for
 * their own reasons.
 *
 * THREE DOORS, from the edit towards `main`, and this module is the ONE place that
 * decides what is inside a zone and what is not — all three read it:
 *
 *  1. **The launch deny rules** (`zoneDenyRules`) — turned into the settings the
 *     session is raised with, so the tool itself refuses the edit as it happens and
 *     the session sees the refusal. Known hole: a `Bash` write (`echo > file`) is
 *     not a tool rule and slips through — door 2 exists for exactly that.
 *  2. **The pre-commit guard** (`pathsOutsideZones` over the staged paths) — the
 *     file may be touched on disk, it does not get into history.
 *  3. **The CI step** (`pathsOutsideZones` over the PR diff, role taken from the
 *     `role:` line of the description) — red before the review.
 *
 * THE CHAIN IS ONLY AS HONEST AS ITS HOLES ARE NAMED. Door 1 does not see a `Bash`
 * write — door 2 catches it. Door 2 does not see `git commit --no-verify` — door 3
 * catches it, and only door 3 can: the verdict is passed on the runner, over the diff
 * of the PR, where there is no local hook to skip. What stays open with door 3 in
 * place is said here rather than left to be discovered: the step judges by the
 * `role:` line of the PR DESCRIPTION, which the author writes themselves. A MISSING
 * line is therefore a refusal and never a skip (otherwise the guard is walked around
 * by deleting one line), but a line naming SOMEBODY ELSE'S role is caught by a reader
 * and not by the guard. The threat model — a forgetful agent, not a malicious one —
 * is what makes that last gap acceptable.
 *
 * THE DEFAULT, ASKED FOR EXPLICITLY IN THE STATEMENT OF WORK: a role with no
 * `zones`, or with an empty `forbidden`, is restricted by NOTHING — the whole tree.
 * `writes` is a POSITIVE statement of where the role's work lives, not a closed
 * allow-list, and it is deliberately not read as one: `dev-core` declares
 * `writes: []` (its home is "everything except the speech service"), and reading
 * an empty list as an allow-list would deny it every file in the repository.
 * `forbidden` is the only field that bans, which also keeps one fact in one place —
 * "what is banned" is not spread across two lists that can disagree. THE PRICE, said
 * out loud so it is not read as a guarantee later: after this package `writes` is
 * still prose with no code consumer — the only field any of the three doors enforces
 * is `forbidden`.
 *
 * ENTRIES ARE REPOSITORY-RELATIVE PATH PREFIXES, files or directories alike
 * (`apps`, `apps/pronunciation-service`, `PROTOCOL.md`), and a prefix matches a path
 * only at a path SEPARATOR: `apps` bans `apps/x` and `apps` itself, never `appsx`.
 */

import type { Role } from "./schema.js";

/** The banned prefixes of a role, normalised: no leading `./`, no trailing slash, no duplicates. */
export const forbiddenPrefixes = (role: Role): readonly string[] => {
  const raw = role.zones?.forbidden ?? [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalised = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    if (normalised.length > 0) seen.add(normalised);
  }
  return [...seen];
};

/** Is this repository-relative path inside the prefix — as a file, or as anything under it. */
const underPrefix = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * The paths of `paths` that the role may not write. The whole verdict of doors 2 and
 * 3, and the reason they cannot disagree with each other or with door 1.
 *
 * The input is expected to be repository-relative (`git diff --name-only` gives
 * exactly that); a `./` prefix is tolerated because humans type it.
 */
export const pathsOutsideZones = (input: {
  readonly role: Role;
  readonly paths: readonly string[];
}): readonly string[] => {
  const prefixes = forbiddenPrefixes(input.role);
  if (prefixes.length === 0) return [];
  return input.paths
    .map((path) => path.replace(/^\.\//, ""))
    .filter((path) => prefixes.some((prefix) => underPrefix(path, prefix)));
};

/** Where doors 2 and 3 take their paths from: the index, or the range of a PR. */
export type ChangedPathsSource =
  | { readonly kind: "staged" }
  | { readonly kind: "range"; readonly base: string };

/**
 * THE GIT CALL THAT LISTS THE PATHS OF A CHANGE — one place, because the guard is
 * exactly as good as this list, and the first version of it walked past THREE ways of
 * touching a foreign zone (curator's findings, thread 020, each reproduced on a
 * synthetic repository before it was believed):
 *
 *  1. **A deletion was invisible.** `--diff-filter=ACMRT` has no `D` in it, so after
 *     `git rm apps/pronunciation-service/main.py` the list came back EMPTY and the
 *     commit passed. Deleting somebody else's file is exactly as easy to do by
 *     accident as creating one, so the filter is gone altogether: every status of a
 *     changed path is a path the change touched.
 *  2. **A rename OUT of a foreign zone was invisible.** With rename detection on,
 *     `git mv apps/pronunciation-service/main.py packages/foo/main.py` reports only
 *     the destination — which is in the role's OWN zone — and the banned source side
 *     never appears. `--no-renames` reports the change as a delete plus an add, and
 *     the delete is the half that matters.
 *  3. **A non-ASCII path was invisible.** With `core.quotePath` (on by default) git
 *     returns `"apps/pronunciation-service/\321\202\320\265\321\201\321\202.py"` —
 *     quoted and octal-escaped, so no prefix of ours matches it. `-z` turns the
 *     quoting off and separates records by NUL, which also survives a newline inside
 *     a filename; `core.quotePath=false` would fix only the case we happened to try.
 */
export const changedPathsGitArgs = (input: {
  readonly repo: string;
  readonly source: ChangedPathsSource;
}): string[] => [
  "-C",
  input.repo,
  "diff",
  ...(input.source.kind === "staged" ? ["--cached"] : []),
  "--name-only",
  "--no-renames",
  "-z",
  ...(input.source.kind === "range" ? [`${input.source.base}...HEAD`] : []),
];

/** The NUL-separated output of the call above as paths — the trailing NUL is not a path. */
export const parseChangedPaths = (raw: string): readonly string[] =>
  raw
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/**
 * `Edit(<path>)` IS THE WHOLE VOCABULARY OF A FILE DENY RULE, and this is the tool's
 * rule rather than our choice: an `Edit` path rule covers every file-editing tool
 * (`Write` and `NotebookEdit` included), while `Write(<path>)` is not matched by the
 * file permission check at all. The live probe of 2026-07-27 said so in as many
 * words — "Write(apps/**) is not matched by file permission checks — only Edit(path)
 * rules are" — and the write it was meant to stop was stopped by the `Edit` rule
 * beside it. Emitting the other two would be a warning on every launch and a rule
 * that does nothing.
 *
 * `Read` is deliberately not denied: the zone says who may WRITE, and a role that
 * cannot read the neighbouring app cannot understand the interface it is calling.
 */
const writingTools = ["Edit"] as const;

/**
 * THE DENY RULES A SESSION OF THIS ROLE IS RAISED WITH (door 1). Two patterns per
 * banned prefix per writing tool: the bare entry (the prefix is a file) and the
 * subtree (`/**`, the prefix is a directory) — the config does not distinguish the
 * two and it must not have to, since `zones` is written by a human describing a
 * boundary, not a filesystem.
 *
 * The patterns are gitignore-style and relative, which in this tool's permission
 * vocabulary means "against the project directory" — and the project directory of a
 * raised session is its workspace (R17), i.e. the repository root the `zones`
 * entries are already written against. No absolute paths: they would pin the rules
 * to one machine's layout, and the config travels with git.
 *
 * An empty result means "say nothing at all" rather than "an empty deny list" — the
 * caller passes no settings, so a role without zones is raised exactly as before.
 */
export const zoneDenyRules = (role: Role): readonly string[] =>
  forbiddenPrefixes(role).flatMap((prefix) =>
    writingTools.flatMap((tool) => [`${tool}(${prefix})`, `${tool}(${prefix}/**)`]),
  );

/**
 * The settings object handed to the launch, or `undefined` when the role has no
 * zones to enforce. Its shape is the tool's (`permissions.deny`), and it is the only
 * place in this package that knows it — the same containment as `--effort` in the
 * launch schema.
 */
export const zoneSettings = (
  role: Role,
): { readonly permissions: { readonly deny: readonly string[] } } | undefined =>
  denySettings(zoneDenyRules(role));

/**
 * The same object from rules already computed — what the launch calls, so that the
 * shape of the tool's settings is stated once, here, and not a second time in the
 * argv builder.
 */
export const denySettings = (
  deny: readonly string[],
): { readonly permissions: { readonly deny: readonly string[] } } | undefined =>
  deny.length === 0 ? undefined : { permissions: { deny } };

/** One line for the launch output: what the raised session is not allowed to write. */
export const describeZones = (role: Role): string => {
  const prefixes = forbiddenPrefixes(role);
  return prefixes.length === 0
    ? `${role.id}: zones — no write ban (the whole tree)`
    : `${role.id}: zones — writes denied under ${prefixes.join(", ")}`;
};
