/**
 * WHAT AN `agent.kind` IS, AS A CONTRACT (thread 026, step 2).
 *
 * Until this file the package raised exactly one tool and said so in twenty places:
 * a flag name here, an environment variable there, a repair command dictated to a
 * human in five separate strings. The inventory of thread 026
 * (`docs/codex-kind-inventory.md`) counted them and drew the boundary this module
 * makes real — a kind is SEVEN properties and nothing else:
 *
 *  1. what its binary is called and which environment variable carries its account
 *     directory (`CLAUDE_CONFIG_DIR` for claude-code, `CODEX_HOME` for codex);
 *  2. how an argv is assembled out of prompt, tools, zones, turn ceiling, model,
 *     effort and continuation;
 *  3. which pipe carries the stream (stdout for both known tools — but codex puts its
 *     progress on stderr, so the question has to be ASKED rather than assumed);
 *  4. how four facts are read out of one stream line: session id, model, a step, the
 *     economics of the run;
 *  5. how a limit signal is read out of one stream line — INCLUDING the answer "there
 *     is nothing to read it from", which is the true state of codex today (B4 of the
 *     inventory: the rate-limit types exist in its protocol but never reach the JSONL
 *     of `codex exec`). A kind that silently answers "no limits ever" is a defect;
 *  6. how a box is probed (`doctor`) — the argv of the headless probe and, just as
 *     much, THE WORDS OF THE REPAIR handed to a human;
 *  7. what the kind DOES NOT HAVE. Codex has no `--allowedTools`, no settings-borne
 *     zone denial and no turn ceiling; that absence must be nameable, so that a door
 *     can refuse a role asking for a lever its tool lacks instead of quietly dropping
 *     it on the floor.
 *
 * The module is deliberately a DESCRIPTION and not a spawner: it holds no process,
 * opens no pipe and knows nothing about leases. The supervisor keeps doing that; it
 * merely stops guessing the vendor while it does.
 *
 * `claude-code` is the first implementation and is a REFACTORING, not a change: every
 * member below points at the function that already served the live circuit, and the
 * regression test of this step is the existing suite staying green.
 */
import { CODEX } from "./codex.js";
import { buildLaunchArgv, DEFAULT_EXEC, DEFAULT_WORKER, type LaunchArgvInput } from "./launch.js";
import { type QuotaSignal, quotaSignalOf, type WindowBoundary, windowBoundaryOf } from "./quota.js";
import {
  isAssistantStep,
  modelOf,
  type RunUsage,
  renderStreamLine,
  runUsageOf,
  sessionIdOf,
} from "./transcript.js";

/**
 * THE LEVERS A ROLE CAN ASK FOR THAT A TOOL MAY NOT HAVE (property 7). Named as a
 * closed list rather than free prose because these names are meant to be printed AT a
 * human in a refusal: "role 'dev-core' asks for zone denial, which kind 'codex' has
 * no lever for" is an answer; "unsupported option" is not.
 */
export type AgentLever =
  /** A ceiling on the number of steps of one run (`--max-turns`). */
  | "max-turns"
  /** An allow-list of tools handed to the session at spawn (`--allowedTools`). */
  | "allowed-tools"
  /** Zone denial carried INTO the session, so an edit outside the zone is refused as it happens (door 1 of thread 020). */
  | "zone-deny"
  /** A reasoning-effort parameter (R15). */
  | "effort"
  /** A limit signal in the stream at all — the difference between a shelf and a guess (thread 019). */
  | "quota-signal"
  /** A limit signal seen BEFORE the refusal, which is what a preventive shelf is built on (`windowOf`). */
  | "quota-window";

/**
 * HOW A KIND READS ITS OWN STREAM (properties 3-5). Four extractions plus the
 * rendering of a line for the log, and the two quota readers.
 *
 * `windowBoundaryOf` is OPTIONAL on purpose and it is the whole point of the shape:
 * a kind whose stream carries no forewarning of its window says so by not having the
 * member, and the caller then knows it is choosing between "shelve on refusal" and
 * "shelve preventively" rather than silently getting the weaker one.
 */
export type KindStream = {
  /** Which of the child's pipes carries the machine-readable stream. */
  readonly pipe: "stdout" | "stderr";
  readonly sessionIdOf: (line: string) => string | undefined;
  readonly modelOf: (line: string) => string | undefined;
  readonly runUsageOf: (line: string) => RunUsage | undefined;
  readonly isAssistantStep: (line: string) => boolean;
  readonly renderLine: (line: string) => string[];
  /** A refusal already suffered, read out of the stream. Absent = this kind cannot say. */
  readonly quotaSignalOf?: (line: string) => QuotaSignal | undefined;
  /** The edge of the current window, seen BEFORE the refusal. Absent = nothing to see. */
  readonly windowBoundaryOf?: (line: string) => WindowBoundary | undefined;
};

/** A tool the package knows how to raise, described by the seven properties above. */
export type AgentKind = {
  /** The value that appears in `agent.kind`, in `--worker` and in the header of a message. */
  readonly id: string;
  /** The binary when the machine file says nothing — looked up on `PATH`. */
  readonly defaultExec: string;
  /**
   * THE ONE VARIABLE THAT MAKES A SPAWN A DIFFERENT ACCOUNT. The model "an account is
   * a directory" (`accounts[].configDir`) carries over between the two known tools
   * unchanged — only the NAME of the variable differs, which is exactly why it belongs
   * to the kind and not to two hardcoded spots in `cli.ts` (A1 of the inventory).
   */
  readonly accountEnv: string;
  /** Property 2: the argv of a run. */
  readonly buildArgv: (input: LaunchArgvInput) => string[];
  /** Properties 3-5. */
  readonly stream: KindStream;
  /** Property 6: how `doctor` asks the binary to prove it can answer at all. */
  readonly probeArgv: (prompt: string) => readonly string[];
  /**
   * Property 6, the half that is easy to forget: WHAT A HUMAN IS TOLD TO TYPE when the
   * account has no live credentials. A door that advises `claude login` to an operator
   * holding a Codex key is worse than a door that says nothing.
   *
   * FOUR TEXTS IN THE PACKAGE DICTATE THIS SENTENCE and all four are routed through here
   * (`doctor`, `tick`, `init`, `auth`). The fifth site named by the statement of work —
   * the auth alarm of `notify` — is NOT one of them, and the difference is measured, not
   * assumed: its template names the account and the standstill and no command at all, so
   * there is nothing there to route. Why it stays that way is written where it stands
   * (`notify.ts`, above `BOX_ALARM_TEMPLATES.auth`): the alarm is keyed by an account,
   * and an account carries no kind.
   */
  readonly loginHint: (configDir?: string) => string;
  /** Property 7: levers this kind has no way to honour. Empty for claude-code. */
  readonly cannot: readonly AgentLever[];
};

/**
 * THE FIRST IMPLEMENTATION, AND A PURE MOVE. Every member here is the function the
 * circuit was already running; nothing about the raised session changes with this
 * file. That is the regression contract of step 2 of thread 026 — the repository
 * raises its own sessions with this code, so a refactoring that "improves" behaviour
 * on the way is a refactoring that cannot be told apart from a fault.
 */
export const CLAUDE_CODE: AgentKind = {
  id: DEFAULT_WORKER,
  defaultExec: DEFAULT_EXEC,
  accountEnv: "CLAUDE_CONFIG_DIR",
  buildArgv: buildLaunchArgv,
  stream: {
    pipe: "stdout",
    sessionIdOf,
    modelOf,
    runUsageOf,
    isAssistantStep,
    renderLine: renderStreamLine,
    quotaSignalOf,
    windowBoundaryOf,
  },
  // `-p` IS THE PROMPT HERE AND THE PROFILE ELSEWHERE (B1 of the inventory): on the
  // codex binary this same argv does not fail, it runs WRONG — asking for a profile
  // named "Answer with the single word: ok". That is the sharpest single argument for
  // this module existing: a flag is not a detail, it is a claim about a vendor.
  probeArgv: (prompt) => ["-p", prompt],
  // WITH the directory wherever the reader has one, WITHOUT it where they do not: a
  // path invented for a sentence is worse than a shorter sentence — `login` typed in
  // the wrong home leaves the shelf exactly where it was and reads as the alarm lying.
  loginHint: (configDir) =>
    configDir === undefined ? "claude login" : `CLAUDE_CONFIG_DIR=${configDir} claude login`,
  cannot: [],
};

/**
 * Every kind this package can raise, in the order they are offered to a reader —
 * `claude-code` first because it is the one the live circuit runs on.
 *
 * CODEX BEING IN THIS LIST MEANS ONE THING AND NOT ANOTHER (thread 026, step 3): the
 * package knows how to spell its argv, read its stream and probe its box, so
 * `--worker codex` is no longer refused as unimplemented. It does NOT mean a codex run
 * has ever happened — no key exists on this box yet, and every reading in `codex.ts`
 * comes from the vendor's declared schema rather than from a captured stream. What is
 * unknown there is answered by an absence (no limit readers, five levers in `cannot`),
 * never by a plausible value.
 */
export const AGENT_KINDS: readonly AgentKind[] = [CLAUDE_CODE, CODEX];

/** The kind by its id, or `undefined` for a name this package does not implement. */
export const kindOf = (id: string): AgentKind | undefined =>
  AGENT_KINDS.find((kind) => kind.id === id);

/**
 * WHAT THE BINARY OF A TOOL IS CALLED. Known for the kinds the package implements;
 * for anything else the id is the best guess there is, and a wrong guess costs
 * nothing — it is looked up on `PATH`, and a miss is a row asking for `--exec`, not a
 * failure.
 */
export const execNameOf = (id: string): string => kindOf(id)?.defaultExec ?? id;

/**
 * A KIND THIS PACKAGE DOES NOT IMPLEMENT, REFUSED BY NAME (discipline 4). The refusal
 * carries the three things its reader needs and none of the things they do not: what
 * they asked for, what exists, and the one field to change. A `--worker codex` typed
 * before codex is implemented must read as "not yet", never as a crash and never as a
 * silent fallback to claude-code — a fallback here would spend the wrong account.
 */
export const unknownKindRefusal = (id: string): string =>
  `agent kind '${id}' is not one this package can raise — known kinds: ${AGENT_KINDS.map((kind) => kind.id).join(", ")}. Name one of them in 'agent.kind' of the role (or in '--worker')`;

/**
 * ONE LEVER A ROLE ASKS FOR, AND THE FIELD THAT ASKS FOR IT. The second half is not
 * decoration: a refusal naming only the lever ("this kind has no zone denial") sends
 * its reader looking, while one naming the field ("the role's 'zones' turns into 3
 * deny rules") sends them to the line they have to change.
 */
export type LeverAsk = {
  readonly lever: AgentLever;
  /** Where the ask is written, in the words of the config — printed inside the refusal. */
  readonly where: string;
};

/**
 * WHAT THIS ROLE ASKS OF ITS TOOL, in the closed vocabulary of {@link AgentLever}.
 *
 * The inputs are the RESOLVED ones the spawn would have used, not the raw config: a
 * ceiling reaches a run through three layers (flag, role, package default) and only
 * the first two are a role ASKING for one. The package's own default is not an ask —
 * refusing on it would mean no kind without `--max-turns` could ever raise anything,
 * which is a refusal about us rather than about the config.
 *
 * TWO LEVERS OF THE LIST CANNOT APPEAR HERE, and their absence is the answer to the
 * question left open in thread 026: `quota-signal` and `quota-window` are in
 * `cannot` of codex, but nothing in a role's card asks for them — they are read from
 * a stream, not requested at a spawn. So this door never matches them, and they stay
 * named for the reader of `orchestrator status` and of the inventory. A name in
 * `cannot` is a statement about the TOOL; a match here is a statement about a ROLE.
 */
export const leversAskedFor = (input: {
  /** `launch.allowedTools` — the permission profile the session is raised with. */
  readonly allowedTools?: readonly string[];
  /** The deny rules built out of `zones` (door 1 of thread 020). */
  readonly denyRules?: readonly string[];
  /** The step ceiling ONLY when a human or the card set it — never the package default. */
  readonly maxTurns?: { readonly value: number; readonly source: string };
  /** The resolved reasoning effort (R15), with the layer that named it. */
  readonly effort?: { readonly value: string; readonly source: string };
}): readonly LeverAsk[] => {
  const asks: LeverAsk[] = [];
  if (input.allowedTools !== undefined && input.allowedTools.length > 0) {
    asks.push({
      lever: "allowed-tools",
      where: `'launch.allowedTools' names ${input.allowedTools.length} tool(s): ${input.allowedTools.join(", ")}`,
    });
  }
  if (input.denyRules !== undefined && input.denyRules.length > 0) {
    asks.push({
      lever: "zone-deny",
      where: `'zones' of the role turns into ${input.denyRules.length} deny rule(s) the session would be raised with`,
    });
  }
  if (input.maxTurns !== undefined) {
    asks.push({
      lever: "max-turns",
      where: `a ceiling of ${input.maxTurns.value} step(s) is set (${input.maxTurns.source})`,
    });
  }
  if (input.effort !== undefined) {
    asks.push({
      lever: "effort",
      where: `effort '${input.effort.value}' is set (${input.effort.source})`,
    });
  }
  return asks;
};

/**
 * THE LAUNCH DOOR OF PROPERTY 7 (thread 026, step 3, point 4). A role asking for a
 * lever its tool has no way to honour is REFUSED BY NAME — it is not raised with the
 * ask quietly dropped.
 *
 * WHY A REFUSAL AND NOT A WARNING. The three levers of the argv table are the ones a
 * reviewer reads as granted: `allowedTools` is what a session may touch, `zones` is
 * door 1 of thread 020, `max-turns` is what stops a run that has lost its way. A
 * session raised on a tool that silently ignores all three is not "the same run with a
 * caveat" — it is a run with permissions nobody assigned, and from the outside it
 * looks exactly like a run that obeyed. That is the same argument `resolveAgentParams`
 * already makes for model and effort, applied to the levers the kind declares.
 *
 * The refusal names the three things its reader needs: WHO asks (the role), WHAT the
 * tool cannot do (the lever, and the field that asks for it), and the two fields that
 * end the standstill. Nothing here suggests which of the two to choose — that is a
 * decision about the project, and it is not ours (R14).
 */
export const kindLeverRefusal = (input: {
  readonly kind: AgentKind;
  readonly role: string;
  readonly asks: readonly LeverAsk[];
}): string | undefined => {
  const blocked = input.asks.filter((ask) => input.kind.cannot.includes(ask.lever));
  if (blocked.length === 0) return undefined;
  const named = blocked.map((ask) => `${ask.lever} (${ask.where})`).join("; ");
  return `role '${input.role}' would be raised as '${input.kind.id}', which has no lever for ${blocked.length === 1 ? "one thing the role asks for" : `${blocked.length} things the role asks for`}: ${named}. Raising it anyway would drop them in silence — the run would look like one that obeyed. Either raise this role as a kind that has them ('launch.agent.kind' of the role, or '--worker'), or take those fields out of the role`;
};
