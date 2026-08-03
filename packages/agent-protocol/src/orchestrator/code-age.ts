/**
 * HOW OLD THE CODE IN THE LIVE DAEMON IS (023.2, curator's statement of work of
 * 2026-08-03, variant (1) — "only speak").
 *
 * WHAT WAS MEASURED, and why the defect is sharper than "the daemon got old". The
 * daemon RE-READS ITS CONFIG at `--ref` every tick — the priorities, the directives,
 * the zones are always fresh — while its CODE is loaded once, by node, at start. On
 * 2026-08-03 that gap was six hours wide: the process raised at 05:13Z carried modules
 * from `a830761a`, the lift of a `run:` park landed in `main` at 11:15Z, and two pairs
 * stood silently for hours behind a park the code in memory had no idea how to lift.
 * Both stalls of that day were read as two defects of a predicate; there was one, and
 * it was this. The norm and its execution diverged WITHOUT A WORD, and from the outside
 * that is indistinguishable from "there is nothing to raise".
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT. It speaks: a line in the daemon's
 * stream beside the skips, a line in the operator's frame. It does not refuse to raise
 * pairs on a divergence and it does not restart anything — those are variants (2) and
 * (3) of the statement of work, they change what the circuit COSTS and they need a
 * conversation about live sessions that has not happened. The cheapest cure for silence
 * is that it stops being silence.
 *
 * FACTS, NOT ADVICE (curator, explicitly). The line names the SHA the process loaded,
 * the SHA of the ref it judges by, how many commits lie between them and since when the
 * process has been up. It does not print the command to restart: an operator reading
 * "17 commits behind, up since 05:13Z" knows what to do, and a line that ends in advice
 * is a line that gets skimmed.
 *
 * SILENCE ON A MATCH, and that is load-bearing rather than tidy: a line every thirty
 * seconds saying the code is current would be the noise that teaches its reader to skip
 * the section — which is precisely how this class of failure hides.
 *
 * NO NETWORK. The comparison is against `origin/<ref>` AS IT LIES ON DISK, never a
 * fetch: this is read by a frame that redraws every two seconds and by a tick that has
 * exactly one network read already. A ref that is itself stale on disk is the same
 * class of fault, and the frame already shows the age of what was pulled.
 */
import { execFileSync } from "node:child_process";

/** What a process loaded, and when — the half of the comparison that cannot be re-read. */
export type CodeVintage = {
  /** HEAD of the checkout the modules were resolved from, at the moment of loading. */
  readonly sha: string;
  /** That checkout — a box may hold several, and which one ran is the first question. */
  readonly checkout: string;
  /** When the process came up. UTC ISO to the second. */
  readonly startedAt: string;
  /**
   * WHOSE VINTAGE THIS IS. The file outlives the process that wrote it, and a reader
   * that takes it for the live daemon's would answer the staleness question about a
   * process that is gone — in the one direction that hurts: a daemon raised from a
   * checkout too old to publish anything at all leaves the newer predecessor's file in
   * place, and the frame would call the code current and say NOTHING. That is the exact
   * silence this module exists to end, so the vintage carries its owner and the reader
   * checks it against the live pid.
   */
  readonly pid: number;
};

/** A vintage that is behind the ref the same process judges by. */
export type CodeDrift = {
  readonly vintage: CodeVintage;
  /** The ref as it was named on the command line (`origin/main`), for a legible line. */
  readonly ref: string;
  /** What that ref resolves to ON DISK right now. */
  readonly refSha: string;
  /** Commits on the ref that the loaded code does not have; absent when uncountable. */
  readonly behind?: number;
};

/** The whole answer of a reading, including the case where there is no answer. */
export type CodeReading =
  | { readonly kind: "match" }
  | { readonly kind: "drift"; readonly drift: CodeDrift }
  | { readonly kind: "unknown"; readonly problem: string };

const git = (root: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/**
 * WHAT THIS PROCESS IS RUNNING, asked of git rather than of a build stamp: the package
 * is TypeScript executed from a checkout, so "which code is this" is a question about a
 * working tree, and the honest answer is its HEAD.
 *
 * `dir` is a directory inside the checkout the modules came from — the caller passes the
 * directory of its own module file, which is the only thing that cannot lie about where
 * node loaded from. A directory that is no repository is not an error to throw over: a
 * copy installed without git is a legitimate state to REPORT ("staleness cannot be
 * judged"), and a daemon must not refuse to start over a diagnostic.
 */
export const readCodeVintage = (input: {
  readonly dir: string;
  readonly startedAt: Date;
  readonly pid: number;
}): CodeVintage | { readonly problem: string } => {
  try {
    return {
      sha: git(input.dir, ["rev-parse", "HEAD"]),
      checkout: git(input.dir, ["rev-parse", "--show-toplevel"]),
      startedAt: input.startedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      pid: input.pid,
    };
  } catch (error) {
    return { problem: (error as Error).message };
  }
};

/** A vintage or a problem — the discriminator, so callers never test for a field. */
export const isVintage = (read: CodeVintage | { readonly problem: string }): read is CodeVintage =>
  "sha" in read;

/**
 * THE VERDICT, PURE — the whole rule in one comparison, so the test of the class is a
 * test of a function rather than of a daemon: same SHA, no line; different SHA, a line
 * carrying both and the distance between them.
 */
export const codeReading = (input: {
  readonly vintage: CodeVintage;
  readonly ref: string;
  readonly refSha: string;
  readonly behind?: number;
}): CodeReading =>
  input.vintage.sha === input.refSha
    ? { kind: "match" }
    : {
        kind: "drift",
        drift: {
          vintage: input.vintage,
          ref: input.ref,
          refSha: input.refSha,
          ...(input.behind === undefined ? {} : { behind: input.behind }),
        },
      };

/**
 * The same verdict with the two git reads in front of it, both on disk. The ref is
 * resolved IN THE CODE'S OWN CHECKOUT: the question is "is what this process loaded
 * behind the ref it judges by", and both halves of that are facts of the tree the
 * modules came from.
 */
export const measureCodeDrift = (input: {
  readonly vintage: CodeVintage;
  readonly ref: string;
}): CodeReading => {
  let refSha: string;
  try {
    refSha = git(input.vintage.checkout, ["rev-parse", `${input.ref}^{commit}`]);
  } catch (error) {
    return { kind: "unknown", problem: (error as Error).message };
  }
  let behind: number | undefined;
  try {
    const counted = Number(
      git(input.vintage.checkout, ["rev-list", "--count", `${input.vintage.sha}..${refSha}`]),
    );
    behind = Number.isInteger(counted) ? counted : undefined;
  } catch {
    // The distance is a convenience; the two SHAs are the fact. A shallow clone or a
    // dropped object costs the number and nothing else.
    behind = undefined;
  }
  return codeReading({
    vintage: input.vintage,
    ref: input.ref,
    refSha,
    ...(behind === undefined ? {} : { behind }),
  });
};

/** Short enough to read in a stream, long enough to paste into `git show`. */
const short = (sha: string): string => sha.slice(0, 8);

/** Whole minutes, then hours — an age a human reads rather than counts. */
const ageWords = (seconds: number): string =>
  seconds < 5400 ? `${Math.max(0, Math.round(seconds / 60))}m` : `${Math.round(seconds / 3600)}h`;

/**
 * THE LINE. Four facts in the order they are asked for: what is running, what is
 * current, how far apart they are, and how long it has been that way.
 */
export const describeCodeDrift = (drift: CodeDrift, now: Date): string => {
  const upFor = Math.round((now.getTime() - new Date(drift.vintage.startedAt).getTime()) / 1000);
  const distance =
    drift.behind === undefined ? "distance uncountable" : `${drift.behind} commit(s) behind`;
  return `the LOADED CODE is not the ref: this process runs ${short(drift.vintage.sha)} from ${drift.vintage.checkout}, ${drift.ref} on disk is ${short(drift.refSha)} — ${distance}; up since ${drift.vintage.startedAt} (${ageWords(upFor)}), and node loads modules once`;
};

/**
 * THE VINTAGE ON DISK, and why it has to be there at all. The frame is drawn by a
 * READER — `status` in somebody's terminal — and a reader's own modules are its own:
 * asked about staleness it would answer about itself, which is the one answer nobody
 * needs. So the daemon publishes what IT loaded, in the state directory beside its pid,
 * and the frame reads that. One small file, overwritten at every start, disposable:
 * losing it costs one line of a picture, never a decision.
 */
export const renderCodeVintage = (vintage: CodeVintage): string => `${JSON.stringify(vintage)}\n`;

export const parseCodeVintage = (raw: string): CodeVintage | undefined => {
  const text = raw.trim();
  if (text === "") return undefined;
  try {
    const value = JSON.parse(text) as Partial<CodeVintage>;
    if (
      typeof value.sha !== "string" ||
      typeof value.checkout !== "string" ||
      typeof value.startedAt !== "string" ||
      typeof value.pid !== "number"
    )
      return undefined;
    return {
      sha: value.sha,
      checkout: value.checkout,
      startedAt: value.startedAt,
      pid: value.pid,
    };
  } catch {
    return undefined;
  }
};

/** The startup half: what was loaded, said once, whether or not it is behind anything. */
export const describeCodeVintage = (vintage: CodeVintage): string =>
  `code: ${short(vintage.sha)} loaded from ${vintage.checkout}, up since ${vintage.startedAt}`;

/**
 * WHAT THE FRAME HAS TO SAY ABOUT THE LIVE DAEMON'S CODE — four states, and only ONE of
 * them is silence. That ratio is the whole design: every way of not knowing is a word.
 *
 * `drift` and silence (`undefined`) are the pair the statement of work asked for. The
 * third, `unpublished`, exists because the vintage file OUTLIVES the process that wrote
 * it, and the failure that follows is not symmetric: a daemon raised from a checkout so
 * old it has no idea this check exists publishes NOTHING, leaves a newer predecessor's
 * file lying in the state directory, and a reader that trusted that file would compare
 * the ref against code nobody is running — and, the predecessor being newer, would find
 * a MATCH and say nothing at all. Silence about a stale daemon is the exact thing of
 * 2026-08-03. So the reader takes a vintage only from the process that is alive, and
 * when the live one published none it says so instead of going quiet.
 *
 * The fourth, `unreadable`, is the reviewer's finding on #190 and the same class caught
 * one layer lower: a reading of `kind: "unknown"` — the ref does not resolve on disk, a
 * fetch that never happened, a typo in `--ref`, a state directory that went away — used
 * to collapse into the SAME `undefined` as a match. The daemon's stream said the fact
 * out loud while the frame drew nothing, so the two disagreed about the one subject this
 * module exists to keep them honest about; `renderCodeAge` and the tick now speak the
 * same sentence from `describeUnreadableCodeAge`, which is what makes that guarantee
 * structural rather than a promise in a comment.
 */
export type CodeAgeView =
  | { readonly kind: "drift"; readonly drift: CodeDrift }
  | { readonly kind: "unpublished"; readonly pid: number }
  | { readonly kind: "unreadable"; readonly problem: string };

/**
 * THE READER'S WHOLE RULE, pure and testable away from a frame: who is alive, what lies
 * on disk, and what the ref says. `measure` is passed in so the git reads stay at the
 * caller — the rule itself touches nothing.
 */
export const codeAgeView = (input: {
  /** The live daemon, or nothing when there is none — then the circuit section speaks. */
  readonly daemonPid: number | undefined;
  /** What was found in the state directory, if anything readable was. */
  readonly published: CodeVintage | undefined;
  readonly measure: (vintage: CodeVintage) => CodeReading;
}): CodeAgeView | undefined => {
  if (input.daemonPid === undefined) return undefined;
  if (input.published === undefined || input.published.pid !== input.daemonPid)
    return { kind: "unpublished", pid: input.daemonPid };
  const reading = input.measure(input.published);
  if (reading.kind === "drift") return { kind: "drift", drift: reading.drift };
  // "Unknown" is not "current": the measurement did not happen, and the only state that
  // earns silence is the one where it happened and came back clean.
  if (reading.kind === "unknown") return { kind: "unreadable", problem: reading.problem };
  return undefined;
};

/**
 * THE LINE FOR THE THIRD STATE, and it names the fact rather than the guess: the live
 * pid, and that nothing was published under it. Why nothing was is not knowable from
 * here — code older than this check, a state directory that is not writable, a process
 * seconds from writing it — and a line that picked one of those would be inventing.
 */
export const describeUnpublishedCode = (pid: number): string =>
  `the live daemon (pid ${pid}) published no vintage of its loaded code — its staleness cannot be judged from here; a process older than this check publishes none`;

/**
 * THE LINE FOR THE FOURTH STATE, and it is ONE function on purpose: the tick prints it
 * into the daemon's stream and `renderCodeAge` prints it into the frame, so "the stream
 * and the frame cannot say different things" is enforced by there being one sentence
 * rather than two that were written to match. The problem is git's own words, collapsed
 * to a single line — a frame row is a row, and a multi-line error pasted into it breaks
 * the picture it was meant to explain.
 */
export const describeUnreadableCodeAge = (problem: string): string =>
  `the age of the loaded code is unreadable: ${problem.replace(/\s+/g, " ").trim()}`;
