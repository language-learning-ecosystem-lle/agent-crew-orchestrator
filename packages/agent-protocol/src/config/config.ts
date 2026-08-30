/**
 * The protocol config is ONE file at the root of the repository where the
 * protocol is used (john's decision, 2026-07-23, thread `012-agent-protocol-package`,
 * msg-022).
 *
 * WHY ONE FILE AND NOT "the roles file". Roles are just one section of the
 * protocol; next to them live the mail directory and its branch, and tomorrow —
 * the connected transports. Add a separate `roles.json` and a month later a
 * second config file shows up beside it, turning "where is it written" back into
 * a question.
 *
 * WHY IN `main` AND NOT IN THE MAIL BRANCH. Writing straight to the mail branch
 * is a normal mode of the protocol, so a permissions config living there would
 * mean an agent can widen its own permissions with a commit that bypasses CI and
 * the reviewer. In `main` a permission change goes through a PR. As a side
 * effect the "two roots" problem disappears: the config and the files it points
 * at (role cards, review criteria) live in the same tree.
 *
 * `ROLES.md` IS ABOLISHED, not moved: the table became the `roles` section, zones
 * and permissions became fields, stop conditions became role cards
 * (`instructions`), and the prose about the role model became the protocol
 * document. Not a line of its own content was left, and two descriptions of one
 * set of roles drift apart by construction — the same conclusion as for INDEX
 * (thread 006) and for `waiting-on` in `_meta.md`.
 */
import { z } from "zod";

import {
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_VARIABLES,
  type AnnouncementKind,
  NOTIFICATION_KINDS,
  NOTIFICATION_VARIABLES,
  type NotificationKind,
} from "../notify/notify.js";
import { templateIssues } from "../notify/template.js";
import { roleSchema } from "../roles/schema.js";

/** Where the mail lives. Branch and directory are protocol data, not caller knowledge. */
export const mailSchema = z.strictObject({
  branch: z.string().min(1),
  dir: z.string().min(1),
});

/**
 * Where the orchestrator's operational state and the on-disk mail live — data of
 * the PROJECT, not knowledge of the caller (john's decision, thread 012, 22:45).
 * Until then the paths lived in correspondence: directory preparation, journal
 * path, holds folder and the exact daemon command were handed to a human as a
 * list in chat — that is, every next operation started by reconstructing the
 * command from memory.
 *
 * FILE NAMES INSIDE `state` ARE A PACKAGE CONVENTION, not config: the journal,
 * the flags and the holds directory belong to the orchestrator, and exposing them
 * by name would give the project six ways to lay out something it does not
 * manage. The project says WHERE (one directory), the package says WHAT is in it.
 *
 * The section is OPTIONAL: the package is designed as a foreign one, and a
 * repository that carries mail without an orchestrator is a legitimate case. Its
 * absence is caught when an orchestrator command is invoked, LOUDLY.
 */
export const orchestratorSchema = z.strictObject({
  /** Operational state directory (journal, flags, holds), relative to the repo root. */
  state: z.string().min(1),
  /** Checkout of the mail branch relative to the repo root; the mail dir inside is `mail.dir`. */
  mailCheckout: z.string().min(1),
  /** The point in history the daemon reads the config at: ref has no default anywhere. */
  ref: z.string().min(1),
  /**
   * LAUNCH ENVIRONMENT PREAMBLE — variables the project adds to the child process
   * on top of the inherited ones (curator's decision, thread 012, 12:10).
   *
   * Toolchain management (`nvm use` and the like) is NOT handed to the package:
   * that is knowledge about the project, and the package has none of it. The
   * project declares what its agent needs — as data; the package applies it and
   * SHOWS the result in `preflight`, instead of guessing about someone else's
   * toolchain.
   */
  env: z.record(z.string().min(1), z.string()).optional(),
  /**
   * WHERE A RAISED SESSION WORKS, AND FROM WHICH POINT IN HISTORY.
   *
   * `branch` began (before R17) as the EXPECTED branch of the checkout a session
   * inherited — the mismatch found by a launched session itself during the
   * 2026-07-25 acceptance, invisible from the outside. With `worktrees` declared it
   * means something better: the BASE a role's workspace is put at before every fresh
   * package. Same sentence, moved from a complaint to an instruction.
   *
   * `worktrees` is the directory the per-role worktrees live in, relative to the
   * repository root; a role's workspace is `<worktrees>/<role id>` (R17). It is
   * optional, and its absence is the pre-R17 behaviour verbatim: the session inherits
   * the operator's checkout and `branch` is compared against it. The package cannot
   * invent the directory — it would be creating git worktrees at a path nobody in the
   * project chose.
   */
  workdir: z
    .strictObject({
      branch: z.string().min(1),
      worktrees: z.string().min(1).optional(),
    })
    .optional(),
});

/**
 * A template slot: an optional string, checked against the vocabulary of its slot AT
 * THE DOOR (R4). The check lives in the schema rather than in the notifier because
 * of when it fires: a typo caught by `config check` in the PR that introduces it
 * costs a comment, and the same typo caught at send time costs the one message the
 * notifier exists for. `superRefine` reports every bad slot at once — the config is
 * edited by a human.
 */
const templateSlots = <Kind extends string>(
  kinds: readonly Kind[],
  variables: Readonly<Record<Kind, readonly string[]>>,
): z.ZodType<Partial<Record<Kind, string>>> => {
  const shape = Object.fromEntries(kinds.map((kind) => [kind, z.string().min(1).optional()]));
  return z.strictObject(shape).superRefine((value, context) => {
    for (const kind of kinds) {
      const template = (value as Partial<Record<Kind, string>>)[kind];
      if (template === undefined) continue;
      for (const issue of templateIssues(template, variables[kind])) {
        context.addIssue({ code: "custom", path: [kind], message: issue });
      }
    }
  }) as unknown as z.ZodType<Partial<Record<Kind, string>>>;
};

/**
 * NOTIFICATIONS: whom to tell is derived from the role model, WHAT to say and HOW to
 * deliver it are the project's (R4).
 *
 * The whole section is optional, like `orchestrator` before it: a repository that
 * notifies nobody is legitimate, and without a `transport` the command still renders
 * the message and prints it — the dry mode is the absence of a plugin rather than a
 * flag.
 *
 * `transport.module` is a MODULE SPECIFIER, and the vendor's name appears nowhere in
 * this package: the core produces events, delivery is a plugin (`transport-telegram`
 * is the first one). `options` are the plugin's own non-secret parameters, passed
 * through verbatim — the core does not interpret them, because the moment it did it
 * would need to know what a chat is. SECRETS ARE NOT HERE and cannot be: this file
 * is in git.
 */
export const notificationsSchema = z.strictObject({
  transport: z
    .strictObject({
      module: z.string().min(1),
      options: z.record(z.string().min(1), z.string()).default({}),
    })
    .optional(),
  templates: templateSlots<NotificationKind>(NOTIFICATION_KINDS, NOTIFICATION_VARIABLES).optional(),
  /**
   * AFTER HOW LONG A TURN THAT HAS NOT MOVED IS ITSELF AN EVENT (thread 024).
   *
   * It has a default rather than being off when unset, and that is the same argument
   * the English templates make: an unconfigured notifier that delivers nothing is
   * indistinguishable from a working one. Since v13 this is the ONLY automatic way a
   * question reaches a human — with the human outside the domain of the turn, "who is
   * awaited" cannot produce a line for one — so a project that has not thought about
   * N gets a loud default, not silence.
   */
  stalledAfterMinutes: z.number().int().min(1).default(180),
});

/**
 * ANNOUNCEMENTS: the texts the package writes INTO A THREAD (today exactly one — the
 * force-stop trace). Separate from `notifications` deliberately: the reader is a
 * conversation rather than a phone, there is no transport involved, and the two will
 * not grow together — a slot appears here whenever the package composes a message
 * somebody else's role signs, which is rare and always a decision.
 *
 * This is R1's leftover question closed (curator, 2026-07-25): the package's own
 * prose is English; a project whose threads are in another language says so as data.
 */
export const announcementsSchema = templateSlots<AnnouncementKind>(
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_VARIABLES,
);

/**
 * ONE BOX THAT RAISES ROLES (R13, thread `016-protocol-roadmap`).
 *
 * THE TOPOLOGY IS OPEN, IN THE REPOSITORY — it travels with `git pull`, so the boxes
 * agree about each other for free and a change to who-raises-what goes through a PR
 * like every other policy. What is machine-specific is the other half of the join:
 * which of these the box IS (`instance` in the machine config, R14). Secrets live in
 * neither — there are none here to keep.
 *
 * THERE IS NO ADDRESS FIELD, and its absence is a decision rather than an omission.
 * Instances never ask each other anything: a box PUBLISHES a digest of its own state
 * into the mail branch and reads the others' from there, so no address, no key and no
 * reachability is needed by anybody. An address "for later" would be exactly the
 * complexity-ahead-of-its-user this package refuses.
 *
 * `roles` IS THE LOAD-BEARING PART: a role belongs to exactly one instance
 * (`config check` refuses a role with none or with two), and that is what makes the
 * per-machine leases sufficient — two boxes cannot raise one role, by construction.
 */
export const instanceSchema = z.strictObject({
  id: z.string().min(1),
  /** The roles this box raises. Exactly one instance may claim a role. */
  roles: z.array(z.string().min(1)),
  /** A human's signature on the box: which machine this is. Not read by anything. */
  note: z.string().min(1).optional(),
  /**
   * THE ACCOUNT EVERY ROLE OF THIS INSTANCE SPENDS UNLESS IT NAMES ITS OWN (thread 055).
   *
   * The same id as `roles[].launch.account` and resolved in the same R14 join: the
   * repository names WHICH account, the machine says WHERE that id lives
   * (`accounts.<id>.configDir`). The subscription itself is named in neither.
   *
   * IT IS HERE AND NOT IN THE MACHINE CONFIG for the reason the role's field is: an
   * instance is the unit a project is hosted as, and "the crew instance runs on the
   * second subscription" decides whose quota a whole project burns — a statement a
   * reviewer has to see in a diff. Where that subscription's directory sits on one
   * box stays on that box.
   *
   * ABSENT MEANS WHAT SILENCE MEANT BEFORE THE FIELD: the roles of this instance are
   * raised on the account the box itself is logged into. A default is a fall-back for
   * a role that said nothing — it never overrides one that did.
   */
  account: z.string().min(1).optional(),
});

export const protocolConfigSchema = z.strictObject({
  /**
   * THE VERSION OF THE PROTOCOL SCHEMA the repository's data is at — see
   * `schema/version.ts`. It used to be `version`, a name that said nothing about
   * WHAT it versioned (the file? the package? the protocol?); the ambiguity became
   * load-bearing the moment migrations started keying off the number (R2).
   *
   * It is NOT a literal any more: the package supports one version at a time, but
   * the field has to PARSE at any of them — otherwise a repository one version
   * behind would fail as "invalid config" instead of as "run the migration", and
   * the difference between those two is the difference between a diagnosis and a
   * hunt. The comparison happens on the reading path, in the loader.
   */
  protocolVersion: z.number().int().min(1),
  mail: mailSchema,
  /**
   * HOW THE MAIL IS INVOKED ON THIS BOX — the prefix a raised session types before
   * `thread show` and `new-message` (v25, thread `038-pilot-codex-live-run`, the norm
   * «ПРОМПТ ПОДЪЁМА НЕ ПРИДУМЫВАЕТ ФАКТОВ О РОЛИ», john's decision of 2026-08-30).
   *
   * THE SUBCOMMANDS ARE THE PACKAGE'S, THE COMMAND IS THE PROJECT'S. `thread show` and
   * `new-message` are this package's own vocabulary and it may name them anywhere; what
   * carries them — a binary on `PATH`, a package script, a `node --import tsx …` line —
   * is a property of one deployment and the package has never known it. Until this field
   * the launch prompt wrote the literal `cli` anyway, and the literal is false on the box
   * that pays for this: `cli` is on no live deployment's `PATH` here, so the session that
   * believed the prompt got `exit 127` — four raises out of five of `pilot-codex`, twice
   * with the thread never reaching it at all.
   *
   * ABSENCE IS SILENCE, NOT A DEFAULT. A project that declares nothing gets a prompt that
   * names the subcommands and says out loud that the form of the invocation is not
   * declared here — read it off the role card. That is the whole repair the norm asks for:
   * silence a session fixes by reading its card, invention walks it into `exit 127`.
   *
   * IT IS ONE STRING AND NOT AN ARGV. The value is pasted into prose a session reads and
   * retypes into a shell, never spawned by this package — an array would promise an
   * execution contract nothing here honours.
   */
  mailCommand: z.string().min(1).optional(),
  orchestrator: orchestratorSchema.optional(),
  notifications: notificationsSchema.optional(),
  announcements: announcementsSchema.optional(),
  /**
   * The boxes that raise roles (R13). OPTIONAL, and its absence is the pre-R13
   * behaviour verbatim: one machine, every role — the package does not invent a
   * topology for a project that has not described one.
   */
  instances: z.array(instanceSchema).optional(),
  /**
   * WHERE THE CANON OF THE COMMIT ADDRESSES IS WRITTEN — a fact of the SERVED project,
   * asked rather than known (thread 080, 080.9).
   *
   * `doctor` points the operator at a dictionary of authorized signatures in two of its
   * rows. Until this field the path was a constant of the TOOL — one project's file name
   * compiled into a package designed to travel: in any other repository the pointer
   * resolves to nothing, and an operator sent to a file that is not there reads it as the
   * circuit being broken.
   *
   * A FLAG WOULD NOT HAVE FIXED IT. `doctor` is typed by hand and ad hoc; nobody types an
   * optional path, so the default would have kept deciding — the same defect behind a
   * door marked "configurable". The name of the dictionary is not an option of the caller,
   * it is a property of the repository being served, and it belongs where the mail branch
   * and the thread directory already are.
   *
   * ABSENCE IS NOT A DEFAULT. A project that declares nothing gets rows that say so, in
   * the same words #299 used for a declared file that is missing — and they stay a FACT,
   * never a cross: a project may legitimately have no dictionary, and the verdict of those
   * rows is about the box's signature, not about the repository's documentation.
   *
   * The path is relative to the repository being served; whether the file is actually there
   * is measured on the reading path, where there is a disk to measure it on.
   */
  identityDictionary: z.string().min(1).optional(),
  /**
   * THE DOCUMENTS OF POWER THIS PROJECT DECLARES — the declared half of the list guard 4
   * of `merge-gate` judges by (thread `025-power-docs-as-data`, john's decision of
   * 2026-08-21). Paths, relative to the repository being served; a directory prefix
   * matches everything under it, exactly as `zones` does.
   *
   * WHY IT IS DATA AND NOT A FLAG, WHICH IS WHAT IT WAS. The other half of the list is
   * DERIVED — every role's `instructions` plus the config itself — and derivation cannot
   * reach a document no role points at: a canon, a reviewer's criteria, the workflows of
   * the conveyor. Those arrived as `--power-docs` on the command line, so the completeness
   * of the guard equalled the memory of whoever typed the invocation. The string lives in
   * a role card and is copied by hand, and a guard held up by a copied string is the
   * silent door this package refuses everywhere else. The measurement that decided it
   * (thread `024`, msg-002): of 17 pull requests the merge-ready tier fired on, 4 touched
   * documents of power, and the derived half would have caught ONE.
   *
   * THE FLAG IS NOT REPLACED, IT IS DEMOTED. `--power-docs` keeps ADDING to this list: a
   * caller who knows something the config does not — a document that became one this
   * morning — must still be able to say so without a commit.
   *
   * ABSENCE IS NOT A DEFAULT AND IS NOT A REFUSAL. A repository that declares nothing gets
   * today's behaviour bit for bit. Which documents carry authority is a judgement about one
   * repository, and the package travels: naming `PROTOCOL.md` for everyone would re-create,
   * one repository at a time, the compiled-in default v17 has just finished removing.
   *
   * AND THE LIST IS READ FROM THE BASE OF THE PULL REQUEST, not from its head — the door
   * reads policy (`config/policy.ts`). So a PR that adds a path to this list is judged by
   * the list WITHOUT that path, which is right by construction: what a change proposes
   * about its own authority is not yet authority.
   */
  powerDocuments: z.array(z.string().min(1)).optional(),
  roles: z.array(roleSchema).min(1),
});

export type Instance = z.infer<typeof instanceSchema>;
export type Mail = z.infer<typeof mailSchema>;
export type Orchestrator = z.infer<typeof orchestratorSchema>;
export type Notifications = z.infer<typeof notificationsSchema>;
export type Announcements = z.infer<typeof announcementsSchema>;
export type ProtocolConfig = z.infer<typeof protocolConfigSchema>;

/** Parse an unchecked value into a config. Throws ZodError with the list of complaints. */
export const parseProtocolConfig = (raw: unknown): ProtocolConfig =>
  protocolConfigSchema.parse(raw);

/** The default config name is a convention of the PACKAGE itself, not knowledge about the project. */
export const DEFAULT_CONFIG_PATH = "agent-protocol.json";
