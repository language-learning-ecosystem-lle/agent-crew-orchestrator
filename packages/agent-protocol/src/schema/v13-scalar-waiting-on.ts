/**
 * MIGRATION 12 → 13: `waiting-on` is a SCALAR — the turn is held by exactly one
 * (decision john, 2026-07-27; thread `024-scalar-waiting-on`).
 *
 * WHAT WAS WRONG WITH A SET. The field is written WHOLE, not as a delta — so the
 * answerer restates everybody's waiting, including the part that is not theirs. A
 * thread awaited `dev-core, john`; dev-core replied `waiting-on: curator`, and john's
 * unclosed turn disappeared from the index without anyone deciding it should. The
 * cases that looked like two independent waits were examined and rejected: the feed's
 * queue is strictly sequential (dev → reviewer → dev → … → curator), and "who owes
 * what" in parallel is a board of tasks with owners, not the tact of a conversation.
 * As a scalar it also closes the double-raise the parallel daemon could do on one
 * thread: there is nobody to raise second.
 *
 * WHAT THE STEP REWRITES. Every message header in the mail whose `waiting-on` names
 * more than one role keeps the FIRST and drops the rest, and every such file is named
 * in the plan — the reduction is mechanical, the review of it is not (the PR lists
 * each case, per the statement). First, because in a sequential queue the role written
 * first is the one asked to move next; and because the value that came second was, in
 * every live case, a human whose "turn" this version abolishes anyway.
 *
 * WHAT IT DOES NOT DO. It does not touch bodies: `waiting-on → curator` inside prose
 * is a quotation of history, and history is append-only. The derived `_thread.md` and
 * `INDEX.md` are not rewritten here either — they are regenerated (`derive`), and a
 * migration that hand-patched them would be writing a second source of truth.
 */
import type { MigrationContext, MigrationEffect, MigrationStep } from "./step.js";

/** The header ends at the second fence; a `waiting-on` after it is prose, not a field. */
const FENCE = "---";

type Reduction = {
  readonly path: string;
  readonly was: string;
  readonly now: string;
  /** True when the first named was skipped because the circuit cannot wake them. */
  readonly skippedFirst: boolean;
};

const isMessageFile = (path: string): boolean =>
  path.endsWith(".md") && path.includes("/messages/");

/**
 * Who cannot hold the turn, straight out of the config being migrated (`wake.mode:
 * 'self'`). The registry is not used here on purpose: a step reads the data of the
 * version it starts from, and the config it is handed is raw JSON at version 12.
 */
const selfWaking = (config: Record<string, unknown>): ReadonlySet<string> => {
  const roles = Array.isArray(config.roles) ? config.roles : [];
  const ids = roles.flatMap((role) => {
    const entry = role as { id?: unknown; wake?: { mode?: unknown } };
    return typeof entry.id === "string" && entry.wake?.mode === "self" ? [entry.id] : [];
  });
  return new Set(ids);
};

/**
 * The rewrite of one file. It works on LINES rather than through the parser on
 * purpose: the parser of version 13 refuses a list outright, so the only thing that
 * can read version 12 data is something that predates the refusal.
 *
 * WHICH ROLE IS KEPT — the first the circuit CAN wake, not simply the first. The
 * statement said "the first", on the reading that the second value was in every live
 * case the human whose turn this version abolishes. The live feed says otherwise:
 * `john, curator` is its most common shape (62 of 153 multi-role headers; 76 name
 * john first). Keeping john there would have the migration emit, into the immutable
 * feed, exactly the header its own door now refuses — the same version answering
 * itself with an error. So a role outside the domain of the turn is skipped, and
 * skipping it is NAMED per file: it is a judgement, not a mechanical reduction.
 */
const reduce = (
  path: string,
  raw: string,
  outside: ReadonlySet<string>,
): { content: string; reduction?: Reduction } => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) return { content: raw };
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) return { content: raw };

  for (let at = 1; at < close; at++) {
    const line = lines[at] as string;
    if (!line.startsWith("waiting-on:")) continue;
    const value = line.slice("waiting-on:".length).trim();
    if (value === "—" || value === "") return { content: raw };
    const roles = value
      .split(",")
      .map((role) => role.trim())
      .filter((role) => role !== "");
    if (roles.length <= 1) return { content: raw };
    // If EVERY named role is outside the domain, the first is kept: inventing a turn
    // for somebody who was never named would be worse than leaving history readable
    // and flagged.
    const movable = roles.filter((role) => !outside.has(role));
    const kept = (movable[0] ?? roles[0]) as string;
    lines[at] = `waiting-on: ${kept}`;
    return {
      content: lines.join("\n"),
      reduction: { path, was: value, now: kept, skippedFirst: kept !== roles[0] },
    };
  }
  return { content: raw };
};

/** A header that already names ONE role, and that role is outside the domain of the turn. */
const strandedTurn = (raw: string, outside: ReadonlySet<string>): boolean => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) return false;
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) return false;
  for (let at = 1; at < close; at++) {
    const line = lines[at] as string;
    if (!line.startsWith("waiting-on:")) continue;
    const value = line.slice("waiting-on:".length).trim();
    return !value.includes(",") && outside.has(value);
  }
  return false;
};

export const SCALAR_WAITING_ON_STEP: MigrationStep = {
  from: 12,
  summary:
    "'waiting-on' becomes a scalar: a header naming several roles keeps the first the circuit can wake, and every such message is listed",
  plan: (context: MigrationContext): MigrationEffect => {
    const outside = selfWaking(context.config);
    const reductions: Reduction[] = [];
    const stranded: string[] = [];
    const files = [];
    for (const path of context.list(context.mailRoot)) {
      if (!isMessageFile(path)) continue;
      const raw = context.read(path);
      const { content, reduction } = reduce(path, raw, outside);
      if (reduction === undefined) {
        // Already scalar, and scalar on a role nobody wakes: the step does NOT touch
        // it — a single declaration is the turn its author meant, and replacing it
        // would be inventing one. It is COUNTED instead, because the checker of this
        // same version has an opinion about it and the feed cannot be edited later.
        if (isMessageFile(path) && strandedTurn(raw, outside)) stranded.push(path);
        continue;
      }
      reductions.push(reduction);
      files.push({ path, content });
    }

    return {
      files,
      notes: [
        "nothing but protocolVersion changes in the config: edit the number by hand and discard the rendered file (the runner reflows JSON)",
        ...(reductions.length === 0
          ? ["no message in the mail declared more than one role — the feed was already scalar"]
          : reductions.map(
              ({ path, was, now, skippedFirst }) =>
                `${path}: waiting-on '${was}' → '${now}'${skippedFirst ? " — the first named holds no turn (wake.mode='self'), so the first the circuit CAN wake was kept" : ""} — check by hand that this is the turn that was meant`,
            )),
        ...(stranded.length === 0
          ? []
          : [
              `${stranded.length} message(s) already declare a SINGLE role that holds no turn (wake.mode='self') — not rewritten (a lone declaration is the turn its author meant, and the feed is append-only), listed so the decision about them is taken and not discovered: ${stranded.join(", ")}`,
            ]),
        "run 'derive --write' afterwards: '_thread.md' and 'INDEX.md' show the waiting and are regenerated, not patched here",
        "bodies are NOT touched: 'waiting-on → a, b' inside a message is a quotation of history and the feed is append-only",
      ],
    };
  },
};
