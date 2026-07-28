/**
 * MIGRATION 13 → 14: native tasks (thread `021-native-tasks`, john's idea, statement
 * of work by curator).
 *
 * Version 14 widens TWO shapes and moves no data:
 *  - the message header gains a REPEATABLE `task: <NNN.k> <status>[ · tail]` — the one
 *    markup by which work is announced and moved, out of which `TASKS.md` is derived;
 *  - the role config gains the permission `task-declare`, which is what makes OPENING
 *    and DROPPING a task effective (passing one through needs no permission — that is
 *    execution, and whoever does the work reports it).
 *
 * NOTHING IS REWRITTEN, AND THE BOARD STARTS EMPTY ON PURPOSE. Marking up history after
 * the fact would mean writing TODAY'S messages announcing work finished a week ago —
 * in an append-only feed that is not reconstruction but forgery, and the board would
 * show fifteen tasks opened and closed today. An empty history is honester; the live
 * threads announce their REMAINDER forwards, which they can only do once the door
 * accepts the field, i.e. after this ships.
 *
 * WHY IT IS A VERSION, for the eleventh time: both schemas are strict, so a build of
 * the package that predates the permission REFUSES a config carrying it, and a build
 * that predates the header field refuses the whole THREAD carrying one message with
 * one declaration. The number turns those refusals from "your data is broken" into
 * "run the migration / update the package".
 *
 * ONE MORE WIDENING RIDES ALONG, and it is a STRICTNESS: a duplicate of any
 * non-repeatable header key used to win silently over its predecessor, and the moment
 * one key legitimately repeats, that silence stops being tolerable. Proven harmless
 * before it shipped — 511 message files on the live branch, zero duplicate keys — so no
 * message stops parsing because of it.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const NATIVE_TASKS_STEP: MigrationStep = {
  from: 13,
  summary:
    "native tasks: the repeatable message header field 'task' and the role permission 'task-declare' — both schemas widen, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'task-declare' is a PERMISSION — grant it to whoever may OPEN and DROP tasks (here: john, curator); moving a task to 'in-progress'/'done' is execution and needs none",
      "the mail is NOT rewritten and the board starts EMPTY: history is not marked up after the fact (that would be forgery, not reconstruction) — the live threads announce their remainder forwards, once the door accepts the field",
      "a duplicate of any non-repeatable header key becomes a PARSE ERROR instead of silently winning; checked against the whole branch before shipping (511 files, zero duplicates)",
    ],
  }),
};
