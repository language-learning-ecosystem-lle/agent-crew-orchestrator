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
 * - `event` — woken by a platform event (CI, webhook): nobody to wake or notify;
 * - `resident` — a process that is ALREADY reading the feed: nothing brings it the
 *   turn, because it never left. Added in R23-1 (thread `016-protocol-roadmap`) for
 *   a role hosted by a long-lived process rather than raised per turn.
 *
 * WHY `resident` IS A MODE AND NOT `event` PLUS A NORM IN A CARD. Both would keep the
 * circuit from raising the role, and there the resemblance ends. `wake` answers "what
 * brings this role the turn", and "nothing does, it is already here" is an honest
 * answer on THAT axis — whereas `event` says "a platform wakes it", which is false and
 * unfalsifiable. The cost of the lie is not aesthetic: ownership (R13) answers only for
 * roles the circuit can raise, so a resident dressed as `event` makes "which box hosts
 * it" data nobody checks, while R13 stands on a role belonging to EXACTLY ONE instance
 * and that being provable. The mode is what lets `ownershipIssues` keep asking.
 *
 * THE PRICE OF THE MODE, said here because it belongs beside the definition: A RESIDENT
 * FAILS SILENTLY. A `watch` role whose session died is repaired by the next tick; a
 * resident whose process died leaves the thread waiting with nobody saying so. The
 * answer is VISIBILITY, not liveness (a heartbeat is refused for the reason written in
 * `hold.ts`): a thread waiting on a resident role is spoken by the daemon every tick and
 * shown by `status` (`orchestrator/resident.ts`).
 *
 * `session` OF A `watch` ROLE IS RESERVED, AND ITS VALUE IS READ BY NOTHING IN
 * PRODUCTION (measured 2026-08-18, thread `012-wake-watch-reserved`). The MODE carries
 * weight — `roleLaunchability` refuses to raise a role that is not `watch`, and the
 * `launch permissions:` view filters by it — but the NAME reaches production code in a
 * single place: the cross-check in `roles/registry.ts` that no two roles claim the same
 * one. Nobody wakes by that name: the daemon raises a role by spawning the agent binary
 * and never asks which session to wake it in, and `watchTargets()`, which pairs the
 * roles with their names, is called only by tests. The field is kept and NOT cleaned
 * out (john, 2026-08-18) as the reservation the wake-by-name keeper of the resident
 * floor would stand on; this note is here so the next reader does not re-derive the
 * finding from a grep.
 */
export const wakeSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("self") }),
  z.strictObject({ mode: z.literal("via-human"), via: roleIdSchema }),
  z.strictObject({ mode: z.literal("watch"), session: z.string().min(1) }),
  z.strictObject({ mode: z.literal("event") }),
  z.strictObject({ mode: z.literal("resident") }),
]);

/**
 * Permissions that something follows from.
 *
 * - `thread-status` — editing a thread's `status` (closing a thread = acceptance);
 * - `launch-params` (R21) — saying in the feed which model and effort the runs of a
 *   thread are raised with. It is a permission and not a norm because the directive
 *   spends money and decides the quality of the work: a role able to write a message
 *   would otherwise be able to raise the whole thread on the strongest model, or
 *   quietly downgrade someone else's implementation run to the cheapest one. A
 *   directive from a role without it is IGNORED OUT LOUD when the candidate is
 *   chosen — not refused at the door, because the feed is append-only and a refusal
 *   there would be a permanent wedge on the thread.
 * - `thread-priority` (R5) — saying in the feed which of the waiting threads the
 *   orchestrator raises first. Separate from `launch-params` on purpose: "with what a
 *   thread is raised" and "what is raised before what" are different powers over
 *   somebody else's work, and a project may well want to hand out one without the
 *   other. Today both sit with the same two roles, so the split costs nothing and
 *   buys the ability to change that without a schema version.
 * - `task-declare` (thread 021) — OPENING a task in the feed and DROPPING one. Passing
 *   a task through (`in-progress`, `done`) needs no permission: that is execution, and
 *   whoever does the work reports it. Opening and dropping are acts of the STATEMENT OF
 *   WORK, and dropping is under the permission for one concrete reason — otherwise an
 *   agent could quietly take its own task off the board, which is the single way the
 *   board could lie in favour of whoever is writing. Unlike the two above, this one IS
 *   refused at the door: a task declaration is the protocol's own vocabulary and a
 *   crooked one would be a permanent row on a derived board, not a directive that some
 *   later resolution can ignore out loud.
 */
export const permissionSchema = z.enum([
  "thread-status",
  "launch-params",
  "thread-priority",
  "task-declare",
]);

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
/**
 * THE CEILINGS OF ONE ROLE'S RUN (R12, thread 016) — the shape deferred out of R6
 * on purpose: putting a global `orchestrator.limits` in then and migrating it to a
 * per-role one now would have cost two migrations for one decision.
 *
 * WHY BESIDE `allowedTools` AND NOT IN A SECTION OF THEIR OWN. The launch profile
 * already answers "what a raised session of this role may do"; how long it may run
 * and how many turns it may take is the same contract, and a role that needs
 * different permissions is exactly the kind of role that needs a different window.
 * A separate global section would also give the project two places to say one
 * thing: the package's defaults are already the global layer.
 *
 * EVERY FIELD IS OPTIONAL AND THERE IS NO DEFAULT HERE. A ceiling the config is
 * silent about falls through to the package default, and the resolution prints
 * WHERE each number came from (`resolveCeilings` in `orchestrator/launch.ts`) — a
 * ceiling that fired is worth nothing if one cannot tell who set it.
 *
 * The units are in the names: seconds for the clocks, a plain count for the turns.
 * `idleSeconds: 0` switches the idle detector off, exactly as `--idle 0` does — the
 * honest way to say "watch by the wall clock only".
 *
 * `waitInputSeconds` (R19) has NO such zero, deliberately: for the idle detector zero
 * means "never fire", which is a coherent thing to want, while for a wait it would
 * have to mean "parking is not allowed here" — a different kind of statement, and one
 * nobody has asked for. A project that does not want its sessions parking says so in
 * their cards; the minimum here is one second.
 *
 * `windDownSeconds` (R20) has no zero either, and for a stronger reason: zero would say
 * "this role need not land its work", which is the failure the norm exists against. Its
 * fall-through is also the only one here that is not a package constant — it is a share
 * of the RESOLVED window (`defaultWindDownSeconds`), so a role that shortens its runs
 * gets a proportionate landing without restating anything.
 */
export const launchLimitsSchema = z.strictObject({
  idleSeconds: z.number().int().min(0).optional(),
  wallClockSeconds: z.number().int().min(1).optional(),
  maxTurns: z.number().int().min(1).optional(),
  waitInputSeconds: z.number().int().min(1).optional(),
  windDownSeconds: z.number().int().min(1).optional(),
});

/**
 * THE EFFORT LEVELS `claude-code` ACCEPTS. A closed list, and this is the one place
 * in the schema where the package knows a vendor's vocabulary — knowingly: it is
 * inside the `claude-code` member of a union keyed on the tool, so what it knows is
 * scoped to the tool it names. The value is passed to `--effort`, and the levels are
 * that flag's own (`claude --help`).
 */
export const claudeCodeEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

/**
 * WHICH TOOL RAISES THE ROLE, AND WITH WHAT (R15, thread 016) — model and effort for
 * `claude-code`, other tools' equivalents when they arrive.
 *
 * WHY IN THE REPOSITORY CONFIG AND NOT ON THE MACHINE. "Which model a role thinks
 * with" is the same class of statement as "how many turns it may take" and "which
 * tools it may use": it decides what the work IS and what it costs. R14 draws the
 * line and this stands on the policy side of it — the machine is told only where the
 * binary is.
 *
 * WHY A UNION ON `kind` AND NOT A FLAT `model`/`effort` PAIR. The parameters are the
 * tool's, not the protocol's: `effort` is a `claude-code` flag with a `claude-code`
 * vocabulary, and a flat pair would quietly promise that whatever comes next takes
 * the same two. Keyed on the tool, a field the tool does not understand is a REFUSAL
 * AT THE DOOR rather than a value dropped in silence — the schemas are strict, so a
 * `cursor` member simply will not accept `effort`, and nobody has to remember that.
 *
 * DELIBERATELY NOT THE R8 ABSTRACTION. R8 (connectors) is the general shape of
 * "parameters of any tool"; this is a union of exactly the tools the package
 * implements, and each member carries the parameters that tool actually takes. The
 * second member arrived when the second kind did (thread 026) — read from the vendor's
 * declarations rather than guessed, which is why it was not written earlier.
 *
 * `kind` is ALSO the join with the machine config: the tool named here is the key
 * `local.json` maps to a binary path (`config/local.ts`). One id, said once.
 */
export const launchAgentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("claude-code"),
    /** `--model`: an alias (`opus`, `sonnet`) or a full name. Free-form — the list is the vendor's. */
    model: z.string().min(1).optional(),
    /** `--effort`: how hard the session thinks. Unsaid — the tool's own default. */
    effort: claudeCodeEffortSchema.optional(),
  }),
  /**
   * THE SECOND MEMBER, AND WHY IT ARRIVES ONLY NOW (thread 026). Until the package
   * could actually raise codex, a member here would have been a promise the code did
   * not keep — `launch.agent.kind: "codex"` accepted by the schema and refused at the
   * spawn is worse than refused at the door. Since #71 the kind is implemented
   * (`orchestrator/codex.ts`: argv, stream, probe, repair, `cannot`), so the schema
   * refusing the id became the last door lying about the tool: the only way to raise
   * codex was the `--worker` flag, and a card could not say what a card is for.
   *
   * `model` IS THE SAME KIND OF STATEMENT AS ABOVE and reaches the run the same way —
   * `-m <model>` (`utils/cli/src/shared_options.rs`, read in #71 and pinned in
   * `buildCodexArgv`). Free-form for the same reason: the list belongs to the vendor.
   *
   * NO `effort` FIELD HERE, AND THE ABSENCE IS A DECISION IN PROGRESS, NOT AN OVERSIGHT.
   * Codex HAS the lever — it spells it `-c model_reasoning_effort=<v>` — but the levels
   * it accepts are a vocabulary, and the one above (`claudeCodeEffortSchema`) is the
   * other vendor's. Which vocabulary a card may name, and whether the package validates
   * it at all or passes the string through, is a question about the form of
   * `agent-protocol.json`, so it goes to the thread and to john before it goes into a
   * schema (R14). Until it is answered a card naming `effort` on codex is refused by
   * this strict object BY THE KEY — the honest answer today — while an operator who
   * needs it types `--effort` on a run they can retype.
   */
  z.strictObject({
    kind: z.literal("codex"),
    /** `-m`: the model of the run. Free-form — the list is the vendor's. */
    model: z.string().min(1).optional(),
  }),
]);

export const launchSchema = z.strictObject({
  /** Session tools — passed to `--allowedTools` as is, order preserved. */
  allowedTools: z.array(z.string().min(1)).min(1),
  /** The ceilings of a run of THIS role; anything unsaid falls through to the package default. */
  limits: launchLimitsSchema.optional(),
  /** Which tool raises this role and with which parameters; unsaid — the package default tool. */
  agent: launchAgentSchema.optional(),
  /**
   * WHICH ACCOUNT OF THE TOOL THIS ROLE'S RUNS SPEND (thread 055) — an ID, and the
   * repository's half of the same join `agent.kind` makes with the binary (R14):
   * the project says WHICH account a role works on, the machine says WHERE that
   * account's directory is (`accounts` of the machine config).
   *
   * IT IS AN ID AND NOT A PATH, deliberately. A path to a credentials directory is
   * true of one box and of no other — that is R14's line and `exec` is already on
   * the far side of it. "Role X works on subscription A", by contrast, is a
   * statement ABOUT THE PROJECT: it decides whose quota a role burns, and a
   * reviewer has to be able to see it in a diff.
   *
   * THE SUBSCRIPTION IS NAMED IN NEITHER FILE. The id is a label (`main`,
   * `second`); which account stands behind it is known only to whoever logged in.
   *
   * Unsaid — the runs of this role inherit the box's own account, which is the
   * behaviour of every run before this field existed.
   */
  account: z.string().min(1).optional(),
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
   * Launch profile. Optional: roles the circuit never launches (john, the
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
export type LaunchLimits = z.infer<typeof launchLimitsSchema>;
export type LaunchAgent = z.infer<typeof launchAgentSchema>;
export type ClaudeCodeEffort = z.infer<typeof claudeCodeEffortSchema>;
