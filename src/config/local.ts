/**
 * THE MACHINE CONFIG — the second config, and the boundary between the two is the
 * whole point of it (R14, thread `016-protocol-roadmap`).
 *
 * **The repository says WHAT, the machine says WHERE.** Roles, permissions,
 * ceilings, launch parameters, the expected branch — policy, and policy lives in
 * `agent-protocol.json`, in git, behind a PR. Where the executables of the agents
 * happen to sit on THIS box — location, and location cannot be committed: it is
 * different on every machine and belongs to none of them.
 *
 * THE HOLE THIS CLOSES was visible in every command john typed:
 * `--exec /home/…/versions/node/v18.20.3/bin/claude`. That path is not knowledge of
 * the project and never was — it is knowledge of one laptop, and it lived in one
 * shell history. A machine without it in `PATH` cannot start the circuit at all, and
 * nothing anywhere says so.
 *
 * WHY XDG (`~/.config/agent-protocol/local.json`) AND NOT `.orchestrator/local.json`
 * inside the repository — four reasons, in the order they bite:
 *
 *  1. **The fact is a property of the machine, not of a checkout.** This repository
 *     alone has five working trees (`.worktrees/*`); a per-checkout file means five
 *     copies of one fact, and copies of a fact drift SILENTLY — the failure mode the
 *     whole package is written against.
 *  2. **`.orchestrator` is disposable state.** Journal, flags, holds, session logs:
 *     everything in there is written by the package and may be cleared. A
 *     hand-written config that cannot be regenerated has no business living among
 *     files whose recovery procedure is `rm -rf`.
 *  3. **R13 (remote instances) wants exactly this shape.** Topology travels in the
 *     repository; what is machine-specific is delivered by hand, once per machine.
 *     A file in the home directory is one delivery per machine; a file per checkout
 *     is one delivery per clone, forever.
 *  4. `XDG_CONFIG_HOME` is the platform's own answer to "a user's config for a
 *     tool", and honouring it costs one line.
 *
 * THE COUNTER-CASE ARRIVED (thread `055-multi-instance-multi-account`, Э-1′): one box
 * serving several projects, one instance per repository. So the single file grew
 * NAMED SIBLINGS — `~/.config/agent-protocol/instances/<name>.json` — and the old
 * `local.json` stays exactly what it was for a box that names nothing. A box with no
 * `instances/` directory behaves today as it did yesterday, to the byte.
 *
 * WHY FILES AND NOT A SECTION inside one file: the key `instances` is POLICY here and
 * is refused BY NAME (the topology of who raises what travels in the repository, R13).
 * A section of named instances in the machine config is the one shape that would have
 * required weakening `POLICY_KEYS`, and that list is the boundary itself.
 *
 * WHY THE NAME ARRIVES IN THREE LAYERS (`--instance`, `AGENT_PROTOCOL_INSTANCE`, the
 * checkout the command was typed in) rather than one — each layer alone was tried on
 * paper and each fails somewhere the others do not:
 *  · the flag alone is the ceremony back: the name would have to be typed in every one
 *    of the five operator commands, exactly where `--ref` was taken out of them;
 *  · the env alone is forgotten silently and drifts between an operator's terminal and
 *    a systemd unit — the failure reads as "the daemon raised the wrong project", with
 *    no line anywhere saying why;
 *  · the checkout alone cannot answer for commands typed somewhere else.
 * Together they give what R21 gives a model: every answer has a source, and the source
 * is SAID. A disagreement between two layers is a refusal by name, never a quiet pick.
 *
 * IT IS NOT VERSIONED BY `protocolVersion`, deliberately. That number covers the
 * shape of data that TRAVELS — the config, threads, message headers, the journal —
 * where two parties can disagree about what they are reading. This file travels
 * nowhere: one machine, one writer, a human. What is left of the version's job is
 * the diagnosis, and the strict schema gives that directly, by naming the field it
 * does not know.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import { z } from "zod";

/**
 * WHAT MAY BE SAID ABOUT ONE AGENT TOOL: where its binary is. One field, because
 * exactly one hole has been demonstrated; an object rather than a bare string,
 * because the next machine-specific fact about a tool would otherwise cost a shape
 * change of a file that lives outside every migration mechanism there is.
 */
export const localAgentSchema = z.strictObject({
  /** The binary as it is to be spawned: an absolute path, or a name to be found in PATH. */
  exec: z.string().min(1),
});

/**
 * The keys are TOOL IDS (`claude-code`, `cursor`, …) — the same vocabulary as the
 * `worker` of a message header and as `launch.agent.kind` of a role. That is the
 * join: the repository says which tool raises a role, the machine says where that
 * tool is. Neither file mentions the other.
 */
/**
 * WHERE THIS MACHINE KEEPS THE SECRETS OF ITS TRANSPORTS (R4) — a PATH, and only a
 * path. The values stay in that file, which is read and never printed; this one is
 * printed on every preflight, so it may not carry anything that must not be shown.
 *
 * It is `WHERE` in exactly R14's sense, so it belongs on this side of the line: the
 * repository says which transport is used and with which words, the machine says
 * where the credentials for it happen to sit on this box.
 */
export const localSecretsSchema = z.strictObject({
  /** A file of `KEY=value` lines. Absolute — a relative path would depend on cwd. */
  envFile: z.string().min(1),
});

/**
 * WHAT MAY BE SAID ABOUT ONE ACCOUNT OF A TOOL (thread 055): where its directory is
 * — a path, and only a path, for the same reason `secrets.envFile` is one.
 *
 * The tool keeps a whole account under one directory (credentials, its config, the
 * transcripts and the session store), so the isolation this buys is directory-deep
 * rather than token-deep: two accounts on one box share nothing, including the
 * sessions `--resume` looks for. THAT IS A NORM AND NOT A BUG, and it is worth
 * saying once: a role whose account is changed does not corrupt its resumable
 * sessions, it STOPS SEEING THEM — the first run after such a change is `--fresh`
 * in fact, whatever the continuation policy would have decided (R18).
 */
export const localAccountSchema = z.strictObject({
  /**
   * The directory the tool is to keep this account in — absolute, and passed to the
   * session as `CLAUDE_CONFIG_DIR`. Relative would depend on the cwd of whoever
   * happened to start the daemon.
   */
  configDir: z.string().min(1),
});

export const localConfigSchema = z.strictObject({
  agents: z.record(z.string().min(1), localAgentSchema).default({}),
  /**
   * WHERE THE ACCOUNTS OF THIS BOX LIVE (thread 055) — the machine's half of the
   * join `launch.account` opens. The keys are the ids the repository names; the
   * values are directories on this disk and nothing else.
   *
   * An id the repository names and this map does not is a REFUSAL by name at the
   * launch door, never a quiet fall-back to the box's own account: the fall-back
   * would raise a role on a subscription nobody assigned it, and it would look
   * exactly like a run that obeyed.
   *
   * OPTIONAL, not defaulted to `{}` like `agents` above: absence has a meaning here
   * ("this box declares no accounts, every role runs on its own") and the default
   * would make every construction of this config in the package carry an empty map
   * for a field most boxes never write.
   */
  accounts: z.record(z.string().min(1), localAccountSchema).optional(),
  secrets: localSecretsSchema.optional(),
  /**
   * WHICH INSTANCE THIS BOX IS (R13) — the machine's half of the topology join.
   *
   * The repository declares WHICH instances exist and which roles each one raises
   * (`instances`); only the box itself can say which of them it is, and it cannot be
   * committed for exactly the R14 reason: the answer is different on every machine and
   * belongs to none of them. Note the singular — `instances` (the topology) is POLICY
   * and is refused here by name; `instance` (identity) is location, and this is the
   * only place it can live.
   *
   * A box with no name while the repository declares instances does not fall back to
   * "raise everything": it refuses, because the fallback would raise another box's role.
   */
  instance: z.string().min(1).optional(),
  /**
   * WHO SITS AT THIS BOX (thread `019-operator-ux`) — the role a hold taken here is
   * signed by when `--by` is not typed.
   *
   * The short forms were given `$USER` as their default, and `$USER` is an OS account
   * name that coincides with a role of the config only by luck. On the box this was
   * written on it is `cosysoft`, which is no role at all — so `hold <role>`, the form
   * that exists to take the ceremony off the operator, refused every time until `--by`
   * was typed anyway. That is the ceremony back, plus an error message.
   *
   * It is location in R14's sense, not policy: WHICH roles may sign a hold is stated in
   * the repository (and still checked there — an unknown value is refused exactly as a
   * bad `--by` is), while WHICH of them happens to be the human at this keyboard is
   * true of one machine and of no other. Same shape as `instance`, one line below the
   * same reasoning.
   *
   * `$USER` stays as the last resort: on a box where the account name IS a role it kept
   * working, and taking it away would break that for nothing. The order is stated once,
   * where it is read, and every refusal names which of the three it came from.
   */
  operator: z.string().min(1).optional(),
  /**
   * WHICH CHECKOUT THIS INSTANCE SERVES (thread 055) — an absolute path, and the only
   * reason it exists: it is what lets a command typed inside a project pick that
   * project's instance without naming it. Location in the plainest sense of R14 — the
   * same repository sits at a different path on every box.
   *
   * A checkout MATCHES if it is this path or lies under it, so a role's worktree
   * (`.worktrees/<role>`) answers with the instance of its home checkout.
   *
   * Meaningful only in a NAMED file (`instances/<name>.json`); the unnamed
   * `local.json` is the box's answer when nothing is named, and has nothing to match.
   */
  repo: z.string().min(1).optional(),
});

export type LocalAgent = z.infer<typeof localAgentSchema>;
export type LocalAccount = z.infer<typeof localAccountSchema>;
export type LocalSecrets = z.infer<typeof localSecretsSchema>;
export type LocalConfig = z.infer<typeof localConfigSchema>;

/**
 * POLICY KEYS THE MACHINE MUST NOT CARRY. The boundary is stated by construction —
 * `strictObject` rejects anything not listed — but a generic "unrecognized key:
 * limits" names the typo and not the rule. These are the fields somebody would
 * plausibly try to put here, and each of them is a policy statement: putting one on
 * a machine would mean a box quietly running with permissions or ceilings nobody
 * reviewed, which is the exact thing the config was moved into `main` to prevent.
 */
export const POLICY_KEYS = [
  "roles",
  "mail",
  "orchestrator",
  "protocolVersion",
  "limits",
  "allowedTools",
  "permissions",
  "zones",
  "workdir",
  // R4: which transport is used and WHICH WORDS are sent are statements about the
  // project, reviewed in a PR like the rest. What the machine may say about
  // notifications is where the credentials file lies, and that is `secrets.envFile`.
  "notifications",
  "announcements",
  // R13: WHO RAISES WHAT is policy — the topology is reviewed in a PR and travels with
  // git, so every box agrees about every other. The machine may say only WHICH of the
  // declared instances it is, and that field is `instance`, in the singular.
  "instances",
] as const;

export class LocalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalConfigError";
  }
}

/** The name is the package's convention; the directory is the platform's. */
export const LOCAL_CONFIG_DIR = "agent-protocol";
export const LOCAL_CONFIG_FILE = "local.json";
/** Where the NAMED configs of a multi-instance box lie, one file per instance. */
export const LOCAL_CONFIG_INSTANCES_DIR = "instances";
/** The env layer of the name (layer 2 of three). */
export const INSTANCE_ENV = "AGENT_PROTOCOL_INSTANCE";

/**
 * The package's own directory under the platform's config home. `XDG_CONFIG_HOME`
 * first (the platform's own override), then `~/.config`. Pure: the environment is
 * passed in, so the resolution is testable without touching the home directory of
 * whoever runs the tests.
 */
export const localConfigHome = (env: NodeJS.ProcessEnv = process.env): string => {
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config");
  return join(base, LOCAL_CONFIG_DIR);
};

/** Where the UNNAMED machine config lies — the box that hosts one instance. */
export const localConfigPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(localConfigHome(env), LOCAL_CONFIG_FILE);

/** Where the config of instance `<name>` lies. The name IS the file name. */
export const instanceConfigPath = (name: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(localConfigHome(env), LOCAL_CONFIG_INSTANCES_DIR, `${name}.json`);

/**
 * Parse the raw JSON of a machine config. The policy check runs FIRST, so a file
 * that oversteps the boundary is told which rule it broke rather than which key is
 * unknown.
 */
export const parseLocalConfig = (raw: unknown, path: string): LocalConfig => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LocalConfigError(`'${path}': the machine config must be a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  const policy = POLICY_KEYS.filter((key) => key in record);
  if (policy.length > 0) {
    throw new LocalConfigError(
      `'${path}' carries ${policy.map((key) => `'${key}'`).join(", ")} — that is POLICY and it lives in the repository config, behind a PR. The machine config says only WHERE things are on this box (agent binaries, the secrets file)`,
    );
  }
  const result = localConfigSchema.safeParse(record);
  if (!result.success) {
    throw new LocalConfigError(
      `'${path}': ${result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
    );
  }
  return result.data;
};

export type LoadedLocalConfig = {
  readonly config: LocalConfig;
  readonly path: string;
  /** Whether the file was there. Absence is legitimate; see below. */
  readonly found: boolean;
  /** Whether the path was named by the operator rather than derived. */
  readonly explicit: boolean;
};

/**
 * Read the machine config.
 *
 * **A MISSING DEFAULT FILE IS NOT AN ERROR:** a machine where the agent is simply on
 * `PATH` needs to say nothing, and demanding a file from it would make the package
 * harder to start than the shell command it replaces. A missing file the operator
 * NAMED is an error, and the difference is the whole of it — `--local-config` is a
 * specific statement about a specific file, and answering it with a silent fallback
 * to defaults is how a run ends up using settings nobody chose.
 */
export const loadLocalConfig = (options?: {
  readonly path?: string;
  readonly env?: NodeJS.ProcessEnv;
}): LoadedLocalConfig => {
  const explicit = options?.path !== undefined;
  const path = options?.path ?? localConfigPath(options?.env);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (explicit) {
      throw new LocalConfigError(
        `the machine config '${path}' was named but not read: ${(error as Error).message}`,
      );
    }
    return { config: { agents: {} }, path, found: false, explicit };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LocalConfigError(`'${path}' is not JSON: ${(error as Error).message}`);
  }
  return { config: parseLocalConfig(parsed, path), path, found: true, explicit };
};

/**
 * THE NAMED CONFIGS ON THIS BOX, by name, in a stable order. A missing directory is
 * an empty list and not an error: it is what a one-instance box looks like.
 */
export const listInstanceConfigs = (
  env: NodeJS.ProcessEnv = process.env,
): readonly { readonly name: string; readonly path: string }[] => {
  const dir = join(localConfigHome(env), LOCAL_CONFIG_INSTANCES_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => ({ name: entry.slice(0, -".json".length), path: join(dir, entry) }))
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** WHICH LAYER ANSWERED. Printed beside the path, always — that is the point of layers. */
export type LocalConfigSource = "path" | "flag" | "env" | "checkout" | "default";

export type ResolvedLocalConfig = LoadedLocalConfig & {
  /** The instance whose named file was read; absent for `local.json` and for `--local-config`. */
  readonly instanceName?: string;
  readonly source: LocalConfigSource;
  /** The one line that says which layer answered, and with what. */
  readonly resolution: string;
};

const contains = (parent: string, child: string): boolean => {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/**
 * WHICH NAMED INSTANCE CLAIMS THIS CHECKOUT (layer 3). The named files are read for
 * their `repo` alone; the longest matching path wins, because a checkout nested under
 * another is a more specific answer than its parent. Two files claiming the SAME path
 * are a refusal — the box cannot know which project the operator meant.
 *
 * A named file that does not parse is SKIPPED and NAMED in the note: one broken
 * sibling must not blind a box to the instance it was actually asked about, and
 * silence about it would be the drift this package exists to prevent.
 */
const instanceOfCheckout = (
  repo: string,
  env: NodeJS.ProcessEnv,
): { readonly name?: string; readonly skipped: readonly string[] } => {
  const skipped: string[] = [];
  const claims: { name: string; repo: string }[] = [];
  for (const candidate of listInstanceConfigs(env)) {
    let config: LocalConfig;
    try {
      config = parseLocalConfig(JSON.parse(readFileSync(candidate.path, "utf8")), candidate.path);
    } catch (error) {
      skipped.push(`${candidate.name} (${(error as Error).message})`);
      continue;
    }
    if (config.repo !== undefined && contains(config.repo, repo)) {
      claims.push({ name: candidate.name, repo: config.repo });
    }
  }
  if (claims.length === 0) return { skipped };
  claims.sort((a, b) => resolve(b.repo).length - resolve(a.repo).length);
  const [best, second] = claims;
  if (best === undefined) return { skipped };
  if (second !== undefined && resolve(second.repo) === resolve(best.repo)) {
    throw new LocalConfigError(
      `'${repo}' is claimed by ${claims
        .filter((claim) => resolve(claim.repo) === resolve(best.repo))
        .map((claim) => `'${claim.name}'`)
        .join(
          " and ",
        )} — two instances of this box declare the same 'repo'. Name the one you mean with --instance`,
    );
  }
  return { name: best.name, skipped };
};

/**
 * READ THE MACHINE CONFIG OF THE INSTANCE THIS COMMAND IS ABOUT (thread 055).
 *
 * The layers, in order, each one able to refuse: an explicit `--local-config <path>`
 * (a path, not a name — it answers for itself and skips the whole question), then
 * `--instance`, then `AGENT_PROTOCOL_INSTANCE`, then the checkout, then `local.json`.
 *
 * TWO REFUSALS ARE THE VALUE OF THE SHAPE, and neither is a fallback:
 *  · a NAME that disagrees with the checkout — the operator says `A`, the tree they
 *    are standing in belongs to `B`. That is the case where a quiet pick would raise
 *    another project's roles with this project's binaries;
 *  · a checkout that belongs to NO declared instance on a box that has named ones and
 *    no `local.json` — proceeding would mean running with defaults nobody chose.
 * Everything else resolves and SAYS which layer answered.
 */
export const resolveLocalConfig = (options?: {
  /** `--local-config <path>`: a file named outright; wins over every layer below. */
  readonly path?: string | undefined;
  /** `--instance <name>` (layer 1). */
  readonly instance?: string | undefined;
  /** The checkout the command is about — `--repo`, or the home of the current tree (layer 3). */
  readonly repo?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): ResolvedLocalConfig => {
  const env = options?.env ?? process.env;
  if (options?.path !== undefined) {
    const loaded = loadLocalConfig({ path: options.path, env });
    return { ...loaded, source: "path", resolution: `${loaded.path} ← --local-config` };
  }

  const fromEnv = env[INSTANCE_ENV];
  const named =
    options?.instance !== undefined
      ? { name: options.instance, source: "flag" as const, said: "--instance" }
      : fromEnv !== undefined && fromEnv.length > 0
        ? { name: fromEnv, source: "env" as const, said: `$${INSTANCE_ENV}` }
        : undefined;

  const byCheckout =
    options?.repo === undefined ? { skipped: [] } : instanceOfCheckout(options.repo, env);
  const skipped =
    byCheckout.skipped.length === 0 ? "" : `; skipped ${byCheckout.skipped.join(", ")}`;

  if (named !== undefined) {
    if (byCheckout.name !== undefined && byCheckout.name !== named.name) {
      throw new LocalConfigError(
        `${named.said} says '${named.name}' and the checkout '${options?.repo}' belongs to '${byCheckout.name}' — this box will not guess which project the command is about. Either drop ${named.said} or run it against the checkout of '${named.name}'`,
      );
    }
    const path = instanceConfigPath(named.name, env);
    const loaded = loadLocalConfig({ path, env });
    return {
      ...loaded,
      instanceName: named.name,
      source: named.source,
      resolution: `${path} ← instance '${named.name}' (${named.said})${skipped}`,
    };
  }

  if (byCheckout.name !== undefined) {
    const path = instanceConfigPath(byCheckout.name, env);
    const loaded = loadLocalConfig({ path, env });
    return {
      ...loaded,
      instanceName: byCheckout.name,
      source: "checkout",
      resolution: `${path} ← instance '${byCheckout.name}' (checkout ${options?.repo})${skipped}`,
    };
  }

  const declared = listInstanceConfigs(env);
  const loaded = loadLocalConfig({ env });
  if (!loaded.found && declared.length > 0) {
    throw new LocalConfigError(
      `this box declares ${declared.map((entry) => `'${entry.name}'`).join(", ")} and none of them claims '${options?.repo ?? "the current directory"}', while '${loaded.path}' does not exist — name the instance with --instance or $${INSTANCE_ENV}${skipped}`,
    );
  }
  return {
    ...loaded,
    source: "default",
    resolution: `${loaded.path} ← the unnamed config of this box${
      declared.length === 0 ? "" : ` (named: ${declared.map((entry) => entry.name).join(", ")})`
    }${skipped}`,
  };
};

/**
 * One line for `status` and `preflight`: which file, and whether it is there at all.
 * The secrets FILE is named when declared (a path is not a secret and its absence is
 * the first suspect when nothing was delivered); its contents are never touched here.
 *
 * WHEN THE FILE BELONGS TO A NAMED INSTANCE the name comes FIRST (thread 055): on a
 * box hosting two projects, "which file" is answered by a path that differs in one
 * segment, and the question actually being asked is "which project is this".
 */
export const describeLocalConfig = (loaded: LoadedLocalConfig | ResolvedLocalConfig): string => {
  const named =
    "instanceName" in loaded && loaded.instanceName !== undefined
      ? `instance '${loaded.instanceName}' · `
      : "";
  if (!loaded.found) return `${named}${loaded.path} — absent (the binaries are taken from PATH)`;
  const agents = Object.entries(loaded.config.agents);
  const secrets =
    loaded.config.secrets === undefined ? "" : `; secrets ← ${loaded.config.secrets.envFile}`;
  // The operator is named because it SIGNS things: a hold in `status` reads
  // `held by <role>`, and "which answer did that come from" is a question about this
  // file, asked at the moment the signature looks wrong.
  const operator =
    loaded.config.operator === undefined ? "" : `; operator ${loaded.config.operator}`;
  // WHICH SUBSCRIPTIONS THIS BOX HOLDS (thread 055) — printed for the same reason the
  // binaries are: an id the repository names and this box does not declare is a refusal
  // at the launch door, and the one command an operator asks "what does this box
  // actually have" of is this one. Paths only, exactly like `exec` and
  // `secrets.envFile`: which subscription stands behind an id is in no file at all.
  const accounts = Object.entries(loaded.config.accounts ?? {});
  const declared =
    accounts.length === 0
      ? ""
      : `; accounts ${accounts.map(([id, account]) => `${id} → ${account.configDir}`).join(", ")}`;
  if (agents.length === 0)
    return `${named}${loaded.path} — no agents declared${secrets}${declared}${operator}`;
  return `${named}${loaded.path} — ${agents
    .map(([id, agent]) => `${id} → ${agent.exec}`)
    .join(", ")}${secrets}${declared}${operator}`;
};
