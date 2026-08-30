/**
 * WHAT A ROLE MAY DO TO THE BOX — the closed set, declared as data (thread `047-devops-role`,
 * john's decision of 2026-08-29 «capabilities твои», composed by curator on 2026-08-30).
 *
 * The role `devops` exists to do by machine what john does today by hand on the box: read the
 * tail of a log, refresh a checkout, ask how much disk is left. The whole construction stands on
 * ONE distinction (record `016` of 2026-08-29): a VERB is not an ACCESS. A capability named
 * `log-tail` whose journal comes out of a closed list is a verb; a capability that takes a
 * command line — or a path as a free string — is access to the box wearing a verb's name, and
 * every door built above it is decoration.
 *
 * SO EVERY PARAMETER IS A CLOSED LIST, AND THE LIST IS IN THE CONFIG. Not in this file: what
 * `devops` may refresh on THIS box is a fact of this project, it changes with the box, and it
 * belongs where a change to it costs a PR to a document of power. This file pins the GRAMMAR —
 * which capabilities exist, which parameter each one carries, that the list is non-empty — and
 * the config pins the VALUES. A capability whose list is empty is refused here by name: an empty
 * closed list is not "nothing allowed", it is a declaration that says nothing and would be read
 * later as either.
 *
 * NO ROOT IN THIS SET, and that is a property of the three, not a field to be checked: all of
 * them are executable by the rights of one ordinary user who owns nothing of `lle`'s but shares
 * a group with it (`tail`/`journalctl` on a readable file, `git pull --ff-only`, `pnpm install`,
 * `df`). An action that needs root is a NEW capability and a separate decision of john's — so it
 * arrives as a new member of this union, visibly, rather than as a value inside an existing one.
 *
 * WHY THERE IS NO `service-restart` AND NO `service-status` HERE — and why their absence is a
 * decision rather than an omission. The set composed on 2026-08-30 carried five verbs; the two
 * that touched systemd were struck the same day (john, ~08:15Z, on curator's finding: «(A)
 * сейчас, (B) — если окажется, что рестарт нужен часто»). The reason is a property of systemd,
 * not of our настройки: the daemons of both circuits are USER units of the user `lle`, a user
 * bus belongs to its own user, and a separate identity — which is the whole point of
 * `systemUser` — cannot restart or even query them without root, a polkit rule, or moving the
 * units to the system level. A verb that the operating system refuses by construction is not a
 * narrower right, it is a declaration that lies. The two return with decision (B), as new
 * members of this union at a new schema number, when the count of restarts john does by hand
 * makes the price of the root path visible — and the count is kept in the thread, not felt.
 *
 * WHAT THIS FILE IS NOT. It is not the door that answers a CALL. The role is `planned` and
 * nothing in this build reads the field, so there is no call surface to refuse anything at — the
 * refusals here are the ones a DECLARATION can get wrong (a capability nobody declared, an empty
 * list, a parameter that belongs to another capability). The refusals of a call — «возможность
 * не объявлена», «параметр вне списка», «цель не объявлена» — and the trace every state-changing
 * call leaves are the executor's, and the executor is a later tact.
 *
 * The system user `aco-devops` DOES exist on the box now (john's hand of 2026-08-30 ~08:20Z, the
 * class-2 acceptance of `docs/box-setup.md` §0.1 taken under it and passed whole) — so what is
 * missing is no longer an identity but an executor, and this file says so rather than repeating
 * a state of the box. That distinction is the reason the sentence above was rewritten within a
 * day of being written: prose that restates the box goes stale the moment a hand touches it, and
 * a stale declaration reads exactly like a current one.
 */
import { z } from "zod";

/**
 * The three verbs. A closed vocabulary, and the discriminator of the union below: a name outside
 * it is refused with the whole list quoted, because "unknown capability" without the set is a
 * refusal a reader cannot act on. `service-restart` and `service-status` are outside it on
 * purpose (see the head of this file) — a config that names one of them is refused here, by the
 * same refusal as a typo, and that is the intended answer until decision (B) puts them back.
 */
export const CAPABILITY_NAMES = ["log-tail", "repo-refresh", "disk-free"] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** The ceiling of `log-tail`: a tail is a tail, not a way to read a journal out through the mail. */
export const LOG_TAIL_MAX_LINES = 200;

const EMPTY_LIST = (parameter: string, capability: string): string =>
  `the closed list '${parameter}' of the capability '${capability}' is empty — a capability whose parameter accepts nothing is not a narrower right, it is a declaration that says nothing; name the values or drop the capability`;

/** A closed list of literal values a parameter accepts. Non-empty, and its members are names. */
const closedList = (parameter: string, capability: string) =>
  z.array(z.string().min(1)).min(1, EMPTY_LIST(parameter, capability));

export const capabilitySchema = z.discriminatedUnion("name", [
  /**
   * The tail of a named log. `logs` is the closed list of what may be read — a daemon log of a
   * circuit by path, a journal by the unit it belongs to; `maxLines` is the ceiling of one call.
   */
  z.strictObject({
    name: z.literal("log-tail"),
    logs: closedList("logs", "log-tail"),
    maxLines: z
      .number()
      .int()
      .min(1)
      .max(
        LOG_TAIL_MAX_LINES,
        `the ceiling of 'log-tail' is ${LOG_TAIL_MAX_LINES} lines: a bigger tail is a copy of the journal through a door built for a glance at it`,
      ),
  }),
  /**
   * `git pull --ff-only` + `pnpm install` in a named checkout, and NOTHING else — no `checkout`,
   * no `reset`, no `rebase`, no `push`, no branch and no role's workspace. The hard boundary is
   * the verb, not a flag of it: a dirty tree is refused BY NAME by the executor rather than
   * repaired, because repairing somebody else's uncommitted work is the one move nobody can undo.
   */
  z.strictObject({
    name: z.literal("repo-refresh"),
    checkouts: closedList("checkouts", "repo-refresh"),
  }),
  /** Free space. No parameters, so the strict object refuses every key: there is nothing to aim. */
  z.strictObject({ name: z.literal("disk-free") }),
]);

export type Capability = z.infer<typeof capabilitySchema>;

/**
 * The capabilities of one role. Optional and with NO DEFAULT: absence is "this role does nothing
 * to the box", which is every role that runs today, and a default of `[]` would say the same
 * thing while looking like a decision somebody made.
 *
 * A name may appear once. A second row for the same verb would leave two closed lists for one
 * parameter and no rule saying which one holds — and the reader who has to guess is the door.
 */
export const capabilitiesSchema = z
  .array(capabilitySchema)
  .min(1, "declare the capabilities or leave the field out: an empty list is not a declaration")
  .superRefine((capabilities, ctx) => {
    const seen = new Set<string>();
    for (const [index, capability] of capabilities.entries()) {
      if (!seen.has(capability.name)) {
        seen.add(capability.name);
        continue;
      }
      ctx.addIssue({
        code: "custom",
        path: [index, "name"],
        message: `the capability '${capability.name}' is declared twice — two closed lists for one verb, and nothing says which of them holds`,
      });
    }
  });
