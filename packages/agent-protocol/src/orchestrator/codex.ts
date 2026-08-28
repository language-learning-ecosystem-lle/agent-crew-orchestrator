/**
 * CODEX AS THE SECOND `agent.kind` (thread 026, step 3) — the tool described, not yet
 * raised on a live key.
 *
 * EVERY FACT BELOW CARRIES ITS SOURCE, and that is a rule of this file rather than a
 * courtesy: a fixture without a source is indistinguishable from an invention a week
 * later (statement of work, step 3.2). Two sources are used and no third:
 *
 *  - `openai/codex` at the tree of the npm shim `@openai/codex@0.149.0`, files under
 *    `codex-rs/` — cited as `<file>:<line>`;
 *  - the vendor's own pages `developers.openai.com/codex/{auth,noninteractive}.md`.
 *
 * NOT ONE LINE HERE WAS SEEN COMING OUT OF A RUNNING `codex`. There is no key on this
 * box yet (the operator's step is written up in `docs/codex-kind-inventory.md`, section
 * C), so the readings below are read off the vendor's declared schema
 * (`codex-rs/exec/src/exec_events.rs`) and nothing else. That is a weaker kind of
 * evidence than a captured stream and the difference is stated where it matters:
 * what the schema DOES NOT declare — the model of the run, the cost, any limit signal
 * at all — is answered here with "nothing to read", never with a plausible zero.
 */
import { z } from "zod";

import type { AgentKind, AgentLever } from "./kind.js";
import type { LaunchArgvInput } from "./launch.js";
import type { RunUsage } from "./transcript.js";

/** The id in `agent.kind`, in `--worker` and in the header of a message. */
export const CODEX_WORKER = "codex";

/** The binary the npm shim installs (`@openai/codex`), looked up on `PATH`. */
export const CODEX_EXEC = "codex";

/**
 * THE EIGHT EVENT TYPES OF `codex exec --json`, exactly as the vendor declares them
 * (`codex-rs/exec/src/exec_events.rs:11-36`): `thread.started`, `turn.started`,
 * `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`,
 * `error`.
 *
 * The shape is deliberately LOOSE about everything it does not read (`passthrough` and
 * optional fields everywhere): the parser's job is to answer four questions off a line,
 * not to be a second copy of the vendor's schema that goes stale on their next release.
 * A line that fails this parse is not a failure of the run — it is a line this package
 * has nothing to say about, and the log keeps it verbatim.
 */
const codexEvent = z
  .object({
    type: z.string(),
    /** `thread.started` → the id `codex exec resume <id>` takes (`exec_events.rs:39-43`). */
    thread_id: z.string().optional(),
    /** `turn.completed` → the only economics the vendor reports (`exec_events.rs:49-72`). */
    usage: z
      .object({
        input_tokens: z.number().optional(),
        cached_input_tokens: z.number().optional(),
        cache_write_input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        reasoning_output_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    /** `item.*` → the unit of work; `agent_message` is the nearest thing to a step (`exec_events.rs:104-108`). */
    item: z
      .object({ id: z.string().optional(), type: z.string().optional() })
      .passthrough()
      .optional(),
    /** `turn.failed` → the loose prose that is all a failure ever says (`exec_events.rs:53-56`). */
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
    /** `error` → the same prose at the top level (`exec_events.rs:88-92`). */
    message: z.string().optional(),
  })
  .passthrough();

type CodexEvent = z.infer<typeof codexEvent>;

/** One line → the event it is, or `undefined` for anything that is not this stream. */
const eventOf = (line: string): CodexEvent | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const parsed = codexEvent.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};

/**
 * THE ID OF THE SESSION — `thread.started` → `thread_id` (`exec_events.rs:39-43`). It is
 * the same string `codex exec resume <SESSION_ID>` takes (`codex/noninteractive.md`),
 * which is what makes it the analogue of our `session_id` and not merely a name.
 */
export const codexSessionIdOf = (line: string): string | undefined => {
  const event = eventOf(line);
  if (event?.type !== "thread.started") return undefined;
  return event.thread_id === undefined || event.thread_id === "" ? undefined : event.thread_id;
};

/**
 * WHICH MODEL RAN — AND THE HONEST ANSWER IS "THIS STREAM DOES NOT SAY".
 *
 * None of the eight event types declares a model field (`exec_events.rs:11-36`, read in
 * full; B3 of the inventory says the same after the same reading). So this returns
 * `undefined` for every line, always, and the caller's display falls back the way it
 * already does for a run whose init line never arrived.
 *
 * WHY NOT ECHO WHAT WE ASKED FOR instead: `-m <model>` is what the supervisor PASSED,
 * and the run's model is what the vendor CHOSE — on a role that names no model those
 * are different facts, and a reader who sees a model in the log is entitled to believe
 * the tool said it. An empty answer that is true beats a filled one that is inferred.
 */
export const codexModelOf = (_line: string): string | undefined => undefined;

/**
 * A STEP OF THE SESSION — `item.completed` carrying an `agent_message`
 * (`exec_events.rs:104-108`).
 *
 * THE UNIT IS NOT OURS AND IS NOT CLAIMED TO BE. Our `steps` already parted ways with
 * claude-code's `num_turns` (A4 of the inventory); codex counts items of several types
 * and only one of them is the assistant speaking. Counting `agent_message` is the
 * closest true statement available: "the session said something out loud N times".
 */
export const codexIsAssistantStep = (line: string): boolean => {
  const event = eventOf(line);
  return event?.type === "item.completed" && event.item?.type === "agent_message";
};

/**
 * WHAT A FINISHED RUN BURNED — `turn.completed` → `usage` (`exec_events.rs:49-72`).
 *
 * THREE OF OUR SIX FIELDS ARE ABSENT AND STAY ABSENT: the vendor reports no turn count,
 * no wall time and NO COST (B3: `total_cost_usd` has no counterpart — codex does not
 * price its own run). They are omitted rather than zeroed, because a zero here would be
 * read as "this run was free" by every display that shows it.
 *
 * `reasoning_output_tokens` IS NOT ADDED TO `out`, deliberately. The schema lists it
 * beside `output_tokens` and never states whether it is already counted inside it;
 * adding it would double-count if it is, and our `out` would stop meaning the vendor's
 * own `output_tokens`. The number carried is the vendor's, unedited — the day a live
 * run settles the question, this is one line to change and one test to re-pin.
 */
export const codexRunUsageOf = (line: string): RunUsage | undefined => {
  const event = eventOf(line);
  if (event?.type !== "turn.completed") return undefined;
  const usage = event.usage;
  if (usage === undefined) return {};
  return {
    tokens: {
      in: Math.max(0, Math.round(usage.input_tokens ?? 0)),
      out: Math.max(0, Math.round(usage.output_tokens ?? 0)),
      cacheWrite: Math.max(0, Math.round(usage.cache_write_input_tokens ?? 0)),
      cacheRead: Math.max(0, Math.round(usage.cached_input_tokens ?? 0)),
    },
  };
};

/** A line of the codex stream as the log shows it — one row, or the line verbatim. */
export const codexRenderLine = (line: string): string[] => {
  const trimmed = line.trim();
  if (trimmed === "") return [];
  const event = eventOf(line);
  if (event === undefined) return [trimmed]; // not this stream at all — kept as it came
  switch (event.type) {
    case "thread.started":
      return [`thread started  session ${event.thread_id ?? "?"}`];
    case "turn.started":
      return ["turn started"];
    case "turn.completed": {
      const usage = event.usage;
      return [
        usage === undefined
          ? "turn completed"
          : `turn completed  in ${usage.input_tokens ?? 0} out ${usage.output_tokens ?? 0}`,
      ];
    }
    case "turn.failed":
      return [`turn failed  ${event.error?.message ?? "(no message)"}`];
    case "error":
      return [`error  ${event.message ?? "(no message)"}`];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return [`${event.type}  ${event.item?.type ?? "?"}`];
    default:
      // A ninth type shipped by a newer codex: named, not swallowed, not crashed on.
      return [`${event.type}`];
  }
};

/**
 * THE EFFORT LEVELS CODEX ACCEPTS (thread 026, П2; john's decision of 2026-08-24) — a
 * closed list, and it lives HERE rather than in the schema for the reason the schema's
 * own `claudeCodeEffortSchema` states about the other vendor: a vocabulary belongs to the
 * tool that owns it, and this file is the one place that speaks for codex.
 *
 * THE SOURCE IS THE VENDOR'S CONFIG REFERENCE, read once by an agent with no network in
 * the session (`developers.openai.com/codex/config.md`, `model_reasoning_effort`), and
 * that provenance is stated because it is weaker than a captured run: nothing on this box
 * has ever seen codex accept or refuse one of these strings.
 *
 * FIVE LEVELS, AND TWO NEIGHBOURS DELIBERATELY LEFT OUT:
 *
 *  - `minimal` is the one level the other vendor does not have, and `max` is the one the
 *    other vendor has and codex does not. That asymmetry is the whole argument for two
 *    vocabularies instead of one shared enum: `--effort max` on codex would otherwise be
 *    a dead run with a spent lease instead of a refusal that lists what codex takes;
 *  - `plan_mode_reasoning_effort` and its sixth value `none` are NOT in this list. That
 *    setting governs a mode this package never raises (`codex exec` is not plan mode), so
 *    admitting `none` would be accepting a word the run cannot honour.
 */
export const codexEffortSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"]);

/**
 * WHAT `toolsHeldBy: "sandbox-read-only"` PUTS ON THE COMMAND LINE. The card's assertion
 * is not a comment: the token it names is the token the run carries (thread 026, П1-3).
 * `--sandbox read-only` is the vendor's own spelling (`exec/src/cli.rs`), already used by
 * {@link CODEX.probeArgv} for the same reason — a process that can write is a process
 * whose confinement is a claim rather than a fact.
 */
export const CODEX_READ_ONLY_ARGV: readonly string[] = ["--sandbox", "read-only"];

/**
 * THE ARGV OF A CODEX RUN — and four differences from claude-code, each of which would
 * have been a silent misfire if this module did not exist (B2 of the inventory).
 *
 *  1. HEADLESS IS A SUBCOMMAND, NOT A FLAG: `codex exec [OPTIONS] [PROMPT]`
 *     (`exec/src/cli.rs:12-13`);
 *  2. THE PROMPT IS POSITIONAL (`exec/src/cli.rs:76-80`) and goes LAST, after the
 *     options — a prompt beginning with a dash is the reason argv order is not a taste
 *     question here;
 *  3. `--json` is the stream (`exec/src/cli.rs:59-66`), not
 *     `--output-format stream-json --verbose`;
 *  4. `--skip-git-repo-check` is REQUIRED of us and has no counterpart on the other
 *     tool: codex refuses to run outside a git repository (`exec/src/cli.rs:31-33`),
 *     and a role's workspace is a git worktree today but the refusal would arrive as a
 *     dead session rather than as a diagnosis.
 *
 * EFFORT IS A CONFIG OVERRIDE, NOT A FLAG: `-c model_reasoning_effort=<v>`
 * (`utils/cli/src/config_override.rs:30-32`, field `reasoning_effort` at
 * `protocol/src/protocol.rs:2070`). It is still the `effort` lever of R15 — codex HAS
 * it, it just spells it as configuration, which is why `effort` is absent from
 * {@link CODEX_CANNOT}.
 *
 * THREE INPUTS ARE DROPPED ON PURPOSE AND LOUDLY: `launch.allowedTools`, `denyRules`
 * and `maxTurns` reach this function and produce no argv, because codex has no lever
 * for any of them. Silence here would be the defect the whole contract exists against —
 * so the absences are declared in {@link CODEX_CANNOT}, and the door that reads that
 * list is what refuses a role asking for them BY NAME. This function is not that door:
 * it builds an argv and does not decide who may be raised.
 *
 * `--sandbox read-only` IS THE ONE PLACE WHERE A FIELD OF THE CARD BECOMES CONFINEMENT
 * (thread 026, П1-3). A card that waives the allow-list says WHAT holds the session
 * instead — `launch.agent.toolsHeldBy: "sandbox-read-only"` — and that assertion is only
 * true if the run actually carries the flag. Absent the field the argv is what it was:
 * the vendor's own default mode, and a role that asked for the levers is refused at the
 * door before it ever reaches this function.
 */
export const buildCodexArgv = (input: LaunchArgvInput): string[] => [
  "exec",
  // `codex exec resume <SESSION_ID>` is a subcommand of a subcommand and takes the id
  // where our `--resume <id>` took a value (`codex/noninteractive.md`).
  ...(input.resume === undefined ? [] : ["resume", input.resume]),
  "--json",
  "--skip-git-repo-check",
  ...(input.launch.agent?.kind === CODEX_WORKER && input.launch.agent.toolsHeldBy !== undefined
    ? CODEX_READ_ONLY_ARGV
    : []),
  ...(input.params?.model === undefined ? [] : ["-m", input.params.model.value]),
  ...(input.params?.effort === undefined
    ? []
    : ["-c", `model_reasoning_effort=${input.params.effort.value}`]),
  input.prompt,
];

/**
 * WHAT CODEX HAS NO LEVER FOR — the closed list, so a refusal can print a name.
 *
 * The first three are empty cells of the argv table (B2): no `--allowedTools`, no
 * settings-borne zone denial, no ceiling on the steps of one run. The nearest things
 * codex offers — the sandbox mode `-s` and execpolicy `.rules` — are a DIFFERENT
 * granularity, not a rename: "this tool yes, that tool no" and "this path is denied"
 * cannot be said in them. Calling them equivalent in the config would be the quietest
 * possible way to lose door 1 of thread 020.
 *
 * The last two are the completeness of the limit signal (B4). The types exist in the
 * vendor's internal protocol (`RateLimitSnapshot`, two windows, `used_percent`,
 * `resets_at` — `protocol/src/protocol.rs:2167-2222`) but they ride `TokenCountEvent`
 * and are NOT among the eight types of the `exec --json` stream. So:
 *
 *  - `quota-signal`: nothing structured to read a suffered refusal from. All that
 *    reaches us is `turn.failed.error.message`, free prose whose wording nobody on this
 *    box has seen yet — matching against a phrase we have imagined would be a guess
 *    wearing the clothes of a reading, and gate 019 would shelve on it;
 *  - `quota-window`: nothing at all to build the preventive shelf (`windowOf`) on.
 *
 * Both are ALSO expressed by the absence of the corresponding members of `stream` —
 * the contract's own way of saying "this kind cannot tell". They are named here as
 * well, and on purpose: absence is what the code checks, a name is what a human reads.
 */
export const CODEX_CANNOT: readonly AgentLever[] = [
  "allowed-tools",
  "zone-deny",
  "max-turns",
  "quota-signal",
  "quota-window",
];

/**
 * THE SECOND KIND. Described from the vendor's declarations; raised for the first time
 * only after the operator's key lands (`docs/codex-kind-inventory.md`, section C).
 */
export const CODEX: AgentKind = {
  id: CODEX_WORKER,
  defaultExec: CODEX_EXEC,
  // The account is a directory here too — only the name of the variable differs, which
  // is the whole reason it is a property of the kind (B5: `$CODEX_HOME/auth.json`, and
  // `--ignore-user-config` still reads auth from it — `exec/src/cli.rs:39-41`).
  accountEnv: "CODEX_HOME",
  // THE LEVELS ARE THE TOOL'S, SO THE DOOR ASKS THE TOOL (thread 026, П2-2). Before this
  // the flag path compared against the literal `claude-code` and passed anything else
  // through to the vendor — true, and a lease spent to learn it.
  effortLevels: codexEffortSchema.options,
  buildArgv: buildCodexArgv,
  stream: {
    // stdout carries the JSONL; the human-readable progress goes to stderr
    // (`codex/noninteractive.md`). The supervisor already keeps both pipes, so what
    // changes is only which one is READ as the stream.
    pipe: "stdout",
    sessionIdOf: codexSessionIdOf,
    modelOf: codexModelOf,
    runUsageOf: codexRunUsageOf,
    isAssistantStep: codexIsAssistantStep,
    renderLine: codexRenderLine,
    // NO `quotaSignalOf` AND NO `windowBoundaryOf`, and the omission is the statement:
    // this kind cannot say. See CODEX_CANNOT above for what is behind it.
  },
  // WITHOUT `-p`. On this binary `-p` is `--profile`
  // (`utils/cli/src/shared_options.rs:35`), so the probe of the other kind would not
  // fail here — it would RUN, asking for a profile named "Answer with the single word:
  // ok", and doctor would report the box broken. `--sandbox read-only` because a probe
  // that can write is a probe that can break the box it is diagnosing.
  probeArgv: (prompt) => ["exec", "--skip-git-repo-check", "--sandbox", "read-only", prompt],
  // The one form that is headless AND a single visit of a human (B5): the key arrives
  // on stdin, never as an argument — an argument would stand in the process table and
  // in the shell history of whoever typed it.
  loginHint: (configDir) =>
    configDir === undefined
      ? "printenv OPENAI_API_KEY | codex login --with-api-key"
      : `CODEX_HOME=${configDir} sh -c 'printenv OPENAI_API_KEY | codex login --with-api-key'`,
  cannot: CODEX_CANNOT,
};
