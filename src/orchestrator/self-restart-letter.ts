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
 * predates `drainSince`, the pair came out backwards, or the go never advanced the record
 * it is subtracted from. That absence is said in words rather than printed as a zero:
 * "waited nothing" and "how long it waited is not recorded" are different facts about the
 * box, and the field case of thread 173 is what the difference costs — ten minutes of drain,
 * during which the box raised nobody, printed as `0 с`, in the very letter written to say
 * what the restart cost.
 *
 * WHICH OF THE ABSENCES IT IS gets named, because the two send a reader to different places:
 * an old memory is a fact about the code that wrote the file, an unrecorded go is a fact
 * about how this box came up.
 */
const waitedLine = (event: SelfRestartEvent): string => {
  const sec = event.waitedForSec;
  if (event.repair === "unrecorded")
    return `- **сколько ждал сессии:** не записано — ход себя в памяти не отметил, а лежащий там штамп — начало слива${
      event.drainSince === undefined ? "" : ` (\`${event.drainSince}\`)`
    }, из которого длительность не вычитается`;
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
 *
 * AND THE REPAIR IS CLAIMED NO MORE UNCONDITIONALLY THAN THE WAIT WAS (thread 173). The
 * event's `repair` says whether the go path wrote the record this letter is made of; when it
 * did not, the box is running the target and NOTHING here knows by whose hand — so the
 * sentence says that, in the same place a reader looks for the good news, instead of
 * reporting a repair whose only evidence is a matching sha.
 */
const drainSentence = (event: SelfRestartEvent): string =>
  event.repair === "unrecorded"
    ? "Ящик ИСПОЛНЯЕТ новый код, но РЕМОНТА ЗА НИМ НЕ ЗАПИСАНО: память самоперезапуска осталась записью слива — ход по пути ремонта себя в ней не отметил. Совпал только SHA, а этим же совпадением кончается и подъём другой рукой: стоп-флаг и новый запуск, оператор, супервизор. Отчётом о состоявшемся самоперезапуске это письмо не является."
    : event.waitedForSec === undefined
      ? "Ящик починил своё дерево и поднялся на новом коде."
      : "Ящик ДОЖДАЛСЯ живых сессий — ни одна не была порвана, он пошёл только после того, как закрылась последняя, — починил своё дерево и поднялся на новом коде.";

/**
 * WHY THIS LETTER EXISTS AT ALL, now that most restarts do not get one. The narrowing is
 * invisible to a reader unless the letters that DO go say what they measured — otherwise
 * the receiver silently changes meaning and nobody can tell a narrowed feed from a broken
 * one. Two cases reach here; `untouched` is not one of them, because it never posts.
 *
 * THE LINE SAYS WHAT WAS MEASURED AND NOT MORE (the consumer circuit's finding, delivered by
 * curator 2026-09-09 into thread 161). The criterion is the FOOTPRINT — paths whose edit
 * COULD move the program that comes up — and it is conservative on purpose: a lockfile move
 * may change what `node_modules` holds, and telling cheaply whether it actually did is beyond
 * this measure. The old wording ("что сменилось в исполняемом") reported that conservative
 * measure as an accomplished fact, and the field case is exactly the gap: one workspace link
 * in the devDeps of a neighbour package moved the lockfile, `node_modules/agent-protocol`
 * stood at the same `0.2.13` on both sides, and the letter said the box had begun executing
 * something else. True by its criterion, false by its sentence — the same "текст против
 * факта" this circuit takes off its roles, and so off its instruments.
 *
 * THE CRITERION IS NOT TOUCHED: narrowing it to "did the installed copy really change" would
 * buy precision with silences, and a silence is the one failure this module may not have.
 */
const executableLine = (change: ExecutableChange): string =>
  change.kind === "untouched"
    ? "- **сдвинулся ли отпечаток установки:** нет — и такое письмо не пишется вовсе (см. журнал: WITHHELD)"
    : change.kind === "unmeasured"
      ? `- **сдвинулся ли отпечаток установки:** НЕ ИЗМЕРЕН — ${change.why}. Письмо ушло именно поэтому: неудавшийся замер не есть «ничего не сдвинулось»`
      : `- **сдвинулся ли отпечаток установки:** да, ${change.paths.length} путь(ей) — ${describeExecutablePaths(change.paths)}. Это пути, правка которых МОГЛА сменить программу, которая поднимется; что установленная копия ДЕЙСТВИТЕЛЬНО другая, здесь не измерено — критерий консервативен намеренно`;

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
  const unrecorded = event.repair === "unrecorded";
  const body = [
    // THE HEADING IS A CLAIM TOO, and on the unrecorded branch the old one was the false
    // half of the letter in six words ("перезапустил СЕБЯ", "БЕЗ РУКИ") — read by anybody
    // scanning the feed, and by every reader who goes no further than the title.
    unrecorded
      ? `## Демон исполняет новый код — но самоперезапуска за ним не записано`
      : `## Демон перезапустил себя на новый код — без руки, и вот чего это стоило`,
    "",
    unrecorded
      ? `${drainSentence(event)} Ход нужен для ПРОВЕРКИ, а не для ремонта: дрейф закрыт — код сошёлся с ref, — но чем именно он закрыт, ящик не знает.`
      : `${drainSentence(event)} Ход никому не нужен для ремонта — он уже сделан; это отчёт о нём, потому что тихий самоперезапуск ничем не лучше тихого дрейфа.`,
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
    waitedLine(event),
    // "WHEN IT WENT" IS A FACT ABOUT THE GO, so it is printed only when a go was recorded.
    // The record of an interrupted drain holds one stamp and it answers a different
    // question — printing that one here is what told the field reader the box went at
    // 12:30:57 when at 12:30:57 it had only started waiting.
    event.wentAt === undefined
      ? `- **когда пошёл:** не записано — хода по пути ремонта в памяти нет${
          event.drainSince === undefined
            ? ""
            : `; \`${event.drainSince}\` в ней — это НАЧАЛО СЛИВА, а не момент перезапуска`
        }`
      : `- **когда пошёл:** ${event.wentAt}`,
    executableLine(input.change),
    "",
    unrecorded
      ? "**Ход curator — ровно на одно действие:** прочитать это и донести john ВМЕСТЕ С ТЕМ, ЧЕГО ЗДЕСЬ НЕТ. Ремонтировать нечего: дрейф закрыт и звонок о дрейфе (тред 141, #301) на этот ящик больше не придёт. Чем он закрыт — вопрос к `.orchestrator/daemon.log` за окно между двумя эпохами: строки `SELF-RESTART: git pull --ff-only` и `leaving with code 75` есть у состоявшегося ремонта и нет ни у чего другого."
      : "**Ход curator — ровно на одно действие:** прочитать это и, если отчёт полон, донести john. Ремонта здесь нет: дрейф уже закрыт, а звонок о дрейфе (тред 141, #301) на этот ящик больше не придёт.",
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

/**
 * HOW OFTEN A QUIET BRANCH SAYS ITSELF AGAIN, in ticks — the cadence of thread 180 (form (C),
 * `N` named by curator 2026-09-12), and the answer to a flood that was measured, not felt.
 *
 * THE TWO QUIET BRANCHES of {@link planSelfRestartDelivery} print a line on every tick they
 * are taken, and an epoch of a standing box is thousands of ticks about one event. Measured
 * in the field, this circuit, one rotation: 6933 `SUPPRESSED` lines in `daemon.log.1`, 6718
 * of them byte-identical, 3,5 % of the file; the flood is on the branch that HAS a memory,
 * so a fix on either branch alone leaves the measured half standing.
 *
 * SILENCE IS STILL NOT ALLOWED, and that is what makes this a cadence rather than a lock:
 * the first tick of every quiet run says the FULL text, so "the box suppressed a letter" is
 * never indistinguishable from "no restart happened" — the sentence this module was built
 * around. What the cadence removes is the 100th repetition of it, not the statement.
 *
 * `N` IS A CONSTANT OF THIS MODULE AND NOT A KEY OF THE CONFIG — a knob over the journal
 * would be a norm, and norms are john's door, not a diff's. The number is a MEASURE of this
 * box rather than a guess: 97 ticks of `no candidate is launchable` in 59,7 minutes of the
 * live epoch `316991aa` (curator, 2026-09-12) — a tick of ≈36 seconds, so 100 ticks is the
 * "once per hour of standing" this cadence was asked for. A box with another period reads
 * the same line correctly anyway, because the repeat carries the COUNT of ticks and the
 * stamp it is counting from, and the reader converts one into the other themselves.
 */
export const SELF_RESTART_QUIET_CADENCE = 100;

/**
 * THE QUIET RUN THIS PROCESS IS IN, and it lives in the MEMORY of the daemon, never on the
 * disk. An epoch is one process (measured, thread 180: the daemon is a single long-lived
 * pid, and `daemon — code: … up since …` is printed once per epoch over thousands of ticks),
 * so the state a cadence needs is the state of that process — exactly as `windDownAnnounced`
 * and `turnTakenAnnounced` are kept beside the tick loop, and for the same stated reason:
 * "a line repeated every poll would be noise in the one log an operator reads after the fact".
 *
 * A NEW FIELD ON THE DISK IS NOT TAKEN, and that is a requirement rather than a taste
 * (curator, 2026-09-12 §4): a third field of `self-restart-letters.json` would force every
 * reader to tolerate a file written by older code, which is a second compatibility surface
 * bought for nothing — the counter is an argument, the way the memo already is.
 */
export type SelfRestartQuietRun = {
  /**
   * WHAT is being repeated — the branch and the event, joined. A different event (a new `at`,
   * so a new signature) is a different run and starts from the full text again: two restarts
   * are two events, which is the rule {@link selfRestartSignature} already stands on.
   */
  readonly of: string;
  /** How many ticks this run has lasted, this one included; `1` is the tick that spoke in full. */
  readonly ticks: number;
};

/**
 * THE KEY OF A QUIET RUN. The join is `\u0000` for `selfRestartSignature`'s reason — no field
 * can contain the separator, so two runs cannot collapse into one key — and it is written as
 * an ESCAPE, never as the byte, which `sources.test.ts` guards.
 */
const quietRunOf = (branch: "SUPPRESSED" | "WITHHELD", signature: string): string =>
  [branch, signature].join("\u0000");

/** The run after this tick: the same one advanced, or a fresh one when the subject changed. */
const advanceQuietRun = (
  of: string,
  previous: SelfRestartQuietRun | undefined,
): SelfRestartQuietRun =>
  previous !== undefined && previous.of === of
    ? { of, ticks: previous.ticks + 1 }
    : { of, ticks: 1 };

/**
 * DOES A RUN OF THIS LENGTH SAY ITSELF ON THIS TICK — `1` always (the full text; the first
 * tick of a quiet run is never silent), and then every {@link SELF_RESTART_QUIET_CADENCE}-th
 * tick after it: 101, 201, … with `N = 100`.
 */
export const quietTickSpeaks = (ticks: number): boolean =>
  ticks === 1 || (ticks - 1) % SELF_RESTART_QUIET_CADENCE === 0;

/** What the last letter about a self-restart carried, as the caller keeps it on disk. */
export type SelfRestartMemo = {
  readonly signature: string;
  /**
   * When that letter went, as it goes into the journal line of every suppressed tick — and
   * OPTIONAL, because the reading of this file (`readSelfRestartMemo`) guards the signature
   * and nothing else. A memo truncated, hand-edited or written by a revision that did not
   * carry the field is a real input, and the type says so: typed as required, the absence
   * was printed as the word `undefined` into the one line the quiet branch repeats.
   */
  readonly at?: string;
};

/**
 * WHEN THE LETTER WENT, or the NAMED absence of that stamp (thread 180, measured by probe:
 * a memo parsed from `{"signature":"a1b2c3"}` printed `… posted … at undefined, turn for …`).
 *
 * The form is not invented here — it is {@link describeUndeliveredSelfRestartLetter}'s, one
 * function down, and for the same reason: a stamp that is not recorded is said to be not
 * recorded, because `undefined` in a journal reads as a broken line rather than as a fact
 * about the box, and a reader cannot tell which of the two it is looking at.
 */
const postedAt = (memo: SelfRestartMemo): string =>
  memo.at === undefined
    ? "at a moment the memo of that letter does not record — it carries no stamp"
    : `at ${memo.at}`;

/**
 * THE TICK THAT SAYS NOTHING NEW, as one line of the daemon's journal — and a line it MUST
 * print ON THE FIRST TICK OF THE RUN. A silent suppression is indistinguishable from "no
 * restart happened", and telling those two apart in a log is the entire reason this package
 * exists; that is why this full text is said once and never conditionally.
 *
 * WHAT IT IS NOT is a line for EVERY tick, and that was measured rather than argued (thread
 * 180, curator's §3.6 and my §3 of 2026-09-12): in one rotation of `.orchestrator/daemon.log.1`
 * this branch printed 6933 lines, 6718 of them byte-identical and all about ONE event —
 * 3,5 % of the whole journal of the epoch spent on one sentence. The repetition is kept, at
 * a cadence, by {@link describeSuppressedSelfRestartLetterStill}; what it costs and what it
 * buys is written over {@link SELF_RESTART_QUIET_CADENCE}.
 */
export const describeSuppressedSelfRestartLetter = (input: {
  readonly memo: SelfRestartMemo;
}): string =>
  `letter — SUPPRESSED, nothing new to say: this very self-restart was already posted to the standing address '${SELF_RESTART_SLUG}' ${postedAt(input.memo)}, turn for '${SELF_RESTART_WAITING_ON}' — read it there. This line is said in full once and then every ${SELF_RESTART_QUIET_CADENCE} ticks, so the log of a standing box does not drown in it`;

/**
 * THE SAME SUPPRESSION, SAID AGAIN AFTER {@link SELF_RESTART_QUIET_CADENCE} TICKS — and it
 * carries MORE than the line it replaces, not less (curator's condition 3, thread 180).
 *
 * The two facts it adds are the two a reader of a standing log actually needs: HOW LONG the
 * box has been repeating itself, in ticks, and WHAT it is counting from — the stamp of the
 * letter that went. A count of TICKS rather than of minutes is deliberate: the period of the
 * poll is a property of the box, this module does not know it, and printing a duration it
 * cannot measure would be the same "текст против факта" the letter itself is guarded against.
 * With both numbers in the line the reader converts one into the other themselves.
 */
export const describeSuppressedSelfRestartLetterStill = (input: {
  readonly memo: SelfRestartMemo;
  readonly ticks: number;
}): string =>
  `letter — SUPPRESSED still, ${input.ticks - 1} tick(s) now since this was last said in full: the self-restart posted to the standing address '${SELF_RESTART_SLUG}' ${postedAt(input.memo)} is still the newest one, turn for '${SELF_RESTART_WAITING_ON}' — read it there. Every ${SELF_RESTART_QUIET_CADENCE}th tick says this; the ticks between it are the same fact, unchanged`;

/**
 * THE SAME WITHHOLDING, SAID AGAIN AT THE SAME CADENCE — and on this branch the count is the
 * only measure a reader has of how long the box has run a program nobody was told about. The
 * stamp counted from is the EVENT's (`at`, the identity of the restart) and not a letter's:
 * on this branch no letter ever went, which is exactly the fact being repeated.
 */
export const describeWithheldSelfRestartLetterStill = (input: {
  readonly event: SelfRestartEvent;
  readonly ticks: number;
}): string =>
  `letter — WITHHELD still, ${input.ticks - 1} tick(s) now since this was last said in full: the restart ${
    input.event.from === undefined
      ? "from the code it came from"
      : `from ${shortSha(input.event.from)}`
  } to ${shortSha(input.event.to)}, stamped ${input.event.at}, still moves no path of this daemon's footprint, so no letter is spent and no turn of '${SELF_RESTART_WAITING_ON}' is. Every ${SELF_RESTART_QUIET_CADENCE}th tick says this; the full line, with both shas and the footprint it measured, was said on the first tick of this run`;

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
  `letter — NOT DELIVERED to the standing address '${SELF_RESTART_SLUG}' (turn for '${SELF_RESTART_WAITING_ON}'): ${input.cause}. The restart itself STANDS — the box is running ${shortSha(input.event.to)}${
    // THE LOG LINE CARRIES THE SAME CAUTION THE LETTER DOES (thread 173): this is the only
    // trace of an event nobody was told about, and "since <at>" over an unrecorded go would
    // date the restart by the start of a drain — the defect, reproduced in the log where it
    // is even harder to catch.
    input.event.wentAt === undefined
      ? ", and the go path left no stamp — when and by what hand it came up is not recorded"
      : ` since ${input.event.wentAt}`
  }; nobody has been told, so this line is the only trace`;

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
 * THE DECISION, as a pure function over the signature, what was remembered and how long this
 * process has already been saying the same thing: post, or stay quiet — with a line that says
 * why, or with no line at all when that line was said {@link SELF_RESTART_QUIET_CADENCE}
 * ticks ago and has not changed since.
 *
 * Nothing here reads the disk — the caller owns both the reading of the ledger and the
 * writing of it, and writes ONLY after a delivery that actually returned 0, because a letter
 * that never arrived has told nobody and must be tried again on the next tick. THE QUIET RUN
 * IS NOT ON THE DISK EITHER: it comes in as an argument and goes back out as one, so the
 * caller that owns the tick loop owns it, and a restarted daemon starts every run from its
 * full text (the safe direction — a new process says everything it knows).
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
  /** What this process said last tick and how long it has been saying it; absent — nothing yet. */
  readonly quiet?: SelfRestartQuietRun;
}):
  | { readonly post: true }
  | {
      readonly post: false;
      /** The journal line, or ABSENT — this tick of the run says nothing, by the cadence. */
      readonly said: string | undefined;
      /** The run as it stands after this tick, for the caller to hand back on the next one. */
      readonly quiet: SelfRestartQuietRun;
    } => {
  // THE LOCK IS ASKED FIRST because it is about a letter that ALREADY went: a reader who
  // has the letter must be told "you have it", not "there was nothing to tell you".
  if (input.memo !== undefined && input.memo.signature === input.signature) {
    const memo = input.memo;
    const quiet = advanceQuietRun(quietRunOf("SUPPRESSED", input.signature), input.quiet);
    return {
      post: false,
      said: !quietTickSpeaks(quiet.ticks)
        ? undefined
        : quiet.ticks === 1
          ? describeSuppressedSelfRestartLetter({ memo })
          : describeSuppressedSelfRestartLetterStill({ memo, ticks: quiet.ticks }),
      quiet,
    };
  }
  // AND THE NARROWING SECOND, and it does NOT write the ledger: a withheld letter told
  // nobody, so nothing about it needs remembering. It is at the SAME cadence as the
  // suppression above, and that sameness is the point: the flood was measured on the branch
  // that has a memory, so a cadence on one branch alone would leave the measured half of it
  // standing (thread 180, §3 of 2026-09-12). The full line — both shas and the footprint it
  // measured — is still said on the first tick of every run, and that is what keeps this
  // branch checkable in a log; what the cadence takes away is only its hundredth copy.
  if (input.change.kind === "untouched") {
    const quiet = advanceQuietRun(quietRunOf("WITHHELD", input.signature), input.quiet);
    return {
      post: false,
      said: !quietTickSpeaks(quiet.ticks)
        ? undefined
        : quiet.ticks === 1
          ? describeWithheldSelfRestartLetter({
              event: input.event,
              footprint: input.footprint,
            })
          : describeWithheldSelfRestartLetterStill({ event: input.event, ticks: quiet.ticks }),
      quiet,
    };
  }
  return { post: true };
};
