/**
 * The protocol's role model as DATA (phase P1, thread `012-agent-protocol-package`).
 *
 * Before this, roles lived as prose in `ROLES.md` and behaviour was derived from
 * it by eye and by bash scripts: the list of known roles was cut out of a
 * markdown table with awk, the set of notified roles was hardcoded as
 * `NOTIFY_ROLES="john curator"`, the tmux session name was assembled from the
 * template `lle-<role>`, and "who to poke so that curator wakes up" was written
 * down nowhere at all — it lived in a comment inside the notifier's awk program.
 *
 * WHAT EXACTLY BECAME DATA AND WHY. The schema holds exactly what today DERIVES
 * the behaviour of the live circuit, not everything one could say about a role:
 *
 * - `wake` — how a role learns the turn has passed to it. This is the only field
 *   from which both the watch-keeper's job (whom to wake and in which session)
 *   and the notifier's job (whom to call and with which wording) follow. The
 *   difference between "⏳ your turn" and "🔔 open the chat and poke them"
 *   (thread 008) is not cosmetics: a dev role has a session and a watch-keeper,
 *   an assistant has neither and only comes alive through a human. In prose that
 *   difference was explained; in data it is expressed.
 * - `kind` — NOT interpreted by the package (a free-form string): "claude.ai",
 *   "gh-action" are labels of one particular project. Behaviour is derived from
 *   `wake`/`permissions`, not from the vendor. Otherwise a neutral package would
 *   know about our stack.
 * - `permissions` — today there is exactly one: by john's decision of 2026-07-22,
 *   editing a thread's `status` is held by curator and john (closing a thread =
 *   acceptance, which cannot be handed to the implementer). Enforcement arrives
 *   in the P2 validator; the model must be able to express this already now,
 *   otherwise P2 would start with a schema migration.
 * - `zones` — data with no code consumer at P1 (deliberately, noted in the
 *   README): their consumer is the role card during onboarding on a new project
 *   (P4). Leaving them as prose would mean the config cannot become the source of
 *   `ROLES.md`, which is the whole point.
 *
 * Unknown fields are an error, not "let's ignore them": a typo in a field name
 * yields a silent default, that is exactly the class of quiet defects the package
 * is being written for (pains 1-6 of the statement of work).
 */
import { z } from "zod";

/** Role identifier: the same token appears in `waiting-on` and in a message's `from:`. */
export const roleIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "a role id is lowercase latin, digits and hyphen only (it goes into `waiting-on` and is parsed as a token)",
  );

/**
 * How a role learns the turn is its own.
 *
 * - `self` — a human: learns from the notification themselves, nobody to wake;
 * - `via-human` — an assistant without a process of its own: comes alive only
 *   when the named human opens the chat. `via` is exactly whom to call
 *   (previously a hardcoded "john" in the notifier's text);
 * - `watch` — an agent with its own session: the watch-keeper wakes it, and
 *   `session` is that very agreement about the name the keeper relies on;
 * - `event` — woken by a platform event (CI, webhook): nobody to wake or notify.
 */
export const wakeSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("self") }),
  z.strictObject({ mode: z.literal("via-human"), via: roleIdSchema }),
  z.strictObject({ mode: z.literal("watch"), session: z.string().min(1) }),
  z.strictObject({ mode: z.literal("event") }),
]);

/** Permissions that something follows from. Today exactly one — see the doc block. */
export const permissionSchema = z.enum(["thread-status"]);

/** Role lifecycle: planned → active → paused/retired (rows are never deleted). */
export const roleStatusSchema = z.enum(["planned", "active", "paused", "retired"]);

/**
 * Role instructions are an ARRAY, order = reading order (the project-wide rules
 * first, then the role card).
 *
 * Two fields (`common` + `card`) would impose our taxonomy on a neutral package,
 * and tomorrow a role will turn out to have three sources or no common one at
 * all. `kind` means the WAY IT IS EXECUTED, not whether a file exists:
 * `external` — the text lies in the repository but is executed outside (a skill
 * on the chat side). This is the only place with no machine guarantee — the copy
 * may drift from the live skill, and we do not promise otherwise.
 */
export const instructionsSchema = z.strictObject({
  kind: z.enum(["in-repo", "external"]),
  path: z.string().min(1),
  note: z.string().min(1).optional(),
});

export const zonesSchema = z.strictObject({
  writes: z.array(z.string().min(1)).default([]),
  forbidden: z.array(z.string().min(1)).default([]),
});

/**
 * THE PERMISSIONS OF A LAUNCHED SESSION are part of the launch contract (john's
 * decision, thread 012, 23:30), not a property of the environment.
 *
 * The trigger was the first production run: the circuit launched a real session,
 * it lived five minutes and exited having written nothing. The spawn did not pass
 * `--allowedTools`, and a default `claude -p` does not write — that is, the role
 * physically could not do the one thing it is launched for. There was no notion
 * of permissions in the contract at all: S1 was built around "whom and with which
 * prompt".
 *
 * WHY PER-ROLE: role permissions will diverge (dev-speech has its own zone), and
 * they must be read from the role card, not from the launcher's code.
 *
 * THE BOUNDARY IS NOT HERE, and one has to know that in order not to mistake this
 * for a defence it is not: a role needs `Bash` (run tests, commit, push), and with
 * `Bash` granted, restricting the rest of the tools adds little. The real defences
 * are structural and stand outside: code only through PRs, the reviewer, branch
 * protection on `main`, the lease deadline, the run ceiling, stop/force in john's
 * hands.
 */
export const launchSchema = z.strictObject({
  /** Session tools — passed to `--allowedTools` as is, order preserved. */
  allowedTools: z.array(z.string().min(1)).min(1),
});

export const roleSchema = z.strictObject({
  id: roleIdSchema,
  /** Project label for the role type; the package does not interpret it, only cross-checks it with the doc. */
  kind: z.string().min(1),
  status: roleStatusSchema,
  wake: wakeSchema,
  summary: z.string().min(1),
  permissions: z.array(permissionSchema).default([]),
  zones: zonesSchema.optional(),
  instructions: z.array(instructionsSchema).min(1).optional(),
  /**
   * Launch profile. Optional: roles the circuit never launches (john, curator,
   * gh-actions) must not have one. Its absence on a LAUNCHABLE role is a loud
   * refusal in `roleLaunchability`, not a silent default: a default here would
   * mean "launched with permissions nobody assigned".
   */
  launch: launchSchema.optional(),
});

export type RoleId = string;
export type Wake = z.infer<typeof wakeSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type RoleStatus = z.infer<typeof roleStatusSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Instructions = z.infer<typeof instructionsSchema>;
export type Launch = z.infer<typeof launchSchema>;
