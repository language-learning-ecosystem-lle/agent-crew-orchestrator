/**
 * THE LETTER A FROZEN PAIR CANNOT WRITE FOR ITSELF (thread 149, half (б) of thread 140;
 * john's word of 2026-09-06, verbatim «ОБЪЯВЛЯЕМ»): a pair stopped by the attempt ceiling
 * says so BY A LETTER INTO THE FEED, not by a line in the daemon's log.
 *
 * WHAT WAS MEASURED (thread 140, msg-001): five pairs of `devops` stood in the queue as
 * `skipped: exhausted — 3 failed attempts` — `047`, `056`, `057`, `070`, `079` — and the
 * last session of the role, `2026-09-03T02:18:56Z`, ended `code 0` without a single line
 * into the mail. Their five threads read as "the work is in progress" for three days,
 * because the feed is the only surface anybody reads and nothing in it had changed.
 *
 * WHY IT IS THE COURIER THAT WRITES IT. The role itself cannot: being frozen is exactly
 * the state of never being raised again, so a norm addressed to the frozen role is a norm
 * addressed to nobody. The courier runs under the box's own account, walks every tick and
 * already holds the fold this fact is read from — and it already writes into the feed for
 * the same reason (`mergeability-watch.ts`: GitHub raises no event when a branch stops
 * merging, so the letter IS the event).
 *
 * ONE LETTER PER SERIES, and the series is the identity for the reason thread 013 wrote
 * it down: an external freeze thaws, retries, fails and freezes again, and every one of
 * those is the same happening to whoever is being told about it. The key is therefore
 * `LeaseView.exhaustedSince` — the release that first took the counter to the ceiling —
 * and not the freeze in force now, which is forgotten in every gap.
 *
 * AND ONLY THE TERMINAL FREEZE IS WRITTEN ABOUT. A freeze with a thaw ahead of it ends by
 * a clock the box already holds: the circuit raises that pair again by itself, so the feed
 * would carry a letter about a stop that had already ended by the time it was read. What
 * this letter exists for is the freeze that ends only by a hand — `substantive` from its
 * first second, and `external` once its backoff is spent.
 *
 * THE WORDS ARE RUSSIAN, like `tidy-letter.ts` and unlike `mergeability-watch.ts`. The
 * difference between those two is not an accident to be tidied up here: the mergeability
 * letter states a fact about the platform, this one and the tidy-up letter carry AN
 * INSTRUCTION TO A ROLE, and an instruction is read in the language of the feed it lands
 * in. Same door as there if a project wants it otherwise — the kinds of announcement are
 * enumerated in the schema shape (`schema/shape.ts`), so a template slot is a change to
 * the SHAPE and therefore john's.
 *
 * EVERYTHING HERE IS PURE. What touches the world — the mail lock, the commit, the push —
 * is `deliverMessage` at the call site in `cli.ts`, beside the courier's other watchman.
 */

import type { FailureClass } from "./thaw.js";

/**
 * A pair of the courier's series set, as this module needs to read it. Structural on
 * purpose: `ExhaustedPair` of `notify/notify.ts` satisfies it, and an import the other way
 * would tie the orchestrator to the courier for a type.
 */
export type FrozenPair = {
  readonly role: string;
  readonly thread: string;
  /** The identity of the series — the release that first took the counter to the ceiling. */
  readonly since: string;
  /** Failed attempts behind the series. */
  readonly attempts?: number | undefined;
  /** What spent the ceiling — absent while the pair is in the gap of its series. */
  readonly failureClass?: FailureClass | undefined;
  /** When this freeze lifts by itself; `null` — it does not. */
  readonly thaw?: string | null | undefined;
  /** How the LAST attempt ended, in the journal's own word. */
  readonly reason?: string | null | undefined;
};

/** One letter the courier owes: one pair, one series, one terminal freeze. */
export type FreezeLetter = {
  readonly role: string;
  readonly thread: string;
  readonly since: string;
  readonly attempts: number | undefined;
  readonly ceiling: number;
  readonly failureClass: FailureClass;
  readonly reason: string | null;
};

/**
 * THE IDENTITY OF ONE LETTER — the series, and NOT the `freezeKey` of the digest.
 *
 * They are deliberately two marks over one fact, because they are spent by two different
 * outcomes: the digest's key is written only when the transport delivered, and this one
 * only when the letter landed in the feed. Sharing a key would make either failure erase
 * the other's memory — a phone call swallowed because a letter went, or a second letter
 * because a phone was out of reach — and the second of those is the very thing §4 of the
 * statement of work asks to be proved impossible.
 */
export const freezeLetterKey = (pair: {
  readonly role: string;
  readonly thread: string;
  readonly since: string;
}): string => `${pair.role}\t${pair.thread}\t${pair.since}`;

/** The series a key belongs to — the whole key here, kept as a function for the reader. */
const seriesOf = (pair: FrozenPair): string => freezeLetterKey(pair);

/**
 * IS THIS FREEZE THE TERMINAL ONE. Two facts and no third: the freeze is IN FORCE (a pair
 * in the gap of its series has no class and says nothing), and it has no thaw ahead of it.
 * The same pair of readings the digest tells `frozen` from `exhausted` by — one predicate,
 * so the letter and the phone call can never disagree about which of the two happened.
 */
const isTerminal = (pair: FrozenPair): boolean =>
  pair.failureClass !== undefined && (pair.thaw ?? null) === null;

export type FreezeLetterPlan = {
  readonly letters: readonly FreezeLetter[];
  /** The WHOLE new mark set, ready to be written back — the caller stores it as it is. */
  readonly said: readonly string[];
};

/**
 * THE PLAN, over the courier's series set and what the state remembers.
 *
 * `pairs` is the SERIES set and not the pairs frozen at this instant — the same argument
 * the digest is given, and for the same reason: a pair mid-backoff is thawed for part of
 * every round, and a mark rebuilt from "who is frozen right now" is dropped in that gap
 * and rings again on the way back. What keeps a mark alive is the series being in the set;
 * what ends it is a delivery, which zeroes the counter and takes the pair out of the set
 * altogether — and the next freeze of that pair is then a new series and a new letter.
 */
export const planFreezeLetters = (input: {
  readonly pairs: readonly FrozenPair[];
  readonly said: readonly string[];
  /** The attempt ceiling the count is judged against — printed beside it, never guessed. */
  readonly ceiling: number;
}): FreezeLetterPlan => {
  const said = new Set(input.said);
  const live = new Set(input.pairs.map(seriesOf));
  const letters: FreezeLetter[] = [];
  const ordered = [...input.pairs].sort(
    (a, b) => a.thread.localeCompare(b.thread) || a.role.localeCompare(b.role),
  );
  for (const pair of ordered) {
    if (!isTerminal(pair)) continue;
    const key = freezeLetterKey(pair);
    if (said.has(key)) continue;
    said.add(key);
    letters.push({
      role: pair.role,
      thread: pair.thread,
      since: pair.since,
      attempts: pair.attempts,
      ceiling: input.ceiling,
      failureClass: pair.failureClass as FailureClass,
      reason: pair.reason ?? null,
    });
  }
  return { letters, said: [...said].filter((key) => live.has(key)).sort() };
};

/**
 * THE FOUR FACTS (§2.3 of the statement of work), and the fourth is the one that makes the
 * letter a norm rather than a diagnosis: WHAT LIFTS THE FREEZE. A diagnosis without an exit
 * is what the circuit paid for all of 2026-09-06 — so the body names the hand, the command
 * and what that command's handoff does to the counter, and it says out loud the thing a
 * reader of a feed will otherwise assume: that answering this letter in this thread lifts
 * nothing. It does not. The pair is frozen in the JOURNAL, and no message moves that.
 */
export const renderFreezeLetter = (letter: FreezeLetter): string => {
  const attempts = letter.attempts === undefined ? "не сосчитано" : String(letter.attempts);
  const reason =
    letter.reason === null
      ? "в журнале не записана"
      : `\`${letter.reason}\`${letter.failureClass === "external" ? " — отказ на стороне вендора, до работы прогон не дошёл" : " — сессия работала и ушла, не передав ход"}`;
  return [
    `## Контур ПЕРЕСТАЛ поднимать пару \`${letter.role}\`×\`${letter.thread}\` — потолок попыток исчерпан`,
    "",
    "Эта лента читается как «идёт работа», а работа не идёт и сама не пойдёт: пара замёрзла, и сказать об этом она не может — быть замёрзшей и значит никогда больше не подняться. Поэтому пишет контур.",
    "",
    `- **пара:** роль \`${letter.role}\`, тред \`${letter.thread}\``,
    `- **попыток:** ${attempts} из ${letter.ceiling} (потолок)`,
    `- **чем кончилась последняя попытка:** ${reason}`,
    `- **класс заморозки:** \`${letter.failureClass}\` — сама она не отпустит: ${
      letter.failureClass === "external"
        ? "отсрочка внешнего отказа истрачена"
        : "у содержательной заморозки самоотпуска нет по построению"
    }`,
    `- **серия:** с \`${letter.since}\` (об одной серии говорится один раз)`,
    "",
    `**Что снимает заморозку.** Только рука, и ровно одним способом: прогон, пропущенный поверх потолка — \`orchestrator run --role ${letter.role} --thread ${letter.thread} --max-attempts ${letter.ceiling + 1}\`. Счётчик обнуляет ПЕРЕДАЧА ХОДА этим прогоном, а не его запуск.`,
    "",
    "**Письмо в этот тред заморозку НЕ снимает** — счёт попыток живёт в журнале оркестратора, и почта его не двигает. Ответ здесь нужен для другого: сказать, что с этим предметом делать.",
  ].join("\n");
};

/**
 * WHOSE TURN THE LETTER LEAVES. Curator, and never the frozen role: a turn addressed to a
 * pair the circuit will not raise is a turn nobody can take, which is the same silence in
 * a louder font. It is the fork `ci-outcome.yml` already makes and the one `tidy-letter.ts`
 * makes for its refused half — named here rather than at the call site because it is the
 * same statement as the body.
 */
export const FREEZE_LETTER_TURN = "curator";

/** The line the courier's log carries for a letter that landed. */
export const describeDeliveredFreezeLetter = (letter: FreezeLetter): string =>
  `freeze — ${letter.role}×${letter.thread} has been frozen since ${letter.since} (${letter.attempts ?? "?"} of ${letter.ceiling} attempts, ${letter.failureClass}); the feed said nothing about it, so a letter was written there and the turn passed to '${FREEZE_LETTER_TURN}'`;
