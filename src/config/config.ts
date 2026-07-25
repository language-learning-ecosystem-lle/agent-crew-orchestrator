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
   * EXPECTED STATE OF THE WORKING REPOSITORY the launched session lands in.
   * Found by a launched session itself (acceptance 2026-07-25): it inherits the
   * working directory as is and may start work from an arbitrary foreign branch —
   * and, unlike stale mail, the mismatch is not visible from the outside.
   *
   * Preflight will ALWAYS show the state (the fact is free), but REFUSAL is
   * opt-in: "the right branch" is knowledge of the project, not of the package.
   */
  workdir: z.strictObject({ branch: z.string().min(1) }).optional(),
});

export const protocolConfigSchema = z.strictObject({
  version: z.literal(1),
  mail: mailSchema,
  orchestrator: orchestratorSchema.optional(),
  roles: z.array(roleSchema).min(1),
});

export type Mail = z.infer<typeof mailSchema>;
export type Orchestrator = z.infer<typeof orchestratorSchema>;
export type ProtocolConfig = z.infer<typeof protocolConfigSchema>;

/** Parse an unchecked value into a config. Throws ZodError with the list of complaints. */
export const parseProtocolConfig = (raw: unknown): ProtocolConfig =>
  protocolConfigSchema.parse(raw);

/** The default config name is a convention of the PACKAGE itself, not knowledge about the project. */
export const DEFAULT_CONFIG_PATH = "agent-protocol.json";
