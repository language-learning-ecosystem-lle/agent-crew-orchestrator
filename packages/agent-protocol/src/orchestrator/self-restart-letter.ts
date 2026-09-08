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

import { isAbsolute, relative } from "node:path";
import { INSTALL_INPUTS, installNeeded, type SelfRestartEvent } from "./self-restart.js";

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
 * WHAT THIS DAEMON ACTUALLY EXECUTES, as paths of the checkout its code was loaded from
 * (thread 161, john 2026-09-07 through curator) — the measure that decides whether the
 * restart is worth a letter at all.
 *
 * THE REPAIR STAYS BLIND AND THAT IS DELIBERATE: `code-age.ts` counts COMMITS, cannot tell
 * a docs commit from a code one, and john does not touch that — judging a diff inside the
 * safe condition would put an opinion where the box must be dumb. The opinion belongs
 * HERE, on the letter, because a letter is what costs money: it names a turn, and every
 * turn is a raised session. The field case that forced it (the consumer circuit, their
 * thread 138): the box drained a live session and restarted for a drift of two markdown
 * files — 64 lines of `docs/`, not one line of anything that runs.
 *
 * THE FOOTPRINT IS DERIVED, NOT LISTED. Two shapes, and one rule reaches both:
 *   - the daemon runs FROM SOURCE inside the checkout (this circuit: `packages/agent-protocol`).
 *     Then everything it can import lives under the package directory of its entry module,
 *     and that directory — relative to the checkout — is the footprint;
 *   - the daemon runs an INSTALLED package (the consumer circuit pins it as a dependency).
 *     Then no file of the checkout is executed at all, and what decides which code comes up
 *     is the manifest that pins the version — {@link INSTALL_INPUTS}, the same three files
 *     the installer question is already asked over. This is the candidate the neighbours
 *     named ("версия установленного пакета до и после"), reached without a second mechanism.
 * The manifests are in the footprint in BOTH shapes: a lockfile move changes what
 * `node_modules` holds, and that is a change of the executable even when no source moved.
 */
export type ExecutableFootprint = {
  /** Directory prefixes, relative to the code checkout, whose contents this daemon runs. */
  readonly dirs: readonly string[];
  /** The package root IS the checkout root — then every path of it is executable. */
  readonly whole: boolean;
  /** What the above IS, in words the withheld line prints — a measure nobody can check is none. */
  readonly means: string;
};

/**
 * THE FOOTPRINT OF A RUNNING PROCESS, as a pure function over two paths the caller reads
 * from the world: the checkout the code was dated against ({@link CodeVintage.checkout})
 * and the nearest ancestor of the entry module that holds a `package.json`.
 *
 * `packageDir` ABSENT is TWO cases and they are not the same, which is why the entry itself
 * is asked for as well:
 *   - the entry lives INSIDE the checkout and no package boundary was found around it. The
 *     boundary is then unknown, and the only answer that cannot lose a letter is "the whole
 *     checkout is executable" — narrowing on a boundary nobody measured would withhold the
 *     letter about a real code change, and a silence is the one failure this module may not
 *     have;
 *   - the entry is elsewhere on the disk (or unknown): the installed shape — nothing of the
 *     checkout is executed, so only the manifests can move the executable. Same answer when
 *     the package dir itself is outside the checkout, which is the field case's shape.
 */
export const executableFootprint = (input: {
  readonly checkout: string;
  readonly packageDir?: string;
  /** The module this process was started with, absolute; absent — it could not be told. */
  readonly entry?: string;
}): ExecutableFootprint => {
  const manifests = INSTALL_INPUTS.join(", ");
  const under = (path: string | undefined): boolean => {
    if (path === undefined) return false;
    const rel = relative(input.checkout, path);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  if (input.packageDir === undefined)
    return under(input.entry)
      ? {
          dirs: [],
          whole: true,
          means: `this daemon runs '${input.entry}', inside '${input.checkout}', and no package boundary was found around it — so every path of that checkout is treated as executable`,
        }
      : {
          dirs: [],
          whole: false,
          means: `this daemon executes no file of '${input.checkout}' — its code is an installed package, and only ${manifests} can change which version comes up`,
        };
  const rel = relative(input.checkout, input.packageDir);
  if (rel === "")
    return {
      dirs: [],
      whole: true,
      means: `the package this daemon runs IS '${input.checkout}' — every path of that checkout is executable`,
    };
  if (rel.startsWith("..") || isAbsolute(rel))
    return {
      dirs: [],
      whole: false,
      means: `this daemon runs code from '${input.packageDir}', which is outside '${input.checkout}' — only ${manifests} of that checkout can change which version comes up`,
    };
  return {
    dirs: [rel],
    whole: false,
    means: `this daemon runs '${rel}' of '${input.checkout}', plus whatever ${manifests} install`,
  };
};

/**
 * DID THE RESTART CHANGE THE EXECUTABLE — the three answers, and the third one is the point
 * of the type. "Not measured" is NOT "nothing changed": the diff may be unreadable, and the
 * memory of a box running older code carries no `from` at all. Folding that into
 * `untouched` would silence the very event this package exists to announce, on the one tick
 * where nobody could check. It is folded into `changed` instead — the letter goes.
 */
export type ExecutableChange =
  | { readonly kind: "changed"; readonly paths: readonly string[] }
  | { readonly kind: "untouched" }
  | { readonly kind: "unmeasured"; readonly why: string };

/** How many of the changed paths the withheld/letter lines name before they say "…". */
const NAMED = 5;

export const describeExecutablePaths = (paths: readonly string[]): string =>
  `${paths.slice(0, NAMED).join(", ")}${paths.length > NAMED ? ", …" : ""}`;

/**
 * THE MEASURE ITSELF, pure over the diff the caller read. `changed` is
 * `git diff --name-only <from> <to>` in the code checkout; `undefined` means the caller
 * could not read it, and `why` then says which of the reasons it was.
 */
export const executableChange = (input: {
  readonly footprint: ExecutableFootprint;
  readonly changed: readonly string[] | undefined;
  readonly why?: string;
}): ExecutableChange => {
  if (input.changed === undefined)
    return {
      kind: "unmeasured",
      why: input.why ?? "the diff between the two shas could not be read",
    };
  const hit = input.footprint.whole
    ? [...input.changed]
    : input.changed.filter(
        (path) =>
          installNeeded([path]) ||
          input.footprint.dirs.some((dir) => path === dir || path.startsWith(`${dir}/`)),
      );
  return hit.length === 0 ? { kind: "untouched" } : { kind: "changed", paths: hit };
};

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
 * THE OPENING SENTENCE, and the fact it was not saying (thread 161, curator's §4: "оно не
 * назвало, что слив дождался живой сессии — самое ценное в том такте").
 *
 * The old text claimed the wait unconditionally, which is the one thing a letter about a
 * box must not do: `drainSince` is stamped ONLY on a `drain` verdict, and that verdict is
 * reached only with `live.length > 0` — so a known wait PROVES there were live sessions and
 * that every one of them closed by itself. With no wait recorded the box went straight to
 * `go`, and the sentence says nothing about sessions rather than inventing a vigil.
 */
const drainSentence = (sec: number | undefined): string =>
  sec === undefined
    ? "Ящик починил своё дерево и поднялся на новом коде."
    : "Ящик ДОЖДАЛСЯ живых сессий — ни одна не была порвана, он пошёл только после того, как закрылась последняя, — починил своё дерево и поднялся на новом коде.";

/**
 * WHY THIS LETTER EXISTS AT ALL, now that most restarts do not get one. The narrowing is
 * invisible to a reader unless the letters that DO go say what they measured — otherwise
 * the receiver silently changes meaning and nobody can tell a narrowed feed from a broken
 * one. Two cases reach here; `untouched` is not one of them, because it never posts.
 */
const executableLine = (change: ExecutableChange): string =>
  change.kind === "untouched"
    ? "- **что сменилось в исполняемом:** ничего — и такое письмо не пишется вовсе (см. журнал: WITHHELD)"
    : change.kind === "unmeasured"
      ? `- **что сменилось в исполняемом:** НЕ ИЗМЕРЕНО — ${change.why}. Письмо ушло именно поэтому: неудавшийся замер не есть «ничего не изменилось»`
      : `- **что сменилось в исполняемом:** ${change.paths.length} путь(ей) — ${describeExecutablePaths(change.paths)}`;

/**
 * THE LETTER. The four facts john named are four lines of it, and each one is said even
 * when it is not known — a missing line reads as "there was nothing to say", and the whole
 * complaint this package answers is that silence and absence look alike.
 */
export const planSelfRestartLetter = (input: {
  readonly event: SelfRestartEvent;
  /** What the restart moved in the executable — the reason this letter is being written. */
  readonly change: ExecutableChange;
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
    `${drainSentence(event.waitedForSec)} Ход никому не нужен для ремонта — он уже сделан; это отчёт о нём, потому что тихий самоперезапуск ничем не лучше тихого дрейфа.`,
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
    executableLine(input.change),
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
 * The join is `\u0000` for the ordinary reason and the same one `tidyUpSignature` gives: no
 * field of it can contain the separator, so two different signatures cannot collapse into
 * one text. It is written as an ESCAPE and never as the byte — a real NUL in a source file
 * makes git call it binary, which `sources.test.ts` is the guard against.
 *
 * `from`, `behind` and `waitedForSec` are deliberately NOT in it. They are derived from the
 * same file as `at`, so they cannot vary while `at` stands still; putting them in would add
 * nothing and would make the key harder to reason about.
 */
export const selfRestartSignature = (event: SelfRestartEvent): string =>
  [event.to, event.at].join("\u0000");

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
 * THE RESTART THAT MOVED NOTHING THIS BOX RUNS, as one line of the same journal (thread
 * 161) — and it is LOUDER than the suppression above rather than quieter, because this is
 * the branch where a human is told nothing at all. The restart still happened, the drain
 * still spent whatever it spent, and the only trace either leaves is this line: it carries
 * both shas, the footprint it measured and what that footprint means, so a reader who
 * disagrees with the narrowing can check it instead of trusting it.
 */
export const describeWithheldSelfRestartLetter = (input: {
  readonly event: SelfRestartEvent;
  readonly footprint: ExecutableFootprint;
}): string =>
  `letter — WITHHELD, the restart changed NOTHING THIS DAEMON EXECUTES: ${
    input.event.from === undefined ? "the code it came from" : shortSha(input.event.from)
  }..${shortSha(input.event.to)} moves no path of the footprint (${input.footprint.means}), so the box is running the same program under a new sha. The restart itself STANDS and is not undone; what is not spent is the LETTER, and with it the turn of '${SELF_RESTART_WAITING_ON}' — a raised session is what a letter costs (john, 2026-09-07: деньги тратит письмо, а не перезапуск)`;

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
  /** The event, for the line the withheld branch prints. */
  readonly event: SelfRestartEvent;
  readonly footprint: ExecutableFootprint;
  /** Whether this restart moved the executable at all — the narrowing of thread 161. */
  readonly change: ExecutableChange;
}): { readonly post: true } | { readonly post: false; readonly said: string } => {
  // THE LOCK IS ASKED FIRST because it is about a letter that ALREADY went: a reader who
  // has the letter must be told "you have it", not "there was nothing to tell you".
  if (input.memo !== undefined && input.memo.signature === input.signature)
    return { post: false, said: describeSuppressedSelfRestartLetter({ memo: input.memo }) };
  // AND THE NARROWING SECOND, and it does NOT write the ledger: a withheld letter told
  // nobody, so nothing about it needs remembering, and the line above is printed on every
  // tick of the epoch exactly as the suppression line is. That repetition is the price of
  // the branch being checkable in a log.
  if (input.change.kind === "untouched")
    return {
      post: false,
      said: describeWithheldSelfRestartLetter({ event: input.event, footprint: input.footprint }),
    };
  return { post: true };
};
