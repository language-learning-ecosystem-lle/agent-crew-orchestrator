/**
 * THE JOURNAL OF A ROLE IS WRITTEN LIKE A LETTER, NOT LIKE A CHANGE OF CODE (john's word
 * of 2026-09-14, thread `206-journal-writes-without-a-pr`).
 *
 * WHAT THIS ANSWERS, MEASURED. Of the nine pull requests standing without a label on the
 * morning of 2026-09-14, FOUR were pure journal entries. Each of them paid the full price
 * of a change to the repository — a branch, a `checks` run, a review round or the proof of
 * the exception to it, a conflict against somebody else's tail, a rebase and a button —
 * for a paragraph of chronicle. The move to "a file per thread" (#408, 2026-09-13) took
 * the conflicts away and left the pull request in place.
 *
 * A journal entry is a role's note about its own work: it carries no code, it changes no
 * behaviour, and there is nothing in it for a reviewer to judge. That is exactly the class
 * the mail already belongs to — and the mail has lived in a branch of its own, written
 * straight by a command, since R3. So the journal goes there too, and this module is the
 * half of it that is pure: WHERE the entry lands and WHAT the file then says. The half
 * that commits and pushes is `deliverMessage`, unchanged and shared with the mail.
 *
 * THE FORM «A FILE PER THREAD» SURVIVES THE MOVE (john's decision of 2026-09-13, #408):
 * the path is still built from the thread the entry rides in, only in the other branch.
 * What does NOT move is the history — the entries already in `docs/journal/**` of the main
 * branch stay there and stay true, the same rule the move to a file per thread was made
 * under. That is why nothing here reads the old directory: this is a new place to write,
 * not a migration.
 *
 * AND THE FEED OF A JOURNAL IS APPEND-ONLY LIKE THE FEED OF A THREAD. A role writes into
 * its entry more than once — a thread lives across several ticks, and a finding of the
 * third tick belongs beside the first. So a second write APPENDS rather than replaces, and
 * the one thing that is refused is the same text twice: a command re-run by a session that
 * lost its output would otherwise leave the paragraph in the file twice, and an append-only
 * file cannot be edited afterwards without a hand.
 */
import { join } from "node:path";

/** The directory of the journals inside the mail branch — the package's convention. */
export const JOURNAL_DIR = "journal";

/**
 * WHERE THE JOURNAL OF A ROLE LIVES IN THE BRANCH, as a path relative to the root of the
 * mail checkout: `<mail.dir>/journal/<role>`. Posix separators and not `join`, because this
 * string is handed to git, and git speaks one separator on every platform.
 *
 * The mail directory comes from the config for the reason `deliverySubject` states: the
 * literal `agent-comms` is ONE project's name for it (thread 080). The shape mirrors the
 * role's memory (`memoryBranchPrefix`) deliberately — memory and journal are the two things
 * a role owns inside the mail branch, and a reader who has learnt one path knows the other.
 */
export const journalBranchPrefix = (input: {
  readonly mailDir: string;
  readonly role: string;
}): string => `${input.mailDir}/${JOURNAL_DIR}/${input.role}`;

/** The same place on disk, inside the mail checkout — what delivery writes, stages, commits. */
export const journalEntryFile = (input: {
  readonly mailRoot: string;
  readonly role: string;
  readonly thread: string;
}): string => join(input.mailRoot, JOURNAL_DIR, input.role, `${input.thread}.md`);

/** The path of the entry as it is SAID to the caller and written into the commit subject. */
export const journalEntryLabel = (input: {
  readonly mailDir: string;
  readonly role: string;
  readonly thread: string;
}): string => `${journalBranchPrefix(input)}/${input.thread}.md`;

/**
 * THE COMMIT SUBJECT OF AN ENTRY — Conventional Commits, because the mail checkout carries
 * the commit-msg hook, and the mail directory as the scope because that is what the diff
 * touches. Built here rather than spelled at the call site for the reason `deliverySubject`
 * gives: a literal copied into a caller is the copy that does not get fixed.
 */
export const journalSubject = (input: {
  readonly mailDir: string;
  readonly role: string;
  readonly thread: string;
}): string => `docs(${input.mailDir}): журнал ${input.role} — ${input.thread}`;

/**
 * WHAT THE FILE WILL SAY AFTER THIS WRITE.
 *
 * `create` is the first entry of a thread and it gets the title line: a file that opens
 * with the role and the thread it is about is readable on its own, and the reader of a
 * journal usually arrives at one file rather than at the directory.
 *
 * `duplicate` is the re-run — the entry already carries this exact text. It is a refusal
 * with words rather than a silent no-op, because the two are told apart by nothing else:
 * a session that re-runs the command after losing its output must learn that the paragraph
 * is already in the branch, not that "nothing happened".
 */
export type JournalPlan =
  | { readonly kind: "create" | "append"; readonly content: string }
  | { readonly kind: "duplicate"; readonly refusal: string };

const title = (role: string, thread: string): string =>
  `# Журнал роли ${role} — тред \`${thread}\``;

export const planJournalEntry = (input: {
  readonly role: string;
  readonly thread: string;
  readonly body: string;
  /** What the branch already carries at this path; `undefined` — the entry is new. */
  readonly existing?: string;
}): JournalPlan => {
  const body = input.body.trim();
  const existing = input.existing;
  if (existing === undefined) {
    return { kind: "create", content: `${title(input.role, input.thread)}\n\n${body}\n` };
  }
  // THE COMPARISON IS ON THE TRIMMED TEXT, not on the bytes of the file: what differs
  // between two runs of one command is the trailing newline of the body file, and refusing
  // on that difference would let the duplicate through on the one path it is likely to
  // arrive by.
  if (existing.includes(body)) {
    return {
      kind: "duplicate",
      refusal: `the journal entry of '${input.role}' for thread '${input.thread}' already carries this text word for word — nothing was appended (an entry is append-only: if this is a SECOND note about the same thread, say something the file does not say yet; if the first write only looked like it failed, it did not — the text is in the branch)`,
    };
  }
  return {
    kind: "append",
    content: `${existing.replace(/\s+$/, "")}\n\n${body}\n`,
  };
};
