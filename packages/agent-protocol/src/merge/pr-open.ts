/**
 * THE DESCRIPTION OF A PULL REQUEST, JUDGED BEFORE THE PULL REQUEST EXISTS (thread
 * `052-pr-template`, john's decision of 2026-09-02 — variant (B), «ТРЕТИЙ С ПЕРВЫМ»).
 *
 * WHERE IT COMES FROM. The `thread:` and `role:` lines had drifted out of PR bodies, and
 * the first repair was a template (`.github/pull_request_template.md`, PR #134). The
 * measurement that followed said the template's premise holds only by halves: GitHub
 * substitutes a template into the INTERACTIVE paths only (`--web`, `--template <file>`),
 * and roles open pull requests with `gh pr create --body-file <p>`, where an explicit body
 * bypasses the placeholder entirely. So the template fixes the class of descriptions where
 * the defect was not, and does not touch the class where it was.
 *
 * AND THE TWO FIELDS FAIL DIFFERENTLY. `thread:` is protected by a LOUD refusal — guard 3
 * of the merge gate stops the merge without it. `role:` was read by nobody that refuses:
 * the CI and merge notifiers merely `grep` it, and when it is missing they simply do not
 * pass the turn on — silently. A silent failure is the worse of the two, which is what
 * john's decision closes: `role:` becomes as obligatory as `thread:`, checked at the
 * moment of OPENING (this file, the cheap and early half) and again at the merge (guard 3
 * in `gate.js`, the load-bearing half).
 *
 * WHAT THIS DOOR IS NOT — said here for the reason `roles/contour.ts` says its own: it
 * catches an HONEST mistake and is bypassed by not using it. `gh pr create` typed by hand
 * walks straight past it and always will. Nothing here is a substitute for guard 3; this
 * is the door that costs no runner minutes and answers before anything has been created.
 *
 * THE READERS ARE NOT COPIED HERE. `threadOfDescription` and `roleOfDescription` are the
 * door's own functions, imported — a second grammar for the same two lines is exactly the
 * class this package spends its existence avoiding (see `pr-template.test.ts`: what the
 * door accepts, every workflow `grep` must read).
 */

import { dirname, resolve } from "node:path";

import { roleOfDescription, threadOfDescription } from "./gate.js";

/** The form of the two lines, as one sentence — repeated by every refusal below. */
export const PR_FIELDS_FORM =
  "the first two lines of the description are `thread: NNN-slug` and `role: <id>`, before any prose";

export type PrDescriptionVerdict =
  | { readonly ok: true; readonly thread: string; readonly role: string }
  | { readonly ok: false; readonly refusals: readonly string[] };

/** Where a field's line stands in the body, 1-based — `undefined` when there is none. */
const lineOf = (lines: readonly string[], field: "thread" | "role"): number | undefined => {
  const at = lines.findIndex((line) => new RegExp(`^${field}\\s*:`, "i").test(line));
  return at === -1 ? undefined : at + 1;
};

/**
 * The body a role is about to open a pull request with — refused BY NAME, field by field.
 * `isKnownRole` is the config's own registry: a role that does not exist in the protocol
 * config is a turn nobody can be handed, and it is caught here rather than at the notifier.
 */
export const judgePrDescription = (input: {
  readonly body: string;
  readonly isKnownRole: (id: string) => boolean;
}): PrDescriptionVerdict => {
  const lines = input.body.split("\n");
  const refusals: string[] = [];

  const thread = threadOfDescription(input.body);
  const threadAt = lineOf(lines, "thread");
  if (thread === undefined) {
    refusals.push(
      threadAt === undefined
        ? "the description names no thread — no `thread: NNN-slug` line in it at all"
        : `line ${threadAt} looks like the thread line but does not read \`thread: <slug>\`: '${lines[threadAt - 1]}'`,
    );
  } else if (threadAt !== 1) {
    refusals.push(
      `\`thread:\` stands on line ${threadAt}, not on line 1 — in the footer it is found by nobody`,
    );
  }

  const role = roleOfDescription(input.body);
  const roleAt = lineOf(lines, "role");
  if (role === undefined) {
    refusals.push(
      roleAt === undefined
        ? "the description names no role — no `role: <id>` line in it at all, and it is what tells the notifiers whose turn it is after the run and after the merge"
        : // The placeholder of the template lands here, and deliberately: `role: <id>` is
          // not a role, it is the shape of one.
          `line ${roleAt} looks like the role line but does not read \`role: <id>\`, a lowercase id (\`[a-z][a-z0-9-]*\`): '${lines[roleAt - 1]}'`,
    );
  } else if (roleAt !== 2) {
    refusals.push(`\`role:\` stands on line ${roleAt}, not on line 2 — the two fields come first`);
  } else if (!input.isKnownRole(role)) {
    refusals.push(`role '${role}' is not listed in the protocol config`);
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, thread: thread as string, role: role as string };
};

/** Where the body file lies — the second door of `pr open`, and it judges no content. */
export type BodyLocationVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: string };

/**
 * THE BODY FILE LEFT INSIDE A CHECKOUT — the fault that freezes a whole box (thread
 * `157-pr-open-body-inside-checkout`, john's word of 2026-09-07: «ДВЕРЬ ОТДЕЛЬНЫМ
 * ПРЕДМЕТОМ»).
 *
 * WHAT IT COSTS, measured and not supposed. `.pr278-body.md` — the body of pull request
 * #278, written by a hand into the SERVED root on 2026-09-05 and left there. The box's
 * self-restart pulls with `git pull --ff-only`, that refuses over an untracked file, and
 * the circuit stopped updating: 13 commits behind and ≥23 hours on the first episode, a
 * second one still running two days later, and a hand of john's (`rm -f`) is what ended
 * it. The refusal of the daemon named the file verbatim and no door had stopped it being
 * written there — because the command that PRODUCES that artefact is this one.
 *
 * WHY THE CLASS WAS ALREADY KNOWN AND ONLY HALF-CLOSED. `deliver.ts` refuses over a dirty
 * mail checkout with the same sentence in it — «a body file left inside the checkout
 * counts, write it outside». That door sees ONE checkout of the three (the mail's own):
 * a body dropped into the role's worktree or into the served root is invisible to it, and
 * the served root is read by exactly one reader, the self-restart, whose reading is the
 * standstill above.
 *
 * WHAT IT JUDGES AND WHAT IT DOES NOT. It asks git where the file's DIRECTORY lives and
 * refuses if git answers with a checkout — any checkout, the served root, a role's linked
 * worktree, the mail's, or one nobody in this protocol knows about. The edges are named
 * rather than left to be discovered:
 *
 * - **the file does not exist** — this door is never reached: `pr open` reads the body
 *   first, and a path that cannot be read is refused as unreadable, by its own name;
 * - **a directory inside no repository at all** — `checkoutOf` answers nothing and the
 *   door stands aside. This is the normal path, and `mktemp -d -p /tmp` is on it;
 * - **a nested checkout** — `--show-toplevel` answers the INNERMOST one, and that is the
 *   right answer here: dirt in a nested checkout is dirt in a checkout;
 * - **symlinks** — not resolved by this function and not needed to be: `git -C <dir>`
 *   makes that directory its cwd, and git resolves cwd itself, so a path that reaches
 *   into a checkout through a link is answered with the checkout it really lands in;
 * - **`--body-file -`** is not a form this command has: the body is read from a file by
 *   name, and `-` would be looked for as a file literally called `-`;
 * - **`TMPDIR` inside the checkout** is the trap this refusal must not send the caller
 *   into — a session whose `TMPDIR` is a directory of the checkout gets a `mktemp -d`
 *   INSIDE the repository. Hence `-p /tmp` in the sentence, and not a bare `mktemp -d`.
 *   Measured in a raised session on 2026-09-07: `mktemp -d` → `/tmp/aco-<id>/tmp.XXXX`,
 *   which is a symlink into `<served root>/.orchestrator/sessions/<run>.tmp/`, and git
 *   answers `--show-toplevel` with the served root itself;
 * - **and a path git IGNORES is not refused** — that measurement is the reason. The fault
 *   is not «a file in a tree», it is «a file `git pull --ff-only` refuses to write over»,
 *   and git does not refuse over an ignored one. The session's own temp directory lives
 *   under `.orchestrator/`, which the served repository ignores as MACHINE state of the
 *   contour (john's decision in thread 153, §2) — so every role's habitual `mktemp -d`
 *   keeps working and this door stays silent on it. What it is NOT is a licence to ignore
 *   manual dirt: adding an entry to `.gitignore` for a body file is the repair john
 *   refused, and this door reads the ignores that already exist rather than inviting new
 *   ones. A role's linked worktree is the case that shows the difference — `.worktrees/`
 *   is ignored by the SERVED root, but inside the worktree, which is the innermost
 *   checkout and the one asked, nothing ignores it, so a body left there is refused;
 *
 * AND WHAT IT IS NOT — the same honesty `judgePrDescription` owes: it catches an honest
 * mistake and is walked past by typing `gh pr create` by hand, and it cannot see a file
 * put into a checkout AFTER it has answered. It is not a guarantee that no body file ever
 * lands in a tree; it is the refusal at the one place this package produces them.
 */
export const judgeBodyLocation = (input: {
  readonly path: string;
  /** `git -C <dir> rev-parse --show-toplevel`, or nothing when that is not a checkout. */
  readonly checkoutOf: (dir: string) => string | undefined;
  /** `git -C <dir> check-ignore` on the file — asked ONLY when it is inside a checkout. */
  readonly isIgnored: (dir: string, path: string) => boolean;
}): BodyLocationVerdict => {
  const dir = dirname(resolve(input.path));
  const checkout = input.checkoutOf(dir);
  if (checkout === undefined || checkout === "") return { ok: true };
  if (input.isIgnored(dir, resolve(input.path))) return { ok: true };
  return {
    ok: false,
    refusal:
      `the body file '${input.path}' lies inside the git checkout '${checkout}' — write it OUTSIDE any checkout, ` +
      "in a directory of its own: `mktemp -d -p /tmp` (with `-p /tmp` on purpose — a session's own `TMPDIR` can itself be inside the checkout). " +
      "A body file left in a tree is untracked dirt that nothing ignores, and the box's self-restart runs `git pull --ff-only`, which refuses over it: " +
      "the circuit then stops updating until a hand removes the file — 13 commits and ≥23 hours the first time this was measured (thread 153). " +
      "Nothing was created: move the file and run this again",
  };
};
