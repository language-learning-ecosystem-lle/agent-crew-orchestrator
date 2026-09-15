/**
 * THE BELL THAT NEVER LEFT `daemon.log` (thread `180-selfheal-leaves-the-workspaces-behind`,
 * john's word of 2026-09-15, П-1 and П-2: «непригодное рабочее место обязано ЗВОНИТЬ, и
 * звонок ГРОМКИЙ» — that is, one that reaches the mail and not one that reaches the log).
 *
 * WHAT WAS MEASURED, by john's own hand on 2026-09-15 in the consumer contour: at `08:57Z`
 * two of three role worktrees were levelled onto the new pin and the third — `dev-speech`,
 * sitting on a branch of its own — was deliberately left alone. At `09:06:49Z` the circuit
 * stopped, and it printed the same two lines for **209 ticks in a row, about two hours**:
 *
 *     daemon [dev-speech×134-speech-product-seam] skipped — its workspace is not usable:
 *     the workspace of 'dev-speech' runs 'agent-protocol' 0.2.14, the home checkout …
 *     daemon — nothing has been raised for 209 tick(s) in a row (rings at 3) since 09:06:49Z
 *
 * The other three candidates were parked on a human, so that single pair WAS the whole of
 * the circuit's work. Both lines were honest and both were invisible: john learned of the
 * standstill by opening the journal with his hands two hours later. `stall.ts` beside this
 * file counts the ticks correctly and has done since 2026-09-09 — what it never had was a
 * way out of the box.
 *
 * SO THIS MODULE IS NOT A SECOND COUNTER. It is the half that turns two facts the tick
 * ALREADY holds into letters in the feed, on the pattern `freeze-letter.ts` set: everything
 * here is pure — the lock, the commit and the push are `deliverMessage` at the call site in
 * `cli.ts` — and the mark of a letter is kept only for a letter that LANDED.
 *
 * TWO FACTS, TWO LETTERS, AND THEY ARE NOT ONE FACT SAID TWICE:
 *
 *  · П-1 — «THIS PAIR CANNOT BE RAISED». A door refusal about the workspace, written on the
 *    FIRST tick that meets it and not on the third: the pair is dead to the circuit from
 *    that tick on, whether or not anything else on the box is moving. Its home is the
 *    pair's OWN thread, because that is the feed which otherwise goes on reading as «работа
 *    идёт» — the same defect, in the same words, that thread 149 wrote the freeze letter for;
 *  · П-2 — «THE BOX RAISED NOBODY FOR N TICKS». A property of the circuit rather than of a
 *    pair: it is due only when {@link stallDue} has already crossed, and it is written ONCE
 *    per standstill run — keyed by the run's `since`, exactly as the transport's bell is —
 *    into the thread of every pair standing in it.
 *
 * A pair can therefore hold both letters, and that is deliberate: the first says its own
 * tree is behind, the second says nothing at all on this box has moved for an hour and a
 * half. A reader who has the first still cannot tell the second, and it was the second that
 * john had to go and find by hand.
 *
 * WHAT THE LETTER MAY NOT SAY. `pnpm install` is NOT the cure and the letter must never
 * offer it — measured the same day, in this order: `pnpm install --frozen-lockfile` in the
 * tree left `0.2.14`; `git merge --ff-only origin/main` answered `fatal: Not possible to
 * fast-forward`; `git merge --no-edit origin/main` gave `0.2.15`, and the merge commit was
 * then REFUSED by the `conventional-commits` hook and had to be finished with `--no-verify`.
 * The version comes from the PIN, and the pin is in the files of the branch itself — so a
 * tree on its own branch is levelled by MERGING, by a hand, and the box does not do it:
 * john's boundary of 2026-09-12 («дерево на СОБСТВЕННОЙ ветке роли не трогать») stands
 * unnarrowed, and this bell is what was chosen INSTEAD of narrowing it.
 */

import type { StallRefusal } from "./stall.js";

/**
 * WHOSE TURN A BELL LEAVES. Never the refused role — a pair the circuit will not raise is
 * a pair that cannot take a turn, which is the whole premise of both letters — and never
 * `john`: he is reached by a role carrying the question, not by a `waiting-on` field.
 */
export const STANDSTILL_LETTER_TURN = "curator";

/** One workspace refusal of one tick, with the pair it was about. */
export type WorkspaceRefusal = {
  readonly role: string;
  readonly thread: string;
  /** The door's own sentence — what diverged, in the words the daemon printed. */
  readonly reason: string;
};

/** One letter the tick owes about one unusable workspace. */
export type WorkspaceLetter = WorkspaceRefusal;

/** One letter the tick owes about the standstill itself, to one pair standing in it. */
export type StandstillLetter = {
  readonly role: string;
  readonly thread: string;
  /** The run this letter is about — its identity, and the reason it is written once. */
  readonly since: string;
  readonly ticks: number;
  readonly candidates: number;
  /** What the tick refused with, as `stall.ts` normalised it. */
  readonly reasons: readonly string[];
};

/**
 * HOW MUCH OF THE DOOR'S SENTENCE IS THE IDENTITY. All of it: the divergence is inside it
 * (`runs 'agent-protocol' 0.2.14, the home checkout … 0.2.15`), so a tree that moves from
 * one wrong version to another wrong version is a NEW fact and is due a second letter,
 * while the same tree saying the same thing for 209 ticks is one fact and rings once.
 */
export const workspaceLetterKey = (letter: WorkspaceRefusal): string =>
  `workspace\t${letter.role}\t${letter.thread}\t${letter.reason.replace(/\s+/g, " ").trim()}`;

/**
 * AND THE STANDSTILL'S IDENTITY IS THE RUN, NOT THE TICK — `since` and not `ticks`. A run
 * that goes on saying the same thing is one event; a run that ends and starts again with a
 * different fault gets a new `since` from {@link foldStall} and is a second event, due a
 * second letter. The pair is in the key because the letter is written into the pair's feed.
 */
export const standstillLetterKey = (letter: {
  readonly role: string;
  readonly thread: string;
  readonly since: string;
}): string => `stall\t${letter.role}\t${letter.thread}\t${letter.since}`;

/** How many pairs one standstill writes to. Beyond this the bell is noise, not evidence. */
const PAIRS = 5;

/**
 * THE PAIRS THIS TICK COULD NOT RAISE BECAUSE OF THEIR TREES → the letters owed, and the
 * ledger as it will stand if every one of them lands.
 *
 * `said` is the ledger from disk and is treated as UNTRUSTED input — it is a file any hand
 * can edit, and a key in it that no longer corresponds to a standing refusal is dropped
 * rather than kept for ever. That is the one direction this ledger may fail in: forgetting
 * costs one repeated letter about a fact already told, remembering too much costs a silence.
 */
export const planWorkspaceLetters = (input: {
  readonly refusals: readonly WorkspaceRefusal[];
  readonly said: readonly string[];
}): { readonly letters: readonly WorkspaceLetter[]; readonly said: readonly string[] } => {
  const seen = new Set(input.said);
  const keys = new Set<string>();
  const letters: WorkspaceLetter[] = [];
  for (const refusal of input.refusals) {
    const key = workspaceLetterKey(refusal);
    if (keys.has(key)) continue;
    keys.add(key);
    if (!seen.has(key)) letters.push(refusal);
  }
  return { letters, said: [...keys].sort() };
};

/**
 * THE STANDSTILL → THE LETTERS OWED, one per standing pair and none at all until the run
 * has crossed the threshold: a single unlifted tick is bad luck, and `stall.ts` owns that
 * judgement, which is why `due` is handed in rather than recomputed here.
 *
 * A refusal with no thread on it — the planner's own skips carry the pair, a door refusal
 * of a role with no candidate would not — is dropped: a letter needs a feed to land in, and
 * inventing one would put the fact in a thread it is not about.
 */
export const planStandstillLetters = (input: {
  readonly due: boolean;
  readonly since: string;
  readonly ticks: number;
  readonly candidates: number;
  readonly reasons: readonly string[];
  readonly standing: readonly StallRefusal[];
  readonly said: readonly string[];
}): { readonly letters: readonly StandstillLetter[]; readonly said: readonly string[] } => {
  if (!input.due) return { letters: [], said: [] };
  const seen = new Set(input.said);
  const keys = new Set<string>();
  const letters: StandstillLetter[] = [];
  for (const refusal of input.standing) {
    if (refusal.thread === undefined) continue;
    const letter: StandstillLetter = {
      role: refusal.role,
      thread: refusal.thread,
      since: input.since,
      ticks: input.ticks,
      candidates: input.candidates,
      reasons: input.reasons,
    };
    const key = standstillLetterKey(letter);
    if (keys.has(key)) continue;
    keys.add(key);
    if (keys.size > PAIRS) break;
    if (!seen.has(key)) letters.push(letter);
  }
  return { letters, said: [...keys].sort() };
};

/**
 * THE WORDS ARE RUSSIAN, like `freeze-letter.ts` and `tidy-letter.ts` and for the reason
 * stated there: this letter carries AN INSTRUCTION TO A HAND, and an instruction is read in
 * the language of the feed it lands in.
 *
 * AND IT NAMES THE CURE BY NAME, because a bell a reader cannot act on is the defect one
 * step further on. The cure is the merge and its hook, both measured — see the header.
 */
export const renderWorkspaceLetter = (letter: WorkspaceLetter): string =>
  [
    `**Рабочее место роли \`${letter.role}\` непригодно — пара \`${letter.role}×${letter.thread}\` НЕ ПОДНИМАЕТСЯ, и тик её не починит.**`,
    "",
    `Дверь рабочего места отказала: ${letter.reason}`,
    "",
    "**Лечение — рука человека, и оно НЕ `pnpm install`.** Версия в дереве берётся из пина, а пин лежит в файлах САМОЙ ВЕТКИ: пока ветка не подтянула `main`, переустановка пакета не меняет ничего (замер john 15.09: `pnpm install --frozen-lockfile` → прежняя версия; `git merge --ff-only origin/main` → `fatal: Not possible to fast-forward`; `git merge --no-edit origin/main` → новая версия, и коммит слияния отклонил хук `conventional-commits`, довершено `git commit --no-verify`).",
    "",
    "Дерево роли на СОБСТВЕННОЙ ветке ящик не трогает (граница john 12.09, подтверждена 15.09): автоматического слияния `main` в ветку роли не будет — вместо него звонит это письмо.",
    "",
    `Ход передан роли \`${STANDSTILL_LETTER_TURN}\`: пара, о которой письмо, поднята быть не может, поэтому ход ей не адресуется.`,
  ].join("\n");

/** The standstill in a letter — the box's fact first, the pair's own refusal second. */
export const renderStandstillLetter = (letter: StandstillLetter): string =>
  [
    `**Контур СТОИ́Т: за ${letter.ticks} тик(ов) подряд с ${letter.since} не поднят никто, при ${letter.candidates} ждущих кандидат(ах).**`,
    "",
    `Эта пара — \`${letter.role}×${letter.thread}\` — одна из стоящих, поэтому письмо здесь: лента, в которой ход стои́т, читается как «работа идёт», и ровно так простой 15.09 прожил 209 тиков незамеченным.`,
    "",
    `Чем тик отказал: ${letter.reasons.join(" | ") || "причина не названа"}`,
    "",
    "Ни один из этих отказов не покрыт живой сессией своей роли — это простой, а не спящий контур. Счётчик и порог живут в `orchestrator/stall.ts`; сама эта строка печаталась в `daemon.log` и раньше, письмом она стала после слова john 15.09 (П-2 треда `180-selfheal-leaves-the-workspaces-behind`).",
    "",
    `Ход передан роли \`${STANDSTILL_LETTER_TURN}\`.`,
  ].join("\n");

/** The daemon's own line about a letter that landed — the log still says what the mail got. */
export const describeDeliveredWorkspaceLetter = (letter: WorkspaceLetter): string =>
  `workspace — ${letter.role}×${letter.thread} cannot be raised and the feed said nothing about it, so a letter was written into '${letter.thread}' and the turn passed to '${STANDSTILL_LETTER_TURN}'`;

/** The same for the standstill letter. */
export const describeDeliveredStandstillLetter = (letter: StandstillLetter): string =>
  `standstill — nobody has been raised for ${letter.ticks} tick(s) since ${letter.since}, so a letter was written into '${letter.thread}' and the turn passed to '${STANDSTILL_LETTER_TURN}'`;

/**
 * THE LEDGER AS A FILE: one JSON array of keys, overwritten. Missing, empty or unparseable
 * reads as AN EMPTY LEDGER — the same one-directional degradation everything else in this
 * file has, and it fails towards a repeated letter rather than towards a silence.
 */
export const renderSaidLetters = (said: readonly string[]): string =>
  `${JSON.stringify([...said].sort())}\n`;

/** The file back into the ledger; anything that is not an array of strings reads as empty. */
export const parseSaidLetters = (raw: string): readonly string[] => {
  const text = raw.trim();
  if (text === "") return [];
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((key): key is string => typeof key === "string");
  } catch {
    return [];
  }
};
