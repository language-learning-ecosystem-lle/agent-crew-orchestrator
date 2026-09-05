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
