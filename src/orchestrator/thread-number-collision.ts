/**
 * TWO CONVERSATIONS UNDER ONE NUMBER, AND NOBODY IS TOLD — the watchman of thread
 * `159-thread-number-has-no-door` (john's word of 2026-09-08, msg-008 of that feed;
 * the criterion is curator's fourth answer, msg-007 §4).
 *
 * WHAT THE DOOR ALREADY CLOSES AND WHAT IT CANNOT. Since `585abbea` the door that opens a
 * thread asks the FEED rather than its own disk, so a number taken by somebody else is
 * refused at the command. That protects everyone who opens a thread WITH A COMMAND OF THIS
 * PACKAGE. It does not touch the other hand at all: a curator writing into the branch
 * through the repository's interface never goes through the door, and both collisions of
 * 2026-09-07 (`144`, `156`) came from exactly there. The rule "re-read the registry right
 * before creating a directory" was written into that hand's own instructions after the
 * first one and did not hold a day. So the choice was never "a watchman or a door" — it
 * was "a watchman or nothing", and a watchman catches it AFTER the fact but inside the
 * tick rather than in a month.
 *
 * THE CRITERION, and why it is this one. Three answers were rejected before it (msg-007 §4
 * of the thread, all three by curator): a new field of invalidity in `_meta.md` is a change
 * of the data's shape; a `severity: note` is a watchman that does not ring, which is not a
 * watchman; a hardcoded list of the known directories is a list that grows with every pair.
 * The fourth needs none of them:
 *
 *     RING ON A PAIR OF EQUAL NUMBERS OF WHICH AT LEAST ONE HALF IS `status: open`.
 *
 * It is machine-readable TODAY, out of the `_meta.md` every thread already carries, and on
 * the settled history it is silent BY CONSTRUCTION rather than by exception. MEASURED
 * 2026-09-08 over the whole of `origin/comms` (162 threads): SEVEN numbers are carried by two
 * directories each, not the six the statement of work counted an hour earlier — six of them
 * (`048`, `055`, `058`, `144`, `156`, `160`) have all twelve halves closed and say nothing,
 * and the seventh, `170`, has one open half (`170-mail-body-inside-checkout` beside
 * `170-cut-the-tag-with-the-letter-fix`) and rings. So the class is LIVE at the moment this
 * lands rather than historical, and the watchman's first tick delivers exactly one letter.
 *
 * ITS BLIND SPOT, NAMED BY ITS AUTHOR (curator, msg-007 §4; accepted by john, msg-008 §3):
 * a collision both halves of which are closed without anybody noticing they were namesakes
 * is never announced. The spot is narrow and, unlike the hardcoded list, does not grow with
 * the number of pairs — closing a thread is an act of a role or a hand, so by the moment
 * this goes quiet somebody has already been in both halves. That is the accepted price of
 * the criterion, not a gap in it.
 *
 * WHAT THIS FILE IS NOT. It does not rename anything and does not touch the twelve
 * directories that already exist — they are divorced by marks of invalidity in their own
 * feeds and history is not edited. It introduces no field into `_meta.md` and hardcodes no
 * list of directories. And it cannot catch the chat hand BEFORE the fact: no form can
 * (measured in msg-002 §4 of the thread), and this one is declared as catching it after.
 *
 * EVERYTHING HERE IS A PURE FUNCTION over the threads the caller has already read. What
 * touches the world — the delivery and the ledger — lives in `cli.ts` beside the courier,
 * which is also where the price of this watchman is answered: it walks over the threads the
 * courier loads for its own three questions, so it costs ZERO new calls of anything.
 */

import { THREAD_ID } from "../thread/id.js";

/**
 * THE STANDING ADDRESS. The same device the tidy-up letter uses (`TIDY_UP_SLUG`), and here
 * it is not a convenience but the answer to a question that has none otherwise: a finding is
 * about TWO threads at once, and when both halves are open there is no way to choose which
 * of them the letter belongs in. Writing into one of the halves would also make the letter
 * part of the very conversation whose identity is in doubt.
 *
 * No number in the slug: `--ensure-thread` takes whichever receiver of this address is open
 * and unparked and opens the next one when none is — the way `main-red-alarm`,
 * `notifier-down` and the tidy-up address already work.
 */
export const NUMBER_COLLISION_SLUG = "thread-number-collision";

/** The title a receiver of that address is OPENED with, when one has to be opened. */
export const NUMBER_COLLISION_TITLE = "Стоячий адрес: два треда под одним номером";

/**
 * WHO IS NAMED WHEN THE RECEIVER HAS TO BE OPENED. `--ensure-thread` refuses without
 * participants, so the list is built for every letter and not only for the opening one.
 *
 * `curator` because divorcing a collision is a curator's act — a role or a hand comes to it
 * THROUGH curator, and `dev-core` has nothing to do with a pair of numbers; `github` because
 * that is the identity every letter the circuit itself writes is signed with.
 */
export const NUMBER_COLLISION_PARTICIPANTS: readonly string[] = ["github", "curator"];

/** Whose turn the letter leaves — see the participants above. */
export const NUMBER_COLLISION_TURN = "curator";

/** One half of a collision: the directory and the status its `_meta.md` carries. */
export type CollisionHalf = {
  readonly id: string;
  readonly open: boolean;
};

/** One number carried by more than one directory, with every half it is carried by. */
export type NumberCollision = {
  /** The three digits themselves — `144`, not `144-open-threads-sweep-2`. */
  readonly number: string;
  /** Every directory under that number, by id, ascending. Two or more by construction. */
  readonly halves: readonly CollisionHalf[];
};

/**
 * WHAT COUNTS AS THE NUMBER OF A THREAD — and it is asked of `THREAD_ID`, the one place the
 * form is written down, rather than of a second regexp of this file's own (the whole of
 * thread 086: two copies of that pattern drifted apart silently and a statement of work sent
 * into the gap reached nobody).
 *
 * SO THE BLIND SPOT OF THE WALKER IS THIS WATCHMAN'S BLIND SPOT EXACTLY, and it is named
 * rather than left to be found: a directory named `147.1-...` is NOT a thread the mail reads
 * (measured in thread 147 — the door accepts the form `NNN.M`, the walker does not see it),
 * so it is not a half of any collision here either. That is the correct answer and not a
 * defect of the criterion: a directory the reader never visits collides with nothing,
 * because nothing is ever delivered into it in the first place.
 */
export const threadNumberOf = (id: string): string | undefined =>
  THREAD_ID.test(id) ? id.slice(0, 3) : undefined;

/**
 * EVERY NUMBER CARRIED BY MORE THAN ONE DIRECTORY — the whole finding, before the criterion
 * is applied to it. It is a separate step from {@link collisionRings} on purpose: the field
 * acceptance of this watchman is "six pairs FOUND and rejected by the criterion", and a
 * function that folded the two together could not tell that from "nothing was found at all".
 *
 * A number carried by THREE directories is one finding of three halves, not two findings:
 * the reader's question is "what is standing under 144", asked once.
 */
export const findNumberCollisions = (
  threads: readonly CollisionHalf[],
): readonly NumberCollision[] => {
  const byNumber = new Map<string, CollisionHalf[]>();
  for (const thread of threads) {
    const number = threadNumberOf(thread.id);
    if (number === undefined) continue;
    const halves = byNumber.get(number);
    if (halves === undefined) byNumber.set(number, [thread]);
    else halves.push(thread);
  }
  return [...byNumber.entries()]
    .filter(([, halves]) => halves.length > 1)
    .map(([number, halves]) => ({
      number,
      halves: [...halves].sort((left, right) => left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.number.localeCompare(right.number));
};

/** THE CRITERION ITSELF, in one line: at least one half is open. */
export const collisionRings = (collision: NumberCollision): boolean =>
  collision.halves.some((half) => half.open);

/**
 * THE MARK OF A COLLISION ALREADY TOLD ABOUT — and it carries THE HALVES, not the number
 * alone. A third directory appearing under a number already announced is a new state of the
 * world and a letter naming two halves is then wrong about it; keyed by the number alone,
 * that growth would be swallowed by the lock forever.
 *
 * The statuses are deliberately NOT in the key: one half of a live pair closing while the
 * other stays open changes nothing a reader has to be told twice about — the pair still
 * stands and the letter about it is still in the address.
 */
export const collisionSaidKey = (collision: NumberCollision): string =>
  `number:${collision.number}:${collision.halves.map((half) => half.id).join(",")}`;

/** A letter this watchman owes: one number, all of its halves. */
export type NumberCollisionLetter = {
  readonly collision: NumberCollision;
  /** The body, markdown, as it lands in the standing address. */
  readonly body: string;
};

/**
 * What the watchman plans this tick. `said` is the WHOLE new mark set, ready to be written
 * back — the caller stores it and hands it in next tick.
 */
export type NumberCollisionPlan = {
  readonly letters: readonly NumberCollisionLetter[];
  readonly said: readonly string[];
};

/**
 * THE TEXT. It names the NUMBER, EVERY HALF and WHICH of them are open — the same principle
 * the refusal of the door was built on in this very thread: a finding that does not name the
 * occupant makes the reader go looking by hand.
 */
export const renderNumberCollisionLetter = (collision: NumberCollision): string => {
  const open = collision.halves.filter((half) => half.open);
  return [
    `**Под номером \`${collision.number}\` в ленте стои́т ${collision.halves.length} треда — и один из них живой.**`,
    "",
    ...collision.halves.map((half) => `- \`${half.id}\` — **${half.open ? "open" : "closed"}**`),
    "",
    `Номер треда уникален только по трём цифрам, а сопоставляют треды по полному имени — значит два адреса под одним номером расходятся тихо: письмо, посланное «в ${collision.number}», приезжает не туда, куда его писали, и никто об этом не узнаёт.`,
    "",
    `**Открыт${open.length === 1 ? "" : "ы"}:** ${open.map((half) => `\`${half.id}\``).join(", ")} — именно поэтому это письмо есть. Дверь заведения треда номер уже спрашивает у ленты (тред 159), значит эта пара родилась НЕ командой пакета: её завели рукой мимо команд.`,
    "",
    "**Ход curator:** развести коллизию — пометить недействительным тот адрес, который им является, и назвать в обеих лентах, какой из них настоящий. Переименования контур не делает: история ленты не правится.",
    "",
    `Это говорится ОДИН раз на пару: метка снимается только тем, что пара перестала подходить под критерий — номер развели или закрыли все половины, — и никогда молчанием одного такта.`,
  ].join("\n");
};

/**
 * THE ARGV OF THE DELIVERY — the standing address, the sender `github`, `--expects none`
 * AND A TURN. The turn is not decoration and its absence is a measured defect, not a
 * stylistic one: a letter without one raises nobody (curator's ruling of 2026-09-05, thread
 * 133 — the turn is what makes a letter arrive at all), and a watchman whose finding raises
 * nobody is the `severity: note` answer that was rejected at the start of this thread.
 */
export const numberCollisionArgv = (input: {
  readonly root: string;
  readonly repo?: string;
  readonly ref?: string;
}): readonly string[] => [
  "new-message",
  "--root",
  input.root,
  ...(input.repo === undefined ? [] : ["--repo", input.repo]),
  ...(input.ref === undefined ? [] : ["--ref", input.ref]),
  "--ensure-thread",
  NUMBER_COLLISION_SLUG,
  "--title",
  NUMBER_COLLISION_TITLE,
  "--participants",
  NUMBER_COLLISION_PARTICIPANTS.join(","),
  "--from",
  "github",
  "--expects",
  "none",
  "--waiting-on",
  NUMBER_COLLISION_TURN,
  "--worker",
  "agent-protocol",
  "--write",
];

/**
 * THE PLAN — pure, and the one place the criterion and the lock meet.
 *
 * THE LOCK IS THE SHAPE OF `planMergeabilityWatch`, and for the same measured reason: a
 * watchman that rings every tick over one standing incident is thread
 * `133-tidy-letter-repeats-every-tick` again, ticks being a minute apart. What lifts a mark
 * is written here and nowhere else: a mark survives only while the pair it belongs to still
 * satisfies the criterion. A pair divorced (the number is no longer carried twice) or gone
 * quiet (every half closed) drops out of the live set and its mark with it — so if it ever
 * comes back, it rings again. One tick's silence lifts nothing, because silence is not a
 * state of the feed.
 */
export const planNumberCollisionWatch = (input: {
  readonly found: readonly NumberCollision[];
  readonly said: readonly string[];
}): NumberCollisionPlan => {
  const ringing = input.found.filter(collisionRings);
  const live = new Set(ringing.map(collisionSaidKey));
  const said = new Set(input.said);
  const letters: NumberCollisionLetter[] = [];
  for (const collision of ringing) {
    const key = collisionSaidKey(collision);
    if (said.has(key)) continue;
    said.add(key);
    letters.push({ collision, body: renderNumberCollisionLetter(collision) });
  }
  return {
    letters,
    said: [...said].filter((key) => live.has(key)).sort(),
  };
};

/** The tick's own line about a finding that went out, for the courier's log. */
export const describeNumberCollisionLetter = (input: {
  readonly collision: NumberCollision;
  readonly label: string;
}): string =>
  `number-collision — '${input.collision.number}' is carried by ${input.collision.halves
    .map((half) => `'${half.id}' (${half.open ? "open" : "closed"})`)
    .join(
      " and ",
    )}; the turn was passed to ${NUMBER_COLLISION_TURN} in the standing address '${NUMBER_COLLISION_SLUG}' (${input.label})`;

/** The counterpart line: the finding stands, the letter did not go, nothing is remembered. */
export const describeUndeliveredNumberCollision = (input: {
  readonly collision: NumberCollision;
  readonly cause: string;
}): string =>
  `number-collision — '${input.collision.number}' is carried by ${input.collision.halves
    .map((half) => half.id)
    .join(
      " and ",
    )} and the letter was NOT delivered: ${input.cause}; nothing is remembered, the next tick says it again`;

/**
 * WHAT A TICK THAT FOUND PAIRS AND RANG ABOUT NONE OF THEM SAYS — the silence, out loud,
 * AND ITS CAUSE, because there are two of them and they are not the same fact.
 *
 * The line used to say `every half closed: nothing to ring about` for both, and that is a
 * lie in exactly the case a reader comes to this log for: measured on the field 2026-09-09,
 * the tick announced both halves of `180` CLOSED while both stood `open` in the feed and a
 * letter about them had just gone out. A journal is the only thing the circuit reports about
 * this watchman with, so a line that names the wrong cause sends whoever reads it looking for
 * a defect in the reader of `_meta.md` — which is where this thread's own hypothesis went.
 *
 * So the cause is measured rather than assumed: the pairs that PASS the criterion are named
 * separately, and silence over them is the LOCK, not the criterion.
 */
export const describeQuietNumberCollisions = (input: {
  readonly found: readonly NumberCollision[];
  readonly ringing: readonly NumberCollision[];
}): string => {
  const numbers = (collisions: readonly NumberCollision[]): string =>
    collisions.map((collision) => collision.number).join(", ");
  const head = `number-collision — ${input.found.length} number(s) carried by more than one thread (${numbers(input.found)})`;
  return input.ringing.length === 0
    ? `${head}, every half closed: nothing to ring about`
    : `${head}, of which ${input.ringing.length} still open (${numbers(input.ringing)}): already told about in '${NUMBER_COLLISION_SLUG}', nothing new to ring about`;
};
