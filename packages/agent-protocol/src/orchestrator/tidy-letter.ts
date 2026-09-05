/**
 * THE LETTER THE TIDY-UP WRITES (thread 099, item C) — the half of the right that makes
 * it useful to anybody but the daemon's log.
 *
 * The daemon may now commit a dirty workspace for the role that left it (item A). That
 * saves the work at a named address and lets the role start on the next tick — and, on
 * its own, tells NOBODY where the work went: the branch name is built at the moment of
 * the tidy-up and nothing carries it to the next launch. The role starts with a clean
 * tree, works on, and never learns that it has a branch standing somewhere. That is the
 * silent loss of context the whole thread is about, one step later.
 *
 * SO THE OUTCOME IS POSTED AS A LETTER, and the form is not a new one: it is literally
 * what `ci-outcome.yml` and `notifier-watch.yml` already send — from the system
 * (`--from github`), `--expects none`, WITH a turn, into a STANDING ADDRESS opened by
 * the delivery itself (`--ensure-thread`). Curator's ruling of 2026-09-05 in the thread:
 * the turn is what makes a letter arrive at all, and the standing address is what makes
 * the raised session read THIS letter rather than its own thread.
 *
 * THE TWO ADDRESSEES ARE THE TWO OUTCOMES, and they are decided here rather than at the
 * call site because they are the same statement as the body:
 *
 *  - the tidy-up WENT — the turn goes to the ROLE. Its tree is clean, it is raisable,
 *    and it is raised on the standing address, which is the only place it can be told
 *    about a branch of its own;
 *  - the tidy-up did NOT go — the turn goes to CURATOR. In that branch the launch is
 *    refused, so a turn addressed to the role is one nobody can ever take: the next tick
 *    refuses again, forever, until a hand comes. This is exactly the fork
 *    `ci-outcome.yml:490/497` already makes between `--waiting-on ${ROLE}` and
 *    `--waiting-on curator`.
 *
 * EVERYTHING HERE IS A PURE FUNCTION over facts the caller already holds. What touches
 * the world — writing the body to a file, spawning the delivery, reading its exit code —
 * lives in `cli.ts` beside the tidy-up itself.
 */

import { describeWorkspaceDirt, type WorkspaceDirt } from "./workspace.js";

/**
 * THE STANDING ADDRESS. No number in it: `--ensure-thread` takes whichever receiver of
 * this address is open and unparked, and opens the next one when none is — the same way
 * `main-red-alarm` and `notifier-down` work. One address for BOTH outcomes on purpose:
 * the subject is one ("the circuit did or did not sort out a role's tree"), and a name
 * that spoke of an incident would be wrong for the half of the cases that are good news.
 */
export const TIDY_UP_SLUG = "workspace-tidy-up";

/** The title a receiver of that address is OPENED with, when one has to be opened. */
export const TIDY_UP_TITLE = "Стоячий адрес: контур разобрал (или не разобрал) дерево роли";

/** What the circuit did with the tree, as the letter has to say it. */
export type TidyUpOutcome =
  | {
      /** Committed, the tree is clean, the role starts on the next tick. */
      readonly kind: "done";
      readonly branch: string;
      readonly head: string;
      /** The push failure, when there was one; absent means the branch is on the origin too. */
      readonly push?: string;
    }
  | {
      /**
       * Committed — and the tree did not go back to the base afterwards. The work is
       * SAVED (branch and sha are known and go into the letter), but the launch is
       * refused, so the turn is curator's like any other refusal.
       */
      readonly kind: "stranded";
      readonly branch: string;
      readonly head: string;
      readonly push?: string;
      readonly cause: string;
    }
  | {
      /** Not committed. The work is still uncommitted, and the role stands on every thread. */
      readonly kind: "failed";
      /** Where the dirt now stands, when the attempt moved it onto a branch before failing. */
      readonly branch?: string;
      readonly cause: string;
    };

export type TidyUpLetter = {
  /** The role the turn goes to — the subject role, or `curator` when it cannot be taken. */
  readonly waitingOn: string;
  /** The message body, markdown, as it lands in the feed. */
  readonly body: string;
  /**
   * The argv of the delivery, `new-message` onwards — one array, so what a test asserts
   * is what the child is actually run with. `--body-file` is appended by the caller: the
   * path is a temporary file that exists only for the length of the call.
   */
  readonly argv: readonly string[];
};

/**
 * WHO IS NAMED WHEN THE RECEIVER HAS TO BE OPENED. `--ensure-thread` refuses without
 * participants, and it refuses at the door rather than on the day a receiver closes —
 * so the list is built for every letter, not only for the opening one.
 *
 * The subject role is in it because the letter is about its tree; `curator` because the
 * failing half of the outcomes is addressed there; `github` because that is the sender.
 */
const participantsFor = (role: string): readonly string[] => [
  ...new Set(["github", role, "curator"]),
];

/** `+ pushed` / `— not pushed, and why`, said the same way in both branches that have it. */
const pushLine = (push: string | undefined): string =>
  push === undefined
    ? "**push:** прошёл — ветка есть и на `origin`."
    : `**push:** НЕ прошёл (${push}). Работа закоммичена, но лежит ТОЛЬКО на этой машине — заберите её с ящика, а не с \`origin\`.`;

/**
 * THE LETTER. The requirement-outcome curator put over the form: it names the BRANCH AND
 * SHA when the tidy-up went, and the CAUSE when it did not. Everything else in the body
 * is context around one of those two facts — the address of the work is what a human
 * looking for it a week later needs, and explanations are not.
 */
export const planTidyUpLetter = (input: {
  readonly role: string;
  /** The workspace path, as the daemon knows it. */
  readonly path: string;
  /** The thread the run that left the dirt was working on. */
  readonly thread?: string;
  /** What was lying in the tree, when it was read. */
  readonly dirt?: WorkspaceDirt;
  readonly outcome: TidyUpOutcome;
  /** Where the mail lives, and how the delivery is to reach its config. */
  readonly root: string;
  readonly repo?: string;
  readonly ref?: string;
}): TidyUpLetter => {
  const { outcome } = input;
  const what = input.dirt === undefined ? "не прочитано" : describeWorkspaceDirt(input.dirt);
  const about = [
    `- **роль:** \`${input.role}\``,
    `- **дерево:** \`${input.path}\``,
    `- **тред прогона:** ${input.thread === undefined ? "не назван" : `\`${input.thread}\``}`,
    `- **что лежало:** ${what}`,
  ];
  const body =
    outcome.kind === "done"
      ? [
          `## Контур закоммитил незакоммиченную работу роли \`${input.role}\` — она лежит в \`${outcome.branch}\``,
          "",
          "Прогон кончился, не закоммитив своё дерево. Контур сделал это за него: дерево чисто, роль поднимается ближайшим тиком — **и вот адрес работы, потому что больше его нигде нет.**",
          "",
          ...about,
          `- **куда положено:** ветка \`${outcome.branch}\`, коммит \`${outcome.head}\``,
          `- ${pushLine(outcome.push)}`,
          "",
          `**Ход ваш — ровно на одно решение:** забрать эту ветку в работу или удалить её, сказав почему. Удаления контур не делает (решение по треду 099): конец служебной ветки — рука роли.`,
        ].join("\n")
      : outcome.kind === "stranded"
        ? [
            `## Работа роли \`${input.role}\` СОХРАНЕНА в \`${outcome.branch}\`, но дерево осталось на ветке — роль стои́т`,
            "",
            "Коммит прошёл, а возврат дерева на базу — нет. Работа не потеряна, но запуск роли отказан, и сама она этот ход взять не может: следующий тик откажет так же.",
            "",
            ...about,
            `- **куда положено:** ветка \`${outcome.branch}\`, коммит \`${outcome.head}\``,
            `- ${pushLine(outcome.push)}`,
            `- **что не вышло:** ${outcome.cause}`,
            "",
            `**Ход curator:** роль \`${input.role}\` стои́т по всем своим тредам, пока дерево \`${input.path}\` не вернут на базу.`,
          ].join("\n")
        : [
            `## Контур НЕ смог разобрать дерево роли \`${input.role}\` — она стои́т по всем своим тредам`,
            "",
            "Дерево осталось грязным, работа НЕ закоммичена. Ход адресован curator, а не роли: в этой ветви запуск роли отказан, и ход, адресованный ей, взять было бы некому.",
            "",
            ...about,
            ...(outcome.branch === undefined
              ? []
              : [
                  `- **где стои́т грязь:** ветка \`${outcome.branch}\` (дерево уже не там, где его оставила сессия)`,
                ]),
            `- **что не вышло:** ${outcome.cause}`,
            "",
            `**Ход curator:** нужна рука — разобрать \`${input.path}\` и вернуть его на базу.`,
          ].join("\n");
  const waitingOn = outcome.kind === "done" ? input.role : "curator";
  return {
    waitingOn,
    body,
    argv: [
      "new-message",
      "--root",
      input.root,
      ...(input.repo === undefined ? [] : ["--repo", input.repo]),
      ...(input.ref === undefined ? [] : ["--ref", input.ref]),
      "--ensure-thread",
      TIDY_UP_SLUG,
      "--title",
      TIDY_UP_TITLE,
      "--participants",
      participantsFor(input.role).join(","),
      "--from",
      "github",
      "--expects",
      "none",
      "--waiting-on",
      waitingOn,
      "--worker",
      "agent-protocol",
      "--write",
    ],
  };
};

/**
 * THE DELIVERY THAT DID NOT GO, as one line of the daemon's journal.
 *
 * It is a SEPARATE fact from the tidy-up and never folded into it (curator's acceptance,
 * point 3): a silence here is the original defect of this thread reproduced — the work is
 * committed to a branch nobody was told about. So the line says three things at once:
 * that the tidy-up itself stands, what the delivery answered, and where the work is, so
 * that the log alone is enough to find it by hand.
 */
export const describeUndeliveredTidyUpLetter = (input: {
  readonly role: string;
  readonly waitingOn: string;
  readonly cause: string;
  /** The address of the work, when there is one — the whole reason the letter existed. */
  readonly at?: { readonly branch: string; readonly head: string };
}): string =>
  `letter — NOT DELIVERED to the standing address '${TIDY_UP_SLUG}' (turn for '${input.waitingOn}'): ${input.cause}. The tidy-up itself STANDS${
    input.at === undefined
      ? ""
      : ` — the work of '${input.role}' is committed as ${input.at.head} on '${input.at.branch}'`
  }; nobody has been told, so this line is the only trace`;

/** The delivered letter, as one line of the same journal — the counterpart of the above. */
export const describeDeliveredTidyUpLetter = (input: { readonly waitingOn: string }): string =>
  `letter — the outcome is posted to the standing address '${TIDY_UP_SLUG}', turn for '${input.waitingOn}'`;

/**
 * THE LOCK ON THE REPEAT (thread `133-tidy-letter-repeats-every-tick`) — the half of §1.3
 * of thread 099 that fell between two acceptances: "a dirty tree standing for hours means
 * ONE letter about ONE incident, and the cause is named".
 *
 * MEASURED, not deduced (msg-001 of 133, a probe on the live contour): two `orchestrator
 * run --fresh` over one dirty tree in the class "nothing moved" — the shim refuses the
 * first step of the tidy-up — left 1 → 2 letters in the standing address. Every tick plans
 * the commit again, fails again and posts again; ticks are a minute apart, so a standing
 * incident floods the receiver a human reads.
 *
 * WHAT IS COMPARED IS A SIGNATURE OF THE INCIDENT, not the fact that a letter was ever
 * sent. A lock that swallowed a NEW incident would be worse than the defect it fixes: the
 * role, the cause git gave and the composition of the dirt are all part of it, so a
 * different failure over the same tree still gets its letter.
 *
 * The `done` and `stranded` outcomes carry a fresh sha in every one of them, so they never
 * collide with a previous signature and this lock is inert for them by construction — it
 * is written over the whole outcome rather than over the failing branch only because
 * "which outcome was last told about this tree" is one fact and splitting it into two
 * would need the reader to know which of them to trust.
 */
export type TidyUpMemo = {
  /** The signature of the incident the last letter carried. */
  readonly signature: string;
  /** When that letter went, as it goes into the journal line of every suppressed tick. */
  readonly at: string;
  /** Whose turn that letter left — part of "where to look", not decoration. */
  readonly waitingOn: string;
  /** The branch the work or the dirt stands on, when the outcome knew one. */
  readonly branch?: string;
  /**
   * WHICH OF THE THREE OUTCOMES that letter carried (R5 of thread 133). It is read by
   * the refusal of the ticks that come after, and the distinction is the whole point
   * there: "the tidy-up FAILED" and "the circuit committed your work here" are opposite
   * statements about the same branch, and a refusal is allowed to make neither of them
   * up. Optional because a ledger written before R5 has no such field, and a reader that
   * threw on one would turn an old file into a broken launch: absent reads as "which
   * outcome is not recorded", and the refusal then says only what it can stand behind.
   */
  readonly outcome?: TidyUpOutcome["kind"];
};

/**
 * THE THREE THINGS THAT MAKE AN INCIDENT ITSELF, joined into one line: the ROLE whose tree
 * it is, the CAUSE the tidy-up failed with (or the address it succeeded at), and the
 * COMPOSITION OF THE DIRT. Change any one of them and it is a different happening, which
 * is exactly what R3 of the statement of work asks to be checked one by one.
 *
 * The join is `\u0000` for the ordinary reason: no field of it can contain the separator,
 * so two different signatures cannot collapse into one text.
 */
export const tidyUpSignature = (input: {
  readonly role: string;
  readonly dirt?: WorkspaceDirt;
  readonly outcome: TidyUpOutcome;
}): string => {
  const { outcome } = input;
  return [
    input.role,
    outcome.kind,
    outcome.kind === "failed" ? (outcome.branch ?? "") : outcome.branch,
    outcome.kind === "failed" ? "" : outcome.head,
    outcome.kind === "done" ? "" : outcome.cause,
    input.dirt === undefined ? "не прочитано" : describeWorkspaceDirt(input.dirt),
  ].join("\u0000");
};

/**
 * THE TICK THAT SAYS NOTHING NEW, as one line of the daemon's journal — and a line it MUST
 * print (R2). A silent suppression is indistinguishable from "the tidy-up went", and that
 * indistinguishability is the reason the second half of the requirement was written at
 * all: a human reading the log an hour later has to see that the incident is still
 * standing and where the one letter about it is.
 *
 * So it says both halves: that this incident has ALREADY been told about, and WHERE —
 * the standing address, whose turn is waiting on it, and the branch when there is one.
 */
export const describeSuppressedTidyUpLetter = (input: {
  readonly role: string;
  readonly memo: TidyUpMemo;
}): string =>
  `letter — SUPPRESSED, nothing new to say: this very outcome for '${input.role}' was already posted to the standing address '${TIDY_UP_SLUG}' at ${input.memo.at}, turn for '${input.memo.waitingOn}' — read it there${
    input.memo.branch === undefined ? "" : `; the branch is '${input.memo.branch}'`
  }`;

/**
 * THE STANDING INCIDENT, SAID INSIDE THE REFUSAL OF EVERY TICK AFTER IT (R5 of thread
 * `133-tidy-letter-repeats-every-tick`, curator's ruling of 2026-09-05).
 *
 * MEASURED (msg-003 §4 of 133, now the third tick of the process test): in the class
 * "the branch was made, the commit refused" the ticks that follow never reach the tidy-up
 * at all — the head was left on the service branch, and a head that is not the role's to
 * write to is refused BEFORE any commit is planned. So their refusal names a cause the
 * CIRCUIT ITSELF created and says nothing about the incident behind it; the third tick
 * does not even carry the cause git gave the first. A human arriving an hour later reads
 * a diagnosis that leads away from what happened, once per tick.
 *
 * The requirement of thread 099 was "one letter AND the cause is named". The first half
 * is the lock above; this is the second half in the one place the reader actually looks
 * on ticks 2..N — the refusal. It ADDS a sentence and removes nothing: the cause the tree
 * has right now is still the cause, and the refusal is still a refusal.
 *
 * It is only ever said about the branch the head is standing on: a memo about some other
 * branch is not an account of THIS refusal, and pointing at it would be the same defect
 * in the other direction.
 */
export const describeStandingTidyUpIncident = (input: {
  readonly role: string;
  readonly memo: TidyUpMemo;
}): string =>
  `And this head is where the circuit's own tidy-up of '${input.role}' left it: ${
    input.memo.outcome === "failed"
      ? "that tidy-up FAILED"
      : input.memo.outcome === "stranded"
        ? "that tidy-up committed the work and could not move the tree back"
        : input.memo.outcome === "done"
          ? "that tidy-up committed the work here"
          : "what that tidy-up did is not recorded in the ledger"
  }, and it was posted to the standing address '${TIDY_UP_SLUG}' at ${input.memo.at}, turn for '${input.memo.waitingOn}' — read the incident there, not here${
    input.memo.branch === undefined ? "" : `; the branch is '${input.memo.branch}'`
  }`;

/**
 * THE DECISION, as a pure function over the signature and what was remembered: post, or
 * stay quiet with a line that says why. Nothing here reads the disk — the caller owns
 * both the reading of the ledger and the writing of it, and writes ONLY after a delivery
 * that actually returned 0, because a letter that never arrived has told nobody and must
 * be tried again on the next tick.
 */
export const planTidyUpDelivery = (input: {
  readonly role: string;
  readonly signature: string;
  /** What the previous letter about THIS role's tree carried; absent — there was none. */
  readonly memo?: TidyUpMemo;
}): { readonly post: true } | { readonly post: false; readonly said: string } =>
  input.memo !== undefined && input.memo.signature === input.signature
    ? { post: false, said: describeSuppressedTidyUpLetter({ role: input.role, memo: input.memo }) }
    : { post: true };
