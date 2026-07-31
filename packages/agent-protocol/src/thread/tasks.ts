/**
 * NATIVE TASKS: the declarations live in the FEED, the board is DERIVED (thread
 * `021-native-tasks`, john's idea, curator's statement of work).
 *
 * The frame that is not up for discussion: tasks are NOT a separate editable
 * registry. A registry file is a second source of truth that drifts from the threads
 * — the very defect that made INDEX derived in thread 006. So a task is announced and
 * moved by a header field (`task:`, see `message.ts`), and everything here READS those
 * declarations: the state of each task, the checks, and `TASKS.md`.
 *
 * THERE IS NO CLOCK IN THIS GENERATOR, and that is load-bearing. "Done recently" as a
 * calendar window would make the output a function of the moment of assembly:
 * rebuilding tomorrow from the same data would produce a different file, i.e. a
 * permanent drift and a red `derive` with nobody having edited a source. Hence:
 *
 *  - "recently" = THE LAST N BY FEED ORDER, not by calendar;
 *  - no age column — the DATE of the status change (the `updated` column of INDEX is
 *    exactly this). The arithmetic is the reader's; the bytes stay deterministic;
 *  - the truncation is SPOKEN ("42 done in total, the last 15 shown"): a silent cut
 *    reads as completeness.
 *
 * WHO OWNS A TASK IS DERIVED, not declared. For `in-progress`/`done` the owner is the
 * `from` of the message that moved it — whoever took it, owns it. For `open` there is
 * no owner but an addressee, and that is the thread's `waiting-on`, i.e. exactly "who
 * is to act". Zero new grammar, and honester than an owner announced in advance, which
 * goes stale before the work is taken.
 *
 * THE COLUMN "thread" IS THE THREAD OF THE CURRENT STATUS, not the owning one: the
 * owning thread is already carried by the id (`021.2` localises itself), and the one
 * fact the board would otherwise lack is WHERE THE WORK IS HAPPENING NOW. The carrying
 * case is 016-roadmap announcing an R-item that is done in a working thread.
 *
 * MACHINE CONSUMERS READ THE CLI, NOT THIS FILE (`tasks list --json`). A resident
 * parsing `TASKS.md` would reproduce pain 5 one to one: asked "what is being done right
 * now" it would answer with yesterday's bytes, or with silence when the generator
 * failed.
 */

import type { CheckIssue } from "./check.js";
import {
  type Message,
  type TaskDeclaration,
  type TaskStatus,
  TERMINAL_TASK_STATUSES,
  taskThreadPrefix,
} from "./message.js";
import { type Thread, waitingOnOf } from "./thread.js";

/** How many `done`/`dropped` rows the board shows. A render constant, not config. */
export const TASKS_SHOWN = 15;

/** One declaration, with the place in the feed it was made from. */
export type TaskEvent = {
  readonly task: TaskDeclaration;
  /** The thread the declaration STANDS IN (not necessarily the owning one). */
  readonly thread: string;
  /** The message file — the board links to it, because the field is not in `_thread.md`. */
  readonly file: string;
  readonly from: string;
  readonly date: string;
};

/** A thread as the task layer needs it: the messages WITH their file names. */
export type TaskThreadInput = {
  readonly id: string;
  readonly entries: readonly { readonly fileName: string; readonly message: Message }[];
};

/**
 * Feed order across threads: by the stamp, then by thread, then by file name. Every
 * key is data on disk, so the order does not depend on when the board is assembled.
 */
const byFeed = (a: TaskEvent, b: TaskEvent): number =>
  a.date !== b.date
    ? a.date < b.date
      ? -1
      : 1
    : a.thread !== b.thread
      ? a.thread < b.thread
        ? -1
        : 1
      : a.file < b.file
        ? -1
        : a.file > b.file
          ? 1
          : 0;

export const collectTaskEvents = (inputs: readonly TaskThreadInput[]): TaskEvent[] => {
  const events: TaskEvent[] = [];
  for (const input of inputs) {
    for (const entry of input.entries) {
      for (const task of entry.message.fields.tasks ?? []) {
        events.push({
          task,
          thread: input.id,
          file: entry.fileName,
          from: entry.message.fields.from,
          date: entry.message.fields.date,
        });
      }
    }
  }
  return events.sort(byFeed);
};

/** A task as the board shows it: what it is, where it stands now, and since when. */
export type TaskState = {
  readonly id: string;
  /** From the `open` — the only place a title comes from (there is no renaming, see PROTOCOL.md). */
  readonly title: string;
  readonly status: TaskStatus;
  /** The tail of the CURRENT status: the fact on a close, the note on `in-progress`. */
  readonly note?: string;
  /** Where the declaration that opened it stands. */
  readonly opened: { readonly thread: string; readonly file: string };
  /** Where the CURRENT status stands — this is the board's "thread" column. */
  readonly at: { readonly thread: string; readonly file: string };
  readonly since: string;
  /** `from` of the message that moved it; absent while the task is only `open`. */
  readonly owner?: string;
};

/**
 * The state of every task, folded from the feed. Declarations that name a task nobody
 * opened are IGNORED here and REFUSED by `checkTasks` — the board must not invent a
 * row out of a movement whose title is unknown.
 */
export const foldTasks = (events: readonly TaskEvent[]): TaskState[] => {
  const states = new Map<string, TaskState>();
  for (const event of events) {
    const { task } = event;
    const at = { thread: event.thread, file: event.file };
    if (task.status === "open") {
      if (states.has(task.id)) continue; // a second `open` is a refusal, not an overwrite
      states.set(task.id, {
        id: task.id,
        title: task.tail ?? "",
        status: "open",
        opened: at,
        at,
        since: event.date,
      });
      continue;
    }
    const known = states.get(task.id);
    if (known === undefined) continue;
    states.set(task.id, {
      ...known,
      status: task.status,
      ...(task.tail === undefined ? {} : { note: task.tail }),
      at,
      since: event.date,
      owner: event.from,
    });
  }
  return [...states.values()];
};

/**
 * The checks that need ALL the threads at once — `check` already loads them all, and
 * the door of `new-message` runs the same function so that a crooked declaration is
 * refused while its author still holds the flag rather than reddening the branch.
 */
export const checkTasks = (
  events: readonly TaskEvent[],
  threadStatus: ReadonlyMap<string, "open" | "closed">,
): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  const opened = new Map<string, TaskEvent>();
  const terminal = new Map<string, TaskEvent>();
  const at = (event: TaskEvent, message: string): void => {
    issues.push({ thread: event.thread, file: event.file, message });
  };

  for (const event of events) {
    const { task } = event;
    if (task.status === "open") {
      const before = opened.get(task.id);
      if (before !== undefined) {
        at(
          event,
          `task '${task.id}' was already opened in ${before.thread}/messages/${before.file} — an id is opened once (a title is never rewritten; drop it and open a new id)`,
        );
        continue;
      }
      opened.set(task.id, event);
      continue;
    }
    if (!opened.has(task.id)) {
      at(
        event,
        `task '${task.id}' is moved to '${task.status}' but was never opened — open it from thread ${taskThreadPrefix(task.id)} first, or fix the id`,
      );
      continue;
    }
    const dropped = terminal.get(task.id);
    if (dropped !== undefined) {
      at(
        event,
        `task '${task.id}' was dropped in ${dropped.thread}/messages/${dropped.file} — dropping is terminal; bring the work back as a new id`,
      );
      continue;
    }
    if (task.status === "dropped") terminal.set(task.id, event);
  }

  // A NON-TERMINAL TASK IN A CLOSED THREAD. Closing a thread IS an acceptance, and an
  // acceptance with work still declared undone has to push back. It bites against the
  // thread of the CURRENT status, not the owning one (В1, thread 021): cross-thread
  // movement is the normal case, so the owning thread being closed says nothing, while
  // the thread where the work actually stands says everything. And `open` counts as
  // undone just as `in-progress` does (П5): a closed thread awaits nobody, so an `open`
  // in one renders as "up next — for nobody", which is a silent drop with a row on the
  // board.
  for (const state of foldTasks(events)) {
    if ((TERMINAL_TASK_STATUSES as readonly string[]).includes(state.status)) continue;
    if (threadStatus.get(state.at.thread) !== "closed") continue;
    issues.push({
      thread: state.at.thread,
      file: state.at.file,
      message:
        `task '${state.id}' stands '${state.status}' in a thread that is closed — an acceptance with undone work declared. ` +
        `Three ways out: report 'done'/'dropped' FROM ANY LIVE THREAD (the status may move across threads), take it 'in-progress' in a live thread, or reopen ${state.at.thread} (status in '_meta.md' is mutable)`,
    });
  }

  return issues;
};

/** The per-message checks — what only the owning thread can judge. */
export const checkThreadTasks = (input: TaskThreadInput): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  const prefix = input.id.slice(0, input.id.indexOf("-"));
  for (const entry of input.entries) {
    const seen = new Set<string>();
    for (const task of entry.message.fields.tasks ?? []) {
      if (seen.has(task.id)) {
        issues.push({
          thread: input.id,
          file: entry.fileName,
          message: `task '${task.id}' is declared twice in one message — one message says one thing about a task`,
        });
      }
      seen.add(task.id);
      // OPENING IS LOCAL, MOVING IS NOT (§1.4). The id is minted by the owning thread,
      // so opening `016.3` from thread 021 would mint a number 016 knows nothing about;
      // moving it from anywhere is the carrying case, not a loophole.
      if (task.status === "open" && taskThreadPrefix(task.id) !== prefix) {
        issues.push({
          thread: input.id,
          file: entry.fileName,
          message: `task '${task.id}' is opened in thread '${input.id}' — a task is opened only under the id of its own thread ('${prefix}.k'); a task of another thread may be MOVED from here, not opened`,
        });
      }
    }
  }
  return issues;
};

const EMPTY = "—";
/** The board is written INTO THE PROJECT ZONE, so the words are that zone's (as INDEX). */
const HEADING = "# Задачи";
const GROUPS: readonly { readonly status: TaskStatus; readonly title: string }[] = [
  { status: "in-progress", title: "Делается" },
  { status: "open", title: "Предстоит" },
  { status: "done", title: "Сделано" },
  { status: "dropped", title: "Снято" },
];

/**
 * "Up next" is ordered BY ID, and an id is two NUMBERS (`NNN.k`), not a string: `k` has no
 * fixed width (`TASK_ID` does not demand leading zeros), so a string comparison puts `021.10`
 * between `021.1` and `021.2` the moment a thread holds ten open tasks at once. The pair is
 * compared as numbers — the owning thread first, then the ordinal inside it.
 */
const byTaskId = (a: string, b: string): number => {
  const [aThread = "", aOrdinal = ""] = a.split(".");
  const [bThread = "", bOrdinal = ""] = b.split(".");
  return Number(aThread) - Number(bThread) || Number(aOrdinal) - Number(bOrdinal);
};

const link = (place: { readonly thread: string; readonly file: string }, text: string): string =>
  `[${text}](${place.thread}/messages/${place.file})`;

/**
 * The board. The link goes to the MESSAGE FILE and not to an anchor in `_thread.md`
 * (П1): the field deliberately never reaches the assembled thread, so an anchor would
 * land the reader where the declaration is not.
 */
export const renderTasksBoard = (
  states: readonly TaskState[],
  waiting: ReadonlyMap<string, string | undefined>,
): string => {
  const sections = GROUPS.map((group) => {
    const all = states.filter((state) => state.status === group.status);
    const terminal = (TERMINAL_TASK_STATUSES as readonly string[]).includes(group.status);
    // "Being done": oldest on top, so a forgotten task surfaces by itself — no separate
    // mechanism, and no clock. "Up next": by id. Closed ones: the last N of the feed.
    const sorted = terminal
      ? [...all].sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0))
      : group.status === "open"
        ? [...all].sort((a, b) => byTaskId(a.id, b.id))
        : [...all].sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    const shown = terminal ? sorted.slice(-TASKS_SHOWN).reverse() : sorted;

    const rows = shown.map((state) => {
      const who = state.owner ?? waiting.get(state.at.thread) ?? "";
      return `| ${link(state.opened, state.id)} | ${state.title} | ${state.at.thread} | ${
        who === "" ? EMPTY : who
      } | ${link(state.at, state.since.slice(0, 10))} | ${state.note ?? EMPTY} |`;
    });

    const head = `## ${group.title}\n\n`;
    // A SILENT CUT READS AS COMPLETENESS, so it is spoken.
    const cut =
      terminal && all.length > shown.length
        ? `\n\nвсего ${group.status}: ${all.length}, показаны последние ${shown.length}.`
        : "";
    if (rows.length === 0) return `${head}${EMPTY}${cut}`;
    return `${head}| id | задача | тред | кто | с какой даты | факт |\n|---|---|---|---|---|---|\n${rows.join("\n")}${cut}`;
  });

  return `${HEADING}\n\n${sections.join("\n\n")}\n`;
};

/** The board's inputs, assembled from what `loadThreads` returns. */
export const tasksFrom = (
  inputs: readonly TaskThreadInput[],
  threads: readonly Thread[],
): { states: TaskState[]; waiting: Map<string, string | undefined> } => ({
  states: foldTasks(collectTaskEvents(inputs)),
  waiting: new Map(threads.map((thread) => [thread.id, waitingOnOf(thread)])),
});
