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
  orchestrator: orchestratorSchema.optional(),
  notifications: notificationsSchema.optional(),
  announcements: announcementsSchema.optional(),
  roles: z.array(roleSchema).min(1),
});

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
