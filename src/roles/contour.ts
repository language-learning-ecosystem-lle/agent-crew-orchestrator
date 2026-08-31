/**
 * THE BOUNDARY OF THE CONTOUR — the tree a command is pointed at must belong to the
 * SAME circuit as the session that typed it (thread 062).
 *
 * Every restraint this package puts on a role is computed inside the role's own
 * repository: `zones check` judges paths of THIS checkout, the merge gate reads THIS
 * repository's power documents, the review round is THIS repository's workflow, the
 * feed is THIS circuit's mail. All of it rests on one assumption that nothing ever
 * checked — «the role works in its own tree». On 2026-08-30 the assumption turned out
 * to be false twice in one hour: a session of the `agent-crew-orchestrator` circuit
 * made a temporary checkout of `language-learning-ecosystem` and opened PRs #453 and
 * #454 there — in a repository where it has no zones, no card, no review round and no
 * trace in the right feed. Nothing refused, because nothing was asked.
 *
 * This module is the asking. It answers ONE question — «does this tree belong to the
 * contour the command came from» — and it answers it from facts that already exist on
 * the box: the named instance configs, each of which declares the `repo` of one
 * circuit (`config/local.ts`), and the `origin` of the trees themselves.
 *
 * IT IS ASKED IN TWO HALVES, AND THEY ARE NOT ASKED AT THE SAME MOMENTS. The GROUND
 * (`judgeGround`) is about the tree the command was TYPED IN, needs no target and is
 * therefore asked on EVERY command that resolves a repository at all — with `--repo`
 * or without it. The TARGET (`judgeContour`) is about the tree a command was POINTED
 * AT and only exists when `--repo` names one. The split is the reviewer's finding on
 * PR #160: while the ground was reachable only through the target, `merge-gate --ref
 * origin/main --pr N` — the form written in `REVIEWER.md`, without `--repo` — asked
 * nothing at all, so a session in a foreign checkout passed silently. A door that is
 * only asked when the caller volunteers a flag is not a door (discipline 4).
 *
 * WHAT IT IS NOT. It is not the load-bearing measure and must not be read as one: a
 * conscious `git clone` plus `gh pr create` never passes through this package, so a
 * door here is bypassed by not using the door. The load-bearing measure is a token
 * scoped to one repository (john, 2026-08-30 ~18:00Z: the `hetzner` contour has one,
 * and `gh api` on the foreign repository answers `404` — the platform refuses, not
 * our conscience). This door catches the HONEST mistake and, when it refuses, says by
 * name which contour the tree belongs to and who is supposed to act there instead.
 *
 * WHY IT FAILS OPEN WHEN IT CANNOT TELL. A box with no named instances (a fresh
 * clone, a sandbox, someone's laptop) declares no contours at all — there is no
 * boundary to cross, and refusing there would break `init`/`doctor` on exactly the
 * box that has nothing set up yet. So «cannot tell» is a NAMED verdict of its own
 * (`unknown`, carrying its reason), never a silent pass and never a refusal.
 */

import { resolve, sep } from "node:path";

/** Facts the judgement is computed from — all of them, no I/O inside the judge. */
export type ContourInput = {
  /** The tree the command is about (`--repo`, or the checkout it was typed in). */
  readonly target: string;
  /** Which contour claims `target` — an instance name, or nothing if none does. */
  readonly targetContour?: string | undefined;
  /** `origin` of `target`, as git prints it; absent when the tree has no remote. */
  readonly targetRemote?: string | undefined;
  /** The contour the command CAME FROM — the instance claiming the caller's tree. */
  readonly ownContour?: string | undefined;
  /** The checkout that contour declares (`repo` of its instance config). */
  readonly ownRepo?: string | undefined;
  /** `origin` of `ownRepo`. */
  readonly ownRemote?: string | undefined;
  /**
   * THE CONTOURS THIS BOX DECLARES AT ALL — the names of its instance configs that
   * carry a `repo`. It is what separates "there is no boundary here" (a fresh clone,
   * a runner, a laptop: the list is empty) from "there is one and the caller is
   * standing outside all of it" (the list is not empty and no entry claims the
   * caller's tree). Without it both read as `unknown`, and the second case is the
   * very shape of #453/#454: a session working from a checkout made in `/tmp`.
   */
  readonly boxContours?: readonly string[] | undefined;
};

export type ContourVerdict =
  /** The tree is this contour's own — the command may proceed. */
  | { readonly verdict: "own"; readonly because: string }
  /** The tree belongs to another circuit — refuse, with the reason to print. */
  | { readonly verdict: "foreign"; readonly refusal: string }
  /** No boundary is declared here, or the facts do not decide — proceed, and say so. */
  | { readonly verdict: "unknown"; readonly because: string };

/**
 * THE IDENTITY OF A REMOTE, so that two spellings of one repository do not read as
 * two repositories. `https://github.com/o/n.git`, `git@github.com:o/n` and
 * `ssh://git@github.com:22/o/n/` are the same circuit and must compare equal;
 * anything unparseable is returned trimmed rather than dropped, because a string we
 * cannot decompose is still a string two trees can disagree about.
 */
export const remoteIdentity = (url: string | undefined): string | undefined => {
  const raw = url?.trim();
  if (raw === undefined || raw === "") return undefined;
  const strip = (path: string): string => path.replace(/\/+$/, "").replace(/\.git$/i, "");
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(raw);
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(raw);
  const parts =
    scheme !== null
      ? { host: scheme[1] ?? "", path: scheme[2] ?? "" }
      : scp !== null && !raw.startsWith("/") && !raw.startsWith(".")
        ? { host: scp[1] ?? "", path: scp[2] ?? "" }
        : undefined;
  // A local path (or anything else) is its own identity: no host to normalise away.
  if (parts === undefined) return strip(raw);
  return `${parts.host.replace(/:\d+$/, "").toLowerCase()}/${strip(parts.path).toLowerCase()}`;
};

/** Is `child` the path `parent`, or anything under it — so a worktree answers as its home. */
const inside = (parent: string, child: string): boolean => {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/** Facts about the tree a command was TYPED IN — the ground, judged without a target. */
export type GroundInput = {
  /** The tree the command came from (the caller's working directory's repository). */
  readonly at: string;
  /** Which contour claims `at` — an instance name, or nothing if none does. */
  readonly ownContour?: string | undefined;
  /** THE CONTOURS THIS BOX DECLARES AT ALL — see `ContourInput.boxContours`. */
  readonly boxContours?: readonly string[] | undefined;
};

/**
 * THE GROUND — and it is judged with no target in hand, which is the whole reason it
 * is its own function. A box that declares contours and claims the caller's tree with
 * NONE of them is not a box without a boundary: it is a session standing outside every
 * boundary it has, which is exactly what a temporary checkout in `/tmp` is (#453/#454).
 * Refusing there costs the honest case nothing — a role works in the workspace its own
 * instance declares (R17) — and it costs the dishonest case the first command it types,
 * whether or not that command was kind enough to name `--repo`.
 */
export const judgeGround = (input: GroundInput): ContourVerdict => {
  if (input.ownContour !== undefined) {
    return {
      verdict: "own",
      because: `'${input.at}' is claimed by contour '${input.ownContour}' of this box`,
    };
  }
  const declared = input.boxContours ?? [];
  if (declared.length > 0) {
    return {
      verdict: "foreign",
      refusal: `this command was typed in a tree that belongs to no contour of this box (declared: ${declared
        .map((name) => `'${name}'`)
        .join(
          ", ",
        )}) — outside its own checkout a role carries none of what bounds it (zones, its card, its review round, its feed), so nothing here can be judged. Work from the workspace of your own circuit (thread 062)`,
    };
  }
  return {
    verdict: "unknown",
    because: `no instance of this box claims the tree this command came from ('${input.at}'), and the box declares no contour at all, so there is no boundary here to cross`,
  };
};

/**
 * THE JUDGEMENT ABOUT THE TARGET. Pure: everything it knows is in `input`, so the
 * refusal it produces can be tested without a git tree, and the reading of git lives at
 * the call site. The ground comes first here too — a caller standing nowhere cannot be
 * asked about a destination — and it is the same `judgeGround` above, not a copy.
 *
 * The order of the tests is the order of certainty. The PATH decides first — a tree
 * inside the contour's own checkout is its own tree even when git cannot be asked at
 * all (a `.worktrees/<role>` workspace, R17). Only then the ORIGINS, which are what
 * catches the case that actually happened: a checkout made somewhere else entirely,
 * belonging to a repository this circuit does not serve.
 */
export const judgeContour = (input: ContourInput): ContourVerdict => {
  if (input.ownContour === undefined || input.ownRepo === undefined) {
    // A contour that names no checkout draws no boundary either, so the pair is judged
    // as a whole: `ownContour` without `ownRepo` reaches the ground as "nobody claims
    // the caller", which is what it means for a judgement made of paths and origins.
    return judgeGround({
      at: input.target,
      ...(input.boxContours === undefined ? {} : { boxContours: input.boxContours }),
    });
  }
  if (inside(input.ownRepo, input.target)) {
    return {
      verdict: "own",
      because: `'${input.target}' is inside the checkout of contour '${input.ownContour}' ('${input.ownRepo}')`,
    };
  }
  const own = remoteIdentity(input.ownRemote);
  const target = remoteIdentity(input.targetRemote);
  if (own !== undefined && target !== undefined && own === target) {
    return {
      verdict: "own",
      because: `'${input.target}' is a separate checkout of the same repository (${own}) as contour '${input.ownContour}'`,
    };
  }
  if (own !== undefined && target !== undefined) {
    // The name of the OTHER contour is worth having when this box declares it: it turns
    // "you may not" into "and here is whose role does it instead".
    const whose =
      input.targetContour === undefined
        ? `${target}`
        : `${target}, the checkout of contour '${input.targetContour}' on this box`;
    return {
      verdict: "foreign",
      refusal: `'${input.target}' belongs to another contour: its 'origin' is ${whose}, while this command came from contour '${input.ownContour}' (${own}). A role writes only inside its own circuit — what has to happen in another one is opened there by a role OF that circuit, through its feed, not from a checkout made here (thread 062)`,
    };
  }
  return {
    verdict: "unknown",
    because: `'${input.target}' is outside the checkout of contour '${input.ownContour}' and ${
      target === undefined
        ? "declares no 'origin'"
        : `the 'origin' of '${input.ownRepo}' could not be read`
    }, so the two cannot be compared — the boundary is not judged here`,
  };
};
