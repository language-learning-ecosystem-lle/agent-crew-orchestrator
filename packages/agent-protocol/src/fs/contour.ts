/**
 * THE CONTOUR BOUNDARY — a role writes into ITS OWN repository and nowhere else
 * (thread `062-contour-boundary`, john's requirement of 2026-08-30 17:07Z: "a role
 * MUST NOT BE ABLE to write into another circuit", not "must not do it").
 *
 * WHAT HAPPENED. Twice in one hour a session of THIS circuit made a temporary
 * checkout of the `language-learning-ecosystem` repository and opened a pull request
 * there (#453, #454 — both closed by john). In a foreign repository a role has none
 * of what bounds it here: no zones (`zones check` judges paths in ITS OWN tree), no
 * card, no review round of its own, no power-document guard, no trace in the right
 * feed. Every one of those doors rests on the silent assumption "the role works in
 * its own tree", and nothing checked it.
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT. It is measure (1) of the thread: the door
 * inside the package's own commands. It catches the honest mistake and it says the
 * name of what it caught. It is NOT the load-bearing measure — that one is the
 * per-circuit token (john, 17:55–18:00Z: `hetzner` now carries a token scoped to this
 * repository alone, so `gh` in the foreign repository answers 404 from the platform).
 * A door in our own code is bypassed by any `git`/`gh` call made beside the package,
 * and this file does not pretend otherwise.
 *
 * THE TWO CLAUSES, and each refuses BY NAME (discipline 4):
 *
 *  · **the ground** — the tree the command was invoked FROM must belong to a circuit
 *    this box declares. A session standing in `/tmp/some-clone` is refused before any
 *    question about the target, because a checkout no instance claims is a checkout
 *    the whole system of zones and cards knows nothing about;
 *  · **the target** — the tree the command is ABOUT (`--repo`) must be the same
 *    repository as the ground's circuit: same `origin`, or — when the target declares
 *    no `origin` at all — inside the circuit's declared checkout.
 *
 * WHY `origin` AND NOT A NAME IN THE CONFIG. The repository config declares instances
 * but not their GitHub repository, and adding a field there is a power document, i.e.
 * john's button. `origin` is a fact of the tree, needs nobody's permission to read,
 * and is exactly what the operator would compare by hand.
 *
 * WHEN THE BOX DECLARES NOTHING the door does not invent a boundary: it says so in a
 * note and falls back to comparing the target against the ground's own `origin`. A
 * silent pass would be worse than no door; a refusal on a box that has not been
 * commissioned yet would break `init` for everyone.
 */
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { type LocalConfig, listInstanceConfigs, parseLocalConfig } from "../config/local.js";
import { execFileSyncByExit } from "./exec-sync.js";

/** A circuit declared on this box: the name of its machine config and the checkout it claims. */
export type DeclaredCircuit = {
  readonly name: string;
  /** Absent when the machine config declares no `repo` — such an instance claims no tree. */
  readonly repo?: string | undefined;
};

export type ContourReaders = {
  /** `origin` of a tree, or `undefined` when the tree has no remote / is not a repository. */
  readonly originOf: (tree: string) => string | undefined;
  /** The circuits this box declares, in the order their configs are listed. */
  readonly circuits: () => readonly DeclaredCircuit[];
};

export type ContourVerdict =
  | { readonly ok: true; readonly note: string }
  | { readonly ok: false; readonly refusal: string };

/**
 * THE SAME REPOSITORY WRITTEN FOUR WAYS IS ONE REPOSITORY. `git@github.com:o/r.git`,
 * `https://github.com/o/r.git`, `ssh://git@github.com/o/r` and a trailing slash are
 * all the same remote; comparing them raw would refuse a role its own tree, which is
 * a worse failure than the one this file exists to prevent.
 *
 * A path (a local clone, and every test fixture) is normalised as a path — resolved,
 * never lower-cased, because a filesystem may be case-sensitive and two directories
 * differing in case are two directories.
 */
export const normalizeOrigin = (url: string): string => {
  const trimmed = url.trim();
  if (trimmed === "") return "";
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(trimmed);
  const url_ = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const parts = url_ ?? scp;
  if (parts === null) return resolve(trimmed);
  const host = (parts[1] ?? "").toLowerCase();
  const path = (parts[2] ?? "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return `${host}/${path}`;
};

const contains = (parent: string, child: string): boolean => {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/** `origin` as git reports it — silence (not an exception) when there is no remote to report. */
export const originOfTree = (tree: string, env?: NodeJS.ProcessEnv): string | undefined => {
  try {
    const url = execFileSyncByExit("git", ["-C", tree, "remote", "get-url", "origin"], {
      ...(env === undefined ? {} : { env }),
    }).trim();
    return url === "" ? undefined : url;
  } catch {
    return undefined;
  }
};

/** The circuits of this box, read from the named machine configs. A broken sibling is skipped, not fatal. */
export const declaredCircuits = (
  env: NodeJS.ProcessEnv = process.env,
): readonly DeclaredCircuit[] => {
  const circuits: DeclaredCircuit[] = [];
  for (const candidate of listInstanceConfigs(env)) {
    let config: LocalConfig;
    try {
      config = parseLocalConfig(JSON.parse(readFileSync(candidate.path, "utf8")), candidate.path);
    } catch {
      // A machine config that does not parse claims no tree. `resolveLocalConfig` is the
      // place that NAMES such a sibling; naming it twice, in a door about something else,
      // would bury the clause that actually refused.
      continue;
    }
    circuits.push({
      name: candidate.name,
      ...(config.repo === undefined ? {} : { repo: config.repo }),
    });
  }
  return circuits;
};

export const contourReaders = (env: NodeJS.ProcessEnv = process.env): ContourReaders => ({
  originOf: (tree) => originOfTree(tree, env),
  circuits: () => declaredCircuits(env),
});

/**
 * THE VERDICT. `ground` is the tree the command was invoked from (the session's
 * workspace), `target` is the tree the command is about (`--repo` and its default).
 */
export const checkContour = (input: {
  readonly ground: string;
  readonly target: string;
  readonly readers: ContourReaders;
}): ContourVerdict => {
  const { ground, target, readers } = input;
  const claiming = readers.circuits().filter((circuit) => circuit.repo !== undefined);

  // CLAUSE 1 — THE GROUND. Which circuit of this box owns the tree we are standing in.
  // The longest claim wins, for the reason `resolveLocalConfig` gives: a checkout nested
  // under another is the more specific answer.
  const home = claiming
    .filter((circuit) => contains(circuit.repo as string, ground))
    .sort((a, b) => resolve(b.repo as string).length - resolve(a.repo as string).length)[0];

  if (claiming.length > 0 && home === undefined) {
    return {
      ok: false,
      refusal: `'${ground}' belongs to no circuit declared on this box (${claiming
        .map((circuit) => `'${circuit.name}' → ${circuit.repo}`)
        .join(
          ", ",
        )}) — a role works in the checkout its own instance declares, and a command run from a tree nobody claims carries none of the doors that bound it (zones, cards, the review round of its own repository)`,
    };
  }

  // The circuit's identity, and the words the refusal will use for it.
  const anchor = home?.repo ?? ground;
  const whose =
    home === undefined ? `the invoking tree '${ground}'` : `circuit '${home.name}' (${home.repo})`;
  const mine = readers.originOf(anchor);
  const theirs = readers.originOf(target);

  const note =
    claiming.length === 0
      ? `contour: this box declares no instance with 'repo' — the boundary is read from the invoking tree '${ground}'`
      : `contour: ${whose}`;

  // CLAUSE 2 — THE TARGET.
  if (mine !== undefined && theirs !== undefined) {
    return normalizeOrigin(mine) === normalizeOrigin(theirs)
      ? { ok: true, note: `${note}, target ${normalizeOrigin(theirs)}` }
      : {
          ok: false,
          refusal: `'${target}' belongs to another circuit: its origin is ${theirs}, while ${whose} is ${mine} — a role writes only into its own repository. What has to be said in another circuit goes through the role OF THAT circuit (thread 062, john 2026-08-30)`,
        };
  }

  if (theirs === undefined) {
    // No `origin` to compare — the target is judged by where it lies. A scratch clone
    // outside the circuit's checkout is exactly the shape both closed pull requests had.
    return contains(anchor, target)
      ? { ok: true, note: `${note}, target inside it (no 'origin' to compare)` }
      : {
          ok: false,
          refusal: `'${target}' declares no 'origin' and lies outside ${whose} — this command will not act on a tree whose circuit cannot be established (thread 062)`,
        };
  }

  // The ground has no `origin` while the target has one: nothing to compare against, and
  // inventing a boundary here would refuse a fresh clone its first legitimate command.
  return {
    ok: true,
    note: `${note} declares no 'origin' — the boundary of '${target}' was not checked`,
  };
};
