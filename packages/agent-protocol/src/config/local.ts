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
 * The counter-case — one machine serving two projects that need different binaries —
 * is answered by `--local-config <path>` today. A per-project section would be an
 * abstraction built ahead of its first user.
 *
 * IT IS NOT VERSIONED BY `protocolVersion`, deliberately. That number covers the
 * shape of data that TRAVELS — the config, threads, message headers, the journal —
 * where two parties can disagree about what they are reading. This file travels
 * nowhere: one machine, one writer, a human. What is left of the version's job is
 * the diagnosis, and the strict schema gives that directly, by naming the field it
 * does not know.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
export const localConfigSchema = z.strictObject({
  agents: z.record(z.string().min(1), localAgentSchema).default({}),
});

export type LocalAgent = z.infer<typeof localAgentSchema>;
export type LocalConfig = z.infer<typeof localConfigSchema>;

/**
 * POLICY KEYS THE MACHINE MUST NOT CARRY. The boundary is stated by construction —
 * `strictObject` rejects anything not listed — but a generic "unrecognized key:
 * limits" names the typo and not the rule. These are the fields somebody would
 * plausibly try to put here, and each of them is a policy statement: putting one on
 * a machine would mean a box quietly running with permissions or ceilings nobody
 * reviewed, which is the exact thing the config was moved into `main` to prevent.
 */
const POLICY_KEYS = [
  "roles",
  "mail",
  "orchestrator",
  "protocolVersion",
  "limits",
  "allowedTools",
  "permissions",
  "zones",
  "workdir",
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

/**
 * Where the machine config lies, from the environment as the process sees it.
 * `XDG_CONFIG_HOME` first (the platform's own override), then `~/.config`. Pure:
 * the environment is passed in, so the resolution is testable without touching the
 * home directory of whoever runs the tests.
 */
export const localConfigPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config");
  return join(base, LOCAL_CONFIG_DIR, LOCAL_CONFIG_FILE);
};

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
      `'${path}' carries ${policy.map((key) => `'${key}'`).join(", ")} — that is POLICY and it lives in the repository config, behind a PR. The machine config says only WHERE the agent binaries are`,
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

/** One line for `status` and `preflight`: which file, and whether it is there at all. */
export const describeLocalConfig = (loaded: LoadedLocalConfig): string => {
  if (!loaded.found) return `${loaded.path} — absent (the binaries are taken from PATH)`;
  const agents = Object.entries(loaded.config.agents);
  if (agents.length === 0) return `${loaded.path} — no agents declared`;
  return `${loaded.path} — ${agents.map(([id, agent]) => `${id} → ${agent.exec}`).join(", ")}`;
};
