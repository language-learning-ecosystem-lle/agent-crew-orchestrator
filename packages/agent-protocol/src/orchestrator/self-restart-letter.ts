/**
 * THE LETTER THE SELF-RESTART WRITES (thread 141, package 3) — the half of the repair that
 * makes it visible to anybody but the box itself.
 *
 * The daemon may now drain its live sessions and restart itself onto the code it drifted
 * away from. That closes the drift WITHOUT A HAND — and, on its own, tells NOBODY that it
 * happened: the process that decided it is gone by the time the decision takes effect, and
 * the successor comes up as an ordinary launch. John's requirement over this package
 * (delivered by curator, msgs `12:11:42Z` and `15:37:48Z`) is exactly the objection to
 * that: "какой код был, какой стал, сколько отставал, сколько ждал сессию — и, если
 * что-то пошло не так, чего не хватило. Тихий самоперезапуск ничем не лучше тихого
 * дрейфа."
 *
 * The FACTS of the event already survive the exit of the process that wrote them (#309,
 * `self-restart.json`: `from`, `behind`, `drainSince`), and {@link selfRestartEvent} is the
 * successor recognising itself in them. This module is the other end of that wire: the
 * event, said to a human, once.
 *
 * THE FORM IS NOT A NEW ONE — it is `tidy-letter.ts` down to the split: from the system
 * (`--from github`), `--expects none`, WITH a turn, into a STANDING ADDRESS opened by the
 * delivery itself (`--ensure-thread`). Everything here is a PURE FUNCTION over facts the
 * caller already holds; what touches the world — writing the body to a file, spawning the
 * delivery, reading its exit code, keeping the ledger — lives in `cli.ts` beside the tick.
 */

import type { SelfRestartEvent } from "./self-restart.js";

/**
 * THE STANDING ADDRESS. No number in it: `--ensure-thread` takes whichever receiver of this
 * address is open and unparked, and opens the next one when none is — the same way
 * `workspace-tidy-up`, `main-red-alarm` and `notifier-down` work.
 *
 * It is NOT the drift address. A drift call says "the box is stuck on old code and here is
 * the order that fixes it"; this one says "the box fixed itself, and here is what it cost".
 * Those are opposite statements, and one receiver carrying both would make the good news
 * indistinguishable from the alarm at the moment a human is scanning for the alarm.
 */
export const SELF_RESTART_SLUG = "daemon-self-restart";

/** The title a receiver of that address is OPENED with, when one has to be opened. */
export const SELF_RESTART_TITLE = "Стоячий адрес: демон перезапустил себя на новый код";

/**
 * WHO IS NAMED WHEN THE RECEIVER HAS TO BE OPENED. `--ensure-thread` refuses without
 * participants, and it refuses at the door rather than on the day a receiver closes — so
 * the list is built for every letter, not only for the opening one.
 *
 * `github` because that is the sender; `curator` because the turn goes there; `john`
 * because the requirement this letter answers is his and the account is addressed to him.
 */
const PARTICIPANTS: readonly string[] = ["github", "curator", "john"];

/**
 * WHOSE TURN IT IS. Curator, and not a person: a turn is what makes a letter arrive at all,
 * and `john` is not a role a tick can raise — a letter addressed to him stands in an open
 * receiver that nobody is woken for. The account goes to john THROUGH curator, which is the
 * same route every other statement of this circuit takes.
 */
export const SELF_RESTART_WAITING_ON = "curator";

export type SelfRestartLetter = {
  readonly waitingOn: string;
  /** The message body, markdown, as it lands in the feed. */
  readonly body: string;
  /**
   * The argv of the delivery, `new-message` onwards — one array, so what a test asserts is
   * what the child is actually run with. `--body-file` is appended by the caller: the path
   * is a temporary file that exists only for the length of the call.
   */
  readonly argv: readonly string[];
};

/** A sha as a human reads it in a feed — short, and never silently truncated to nothing. */
const shortSha = (sha: string): string => (sha.length > 12 ? sha.slice(0, 12) : sha);

/**
 * "СКОЛЬКО ЖДАЛ СЕССИЮ", and the case where the answer is not known.
 *
 * `waitedForSec` is a subtraction of two stamps and it is ABSENT whenever the memory
 * predates `drainSince` or the pair came out backwards. That absence is said in words
 * rather than printed as a zero: "waited nothing" and "how long it waited is not recorded"
 * are different facts about the box, and the second one is the one that tells a reader the
 * file was written by older code.
 */
const waitedLine = (sec: number | undefined): string => {
  if (sec === undefined)
    return "- **сколько ждал сессии:** не записано — файл памяти писан кодом до `drainSince`";
  if (sec < 60) return `- **сколько ждал сессии:** ${sec} с`;
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return `- **сколько ждал сессии:** ${minutes} мин (${sec} с)`;
  const hours = Math.floor(minutes / 60);
  return `- **сколько ждал сессии:** ${hours} ч ${minutes % 60} мин (${sec} с)`;
};

/**
 * THE LETTER. The four facts john named are four lines of it, and each one is said even
 * when it is not known — a missing line reads as "there was nothing to say", and the whole
 * complaint this package answers is that silence and absence look alike.
 */
export const planSelfRestartLetter = (input: {
  readonly event: SelfRestartEvent;
  /** The circuit home this daemon serves — one box may run more than one. */
  readonly served?: string;
  /** Where the mail lives, and how the delivery is to reach its config. */
  readonly root: string;
  readonly repo?: string;
  readonly ref?: string;
}): SelfRestartLetter => {
  const { event } = input;
  const body = [
    `## Демон перезапустил себя на новый код — без руки, и вот чего это стоило`,
    "",
    "Ящик дождался конца живых сессий, починил своё дерево и поднялся на новом коде. Ход никому не нужен для ремонта — он уже сделан; это отчёт о нём, потому что тихий самоперезапуск ничем не лучше тихого дрейфа.",
    "",
    ...(input.served === undefined ? [] : [`- **контур:** \`${input.served}\``]),
    `- **какой код был:** ${
      event.from === undefined
        ? "не записано — файл памяти писан кодом до поля `from`"
        : `\`${shortSha(event.from)}\``
    }`,
    `- **какой стал:** \`${shortSha(event.to)}\``,
    `- **сколько отставал:** ${
      event.behind === undefined
        ? "не записано — файл памяти писан кодом до поля `behind`"
        : `${event.behind} коммит(ов)`
    }`,
    waitedLine(event.waitedForSec),
    `- **когда пошёл:** ${event.at}`,
    "",
    "**Ход curator — ровно на одно действие:** прочитать это и, если отчёт полон, донести john. Ремонта здесь нет: дрейф уже закрыт, а звонок о дрейфе (тред 141, #301) на этот ящик больше не придёт.",
  ].join("\n");
  return {
    waitingOn: SELF_RESTART_WAITING_ON,
    body,
    argv: [
      "new-message",
      "--root",
      input.root,
      ...(input.repo === undefined ? [] : ["--repo", input.repo]),
      ...(input.ref === undefined ? [] : ["--ref", input.ref]),
      "--ensure-thread",
      SELF_RESTART_SLUG,
      "--title",
      SELF_RESTART_TITLE,
      "--participants",
      PARTICIPANTS.join(","),
      "--from",
      "github",
      "--expects",
      "none",
      "--waiting-on",
      SELF_RESTART_WAITING_ON,
      "--worker",
      "agent-protocol",
      "--write",
    ],
  };
};

/**
 * THE LOCK ON THE REPEAT, and here it is not a refinement but the condition of the feature
 * being usable at all.
 *
 * `self-restart.json` is not consumed by the tick that reads it: the successor recognises
 * itself in the SAME file on every tick it runs, and ticks are a minute apart. Without this
 * lock one restart would post a letter every minute until somebody deleted the file by
 * hand — the flood of thread 133 reproduced, in a receiver a human is meant to read.
 *
 * WHAT IS COMPARED IS A SIGNATURE OF THE EVENT, and the event's own identity is exactly two
 * fields: WHERE it went (`to`) and WHEN it decided (`at`). Both come out of the memory file
 * and neither is read off the wall clock — a signature that took the current minute would
 * differ on every tick and lock nothing (thread `139-wall-clock-in-the-incident-signature`,
 * the same defect one module over). A SECOND restart onto the same sha is a new `at` and so
 * a new letter, which is the behaviour wanted: two restarts are two events.
 *
 * `from`, `behind` and `waitedForSec` are deliberately NOT in it. They are derived from the
 * same file as `at`, so they cannot vary while `at` stands still; putting them in would add
 * nothing and would make the key harder to reason about.
 */
export const selfRestartSignature = (event: SelfRestartEvent): string =>
  [event.to, event.at].join(" ");

/** What the last letter about a self-restart carried, as the caller keeps it on disk. */
export type SelfRestartMemo = {
  readonly signature: string;
  /** When that letter went, as it goes into the journal line of every suppressed tick. */
  readonly at: string;
};

/**
 * THE TICK THAT SAYS NOTHING NEW, as one line of the daemon's journal — and a line it MUST
 * print. A silent suppression is indistinguishable from "no restart happened", and telling
 * those two apart in a log is the entire reason this package exists.
 */
export const describeSuppressedSelfRestartLetter = (input: {
  readonly memo: SelfRestartMemo;
}): string =>
  `letter — SUPPRESSED, nothing new to say: this very self-restart was already posted to the standing address '${SELF_RESTART_SLUG}' at ${input.memo.at}, turn for '${SELF_RESTART_WAITING_ON}' — read it there`;

/**
 * THE DELIVERY THAT DID NOT GO, as one line of the same journal. It is a SEPARATE fact from
 * the restart and never folded into it: a silence here is the defect of this thread
 * reproduced one step later — the box restarted and nobody was told — so the line carries
 * the facts of the event itself, and the log alone is then enough to reconstruct it.
 */
export const describeUndeliveredSelfRestartLetter = (input: {
  readonly event: SelfRestartEvent;
  readonly cause: string;
}): string =>
  `letter — NOT DELIVERED to the standing address '${SELF_RESTART_SLUG}' (turn for '${SELF_RESTART_WAITING_ON}'): ${input.cause}. The restart itself STANDS — the box is running ${shortSha(input.event.to)} since ${input.event.at}; nobody has been told, so this line is the only trace`;

/** The delivered letter, as one line of the same journal — the counterpart of the above. */
export const describeDeliveredSelfRestartLetter = (): string =>
  `letter — the self-restart is posted to the standing address '${SELF_RESTART_SLUG}', turn for '${SELF_RESTART_WAITING_ON}'`;

/**
 * THE DECISION, as a pure function over the signature and what was remembered: post, or stay
 * quiet with a line that says why. Nothing here reads the disk — the caller owns both the
 * reading of the ledger and the writing of it, and writes ONLY after a delivery that
 * actually returned 0, because a letter that never arrived has told nobody and must be
 * tried again on the next tick.
 */
export const planSelfRestartDelivery = (input: {
  readonly signature: string;
  /** What the previous letter carried; absent — there was none. */
  readonly memo?: SelfRestartMemo;
}): { readonly post: true } | { readonly post: false; readonly said: string } =>
  input.memo !== undefined && input.memo.signature === input.signature
    ? { post: false, said: describeSuppressedSelfRestartLetter({ memo: input.memo }) }
    : { post: true };
