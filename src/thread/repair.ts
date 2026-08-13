/**
 * SYNTHESISING THE HEAD OF A THREAD FROM ITS MESSAGES (thread 065, mode (b) of `thread status`).
 *
 * WHY IT EXISTS. A thread whose `messages/` is there and whose `_meta.md` is not is unreadable
 * WHOLE — `loadThread` refuses it by name ("half-migrated"), and with it go every statement of
 * work inside. It is not a hypothetical state: a human opening a conversation outside the writing
 * door pushes message files first, and on 2026-08-13 thread 066 stood exactly like that with six
 * statements waiting on dev-core, invisible to the queue for an afternoon. The only cure that day
 * was a hand-written `_meta.md` in the mail checkout — the very act the door of 065.1 was built to
 * remove.
 *
 * WHAT IT MAY AND MAY NOT TOUCH. `_meta.md` is the one AUTHORED and MUTABLE file of a thread; the
 * messages are append-only and this module never reads them for anything but facts. It synthesises
 * a head and REFUSES on a thread that already has one — overwriting somebody's title is not a
 * repair, and no flag turns it into one.
 *
 * WHY THE FACTS ARE READ LENIENTLY HERE, unlike everywhere else. The whole point of a repair is
 * that the thread does not parse; a synthesiser standing on the strict reader would refuse exactly
 * the files it exists for (thread 066 had BOTH failures at once — no head, and a `date:` written in
 * the shape of a file name, the second invisible until the first was gone). So the header is read
 * for the one field a head needs (`from:`), and a file whose header cannot be read at all still
 * contributes its author FROM ITS NAME, which the writing door builds out of the same value.
 */

/** What a synthesised head is made of, and what was NOT certain about it. */
export type SynthesisedMeta = {
  readonly title: string;
  readonly participants: readonly string[];
  /** A repaired thread is always reopened: whether it is finished is an acceptance, not a guess. */
  readonly status: "open";
  /** Files whose header could not be read — their author came from the file name. */
  readonly guessedAuthors: readonly string[];
};

export type RepairSource = {
  /** The message file name, exactly as it lies on disk. */
  readonly fileName: string;
  readonly content: string;
};

const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}Z-(?<role>[a-z0-9-]+)\.md$/;
const FROM = /^from:[ \t]*(?<role>[^\r\n]+)$/m;

/** The front matter of a message, or nothing when the file does not open with one. */
const header = (content: string): string | undefined => {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.indexOf("---", 1);
  return end === -1 ? undefined : lines.slice(1, end).join("\n");
};

/** The first line of the body that says something — the title a human would have typed. */
const firstBodyLine = (content: string): string | undefined => {
  const lines = content.split("\n");
  const start = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) + 1 : 0;
  for (const line of lines.slice(start)) {
    const trimmed = line
      .trim()
      .replace(/^#+\s*/, "")
      // The emphasis markers go, the words stay: a title is a line read in an index, and
      // `**Test gaps:** six statements` is one sentence a human wrote, not two.
      .replaceAll("**", "");
    if (trimmed !== "") return trimmed;
  }
  return undefined;
};

/**
 * The head of a thread, from its messages in file order.
 *
 * `title` — the caller's flag, else the first line said in the earliest message, else the thread id:
 * a synthesised title is a placeholder for a human to correct, and an empty one would be a second
 * defect. `participants` — every author, in the order they first spoke, so the head reads like the
 * conversation. `status` — always `open`, because the alternative is a machine deciding an
 * acceptance.
 */
export const synthesiseMeta = (
  id: string,
  sources: readonly RepairSource[],
  options: { readonly title?: string } = {},
): SynthesisedMeta => {
  const participants: string[] = [];
  const guessedAuthors: string[] = [];
  for (const source of sources) {
    const declared = header(source.content)?.match(FROM)?.groups?.["role"]?.trim();
    const named = source.fileName.match(NAME)?.groups?.["role"];
    const author = declared ?? named;
    if (declared === undefined && named !== undefined) guessedAuthors.push(source.fileName);
    if (author !== undefined && !participants.includes(author)) participants.push(author);
  }
  return {
    title:
      options.title ?? (sources[0] === undefined ? id : (firstBodyLine(sources[0].content) ?? id)),
    participants,
    status: "open",
    guessedAuthors,
  };
};
