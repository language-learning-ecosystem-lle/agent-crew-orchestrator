#!/usr/bin/env node
/**
 * The entry point for the operators of the circuit. The full syntax lives in the
 * `USAGE` constant below, and that is its ONLY source: the header and the help
 * text have drifted apart once already (the P1-era syntax stood here —
 * `roles check --config/--doc`, long gone), so the command list is not kept in
 * two places.
 *
 * `--ref` is MANDATORY everywhere and has no default: it decides WHICH version of
 * the config we read, and a silent choice of version would be a quiet error.
 * `--repo` does have a default (the repository of the current directory, or of
 * the place where the mail lies): the directory is unambiguous, while demanding
 * it by hand broke every documented example.
 *
 * EVERY REFUSAL IS LOUD. The lesson of the P0 spike: a command that silently
 * depends on the environment produces a result indistinguishable from a defect in
 * the thing under test — three failures out of three in the spike were of that
 * kind (a missing file, an ignored name, PATH). Hence an unreadable file,
 * malformed JSON and an invalid config all mean a non-zero code and text on
 * stderr, not empty output.
 *
 * WITHOUT `--write` NOTHING IS WRITTEN: the circuit is live, and "look at what
 * would happen" has to be cheaper and safer than "do it".
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG_PATH } from "./config/config.js";
import { loadProtocolConfig } from "./config/load.js";
import { loadThreads, renderThreadFailures } from "./fs/comms.js";
import { fileExistsAtRef, mailCheckoutState, messagesAtRef, workdirState } from "./fs/git.js";
import {
  type ActivityTrace,
  DEFAULT_IDLE_MS,
  describeQuiet,
  type IdleWatch,
  idleStep,
  startWatch,
} from "./orchestrator/activity.js";
import {
  foldHolds,
  HOLD_TTL_SECONDS,
  type HoldRecord,
  heldRoles,
  holdExpiry,
  holdStamp,
  parseHold,
  renderHold,
  renderHolds,
} from "./orchestrator/hold.js";
import {
  eventTimestamp,
  type OrchestratorEvent,
  orchestratorEventSchema,
  parseJournal,
  type ReleaseReason,
  renderEventLine,
} from "./orchestrator/journal.js";
import {
  buildLaunchArgv,
  buildLaunchPrompt,
  DEFAULT_MAX_TURNS,
  DEFAULT_WALL_CLOCK_SECONDS,
  DEFAULT_WORKER,
  describeLaunch,
  LAUNCH_ENV,
  MAX_CONSECUTIVE_RUNS,
  planLaunch,
  roleLaunchability,
} from "./orchestrator/launch.js";
import { foldLeases, unclosedLeases } from "./orchestrator/lease.js";
import { renderLog } from "./orchestrator/log.js";
import { handoffDetected, type Lifecycle, observeStep, stepEvent } from "./orchestrator/observe.js";
import {
  type OrchestratorPaths,
  orchestratorPaths,
  renderPaths,
  sessionIdPath,
  sessionLogPath,
  sessionStreamPath,
} from "./orchestrator/paths.js";
import {
  agentBinaryVerdict,
  environmentVerdict,
  mailCheckoutVerdict,
  type PreflightCheck,
  preflightPassed,
  renderPreflight,
  workdirVerdict,
} from "./orchestrator/preflight.js";
import { describeReboot, renderSystemdUnit } from "./orchestrator/reboot.js";
import { renderStatus } from "./orchestrator/status.js";
import { planTick } from "./orchestrator/tick.js";
import {
  renderStreamLine,
  sessionIdOf,
  splitStreamChunk,
  stampLine,
} from "./orchestrator/transcript.js";
import { RoleConfigError, type RoleRegistry } from "./roles/registry.js";
import type { Launch, Role } from "./roles/schema.js";
import {
  type MigrationContext,
  MigrationRefusedError,
  planMigration,
  renderMigrationPlan,
} from "./schema/migrate.js";
import {
  CURRENT_PROTOCOL_VERSION,
  declaredProtocolVersion,
  legacyVersionHint,
  PROTOCOL_VERSION_FIELD,
} from "./schema/version.js";
import { checkImmutable, checkThread } from "./thread/check.js";
import { renderIndex, threadsWaitingOn } from "./thread/index-doc.js";
import type { Expects } from "./thread/message.js";
import {
  EXPECTS,
  isSessionId,
  isWorkerId,
  KNOWN_WORKERS,
  PACKAGE_WORKER,
  parseMessageFile,
} from "./thread/message.js";
import { migrateLegacyThread, verifyMigration } from "./thread/migrate.js";
import { renderThread } from "./thread/thread.js";
import {
  messageTimestamp,
  nextMessageTimestamp,
  planNewMessage,
  planNewThread,
  WriteRefusedError,
} from "./thread/write.js";

const USAGE = `usage (--ref is always required; --repo defaults to the repository of the current directory):
  agent-protocol config check --ref <ref> [--repo <path>] [--config-path <p>] [--no-fetch]
  agent-protocol roles list   --ref <ref> [--repo <path>]
  agent-protocol schema migrate [--repo <path>] [--config-path <p>] [--root <mail>] [--to <n>] [--write]
                              # the ONE command with no --ref: it plans against the working tree it rewrites
  agent-protocol role exists  --ref <ref> --role <id> [--repo <path>]
  agent-protocol index build  --root <mail> --ref <ref> [--write]
  agent-protocol thread build --root <mail> --ref <ref> --id <NNN-slug> [--write]
  agent-protocol check        --root <mail> --ref <ref> [--since <ref>]
  agent-protocol migrate      --root <mail> --ref <ref> [--id <NNN-slug>] [--write]
  agent-protocol derive       --root <mail> --ref <ref> [--write]
  agent-protocol mail         --root <mail> --ref <ref> --role <id>
  agent-protocol new-message  --root <mail> --ref <ref> --thread <id> --from <role> --expects <e> [--waiting-on <r,r>] [--worker <w>] [--session <id>] --body-file <p> [--write]
  agent-protocol new-thread   --root <mail> --ref <ref> --id <NNN-slug> --title <t> --participants <r,r> --from <role> --expects <e> [--waiting-on <r,r>] [--worker <w>] [--session <id>] --body-file <p> [--write]
                              # --worker/--session: what wrote it (a raised session gets both from its launch environment)

ORCHESTRATOR: the paths (journal, flags, holds, mail root) are taken FROM THE
CONFIG, section 'orchestrator'. The path flags below are an override for checks
and are not needed in operation; only --ref is required.
  agent-protocol orchestrator preflight --ref <ref> [--repo <p>] [--exec <bin>]
  agent-protocol orchestrator enable  --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator disable --ref <ref> [--repo <p>] [--write]
  agent-protocol orchestrator status --ref <ref> [--now <iso>] [--mode-file <path>] [--journal <p>] [--holds <d>] [--enable-flag <p>]
  agent-protocol orchestrator record --ref <ref> --kind <k> --role <id> --thread <slug> [--deadline <iso>] [--reason <r>] [--mode <m>] [--now <iso>] [--journal <p>] [--write]
  agent-protocol orchestrator run    --ref <ref> --role <id> --thread <slug> [--repo <p>] [--wall-clock <sec>] [--idle <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--exec <bin>] [--worker <w>] [--journal <p>] [--root <mail>] [--force-flag <p>] [--now <iso>] [--write]
  agent-protocol orchestrator daemon --ref <ref> [--repo <p>] [--tick <sec>] [--wall-clock <sec>] [--idle <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--exec <bin>] [--worker <w>] [--once] [--journal <p>] [--root <mail>] [--enable-flag <p>] [--stop-flag <p>] [--force-flag <p>] [--holds <d>]
  agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> --by <who> [--ttl <sec>] [--note <t>] [--now <iso>] [--holds <d>] [--write]
  agent-protocol orchestrator hold   --mode release --ref <ref> --role <id> [--holds <d>] [--write]
  agent-protocol orchestrator log    --ref <ref> [--journal <p>]
  agent-protocol orchestrator stop   --mode graceful --ref <ref> [--stop-flag <p>] [--write]
  agent-protocol orchestrator stop   --mode force --ref <ref> --by <who> --reason <why> --thread <slug> [--repo <p>] [--force-flag <p>] [--root <mail>] [--write]
  agent-protocol orchestrator systemd-unit --exec-start <cmd> [--working-dir <dir>] [--description <d>]`;

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const fail = (message: string, code: number): never => {
  err(`agent-protocol: ${message}`);
  process.exit(code);
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const required = (argv: readonly string[], name: string): string =>
  flag(argv, name) ?? fail(`${name} is not set\n${USAGE}`, 2);

const readFile = (path: string, what: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return fail(`could not read the ${what} '${path}': ${(error as Error).message}`, 2);
  }
};

/**
 * The config is read ONLY through the package and ONLY at an explicit ref.
 *
 * `--repo` defaults to the repository `--root` belongs to: mail and code live in
 * one repository here, merely on different branches, and making every call repeat
 * the path would breed places for it to drift. A separate `--repo` is needed by
 * the runner, where the mail checkout and the code checkout are different
 * directories.
 */
const configFrom = (
  argv: readonly string[],
  root?: string,
): ReturnType<typeof loadProtocolConfig> => {
  const ref = required(argv, "--ref");
  // Only `ref` has no default — it is precisely what decides WHAT we read, and a
  // silent choice of version would be the defect. The directory, by contrast, is
  // unambiguous: the repository of the place the command was called from (or of
  // the place where the mail lies). Demanding it explicitly meant breaking every
  // example in the documentation — which is what happened (the reviewer's finding
  // on PR #21).
  const repo = flag(argv, "--repo") ?? repoOf(root ?? process.cwd());
  const noFetch = argv.includes("--no-fetch");

  if (noFetch && ref.startsWith("origin/")) {
    // A silently stale config is indistinguishable from a current one — the same
    // class as a silently empty answer from git. Skipping the update is allowed,
    // but not silently.
    err(`agent-protocol: WARNING — '${ref}' was not updated (--no-fetch), the config may be stale`);
  }

  try {
    return loadProtocolConfig({
      repo,
      ref,
      fetch: !noFetch,
      ...(flag(argv, "--config-path") === undefined
        ? {}
        : { path: flag(argv, "--config-path") as string }),
    });
  } catch (error) {
    if (error instanceof RoleConfigError) return fail(error.message, 2);
    return fail(`the protocol config at '${ref}' was not read: ${(error as Error).message}`, 2);
  }
};

const registryFrom = (argv: readonly string[], root?: string): RoleRegistry =>
  configFrom(argv, root).registry;

const repoOf = (at: string): string => {
  try {
    return execFileSync("git", ["-C", at, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return fail(`'${at}' is not inside a git repository: ${(error as Error).message}`, 2);
  }
};

const writeOut = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

const configCheck = (argv: readonly string[]): void => {
  const loaded = configFrom(argv, undefined);
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());

  // The declared instructions are checked AT THE SAME ref as the config: checking
  // for the file on disk would mean looking at a different version of the tree.
  const missing: string[] = [];
  for (const role of loaded.config.roles) {
    for (const entry of role.instructions ?? []) {
      if (!fileExistsAtRef(repo, loaded.ref, entry.path)) {
        missing.push(
          `role '${role.id}': instructions '${entry.path}' are declared, but are not there at ${loaded.ref}`,
        );
      }
    }
  }

  if (missing.length === 0) {
    out(
      `agent-protocol: ok — config '${loaded.path}' at ${loaded.ref}: protocol version ${loaded.config.protocolVersion}, ${loaded.registry.ids().length} roles, mail in branch '${loaded.config.mail.branch}' (${loaded.config.mail.dir})`,
    );
    return;
  }
  err("agent-protocol: the config points at missing files:");
  for (const item of missing) err(`- ${item}`);
  process.exit(1);
};

/**
 * `schema migrate` — moving the repository from one protocol version to the next
 * (R2). A dry run by default: the plan is the review of a change to files nobody
 * can restore by hand.
 *
 * THIS ONE COMMAND READS THE CONFIG OFF THE DISK, and it is the only one. Two
 * reasons, both of them the reverse of why all the others read at a ref:
 *
 *  - it is the only command whose job is to PRODUCE an edit of the working tree,
 *    and planning against a different version of the file than the one it is about
 *    to overwrite would mean writing a result that is not a function of its input;
 *  - the version has to be readable BEFORE validation: a config one version behind
 *    is a config whose shape the current schema may legitimately reject, and going
 *    through the loader would turn "run the migration" into "invalid config".
 *
 * To keep the exception loud rather than silent, the command prints the file it
 * read and the version it found before doing anything else.
 */
const schemaMigrate = (argv: readonly string[]): void => {
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());
  const configPath = join(repo, flag(argv, "--config-path") ?? DEFAULT_CONFIG_PATH);
  const raw = readFile(configPath, "protocol config");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`'${configPath}' is not JSON: ${(error as Error).message}`, 2);
    return;
  }

  const declared = declaredProtocolVersion(parsed);
  if (declared === undefined) {
    const hint = legacyVersionHint(parsed);
    fail(
      `'${configPath}' does not declare '${PROTOCOL_VERSION_FIELD}'${hint === undefined ? "" : ` — ${hint}`}`,
      2,
    );
    return;
  }
  const target = positiveInt(argv, "--to", CURRENT_PROTOCOL_VERSION);
  out(`agent-protocol: config '${configPath}' (read from the working tree), version ${declared}`);

  // The mail root: the flag wins, otherwise it is assembled out of the raw config —
  // raw, because at this point the config has not been validated and must not be.
  const section = (parsed as { orchestrator?: { mailCheckout?: unknown } }).orchestrator;
  const mailDir = (parsed as { mail?: { dir?: unknown } }).mail?.dir;
  const mailRoot =
    flag(argv, "--root") ??
    (typeof section?.mailCheckout === "string" && typeof mailDir === "string"
      ? join(repo, section.mailCheckout, mailDir)
      : "");

  const context: MigrationContext = {
    config: parsed as Record<string, unknown>,
    configPath,
    mailRoot,
    read: (path) => readFile(path, "file being migrated"),
    list: (dir) => {
      if (dir === "") {
        return fail(
          "a step asked for the mail, and its location is unknown — pass --root <mail> (the config declares no 'orchestrator.mailCheckout')",
          2,
        );
      }
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .map((name) => join(dir, name))
        .filter((path) => statSync(path).isFile());
    },
  };

  let plan: ReturnType<typeof planMigration>;
  try {
    plan = planMigration({ declared, target, context });
  } catch (error) {
    if (error instanceof MigrationRefusedError) {
      fail(error.message, 2);
      return;
    }
    throw error;
  }
  out(renderMigrationPlan(plan));

  if (plan.writes.length === 0) return;
  if (!argv.includes("--write")) {
    out("agent-protocol: the plan is shown; writing happens with --write");
    return;
  }
  // The writes are applied IN ORDER, and the config is last in that order: until it
  // is written, the declared version keeps telling the truth about the data.
  for (const file of plan.writes) writeOut(file.path, file.content);
  out(`agent-protocol: migrated ${plan.from} → ${plan.to}, files written: ${plan.writes.length}`);
  err(
    "agent-protocol: the files are written but NOT committed — the config goes through a PR, the mail goes straight into its branch (README, 'Compatibility and breaking changes')",
  );
};

const rolesList = (argv: readonly string[]): void => {
  for (const id of registryFrom(argv, undefined).ids()) out(id);
};

const roleExists = (argv: readonly string[]): void => {
  const role = required(argv, "--role");
  if (registryFrom(argv, undefined).isKnown(role)) return;
  err(`agent-protocol: role '${role}' is not listed in the protocol config`);
  process.exit(1);
};

const indexBuild = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const { threads, failures } = loadThreads(root, registry.ids());
  const rendered = renderIndex(threads.map((loaded) => loaded.thread));
  const path = join(root, "INDEX.md");

  // The index is a display, and assembling it from part of the threads means
  // publishing an incomplete index as a complete one. Isolation is NOT applied
  // here: a broken thread is a refusal.
  if (failures.length > 0) {
    for (const line of renderThreadFailures(failures)) err(`agent-protocol: ${line}`);
    fail(`INDEX will not be assembled — unreadable threads: ${failures.length}`, 2);
  }

  if (argv.includes("--write")) {
    writeOut(path, rendered);
    out(`agent-protocol: INDEX.md regenerated from ${threads.length} threads`);
    return;
  }

  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  if (current === rendered) {
    out("agent-protocol: ok — INDEX.md matches the threads");
    return;
  }
  err("agent-protocol: INDEX.md has drifted from the threads (--write will overwrite it):");
  err(rendered);
  process.exit(1);
};

const threadBuild = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const id = required(argv, "--id");
  const registry = registryFrom(argv, repoOf(root));
  const scan = loadThreads(root, registry.ids());
  // The thread was asked for BY NAME: if the broken one is exactly it, that is a
  // refusal, not a "not found". The difference matters: "not found" pushes one to
  // hunt for a typo in the id.
  const broken = scan.failures.find((failure) => failure.id === id);
  if (broken !== undefined) fail(`thread '${id}' was not read: ${broken.problem}`, 2);
  const loaded = scan.threads.find((item) => item.thread.id === id);
  if (loaded === undefined) fail(`thread '${id}' not found in '${root}'`, 2);

  const { thread } = loaded as NonNullable<typeof loaded>;
  const rendered = renderThread(thread.meta, thread.messages);

  if (argv.includes("--write")) {
    writeOut(join(root, id, "_thread.md"), rendered);
    out(`agent-protocol: ${id}/_thread.md assembled from ${thread.messages.length} messages`);
    return;
  }
  out(rendered);
};

const checkAll = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const { threads, failures } = loadThreads(root, registry.ids());

  const issues = threads.flatMap((loaded) =>
    loaded.input === undefined ? [] : checkThread(loaded.input, registry),
  );
  const legacy = threads.filter((loaded) => loaded.legacy).map((loaded) => loaded.thread.id);
  // An unreadable thread is a violation of the same order as a format violation:
  // `check` exists to say "something is wrong with the mail", and it must not stay
  // silent about a thread that did not parse at all.
  const failureIssues = renderThreadFailures(failures);

  // Message immutability is checked RELATIVE TO A POINT IN HISTORY: only "now"
  // lies on disk, and the question "was it edited after the fact" makes no sense
  // without a ref. No `--since` — we say so out loud: silence would read as
  // "checked and intact", that is, the check would turn into its own opposite
  // exactly where it is needed.
  const since = flag(argv, "--since");
  if (since === undefined) {
    out("agent-protocol: message immutability was NOT checked — --since <ref> is required");
  } else {
    const previous = messagesAtRef(root, since);
    const current = new Map<string, string>();
    for (const path of previous.keys()) {
      try {
        current.set(path, readFileSync(join(root, path), "utf8"));
      } catch {
        // No file — that IS the deletion; checkImmutable says so itself.
      }
    }
    issues.push(...checkImmutable(previous, current));
    out(`agent-protocol: compared with '${since}' — messages in history: ${previous.size}`);
  }

  if (legacy.length > 0) {
    out(`agent-protocol: not migrated yet (read as they are): ${legacy.join(", ")}`);
  }
  if (issues.length === 0 && failureIssues.length === 0) {
    out(`agent-protocol: ok — ${threads.length - legacy.length} threads passed the format check`);
    return;
  }
  if (failureIssues.length > 0) {
    err("agent-protocol: threads were not read:");
    for (const line of failureIssues) err(`- ${line}`);
  }
  if (issues.length > 0) {
    err("agent-protocol: the format is violated:");
    for (const issue of issues) {
      err(`- ${issue.thread}${issue.file === undefined ? "" : `/${issue.file}`}: ${issue.message}`);
    }
  }
  process.exit(1);
};

const migrate = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const only = flag(argv, "--id");
  const doWrite = argv.includes("--write");

  const scan = loadThreads(root, registry.ids());
  // Broken threads do not get in the way of the migration — it runs over the
  // legacy ones that did parse. But staying silent about them is not allowed: a
  // half-migrated thread is precisely the candidate for finishing the migration,
  // and "nothing to migrate" without this line would read as "all good".
  for (const line of renderThreadFailures(scan.failures)) err(`agent-protocol: ${line}`);
  const threads = scan.threads.filter(
    (loaded) => loaded.legacy && (only === undefined || loaded.thread.id === only),
  );
  if (threads.length === 0) {
    out("agent-protocol: nothing to migrate — all threads are already message files");
    return;
  }

  let failed = 0;
  for (const loaded of threads) {
    const id = loaded.thread.id;
    const original = readFile(join(root, id, "_thread.md"), `thread ${id}`);
    const migration = migrateLegacyThread(id, original, registry.ids());
    const mismatch = verifyMigration(migration, original);

    if (mismatch !== undefined) {
      err(`- ${id}: GUARD FAILED, the migration is not accepted — ${mismatch}`);
      failed++;
      continue;
    }
    // A name collision is a refusal (a sanity guard: with a name taken from seq it
    // is structurally impossible, but if name generation ever breaks, the loss of a
    // message must not pass silently — see Migration.collisions).
    if (migration.collisions.length > 0) {
      for (const collision of migration.collisions) {
        err(`- ${id}: NAME COLLISION, the migration is not accepted — ${collision}`);
      }
      failed++;
      continue;
    }

    const messages = migration.files.filter((file) => file.path.startsWith("messages/")).length;
    if (doWrite) {
      for (const file of migration.files) writeOut(join(root, id, file.path), file.content);
      out(
        `- ${id}: moved (${messages} messages), the assembly reproduces the original byte for byte`,
      );
    } else {
      out(`- ${id}: ready to move (${messages} messages), the guard passed`);
    }
  }

  if (failed > 0) fail(`the migration was not accepted for ${failed} threads`, 1);
  if (!doWrite) out("agent-protocol: the plan is shown; writing happens with --write");
};

/**
 * Rebuild ALL derived files at once: the `_thread.md` of every migrated thread
 * (the ones that have `messages/`) plus `INDEX.md`. This is what the action calls
 * on a push to the mail branch — one call instead of a loop in YAML.
 *
 * Without `--write` it is a dry run: it shows what HAS DRIFTED and exits with
 * code 1 if there is any drift. Silently drifted derived files are the same class
 * as a lost duplicate of a verdict: if the assembly does not match the disk, that
 * has to be visible (curator's requirement from 014) rather than quietly "almost
 * the same".
 */
const derive = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const doWrite = argv.includes("--write");
  const { threads, failures } = loadThreads(root, registry.ids());
  // As in `index build`: derived files are a display, and assembling one from part
  // of the threads means publishing the incomplete as complete. A broken thread
  // stops the assembly.
  if (failures.length > 0) {
    for (const line of renderThreadFailures(failures)) err(`agent-protocol: ${line}`);
    fail(`derived files were not assembled — unreadable threads: ${failures.length}`, 2);
  }

  const targets: { path: string; rendered: string }[] = [];
  for (const loaded of threads) {
    // `_thread.md` is rebuilt only for migrated threads: for a legacy one it is the
    // SOURCE and must not be touched — overwriting it with a generated file would
    // break a thread that has not been moved yet.
    if (loaded.legacy) continue;
    targets.push({
      path: join(root, loaded.thread.id, "_thread.md"),
      rendered: renderThread(loaded.thread.meta, loaded.thread.messages),
    });
  }
  targets.push({
    path: join(root, "INDEX.md"),
    rendered: renderIndex(threads.map((l) => l.thread)),
  });

  const drifted: string[] = [];
  for (const target of targets) {
    let current = "";
    try {
      current = readFileSync(target.path, "utf8");
    } catch {
      current = "";
    }
    if (current !== target.rendered) drifted.push(target.path);
  }

  if (doWrite) {
    for (const target of drifted) {
      const rendered = targets.find((t) => t.path === target)?.rendered ?? "";
      writeOut(target, rendered);
    }
    out(
      drifted.length === 0
        ? "agent-protocol: the derived files already match — nothing to write"
        : `agent-protocol: derived files rebuilt: ${drifted.length}`,
    );
    return;
  }

  if (drifted.length === 0) {
    out(`agent-protocol: ok — the derived files match (${targets.length} files checked)`);
    return;
  }
  err("agent-protocol: the derived files drifted from the source (--write will rebuild them):");
  for (const path of drifted) err(`- ${path}`);
  process.exit(1);
};

const parseExpects = (raw: string): Expects => {
  if (!(EXPECTS as readonly string[]).includes(raw)) {
    fail(`--expects '${raw}' — allowed values are ${EXPECTS.join(" | ")}`, 2);
  }
  return raw as Expects;
};

const parseWaitingOn = (raw: string, registry: RoleRegistry): string[] => {
  const roles =
    raw === "—"
      ? []
      : raw
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r !== "");
  for (const role of roles) {
    // An unknown role FAILS the command instead of being dropped silently —
    // otherwise the loss of a role from the declaration (pain 2) would come back
    // through the writing tool.
    if (!registry.isKnown(role))
      fail(`--waiting-on names role '${role}', which is not in the config`, 2);
  }
  return roles;
};

/**
 * WHO IS WRITING THIS — resolved from the flag first, then from the launch channel
 * (R7). A raised session needs to pass nothing: the supervisor put `worker` in its
 * environment and the id of the run in a file beside its log. Everybody else says it
 * out loud — `--worker human`, `--worker gh-action`.
 *
 * The session id is read from the FILE rather than from a variable because it is
 * minted after the spawn (see `LAUNCH_ENV`); an absent or unreadable file is silence,
 * not a failure: a run that could not name itself still has a turn to pass, and a
 * message without provenance is worse than no message only in a report, never in a
 * conversation.
 */
const provenanceFrom = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { worker?: string; session?: string } => {
  const worker = flag(argv, "--worker") ?? env[LAUNCH_ENV.worker];
  const sessionFile = env[LAUNCH_ENV.sessionFile];
  let session = flag(argv, "--session");
  if (session === undefined && sessionFile !== undefined && sessionFile !== "") {
    try {
      const raw = readFileSync(sessionFile, "utf8").trim();
      if (raw !== "") session = raw;
    } catch {
      // the supervisor has not written it yet (or there is none) — no session, no complaint
    }
  }
  // Validated HERE, at the door: an unparseable value written into a message file
  // would only be discovered by a reader, and by then it is history nobody may edit.
  if (worker !== undefined && worker !== "" && !isWorkerId(worker)) {
    fail(
      `--worker '${worker}' — a worker id looks like a role id; in use here: ${KNOWN_WORKERS.join(", ")}`,
      2,
    );
  }
  if (session !== undefined && session !== "" && !isSessionId(session)) {
    fail(`--session '${session}' — one printable token without spaces is expected`, 2);
  }
  return {
    ...(worker === undefined || worker === "" ? {} : { worker }),
    ...(session === undefined || session === "" ? {} : { session }),
  };
};

/**
 * Create a message file in an EXISTING thread. Refuses if the thread is in the
 * legacy form (no `messages/`): a file write would cut off its history.
 */
const newMessage = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const threadId = required(argv, "--thread");
  const from = required(argv, "--from");
  const registry = registryFrom(argv, repoOf(root));
  if (!registry.isKnown(from)) fail(`role '${from}' is not listed in the config`, 2);

  const threadDir = join(root, threadId);
  if (!existsSync(threadDir)) fail(`thread '${threadId}' not found in '${root}'`, 2);
  const messagesDir = join(threadDir, "messages");
  const threadHasMessages = existsSync(messagesDir);

  // The stamp is monotonic along the feed: we collect the stamps of the NEW
  // messages already lying there (the ones with a time — migrated ones, dated
  // without a time, are excluded) and clamp the new one strictly after the last.
  // Without this, clock skew between writers puts an answer before its question (a
  // real case in 012).
  const existingTs = threadHasMessages
    ? readdirSync(messagesDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => parseMessageFile(readFileSync(join(messagesDir, name), "utf8")).fields.date)
        .filter((date) => date.includes("T"))
    : [];

  const text = readFile(required(argv, "--body-file"), "message body");
  const waitingRaw = flag(argv, "--waiting-on");
  let planned: ReturnType<typeof planNewMessage>;
  try {
    planned = planNewMessage({
      from,
      ...provenanceFrom(argv),
      date: nextMessageTimestamp(new Date(), existingTs),
      expects: parseExpects(required(argv, "--expects")),
      ...(waitingRaw === undefined ? {} : { waitingOn: parseWaitingOn(waitingRaw, registry) }),
      text,
      threadHasMessages,
    });
  } catch (error) {
    if (error instanceof WriteRefusedError) {
      fail(error.message, 2);
    }
    throw error;
  }

  const path = join(threadDir, planned.path);
  if (existsSync(path))
    fail(`file '${planned.path}' already exists — two writes within one second?`, 2);

  if (argv.includes("--write")) {
    writeOut(path, planned.content);
    out(`agent-protocol: created ${threadId}/${planned.path}`);
    return;
  }
  out(`agent-protocol: would create ${threadId}/${planned.path} (--write writes it):`);
  out(planned.content);
};

/** Create a NEW thread straight in the file form (`_meta.md` + the first message). */
const newThread = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const id = required(argv, "--id");
  const registry = registryFrom(argv, repoOf(root));

  const from = required(argv, "--from");
  if (!registry.isKnown(from)) fail(`role '${from}' is not listed in the config`, 2);
  const participants = required(argv, "--participants")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  for (const p of participants) {
    if (!registry.isKnown(p)) fail(`participant '${p}' is not listed in the config`, 2);
  }

  const threadDir = join(root, id);
  if (existsSync(threadDir)) fail(`thread '${id}' already exists`, 2);

  const text = readFile(required(argv, "--body-file"), "body of the first message");
  const files = planNewThread({
    title: required(argv, "--title"),
    participants,
    from,
    ...provenanceFrom(argv),
    date: messageTimestamp(new Date()),
    expects: parseExpects(required(argv, "--expects")),
    ...(flag(argv, "--waiting-on") === undefined
      ? {}
      : { waitingOn: parseWaitingOn(flag(argv, "--waiting-on") as string, registry) }),
    text,
  });

  if (argv.includes("--write")) {
    for (const file of files) writeOut(join(threadDir, file.path), file.content);
    out(`agent-protocol: thread ${id} created (${files.length} files)`);
    return;
  }
  out(`agent-protocol: would create thread ${id} (--write writes it):`);
  for (const file of files) out(`- ${id}/${file.path}`);
};

const mail = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const role = required(argv, "--role");
  const registry = registryFrom(argv, repoOf(root));
  if (!registry.isKnown(role)) fail(`role '${role}' is not listed in the config`, 2);

  // Mail is computed from the THREADS, not from the derived INDEX: otherwise a
  // failure of the index generator would blind the watch and the keeper (pain 5,
  // thread 008).
  const { threads, failures } = loadThreads(root, registry.ids());
  const hits = threadsWaitingOn(
    threads.map((loaded) => loaded.thread),
    role,
  );
  for (const id of hits) out(id);
  for (const line of renderThreadFailures(failures)) err(`agent-protocol: ${line}`);

  // THE EXIT CODE SOLVES ONE PROBLEM: it must not let an empty mailbox be declared
  // when we did not actually check it. The entry wrapper (`has-mail.sh`) throws
  // stdout away on a non-zero code and honestly says "it did not work" — hence:
  //  - mail found, some threads broken → code 0, the alarm on stderr. A non-zero
  //    code here would THROW AWAY the mail we found, that is, bring back the very
  //    blindness this package is built to remove;
  //  - no mail found while something is unreadable → "there is no mail" is NOT
  //    PROVEN, code 2.
  if (failures.length > 0 && hits.length === 0) {
    fail(
      `mail is not confirmed: ${failures.length} unreadable threads, the readable ones are not waiting on you`,
      2,
    );
  }
};

/**
 * THE ORCHESTRATOR PATHS COME FROM THE CONFIG, not from the arguments (john's
 * decision, thread 012, 22:45). The flag remains a respected override — checks and
 * one-off runs on a copy of the mail use it — but OPERATION must not know a single
 * path: `enable`, `daemon` and `status` work without a single `--journal`.
 *
 * The `orchestrator` section of the config is optional (the package is designed as
 * a foreign one), and its absence is caught HERE, loudly: a silent default such as
 * `.orchestrator` would mean the daemon writes its journal where nobody looks for
 * it.
 */
const pathsFrom = (argv: readonly string[]): OrchestratorPaths => {
  const loaded = configFrom(argv, undefined);
  const section = loaded.config.orchestrator;
  if (section === undefined) {
    return fail(
      `the config at ${loaded.ref} has no 'orchestrator' section — add { state, mailCheckout, ref }`,
      2,
    );
  }
  return orchestratorPaths({
    repo: flag(argv, "--repo") ?? repoOf(process.cwd()),
    orchestrator: section,
    mail: loaded.config.mail,
  });
};

/**
 * The environment of the CHILD process: the inherited one plus the preamble from
 * the config (`orchestrator.env`). Toolchain management is not handed to the
 * package — the project declares what its agent needs, in data; the package
 * applies it and shows the result.
 */
const childEnvFrom = (argv: readonly string[]): NodeJS.ProcessEnv => {
  const section = configFrom(argv, undefined).config.orchestrator;
  return { ...process.env, ...(section?.env ?? {}) };
};

/**
 * PREFLIGHT — the checks made BEFORE the lease is taken (S8). curator's rule after
 * the third case of one class: whatever a human is obliged to remember before a
 * run, the machine either does itself or loudly refuses. The probes live here, the
 * verdicts live in the core.
 */
const runPreflight = (argv: readonly string[], exec: string): PreflightCheck[] => {
  const loaded = configFrom(argv, undefined);
  const section = loaded.config.orchestrator;
  if (section === undefined) {
    return [
      {
        name: "config",
        status: "fail",
        detail: "there is no 'orchestrator' section — the circuit has nowhere to live",
      },
    ];
  }
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());
  const env = childEnvFrom(argv);
  const preamble = Object.keys(section.env ?? {});

  // The binary is looked up IN THE CHILD'S ENVIRONMENT, not in ours: the daemon's
  // PATH and the session's PATH are different things, and a check of "I have it"
  // would answer the wrong question.
  let resolved: string | null = null;
  try {
    // The binary name goes through an ENVIRONMENT VARIABLE rather than being
    // interpolated into a shell string: `--exec` is set by the operator, and
    // assembling a command out of its value would be an injection for no reason.
    // `shell: true` is not used — that is exactly what it warns about.
    resolved = execFileSync("/bin/sh", ["-c", 'command -v "$AGENT_PROTOCOL_EXEC"'], {
      encoding: "utf8",
      env: { ...env, AGENT_PROTOCOL_EXEC: exec },
    }).trim();
    if (resolved === "") resolved = null;
  } catch {
    resolved = null;
  }

  let nodeVersion: string | null = null;
  try {
    nodeVersion = execFileSync("node", ["--version"], { encoding: "utf8", env }).trim();
  } catch {
    nodeVersion = null;
  }

  let checkout: PreflightCheck;
  try {
    const state = mailCheckoutState(join(repo, section.mailCheckout), loaded.config.mail.branch);
    checkout = mailCheckoutVerdict({ ...state, expectedBranch: loaded.config.mail.branch });
  } catch (error) {
    checkout = {
      name: "mail: checkout freshness",
      status: "fail",
      detail: `could not probe the checkout '${join(repo, section.mailCheckout)}': ${(error as Error).message}`,
    };
  }

  // The working repository: the session inherits it as it is, and "landed on the
  // wrong branch" is not visible from the outside at all — unlike stale mail.
  let workdir: PreflightCheck;
  try {
    const state = workdirState(repo);
    workdir = workdirVerdict({
      ...state,
      ...(section.workdir === undefined ? {} : { expectedBranch: section.workdir.branch }),
    });
  } catch (error) {
    workdir = {
      name: "working tree",
      status: "fail",
      detail: `could not probe '${repo}': ${(error as Error).message}`,
    };
  }

  return [
    agentBinaryVerdict(exec, resolved),
    checkout,
    workdir,
    environmentVerdict({ nodeVersion, appliedKeys: preamble }),
  ];
};

/** The `orchestrator preflight` command: show everything and return a code by the outcome. */
const orchestratorPreflight = (argv: readonly string[]): void => {
  const checks = runPreflight(argv, flag(argv, "--exec") ?? "claude");
  out(renderPreflight(checks));
  if (!preflightPassed(checks)) fail("preflight failed — the circuit does not start", 2);
};

/**
 * Preflight before the start: `daemon` and `run` call it themselves and do NOT
 * start on a failure. Otherwise it stays yet another "do not forget" item, that
 * is, exactly the thing it was built to remove.
 */
const requirePreflight = (argv: readonly string[], exec: string): void => {
  const checks = runPreflight(argv, exec);
  err(renderPreflight(checks));
  if (!preflightPassed(checks)) fail("preflight failed — not starting", 2);
};

/**
 * Enabling and disabling LAUNCHES happens through a command, not through a `touch`
 * at a path from somebody's memory (john's decision, 22:45). The command owns the
 * state directory and creates it itself; it prints LOUDLY: what the state was
 * BEFORE, what it became, and where the flag lies.
 *
 * HONESTLY ABOUT THE GUARANTEE: neither `touch` nor this command tells john apart
 * from an agent. "A human enables it" is a procedural guarantee and always has
 * been; the CLI neither strengthens nor weakens it, it removes from the procedure
 * the places where anyone can go wrong. A technical guarantee (a secret, a
 * signature) is a separate fork.
 */
const orchestratorEnable = (argv: readonly string[], on: boolean): void => {
  const paths = pathsFrom(argv);
  const was = existsSync(paths.enableFlag);
  const write = argv.includes("--write");

  if (was === on) {
    out(`agent-protocol: launches are already ${on ? "enabled" : "disabled"} — changing nothing`);
    out(`flag: ${paths.enableFlag}`);
    return;
  }
  if (!write) {
    out(
      `agent-protocol: would ${on ? "enable" : "disable"} launches (currently ${was ? "enabled" : "disabled"}); --write performs it`,
    );
    out(`flag: ${paths.enableFlag}`);
    return;
  }

  if (on) {
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(paths.enableFlag, "", "utf8");
  } else {
    rmSync(paths.enableFlag);
  }
  out(
    `agent-protocol: launches are ${on ? "ENABLED" : "DISABLED"} (was: ${was ? "enabled" : "disabled"})`,
  );
  out(renderPaths(paths));
};

/**
 * The moment `overdue` in `status` is computed against, and the timestamp of an
 * event in `record`. It defaults to now; `--now <iso>` pins it for checks (the
 * same time-injection technique as in the writing core).
 */
const orchestratorNow = (argv: readonly string[]): Date => {
  const raw = flag(argv, "--now");
  if (raw === undefined) return new Date();
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return fail(`--now '${raw}' — does not parse as a date`, 2);
  return at;
};

/**
 * The holds directory → records (S5). A missing directory means empty (no holds
 * have been taken yet), while an UNREADABLE file inside is a loud refusal through
 * `parseHold`: skipping a broken hold would mean raising a role on top of a live
 * session exactly when something is already wrong.
 */
const loadHolds = (dir: string): HoldRecord[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => parseHold(readFile(join(dir, name), `hold '${name}'`)));
};

/**
 * The orchestrator state display — a fold of the LOCAL journal. A missing journal
 * is an empty state (there have been no sessions yet), not an error: the file
 * appears with the first event. Unreadable for ANY OTHER reason is a loud refusal
 * inside `readFile`.
 *
 * S4: optionally reflects the REBOOT MODE and the enable state (`--mode-file`,
 * `--enable-flag`). That way "how the daemon is brought up and what happens after
 * a reboot" is visible from a command instead of living in somebody's memory
 * (curator's requirement). The enable state is the presence of the flag file;
 * showing it here is also what confirms persistence (a file on disk survives a
 * reboot).
 *
 * S5: holds — "the role is taken by a human".
 *
 * S6: the paths come FROM THE CONFIG, so `status` shows the MODE IN FULL without a
 * single argument: leases, holds, whether launches are enabled and where the files
 * lie. The requirement "so that this does not live in somebody's memory" had until
 * now been met only on paper — the command could show the mode, but only to
 * someone who remembered the paths. The path flags remain an override for checks
 * on a copy.
 */
const orchestratorStatus = (argv: readonly string[]): void => {
  const paths = pathsFrom(argv);
  const journal = flag(argv, "--journal") ?? paths.journal;
  const holds = flag(argv, "--holds") ?? paths.holds;
  const enableFlag = flag(argv, "--enable-flag") ?? paths.enableFlag;

  const events = existsSync(journal) ? parseJournal(readFile(journal, "orchestrator journal")) : [];
  const now = orchestratorNow(argv);
  out(renderStatus(foldLeases(events, now)));
  out(renderHolds(foldHolds(loadHolds(holds), now)));

  const launchesEnabled = existsSync(enableFlag);
  const modeFile = flag(argv, "--mode-file");
  if (modeFile === undefined) {
    out(`launches: ${launchesEnabled ? "enabled" : "disabled"}`);
  } else {
    const mode = readFile(modeFile, "reboot mode").trim();
    if (mode !== "systemd" && mode !== "manual") {
      fail(`reboot mode '${mode}' in '${modeFile}' — expected systemd | manual`, 2);
      return;
    }
    out(describeReboot(mode, launchesEnabled));
  }
  out(renderPaths(paths));

  // S7: the PERMISSIONS the circuit will raise a role with. The same argument as
  // for the paths in S6: the mode must not live in somebody's memory — and a
  // permission profile is exactly the mode, and its absence cost a whole
  // acceptance run.
  out("launch permissions:");
  for (const role of registryFrom(argv, undefined)
    .active()
    .filter((role) => role.wake.mode === "watch")) {
    out(`  ${describeLaunch(role)}`);
  }
};

/**
 * Prints the systemd unit file for the daemon (S4). The package does NOT register
 * itself with the system: `systemctl enable` is performed by a human. Keep the
 * flags (`--enable-flag` and the rest) in `--exec-start` on PERSISTENT storage —
 * otherwise the enable state will not survive a reboot.
 */
const orchestratorSystemdUnit = (argv: readonly string[]): void => {
  const execStart = required(argv, "--exec-start");
  const workingDir = flag(argv, "--working-dir") ?? process.cwd();
  const description = flag(argv, "--description");
  out(
    renderSystemdUnit({
      execStart,
      workingDir,
      ...(description === undefined ? {} : { description }),
    }),
  );
  err(
    "agent-protocol: `systemctl enable` is a human action; keep the flags on persistent storage (not tmpfs)",
  );
};

/**
 * Append ONE event to the journal. This is the write primitive the daemon uses
 * from S1 on; in S0 it also makes the step reproducible by hand. The shape of the
 * event is validated by the schema (fields required per kind — `lease-acquired`
 * without `--deadline` and `lease-released` without `--reason` will not pass)
 * rather than by hand. The role is deliberately NOT checked against the config
 * here: the journal is the orchestrator's own local log, and the authority on "is
 * this role real" is the config the daemon decided the launch by; a second check
 * would tie a local append to a git fetch without adding a guarantee, while a typo
 * is not lost silently — `status` shows it as a line.
 */
const orchestratorRecord = (argv: readonly string[]): void => {
  const path = flag(argv, "--journal") ?? pathsFrom(argv).journal;
  const raw: Record<string, unknown> = {
    kind: required(argv, "--kind"),
    ts: messageTimestamp(orchestratorNow(argv)),
    role: required(argv, "--role"),
    thread: required(argv, "--thread"),
  };
  for (const [option, field] of [
    ["--deadline", "deadline"],
    ["--reason", "reason"],
    ["--mode", "mode"],
  ] as const) {
    const value = flag(argv, option);
    if (value !== undefined) raw[field] = value;
  }

  const parsed = orchestratorEventSchema.safeParse(raw);
  if (!parsed.success) {
    // fail terminates the process; the return is there so that control-flow
    // analysis narrows `parsed` to the success case below (we do not return a
    // value from a void function — the linter would complain about that).
    fail(`the event failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`, 2);
    return;
  }
  const event = parsed.data;
  const line = renderEventLine(event);

  if (argv.includes("--write")) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, "utf8");
    out(`agent-protocol: event ${event.kind} recorded (${event.role} · ${event.thread})`);
    return;
  }
  out(`agent-protocol: would append to '${path}' (--write writes it):`);
  out(line);
};

const positiveInt = (argv: readonly string[], name: string, fallback: number): number => {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`${name} '${raw}' — a positive integer is expected`, 2);
  }
  return value;
};

/**
 * Same as `positiveInt`, but ZERO IS ALLOWED and means "switched off" (the idle
 * ceiling). A separate parser rather than a special value inside the first one:
 * "0 is off" holds for this ceiling and must not silently become legal for a poll
 * interval or a turn limit, where zero is a mistake.
 */
const nonNegativeInt = (argv: readonly string[], name: string, fallback: number): number => {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return fail(`${name} '${raw}' — a non-negative integer is expected (0 switches it off)`, 2);
  }
  return value;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const appendEvent = (journalPath: string, event: OrchestratorEvent): void => {
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${renderEventLine(event)}\n`, "utf8");
};

/** The prompt for a role from its `instructions` (the texts are read off the working tree). */
const buildPromptForRole = (role: Role, thread: string, repo: string): string =>
  buildLaunchPrompt({
    role: role.id,
    thread,
    instructions: (role.instructions ?? []).map((entry) => ({
      path: entry.path,
      text: readFile(join(repo, entry.path), `instructions of role ${role.id}`),
    })),
  });

/**
 * Append a message file to a thread (the same path as `new-message`, but as a
 * subroutine — the force stop needs it for a trace IN THE THREAD). It writes the
 * file; committing and pushing is up to the caller, as with `new-message`.
 */
const postThreadMessage = (
  root: string,
  threadId: string,
  registry: RoleRegistry,
  input: { from: string; expects: Expects; waitingOn?: readonly string[]; text: string },
): void => {
  if (!registry.isKnown(input.from)) fail(`role '${input.from}' is not listed in the config`, 2);
  const threadDir = join(root, threadId);
  if (!existsSync(threadDir)) fail(`thread '${threadId}' not found in '${root}'`, 2);
  const messagesDir = join(threadDir, "messages");
  const threadHasMessages = existsSync(messagesDir);
  const existingTs = threadHasMessages
    ? readdirSync(messagesDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => parseMessageFile(readFileSync(join(messagesDir, name), "utf8")).fields.date)
        .filter((date) => date.includes("T"))
    : [];
  let planned: ReturnType<typeof planNewMessage>;
  try {
    planned = planNewMessage({
      from: input.from,
      // The announcement is SIGNED by whoever forced the stop and WRITTEN by the
      // package: `from` and `worker` answer two different questions, and this is the
      // one message in the protocol where the difference is visible in one line.
      worker: PACKAGE_WORKER,
      date: nextMessageTimestamp(new Date(), existingTs),
      expects: input.expects,
      ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
      text: input.text,
      threadHasMessages,
    });
  } catch (error) {
    if (error instanceof WriteRefusedError) {
      fail(error.message, 2);
      return;
    }
    throw error;
  }
  const path = join(threadDir, planned.path);
  if (existsSync(path))
    fail(`file '${planned.path}' already exists — two writes within one second?`, 2);
  writeOut(path, planned.content);
};

type RunParams = {
  readonly journalPath: string;
  readonly mailRoot: string;
  readonly roleId: string;
  readonly thread: string;
  readonly prompt: string;
  readonly exec: string;
  readonly maxTurns: string;
  readonly wallClockMs: number;
  readonly pollMs: number;
  /** The idle ceiling: no traces of activity for this long → `stalled` (R6). 0 — off. */
  readonly idleMs: number;
  /** The working repository whose traces are watched — the tree the session lands in. */
  readonly repo: string;
  readonly ids: readonly string[];
  readonly now: Date;
  readonly maxConsecutive: number;
  /** The force-stop flag file (S4). Present — we put the session down at a safe point. */
  readonly forceFlag?: string;
  /** The permission profile of the role being raised — part of the launch contract (S7). */
  readonly launch: Launch;
  /** Where to save the session output: silence can be examined without a witness. */
  readonly sessionLog: string;
  /** The raw stream beside it (`.jsonl`) — the primary source a rendering cannot replace. */
  readonly sessionStream: string;
  /** Where the session reads its own id (R7): written when the init line arrives. */
  readonly sessionIdFile: string;
  /** The child process environment: the inherited one + the project preamble (S8). */
  readonly env: NodeJS.ProcessEnv;
  /** What is being raised, as the session will record it in its messages (R7). */
  readonly worker: string;
};

/**
 * A SIGNATURE OF THE WORKING TREE — one of the activity traces (R6). The dirty set
 * plus the head commit cover both halves of "the session did something with the
 * code": an edit not committed yet, and a commit that cleaned the tree. Taken
 * through git rather than by walking mtimes: git already keeps that index, and a
 * walk of a monorepo every poll would be paid for by the observed session.
 *
 * An unreadable repository is a CONSTANT signature, not a throw: a broken git must
 * not make the whole run look either alive or dead by itself — the other traces
 * keep working.
 */
const worktreeSignature = (repo: string): string => {
  try {
    const status = execFileSync("git", ["-C", repo, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
    const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return createHash("sha1").update(head).update(status).digest("hex").slice(0, 16);
  } catch {
    return "unavailable";
  }
};

/** How many milliseconds of CPU one clock tick is. Linux USER_HZ is 100, fixed in practice. */
const TICK_MS = 10;

/**
 * CUMULATIVE CPU TIME OF THE PROCESS GROUP — the trace that keeps growing while a
 * session thinks in silence: a long model turn writes nothing to the stream and
 * touches no file, yet it is alive. The whole GROUP is summed, not the direct
 * child: the agent works through subprocesses, and their time is its time.
 *
 * `undefined` where there is no /proc (not Linux). An unmeasurable trace is absent
 * rather than zero — `traceChanged` deliberately does not read it as silence.
 */
const groupCpuMs = (pgid: number): number | undefined => {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }
  let total = 0;
  let seen = false;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch {
      continue; // the process ended between the listing and the read — normal
    }
    // The command name is in parentheses and may itself contain spaces, so the
    // fields are counted from the LAST ')': state, ppid, pgrp, … utime, stime.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) !== pgid) continue;
    seen = true;
    total += (Number(fields[11]) + Number(fields[12])) * TICK_MS;
  }
  return seen ? Math.round(total) : undefined;
};

/** Who/why from the force-flag file (JSON, written by `stop --mode force`). Lazily. */
const readForceFlag = (path: string): { by?: string; note?: string } => {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { by?: unknown; note?: unknown };
    return {
      ...(typeof raw.by === "string" ? { by: raw.by } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    };
  } catch {
    return {}; // an empty/broken flag — the stop still happens, merely without who/why
  }
};

/**
 * ONE run: launching the role as `claude -p` on a thread plus observing it until a
 * terminal state (S1+S2). It writes `lease-acquired`+`launch` BEFORE the spawn,
 * watches for the turn being passed (from the thread source) and for the process,
 * and releases the lease leaving a trace. Used both by the manual `run` and by the
 * `daemon`. Returns the outcome (or `skip`, if `planLaunch` refused —
 * ceiling/active/exhausted).
 */
const runOne = async (p: RunParams): Promise<"skip" | ReleaseReason> => {
  const events = existsSync(p.journalPath)
    ? parseJournal(readFile(p.journalPath, "orchestrator journal"))
    : [];
  const plan = planLaunch({
    events,
    role: p.roleId,
    thread: p.thread,
    now: p.now,
    wallClockMs: p.wallClockMs,
    maxConsecutive: p.maxConsecutive,
  });
  if (!plan.ok) {
    err(`agent-protocol: the launch of ${p.roleId}/${p.thread} was refused (${plan.reason})`);
    return "skip";
  }

  // WRITING BEFORE THE SPAWN (curator's requirement 2): should the process die at
  // startup, from the outside it reads as "an attempt happened and broke off"
  // rather than "nothing was going on".
  for (const event of plan.events) appendEvent(p.journalPath, event);

  // THE DEATH OF THE OBSERVER ITSELF ALSO LEAVES A TRACE. The 2026-07-25
  // acceptance: the daemon returned control right after the spawn, the session was
  // left an orphan and finished the job — while the lease stayed `running`
  // forever, that is, the journal started lying "it is working" about something
  // long done. A lease with nobody left to close it is the worst outcome of all:
  // from the outside it is indistinguishable from normal work.
  //
  // What is covered: a normal exit, an unhandled exception, SIGINT, SIGTERM.
  // SIGKILL cannot be intercepted, and we do not promise that.
  let settled = false;
  const recordSupervisorGone = (): void => {
    if (settled) return;
    settled = true;
    // WE PUT THE GROUP DOWN BEFORE WRITING — as in the two other release sites.
    // Otherwise the "lease released" record goes into the journal while the
    // orphaned session is still writing: `supervisor-gone` is an unsuccessful
    // terminal state, the pair immediately becomes `launchable`, and the next tick
    // (or a daemon raised by systemd seconds later) would start a SECOND session on
    // the same thread on top of the live first one. This is exactly the class the
    // whole package is built for (reviewer-pr's finding on PR #9).
    if (!exited && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // the group is already gone — fine
      }
    }
    appendEvent(p.journalPath, {
      kind: "lease-released",
      ts: eventTimestamp(new Date()),
      role: p.roleId,
      thread: p.thread,
      reason: "supervisor-gone",
      output: p.sessionLog,
    });
  };
  process.on("exit", recordSupervisorGone);
  const onSignal = (signal: NodeJS.Signals) => (): void => {
    recordSupervisorGone();
    err(
      `agent-protocol: the observer received ${signal} — the lease was closed as supervisor-gone`,
    );
    process.exit(1);
  };
  const onSigint = onSignal("SIGINT");
  const onSigterm = onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  const releaseGuards = (): void => {
    settled = true;
    process.off("exit", recordSupervisorGone);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };

  // THE SESSION OUTPUT IS WRITTEN TO DISK, not only to the operator's screen — and
  // as of R6 it actually arrives there. Two files: the RAW stream as it came
  // (`.jsonl`, the primary source) and its human reading (`.log`, what the journal
  // points at). Why both, and why the stream format at all — see
  // `orchestrator/transcript.ts`; in one line: the old log collected stderr while
  // the agent speaks on stdout, and the old format spoke only once, at the end of a
  // run that a break never reaches.
  mkdirSync(dirname(p.sessionLog), { recursive: true });
  const sink = openSync(p.sessionLog, "a");
  const rawSink = openSync(p.sessionStream, "a");
  let sinksOpen = true;
  const closeSinks = (): void => {
    if (!sinksOpen) return;
    sinksOpen = false;
    closeSync(sink);
    closeSync(rawSink);
  };
  const writeLog = (text: string): void => {
    if (!sinksOpen) return;
    writeSync(sink, `${stampLine(new Date(), text)}\n`);
  };
  writeLog(`supervisor  ${p.roleId}/${p.thread}  raw stream ${p.sessionStream}`);

  // The spawn happens in ITS OWN process group (`detached`): the whole group will
  // have to be put down, not just the direct child — a SIGTERM to a shell/launcher
  // does not reach its children (the stub → sleep, `claude` → its subprocesses),
  // and they would be orphaned.
  const child = spawn(
    p.exec,
    buildLaunchArgv({ prompt: p.prompt, maxTurns: p.maxTurns, launch: p.launch }),
    {
      // BOTH streams are piped now. Inheriting stdout used to leave the operator's
      // terminal as the only place the session's own words existed — that is,
      // whoever was not watching had nothing to analyse afterwards. The supervisor
      // relays the same lines to its own stdout, so the live view is not lost.
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      // The session is told WHAT it is and WHERE it will find its own id (R7): both
      // are set here, over the project preamble, because they describe THIS run and
      // nothing in the config may claim to know them.
      env: {
        ...p.env,
        [LAUNCH_ENV.worker]: p.worker,
        [LAUNCH_ENV.sessionFile]: p.sessionIdFile,
      },
    },
  );

  // A chunk boundary falls in the middle of a JSON line far more often than it
  // looks, so the tail is carried over rather than rendered as it is.
  let pending = "";
  // THE SESSION LEARNS ITS OWN ID (R7) — from the init line of its own stream, which
  // the supervisor is reading anyway, written into the file whose path the session
  // was given in its environment. Once: the id does not change mid-run, and a
  // rewrite would only add a window in which the file is empty while somebody reads
  // it. A failure to write is NOT fatal — the run goes on and its messages simply
  // carry no session; losing a run over a provenance field would be the wrong trade.
  let sessionIdSeen = false;
  const rememberSessionId = (line: string): void => {
    if (sessionIdSeen) return;
    const id = sessionIdOf(line);
    if (id === undefined) return;
    sessionIdSeen = true;
    try {
      writeFileSync(p.sessionIdFile, id, "utf8");
      writeLog(`supervisor  session ${id} → ${p.sessionIdFile}`);
    } catch (error) {
      writeLog(`supervisor  could not write the session id: ${(error as Error).message}`);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    if (!sinksOpen) return;
    writeSync(rawSink, chunk);
    const split = splitStreamChunk(pending, chunk.toString("utf8"));
    pending = split.rest;
    for (const line of split.lines) {
      rememberSessionId(line);
      for (const rendered of renderStreamLine(line)) {
        writeLog(rendered);
        out(rendered);
      }
    }
  });
  // stderr keeps going into the readable log verbatim: a launcher's complaint ("the
  // binary is not found", a stack trace) is not stream format and must not be
  // rendered — it is the answer itself.
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim() !== "") writeLog(`stderr  ${line}`);
    }
  });

  let exited = false;
  let exitCode: number | null = null;
  let spawnError: Error | undefined;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
    // The unfinished tail is flushed: half a line is neither renderable later nor
    // recoverable, and the last line before a break is the one worth reading.
    if (pending.trim() !== "") {
      for (const rendered of renderStreamLine(pending)) writeLog(rendered);
      pending = "";
    }
    writeLog(`supervisor  the session exited, code ${code}`);
    closeSinks();
  });
  child.on("error", (error) => {
    exited = true;
    spawnError = error;
  });

  const deadlineMs = new Date(plan.deadline).getTime();
  let lifecycle: Lifecycle = "running";

  // THE IDLE WATCH (R6). The traces are sampled here, where the IO is; the verdict
  // is `activity.ts`. The first sample is taken before the first poll, so the
  // silence is counted from the launch and not from the first tick.
  const fileSize = (path: string): number => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  };
  const sampleTrace = (): ActivityTrace => {
    const cpuMs = child.pid === undefined ? undefined : groupCpuMs(child.pid);
    return {
      logBytes: fileSize(p.sessionLog) + fileSize(p.sessionStream),
      worktree: worktreeSignature(p.repo),
      ...(cpuMs === undefined ? {} : { cpuMs }),
    };
  };
  let watch: IdleWatch = startWatch(sampleTrace(), Date.now());
  let quietMs = 0;

  while (true) {
    await sleep(p.pollMs);

    // THE FORCE STOP (S4) is checked FIRST in the tick and at a SAFE POINT: between
    // polls, not in the middle of our own write (an append is atomic). The group is
    // put down with SIGTERM (not KILL): `claude` is given the chance to finish
    // writing/committing. The trace is a `stop` event with `by`/`note` (who/why)
    // plus `ts` (when): self-sufficient in the journal.
    if (p.forceFlag !== undefined && existsSync(p.forceFlag)) {
      if (!exited && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // the group is already gone — fine
        }
      }
      const { by, note } = readForceFlag(p.forceFlag);
      releaseGuards();
      appendEvent(p.journalPath, {
        kind: "stop",
        ts: eventTimestamp(new Date()),
        role: p.roleId,
        thread: p.thread,
        mode: "forced",
        ...(by === undefined ? {} : { by }),
        ...(note === undefined ? {} : { note }),
      });
      writeLog(
        `supervisor  the session was stopped by force${by === undefined ? "" : ` by ${by}`}`,
      );
      closeSinks();
      return "forced";
    }

    // The passing of the turn comes from the THREAD SOURCE (the same one as
    // `mail`): the thread was taken under lease and was waiting on the role; it
    // stopped waiting on it → the turn was passed. Not "code 0", not "the mail is
    // empty".
    // THE MOST DANGEROUS PLACE OF THE ISOLATION — the decision is moved into
    // `handoffDetected`, together with its test and its argument (a broken thread
    // under lease must not read as a passed turn). What is left here is collecting
    // the input and complaining out loud.
    const scan = loadThreads(p.mailRoot, p.ids);
    const threadUnreadable = scan.failures.some((failure) => failure.id === p.thread);
    if (threadUnreadable) {
      err(
        `agent-protocol: thread ${p.thread} under lease is unreadable — the passed turn is NOT counted`,
      );
    }
    const handedOff = handoffDetected({
      threadUnreadable,
      waitingThreads: threadsWaitingOn(
        scan.threads.map((loaded) => loaded.thread),
        p.roleId,
      ),
      thread: p.thread,
    });
    // The traces of activity: has the session produced ANYTHING since the last poll
    // (R6). Sampled every tick, judged against the ceiling — a session that has gone
    // quiet is `stalled`, not `timeout`.
    const idle = idleStep({
      watch,
      trace: sampleTrace(),
      nowMs: Date.now(),
      idleMs: p.idleMs,
    });
    watch = idle.watch;
    quietMs = idle.quietMs;

    const step = observeStep(lifecycle, {
      handedOff,
      processExited: exited,
      overdue: Date.now() > deadlineMs,
      // A process that has already exited is closed by its own branch: "it produced
      // nothing" is a statement about a LIVE session.
      idle: !exited && idle.stalled,
    });
    if (step === null) continue;

    const base = { ts: eventTimestamp(new Date()), role: p.roleId, thread: p.thread };
    if (step.record === "handoff-detected") {
      appendEvent(p.journalPath, stepEvent(step, base));
      lifecycle = "draining";
      out(`agent-protocol: the turn on ${p.thread} was passed — ${p.roleId} is draining`);
      continue;
    }

    // A terminal lease-released. The process is still alive (stuck/finishing up) —
    // we put down the WHOLE group (`-pid`): wall-clock hygiene for a timeout,
    // clean-up of a hung process for completed. The group is already dead → ESRCH,
    // swallowed.
    if (!exited && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // the group is already gone — fine
      }
    }
    releaseGuards();
    appendEvent(p.journalPath, stepEvent(step, base, { exitCode, output: p.sessionLog }));
    if (spawnError !== undefined) {
      err(`agent-protocol: the spawn of '${p.exec}' failed: ${spawnError.message}`);
    }
    // A run that did not pass the turn MUST show where to look: five minutes of
    // silence must not look like work.
    if (step.reason !== "completed") {
      const quiet = step.reason === "stalled" ? ` (${describeQuiet(quietMs)})` : "";
      writeLog(`supervisor  the lease was released: ${step.reason}${quiet}`);
      err(
        `agent-protocol: the turn was not passed (${step.reason}${quiet}) — session output: ${p.sessionLog}`,
      );
    }
    closeSinks();
    return step.reason;
  }
};

/**
 * The manual launch of ONE role on ONE thread (S1+S2). It resolves the role into a
 * prompt, checks launchability, and hands over to `runOne`. `--exec` (default
 * `claude`) is injected: acceptance aims at the real binary, checks aim at a stub.
 */
const orchestratorRun = async (argv: readonly string[]): Promise<void> => {
  const paths = pathsFrom(argv);
  const journalPath = flag(argv, "--journal") ?? paths.journal;
  const roleId = required(argv, "--role");
  const thread = required(argv, "--thread");
  const mailRoot = flag(argv, "--root") ?? paths.mailRoot;
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());

  const registry = registryFrom(argv, undefined);
  const role = registry.get(roleId);
  if (role === undefined) {
    fail(`role '${roleId}' is not listed in the config`, 2);
    return;
  }
  const can = roleLaunchability(role);
  if (!can.launchable) {
    fail(`role '${roleId}' is not launched by the orchestrator: ${can.reason}`, 2);
    return;
  }
  const prompt = buildPromptForRole(role, thread, repo);

  const now = orchestratorNow(argv);
  const wallClockMs = positiveInt(argv, "--wall-clock", DEFAULT_WALL_CLOCK_SECONDS) * 1000;
  // `--idle 0` switches the detector off — the honest way to say "watch by the wall
  // clock only", without a second flag beside it.
  const idleMs = nonNegativeInt(argv, "--idle", DEFAULT_IDLE_MS / 1000) * 1000;
  const maxConsecutive = positiveInt(argv, "--max-runs", MAX_CONSECUTIVE_RUNS);
  const pollMs = positiveInt(argv, "--poll", 10) * 1000;
  const exec = flag(argv, "--exec") ?? "claude";
  const maxTurns = String(positiveInt(argv, "--max-turns", DEFAULT_MAX_TURNS));
  const forceFlag = flag(argv, "--force-flag"); // the force stop applies to a manual run too

  if (!argv.includes("--write")) {
    const events = existsSync(journalPath)
      ? parseJournal(readFile(journalPath, "orchestrator journal"))
      : [];
    const plan = planLaunch({ events, role: roleId, thread, now, wallClockMs, maxConsecutive });
    if (!plan.ok) {
      fail(`the launch was refused (${plan.reason}) — a ceiling fired, see the journal`, 2);
      return;
    }
    out(
      `agent-protocol: would run '${exec} -p' and watch for the turn to be passed on ${thread} (role ${roleId}, deadline ${plan.deadline}, poll ${pollMs / 1000}s); --write performs it. Pre-events:`,
    );
    for (const event of plan.events) out(renderEventLine(event));
    return;
  }

  // The profile exists by construction — `roleLaunchability` above does not let a
  // role through without one; the check here is for the types and in case that
  // check is ever relaxed.
  if (role.launch === undefined) {
    fail(
      `role '${roleId}' has no launch profile — raising it with unassigned permissions is not allowed`,
      2,
    );
    return;
  }
  requirePreflight(argv, exec);
  const sessionLog = sessionLogPath(
    join(dirname(journalPath), "sessions"),
    roleId,
    thread,
    eventTimestamp(now),
  );
  const reason = await runOne({
    journalPath,
    mailRoot,
    roleId,
    thread,
    prompt,
    exec,
    maxTurns,
    launch: role.launch,
    sessionLog,
    sessionStream: sessionStreamPath(sessionLog),
    sessionIdFile: sessionIdPath(sessionLog),
    worker: flag(argv, "--worker") ?? DEFAULT_WORKER,
    env: childEnvFrom(argv),
    wallClockMs,
    pollMs,
    idleMs,
    repo,
    ids: registry.ids(),
    now,
    maxConsecutive,
    ...(forceFlag === undefined ? {} : { forceFlag }),
  });
  if (reason !== "skip") out(`agent-protocol: the run of ${roleId}/${thread} finished: ${reason}`);
};

/**
 * The daemon: launching roles BY MAIL, with no human in the loop (S3). Every tick
 * it reads the flag files (enable/stop), the mail (the thread source) and the
 * journal, calls `planTick` and executes ONE decision: `halt` (the stop flag) —
 * exit; `disabled` (no enable flag) — wait; `refused` — write `launch-refused`
 * (the global ceiling with a trace); `launch` — raise the pair through `runOne`
 * and tick again.
 *
 * THREE GUARDS AGAINST UNSUPERVISED SPENDING (curator's requirements for S3):
 *  - the starting state is OFF: without an `--enable-flag` on disk there is not a
 *    single launch; john enables it by creating the file. The first autonomous
 *    launch is not an accident.
 *  - the emergency brake: `--stop-flag` is checked BEFORE every tick and overrides
 *    the enable. The simplest form of S4 is already here.
 *  - the global ceiling — with a trace in the journal.
 *  - S5: `--holds` — a role taken by a LIVE MANUAL SESSION is not raised
 *    (otherwise the daemon would start a second session of the same role on top of
 *    a working one). The skip is not silent: a line into the stream on every tick.
 *
 * The machine-reboot role (whether the daemon comes up by itself or by hand) is
 * john's fork and lies outside the daemon code: the daemon is the same, only the
 * way it is started differs.
 */
const orchestratorDaemon = async (argv: readonly string[]): Promise<void> => {
  // S6: not a single path in the operational command — everything comes from the
  // config; the flags remain an override for checks on a copy of the mail.
  const paths = pathsFrom(argv);
  const journalPath = flag(argv, "--journal") ?? paths.journal;
  const mailRoot = flag(argv, "--root") ?? paths.mailRoot;
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());
  const enableFlag = flag(argv, "--enable-flag") ?? paths.enableFlag;
  const stopFlag = flag(argv, "--stop-flag") ?? paths.stopFlag;
  const forceFlag = flag(argv, "--force-flag") ?? paths.forceFlag;
  const holdsDir = flag(argv, "--holds") ?? paths.holds;

  const registry = registryFrom(argv, undefined);
  const childEnv = childEnvFrom(argv);
  const ids = registry.ids();
  const launchable = registry
    .active()
    .filter((role) => roleLaunchability(role).launchable)
    .map((role) => role.id);

  const tickMs = positiveInt(argv, "--tick", 30) * 1000;
  const wallClockMs = positiveInt(argv, "--wall-clock", DEFAULT_WALL_CLOCK_SECONDS) * 1000;
  // `--idle 0` switches the detector off — the honest way to say "watch by the wall
  // clock only", without a second flag beside it.
  const idleMs = nonNegativeInt(argv, "--idle", DEFAULT_IDLE_MS / 1000) * 1000;
  const maxConsecutive = positiveInt(argv, "--max-runs", MAX_CONSECUTIVE_RUNS);
  const pollMs = positiveInt(argv, "--poll", 10) * 1000;
  const exec = flag(argv, "--exec") ?? "claude";
  // What the raised sessions call themselves in the messages they write (R7). It
  // stands beside `--exec` on purpose: change the binary and you change the answer.
  const worker = flag(argv, "--worker") ?? DEFAULT_WORKER;
  const maxTurns = String(positiveInt(argv, "--max-turns", DEFAULT_MAX_TURNS));
  const once = argv.includes("--once"); // a single tick — for checks

  // Preflight BEFORE the loop: a daemon started without the agent binary or with
  // stale mail "works" — and does the wrong thing. A refusal before the first
  // lease.
  requirePreflight(argv, exec);

  // The banner states the FACT rather than always "DISABLED": help text that lies
  // about the state cost a separate hypothesis about the cause of a failure during
  // an acceptance review.
  const enabledAtStart = existsSync(enableFlag);
  out(
    `agent-protocol: the daemon is up, launches are ${enabledAtStart ? "ENABLED" : `disabled (no '${enableFlag}')`}; stop '${stopFlag}', force '${forceFlag}'; roles ${launchable.join(", ") || "—"}`,
  );

  // A lease nobody was left to close is indistinguishable from work from the
  // outside — a new supervisor must say so out loud instead of quietly carrying on.
  const orphans = unclosedLeases(
    existsSync(journalPath) ? parseJournal(readFile(journalPath, "orchestrator journal")) : [],
    new Date(),
  );
  for (const orphan of orphans) {
    err(
      `agent-protocol: lease ${orphan.role}/${orphan.thread} was left CLOSED BY NOTHING (${orphan.state}, attempt ${orphan.attempt})${orphan.overdue ? ", OVERDUE" : ""} — the supervisor was killed in a way that left it no time to record (SIGKILL/machine crash). Close it by hand: orchestrator record --kind lease-released --reason supervisor-gone`,
    );
  }

  for (;;) {
    // The candidates are (role, thread) pairs where a launchable role is being
    // waited on in the thread.
    // THE ISOLATION WAS BUILT FOR THIS PLACE: the daemon ticks with no human
    // around, and before it one malformed file in one thread killed the whole
    // loop — while from the outside it would look like "nothing arrived overnight".
    // Now a broken thread drops out of the candidates, the complaint is repeated
    // EVERY tick (not a single line at startup that nobody sees), and the daemon
    // keeps working.
    const scan = loadThreads(mailRoot, ids);
    for (const line of renderThreadFailures(scan.failures)) err(`agent-protocol: ${line}`);
    const threads = scan.threads.map((loaded) => loaded.thread);
    const candidates = launchable.flatMap((roleId) =>
      threadsWaitingOn(threads, roleId).map((thread) => ({ role: roleId, thread })),
    );
    const events = existsSync(journalPath)
      ? parseJournal(readFile(journalPath, "orchestrator journal"))
      : [];
    // The holds are read EVERY tick, not once at startup: a manual session is taken
    // and released while the daemon is already spinning.
    const held = heldRoles(foldHolds(loadHolds(holdsDir), new Date()));
    const decision = planTick({
      enabled: existsSync(enableFlag),
      held,
      // The force flag stops the daemon as well (S4): its current session is put
      // down by the observer, and taking a new one is not allowed — otherwise the
      // next tick would raise a role right under the force.
      stopped: existsSync(stopFlag) || existsSync(forceFlag),
      events,
      candidates,
      now: new Date(),
      maxConsecutive,
    });

    if (decision.kind === "halt") {
      out(
        `agent-protocol: the daemon stopped — the ${existsSync(forceFlag) ? "force" : "stop"} flag`,
      );
      return;
    }
    if (decision.kind === "held") {
      // NOT written into the journal: a hold lives for hours, and a record every
      // tick would drown the session journal in noise. But staying silent is not
      // allowed either — a forgotten hold has to be audible, hence a line into the
      // daemon stream on every tick.
      err(`agent-protocol: skipping — taken by manual sessions: ${decision.roles.join(", ")}`);
    } else if (decision.kind === "refused") {
      appendEvent(journalPath, {
        kind: "launch-refused",
        ts: eventTimestamp(new Date()),
        role: decision.role,
        thread: decision.thread,
        reason: decision.reason,
      });
      err(
        `agent-protocol: the launch of ${decision.role}/${decision.thread} was refused (${decision.reason})`,
      );
    } else if (decision.kind === "launch") {
      const role = registry.get(decision.role);
      // The permission profile exists by construction: `launchable` was computed
      // through `roleLaunchability`, which does not let a role without a profile
      // through.
      if (role?.launch !== undefined) {
        const startedAt = new Date();
        const sessionLog = sessionLogPath(
          join(dirname(journalPath), "sessions"),
          decision.role,
          decision.thread,
          eventTimestamp(startedAt),
        );
        const reason = await runOne({
          journalPath,
          mailRoot,
          roleId: decision.role,
          thread: decision.thread,
          prompt: buildPromptForRole(role, decision.thread, repo),
          exec,
          maxTurns,
          launch: role.launch,
          env: childEnv,
          sessionLog,
          sessionStream: sessionStreamPath(sessionLog),
          sessionIdFile: sessionIdPath(sessionLog),
          worker,
          wallClockMs,
          pollMs,
          idleMs,
          repo,
          ids,
          now: startedAt,
          maxConsecutive,
          forceFlag,
        });
        out(`agent-protocol: daemon — ${decision.role}/${decision.thread}: ${reason}`);
      }
    }
    // decision.kind === "disabled" | "idle" — we wait and tick again.

    if (once) return;
    await sleep(tickMs);
  }
};

/** The journal shown to john (S4): the history of events in order, readably. */
const orchestratorLog = (argv: readonly string[]): void => {
  const path = flag(argv, "--journal") ?? pathsFrom(argv).journal;
  const events = existsSync(path) ? parseJournal(readFile(path, "orchestrator journal")) : [];
  out(renderLog(events));
};

/**
 * A forced stop (S4). `graceful` creates the stop flag: the daemon lets the
 * current session run to its natural terminal state and goes dark (through
 * draining), taking nothing new. `force` creates the force flag with `by`/`note`
 * (the observer reads it and puts the session down at a safe point, leaving a
 * journal trace) AND posts a TRACE IN THE THREAD (who/why), so that
 * "who/when/why" exists both in the journal and in the thread.
 */
const orchestratorStop = (argv: readonly string[]): void => {
  const mode = required(argv, "--mode");
  if (mode !== "graceful" && mode !== "force") {
    fail(`--mode '${mode}' — allowed values are graceful | force`, 2);
    return;
  }
  const write = argv.includes("--write");

  if (mode === "graceful") {
    const stopFlag = flag(argv, "--stop-flag") ?? pathsFrom(argv).stopFlag;
    if (!write) {
      out(
        `agent-protocol: would create the stop flag '${stopFlag}' (the daemon finishes the current session and goes dark); --write performs it`,
      );
      return;
    }
    mkdirSync(dirname(stopFlag), { recursive: true });
    writeFileSync(stopFlag, "", "utf8");
    out(`agent-protocol: graceful stop — the stop flag '${stopFlag}' was created`);
    return;
  }

  // force: a flag with who/why plus an announcement in the thread.
  const paths = pathsFrom(argv);
  const forceFlag = flag(argv, "--force-flag") ?? paths.forceFlag;
  const by = required(argv, "--by");
  const why = required(argv, "--reason");
  const root = flag(argv, "--root") ?? paths.mailRoot;
  const threadId = required(argv, "--thread");
  const registry = registryFrom(argv, repoOf(root));
  // The announcement in the thread is signed by WHOEVER IS FORCING (`--by`),
  // curator's decision: a stop is a human action, the orchestrator merely executes
  // it; the merge notifier (`github`) must not sign it — that would mix
  // identities. Hence `--by` must be a known role (john/curator) rather than free
  // text.
  if (!registry.isKnown(by)) {
    fail(
      `--by '${by}' — a force is signed by a role (who is stopping it), and that role is not in the config`,
      2,
    );
    return;
  }
  const flagBody = JSON.stringify({ by, note: why });
  const text = `The session on thread ${threadId} was force-stopped (by ${by}): ${why}`;

  if (!write) {
    out(
      `agent-protocol: would create the force flag '${forceFlag}' and announce it in thread ${threadId} from ${by}; --write performs it`,
    );
    return;
  }
  mkdirSync(dirname(forceFlag), { recursive: true });
  writeFileSync(forceFlag, flagBody, "utf8");
  postThreadMessage(root, threadId, registry, {
    from: by,
    expects: "none",
    text,
  });
  out(
    `agent-protocol: force stop — the flag '${forceFlag}' was created, the trace was announced in thread ${threadId}`,
  );
};

/**
 * A hold on a manual session (S5): `take` declares the role taken until a
 * deadline, `release` removes it. The deadline is written INTO THE FILE
 * (`expires`) rather than taken from the daemon settings: that way the holder and
 * the daemon need not agree on configs, and "until when" is visible in the file
 * itself.
 *
 * `--role` and `--by` are checked against the protocol config: a hold is a
 * statement about a ROLE of the circuit, and a role that does not exist would mean
 * a hold the daemon never matches to a candidate (a protection that quietly failed
 * to fire is the worst kind).
 */
const orchestratorHold = (argv: readonly string[]): void => {
  const mode = required(argv, "--mode");
  if (mode !== "take" && mode !== "release") {
    fail(`--mode '${mode}' — allowed values are take | release`, 2);
    return;
  }
  const holds = flag(argv, "--holds") ?? pathsFrom(argv).holds;
  const roleId = required(argv, "--role");
  const write = argv.includes("--write");
  const path = join(holds, roleId);

  if (mode === "release") {
    if (!existsSync(path)) {
      out(`agent-protocol: there is no hold on '${roleId}' — nothing to release`);
      return;
    }
    if (!write) {
      out(`agent-protocol: would release the hold '${path}'; --write performs it`);
      return;
    }
    rmSync(path);
    out(`agent-protocol: the hold on '${roleId}' was released — the daemon may raise the role`);
    return;
  }

  const by = required(argv, "--by");
  const registry = registryFrom(argv, undefined);
  if (!registry.isKnown(roleId)) {
    fail(
      `--role '${roleId}' — there is no such role in the config, a hold has nothing to match`,
      2,
    );
    return;
  }
  if (!registry.isKnown(by)) {
    fail(
      `--by '${by}' — a hold is held by a role (who took the session), and that role is not in the config`,
      2,
    );
    return;
  }
  const at = orchestratorNow(argv);
  const ttl = positiveInt(argv, "--ttl", HOLD_TTL_SECONDS);
  const note = flag(argv, "--note");
  const record: HoldRecord = {
    role: roleId,
    by,
    taken: holdStamp(at),
    expires: holdExpiry(at, ttl),
    ...(note === undefined ? {} : { note }),
  };

  if (!write) {
    out(
      `agent-protocol: would take '${roleId}' until ${record.expires} (by ${by}); --write performs it`,
    );
    return;
  }
  mkdirSync(holds, { recursive: true });
  // Overwriting IS the extension: there is one hold per role, and a second holder
  // on top of the first is visible in the file (`by`) instead of hiding next to it.
  writeFileSync(path, renderHold(record), "utf8");
  out(
    `agent-protocol: '${roleId}' is taken until ${record.expires} — the daemon does not raise it`,
  );
};

const main = async (argv: readonly string[]): Promise<void> => {
  const [command, subcommand] = argv;
  if (command === "config" && subcommand === "check") {
    configCheck(argv.slice(2));
  } else if (command === "schema" && subcommand === "migrate") {
    schemaMigrate(argv.slice(2));
  } else if (command === "roles" && subcommand === "list") {
    rolesList(argv.slice(2));
  } else if (command === "role" && subcommand === "exists") {
    roleExists(argv.slice(2));
  } else if (command === "index" && subcommand === "build") {
    indexBuild(argv.slice(2));
  } else if (command === "thread" && subcommand === "build") {
    threadBuild(argv.slice(2));
  } else if (command === "check") {
    checkAll(argv.slice(1));
  } else if (command === "migrate") {
    migrate(argv.slice(1));
  } else if (command === "derive") {
    derive(argv.slice(1));
  } else if (command === "new-message") {
    newMessage(argv.slice(1));
  } else if (command === "new-thread") {
    newThread(argv.slice(1));
  } else if (command === "mail") {
    mail(argv.slice(1));
  } else if (command === "orchestrator" && subcommand === "status") {
    orchestratorStatus(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "record") {
    orchestratorRecord(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "run") {
    await orchestratorRun(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "daemon") {
    await orchestratorDaemon(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "log") {
    orchestratorLog(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "stop") {
    orchestratorStop(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "hold") {
    orchestratorHold(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "preflight") {
    orchestratorPreflight(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "enable") {
    orchestratorEnable(argv.slice(2), true);
  } else if (command === "orchestrator" && subcommand === "disable") {
    orchestratorEnable(argv.slice(2), false);
  } else if (command === "orchestrator" && subcommand === "systemd-unit") {
    orchestratorSystemdUnit(argv.slice(2));
  } else {
    fail(USAGE, 2);
  }
};

main(process.argv.slice(2)).catch((error) => {
  err(`agent-protocol: uncaught error: ${(error as Error).message}`);
  process.exit(1);
});
