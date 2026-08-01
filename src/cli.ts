#!/usr/bin/env node
/**
 * The entry point for the operators of the circuit. The full syntax lives in the
 * `USAGE` constant (`usage.ts`), and that is its ONLY source: the header and the help
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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { DEFAULT_CONFIG_PATH } from "./config/config.js";
import { type LoadedConfig, type LoadedPolicy, loadProtocolConfig } from "./config/load.js";
import {
  describeLocalConfig,
  type LoadedLocalConfig,
  LocalConfigError,
  loadLocalConfig,
} from "./config/local.js";
import { describePolicySkew, policyRole } from "./config/policy.js";
import { configSetSummary, planConfigSet } from "./config/set.js";
import { createStandingConfig, standingKey } from "./config/standing.js";
import { type LoadedThread, loadThread, loadThreads, renderThreadFailures } from "./fs/comms.js";
import {
  fileExistsAtRef,
  mailCheckoutFreshness,
  mailCheckoutState,
  messagesAtRef,
  workdirState,
} from "./fs/git.js";
import {
  describeMergeGate,
  evaluateMergeGate,
  powerDocuments,
  unmatchedWorkingCards,
} from "./merge/gate.js";
import { ghPullRequestSchema, ghRefusalHint } from "./merge/gh.js";
import {
  describeAge,
  parseNotifyState,
  planNotifications,
  renderAnnouncement,
  renderNotification,
  renderNotifyState,
  type WaitingPair,
} from "./notify/notify.js";
import { describeSecrets, type LoadedSecrets, loadSecrets } from "./notify/secrets.js";
import { loadTransport, type Transport } from "./notify/transport.js";
import {
  type ActivityTrace,
  describeQuiet,
  type IdleWatch,
  idleStep,
  startWatch,
} from "./orchestrator/activity.js";
import { parseUsage, strayArguments } from "./orchestrator/argv.js";
import {
  type Continuation,
  describeContinuation,
  type OwnMessage,
  planContinuation,
  previousRun,
} from "./orchestrator/continuation.js";
import {
  type DirectiveVerdict,
  describeDirective,
  resolveThreadDirective,
} from "./orchestrator/directive.js";
import {
  agentLiveCheck,
  type DoctorOutcome,
  type DoctorSkipped,
  doctorPassed,
  doctorSummary,
  gitChecks,
  instanceCheck,
  machineConfigCheck,
  mailPresenceCheck,
  repositoryConfigCheck,
} from "./orchestrator/doctor.js";
import {
  foldHolds,
  HOLD_TTL_SECONDS,
  type HoldRecord,
  heldRoles,
  holdExpiry,
  holdStamp,
  parseHold,
  renderHold,
} from "./orchestrator/hold.js";
import { circuitHome } from "./orchestrator/home.js";
import {
  agentStep,
  type InitStep,
  type InstanceOccupant,
  initBlockers,
  initSummary,
  instanceStep,
  mailStep,
  nextLocalConfig,
  operatorStep,
  renderInitSteps,
  secretsStep,
} from "./orchestrator/init.js";
import {
  DIGEST_DIR,
  digestChanged,
  digestIssues,
  digestOf,
  digestPath,
  type InstanceDigest,
  parseDigest,
  renderDigest,
  rolesOfInstance,
} from "./orchestrator/instances.js";
import {
  DEFAULT_WAIT_INPUT_SECONDS,
  describeWait,
  renderWaitMarker,
  waitAuthorised,
} from "./orchestrator/interactive.js";
import {
  eventTimestamp,
  type OrchestratorEvent,
  orchestratorEventSchema,
  parseJournal,
  type ReleaseReason,
  renderEventLine,
  type World,
} from "./orchestrator/journal.js";
import {
  type AgentParams,
  buildLaunchArgv,
  buildLaunchPrompt,
  buildResumePrompt,
  DEFAULT_EXEC,
  DEFAULT_WORKER,
  describeAgent,
  describeCeilings,
  describeGates,
  describeLaunch,
  ignoredDirective,
  LAUNCH_ENV,
  planLaunch,
  type ResolvedCeilings,
  type ResolvedExec,
  type ResolvedGates,
  type ResolvedWorker,
  resolveAgentParams,
  resolveCeilings,
  resolveExec,
  resolveGates,
  resolveWorker,
  roleLaunchability,
} from "./orchestrator/launch.js";
import { foldLeases, isLeaseAlive, unclosedLeases } from "./orchestrator/lease.js";
import { renderLog } from "./orchestrator/log.js";
import { rotateDaemonLog, writeEpochBanner } from "./orchestrator/logsize.js";
import {
  foldMetrics,
  type MergeRecord,
  renderMetrics,
  type VerdictRecord,
} from "./orchestrator/metrics.js";
import { hydrateFromStreams } from "./orchestrator/metrics-cache.js";
import { handoffDetected, type Lifecycle, observeStep, stepEvent } from "./orchestrator/observe.js";
import {
  type OrchestratorPaths,
  orchestratorPaths,
  renderPaths,
  sessionIdPath,
  sessionLogPath,
  sessionStreamPath,
  sessionSupervisorPath,
  sessionWaitPath,
  waitPathFromSessionFile,
} from "./orchestrator/paths.js";
import {
  agentBinaryVerdict,
  daemonPreflightVerdict,
  environmentVerdict,
  MAIL_CHECKOUT_CHECK,
  machineConfigVerdict,
  mailCheckoutVerdict,
  type PreflightCheck,
  preflightPassed,
  renderPreflight,
  workdirVerdict,
} from "./orchestrator/preflight.js";
import {
  DEFAULT_THREAD_PRIORITY,
  describeOrder,
  orderCandidates,
  type RankedCandidate,
  rankCandidates,
  resolveThreadPriority,
  waitingSince,
} from "./orchestrator/priority.js";
import {
  describeQuotaRelease,
  describeQuotaShelf,
  openQuotaShelves,
  type QuotaSignal,
  quotaSignalOf,
} from "./orchestrator/quota.js";
import { renderSystemdUnit } from "./orchestrator/reboot.js";
import { describeResidentWait, residentWaits } from "./orchestrator/resident.js";
import {
  awaitDaemonExit,
  DEFAULT_RESTART_POLL_SEC,
  DEFAULT_RESTART_WAIT_SEC,
  daemonArgvFor,
  daemonArgvPath,
  parseDaemonArgv,
  renderDaemonArgv,
} from "./orchestrator/restart.js";
import {
  describeExclusion,
  describeScope,
  instanceIssues,
  type LaunchScope,
  ownershipIssues,
  resolveLaunchScope,
  scopeFlagIssues,
} from "./orchestrator/scope.js";
import { type OperatorFrame, renderFrame } from "./orchestrator/snapshot.js";
import { foregroundRefusal, planSystemdUnit } from "./orchestrator/systemd.js";
import { type Candidate, describePlan, describeSkip, planTick } from "./orchestrator/tick.js";
import {
  isAssistantStep,
  modelOf,
  type RunUsage,
  renderStreamLine,
  runUsageOf,
  sessionIdOf,
  splitStreamChunk,
  stampLine,
} from "./orchestrator/transcript.js";
import {
  decodeTuiInput,
  initialTuiState,
  invocationOf,
  PASTE_OFF,
  PASTE_ON,
  reduceTui,
  renderTui,
  subjectOf,
  type TuiAction,
} from "./orchestrator/tui.js";
import {
  createWorkspaceLocks,
  describeFinishDirt,
  describeWorkspaceIdentity,
  describeWorkspacePlan,
  dirtLeftByFinish,
  lockHolderPid,
  lockReason,
  mainCheckoutVerdict,
  planWorkspace,
  planWorkspaceIdentity,
  type WorkspaceFacts,
  type WorkspacePlan,
  workspacePath,
  workspaceVerdict,
} from "./orchestrator/workspace.js";
import { ORCHESTRATOR_IDENTITY, roleIdentity } from "./roles/identity.js";
import { RoleConfigError, type RoleRegistry } from "./roles/registry.js";
import { claudeCodeEffortSchema, type Launch, type Role } from "./roles/schema.js";
import {
  type ChangedPathsSource,
  changedPathsGitArgs,
  describeZones,
  parseChangedPaths,
  pathsOutsideZones,
  zoneDenyRules,
} from "./roles/zones.js";
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
  ProtocolVersionError,
} from "./schema/version.js";
import { checkImmutable, checkThread } from "./thread/check.js";
import { fileMailLock, MailCheckoutBusyError, type MailLock } from "./thread/checkout-lock.js";
import {
  DeliveryRefusedError,
  deliverMessage,
  deliverySubject,
  type GitRun,
  type StagedMessage,
} from "./thread/deliver.js";
import {
  parkedThreads,
  renderIndex,
  sessionsThatWrote,
  threadsWaitingOn,
} from "./thread/index-doc.js";
import type {
  Expects,
  LaunchDirective,
  TaskDeclaration,
  ThreadPriorityValue,
} from "./thread/message.js";
import {
  EXPECTS,
  isSessionId,
  isWorkerId,
  KNOWN_WORKERS,
  MessageFormatError,
  PACKAGE_WORKER,
  parseLaunchDirective,
  parseMessageFile,
  parseTaskDeclaration,
  THREAD_PRIORITY_VALUES,
  taskThreadPrefix,
} from "./thread/message.js";
import { migrateLegacyThread, verifyMigration } from "./thread/migrate.js";
import {
  checkTasks,
  collectTaskEvents,
  renderTasksBoard,
  type TaskThreadInput,
  tasksFrom,
} from "./thread/tasks.js";
import { mergedPrs, parkingOf, renderThread, waitingOnOf } from "./thread/thread.js";
import {
  messageTimestamp,
  nextMessageTimestamp,
  type PlannedFile,
  planNewMessage,
  planNewThread,
  threadNumberTaker,
  WriteRefusedError,
} from "./thread/write.js";
import { USAGE } from "./usage.js";

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * WHILE A FRAME IS BEING COLLECTED, A REFUSAL IS AN OUTAGE, NOT AN EXIT (thread 019).
 * The collection reaches for a dozen things that can each be missing for a second — a
 * journal mid-rewrite, an unreadable holds file, a config that would not load — and
 * every one of them says so through `fail`, which exits the process. In a one-shot
 * command that is exactly right. In `--watch` it means the observer dies from a hiccup
 * at the moment observation matters most, so inside the collection the same refusal
 * becomes a throw the watcher catches and shows as an outage line.
 */
class FrameCollectionError extends Error {}
let collectingFrame = false;

const fail = (message: string, code: number): never => {
  if (collectingFrame) throw new FrameCollectionError(message);
  err(`agent-protocol: ${message}`);
  process.exit(code);
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

/** Every occurrence of a repeatable flag (`--task` — one message moves several). */
const flagAll = (argv: readonly string[], name: string): string[] => {
  const values: string[] = [];
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] !== name) continue;
    const value = argv[at + 1];
    if (value === undefined) fail(`${name} is given without a value`, 2);
    values.push(value as string);
  }
  return values;
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
 * WHAT THE PROCESS WORKS BY WHEN THE WIRE IS DOWN (thread `023-daemon-parallelism`).
 *
 * One memory per process, and that is exactly the scope it should have: "the config
 * this run has already read". A one-shot command reads once and the memory is empty
 * when it matters; a daemon reads every tick, and its second read is the one allowed
 * to fall back. The rule and its limits live in `config/standing.ts`.
 */
const standing = createStandingConfig();

/**
 * The config is read ONLY through the package and ONLY at an explicit ref.
 *
 * `--repo` defaults to the repository `--root` belongs to: mail and code live in
 * one repository here, merely on different branches, and making every call repeat
 * the path would breed places for it to drift. A separate `--repo` is needed by
 * the runner, where the mail checkout and the code checkout are different
 * directories.
 */
/**
 * THE OBSERVER DOES NOT GO TO THE NETWORK (thread 019, from john's live failure of
 * 2026-07-28 ~09:57Z). `configFrom` fetches, `operatorFrame` reads the config, and
 * `--watch` calls it once a second — so ssh to github.com going quiet killed the watcher
 * inside `git fetch`. Freezing is not a cache for speed: a watcher looks at STATE, not
 * at the schema, and a config that changes between two frames is not information it can
 * act on. So the config is resolved ONCE, at the start of the watch, and every later
 * frame reads that same answer from memory.
 *
 * It is opt-in rather than the default because the daemon is the other long-lived
 * caller, and IT must see a config edited underneath it — freezing globally would turn
 * a policy change into something that needs a restart to take effect.
 */
let frozenConfig: Map<string, LoadedConfig> | undefined;
const freezeConfig = (): void => {
  frozenConfig ??= new Map();
};

const configFrom = (argv: readonly string[], root?: string): LoadedConfig => {
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

  const path = flag(argv, "--config-path") ?? DEFAULT_CONFIG_PATH;
  // THE FREEZE COMES FIRST, BEFORE THE STANDING READ, and the order is the point: the
  // two mechanisms answer different questions. The freeze says "this caller must not go
  // to the network at all" (the observer, opt-in); standing says "the network failed,
  // keep going on the last answer" (the daemon, always on). A frozen caller falling
  // through to standing would still attempt a fetch every frame — exactly the hang the
  // freeze exists to prevent.
  const key = `${repo} ${ref} ${path}`;
  const frozen = frozenConfig?.get(key);
  if (frozen !== undefined) return frozen;

  const outcome = standing.read(standingKey({ repo, ref, path }), () =>
    loadProtocolConfig({
      repo,
      ref,
      fetch: !noFetch,
      path,
    }),
  );
  if (outcome.kind === "read") {
    frozenConfig?.set(key, outcome.config);
    return outcome.config;
  }
  if (outcome.kind === "stood") {
    // LOUD, EVERY TIME. The whole value of standing on the last config is that the
    // circuit keeps running; the whole danger of it is that it looks identical to a
    // circuit reading current data. The line is on stderr, i.e. in the daemon's tail.
    err(`agent-protocol: WARNING — the config at '${ref}' was NOT re-read: ${outcome.reason}`);
    frozenConfig?.set(key, outcome.config);
    return outcome.config;
  }
  const { error } = outcome;
  if (error instanceof RoleConfigError) return fail(error.message, 2);
  // A version verdict says its own repair — wrapping it in "was not read" would
  // bury the one sentence that fixes it under a sentence that is not even true.
  if (error instanceof ProtocolVersionError) return fail(error.message, 2);
  return fail(`the protocol config at '${ref}' was not read: ${error.message}`, 2);
};

const registryFrom = (argv: readonly string[], root?: string): RoleRegistry =>
  configFrom(argv, root).registry;

/**
 * THE SAME DOOR, ASKED A POLICY QUESTION (thread 037) — for the two commands that read
 * SOMEBODY ELSE'S ref: `zones check` (the base of the PR, doors 2 and 3) and
 * `merge-gate` (the base again, for the documents of power). What they get back is
 * `roles[].id`, `zones`, `instructions[].path` and `workdir.worktrees` — parsed from
 * whatever shape that ref is at, with the skew printed rather than refused.
 *
 * THERE IS NO STANDING AND NO FREEZING HERE, and that is not an oversight: both of
 * those exist for the long-lived callers (the daemon's tick, the watch frame), and both
 * of these commands are one-shot guards that run once and exit. A cache shared with
 * `configFrom` would be worse than none — it is keyed by (repo, ref, path), which says
 * nothing about the INTENT, so a policy read could be handed to a data caller as if the
 * version had been checked.
 */
const policyFrom = (argv: readonly string[], root?: string): LoadedPolicy => {
  const ref = required(argv, "--ref");
  const repo = flag(argv, "--repo") ?? repoOf(root ?? process.cwd());
  const noFetch = argv.includes("--no-fetch");
  if (noFetch && ref.startsWith("origin/")) {
    err(`agent-protocol: WARNING — '${ref}' was not updated (--no-fetch), the config may be stale`);
  }
  const path = flag(argv, "--config-path") ?? DEFAULT_CONFIG_PATH;
  try {
    return loadProtocolConfig({ repo, ref, fetch: !noFetch, path, intent: "policy" });
  } catch (error) {
    if (error instanceof RoleConfigError) return fail(error.message, 2);
    return fail(`the protocol config at '${ref}' was not read: ${(error as Error).message}`, 2);
  }
};

/**
 * THE ENVIRONMENT WITHOUT THE VARIABLES A GIT HOOK EXPORTS. Every hook runs with
 * `GIT_DIR` (and friends) set, and with `GIT_DIR` set `git rev-parse --show-toplevel`
 * stops answering "the root of the repository" and answers "the current directory" —
 * so a guard that resolves the repository from its cwd resolves it to whatever
 * directory the hook's command happened to run in. That is not a hypothetical: the
 * zones guard of thread 020 let a commit into `apps/pronunciation-service` through on
 * its first live test, because `pnpm -F agent-protocol` runs in the package directory
 * and the inherited `GIT_DIR` made that directory look like the repository root — the
 * guard concluded "not a role workspace" and stood aside, silently, in exactly the
 * situation it exists for.
 */
const gitEnvOutsideHook = (): NodeJS.ProcessEnv => {
  const {
    GIT_DIR: _dir,
    GIT_INDEX_FILE: _index,
    GIT_WORK_TREE: _tree,
    GIT_PREFIX: _prefix,
    ...rest
  } = process.env;
  return rest;
};

/**
 * THE REPOSITORY OF THE TREE THIS COMMAND WAS CALLED FROM — the sense in which a
 * config is read BY REF, and in a linked worktree that is exactly right: `--ref HEAD`
 * from a feature worktree must mean the HEAD of THAT tree. Not the base of the
 * circuit's state: see `homeOf` below, and the doc block of `orchestrator/home.ts`
 * for why the two senses had to be split (R26).
 */
const repoOf = (at: string, env?: NodeJS.ProcessEnv): string => {
  try {
    return execFileSync("git", ["-C", at, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      ...(env === undefined ? {} : { env }),
    }).trim();
  } catch (error) {
    return fail(`'${at}' is not inside a git repository: ${(error as Error).message}`, 2);
  }
};

/**
 * WHERE THE STATE OF THE CIRCUIT LIVES ON THIS MACHINE (R26) — the base for
 * `orchestrator.state` and `orchestrator.mailCheckout`, and for the worktrees root,
 * which are facts about the box rather than about the caller's directory. `--repo`
 * still overrides it: the runner and the checks do run against a copy.
 */
const homeOf = (at: string): string => {
  try {
    return circuitHome(at);
  } catch (error) {
    return fail((error as Error).message, 2);
  }
};

const writeOut = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

/**
 * THE LOCK ON THE MAIL CHECKOUT (D-0, thread `023-daemon-parallelism`) — every writer
 * that goes into that directory takes it, and there are exactly two: a message and the
 * instance digest. It lives in the GIT DIRECTORY of the checkout, which is per-checkout
 * and invisible to `git status` — a lock inside the working tree would be untracked
 * dirt, and delivery refuses on dirt. Why the granularity is the checkout and not the
 * branch, and why a local mutex is enough: `thread/checkout-lock.ts`.
 */
/**
 * The git of a delivery, in ONE place for all three of its call sites (a message, a new
 * thread, an instance digest).
 *
 * EVERY GIT FAILURE BECOMES A NAMED REFUSAL CARRYING GIT'S OWN WORDS. Without this the
 * command died on a raw `execFileSync` throw: code 1, a stack trace and not one word
 * about the cause. The case that taught it is the runner, where the checkout has no
 * `user.email` — locally the global config hides it, so the same delivery passed here and
 * failed in CI saying nothing about identity.
 */
const gitIn =
  (checkout: string): GitRun =>
  (args, env) => {
    try {
      return execFileSync("git", ["-C", checkout, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
      });
    } catch (error) {
      const failure = error as { stderr?: string; status?: number };
      const said = (failure.stderr ?? "").trim();
      throw new DeliveryRefusedError(
        `git ${args.join(" ")} failed (code ${failure.status ?? "?"})${said === "" ? "" : `:\n${said}`}`,
      );
    }
  };

const mailLockFor = (input: {
  readonly checkout: string;
  readonly holder: string;
  readonly note: (line: string) => void;
  readonly waitMs?: number;
}): MailLock => {
  const gitDir = execFileSync("git", ["-C", input.checkout, "rev-parse", "--absolute-git-dir"], {
    encoding: "utf8",
  }).trim();
  return fileMailLock({
    path: join(gitDir, "agent-protocol-mail.lock"),
    holder: input.holder,
    note: input.note,
    ...(input.waitMs === undefined ? {} : { waitMs: input.waitMs }),
  });
};

/**
 * EVERYTHING THAT CAN BE WRONG WITH THE REPOSITORY CONFIG, as a list of sentences.
 *
 * It is a function rather than the body of `config check` because `doctor` asks the
 * same question as one row of its checklist (thread 019, the operator tail): a box is
 * ready only if the config it is going to obey holds together. Copying the judgement
 * would mean a rule added to one door and not the other — which is the same drift the
 * package refuses everywhere else.
 */
const configIssues = (
  // NOT 'ReturnType<typeof loadProtocolConfig>': the loader is about to be OVERLOADED by
  // intent (#134, 'data' | 'policy'), and 'ReturnType' resolves to the LAST signature —
  // the policy one, which by construction carries neither the registry nor a whole role.
  // Naming the type the door actually returns is what keeps this reader honest.
  loaded: import("./config/load.js").LoadedConfig,
  repo: string,
): readonly string[] => {
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

  // R13: WHO RAISES WHAT, checked where a human is looking — in the PR that writes it.
  // A launchable role with no instance or with two is refused here precisely because at
  // runtime neither case has an answer: the first is raised by nobody, the second by two
  // boxes whose local leases know nothing of each other.
  const ownership = ownershipIssues({
    instances: loaded.config.instances,
    launchable: loaded.config.roles
      .filter((role) => roleLaunchability(role).launchable)
      .map((role) => role.id),
    // R23-1: a resident role is owned as strictly as a launchable one. Ownership here
    // is not about keeping two daemons off it — nobody raises it — but about "which box
    // hosts that process" being declared rather than remembered.
    resident: loaded.registry.residents(),
    isKnownRole: (id) => loaded.registry.isKnown(id),
  });

  return [...missing, ...ownership];
};

const configCheck = (argv: readonly string[]): void => {
  const loaded = configFrom(argv, undefined);
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());
  const issues = configIssues(loaded, repo);
  if (issues.length === 0) {
    const instances = loaded.config.instances ?? [];
    const topology =
      instances.length === 0
        ? "no instances declared (one box, every role)"
        : `${instances.length} instances (${instances.map((instance) => instance.id).join(", ")})`;
    out(
      `agent-protocol: ok — config '${loaded.path}' at ${loaded.ref}: protocol version ${loaded.config.protocolVersion}, ${loaded.registry.ids().length} roles, ${topology}, mail in branch '${loaded.config.mail.branch}' (${loaded.config.mail.dir})`,
    );
    return;
  }
  err("agent-protocol: the config does not hold together:");
  for (const item of issues) err(`- ${item}`);
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

/**
 * READING A CONVERSATION IS A COMMAND (R3) — the other half of `new-message`.
 *
 * The agent used to be told "read the files of the conversation folder", and that
 * sentence is the storage layer leaking into the prompt: the folder layout, the file
 * naming, which files are derived and which are authored. `thread show` answers the
 * only question the agent actually has — what was said here, in order.
 *
 * IT READS THE MESSAGES, NOT `_thread.md`. The assembled file is derived and may lag
 * behind the messages that are already on disk (its generator runs on a push): a
 * reader that trusted it would miss the newest message exactly when it matters — the
 * one that passed it the turn.
 *
 * `--tail <n>` exists because a live thread outgrows a context window (this
 * repository's 016 passed 300 KB in two days), and the alternative to a bounded read
 * is a reader that quietly reads nothing. It prints how many messages it skipped, so
 * a partial read is visible as one.
 *
 * ATTACHMENTS ARE NAMED, NOT PRINTED: anything in the folder that is neither a
 * message nor a derived file gets listed with its path, so the agent knows what is
 * there without the prompt having to describe the folder.
 */
const threadShow = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const id = flag(argv, "--id") ?? required(argv, "--thread");
  const registry = registryFrom(argv, repoOf(root));
  const scan = loadThreads(root, registry.ids());
  const broken = scan.failures.find((failure) => failure.id === id);
  if (broken !== undefined) fail(`thread '${id}' was not read: ${broken.problem}`, 2);
  const loaded = scan.threads.find((item) => item.thread.id === id);
  if (loaded === undefined) fail(`thread '${id}' not found in '${root}'`, 2);

  const { thread } = loaded as NonNullable<typeof loaded>;
  const tail = flag(argv, "--tail") === undefined ? undefined : positiveInt(argv, "--tail", 0);
  const shown =
    tail === undefined || tail >= thread.messages.length
      ? thread.messages
      : thread.messages.slice(-tail);
  const skipped = thread.messages.length - shown.length;

  if (skipped > 0) {
    out(
      `<!-- agent-protocol: the last ${shown.length} of ${thread.messages.length} messages; ${skipped} earlier ones are NOT shown (--tail) -->`,
    );
  }
  // The task declarations are printed HERE and nowhere else (thread 021): the reading
  // agent has to see them, the committed `_thread.md` must not move a byte.
  out(renderThread(thread.meta, shown, { tasks: true }));

  const dir = join(root, id);
  const attachments = readdirSync(dir).filter(
    (name) => !name.startsWith("_") && name !== "messages" && name !== "INDEX.md",
  );
  if (attachments.length > 0) {
    out("");
    out(
      `<!-- files in the conversation folder besides the messages: ${attachments.join(", ")} -->`,
    );
  }
};

/**
 * The task layer's view of what `loadThreads` returned. Legacy threads carry no
 * message files and therefore no declarations — the board starts from now (thread 021,
 * §5), so their absence here is the decision, not a gap.
 */
const taskInputsOf = (
  threads: readonly LoadedThread[],
): { inputs: TaskThreadInput[]; status: Map<string, "open" | "closed"> } => ({
  inputs: threads.flatMap((loaded) =>
    loaded.input === undefined ? [] : [{ id: loaded.thread.id, entries: loaded.input.entries }],
  ),
  status: new Map(threads.map((loaded) => [loaded.thread.id, loaded.thread.meta.status])),
});

const checkAll = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const { threads, failures } = loadThreads(root, registry.ids());

  const found = threads.flatMap((loaded) =>
    loaded.input === undefined ? [] : checkThread(loaded.input, registry),
  );
  // NOTES ARE SEPARATED HERE, not inside the checker: what a fact about the feed's
  // past COSTS (a red exit code or a line to read) is a decision of the command,
  // while whether it is a fact at all belongs to the checker.
  const notes = found.filter((issue) => issue.severity === "note");
  const issues = found.filter((issue) => issue.severity !== "note");
  const legacy = threads.filter((loaded) => loaded.legacy).map((loaded) => loaded.thread.id);

  // THE CROSS-THREAD HALF OF THE TASK CHECKS (thread 021): a task is opened by one
  // thread and moved from any, so "moved but never opened", "opened twice", "moved
  // after being dropped" and "undone in a closed thread" are only visible with every
  // thread in hand — which this command has anyway.
  const taskInputs = taskInputsOf(threads);
  issues.push(...checkTasks(collectTaskEvents(taskInputs.inputs), taskInputs.status));

  // R13, second half: `_instances/` IS A CLASS, and the checker has to know it as one.
  // It is the only MUTABLE derived thing in an append-only branch — each box rewrites
  // its own state file — so an unrecognised path there is indistinguishable from the
  // retroactive edit the immutability check exists to catch. (The immutability check
  // itself never sees a digest: `messagesAtRef` matches `/messages/*.md` only.)
  const digestDir = join(root, DIGEST_DIR);
  if (existsSync(digestDir)) {
    const contents = new Map<string, string>();
    const files = readdirSync(digestDir);
    for (const name of files) {
      try {
        contents.set(name, readFileSync(join(digestDir, name), "utf8"));
      } catch {
        // Absent from the map IS the unreadable case; `digestIssues` names it.
      }
    }
    issues.push(
      ...digestIssues({
        files,
        contents,
        declared: (configFrom(argv, repoOf(root)).config.instances ?? []).map(
          (instance) => instance.id,
        ),
      }).map((message) => ({ thread: DIGEST_DIR, message })),
    );
  }
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
  if (notes.length > 0) {
    out(`agent-protocol: notes (history, not a violation — the check does not fail on them):`);
    for (const note of notes) {
      out(`- ${note.thread}${note.file === undefined ? "" : `/${note.file}`}: ${note.message}`);
    }
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
  // THE BOARD IS A DERIVED FILE OF THE SAME CLASS AS INDEX (thread 021): nobody edits
  // it by hand, a drift is a red job. The workflow is not touched — it calls `derive
  // --write` once, and the target list lives here.
  {
    const board = tasksFrom(
      taskInputsOf(threads).inputs,
      threads.map((l) => l.thread),
    );
    targets.push({
      path: join(root, "TASKS.md"),
      rendered: renderTasksBoard(board.states, board.waiting),
    });
  }

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

/**
 * THE BOARD FOR MACHINES (thread 021, §2.4). `TASKS.md` is john's screen on GitHub;
 * the TUI (019) and the resident (R23) read THIS, which computes the same model FROM
 * THE THREADS. A consumer that parsed the derived file would reproduce pain 5 one to
 * one: asked "what is being done right now" it would answer with yesterday's bytes, or
 * with silence when the generator failed.
 */
const tasksList = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const { threads, failures } = loadThreads(root, registry.ids());
  for (const line of renderThreadFailures(failures)) err(`agent-protocol: ${line}`);

  const board = tasksFrom(
    taskInputsOf(threads).inputs,
    threads.map((l) => l.thread),
  );
  const only = flag(argv, "--status");
  const states = board.states.filter((state) => only === undefined || state.status === only);

  if (argv.includes("--json")) {
    out(
      JSON.stringify(
        states.map((state) => ({
          ...state,
          who: state.owner ?? board.waiting.get(state.at.thread) ?? "",
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (states.length === 0) {
    out("agent-protocol: no tasks declared yet");
    return;
  }
  for (const state of states) {
    out(
      `${state.id}  ${state.status.padEnd(11)}  ${state.at.thread}  ${state.since.slice(0, 10)}  ${state.title}`,
    );
  }
};

/**
 * WHAT THE CIRCUIT BURNED (thread 029) — the reading half. Everything it needs is
 * already on this box: the journal carries the ledger since the writing half, the mail
 * checkout carries the reviewer's verdicts, and `sessions/` is consulted for ONE fact
 * only — the moment its era begins, which is a boundary of the data rather than a source.
 *
 * The verdict and the merge are recognised out of the message BODY on purpose (john's
 * decision, msg-005, variant A): the writer there is CI by a fixed template, not a human,
 * and the alternative — a header field — costs a schema step for one number.
 */
const VERDICT_LINE = /^verdict:\s*(approve|needs-fixes)\s*$/m;
const PR_ANCHOR = /^pr:\s*#?(\d+)\s*$/m;
const MERGED_LINE = /PR #(\d+)\b[\s\S]{0,200}?\bmerged\b/;
/** `2026-07-25T16-29-42Z-dev-core-016-....jsonl` — the name carries the moment. */
const STREAM_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-/;

const metricsSources = (
  argv: readonly string[],
  paths: OrchestratorPaths,
): { verdicts: VerdictRecord[]; merges: MergeRecord[]; streamEraStart?: string } => {
  const root = flag(argv, "--root") ?? paths.mailRoot;
  const verdicts: VerdictRecord[] = [];
  const merges: MergeRecord[] = [];
  if (existsSync(root)) {
    const registry = registryFrom(argv, repoOf(root));
    const { threads } = loadThreads(root, registry.ids());
    for (const loaded of threads) {
      for (const message of loaded.thread.messages) {
        const ts = message.fields.date;
        if (message.fields.from === "reviewer-pr") {
          const said = VERDICT_LINE.exec(message.text);
          if (said === null) continue;
          const anchor = PR_ANCHOR.exec(message.text);
          verdicts.push({
            ts,
            pr: anchor === null ? null : Number(anchor[1]),
            verdict: said[1] as "approve" | "needs-fixes",
          });
          continue;
        }
        if (message.fields.from !== "github") continue;
        const closed = MERGED_LINE.exec(message.text);
        if (closed !== null) merges.push({ ts, pr: Number(closed[1]) });
      }
    }
  }

  // The era of the streams: the earliest one still on disk. A run older than it has no
  // stream to have lost a block from, and a box with no streams at all cannot draw the
  // boundary — so it is left absent rather than invented.
  const sessions = flag(argv, "--sessions") ?? paths.sessions;
  const stamps = existsSync(sessions)
    ? readdirSync(sessions)
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => STREAM_NAME.exec(name))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`)
        .sort()
    : [];
  return {
    verdicts,
    merges,
    ...(stamps.length === 0 ? {} : { streamEraStart: stamps[0] as string }),
  };
};

const metrics = (argv: readonly string[]): void => {
  const paths = pathsFrom(argv);
  const journal = flag(argv, "--journal") ?? paths.journal;
  const events = existsSync(journal) ? parseJournal(readFile(journal, "orchestrator journal")) : [];
  const sources = metricsSources(argv, paths);
  const since = flag(argv, "--since");
  const role = flag(argv, "--role");
  const thread = flag(argv, "--thread");
  // The history from before the `usage` block: read out of the streams ONCE per stream
  // and remembered (msg-003 §2). `--no-streams` is the escape hatch for a box whose
  // `sessions/` is on slow storage — it gives the journal-only answer and says so by
  // the recovery row simply not appearing.
  const hydrated = argv.includes("--no-streams")
    ? { events, recovery: undefined }
    : hydrateFromStreams({
        events,
        sessions: flag(argv, "--sessions") ?? paths.sessions,
        cache: flag(argv, "--metrics-cache") ?? join(paths.state, "metrics.cache.jsonl"),
      });
  const folded = foldMetrics({
    events: hydrated.events,
    ...sources,
    ...(hydrated.recovery === undefined ? {} : { streamRecovery: hydrated.recovery }),
    ...(since === undefined ? {} : { since }),
    ...(role === undefined ? {} : { role }),
    ...(thread === undefined ? {} : { thread }),
  });
  if (argv.includes("--json")) {
    out(JSON.stringify(folded, null, 2));
    return;
  }
  for (const line of renderMetrics(folded)) out(line);
};

const parseExpects = (raw: string): Expects => {
  if (!(EXPECTS as readonly string[]).includes(raw)) {
    fail(`--expects '${raw}' — allowed values are ${EXPECTS.join(" | ")}`, 2);
  }
  return raw as Expects;
};

/**
 * `--waiting-on` at the door. ONE role (or `—` for nobody) since v13, checked against
 * the config twice over: it must exist, and it must be a role the circuit can move.
 *
 * A list is REFUSED here rather than trimmed. The whole reason the field became a
 * scalar is that a set was rewritten whole by whoever answered, so somebody else's
 * unclosed turn evaporated — accepting two and keeping one would reproduce the loss
 * inside the tool that was supposed to end it (pain 2).
 */
const parseWaitingOn = (raw: string, registry: RoleRegistry): string | null => {
  const trimmed = raw.trim();
  if (trimmed === "—" || trimmed === "") return null;
  const roles = trimmed
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  if (roles.length > 1) {
    fail(
      `--waiting-on takes ONE role — the turn is held by exactly one (got '${roles.join(", ")}'); several waits at once are tasks with owners, not one turn`,
      2,
    );
  }
  const role = roles[0] as string;
  // An unknown role FAILS the command instead of being dropped silently —
  // otherwise the loss of a role from the declaration (pain 2) would come back
  // through the writing tool.
  if (!registry.isKnown(role))
    fail(`--waiting-on names role '${role}', which is not in the config`, 2);
  if (!registry.canHoldTurn(role)) {
    fail(
      `--waiting-on names '${role}', a role that wakes itself (wake.mode='self') and therefore holds no turn — "a decision from ${role} is needed" is a turn for whoever carries the question to them, with the question spelled out`,
      2,
    );
  }
  return role;
};

/**
 * WHO IS WRITING THIS — resolved from the flag first, then from the launch channel
 * (R7). A raised session needs to pass nothing: the supervisor put `worker` in its
 * environment and the id of the run in a file beside its log. Everybody else says it
 * out loud — `--worker human`, `--worker gh-action`.
 *
 * The session id is read from the FILE rather than from a variable because it is
 * minted after the spawn (see `LAUNCH_ENV`); an absent or unreadable file is silence,
 * not a failure: a run that could not name its RUN still has a turn to pass, and a
 * missing session id is worse than nothing only in a report, never in a conversation.
 *
 * `worker` IS REQUIRED ON THE WRITING PATH and stays optional on the reading one
 * (the contract half of R7). The asymmetry is the point:
 *
 *  - on the DOOR the value is always obtainable — a raised session gets it from its
 *    environment, everybody else knows what they are; and a message written without
 *    it can never be repaired afterwards, because the feed is append-only;
 *  - on the READ there are messages nobody can fix by construction: legacy threads
 *    carry no header at all, history predates the field, and the window between the
 *    migration of the mail and the merge of this pair of numbers is one in which
 *    somebody legitimately wrote with a package that did not know the field. A rule
 *    that cannot be met turns `check` permanently red, and a red everyone has learned
 *    to ignore is worse than no rule.
 *
 * `session`, by contrast, stays optional on BOTH sides: it is minted by a runtime
 * that a human or a chat simply does not have.
 */
const provenanceFrom = (
  argv: readonly string[],
  options: { readonly required?: boolean; readonly env?: NodeJS.ProcessEnv } = {},
): { worker?: string; session?: string } => {
  const env = options.env ?? process.env;
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
  if (options.required === true && (worker === undefined || worker === "")) {
    fail(
      `--worker is required when writing a message: name what is writing it (${KNOWN_WORKERS.join(", ")}, or another tool). A raised session inherits it from ${LAUNCH_ENV.worker} and passes nothing`,
      2,
    );
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
 * DECLARING A WAIT FOR INPUT (R19) — the marker that goes next to the question and
 * turns the passing of the turn into a park instead of an ending.
 *
 * IT IS WRITTEN BY THE MESSAGE COMMAND, and that is the whole reason it is honoured:
 * the supervisor reads the mail off the disk of the checkout the session writes into,
 * so the question is visible to it the moment the file lands. A declaration made in a
 * second command afterwards would race a poll that has already concluded the run was
 * over — and lose that race often enough to make the mechanism untrustworthy.
 *
 * TWO REFUSALS, both about a wait that could never end:
 *  - the message does not pass the turn away (no `waiting-on`, or the role is still in
 *    it): then nobody is told to answer — the notifier (R4) triggers on the turn
 *    passing — and the session would sit until its ceiling for a message nobody was
 *    asked to read;
 *  - the run was not raised by this circuit (no launch environment): there is no
 *    supervisor to honour the declaration, so parking would mean a session waiting
 *    while nothing watches its ceiling. A human at a terminal simply waits by hand.
 */
const declareWait = (input: {
  readonly thread: string;
  readonly from: string;
  readonly waitingOn?: string | null;
  readonly date: string;
  readonly session?: string;
  readonly write: boolean;
}): void => {
  const passesTurn =
    input.waitingOn !== undefined && input.waitingOn !== null && input.waitingOn !== input.from;
  if (!passesTurn) {
    fail(
      "--await-input needs the message to pass the turn: give --waiting-on with whoever is to answer (and not yourself), otherwise nobody is told to answer and the wait can only end in its ceiling",
      2,
    );
  }
  // An EMPTY variable is "not set", as everywhere else this environment is read: the
  // launch contract sets it to a path or not at all.
  const sessionFile = process.env[LAUNCH_ENV.sessionFile] || undefined;
  const marker = sessionFile === undefined ? undefined : waitPathFromSessionFile(sessionFile);
  if (marker === undefined) {
    fail(
      `--await-input only means something in a run raised by the orchestrator: ${LAUNCH_ENV.sessionFile} is ${sessionFile === undefined ? "not set" : `'${sessionFile}', which is not a session-id path`}. A session nobody is watching cannot be parked — write the question without the flag`,
      2,
    );
    return;
  }
  const content = renderWaitMarker({
    thread: input.thread,
    at: input.date,
    ...(input.session === undefined ? {} : { session: input.session }),
  });
  if (!input.write) {
    out(`agent-protocol: would declare a wait for input in ${marker} (--write writes it)`);
    return;
  }
  writeOut(marker, content);
  out(
    `agent-protocol: a wait for input is declared (${marker}) — the run is parked, not finished; block on 'await-input' next`,
  );
};

/**
 * THE DOOR OF A LAUNCH DIRECTIVE (R21, requirements 2 and 3) — `--model` / `--effort`
 * on `new-message`, checked here and not later.
 *
 * WHAT IS REFUSED AT THE DOOR AND WHY EXACTLY THESE. The feed is APPEND-ONLY: a
 * directive nobody can act on cannot be taken back either, so everything that is
 * knowable at the moment of writing must be refused while the author is still holding
 * the flag —
 *  - a value outside the tool's vocabulary (john's requirement 3: a crooked directive
 *    must not lie in the feed as a mine), and
 *  - an author without `launch-params`: the resolution would drop it out loud anyway,
 *    and a message written in the belief that it decides something is worse than a
 *    refusal that says who does.
 *
 * WHAT IS DELIBERATELY NOT REFUSED HERE: whether the addressed role is even raised as
 * `claude-code`. That is a fact about a future run, not about this message — a role's
 * tool can change after the directive is written — so it belongs to the merge, which
 * drops it with a word (`ignoredDirective`).
 */
const directiveFrom = (
  argv: readonly string[],
  input: { readonly from: string; readonly registry: RoleRegistry },
): LaunchDirective | undefined => {
  const model = flag(argv, "--model");
  const effort = flag(argv, "--effort");
  if (model === undefined && effort === undefined) return undefined;
  if (!input.registry.canSetLaunchParams(input.from)) {
    return fail(
      `role '${input.from}' does not hold 'launch-params': a launch directive from it would not be applied, so it is not written. Whoever holds the permission in this project says it instead`,
      2,
    );
  }
  if (effort !== undefined && !claudeCodeEffortSchema.safeParse(effort).success) {
    return fail(
      `--effort '${effort}' — allowed levels are ${claudeCodeEffortSchema.options.join(", ")}`,
      2,
    );
  }
  let directive: LaunchDirective;
  try {
    // Parsed through the SAME function that reads it back, rather than assembled from
    // the flags: a value the reader would reject must not be writable, and the one way
    // to guarantee that is to have one shape check, used from both sides.
    directive = parseLaunchDirective(
      [
        ...(model === undefined ? [] : [`model=${model}`]),
        ...(effort === undefined ? [] : [`effort=${effort}`]),
      ].join(", "),
    );
  } catch (error) {
    if (error instanceof MessageFormatError) return fail(error.message, 2);
    throw error;
  }
  return directive;
};

/**
 * THE DOOR OF A THREAD PRIORITY (R5) — `--priority` on `new-message`, refused here for
 * the same two reasons the launch directive is (the feed is append-only, so a statement
 * nobody can act on cannot be taken back either): a value outside the protocol's own
 * vocabulary, and an author without `thread-priority`.
 *
 * The vocabulary check is done by the PARSER (`parseMessageFile` reads the same field
 * back) rather than by a list retyped here: one shape check used from both sides is the
 * only way a value that would not be read back cannot be written.
 */
const priorityFrom = (
  argv: readonly string[],
  input: { readonly from: string; readonly registry: RoleRegistry },
): ThreadPriorityValue | undefined => {
  const value = flag(argv, "--priority");
  if (value === undefined) return undefined;
  if (!input.registry.canSetThreadPriority(input.from)) {
    return fail(
      `role '${input.from}' does not hold 'thread-priority': a priority from it would not be applied, so it is not written. Whoever holds the permission in this project says it instead`,
      2,
    );
  }
  if (!(THREAD_PRIORITY_VALUES as readonly string[]).includes(value)) {
    return fail(
      `--priority '${value}' — allowed values are ${THREAD_PRIORITY_VALUES.join(", ")}`,
      2,
    );
  }
  return value as ThreadPriorityValue;
};

/**
 * THE DOOR OF A PARK (R27) — `--parked-on` on `new-message`: the turn stays where it is and
 * is declared FROZEN until a person decides.
 *
 * The one check is the exact mirror of v13's rule for `waiting-on`, and it is the same
 * predicate (`canHoldTurn`), read the other way round: a role the circuit can move is
 * something to hand the turn TO, not something to park behind — that is `--waiting-on`, and
 * naming it here would freeze a thread nobody is waiting for. A role that wakes itself is the
 * only thing this field can mean, because it names the one participant the feed cannot move.
 *
 * No permission gates it. Parking costs nothing and asks for nothing: it does not raise a
 * session, does not reorder the queue and does not spend quota — it says that the role's own
 * turn cannot move yet, and the only role that could ever know this is the one holding it.
 */
const parkedOnFrom = (
  argv: readonly string[],
  input: { readonly registry: RoleRegistry; readonly expects: Expects },
): string | undefined => {
  const value = flag(argv, "--parked-on");
  if (value === undefined) return undefined;
  if (input.expects === "none") {
    // The reader honours a park declared this way (`parkingOf`), so nothing already in
    // the feed is lost — but the two words point opposite ways: `expects: none` says "this
    // message asks nobody for anything", and a park says "this thread is waiting for a
    // person". Written together they read as a park that informational traffic may lift,
    // which is precisely the shape that cost two empty sessions in thread 034.
    return fail(
      `--parked-on '${value}' with --expects none — an informational message asks nobody for anything, and a park says the thread is waiting for a person. Park with the message that carries the question ('--expects answer')`,
      2,
    );
  }
  // AN EVENT PARK GOES NO FURTHER THAN ITS SHAPE (thread 023): `pr:127` names a merge, not a
  // participant, so there is no config to check it against — the number is either in the
  // repository or it is not, and the door has no business asking GitHub. It lifts by itself
  // when the merge notifier says the number back (`merged-pr`), which is the whole point of
  // the form: nobody has to remember to unpark it, and nobody is called about it meanwhile.
  if (/^pr:\d+$/.test(value)) return value;
  if (!input.registry.isKnown(value)) {
    return fail(
      `--parked-on '${value}' is not listed in the config, and is not an event ('pr:<number>')`,
      2,
    );
  }
  if (input.registry.canHoldTurn(value)) {
    return fail(
      `--parked-on '${value}' — that role CAN be woken, so the turn is passed to it ('--waiting-on ${value}'), not parked behind it. This field names a person the circuit cannot move (wake.mode='self')`,
      2,
    );
  }
  return value;
};

/**
 * THE DOOR OF A TASK DECLARATION (thread 021) — `--task '<NNN.k> <status>[ · tail]'`,
 * repeatable, checked here and not only in CI.
 *
 * WHY THE WHOLE MAIL IS READ HERE. The other cross-thread facts of the protocol are
 * caught by `check` on the branch, and that would be enough if a red branch were
 * repairable — it is not: the feed is append-only, so an agent that pushed a crooked
 * declaration with a normal command has nothing to fix it with but another message.
 * The philosophy of the package is "crooked markup is refused at the door", and this
 * is markup. The price is named as a number rather than left implied: a full
 * `loadThreads` on the live branch is 29 threads, 543 messages, 37–50 ms (median ~44) —
 * next to the `fetch` + `commit` + `push` this command always does, which are one or
 * two orders more.
 *
 * IT RUNS INSIDE `plan()`, not before delivery: `plan()` is replanned on every attempt,
 * AFTER `fetch` + `merge --ff-only`, so a task opened by a concurrent message that
 * overtook us is seen rather than judged against a stale tree. That same placement is
 * what makes the dry run honest — no `--write` calls the same `plan()`, so a preview
 * refuses exactly where the write would.
 */
const tasksFor = (
  argv: readonly string[],
  input: { readonly from: string; readonly thread: string; readonly registry: RoleRegistry },
): TaskDeclaration[] => {
  const raws = flagAll(argv, "--task");
  if (raws.length === 0) return [];
  const prefix = input.thread.slice(0, input.thread.indexOf("-"));
  const seen = new Set<string>();
  const tasks: TaskDeclaration[] = [];
  for (const raw of raws) {
    let task: TaskDeclaration;
    try {
      // Parsed through the SAME function that reads it back: a value the reader would
      // reject must not be writable, and one shape check used from both sides is the
      // only way to guarantee that.
      task = parseTaskDeclaration(raw);
    } catch (error) {
      if (error instanceof MessageFormatError) return fail(error.message, 2);
      throw error;
    }
    if (seen.has(task.id)) {
      return fail(`--task names '${task.id}' twice — one message says one thing about a task`, 2);
    }
    seen.add(task.id);
    if (
      (task.status === "open" || task.status === "dropped") &&
      !input.registry.canDeclareTask(input.from)
    ) {
      return fail(
        task.status === "open"
          ? `role '${input.from}' does not hold 'task-declare': opening a task is an act of the statement of work. Whoever holds the permission in this project opens it instead`
          : `role '${input.from}' does not hold 'task-declare': dropping a task is cancelling a statement of work, not executing one — otherwise the board could be made to lie in favour of whoever is writing. Say "this task should not be done" in a message; curator or john drops it`,
        2,
      );
    }
    if (task.status === "open" && taskThreadPrefix(task.id) !== prefix) {
      return fail(
        `--task '${raw}' opens a task under a foreign id: in thread '${input.thread}' a task is opened as '${prefix}.k'. A task of another thread may be MOVED from here, not opened`,
        2,
      );
    }
    tasks.push(task);
  }
  return tasks;
};

/**
 * Create a message file in an EXISTING thread and SEND IT (R3). Refuses if the
 * thread is in the legacy form (no `messages/`): a file write would cut off its
 * history.
 *
 * `--write` means DELIVERED, not "written to disk": the commit and the push happen
 * inside, with the replanning retry of `deliver.ts` behind them. The tail the agent
 * used to type by hand is the layer it must not have to know, and it is also the
 * layer that failed in practice (a lost heredoc reported as success, a committed
 * message living on one disk).
 *
 * `--no-push` keeps the old behaviour for the ONE caller that legitimately owns its
 * own git: the CI workflows, which write from a checkout the runner set up, batch
 * their commit with other work and push under the runner's token. Naming the
 * exception is honester than a command that behaves differently depending on where
 * it runs.
 */
const newMessage = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const threadId = required(argv, "--thread");
  const from = required(argv, "--from");
  const loaded = configFrom(argv, repoOf(root));
  const registry = loaded.registry;
  if (!registry.isKnown(from)) fail(`role '${from}' is not listed in the config`, 2);

  const threadDir = join(root, threadId);
  if (!existsSync(threadDir)) fail(`thread '${threadId}' not found in '${root}'`, 2);
  const messagesDir = join(threadDir, "messages");

  const text = readFile(required(argv, "--body-file"), "message body");
  const waitingRaw = flag(argv, "--waiting-on");
  const waitingOn = waitingRaw === undefined ? undefined : parseWaitingOn(waitingRaw, registry);
  // Required BEFORE `--write` is even looked at: a dry run is the preview of the
  // write, and a preview that succeeds where the write refuses is a lie.
  const provenance = provenanceFrom(argv, { required: true });
  const expects = parseExpects(required(argv, "--expects"));
  const launchDirective = directiveFrom(argv, { from, registry });
  const priority = priorityFrom(argv, { from, registry });
  const parkedOn = parkedOnFrom(argv, { registry, expects });
  // THE COUNTERPART OF AN EVENT PARK (thread 023): the merge notifier says which PR landed,
  // and every thread parked on that number lifts. It is written by a workflow rather than by
  // an agent, so the door only checks the shape — the notifier knows the number it merged.
  const mergedPrRaw = flag(argv, "--merged-pr");
  if (mergedPrRaw !== undefined && !/^\d+$/.test(mergedPrRaw)) {
    fail(`--merged-pr '${mergedPrRaw}' — expected the number of a PR`, 2);
  }
  const mergedPr = mergedPrRaw === undefined ? undefined : Number(mergedPrRaw);
  const tasks = tasksFor(argv, { from, thread: threadId, registry });

  // PLANNED AGAINST THE DISK AS IT IS NOW, and replanned per delivery attempt: the
  // stamp is monotonic along the feed (we take the stamps of the NEW messages lying
  // there — migrated ones, dated without a time, are excluded — and clamp the new one
  // strictly after the last). Without this, clock skew between writers puts an answer
  // before its question (a real case in 012); with a concurrent write it is also why a
  // rejected push cannot simply be rebased — the file NAME has to move too.
  const plan = (): { path: string; label: string; content: string; date: string } => {
    const threadHasMessages = existsSync(messagesDir);
    const existingTs = threadHasMessages
      ? readdirSync(messagesDir)
          .filter((name) => name.endsWith(".md"))
          .map(
            (name) => parseMessageFile(readFileSync(join(messagesDir, name), "utf8")).fields.date,
          )
          .filter((date) => date.includes("T"))
      : [];
    const date = nextMessageTimestamp(new Date(), existingTs);
    // THE GLOBAL TASK CHECK, inside the plan and therefore replanned per attempt (see
    // `tasksFor`): the declarations of this message are folded into the feed as it is
    // AFTER the fetch, and anything `check` would redden the branch for is refused now.
    if (tasks.length > 0) {
      const scan = loadThreads(root, registry.ids());
      const layer = taskInputsOf(scan.threads);
      const pending: TaskThreadInput[] = [
        ...layer.inputs,
        {
          id: threadId,
          entries: [
            {
              fileName: "<this message>",
              message: { fields: { from, date, expects, tasks }, text },
            },
          ],
        },
      ];
      const issues = checkTasks(collectTaskEvents(pending), layer.status);
      const mine = issues.filter((issue) => issue.file === "<this message>");
      if (mine.length > 0) {
        fail(
          `the task declarations are refused (the feed is append-only — this is caught here, not after the push):\n- ${mine
            .map((issue) => issue.message)
            .join("\n- ")}`,
          2,
        );
      }
    }
    let planned: ReturnType<typeof planNewMessage>;
    try {
      planned = planNewMessage({
        from,
        ...provenance,
        date,
        expects,
        ...(waitingOn === undefined ? {} : { waitingOn }),
        ...(launchDirective === undefined ? {} : { launch: launchDirective }),
        ...(priority === undefined ? {} : { priority }),
        ...(parkedOn === undefined ? {} : { parkedOn }),
        ...(mergedPr === undefined ? {} : { mergedPr }),
        ...(tasks.length === 0 ? {} : { tasks }),
        text,
        threadHasMessages,
      });
    } catch (error) {
      if (error instanceof WriteRefusedError) return fail(error.message, 2);
      throw error;
    }
    const path = join(threadDir, planned.path);
    if (existsSync(path))
      fail(`file '${planned.path}' already exists — two writes within one second?`, 2);
    return { path, label: `${threadId}/${planned.path}`, content: planned.content, date };
  };

  const first = plan();
  const write = argv.includes("--write");
  // THE DECLARATION GOES FIRST (R19) — before the message file, not after it. The
  // supervisor sees the question as soon as the file is on disk, and a marker written
  // second would race the poll that reads it.
  if (argv.includes("--await-input")) {
    declareWait({
      thread: threadId,
      from,
      ...(waitingOn === undefined ? {} : { waitingOn }),
      date: first.date,
      ...(provenance.session === undefined ? {} : { session: provenance.session }),
      write,
    });
  }

  if (!write) {
    out(`agent-protocol: would create ${first.label} (--write writes it):`);
    out(first.content);
    return;
  }

  if (argv.includes("--no-push")) {
    writeOut(first.path, first.content);
    out(
      `agent-protocol: created ${first.label} — NOT committed (--no-push: the caller owns its git)`,
    );
    return;
  }

  const checkout = repoOf(root);
  try {
    const delivered = deliverMessage({
      git: gitIn(checkout),
      write: writeOut,
      branch: loaded.config.mail.branch,
      subject: deliverySubject({ from, thread: threadId }),
      // The commit is BY THE ROLE, not by the owner of the box (027): the mail checkout
      // is shared by every role here, so the signature can only be per-commit.
      identity: roleIdentity(from),
      stage: () => {
        const next = plan();
        return { files: [{ path: next.path, content: next.content }], label: next.label };
      },
      note: out,
      lock: mailLockFor({ checkout, holder: `new-message ${from} → ${threadId}`, note: out }),
    });
    out(
      `agent-protocol: sent ${delivered.label} — committed and pushed to origin/${loaded.config.mail.branch}${delivered.attempts > 1 ? ` (after ${delivered.attempts} attempts: the feed moved underneath)` : ""}`,
    );
  } catch (error) {
    // A BUSY CHECKOUT IS A REFUSAL WITH A NAME, not a stack trace: the caller has to be
    // able to tell "somebody else is delivering right now" from "the mail is broken".
    if (error instanceof DeliveryRefusedError || error instanceof MailCheckoutBusyError) {
      fail(error.message, 2);
    }
    throw error;
  }
};

/**
 * Create a NEW thread straight in the file form (`_meta.md` + the first message) and
 * SEND IT (R3, thread 033).
 *
 * `--write` MEANS DELIVERED HERE TOO. It did not, and that was the defect: the command
 * wrote two files, printed "thread created" and returned, while `git ls-tree
 * origin/comms` knew nothing about the thread. The promise "the file, the commit and the
 * push are one action" is given in the README, in CLAUDE.md and in every role card — it
 * was true for `new-message` and false for its twin, so the tool reported success on a
 * delivery it had not made. Control-reading after a write is a habit a role keeps; a tool
 * that lies about the write turns that habit from a safety net into the mechanism.
 *
 * A THREAD IS ONE DELIVERY, NOT TWO. `_meta.md` and the first message go into a single
 * commit: a meta pushed without its message is a conversation nobody can read or answer,
 * and the retry that replans the message would be replanning it against a meta already in
 * the feed.
 *
 * THE THREAD ID IS RE-CHECKED AFTER THE REFRESH. The pre-flight `existsSync` only knows
 * this disk; delivery fetches, and if somebody took the id in between, creating it a
 * second time would silently overwrite their meta and leave their first message beside
 * ours. So the check is repeated where it can actually be true — inside the attempt,
 * after the fast-forward.
 */
const newThread = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const id = required(argv, "--id");
  const loaded = configFrom(argv, repoOf(root));
  const registry = loaded.registry;

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

  // THE NUMBER IS AN ADDRESS, AND ADDRESSES ARE UNIQUE (curator, thread 029): `029`
  // was handed out twice in one day, and "тред 029" stopped meaning one thing. The
  // directory names of the mail are the whole check — cheap, and it is the only place
  // a number is handed out. Names starting with `_` are the derived state of the
  // branch (`_instances/`), not threads.
  const existingThreads = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
        .map((entry) => entry.name)
    : [];
  const taker = threadNumberTaker(id, existingThreads);
  if (taker !== undefined) {
    fail(
      `the number of thread '${id}' is already taken by '${taker}' — a thread number is its short address, pick the next free one`,
      2,
    );
  }

  const text = readFile(required(argv, "--body-file"), "body of the first message");
  const title = required(argv, "--title");
  const provenance = provenanceFrom(argv, { required: true });
  const expects = parseExpects(required(argv, "--expects"));
  const waitingRaw = flag(argv, "--waiting-on");
  const waitingOn = waitingRaw === undefined ? undefined : parseWaitingOn(waitingRaw, registry);

  // Replanned per attempt like a message's: the stamp is taken at the moment of the
  // attempt, so a retry after somebody else's push does not carry a stale one.
  const plan = (): readonly PlannedFile[] => {
    try {
      return planNewThread({
        title,
        participants,
        from,
        ...provenance,
        date: messageTimestamp(new Date()),
        expects,
        ...(waitingOn === undefined ? {} : { waitingOn }),
        text,
      });
    } catch (error) {
      if (error instanceof WriteRefusedError) return fail(error.message, 2);
      throw error;
    }
  };

  const files = plan();
  if (!argv.includes("--write")) {
    out(`agent-protocol: would create thread ${id} (--write writes it):`);
    for (const file of files) out(`- ${id}/${file.path}`);
    return;
  }

  if (argv.includes("--no-push")) {
    for (const file of files) writeOut(join(threadDir, file.path), file.content);
    out(
      `agent-protocol: created thread ${id} (${files.length} files) — NOT committed (--no-push: the caller owns its git)`,
    );
    return;
  }

  const checkout = repoOf(root);
  try {
    const delivered = deliverMessage({
      git: gitIn(checkout),
      write: writeOut,
      branch: loaded.config.mail.branch,
      subject: deliverySubject({ from, thread: id }),
      // By the role that opened the conversation, not by the owner of the box (027).
      identity: roleIdentity(from),
      stage: () => {
        if (existsSync(threadDir)) {
          throw new DeliveryRefusedError(
            `thread '${id}' appeared in the feed while we were delivering — somebody took the id first. Nothing was written; pick the next free number`,
          );
        }
        return {
          files: plan().map((file) => ({
            path: join(threadDir, file.path),
            content: file.content,
          })),
          label: `${id} (${files.length} files)`,
        };
      },
      note: out,
      lock: mailLockFor({ checkout, holder: `new-thread ${from} → ${id}`, note: out }),
    });
    out(
      `agent-protocol: opened ${delivered.label} — committed and pushed to origin/${loaded.config.mail.branch}${delivered.attempts > 1 ? ` (after ${delivered.attempts} attempts: the feed moved underneath)` : ""}`,
    );
  } catch (error) {
    if (error instanceof DeliveryRefusedError || error instanceof MailCheckoutBusyError) {
      fail(error.message, 2);
    }
    throw error;
  }
};

const mail = (argv: readonly string[]): void => {
  // THE MAIL ROOT IS A FACT ABOUT THE MACHINE (R26), so `--root` stops being
  // obligatory here: the reading half of the agent's interface, called from a role's
  // workspace, now finds the real mail on its own. It used to be mandatory precisely
  // because the fallback resolved against the caller's worktree, i.e. against a
  // directory holding no mail — which is why the role cards carry the flag by hand.
  const root = flag(argv, "--root") ?? pathsFrom(argv).mailRoot;
  const role = required(argv, "--role");
  const registry = registryFrom(argv, repoOf(root));
  if (!registry.isKnown(role)) fail(`role '${role}' is not listed in the config`, 2);

  // Mail is computed from the THREADS, not from the derived INDEX: otherwise a
  // failure of the index generator would blind the watch and the keeper (pain 5,
  // thread 008).
  const { threads, failures } = loadThreads(root, registry.ids());
  const parsed = threads.map((loaded) => loaded.thread);
  // IN QUEUE ORDER, not in the order of the directories (R5). The FORM of the output
  // is untouched — one thread id per line, because it is read by scripts — but a role
  // reading its own mail is told the same thing the daemon decides by: what to take
  // first. Two answers to "which one now" would be worse than none.
  const hits = orderCandidates(
    threadsWaitingOn(parsed, role).map((thread): RankedCandidate => {
      const messages = parsed.find((t) => t.id === thread)?.messages ?? [];
      const since = waitingSince({ messages, role });
      return {
        role,
        thread,
        priority:
          resolveThreadPriority({
            messages,
            authorized: (who) => registry.canSetThreadPriority(who),
          }).effective?.priority ?? DEFAULT_THREAD_PRIORITY,
        ...(since === undefined ? {} : { since }),
      };
    }),
  ).map((candidate) => candidate.thread);
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
 * `await-input` — THE BLOCKING HALF OF THE INTERACTIVE TURN (R19). The session has
 * written its question with `--await-input` and pushed it; here it sits until the
 * answer comes back, and that is the whole point: one tool call, no context lost, the
 * working tree exactly as it was.
 *
 * IT REFUSES WITHOUT A DECLARATION. Waiting undeclared is the failure the marker
 * exists to prevent — the supervisor would read the passed turn as the end of the run
 * and close it while the session sat here. So this command does not create the
 * declaration; it insists on one that was made where it had to be made, beside the
 * question.
 *
 * IT REFUSES WHEN THE QUESTION CANNOT BE ANSWERED. Unpushed commits in the mail
 * checkout mean the question exists on this disk only: nobody will ever see it, and
 * the wait could only end in a ceiling an hour later. That is the deadlock this
 * mechanism is most likely to hit in practice, and it costs one git command to catch.
 *
 * THE UPDATE IS BEST-EFFORT, THE READ IS NOT. `fetch` + `merge --ff-only` may fail
 * (no network, a diverged checkout) and that is not fatal — it is "not yet known", a
 * reason to ask again. What is never allowed is concluding "the answer arrived" from a
 * thread that could not be read; an unreadable thread keeps the wait going and says so
 * out loud, exactly as it does in the supervisor's own loop.
 */
const awaitInput = async (argv: readonly string[]): Promise<void> => {
  const root = required(argv, "--root");
  const role = required(argv, "--role");
  const threadId = required(argv, "--thread");
  const loaded = configFrom(argv, root);
  const registry = loaded.registry;
  if (!registry.isKnown(role)) fail(`role '${role}' is not listed in the config`, 2);

  const sessionFile = process.env[LAUNCH_ENV.sessionFile] || undefined;
  const marker = sessionFile === undefined ? undefined : waitPathFromSessionFile(sessionFile);
  if (marker === undefined || !existsSync(marker)) {
    fail(
      `no wait was declared for this run: write the question with 'new-message --await-input' (that is what tells the supervisor the run is parked rather than finished)${marker === undefined ? `; ${LAUNCH_ENV.sessionFile} names no session-id path either, so nothing is watching this session at all` : ""}`,
      2,
    );
    return;
  }

  const checkout = repoOf(root);
  const branch = loaded.config.mail.branch;
  // The one-off verification of "can this question be answered at all". It goes through
  // the same probe preflight uses (it fetches and fast-forwards on its own), and its
  // failure is a WARNING rather than a refusal: a fetch that did not work says nothing
  // about the checkout, and refusing a wait over a network blip would cost a run for
  // no reason. The ceiling bounds the blind case.
  let state: ReturnType<typeof mailCheckoutState> | undefined;
  try {
    state = mailCheckoutState(checkout, branch);
  } catch (error) {
    err(
      `agent-protocol: WARNING — the state of the mail checkout '${checkout}' could not be read (${(error as Error).message}); waiting anyway, but a question that is not pushed will never be answered`,
    );
  }
  if (state !== undefined && (state.ahead > 0 || state.dirty || state.branch !== branch)) {
    // The marker is left alone: the session may still push and wait again, and
    // removing somebody's declaration on the way out of a refusal would be the kind of
    // repair this package does not do.
    fail(
      `the question cannot reach anybody from this checkout (${checkout}: on '${state.branch}'${state.dirty ? ", unsaved changes" : ""}${state.ahead > 0 ? `, ${state.ahead} unpushed commits` : ""}) — push it first, then wait`,
      2,
    );
    return;
  }
  // In the loop the update is best-effort by construction: an unreachable origin is
  // "not yet known", a reason to ask again rather than to end the wait.
  const fetchMail = (): void => {
    gitAsk(["-C", checkout, "fetch", "--quiet", "origin", branch]);
    gitAsk(["-C", checkout, "merge", "--quiet", "--ff-only", `origin/${branch}`]);
  };

  const fromEnv = Number(process.env[LAUNCH_ENV.waitSeconds]);
  const fallback = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_WAIT_INPUT_SECONDS;
  const timeoutMs = positiveInt(argv, "--timeout", fallback) * 1000;
  const pollMs = positiveInt(argv, "--poll", 30) * 1000;
  const until = Date.now() + timeoutMs;
  // The declaration is dropped on EVERY way out (an answer, the ceiling, a refusal
  // after the wait began): the supervisor leaves the parked state when the marker
  // goes, so a marker left behind would keep a working session recorded as parked.
  const done = (): void => {
    try {
      unlinkSync(marker);
    } catch {
      // already gone — fine
    }
  };

  out(
    `agent-protocol: waiting for input on ${threadId} (up to ${Math.round(timeoutMs / 1000)}s, polling every ${pollMs / 1000}s)`,
  );
  // WHEN THE WAIT BEGAN, so that the session can be told what its window is worth
  // afterwards (R20): the deadline it was handed at the spawn is a floor, and a park is
  // the one thing that moves it. Measured HERE rather than read back from the journal —
  // the session has no business reading the supervisor's state, and its own measurement
  // errs on the safe side (it starts waiting before the supervisor notices).
  const waitStartedMs = Date.now();
  for (;;) {
    const scan = loadThreads(root, registry.ids());
    const unreadable = scan.failures.some((failure) => failure.id === threadId);
    if (unreadable) {
      for (const line of renderThreadFailures(scan.failures)) err(`agent-protocol: ${line}`);
    }
    const awaited =
      !unreadable &&
      threadsWaitingOn(
        scan.threads.map((entry) => entry.thread),
        role,
      ).includes(threadId);
    if (awaited) {
      done();
      const waitedSeconds = Math.round((Date.now() - waitStartedMs) / 1000);
      out(
        `agent-protocol: the answer arrived on ${threadId} — read the tail of the thread and carry on`,
      );
      // The other half of R20's floor: a run that parked for an hour is not due to land
      // at the moment it was told at the spawn — the supervisor added that hour back to
      // the window, and without this line the session would wind down an hour early.
      out(
        `agent-protocol: your window moved by about ${waitedSeconds}s — that is how long the wait took, and the work deadline was pushed back by it`,
      );
      return;
    }
    if (Date.now() >= until) {
      done();
      // Code 3, not 2: this is not a refusal of a malformed command, it is the wait
      // itself running out — and the session is expected to act on it (wrap up and
      // pass the turn) rather than to fix its arguments.
      fail(
        `nobody answered on ${threadId} within ${Math.round(timeoutMs / 1000)}s — the wait is over; wrap up what you have and pass the turn (say in the thread where you stopped)`,
        3,
      );
      return;
    }
    await sleep(Math.min(pollMs, Math.max(0, until - Date.now())));
    fetchMail();
  }
};

/**
 * `notify` — telling a HUMAN that the turn has passed to them (R4).
 *
 * It replaces `bin/notify.sh`, and what it changes is not the delivery but the three
 * things that were baked into that script: the set of those notified (now derived
 * from the role model — `wake.mode`), the words (now the project's templates) and
 * the channel (now a transport plugin). What it deliberately does NOT change is the
 * behaviour that was paid for in threads 005/008/011 and is carried over verbatim:
 * the trigger is a NEW pair, the text is the FULL composition, the unit is a thread.
 *
 * THE ORDER OF THE THREE SIDE EFFECTS IS THE DESIGN:
 *
 *  1. resolve the transport and the secrets — a setup defect (a module that does not
 *     load, a named file that cannot be read) refuses HERE, while the state file is
 *     still untouched, so the trigger is not consumed by a run that could never have
 *     delivered anything;
 *  2. send;
 *  3. write the state ONLY FOR WHAT THE TRANSPORT CONFIRMED (john's decision, thread
 *     029). It used to be written BEFORE sending, on the reasoning that "a
 *     notification is about a moment, and a moment does not come back because we
 *     retried it" — and that reasoning cost exactly what this thread is about: on
 *     2026-07-28 `notify` printed "2 of them new" and then "telegram: the request did
 *     not complete — fetch failed", the state was already on disk, the next call said
 *     "nothing to announce", and john was never told about threads 028/029. An
 *     undelivered announcement that the circuit believes it delivered is the same
 *     class of defect as the missing reviewer verdict this thread was opened for:
 *     NON-DELIVERY THAT LOOKS LIKE DELIVERY. Ringing twice is cheap; not ringing at
 *     all is what a notifier exists to prevent.
 *
 * A FAILED DELIVERY IS A NON-ZERO EXIT, and that too is a reversal. "Notifications
 * are a superstructure, not a dependency" survives where it belongs — an
 * `unconfigured` transport (no credentials on this machine) is a legitimate silence
 * and exits 0 — but a transport that TRIED AND COULD NOT is something one goes and
 * investigates, so it must not be a green line in a cron mailbox. In both of those
 * cases the state is left alone: nothing was announced, so nothing is marked
 * announced, and the next call rings again.
 *
 * NOTHING HAPPENS WITHOUT `--write`, as everywhere in this package — and here that
 * subsumes what used to be `NOTIFY_DRY_RUN=1`: the plan prints the message it would
 * send and leaves the state alone.
 */
/**
 * WHAT ONE COURIER RUN CAME TO — the return value that made the dialling automatic
 * (thread 024, john's decision of 2026-07-28: the notifier is called by the daemon
 * tick).
 *
 * Until then `notify` was a command and nothing else: it printed as it went and it
 * ended in `fail()`, i.e. in `process.exit`. Neither is usable from inside the loop
 * — a courier that cannot resolve its transport would have taken the whole watch
 * down with it, and per-tick commentary about a mailbox where nothing changed is the
 * "ping every five minutes" the notifier itself refuses to send. So the run says
 * nothing itself and returns BOTH: the one line that is always safe to print, and
 * everything it had to say on the way, for a caller that has a reason to print it.
 *
 * `kind` is what the caller branches on: `planned` — a dry run, nothing touched;
 * `quiet` — the state moved but there was no new event, so nobody was told; `sent` —
 * something was announced; `failed` — a SETUP defect (no config section, an
 * unreadable secrets file, a transport module that does not load) caught before the
 * state file was touched, so the trigger is not consumed by a run that could never
 * have delivered anything; `undelivered` — the transport TRIED and could not (thread
 * 029), which is not a setup defect and leaves the state untouched, so the same pairs
 * ring again on the next call.
 */
type NotifyRun = {
  readonly kind: "planned" | "quiet" | "sent" | "failed" | "undelivered";
  readonly summary: string;
  readonly lines: readonly string[];
};

const runNotify = async (input: {
  readonly argv: readonly string[];
  readonly write: boolean;
}): Promise<NotifyRun> => {
  const argv = input.argv;
  const write = input.write;
  const said: string[] = [];
  const say = (line: string): void => {
    said.push(line);
  };
  const failed = (summary: string): NotifyRun => ({ kind: "failed", summary, lines: said });
  const loaded = configFrom(argv, undefined);
  const registry = loaded.registry;
  const repo = flag(argv, "--repo") ?? homeOf(process.cwd());
  const section = loaded.config.orchestrator;
  const rootFlag = flag(argv, "--root");
  const stateFlag = flag(argv, "--state");

  if (section === undefined && (rootFlag === undefined || stateFlag === undefined)) {
    return failed(
      `the config at ${loaded.ref} has no 'orchestrator' section — either add it or pass both --root <mail> and --state <file>`,
    );
  }
  const paths =
    section === undefined
      ? undefined
      : orchestratorPaths({ repo, orchestrator: section, mail: loaded.config.mail });
  const root = rootFlag ?? (paths?.mailRoot as string);
  const statePath = stateFlag ?? (paths?.notifyState as string);

  // FRESHNESS IS REPORTED, NEVER REFUSED, and that is the one place this command
  // parts ways with preflight. The daemon refuses on stale mail because acting on
  // yesterday's mail is WRONG WORK; the notifier's failure mode is the opposite —
  // refusing means saying nothing, which is precisely what it exists to prevent. So
  // it does the same fetch and fast-forward and prints what came of it.
  if (rootFlag === undefined && section !== undefined) {
    try {
      const state = mailCheckoutState(join(repo, section.mailCheckout), loaded.config.mail.branch);
      const verdict = mailCheckoutVerdict({ ...state, expectedBranch: loaded.config.mail.branch });
      say(`mail — ${verdict.detail}`);
    } catch (error) {
      say(`mail — the checkout was not refreshed: ${(error as Error).message}`);
    }
  }

  const { threads, failures } = loadThreads(root, registry.ids());
  for (const line of renderThreadFailures(failures)) say(line);

  const targets = registry.notificationTargets();
  const parsed = threads.map((entry) => entry.thread);
  const waiting: WaitingPair[] = targets.flatMap((target) =>
    threadsWaitingOn(parsed, target.id).map((thread) => ({ role: target.id, thread })),
  );
  // THE SECOND QUESTION (thread 024): not "who is awaited" but "what has not moved".
  // Since v13 the human never appears in `waiting-on`, so the first question cannot
  // produce a line for one; the age of the handoff is what is left observable. It is
  // asked of every open thread — a turn standing on an agent for hours is a stalled
  // circuit, and nothing else in the package would say so.
  const stalledAfter = loaded.config.notifications?.stalledAfterMinutes ?? 180;
  const now = Date.now();
  // THE THIRD QUESTION, and the one with no threshold at all (thread 023): "what is frozen
  // behind a person, and what is being asked". The age answers neither — a park is a
  // declaration that the turn CANNOT move, so waiting it out only postpones the call.
  // The merges of the whole mail, once: the notifier announces a merge into the PR's own
  // thread, so a park on `pr:N` is lifted from OUTSIDE the parked thread (thread 023).
  const merged = mergedPrs(parsed);
  const parkings = parsed.flatMap((thread) => {
    const parking = parkingOf(thread, merged);
    return parking === undefined ? [] : [{ id: thread.id, parking }];
  });
  const parked = parkings.flatMap(({ id, parking }) =>
    parking.kind === "person" && parking.person !== undefined
      ? [
          {
            thread: id,
            person: parking.person,
            since: parking.since,
            question: parking.question,
          },
        ]
      : [],
  );
  // A park on an EVENT is not a call and not a stall: the decision behind it has been made,
  // and what is left is somebody's hand on a merge button. It is passed to the plan by name
  // so that the age pass stays silent about it — otherwise the safety call ("nothing is
  // moving this") would fire on the one class of thread that is moving exactly as intended.
  const frozen = parkings.flatMap(({ id, parking }) => (parking.kind === "event" ? [id] : []));
  const stalled = parsed.flatMap((thread) => {
    const holder = waitingOnOf(thread);
    if (holder === undefined) return [];
    const since = waitingSince({ messages: thread.messages, role: holder });
    if (since === undefined) return [];
    const minutes = (now - Date.parse(since)) / 60_000;
    if (!Number.isFinite(minutes) || minutes < stalledAfter) return [];
    return [{ thread: thread.id, role: holder, since, age: describeAge(minutes) }];
  });

  const seen = existsSync(statePath)
    ? parseNotifyState(readFileSync(statePath, "utf8"))
    : { waiting: [], stalled: [], parked: [] };
  const plan = planNotifications({
    targets,
    waiting,
    seen,
    stalled,
    parked,
    frozen,
    ...(loaded.config.notifications?.templates === undefined
      ? {}
      : { templates: loaded.config.notifications.templates }),
  });
  const message = renderNotification(plan.lines);

  const describeWaits =
    `${plan.parked.length} parked, ${plan.freshParked.length} of them new; ` +
    `${plan.waiting.length} waits, ${plan.fresh.length} of them new; ` +
    `${plan.stalled.length} stalled over ${stalledAfter}m, ${plan.freshStalled.length} of them new`;
  if (!write) {
    say(message === "" ? "(nothing — nobody is waiting)" : message);
    return {
      kind: "planned",
      summary: `${describeWaits}; --write would update '${statePath}' and send the message above`,
      lines: said,
    };
  }

  // The transport is resolved even when there is nothing to send: a broken module or
  // an unreadable secrets file that only surfaces on the first real event is a setup
  // defect discovered at the worst possible moment.
  const transportSection = loaded.config.notifications?.transport;
  let transport: Transport | undefined;
  if (transportSection !== undefined) {
    const local = localFrom(argv);
    const envFile = flag(argv, "--env-file") ?? local.config.secrets?.envFile ?? null;
    let secrets: LoadedSecrets;
    try {
      secrets = loadSecrets({ path: envFile });
    } catch (error) {
      return failed((error as Error).message);
    }
    say(`secrets — ${describeSecrets(secrets)}`);
    try {
      transport = await loadTransport(transportSection.module, {
        options: transportSection.options,
        secrets: secrets.values,
      });
    } catch (error) {
      return failed((error as Error).message);
    }
  }

  // THE STATE MOVES ONLY ON A CONFIRMED OUTCOME (thread 029), so it is written in each
  // branch below rather than once up here. NOTHING TO ANNOUNCE IS ITSELF a confirmed
  // outcome: this is where a pair that has STOPPED waiting is forgotten, and forgetting
  // it is what makes the same thread ring again if it comes back to waiting later.
  if (plan.fresh.length === 0 && plan.freshStalled.length === 0 && plan.freshParked.length === 0) {
    writeOut(
      statePath,
      renderNotifyState({ waiting: plan.waiting, stalled: plan.stalled, parked: plan.parked }),
    );
    return { kind: "quiet", summary: `${describeWaits} — nothing to announce`, lines: said };
  }
  const announced = [
    ...plan.freshParked.map((park) => `${park.thread} (parked on ${park.person})`),
    ...plan.fresh.map((pair) => pair.thread),
    ...plan.freshStalled.map((turn) => `${turn.thread} (stalled ${turn.age})`),
  ];
  const summary = `${describeWaits} — ${announced.join(", ")}`;
  if (transport === undefined) {
    // A legitimate configuration: no transport means stdout IS the channel — the
    // message is printed, which is a delivery, so the state moves. That is the honest
    // form of "notifications are optional"; silence with a state that pretends
    // something was delivered would not be.
    say("no transport configured (notifications.transport) — the message follows:");
    say(message);
    writeOut(
      statePath,
      renderNotifyState({ waiting: plan.waiting, stalled: plan.stalled, parked: plan.parked }),
    );
    return { kind: "sent", summary, lines: said };
  }
  const outcome = await transport.send(message);
  if (outcome.state === "failed") {
    // The state is NOT written: these pairs were never announced, and the next call
    // must ring for them again. Non-zero, because a transport that tried and could
    // not is a thing to go and look at.
    return {
      kind: "undelivered",
      // THE COUNTS STAY IN THE SUMMARY of a failed delivery: "what was not announced"
      // is exactly the thing to look at, and the caller prints the summary alone.
      summary: `${describeWaits} — ${outcome.detail}, nothing was announced, the state is unchanged`,
      lines: said,
    };
  }
  if (outcome.state === "unconfigured") {
    // Deliberate silence on this machine, not a fault — but still not a delivery, so
    // the state stays where it is and credentials appearing later make it ring.
    say(`${outcome.detail} — nothing was announced, the state is unchanged`);
    return { kind: "quiet", summary: `${describeWaits} — nothing was announced`, lines: said };
  }
  writeOut(
    statePath,
    renderNotifyState({ waiting: plan.waiting, stalled: plan.stalled, parked: plan.parked }),
  );
  say(outcome.detail);
  return { kind: "sent", summary, lines: said };
};

/**
 * The command around the run — it prints everything the run had to say, in order,
 * and turns a setup defect back into the exit code the door has always had.
 */
const notify = async (argv: readonly string[]): Promise<void> => {
  const run = await runNotify({ argv, write: argv.includes("--write") });
  for (const line of run.lines) out(`agent-protocol: ${line}`);
  if (run.kind === "failed") return fail(run.summary, 2);
  // A DELIVERY THAT TRIED AND COULD NOT is not a setup defect: the code is 1, kept
  // apart from 2 on purpose — one says "go and fix the configuration", the other says
  // "the channel was down, nothing was announced, it will ring again".
  if (run.kind === "undelivered") return fail(run.summary, 1);
  out(`agent-protocol: ${run.summary}`);
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
    repo: flag(argv, "--repo") ?? homeOf(process.cwd()),
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
 * THE MACHINE CONFIG (R14) — read from the home directory, or from `--local-config`.
 * A failure to read one that was NAMED is a refusal here rather than a fall-back to
 * defaults: the operator pointed at a file, and answering that with silence is how a
 * run ends up using settings nobody chose.
 */
const localFrom = (argv: readonly string[]): LoadedLocalConfig => {
  const path = flag(argv, "--local-config");
  try {
    return loadLocalConfig(path === undefined ? {} : { path });
  } catch (error) {
    if (error instanceof LocalConfigError) return fail(error.message, 2);
    throw error;
  }
};

/**
 * WHAT A ROLE WOULD BE RAISED WITH — the tool, its binary and its parameters,
 * resolved together because they resolve off one key (R14 + R15). Used by `run` (one
 * role), by the daemon (per role, inside the loop) and by `status`/`preflight`, which
 * show the merge for everything the circuit can raise.
 *
 * The parameter refusal is FATAL here rather than a returned verdict: every caller
 * would do the same thing with it, and the one thing none of them may do is carry on.
 */
const agentFor = (
  argv: readonly string[],
  local: LoadedLocalConfig,
  role: Role,
  /**
   * WHAT THE THREAD SAID (R21) — already filtered by permission, and absent for every
   * caller that has no thread in hand (`status`, `preflight`): those show what a role
   * would be raised with IN GENERAL, and a per-thread directive is not part of that
   * answer. The lines it caused to be dropped are printed by the caller beside the
   * agent line, so a directive never disappears without a word.
   */
  directive?: LaunchDirective,
): {
  worker: ResolvedWorker;
  exec: ResolvedExec;
  params: AgentParams;
  ignored: readonly string[];
} => {
  const worker = resolveWorker({
    ...(flag(argv, "--worker") === undefined ? {} : { flag: flag(argv, "--worker") as string }),
    ...(role.launch === undefined ? {} : { launch: role.launch }),
  });
  const exec = resolveExec({
    ...(flag(argv, "--exec") === undefined ? {} : { flag: flag(argv, "--exec") as string }),
    worker: worker.value,
    local: local.config,
  });
  const flags: { model?: string; effort?: string } = {};
  const model = flag(argv, "--model");
  const effort = flag(argv, "--effort");
  if (model !== undefined) flags.model = model;
  if (effort !== undefined) flags.effort = effort;
  const resolution = resolveAgentParams({
    flags,
    worker,
    ...(role.launch === undefined ? {} : { launch: role.launch }),
    ...(directive === undefined ? {} : { directive }),
  });
  if (!resolution.ok) return fail(`role '${role.id}': ${resolution.reason}`, 2);
  return {
    worker,
    exec,
    params: resolution.params,
    ignored: ignoredDirective({ ...(directive === undefined ? {} : { directive }), worker }),
  };
};

/**
 * THE DIRECTIVE IN FORCE ON A THREAD, read off the disk of the mail checkout (R21) —
 * the same source every other read of the mail in the circuit uses.
 *
 * A THREAD THAT CANNOT BE READ IS NOT AN ERROR HERE. A legacy `_thread.md` has no
 * message headers at all, so it can carry no directive by construction, and a
 * malformed one is already loud everywhere it matters (`check`, `mail`). Falling back
 * to "no directive" means the role is raised on its standing calibration — which is
 * exactly what happened before R21 existed.
 */
const threadDirectiveFor = (input: {
  readonly mailRoot: string;
  readonly thread: string;
  readonly registry: RoleRegistry;
}): DirectiveVerdict => {
  let loaded: LoadedThread;
  try {
    loaded = loadThread(join(input.mailRoot, input.thread), input.thread, input.registry.ids());
  } catch {
    return { ignored: [] };
  }
  if (loaded.input === undefined) return { ignored: [] };
  return resolveThreadDirective({
    messages: loaded.input.entries.map((entry) => entry.message),
    authorized: (role) => input.registry.canSetLaunchParams(role),
  });
};

/**
 * WHAT IS SAID OUT LOUD ABOUT THE THREAD'S DIRECTIVE — the one in force, and every one
 * that was found and dropped (by permission, by tool, by an unknown effort level).
 *
 * It is printed on EVERY launch that has a directive, not only when something went
 * wrong, for the reason the whole package prints its sources: a run raised on a model
 * somebody chose in a message three days ago is a different fact from a run on the
 * role's standing calibration, and the difference must be in the log of that run.
 */
const directiveLines = (
  verdict: DirectiveVerdict,
  ignoredByMerge: readonly string[],
): readonly string[] => [
  ...(verdict.effective === undefined
    ? []
    : [`thread directive — ${describeDirective(verdict.effective)}`]),
  ...verdict.ignored,
  ...ignoredByMerge,
];

/**
 * The distinct binaries preflight has to probe. It is a SET over the launchable
 * roles, not one value: the daemon raises several roles, and since R15 they may name
 * different tools — probing whichever one happened to be first would answer a
 * question nobody asked. With no launchable role in sight (a bare `preflight` on a
 * repository that launches nothing), the flag-or-default pair is probed instead, so
 * the command still says something true.
 */
const execTargets = (
  argv: readonly string[],
  local: LoadedLocalConfig,
  roles: readonly Role[],
): { worker: string; exec: ResolvedExec }[] => {
  const targets = new Map<string, { worker: string; exec: ResolvedExec }>();
  for (const role of roles) {
    const { worker, exec } = agentFor(argv, local, role);
    // The separator is written as an ESCAPE, never as a literal NUL byte: one literal
    // byte here made `grep` treat the busiest module of the package as binary and print
    // NOTHING for it — a blindness that reads like "the code is not there" and cost a
    // session a wrong diagnosis before the byte was found.
    targets.set(`${worker.value}\u0000${exec.value}`, { worker: worker.value, exec });
  }
  if (targets.size === 0) {
    const worker = resolveWorker({
      ...(flag(argv, "--worker") === undefined ? {} : { flag: flag(argv, "--worker") as string }),
    });
    return [
      {
        worker: worker.value,
        exec: resolveExec({
          ...(flag(argv, "--exec") === undefined ? {} : { flag: flag(argv, "--exec") as string }),
          worker: worker.value,
          local: local.config,
        }),
      },
    ];
  }
  return [...targets.values()];
};

/**
 * A git call whose failure is an ANSWER rather than a crash: "the ref does not
 * exist", "this is not a worktree". Used only where the absence is a legitimate
 * state; everything that must be loud goes through `execFileSync` directly.
 *
 * `timeoutMs` is for the calls that REACH THE NETWORK: a local git call ends, a fetch
 * against a degraded (not absent) network does not, and a command whose whole job is to
 * print a plan must not hang on one. Where it is given, the timeout is a failure like
 * any other here — the caller renders it as "could not be read", never as a fact.
 */
const gitAsk = (
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs?: number,
): string | undefined => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
      ...(env === undefined ? {} : { env }),
    }).trim();
  } catch {
    return undefined;
  }
};

/** A git call that MUST work; its failure is the operator's problem, named out loud. */
const gitRun = (args: readonly string[], what: string): void => {
  try {
    execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    fail(`${what}: git ${args.join(" ")} failed — ${(error as Error).message}`, 2);
  }
};

/**
 * THE BASE OF A ROLE'S WORKSPACE (R17): the commit a fresh package starts from.
 *
 * `origin/<branch>` WHEN IT EXISTS, and the local branch only as a fallback. The base
 * of a new package is the state everyone else can see — a local `main` that has not
 * been pulled is exactly the stale premise the circuit is built to stop, and unlike a
 * human the session will never notice it started from one. The fetch is best-effort:
 * a repository without a remote is legitimate, a network blip is not a reason to
 * refuse a launch, and which ref was actually used is PRINTED beside every decision.
 */
const baseCommitOf = (repo: string, branch: string): { ref: string; commit: string } => {
  gitAsk(["-C", repo, "fetch", "--quiet", "origin", branch]);
  const remote = gitAsk(["-C", repo, "rev-parse", "--verify", "--quiet", `origin/${branch}`]);
  if (remote !== undefined && remote !== "") return { ref: `origin/${branch}`, commit: remote };
  const local = gitAsk(["-C", repo, "rev-parse", "--verify", "--quiet", branch]);
  if (local !== undefined && local !== "") return { ref: branch, commit: local };
  return fail(
    `the base branch '${branch}' (orchestrator.workdir.branch) resolves to nothing in '${repo}' — neither 'origin/${branch}' nor '${branch}' exists`,
    2,
  );
};

/**
 * The observable state of a role's workspace. A directory that exists but is not a
 * worktree of this repository is a LOUD refusal rather than a fact: everything the
 * orchestrator would do next (`worktree add`, `checkout --detach`) would either fail
 * obscurely or, worse, operate on somebody else's repository that happens to sit at
 * that path.
 */
const workspaceFacts = (path: string): WorkspaceFacts => {
  if (!existsSync(path)) return { exists: false };
  const branch = gitAsk(["-C", path, "rev-parse", "--abbrev-ref", "HEAD"]);
  const head = gitAsk(["-C", path, "rev-parse", "HEAD"]);
  if (branch === undefined || head === undefined) {
    return fail(
      `'${path}' exists but is not a git worktree — the orchestrator will not touch it; move it aside or remove it`,
      2,
    );
  }
  const locked = lockTextOf(path);
  const holder = locked === undefined ? undefined : lockHolderPid(locked);
  return {
    exists: true,
    branch,
    head,
    dirty: gitAsk(["-C", path, "status", "--porcelain"]) !== "",
    ...(locked === undefined ? {} : { locked }),
    ...(holder === undefined ? {} : { lockHolderAlive: processAlive(holder) }),
  };
};

/**
 * IS THE WORKTREE LOCKED, AND BY WHOM — read through `git worktree list --porcelain`
 * rather than off the `locked` file inside the admin directory: the listing is the
 * public interface, and the file is an implementation detail we would be betting on.
 *
 * The listing names EVERY worktree of the repository, so the block has to be found by
 * path — and the comparison is made on resolved paths, because git records the path as
 * it resolved it while ours is assembled from the config (`/tmp` is a symlink on more
 * than one of the machines this runs on).
 */
const lockTextOf = (path: string): string | undefined => {
  const listing = gitAsk(["-C", path, "worktree", "list", "--porcelain"]);
  if (listing === undefined) return undefined;
  const mine = realPath(path);
  let inBlock = false;
  for (const line of listing.split("\n")) {
    if (line.startsWith("worktree ")) inBlock = realPath(line.slice("worktree ".length)) === mine;
    else if (inBlock && line.startsWith("locked")) return line.slice("locked".length).trim();
  }
  return undefined;
};

/** The path as the filesystem knows it; the path itself when it cannot be resolved. */
const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Whether a pid is still running. Signal 0 checks for the process without touching it;
 * `EPERM` means it exists and belongs to somebody else — alive either way. Pids are
 * reused, so this answers "is SOMETHING running under that number", which is why every
 * message built on it is worded as evidence rather than as a verdict.
 */
const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Carrying out the plan — the only place in the package that creates or moves a git
 * worktree. `refuse` is NOT handled here: what a refusal costs differs between the
 * manual `run` (an exit code on the operator's terminal) and the daemon (that one
 * role stands still while the others keep going), and both callers say so themselves.
 */
const applyWorkspacePlan = (input: {
  readonly repo: string;
  readonly path: string;
  readonly base: string;
  readonly plan: WorkspacePlan;
}): void => {
  switch (input.plan.action) {
    case "create":
      mkdirSync(dirname(input.path), { recursive: true });
      // `--detach`: the base branch is normally checked out in the operator's own
      // tree, and git refuses one branch in two worktrees. A detached head at the
      // base COMMIT is the same starting point and says what a package start really
      // is — a point to branch from.
      gitRun(
        ["-C", input.repo, "worktree", "add", "--detach", input.path, input.base],
        `creating the workspace '${input.path}'`,
      );
      return;
    case "rebase":
      gitRun(
        ["-C", input.path, "checkout", "--detach", "--quiet", input.base],
        `moving the workspace '${input.path}' to the base`,
      );
      return;
    case "stash":
      // THE ONE COMMAND IN THIS PACKAGE THAT TOUCHES WORK NOBODY COMMITTED (thread 023,
      // requirement 5). It is `stash push` and not `checkout --`/`clean` on purpose:
      // every one of those destroys, while a stash is complete (`-u` takes the untracked
      // files too — a session's new file is the most common leftover of all) and
      // reversible by one gesture (`git stash apply`) for as long as the reflog lives.
      // The decision to run it at all was taken in `planWorkspace`, where a test holds
      // it; here there is nothing left to judge.
      gitRun(
        ["-C", input.path, "stash", "push", "-u", "-m", input.plan.label],
        `parking the leftovers in the workspace '${input.path}'`,
      );
      // And then the tree goes to the base like any other clean one — the stash left it
      // clean, and a run that stopped half way would be a workspace parked but not moved.
      gitRun(
        ["-C", input.path, "checkout", "--detach", "--quiet", input.base],
        `moving the workspace '${input.path}' to the base`,
      );
      return;
    default:
      return; // ready / keep / refuse — nothing to do on disk
  }
};

/**
 * SIGNING THE WORKSPACE (027) — the IO half of `planWorkspaceIdentity`: two settings in
 * the tree's own config file, and the extension that makes git read that file at all.
 *
 * Idempotent by construction (`git config` overwrites), so it runs on every launch and
 * a re-created or moved workspace picks the identity back up without anybody noticing
 * it had lost it. Returns the line to print — the caller owns the output.
 */
const applyWorkspaceIdentity = (input: {
  readonly repo: string;
  readonly path: string;
  readonly role: string;
  readonly write: boolean;
}): string => {
  const asked = (key: string): string | undefined => {
    const value = gitAsk(["-C", input.repo, "config", "--get", key]);
    return value === undefined || value === "" ? undefined : value;
  };
  const plan = planWorkspaceIdentity({
    role: input.role,
    ...(asked("core.bare") === undefined ? {} : { bare: asked("core.bare") as string }),
    ...(asked("core.worktree") === undefined
      ? {}
      : { coreWorktree: asked("core.worktree") as string }),
  });
  if (input.write && plan.action === "set") {
    if (gitAsk(["-C", input.repo, "config", "--get", "extensions.worktreeConfig"]) !== "true") {
      gitRun(
        ["-C", input.repo, "config", "extensions.worktreeConfig", "true"],
        "enabling per-worktree config so a role's workspace can be signed by the role",
      );
    }
    gitRun(
      ["-C", input.path, "config", "--worktree", "user.name", plan.identity.name],
      `signing the workspace '${input.path}' as ${plan.identity.name}`,
    );
    gitRun(
      ["-C", input.path, "config", "--worktree", "user.email", plan.identity.email],
      `signing the workspace '${input.path}' as ${plan.identity.name}`,
    );
  }
  return describeWorkspaceIdentity({ path: input.path, plan });
};

/**
 * THE LOCKS THIS PROCESS HOLDS — keyed by workspace path (`createWorkspaceLocks`),
 * because a daemon with N live supervisors holds N trees at once (finding B, thread
 * 023). The registry itself, and why a single slot was wrong, are documented at its
 * definition in `workspace.ts`.
 *
 * It is module state rather than something threaded through the call chain for one
 * reason that outweighs the tidiness: the release must also happen on the paths that
 * do not return — `fail()` exits, a signal exits, an unhandled error exits — and an
 * `exit` handler has nothing to be handed. A lock left behind by a refusal three
 * lines after it was taken would block the role until a human read the message.
 *
 * TAKING one — before the tree is mutated and before the spawn (john, 22:20). `git
 * worktree lock` FAILS when the tree is already locked, and that is the property this
 * relies on: the check in `planWorkspace` reads a fact that could be a moment old,
 * while this is the atomic one. `false` means somebody won the race, and the caller
 * refuses exactly as it would have on the fact.
 *
 * THE HONEST BOUNDARY of releasing: a SIGKILL leaves the lock behind, and that is the
 * safe direction. A stale lock costs a human one `git worktree unlock`, and `status`
 * names it as stale (the reason text carries the pid); the opposite failure costs the
 * working tree of a live session.
 */
const workspaceLocks = createWorkspaceLocks({
  lock: (input) =>
    gitAsk(["-C", input.repo, "worktree", "lock", "--reason", input.reason, input.path]) !==
    undefined,
  unlock: (input) => {
    gitAsk(["-C", input.repo, "worktree", "unlock", input.path]);
  },
});

/**
 * A supervisor releases ITS OWN tree, by path. Every call site inside `runOne` names
 * `p.workdir`: with several supervisors in one process, "release what I remember" no
 * longer identifies anything.
 */
const releaseWorkspaceLock = (path: string): void => workspaceLocks.release(path);

// THE BACKSTOP for every exit this file takes without passing through a release: a
// refused preflight, a ceiling that fires, an unhandled error, a signal (the run's own
// handlers exit, and `exit` handlers run after them). The detached parent never takes
// a lock at all — it plans in report-only mode and the child does the real work — so
// this cannot fire while a child is holding the tree.
//
// It releases EVERYTHING held: at `exit` the process is going away whole, so leaving
// one live supervisor's tree locked would be the same stale lock, only harder to see.
process.on("exit", () => workspaceLocks.releaseAll());

/**
 * WHAT THE ROLE ITSELF HAS SAID IN THE THREAD (R18, condition 2a) — its own messages,
 * in thread order, each with the session that wrote it.
 *
 * Read from DISK rather than from a git ref, like every other read of the mail in the
 * circuit (the checkout is fast-forwarded by preflight). `undefined` — the thread could
 * not be read as files at all: it is missing, malformed, or a legacy `_thread.md`,
 * which has neither file identity nor provenance. Every one of those means the same
 * thing to the policy: nobody can be shown NOT to have worked in this role's place.
 */
const ownMessagesOf = (input: {
  readonly mailRoot: string;
  readonly thread: string;
  readonly role: string;
  readonly ids: readonly string[];
}): readonly OwnMessage[] | undefined => {
  let loaded: LoadedThread;
  try {
    loaded = loadThread(join(input.mailRoot, input.thread), input.thread, input.ids);
  } catch {
    return undefined;
  }
  if (loaded.input === undefined) return undefined;
  return loaded.input.entries
    .filter((entry) => entry.message.fields.from === input.role)
    .map((entry) => ({
      file: entry.fileName,
      ...(entry.message.fields.session === undefined
        ? {}
        : { session: entry.message.fields.session }),
    }));
};

/**
 * THE WORLD A RUN STARTS FROM (R18): the base commit, and the mark of the role's own
 * last message in the thread. `undefined` when either cannot be read — a thread that
 * cannot be read as files, a project with no `workdir` at all — and that absence is
 * what makes the continuation policy answer "fresh", which is the correct answer for a
 * world nobody can vouch for.
 *
 * The mark is a FILE NAME and not a count: the next run compares by identity, and a
 * count would be equal in the one case that matters least (nothing happened) and lie in
 * the one that matters most.
 */
const worldOf = (input: {
  readonly own?: readonly OwnMessage[];
  readonly base?: string;
}): World | undefined =>
  input.base === undefined || input.own === undefined
    ? undefined
    : { base: input.base, mine: input.own.at(-1)?.file ?? "" };

/**
 * The mail-freshness probe ON ITS OWN — a function rather than a few lines inside
 * `runPreflight`, because the daemon re-runs THIS ONE and nothing else while it is
 * degraded (R6-достройка). Re-running the whole preflight every tick would probe the
 * binary and the worktrees again — checks that passed and that nobody asked about a
 * second time; the one that failed is the only one whose answer can change the state.
 *
 * `mailCheckoutState` fetches and fast-forwards on its own, so calling this IS the
 * retry: the tick is the natural interval, and no back-off is built on top of it.
 */
const probeMailCheckout = (argv: readonly string[]): PreflightCheck => {
  const loaded = configFrom(argv, undefined);
  const section = loaded.config.orchestrator;
  const repo = flag(argv, "--repo") ?? homeOf(process.cwd());
  if (section === undefined) {
    return {
      name: MAIL_CHECKOUT_CHECK,
      status: "fail",
      detail: "there is no 'orchestrator' section — there is no checkout to probe",
    };
  }
  const path = join(repo, section.mailCheckout);
  try {
    const state = mailCheckoutState(path, loaded.config.mail.branch);
    return mailCheckoutVerdict({ ...state, expectedBranch: loaded.config.mail.branch });
  } catch (error) {
    return {
      name: MAIL_CHECKOUT_CHECK,
      status: "fail",
      detail: `could not probe the checkout '${path}': ${(error as Error).message}`,
    };
  }
};

/**
 * PREFLIGHT — the checks made BEFORE the lease is taken (S8). curator's rule after
 * the third case of one class: whatever a human is obliged to remember before a
 * run, the machine either does itself or loudly refuses. The probes live here, the
 * verdicts live in the core.
 */
const runPreflight = (
  argv: readonly string[],
  targets: readonly { worker: string; exec: ResolvedExec }[],
  local: LoadedLocalConfig,
  /** The roles whose workspaces are reported (R17); empty in a repository that raises nothing. */
  roles: readonly Role[] = [],
): PreflightCheck[] => {
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
  const repo = flag(argv, "--repo") ?? homeOf(process.cwd());
  const env = childEnvFrom(argv);
  const preamble = Object.keys(section.env ?? {});

  // The binary is looked up IN THE CHILD'S ENVIRONMENT, not in ours: the daemon's
  // PATH and the session's PATH are different things, and a check of "I have it"
  // would answer the wrong question.
  const probe = (exec: string): string | null => {
    try {
      // The binary name goes through an ENVIRONMENT VARIABLE rather than being
      // interpolated into a shell string: `--exec` is set by the operator, and
      // assembling a command out of its value would be an injection for no reason.
      // `shell: true` is not used — that is exactly what it warns about.
      const found = execFileSync("/bin/sh", ["-c", 'command -v "$AGENT_PROTOCOL_EXEC"'], {
        encoding: "utf8",
        env: { ...env, AGENT_PROTOCOL_EXEC: exec },
      }).trim();
      return found === "" ? null : found;
    } catch {
      return null;
    }
  };

  let nodeVersion: string | null = null;
  try {
    nodeVersion = execFileSync("node", ["--version"], { encoding: "utf8", env }).trim();
  } catch {
    nodeVersion = null;
  }

  const checkout = probeMailCheckout(argv);

  // WHERE THE SESSIONS WORK. Two modes, and which one is in force is a statement of
  // the project: with `workdir.worktrees` declared each role has a worktree of its
  // own (R17) and the operator's checkout stops being compared against anything —
  // comparing it would resurrect the very refusal R17 removes. Without it, the
  // pre-R17 behaviour stands whole: the session inherits the checkout, and "landed on
  // the wrong branch" is not visible from the outside at all.
  const workdirChecks: PreflightCheck[] = [];
  try {
    const state = workdirState(repo);
    const worktrees = section.workdir?.worktrees;
    if (worktrees === undefined || section.workdir === undefined) {
      workdirChecks.push(
        workdirVerdict({
          ...state,
          ...(section.workdir === undefined ? {} : { expectedBranch: section.workdir.branch }),
        }),
      );
    } else {
      const base = baseCommitOf(repo, section.workdir.branch);
      workdirChecks.push(mainCheckoutVerdict({ repo, ...state }));
      for (const role of roles) {
        const path = workspacePath({ repo, worktrees, role: role.id });
        workdirChecks.push(
          workspaceVerdict({
            role: role.id,
            path,
            facts: workspaceFacts(path),
            base: base.commit,
            baseRef: base.ref,
          }),
        );
      }
    }
  } catch (error) {
    workdirChecks.push({
      name: "working tree",
      status: "fail",
      detail: `could not probe '${repo}': ${(error as Error).message}`,
    });
  }

  return [
    machineConfigVerdict(describeLocalConfig(local)),
    ...targets.map((target) =>
      agentBinaryVerdict({
        worker: target.worker,
        exec: target.exec.value,
        source: target.exec.source,
        resolved: probe(target.exec.value),
      }),
    ),
    checkout,
    ...workdirChecks,
    environmentVerdict({ nodeVersion, appliedKeys: preamble }),
  ];
};

/** Every role the circuit is able to raise — what preflight and `status` speak about. */
const launchableRoles = (argv: readonly string[]): Role[] =>
  registryFrom(argv, undefined)
    .active()
    .filter((role) => roleLaunchability(role).launchable);

/** A comma-separated flag: absent stays absent, because "not said" and "empty" differ here. */
const roleList = (argv: readonly string[], name: string): readonly string[] | undefined => {
  const raw = flag(argv, name);
  if (raw === undefined) return undefined;
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length === 0) fail(`${name} was given nothing to name`, 2);
  return items;
};

/**
 * WHICH ROLES THIS RUN RAISES (R13) — the instance's, narrowed by the operator's flags.
 *
 * Both refusals happen HERE, at the door, before a single tick: a box that does not know
 * which instance it is, and a `--roles` naming something that is not a role. Either one
 * discovered later would be a daemon that raises nobody while reporting that it works.
 */
const launchScopeFrom = (
  argv: readonly string[],
  local: LoadedLocalConfig,
  launchable: readonly Role[],
  fatal = true,
): LaunchScope => {
  const config = configFrom(argv, undefined).config;
  const ids = launchable.map((role) => role.id);
  const select = roleList(argv, "--roles");
  const exclude = roleList(argv, "--exclude-roles");
  const issues = [
    ...instanceIssues({
      instances: config.instances,
      ...(local.config.instance === undefined ? {} : { instance: local.config.instance }),
      localConfigPath: local.path,
    }),
    ...scopeFlagIssues({
      ...(select === undefined ? {} : { select }),
      ...(exclude === undefined ? {} : { exclude }),
      launchable: ids,
    }),
  ];
  if (issues.length > 0) {
    for (const issue of issues) err(`agent-protocol: ${issue}`);
    // `status` DIAGNOSES rather than launches: a box that cannot resolve its scope is
    // exactly when its state has to stay readable, so there the issues are said and the
    // scope is still rendered from what is known. Every launching path refuses.
    if (fatal) fail("the scope of this run does not resolve — not starting", 2);
  }
  return resolveLaunchScope({
    launchable: ids,
    ...(config.instances === undefined ? {} : { instances: config.instances }),
    ...(local.config.instance === undefined ? {} : { instance: local.config.instance }),
    ...(select === undefined ? {} : { select }),
    ...(exclude === undefined ? {} : { exclude }),
  });
};

/**
 * THE HEADLESS PROBE (`doctor`): the agent, spawned the way the circuit spawns it,
 * answering a throwaway prompt. The one fact about a box that no file can carry.
 *
 * The prompt is the cheapest thing that still exercises the whole path — credentials,
 * network, model access — and its ANSWER IS DISCARDED: what doctor takes from the run
 * is that there was one. The tool's own words are carried out on failure, unedited: a
 * dead token, a model this account may not use and a proxy in the way all fail here,
 * and only the tool can tell them apart.
 */
const probeHeadless = (input: {
  readonly exec: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}): DoctorOutcome => {
  const started = Date.now();
  try {
    execFileSync(input.exec, ["-p", "Answer with the single word: ok"], {
      encoding: "utf8",
      env: input.env,
      timeout: input.timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, detail: `answered in ${((Date.now() - started) / 1000).toFixed(1)}s` };
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; signal?: string };
    if (failure.signal === "SIGTERM") {
      return {
        ok: false,
        detail: `no answer within ${Math.round(input.timeoutMs / 1000)}s — the circuit would raise sessions that die on their first call`,
      };
    }
    const said = `${failure.stderr ?? ""}${failure.stdout ?? ""}`.trim();
    return {
      ok: false,
      detail: said === "" ? (error as Error).message : (said.split("\n")[0] ?? ""),
    };
  }
};

/** A git probe whose failure is an ANSWER: the remote's own words, first line kept. */
const probeGit = (args: readonly string[]): DoctorOutcome => {
  try {
    const said = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, detail: said === "" ? "ok" : (said.split("\n")[0] as string) };
  } catch (error) {
    const failure = error as { stderr?: string };
    const said = (failure.stderr ?? (error as Error).message).trim();
    return {
      ok: false,
      detail:
        said
          .split("\n")
          .filter((line) => line.trim() !== "")
          .slice(0, 2)
          .join(" · ") || (error as Error).message,
    };
  }
};

/**
 * WHAT THE BINARY OF A TOOL IS CALLED. Known for the one tool the package raises
 * (`claude-code` → `claude`); for anything else the id is the best guess there is, and
 * a wrong guess costs nothing — it is looked up on PATH, and a miss is a row asking for
 * `--exec`, not a failure.
 */
const execNameOf = (kind: string): string => (kind === DEFAULT_WORKER ? DEFAULT_EXEC : kind);

/** Where a binary actually is, asked of the CHILD's PATH — the daemon's is not the shell's. */
const resolveOnPath = (name: string, env: NodeJS.ProcessEnv): string | undefined => {
  try {
    const found = execFileSync("/bin/sh", ["-c", 'command -v "$AGENT_PROTOCOL_EXEC"'], {
      encoding: "utf8",
      env: { ...env, AGENT_PROTOCOL_EXEC: name },
    }).trim();
    return found === "" ? undefined : found;
  } catch {
    return undefined;
  }
};

/**
 * `init` — COMMISSIONING THIS BOX (thread 019, the operator tail, point 1).
 *
 * The reasoning for what it may and may not do lives in `orchestrator/init.ts`; here
 * are the effects, and three of them are worth naming at the place they happen:
 *
 *  - THE MAIL WORKTREE IS CREATED WITH A FETCH FIRST, and that ordering is the defect
 *    this command was written around: the checkout on `lle-agents` was made by hand
 *    without one, and every frame afterwards said `mail: never pulled`.
 *  - THE MACHINE CONFIG IS WRITTEN WHOLE, from `nextLocalConfig`, and then re-read by
 *    `doctor` through the ordinary loader. Nothing here reports on its own work.
 *  - IT ENDS IN `doctor`, whose exit code becomes this command's. "The box is
 *    commissioned" is a checklist, never a belief about what was typed.
 */
const boxInit = (argv: readonly string[]): void => {
  const withRef = withOperatorRef(argv);
  const loaded = configFrom(withRef, undefined);
  // The same split doctor makes (R26): the config is judged at the ref of the tree the
  // command was typed in, the FACTS ABOUT THE BOX hang off the main checkout.
  const repo = flag(withRef, "--repo") ?? homeOf(process.cwd());
  // A NAMED MACHINE CONFIG THAT IS NOT THERE IS THE ORDINARY CASE *HERE*, and only
  // here. Everywhere else it is a refusal — the operator pointed at a file, and
  // answering that with defaults is how a run uses settings nobody chose. This is the
  // command that brings the file into being, so `--local-config` on a fresh box names
  // where it WILL be. One that exists and does not parse is still a refusal: somebody
  // wrote it, and init would be overwriting a statement it could not read.
  const named = flag(withRef, "--local-config");
  const local: LoadedLocalConfig =
    named !== undefined && !existsSync(named)
      ? { config: { agents: {} }, path: named, found: false, explicit: true }
      : localFrom(withRef);
  const write = withRef.includes("--write");
  const env = childEnvFrom(withRef);

  const kind = flag(withRef, "--agent") ?? DEFAULT_WORKER;
  const declaredExec = local.config.agents[kind]?.exec;
  const namedExec = flag(withRef, "--exec");
  const found = namedExec === undefined ? resolveOnPath(execNameOf(kind), env) : undefined;
  const version = found === undefined ? undefined : (gitFreeVersion(found, env) ?? undefined);

  const instance = flag(withRef, "--instance");
  const declaredInstances = (loaded.config.instances ?? []).map((one) => one.id);
  const section = loaded.config.orchestrator;
  const mailCheckout = section === undefined ? undefined : join(repo, section.mailCheckout);
  const mailRoot =
    mailCheckout === undefined ? undefined : join(mailCheckout, loaded.config.mail.dir);
  const claimed = instance ?? local.config.instance;
  const occupancy =
    mailRoot === undefined || claimed === undefined
      ? {}
      : occupancyOf({
          repo,
          branch: loaded.config.mail.branch,
          checkout: mailCheckout as string,
          inRoot: join(mailRoot, digestPath(claimed)),
          onBranch: `${loaded.config.mail.dir}/${digestPath(claimed)}`,
          offline: withRef.includes("--offline"),
        });

  const steps: InitStep[] = [
    instanceStep({
      ...(instance === undefined ? {} : { requested: instance }),
      ...(local.config.instance === undefined ? {} : { current: local.config.instance }),
      declared: declaredInstances,
      ...(occupancy.occupant === undefined ? {} : { occupant: occupancy.occupant }),
      ...(occupancy.unchecked === undefined ? {} : { unchecked: occupancy.unchecked }),
    }),
    agentStep({
      kind,
      ...(namedExec === undefined ? {} : { requested: namedExec }),
      ...(declaredExec === undefined ? {} : { current: declaredExec }),
      ...(found === undefined ? {} : { resolved: found }),
      ...(version === undefined ? {} : { version }),
    }),
    operatorStep({
      ...(flag(withRef, "--operator") === undefined
        ? {}
        : { requested: flag(withRef, "--operator") as string }),
      ...(local.config.operator === undefined ? {} : { current: local.config.operator }),
      known: loaded.registry.ids(),
    }),
    secretsStep({
      ...(flag(withRef, "--secrets") === undefined
        ? {}
        : { requested: flag(withRef, "--secrets") as string }),
      ...(local.config.secrets === undefined ? {} : { current: local.config.secrets.envFile }),
      ...((flag(withRef, "--secrets") ?? local.config.secrets?.envFile) === undefined
        ? {}
        : {
            exists: existsSync(
              (flag(withRef, "--secrets") ?? local.config.secrets?.envFile) as string,
            ),
          }),
    }),
  ];
  if (mailCheckout === undefined) {
    steps.push({
      name: "mail: checkout",
      action: "missing",
      detail: `the config at ${loaded.ref} has no 'orchestrator' section — there is no checkout to create`,
    });
  } else {
    steps.push(
      mailStep({
        path: mailCheckout,
        present: existsSync(mailCheckout),
        branch: loaded.config.mail.branch,
      }),
    );
  }

  out(renderInitSteps(steps));
  // The summary is built in one place because it carries an EFFECT (the occupancy read
  // that moved a ref, when there was one), and an effect reported on one exit and not on
  // another is the same lie in smaller print.
  const summary = (): string =>
    initSummary({
      steps,
      write,
      ...(occupancy.fetched === undefined ? {} : { fetched: occupancy.fetched }),
    });
  const blockers = initBlockers(steps);
  if (blockers.length > 0) {
    out(summary());
    fail("init: the crosses above are facts this box cannot be commissioned without", 2);
    return;
  }
  if (!write) {
    out(summary());
    return;
  }

  // THE MAIL FIRST, THE CONFIG SECOND. A half-commissioned box is unavoidable (the two
  // live in different places and neither is transactional), so the order picks WHICH
  // half survives a failure: a worktree without a config is inert, a config naming a
  // checkout that was never created is a box that looks configured and reads no mail.
  if (mailCheckout !== undefined && !existsSync(mailCheckout)) {
    const branch = loaded.config.mail.branch;
    gitRun(["-C", repo, "fetch", "origin", branch], "creating the mail checkout");
    const localBranch = gitAsk(["-C", repo, "rev-parse", "--verify", "--quiet", branch]);
    gitRun(
      localBranch === undefined || localBranch === ""
        ? ["-C", repo, "worktree", "add", "--track", "-b", branch, mailCheckout, `origin/${branch}`]
        : ["-C", repo, "worktree", "add", mailCheckout, branch],
      "creating the mail checkout",
    );
  }

  const decisions = {
    ...(instance === undefined ? {} : { instance }),
    ...(flag(withRef, "--operator") === undefined
      ? {}
      : { operator: flag(withRef, "--operator") as string }),
    ...((namedExec ?? found) === undefined
      ? {}
      : { agent: { kind, exec: (namedExec ?? found) as string } }),
    ...(flag(withRef, "--secrets") === undefined
      ? {}
      : { secretsEnvFile: flag(withRef, "--secrets") as string }),
  };
  writeOut(local.path, `${JSON.stringify(nextLocalConfig(local.config, decisions), null, 2)}\n`);
  out(`init: machine config written — ${local.path}`);
  out(summary());

  if (withRef.includes("--no-doctor")) {
    out("init: doctor was not run (--no-doctor) — the box is configured, not yet checked");
    return;
  }
  // The checklist is re-read from disk, through the ordinary loaders: init does not get
  // to report on its own work. Its exit code becomes this command's.
  doctor([
    ...(flag(withRef, "--ref") === undefined ? [] : ["--ref", flag(withRef, "--ref") as string]),
    ...(flag(withRef, "--repo") === undefined ? [] : ["--repo", flag(withRef, "--repo") as string]),
    ...(flag(withRef, "--local-config") === undefined
      ? []
      : ["--local-config", flag(withRef, "--local-config") as string]),
    ...(withRef.includes("--offline") ? ["--offline"] : []),
  ]);
};

/**
 * `config set <key> <value>` — ONE FACT OF THE MACHINE CONFIG, CHANGED (thread 019, п.3).
 *
 * The decision is `config/set.ts` and every effect is here, the same split `init` makes.
 * Two of those effects are worth naming, because both are facts about THIS box that no
 * pure function can be given for free: whether the secrets file named is on disk, and
 * whether the binary named resolves — as a path, or on the PATH of the child that would
 * spawn it (which is not this process's PATH, and that difference has cost an evening).
 */
const configSet = (argv: readonly string[]): void => {
  const withRef = withOperatorRef(argv);
  const loaded = configFrom(withRef, undefined);
  // The same reading `init` makes of `--local-config`, for the same reason: this is a
  // command that may bring the file into being, so a named path that is not there yet is
  // where it WILL be, not a refusal.
  const named = flag(withRef, "--local-config");
  const local: LoadedLocalConfig =
    named !== undefined && !existsSync(named)
      ? { config: { agents: {} }, path: named, found: false, explicit: true }
      : localFrom(withRef);
  const write = withRef.includes("--write");
  const key = withRef[0]?.startsWith("-") === false ? withRef[0] : undefined;
  const value = withRef[1]?.startsWith("-") === false ? withRef[1] : undefined;
  const exec = flag(withRef, "--exec");

  const outcome = planConfigSet({
    current: local.config,
    path: local.path,
    ...(key === undefined ? {} : { key }),
    ...(value === undefined ? {} : { value }),
    ...(exec === undefined ? {} : { exec }),
    declaredInstances: (loaded.config.instances ?? []).map((one) => one.id),
    knownRoles: loaded.registry.ids(),
    ...(key === "secrets" && value !== undefined ? { secretsExists: existsSync(value) } : {}),
    ...(key === "agent" && exec !== undefined
      ? {
          execFound: exec.includes("/")
            ? existsSync(exec)
            : resolveOnPath(exec, childEnvFrom(withRef)) !== undefined,
        }
      : {}),
  });
  if (!outcome.ok) {
    fail(`config set: ${outcome.refusal}`, 2);
    return;
  }

  out(renderInitSteps([outcome.step]));
  out(configSetSummary({ step: outcome.step, write, path: local.path }));
  // A `keep` writes nothing even under --write: rewriting a file to the bytes it already
  // holds would change its mtime, and mtime is what an operator reads when they ask when
  // this box was last touched.
  if (!write || outcome.step.action === "keep") return;
  writeOut(local.path, `${JSON.stringify(outcome.next, null, 2)}\n`);
  out(
    "config set: 'doctor' is what says whether the box still holds together — this command changed one line",
  );
};

/** What the tool says about itself, when it says anything. A version is a fact, not a gate. */
const gitFreeVersion = (exec: string, env: NodeJS.ProcessEnv): string | undefined => {
  try {
    const said = execFileSync(exec, ["--version"], {
      encoding: "utf8",
      env,
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return said === "" ? undefined : (said.split("\n")[0] as string);
  } catch {
    return undefined;
  }
};

/**
 * WHO ELSE PUBLISHES UNDER THIS ID — asked of the BRANCH, not of a checkout (round 6 of
 * thread 019, a defect this command shipped with).
 *
 * The warning exists for one situation above all: a box being commissioned from nothing,
 * which is the acceptance scenario of the statement itself. On such a box the mail
 * worktree does not exist yet at the moment these steps are drawn — `init` creates it
 * LOWER DOWN — so a digest looked up as a FILE inside it was always absent, and absence
 * was rendered as 'free'. The one answer this check must never give by accident.
 *
 * So: the local checkout when it is there (free, and it is the freshest thing on the
 * box), otherwise a read-only `fetch` of the mail branch and the digest out of the git
 * object. And when neither can be had — `--offline`, no remote, a branch nobody pushed —
 * the answer is UNCHECKED and says so: 'no data' and 'nobody is there' are different
 * facts, and only one of them lets an operator take the id calmly.
 *
 * THE FETCH HAPPENS IN THE PLAN TOO, and that is deliberate — the warning is worth
 * nothing arriving together with the deed, it has to reach the operator BEFORE the id is
 * taken, and `init` without `--write` is where the operator looks. What that costs is
 * said out loud instead of being hidden (round 7 of thread 019, where the summary line
 * and USAGE still promised a plan that touched nothing): the branch this fetch moved is
 * REPORTED back to the caller, `--offline` leaves the network unasked, and the call is
 * bounded in time so a half-dead network cannot hang a command that only prints.
 */
const OCCUPANCY_FETCH_TIMEOUT_MS = 20_000;

const occupancyOf = (input: {
  readonly repo: string;
  readonly branch: string;
  readonly checkout: string;
  readonly inRoot: string;
  readonly onBranch: string;
  readonly offline: boolean;
}): { occupant?: InstanceOccupant; unchecked?: string; fetched?: string } => {
  if (existsSync(input.checkout)) {
    const local = digestOccupant(input.inRoot);
    return local === undefined ? {} : { occupant: local };
  }
  if (input.offline) {
    return {
      unchecked: `--offline and no mail checkout yet — '${input.branch}' was not read`,
    };
  }
  gitAsk(
    ["-C", input.repo, "fetch", "--quiet", "--no-tags", "origin", input.branch],
    undefined,
    OCCUPANCY_FETCH_TIMEOUT_MS,
  );
  const head = gitAsk([
    "-C",
    input.repo,
    "rev-parse",
    "--verify",
    "--quiet",
    `origin/${input.branch}`,
  ]);
  // The fetch is reported from here on WHATEVER the answer turns out to be: what the
  // summary line owes the operator is the effect, not the verdict it produced.
  const fetched = input.branch;
  if (head === undefined || head === "") {
    return {
      fetched,
      unchecked: `'origin/${input.branch}' could not be read from ${input.repo}`,
    };
  }
  const raw = gitAsk(["-C", input.repo, "show", `origin/${input.branch}:${input.onBranch}`]);
  // A path that is not on the branch is git's own error, indistinguishable here from a
  // failed call — and it is also the ordinary case: nobody has published this id. The
  // branch itself was read (the rev-parse above), so 'free' is a fact, not silence.
  if (raw === undefined || raw === "") return { fetched };
  const read = parseDigest(raw);
  return read.ok
    ? { fetched, occupant: { writtenAt: read.digest.writtenAt, roles: read.digest.roles } }
    : { fetched, unchecked: `${input.onBranch} on '${input.branch}' does not parse as a digest` };
};

/** The digest another box published under an id (R13), when there is one and it reads. */
const digestOccupant = (
  path: string,
): { writtenAt: string; roles: readonly string[] } | undefined => {
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const read = parseDigest(raw);
  return read.ok ? { writtenAt: read.digest.writtenAt, roles: read.digest.roles } : undefined;
};

/**
 * `doctor` — IS THIS BOX COMMISSIONED, in one command (thread 019, the operator tail).
 *
 * The reasoning for the command and for what is a cross and what is a dot lives in
 * `orchestrator/doctor.ts`; here are the probes. Two things are worth saying at the
 * place where the effects are:
 *
 *  - IT REACHES THE NETWORK AND SPENDS AN AGENT CALL, unlike everything else in this
 *    CLI that looks like it. That is the point: the checks it makes are exactly the
 *    ones that cannot be inferred from a file, and they are asked by a human twice in
 *    the life of a machine. `--offline` leaves them unasked and SAYS SO in the rows,
 *    rather than passing them.
 *  - THE WRITE ACCESS IS PROBED AGAINST A REF THAT DOES NOT EXIST, with `--dry-run`.
 *    A dry-run push of an up-to-date branch is answered locally ("Everything
 *    up-to-date") and proves nothing about credentials; a ref the remote has never
 *    seen forces the negotiation that a read-only box fails. Nothing is created —
 *    that is what `--dry-run` means.
 */
const doctor = (argv: readonly string[]): void => {
  const withRef = withOperatorRef(argv);
  const loaded = configFrom(withRef, undefined);
  // TWO REPOSITORIES, AND THEY ARE DIFFERENT QUESTIONS (R26, the split `orchestrator/home.ts`
  // states). The config was read at a ref OF THE TREE THIS WAS CALLED FROM (`configFrom` →
  // `repoOf`), so everything judged AT THAT REF — the declared instruction files — has to be
  // looked for in the same tree, or `doctor --ref HEAD` from a role's worktree would judge the
  // HEAD of one tree by the contents of another. Everything that is a fact ABOUT THE BOX — the
  // remote it pushes through, the mail checkout, the state — hangs off the main checkout
  // (`homeOf`), whatever directory the operator typed the command in.
  const configRepo = flag(withRef, "--repo") ?? repoOf(process.cwd());
  const repo = flag(withRef, "--repo") ?? homeOf(process.cwd());
  const local = localFrom(withRef);
  const offline = withRef.includes("--offline");
  const skipped: DoctorSkipped = { skipped: "--offline" };

  const checks: PreflightCheck[] = [
    repositoryConfigCheck({
      path: loaded.path,
      ref: loaded.ref,
      roles: loaded.registry.ids().length,
      issues: configIssues(loaded, configRepo),
    }),
    machineConfigCheck({
      path: local.path,
      found: local.found,
      summary: describeLocalConfig(local),
    }),
    instanceCheck({
      ...(local.config.instance === undefined ? {} : { instance: local.config.instance }),
      declared: (loaded.config.instances ?? []).map((instance) => instance.id),
      ...(local.config.instance === undefined
        ? {}
        : {
            roles: rolesOfInstance({
              ...(loaded.config.instances === undefined
                ? {}
                : { instances: loaded.config.instances }),
              instance: local.config.instance,
            }),
          }),
      localConfigPath: local.path,
    }),
  ];

  // The agent: WHERE it is (the same verdict preflight makes, so the two commands
  // cannot disagree) and then WHETHER IT ANSWERS, which only doctor asks.
  const env = childEnvFrom(withRef);
  const roles = launchableRoles(withRef);
  for (const target of execTargets(withRef, local, roles)) {
    // The binary is looked up IN THE CHILD'S ENVIRONMENT, for preflight's reason: the
    // daemon's PATH and the session's PATH are different things.
    let found: string | null = null;
    try {
      found = execFileSync("/bin/sh", ["-c", 'command -v "$AGENT_PROTOCOL_EXEC"'], {
        encoding: "utf8",
        env: { ...env, AGENT_PROTOCOL_EXEC: target.exec.value },
      }).trim();
      if (found === "") found = null;
    } catch {
      found = null;
    }
    checks.push(
      agentBinaryVerdict({
        worker: target.worker,
        exec: target.exec.value,
        source: target.exec.source,
        resolved: found,
      }),
    );
    checks.push(
      agentLiveCheck({
        worker: target.worker,
        outcome:
          offline || found === null
            ? offline
              ? skipped
              : { skipped: "the binary was not found — there is nothing to run" }
            : probeHeadless({
                exec: found,
                env,
                timeoutMs: positiveInt(withRef, "--probe-timeout", 120) * 1000,
              }),
      }),
    );
  }

  // Git: the remote the circuit reads and writes through. The write probe names the
  // instance, so two boxes probing the same remote are told apart in its logs.
  const origin = gitAsk(["-C", repo, "remote", "get-url", "origin"]);
  const probeRef = `refs/heads/agent-protocol-doctor-probe/${local.config.instance ?? "unnamed"}`;
  checks.push(
    ...gitChecks({
      origin: origin === undefined || origin === "" ? null : origin,
      fetch: offline ? skipped : probeGit(["-C", repo, "fetch", "--dry-run", "origin"]),
      push: offline
        ? skipped
        : probeGit(["-C", repo, "push", "--dry-run", "origin", `HEAD:${probeRef}`]),
    }),
  );

  // The mail: it is there, and it is fresh — the second judgement is the daemon's own
  // (`mailCheckoutVerdict`), passed through rather than restated.
  const section = loaded.config.orchestrator;
  if (section === undefined) {
    checks.push({
      name: "mail: checkout",
      status: "fail",
      detail: "there is no 'orchestrator' section — there is no checkout to probe",
    });
  } else {
    const path = join(repo, section.mailCheckout);
    checks.push(mailPresenceCheck({ path, present: existsSync(path) }));
    if (existsSync(path)) checks.push(probeMailCheckout(withRef));
  }

  out(renderPreflight(checks));
  out(doctorSummary(checks));
  if (!doctorPassed(checks)) fail("doctor: this box is not ready — the crosses above say why", 1);
};

/** The `orchestrator preflight` command: show everything and return a code by the outcome. */
const orchestratorPreflight = (argv: readonly string[]): void => {
  const local = localFrom(argv);
  const roles = launchableRoles(argv);
  const checks = runPreflight(argv, execTargets(argv, local, roles), local, roles);
  out(renderPreflight(checks));
  if (!preflightPassed(checks)) fail("preflight failed — the circuit does not start", 2);
};

/**
 * Preflight before the start: `daemon` and `run` call it themselves and do NOT
 * start on a failure. Otherwise it stays yet another "do not forget" item, that
 * is, exactly the thing it was built to remove.
 */
const requirePreflight = (
  argv: readonly string[],
  targets: readonly { worker: string; exec: ResolvedExec }[],
  local: LoadedLocalConfig,
  roles: readonly Role[] = [],
): void => {
  const checks = runPreflight(argv, targets, local, roles);
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
 * The digests of every box, off the mail checkout (R13). A missing `_instances/` is
 * simply nobody having published yet — not an error: the directory appears with the
 * first daemon that writes its state. A file that does NOT read is kept and handed on
 * with its reason, because the whole point of the class is that one broken box must not
 * make the other five invisible.
 */
const loadDigests = (
  mailRoot: string,
): { digests: InstanceDigest[]; unreadable: Map<string, string>; files: string[] } => {
  const dir = join(mailRoot, DIGEST_DIR);
  const digests: InstanceDigest[] = [];
  const unreadable = new Map<string, string>();
  if (!existsSync(dir)) return { digests, unreadable, files: [] };
  const files = readdirSync(dir).sort();
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), "utf8");
    } catch (error) {
      unreadable.set(name, (error as Error).message);
      continue;
    }
    const read = parseDigest(raw);
    if (read.ok) digests.push(read.digest);
    else unreadable.set(name, read.problem);
  }
  return { digests, unreadable, files };
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
/**
 * `snapshot()` OF THE STATEMENT OF WORK — the whole live view collected in one call
 * (T-0, thread 019). Everything it touches is DISK: the journal, the holds, the four
 * flags, the pid file, the mail directory, the digests. Not one git command, and in
 * particular never `mailCheckoutState`, which fetches and fast-forwards — a reader
 * that repaired the checkout would race the daemon for it (see `mailCheckoutFreshness`
 * for the whole argument). How old that disk state is comes back as a fact in the
 * frame instead.
 */
const operatorFrame = (argv: readonly string[]): OperatorFrame => {
  const paths = pathsFrom(argv);
  const journal = flag(argv, "--journal") ?? paths.journal;
  const holds = flag(argv, "--holds") ?? paths.holds;
  const enableFlag = flag(argv, "--enable-flag") ?? paths.enableFlag;
  const stopFlag = flag(argv, "--stop-flag") ?? paths.stopFlag;
  const forceFlag = flag(argv, "--force-flag") ?? paths.forceFlag;
  const pidFile = flag(argv, "--pid-file") ?? paths.daemonPid;
  const mailRoot = flag(argv, "--root") ?? paths.mailRoot;

  const events = existsSync(journal) ? parseJournal(readFile(journal, "orchestrator journal")) : [];
  const now = orchestratorNow(argv);
  const modeFile = flag(argv, "--mode-file");
  let reboot: "systemd" | "manual" | undefined;
  if (modeFile !== undefined) {
    const mode = readFile(modeFile, "reboot mode").trim();
    if (mode !== "systemd" && mode !== "manual") {
      return fail(`reboot mode '${mode}' in '${modeFile}' — expected systemd | manual`, 2);
    }
    reboot = mode;
  }

  const local = localFrom(argv);
  const roles = launchableRoles(argv);
  const scope = launchScopeFrom(argv, local, roles, false);
  const registry = registryFrom(argv, undefined);
  const scan = loadThreads(mailRoot, registry.ids());
  const threads = scan.threads.map((loaded) => loaded.thread);
  // The queue is built by the SAME function the daemon builds it with, scoped to the
  // same roles — see `rankCandidates`.
  const { ranked, ignored } = rankCandidates({
    threads,
    roles: scope.roles,
    waitingOn: (role) => threadsWaitingOn(threads, role),
    authorized: (role) => registry.canSetThreadPriority(role),
  });
  const residentRoles = registry.residents();
  const published = loadDigests(mailRoot);
  const checkout = dirname(mailRoot);
  const daemonPid = runningDaemon(pidFile);
  // The SAME attempt ceiling the daemon judges by (`--max-attempts`), and the SAME
  // mail (thread 023) — either one missing here would make the frame call a pair
  // exhausted that the next tick raises without blinking.
  const leases = foldLeases(
    events,
    now,
    gatesFrom(argv).maxAttempts.value,
    sessionsThatWrote(threads),
    // T-1: every pair names its own transcript. The directory is derived from the journal
    // exactly as the launchers derive it (`join(dirname(journalPath), "sessions")`), so an
    // operator pointing `--journal` at a copy gets that copy's sessions and not this box's.
    join(dirname(journal), "sessions"),
  );
  const heldViews = foldHolds(loadHolds(holds), now);

  return {
    now,
    leases,
    holds: heldViews,
    // D-4: the capacity of the box and what it is spent on. `scope.roles` and not
    // `roles` — the count must be what THIS run would raise (R13, the instance filter
    // and the operator's flags), or the frame reports room that does not exist here.
    parallelism: {
      raisable: scope.roles,
      live: leases.filter((view) => isLeaseAlive(view.state)),
      held: heldRoles(heldViews),
    },
    // R27, from the SAME scan the queue above is built from — the map the tick plans by.
    parked: parkedThreads(threads),
    circuit: {
      launchesEnabled: existsSync(enableFlag),
      ...(reboot === undefined ? {} : { reboot }),
      stopFlag: existsSync(stopFlag),
      forceFlag: existsSync(forceFlag),
      ...(daemonPid === undefined ? {} : { daemonPid }),
      pidFilePresent: existsSync(pidFile),
    },
    // THE SAME FOLD THE DAEMON PLANS BY (`planTick`) — the frame and the tick cannot
    // disagree about whether the box is standing down.
    quota: openQuotaShelves(events, now),
    // R23-1 in the FRAME (T-1): from the SAME threads the queue above is built from, so
    // a resident wait and a launch candidate can never disagree about who is waiting.
    // The section exists only where the project has resident roles at all.
    ...(residentRoles.length === 0
      ? {}
      : {
          residents: {
            roles: residentRoles,
            waits: residentWaits({
              residents: residentRoles,
              waitingThreads: (role) => threadsWaitingOn(threads, role),
            }),
          },
        }),
    queue: orderCandidates(ranked),
    queueNotes: [...renderThreadFailures(scan.failures), ...ignored],
    digests: published.digests,
    unreadableDigests: published.unreadable,
    ...(scope.instance === undefined ? {} : { self: scope.instance }),
    mail: {
      root: mailRoot,
      ...mailCheckoutFreshness(checkout, configFrom(argv, undefined).config.mail.branch),
    },
  };
};

/**
 * `status --watch` — THE FRAME, REDRAWN (T-0, thread 019). Deliberately built before
 * the TUI and NOT as a cheap substitute for it: it covers cases the TUI cannot enter
 * by construction — a dumb terminal over ssh, a tmux pane nobody looks at, output
 * into `tee`, a screenshot for a thread. Raw mode needs a real TTY and takes the
 * terminal for itself; this takes nothing.
 *
 * TWO OUTPUT SHAPES, one loop. On a TTY the frame is drawn in place: the cursor goes
 * home, every line clears its own tail (`ESC[K`) and the rest of the screen is cleared
 * once at the end — no clear-screen, so nothing blinks between frames, and the whole
 * frame is written with ONE `write` call. Without a TTY (a pipe, `tee`, a file) there
 * is nothing to move a cursor over: frames are appended with a separator, which is
 * what makes `watch | tee` a usable log rather than a pile of escape codes.
 *
 * `resize` redraws immediately and re-truncates to the new width — a frame wider than
 * the terminal wraps, and wrapped lines drift the in-place redraw out of alignment
 * until the picture is unreadable.
 *
 * The terminal is restored from ONE place (`process.on("exit")`): it catches `q`,
 * SIGINT and an unhandled throw alike, and a watcher that leaves a terminal without a
 * cursor is worse than no watcher at all.
 */
/** The four sequences the redraw needs — named, so no escape byte is ever typed inline. */
const HOME = "\u001b[H";
const CLEAR_LINE = "\u001b[K";
const CLEAR_BELOW = "\u001b[J";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

/** `HH:MM:SSZ` — the outage line says WHEN, and a whole timestamp is noise in a frame. */
const clockOf = (at: Date): string => at.toISOString().slice(11, 19);

const watchFrame = (argv: readonly string[]): void => {
  // ONE resolution of the config for the whole watch — see `freezeConfig`. Taken before
  // the first frame, so the network is touched once and never again.
  freezeConfig();
  const seconds = positiveInt(argv, "--interval", 2);
  // A ceiling on FRAMES exists for the checks: a loop that never ends cannot be
  // asserted on, and a process test of the redraw is the only place the escape
  // sequences are exercised at all.
  const limit = flag(argv, "--frames") === undefined ? undefined : positiveInt(argv, "--frames", 1);
  const tty = process.stdout.isTTY === true;
  let restored = false;
  const restore = (): void => {
    if (restored || !tty) return;
    restored = true;
    process.stdout.write(`${SHOW_CURSOR}\n`);
  };
  process.on("exit", restore);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => process.exit(0));
  }

  // THE LAST FRAME THAT COLLECTED, AND THE OUTAGE OVER IT. A watcher may die of Ctrl+C
  // and of nothing else (thread 019): a failed collection draws the last known state
  // with a line saying what has been unavailable and since when, and the loop goes on —
  // when the cause passes, the next frame is live again with no intervention.
  let lastGood: string | undefined;
  let outage: { readonly since: Date; readonly reason: string } | undefined;

  const collect = (): string => {
    collectingFrame = true;
    try {
      const frame = renderFrame(operatorFrame(argv));
      lastGood = frame;
      outage = undefined;
      return frame;
    } catch (error) {
      const reason = (error as Error).message;
      // The moment is the FIRST failure of this outage, not of this frame: "unavailable
      // since 09:57" is the fact; a stamp that ticks forward every second would say
      // nothing at all.
      outage ??= { since: new Date(), reason };
      const head = `frame: unavailable since ${clockOf(outage.since)} (${outage.reason})`;
      return lastGood === undefined
        ? `${head}\nnothing has collected yet — the watch keeps trying every ${seconds}s`
        : `${head}\nthe frame below is the last one that collected:\n\n${lastGood}`;
    } finally {
      collectingFrame = false;
    }
  };

  const draw = (): void => {
    const frame = collect();
    if (!tty) {
      process.stdout.write(`${frame}\n\n`);
      return;
    }
    const width = process.stdout.columns ?? 80;
    const body = frame
      .split("\n")
      .map((line) => `${[...line].slice(0, width).join("")}${CLEAR_LINE}`)
      .join("\n");
    // Hide the cursor, home, the frame, then clear whatever the previous (longer)
    // frame left below — one write, so a half-drawn frame is never on screen.
    process.stdout.write(`${HIDE_CURSOR}${HOME}${body}\n${CLEAR_BELOW}`);
  };

  let drawn = 0;
  const tick = (): void => {
    draw();
    drawn += 1;
    if (limit !== undefined && drawn >= limit) {
      restore();
      return;
    }
    setTimeout(tick, seconds * 1000);
  };
  process.stdout.on("resize", () => {
    if (limit === undefined || drawn < limit) draw();
  });
  tick();
};

/**
 * `orchestrator tui` — THE OBSERVER (T-1, thread 019). The sixth operator short form,
 * with the same `--ref` bootstrap as `up`/`down`/`hold`/`resume`/`status`.
 *
 * EVERYTHING DECIDED LIVES IN `tui.ts`; this is the shell around it — the door, the
 * terminal, the timer and the two files the bottom panel reads. It draws `renderTui`
 * over the very frame `status` prints and touches no other source of truth.
 *
 * THE DOOR. Raw mode needs a real TTY. Without one the command REFUSES IN WORDS and
 * names the thing that does work in a pipe, a tmux pane nobody looks at and a dumb
 * terminal — `status --watch`, which was deliberately built first for exactly those.
 * Drawing escape sequences into a pipe would be the failure mode of a tool that is only
 * ever reached when something else has already gone wrong.
 *
 * THE TERMINAL IS RESTORED FROM ONE PLACE (`process.on("exit")`), like `watchFrame`'s:
 * `q`, Ctrl+C and an unhandled throw must leave the same way. What is put back is
 * everything that was taken — cooked mode, the cursor, bracketed paste, and the
 * alt-screen, which is why the operator's scrollback comes back untouched.
 *
 * THE TRANSCRIPT IS READ FORWARD, NOT RE-READ. The file grows while it is being looked
 * at; each poll reads from the offset the last one stopped at, and a file that was
 * replaced (a new run, a smaller size) starts over rather than seeking past its end.
 */
const ALT_SCREEN_ON = "\u001b[?1049h";
const ALT_SCREEN_OFF = "\u001b[?1049l";

/** How much of the transcript is kept in memory — a panel shows a screenful at most. */
const TRANSCRIPT_LINES = 200;

const orchestratorTui = (rawArgv: readonly string[]): void => {
  const argv = withOperatorRef(rawArgv);
  const stdin = process.stdin;
  if (process.stdout.isTTY !== true || stdin.isTTY !== true || stdin.setRawMode === undefined) {
    fail(
      "'orchestrator tui' needs a terminal: it takes the screen and reads single keys, and neither works through a pipe. For a dumb terminal, a tmux pane or 'tee' — 'orchestrator status --watch', which draws the same frame and takes nothing",
      2,
    );
    return;
  }
  // ONE resolution of the config for the whole session, as in `--watch`: the observer
  // does not touch the network again, whatever happens to the ref while it is up.
  freezeConfig();
  const seconds = positiveInt(argv, "--interval", 2);

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    stdin.setRawMode?.(false);
    process.stdout.write(`${PASTE_OFF}${SHOW_CURSOR}${ALT_SCREEN_OFF}`);
  };
  process.on("exit", restore);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

  let state = initialTuiState;
  let frame: OperatorFrame | undefined;
  let trouble: string | undefined;
  /** The last command run from here, with its outcome — cleared by the next keystroke. */
  let echo: string | undefined;
  let transcript: string[] = [];
  let openFile: string | undefined;
  let offset = 0;

  const collect = (): void => {
    collectingFrame = true;
    try {
      frame = operatorFrame(argv);
      trouble = undefined;
    } catch (error) {
      // The observer dies of `q` and of nothing else — the same rule the watch lives by.
      trouble = (error as Error).message;
    } finally {
      collectingFrame = false;
    }
  };

  /** The tail of the selected pair's file, read FORWARD from where the last poll ended. */
  const readTranscript = (): void => {
    const view = frame?.leases[state.selected];
    const path =
      view?.sessionLog === undefined
        ? undefined
        : state.panel === "log"
          ? view.sessionLog
          : sessionSupervisorPath(view.sessionLog);
    if (path !== openFile) {
      openFile = path;
      transcript = [];
      offset = 0;
    }
    if (path === undefined || !existsSync(path)) return;
    const size = statSync(path).size;
    // A file that SHRANK is a different file (a new run under the same name, a rotation):
    // seeking past its end would show nothing for as long as the panel stayed open.
    if (size < offset) {
      transcript = [];
      offset = 0;
    }
    if (size === offset) return;
    const text = readFileSync(path, "utf8").slice(offset);
    offset = size;
    transcript = [...transcript, ...text.split("\n").filter((line) => line !== "")].slice(
      -TRANSCRIPT_LINES,
    );
  };

  const draw = (): void => {
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;
    if (frame === undefined) {
      const why = trouble ?? "the frame has not collected yet";
      process.stdout.write(`${HOME}${CLEAR_BELOW}frame: unavailable (${why})\n`);
      return;
    }
    readTranscript();
    const lines = renderTui({
      frame,
      state,
      rows: rows - 1,
      cols,
      transcript,
      ...(state.overlay ? { overlayLines: renderLog(journalEventsFor(argv)).split("\n") } : {}),
    });
    const foot = trouble === undefined ? "" : `  ⚠ last collection failed: ${trouble}`;
    // THE STATUS LINE IS THE ONE PLACE T-2 SPEAKS FROM: the keys while nothing has been
    // said, and otherwise the last thing that happened — a confirmation prompt, a refused
    // key, or the command that was run with its outcome. The keys come back on the next
    // keystroke, so the echo cannot be missed by a redraw a second later.
    const said = state.notice ?? echo;
    const status =
      said ?? "↑↓ pair · tab log/supervisor · l history · r now · h park · s stop · u up · q quit";
    process.stdout.write(
      // One write, so a half-drawn screen is never on display; every line clears its own
      // tail, exactly as the watch does.
      `${HIDE_CURSOR}${HOME}${lines.map((line) => `${line}${CLEAR_LINE}`).join("\n")}\n${status}${foot}${CLEAR_LINE}${CLEAR_BELOW}`,
    );
  };

  /**
   * THE MUTATING KEYS RUN THE COMMAND, THEY DO NOT REIMPLEMENT IT (T-2). The action is
   * spawned as a CHILD of this very CLI — `process.execPath` + `process.argv[1]`, the
   * same derivation `up` uses for the daemon — for three reasons, in order of weight:
   *
   *  1. the doors stay where they are. `hold` checks the signature against the config,
   *     `up` refuses over a force flag, `down` writes the stop flag: an in-process call
   *     would have to reproduce every one of those refusals or silently skip them;
   *  2. `fail()` exits the process. Called from inside the observer it would take the
   *     terminal down with it, in raw mode, on a typo in a role name;
   *  3. what is echoed is what ran. The status line shows a command the operator can
   *     retype into the next shell, character for character.
   *
   * stdout and stderr are CAPTURED rather than inherited — the alt-screen belongs to the
   * frame, and a child writing into it would leave the screen looking corrupted until
   * the next redraw. The first line of what it said becomes the outcome in the echo.
   */
  const perform = (action: TuiAction): void => {
    // ONE ARRAY BECOMES BOTH: the argv of the child and the line the operator reads. Built
    // apart, the echo lost every inherited flag — the observer pointed at a holds
    // directory of its own ran `hold --holds …` and printed `hold` (found in review).
    const { words, typed } = invocationOf(action, argv);
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, process.argv[1] as string, ...words],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const said = `${child.stdout ?? ""}${child.stderr ?? ""}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const outcome =
      child.error !== undefined
        ? `could not be run: ${child.error.message}`
        : child.status === 0
          ? (said[said.length - 1] ?? "done")
          : `REFUSED (exit ${child.status ?? "?"}): ${said[said.length - 1] ?? "it said nothing"}`;
    echo = `${typed} → ${outcome}`;
    // The frame is collected immediately rather than at the next interval: the operator
    // pressed a key and is looking at the screen for its consequence right now.
    collect();
  };

  let pasting = false;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(`${ALT_SCREEN_ON}${PASTE_ON}${HIDE_CURSOR}`);
  stdin.on("data", (chunk: string) => {
    const decoded = decodeTuiInput(chunk, pasting);
    pasting = decoded.pasting;
    for (const key of decoded.keys) {
      // A keystroke wipes the last echo: it belongs to the key that produced it, and an
      // outcome left standing under an unrelated key reads as that key's answer.
      echo = undefined;
      const step = reduceTui(
        state,
        key,
        frame === undefined ? { pairs: [], daemonAlive: false } : subjectOf(frame),
      );
      state = step.state;
      if (step.effect === "quit") {
        restore();
        process.exit(0);
      }
      if (step.effect === "collect") collect();
      if (step.effect === "act" && step.action !== undefined) perform(step.action);
    }
    draw();
  });
  process.stdout.on("resize", draw);

  const tick = (): void => {
    collect();
    draw();
    setTimeout(tick, seconds * 1000);
  };
  tick();
};

/** The journal the `l` overlay shows — read on demand, never held between frames. */
const journalEventsFor = (argv: readonly string[]): readonly OrchestratorEvent[] => {
  const journal = flag(argv, "--journal") ?? pathsFrom(argv).journal;
  return existsSync(journal) ? parseJournal(readFile(journal, "orchestrator journal")) : [];
};

const orchestratorStatus = (rawArgv: readonly string[]): void => {
  // `status` JOINS THE OPERATOR'S SHORT FORMS (thread 019): it is read between `up` and
  // `down`, by the same person in the same minute, and being the one of the three that
  // demanded `--ref` made it the one they got wrong — john walked into it on 2026-07-27.
  // Same bootstrap, same printed line: the working tree says which history governs.
  const argv = withOperatorRef(rawArgv);
  // `--watch` is THE SAME FRAME, repeated (T-0): not a second command with a view of
  // its own, which is how the two would start to differ.
  if (argv.includes("--watch")) {
    watchFrame(argv);
    return;
  }
  const paths = pathsFrom(argv);
  out(renderFrame(operatorFrame(argv)));
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

  // R14/R15: THE EFFECTIVE MERGE of the two configs, per role, with the layer each
  // value came from. `launch permissions` above answers "what may it do"; this
  // answers "what would actually be started, and who said so" — and that question
  // spans two files that never mention each other, so nowhere but here can it be
  // read off in one place.
  const local = localFrom(argv);
  out(`machine config: ${describeLocalConfig(local)}`);
  const roles = launchableRoles(argv);
  // R13: WHICH ROLES THIS BOX RAISES — the answer spans the two configs as well, and it
  // is the first thing to look at when a role is not raised and nobody says why.
  const statusScope = launchScopeFrom(argv, local, roles, false);
  out(describeScope(statusScope));
  for (const exclusion of statusScope.excluded) out(`  ${describeExclusion(exclusion)}`);
  // R13, second half — WHAT THE OTHER BOXES ARE DOING — is a LIVE fact and moved into
  // the frame above (`renderInstances` inside `renderFrame`), together with the age of
  // the checkout the digests were read from.
  // R23-1 — THE ROLES NOBODY RAISES BECAUSE SOMEBODY ALREADY HOSTS THEM — moved into the
  // frame as well (T-1, thread 019): it used to be printed HERE, after `renderFrame`, so
  // the observer that draws the frame would not have shown it at all. The one visible
  // consequence, named in the statement of work before the code: the resident section
  // now stands one position higher in the output of `status`, beside the queue.
  out("launch resolution:");
  for (const role of roles) {
    out(`  ${role.id}: ${describeAgent(agentFor(argv, local, role))}`);
  }

  // R17: WHERE EACH ROLE WORKS. It belongs beside the launch resolution for the same
  // reason: it is a fact about the run that lives in no single file — the project
  // names the directory, git owns its state, and the base is whatever `origin` says
  // right now. `status` shows the state; it moves nothing.
  const repo = flag(argv, "--repo") ?? homeOf(process.cwd());
  const workdirSection = configFrom(argv, undefined).config.orchestrator?.workdir;
  if (workdirSection?.worktrees === undefined) {
    out(`workspaces: not declared (orchestrator.workdir.worktrees) — the sessions inherit ${repo}`);
  } else {
    const base = baseCommitOf(repo, workdirSection.branch);
    out(`workspaces (base ${base.ref} ${base.commit.slice(0, 8)}):`);
    for (const role of roles) {
      const path = workspacePath({ repo, worktrees: workdirSection.worktrees, role: role.id });
      const facts = workspaceFacts(path);
      const verdict = workspaceVerdict({
        role: role.id,
        path,
        facts,
        base: base.commit,
        baseRef: base.ref,
      });
      out(`  ${role.id}: ${verdict.detail}`);
    }
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
 * `orchestrator systemd install` — THE UNIT, GENERATED FROM THIS BOX (thread 019,
 * statement of 2026-07-31 09:43Z). Why user-level, why the restart policy does not
 * fight the flags and why the file is generated rather than typed: `orchestrator/systemd.ts`.
 *
 * WHAT IT DOES NOT DO: `systemctl --user enable --now` and `loginctl enable-linger`.
 * That line is old and it is deliberate (`reboot.ts`): a daemon that makes itself
 * permanent is exactly the surprise the enable gate exists to prevent, and "the box
 * raises agents by itself from now on" is a decision with a human's name on it. The
 * command prints the three commands in order; typing them is the decision.
 */
const orchestratorSystemdInstall = (argv: readonly string[]): void => {
  // The ref of the daemon's own argv comes from the working tree, like the operator's
  // five — a unit is written once and must not carry a ref somebody typed by hand.
  const args = withOperatorRef(argv);
  const repo = flag(args, "--repo") ?? homeOf(process.cwd());
  const typed = flag(args, "--daemon-args");
  const daemonArgs =
    typed === undefined
      ? ["--ref", flag(args, "--ref") as string]
      : typed.split(/\s+/).filter((token) => token !== "");
  const unitName = flag(args, "--unit-name");
  const unitDir = flag(args, "--unit-dir");
  const description = flag(args, "--description");
  const user = process.env.USER;
  const plan = planSystemdUnit({
    repo,
    node: process.execPath,
    cli: process.argv[1] as string,
    daemonArgs,
    ...(unitName === undefined ? {} : { unitName }),
    ...(unitDir === undefined ? {} : { unitDir }),
    ...(description === undefined ? {} : { description }),
    ...(user === undefined ? {} : { user }),
  });
  if (!args.includes("--write")) {
    out(`agent-protocol: would write ${plan.path}`);
    out(plan.unit);
    out("agent-protocol: --write puts it there; then, by hand:");
    for (const step of plan.steps) out(`  ${step}`);
    return;
  }
  const existed = existsSync(plan.path);
  mkdirSync(dirname(plan.path), { recursive: true });
  writeFileSync(plan.path, plan.unit, "utf8");
  out(`agent-protocol: ${existed ? "replaced" : "wrote"} ${plan.path}`);
  out("agent-protocol: the rest is yours to type — none of it happens by itself:");
  for (const step of plan.steps) out(`  ${step}`);
  out(
    "agent-protocol: the unit runs 'up --foreground' — launches are still gated by the enable flag, and a stop/force flag still keeps the circuit down (the daemon exits cleanly, so 'Restart=on-failure' does not re-raise it)",
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

/**
 * A numeric flag that DISTINGUISHES "not given" from a value (R12) — the fallback
 * form above cannot: it folds absence into the default, and the resolution of the
 * ceilings has to know whether the operator said anything at all, because a role's
 * `launch.limits` sits between the flag and the default.
 */
const flagInt = (
  argv: readonly string[],
  name: string,
  options?: { readonly allowZero?: boolean },
): number | undefined => {
  if (flag(argv, name) === undefined) return undefined;
  return options?.allowZero === true ? nonNegativeInt(argv, name, 0) : positiveInt(argv, name, 1);
};

/**
 * The ceilings of a run: the flag, then the role's `launch.limits`, then the package
 * default (R12, plus the wait ceiling of R19 and the landing margin of R20). Resolved
 * in ONE place for both callers — the manual `run` and the daemon, which resolves per
 * role inside its loop.
 */
const ceilingsFrom = (argv: readonly string[], role: Role): ResolvedCeilings => {
  const flags: {
    idleSeconds?: number;
    wallClockSeconds?: number;
    maxTurns?: number;
    waitInputSeconds?: number;
    windDownSeconds?: number;
  } = {};
  const idle = flagInt(argv, "--idle", { allowZero: true });
  const wallClock = flagInt(argv, "--wall-clock");
  const maxTurns = flagInt(argv, "--max-turns");
  const waitInput = flagInt(argv, "--wait-input");
  const windDown = flagInt(argv, "--wind-down");
  if (idle !== undefined) flags.idleSeconds = idle;
  if (wallClock !== undefined) flags.wallClockSeconds = wallClock;
  if (maxTurns !== undefined) flags.maxTurns = maxTurns;
  if (waitInput !== undefined) flags.waitInputSeconds = waitInput;
  if (windDown !== undefined) flags.windDownSeconds = windDown;
  return resolveCeilings({
    flags,
    ...(role.launch?.limits === undefined ? {} : { limits: role.launch.limits }),
  });
};

/**
 * The two LAUNCH gates — the per-pair attempt ceiling and the global run budget
 * (`--max-attempts`, `--max-runs`). Read in one place for the same reason the run
 * ceilings are: `status`, `run` and the daemon must judge a pair by the same number,
 * or `status` would call `exhausted` what the daemon happily raises.
 */
const gatesFrom = (argv: readonly string[]): ResolvedGates => {
  const flags: { maxAttempts?: number; maxRuns?: number } = {};
  const maxAttempts = flagInt(argv, "--max-attempts");
  const maxRuns = flagInt(argv, "--max-runs");
  if (maxAttempts !== undefined) flags.maxAttempts = maxAttempts;
  if (maxRuns !== undefined) flags.maxRuns = maxRuns;
  return resolveGates({ flags });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const appendEvent = (journalPath: string, event: OrchestratorEvent): void => {
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${renderEventLine(event)}\n`, "utf8");
};

/**
 * PLAN a message file for a thread (the same path as `new-message`, but as a
 * subroutine — the force stop needs it for a trace IN THE THREAD).
 *
 * It PLANS rather than writes, because the caller hands it to `deliverMessage` as the
 * `stage` callback: the stamp, and therefore the file name, depend on what is already
 * in the feed, so every delivery attempt has to plan afresh on top of the state it
 * just fetched.
 */
const planThreadMessage = (
  root: string,
  threadId: string,
  registry: RoleRegistry,
  input: { from: string; expects: Expects; waitingOn?: string | null; text: string },
): StagedMessage => {
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
    if (error instanceof WriteRefusedError) return fail(error.message, 2);
    throw error;
  }
  const path = join(threadDir, planned.path);
  if (existsSync(path))
    fail(`file '${planned.path}' already exists — two writes within one second?`, 2);
  return { files: [{ path, content: planned.content }], label: planned.path };
};

type RunParams = {
  readonly journalPath: string;
  readonly mailRoot: string;
  readonly roleId: string;
  readonly thread: string;
  /**
   * The prompt, built FROM THE DEADLINE (R20) rather than handed over ready-made: the
   * deadline is materialised by `planLaunch` inside this function, and the session is
   * told it in words. Passing the text in would have meant computing the same moment a
   * second time at the call site — two formulas for one number, drifting apart at the
   * first change of the window.
   */
  readonly prompt: (context: { readonly deadline: string }) => string;
  readonly exec: string;
  readonly maxTurns: string;
  readonly wallClockMs: number;
  readonly pollMs: number;
  /** The idle ceiling: no traces of activity for this long → `stalled` (R6). 0 — off. */
  readonly idleMs: number;
  /** The ceiling of a DECLARED WAIT for input (R19) — its own clock, its own refusal. */
  readonly waitInputMs: number;
  /**
   * The landing margin (R20): this long before the deadline the session was asked to
   * stop digging and land. Nothing fires here — the supervisor only says out loud that
   * the point has passed, so that a `timeout` afterwards can be read for what it is.
   */
  readonly windDownMs: number;
  /**
   * THE TREE THE SESSION WORKS IN — its `cwd` and the tree whose traces are watched,
   * one field because they must be the same tree: watching one directory for signs of
   * life while the session edits another is how a working run reads as stalled. Since
   * R17 it is the role's own worktree; without workspaces declared it is the checkout
   * the supervisor was started from, as before.
   */
  readonly workdir: string;
  /**
   * THE SAME DIRECTORY, WHEN IT IS A WORKSPACE THE ORCHESTRATOR HANDED OUT (R17) —
   * absent in the pre-R17 mode, where `workdir` is the checkout the supervisor was
   * started in. Two fields for one path because the release asks a question only the
   * second one may be asked: whether the run left the tree dirty is a judgement about a
   * tree the circuit owns, and the operator's own checkout is not that tree (they keep
   * working in it while a session runs).
   */
  readonly workspace?: string;
  readonly ids: readonly string[];
  readonly now: Date;
  readonly maxConsecutive: number;
  /** The per-pair attempt ceiling — resolved with its source by `gatesFrom` (R12). */
  readonly maxAttempts: number;
  /** The force-stop flag file (S4). Present — we put the session down at a safe point. */
  readonly forceFlag?: string;
  /** The permission profile of the role being raised — part of the launch contract (S7). */
  readonly launch: Launch;
  /** The zone deny rules of the role (thread 020) — the tool refuses the edit at the moment it happens. */
  readonly denyRules: readonly string[];
  /** Where to save the session output: silence can be examined without a witness. */
  readonly sessionLog: string;
  /** The raw stream beside it (`.jsonl`) — the primary source a rendering cannot replace. */
  readonly sessionStream: string;
  /** Where the session reads its own id (R7): written when the init line arrives. */
  readonly sessionIdFile: string;
  /** Where the session DECLARES a wait for input (R19) — written by `new-message --await-input`. */
  readonly waitFlag: string;
  /** The child process environment: the inherited one + the project preamble (S8). */
  readonly env: NodeJS.ProcessEnv;
  /** What is being raised, as the session will record it in its messages (R7). */
  readonly worker: string;
  /** The tool's own launch parameters — model, effort (R15). Empty means "the tool's defaults". */
  readonly params: AgentParams;
  /** How this run was decided (R18) — it carries the world onto the `launch` event. */
  readonly continuation: Continuation;
  readonly world?: World;
  /**
   * THE LEASE OF THIS RUN JUST CHANGED — the hook the instance digest hangs on (R13,
   * thread `025-stale-instance-digest`).
   *
   * It exists because a run is the ONLY part of a tick that outlives the tick's own
   * timeline: the caller is blocked here for the whole session, so anything the caller
   * publishes about itself either happens before the lease is taken or after it is
   * released — never while it is held. Without this hook the digest of a busy box was
   * `leases: []` for four hours across six sessions, which is the one thing the file
   * exists not to say.
   *
   * It is called AFTER the journal is written, never before: the digest is a fold of the
   * journal, so a hook that fired first would publish the state the run is leaving.
   * Failures are the callee's business — the run does not depend on being announced.
   */
  readonly onLeaseChange?: () => void;
  /**
   * WHAT TO STAMP ON EVERY RELAYED LINE OF THE SESSION'S OWN STREAM (D-2, thread
   * `023-daemon-parallelism`).
   *
   * The supervisor relays the session's words to its own stdout, and under a daemon with
   * N live supervisors those relays interleave in one terminal. An unattributed line is
   * then worse than no line: "the session exited, code 1" invites the operator to blame
   * whichever role they were reading about a moment earlier.
   *
   * OPTIONAL, and it is not the same decision as the daemon's own lines. `orchestrator
   * run` raises ONE pair and the operator typed which one — a prefix on every line there
   * is noise stamped on the only conversation in the room. It is the FILE that has to be
   * unambiguous unconditionally, and it already is: each run has its own log.
   */
  readonly streamPrefix?: string;
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
    maxAttempts: p.maxAttempts,
    // The gate of a single run judges by the SAME mail the daemon's tick does
    // (thread 023): a pair that delivered into its own turn is not exhausted, and a
    // `run` that refused where the daemon would have raised is the drift itself.
    deliveredSessions: sessionsThatWrote(
      loadThreads(p.mailRoot, p.ids).threads.map((loaded) => loaded.thread),
    ),
    continuation: p.continuation,
    ...(p.world === undefined ? {} : { world: p.world }),
  });
  if (!plan.ok) {
    err(`agent-protocol: the launch of ${p.roleId}/${p.thread} was refused (${plan.reason})`);
    // The workspace was locked before the launch was planned (a ceiling can only be
    // read after the journal is), so a refusal here releases it. In the daemon this
    // matters most: it ticks on, and a lock left by one refused tick would take the
    // role out of the circuit until somebody noticed.
    releaseWorkspaceLock(p.workdir);
    return "skip";
  }

  // THE DEATH OF THE OBSERVER ITSELF ALSO LEAVES A TRACE. The 2026-07-25
  // acceptance: the daemon returned control right after the spawn, the session was
  // left an orphan and finished the job — while the lease stayed `running`
  // forever, that is, the journal started lying "it is working" about something
  // long done. A lease with nobody left to close it is the worst outcome of all:
  // from the outside it is indistinguishable from normal work.
  //
  // What is covered: a normal exit, an unhandled exception, SIGINT, SIGTERM and
  // SIGHUP. SIGKILL cannot be intercepted, and we do not promise that.
  //
  // SIGHUP is here since R12 and it is not decoration: an attached run whose
  // terminal is closed gets exactly that signal, and its DEFAULT action ends the
  // process without running a single exit handler — the lease would stay `running`
  // for ever. That is the S9 failure reachable by shutting a laptop lid.
  //
  // THE GUARDS ARE INSTALLED BEFORE THE LEASE IS WRITTEN, not after (found by the
  // runner on R12: a SIGTERM that landed in the stretch between the journal write
  // and the spawn left the journal at `launch` with no release — the very state
  // this handler exists to prevent). Two consequences are deliberate:
  //  - `leased` — before the lease events are on disk there is nothing to close,
  //    and a release without an acquisition would be a worse lie than silence;
  //  - `childRef` — the handler may fire before the process exists (the directory,
  //    the two sinks and the spawn itself are all IO), so it must not assume one.
  let settled = false;
  let leased = false;
  let exited = false;
  let childRef: ReturnType<typeof spawn> | undefined;
  // WHAT A BROKEN RUN LEAVES FOR THE NEXT DECISION (R18): the id of the session and
  // how much of it was burned. They are declared here, ahead of the guard, because
  // the supervisor's own death is one of the two breaks a resume is allowed to follow
  // — and a release written by the guard that omitted them would be a break nobody
  // can continue.
  let sessionId: string | undefined;
  let steps = 0;
  // WHAT THE RUN BURNED (thread 029) — latched off the same stream, for the same reason
  // `steps` is: the supervisor reads every line anyway, and this is the only moment the
  // numbers exist anywhere but inside a 200-MB transcript. Both stay `undefined` for a run
  // that broke off, and that is the honest answer rather than a gap to be filled in.
  let runModel: string | undefined;
  let runUsage: RunUsage | undefined;

  const recordSupervisorGone = (): void => {
    if (settled || !leased) return;
    settled = true;
    // WE PUT THE GROUP DOWN BEFORE WRITING — as in the two other release sites.
    // Otherwise the "lease released" record goes into the journal while the
    // orphaned session is still writing: `supervisor-gone` is an unsuccessful
    // terminal state, the pair immediately becomes `launchable`, and the next tick
    // (or a daemon raised by systemd seconds later) would start a SECOND session on
    // the same thread on top of the live first one. This is exactly the class the
    // whole package is built for (reviewer-pr's finding on PR #9).
    if (!exited && childRef?.pid !== undefined) {
      try {
        process.kill(-childRef.pid, "SIGTERM");
      } catch {
        // the group is already gone — fine
      }
    }
    // THE WRITE IS NOT HOSTAGE TO A GIT CALL (red main of 2026-07-28, CI 30374788681,
    // thread 032). The kill above is a syscall and cannot stall; the unlock is `git
    // worktree unlock`, an unbounded `execFileSync` — and it used to run BEFORE this
    // write. A git that hangs on a loaded runner therefore cost the release itself:
    // the journal stayed at `launch` and the lease read `running` for ever, which is
    // the S9 lie this whole guard exists to prevent. Reversed, a hung unlock costs a
    // STALE LOCK instead — the direction the module already calls the honest one
    // (`workspaceLocks`: a SIGKILL leaves one, `status` names it, a human clears it
    // with one command). The kill keeps its place ahead of both: releasing the pair
    // while an orphaned session still writes is the failure of PR #9.
    appendEvent(p.journalPath, {
      kind: "lease-released",
      ts: eventTimestamp(new Date()),
      role: p.roleId,
      thread: p.thread,
      reason: "supervisor-gone",
      output: p.sessionLog,
      ...(sessionId === undefined ? {} : { session: sessionId }),
      steps,
    });
    releaseWorkspaceLock(p.workdir);
  };
  process.on("exit", recordSupervisorGone);
  const onSignal = (signal: NodeJS.Signals) => (): void => {
    // THE ARRIVAL IS ANNOUNCED BEFORE THE WORK, and the outcome after it — two lines,
    // because one line printed after the fact could not tell the two candidates of
    // thread 032 apart. When that run failed, the supervisor's captured output held no
    // word at all, and that silence read equally as "the signal never reached node
    // under the `tsx` wrapper" and as "the guard entered and never came back". From
    // here on the first line alone answers that question, before anything that can
    // block has been touched.
    err(`agent-protocol: the observer received ${signal}`);
    recordSupervisorGone();
    err(`agent-protocol: the lease was closed as supervisor-gone (${signal})`);
    process.exit(1);
  };
  const handlers: readonly [NodeJS.Signals, () => void][] = (
    ["SIGINT", "SIGTERM", "SIGHUP"] as const
  ).map((signal) => [signal, onSignal(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const releaseGuards = (): void => {
    settled = true;
    process.off("exit", recordSupervisorGone);
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };

  // WRITING BEFORE THE SPAWN (curator's requirement 2): should the process die at
  // startup, from the outside it reads as "an attempt happened and broke off"
  // rather than "nothing was going on". `leased` is raised from the FIRST event on
  // — a signal landing between the two writes must still leave a release, not an
  // acquisition with no end.
  for (const event of plan.events) {
    appendEvent(p.journalPath, event);
    leased = true;
  }
  // THE ACQUISITION IS ANNOUNCED BEFORE THE SPAWN, for the same reason it is written
  // before the spawn: from here on the box IS busy, and everything below this line can
  // take an hour. A digest published after the spawn would be one whole session late.
  p.onLeaseChange?.();

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
    buildLaunchArgv({
      prompt: p.prompt({ deadline: plan.deadline }),
      maxTurns: p.maxTurns,
      launch: p.launch,
      params: p.params,
      denyRules: p.denyRules,
      ...(p.continuation.mode === "resume" ? { resume: p.continuation.session } : {}),
    }),
    {
      // THE SESSION LANDS IN THE ROLE'S OWN TREE (R17) and not in whatever directory
      // the supervisor happened to be started from. It is also what makes a resume
      // findable: the tool keeps its conversations per working directory, so a stable
      // workspace per role is the precondition of `--resume` ever finding anything.
      cwd: p.workdir,
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
        // The ceiling of its own wait (R19): the session defaults `await-input` to this
        // number, so its clock and the supervisor's cannot disagree.
        [LAUNCH_ENV.waitSeconds]: String(Math.round(p.waitInputMs / 1000)),
        // WHEN THIS RUN'S WINDOW ENDS (R20). The same value the prompt states in words
        // — this one is here for the shell: a session checking how much is left runs
        // `date`, not a re-read of its own prompt.
        [LAUNCH_ENV.leaseDeadline]: plan.deadline,
      },
    },
  );
  // From here the guard has a group to put down together with the lease.
  childRef = child;

  // A chunk boundary falls in the middle of a JSON line far more often than it
  // looks, so the tail is carried over rather than rendered as it is.
  let pending = "";
  /** The quota signal, once seen (finding C) — the latch the poll loop reads. */
  let quota: QuotaSignal | undefined;
  // THE SESSION LEARNS ITS OWN ID (R7) — from the init line of its own stream, which
  // the supervisor is reading anyway, written into the file whose path the session
  // was given in its environment. Once: the id does not change mid-run, and a
  // rewrite would only add a window in which the file is empty while somebody reads
  // it. A failure to write is NOT fatal — the run goes on and its messages simply
  // carry no session; losing a run over a provenance field would be the wrong trade.
  const rememberSessionId = (line: string): void => {
    if (sessionId !== undefined) return;
    const id = sessionIdOf(line);
    if (id === undefined) return;
    sessionId = id;
    try {
      writeFileSync(p.sessionIdFile, id, "utf8");
      writeLog(`supervisor  session ${id} → ${p.sessionIdFile}`);
    } catch (error) {
      writeLog(`supervisor  could not write the session id: ${(error as Error).message}`);
    }
  };
  // THE WINDOW RAN OUT (finding C, thread 023). Recognised where the streams are
  // already being read line by line, and LATCHED rather than acted on here: these
  // handlers run on an IO event, while every lease decision belongs to the poll loop
  // below, which is the one place that knows the lifecycle. The first signal wins — a
  // session that repeats the message is still the same closed window.
  //
  // BOTH STREAMS GO THROUGH IT, and stderr is not a belt-and-braces addition: the
  // refusal that arrives BEFORE a session exists is the launcher's own complaint, and
  // the launcher complains on stderr (see the note on that handler). A refusal missed
  // there comes back as `exited-without-handoff` — the very misattribution this
  // finding exists to close, and the most likely one now that D-2 raises N sessions
  // into one shared window.
  const noteQuota = (line: string): void => {
    if (quota !== undefined) return;
    const signal = quotaSignalOf(line);
    if (signal === undefined) return;
    quota = signal;
    writeLog(`supervisor  ${describeQuotaRelease(signal)}`);
  };
  // WHAT THE RUN BURNED (thread 029) — latched off the same lines, and WRAPPED, which is
  // the whole of curator's first acceptance condition (msg-004). Telemetry has no right to
  // touch the fact that the lease is released: "every outcome leaves a trace" is the
  // journal's load-bearing invariant, so a collector that threw here — on a stream shape the
  // vendor changed, on a number that is suddenly a string — would eat the break event it
  // exists to price. It fails OPEN: the line is written WITHOUT the block, never not written.
  const noteUsage = (line: string): void => {
    try {
      if (runModel === undefined) runModel = modelOf(line);
      // The ledger arrives once, on the `result` event. First one wins, like the id.
      if (runUsage === undefined) runUsage = runUsageOf(line);
    } catch (error) {
      writeLog(`supervisor  could not read the run's usage: ${(error as Error).message}`);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    if (!sinksOpen) return;
    writeSync(rawSink, chunk);
    const split = splitStreamChunk(pending, chunk.toString("utf8"));
    pending = split.rest;
    for (const line of split.lines) {
      rememberSessionId(line);
      // How much of the run has been burned (R18) — counted as it happens, because a
      // run that breaks leaves no summary line at all, and those are the only runs
      // whose size the continuation policy ever has to judge.
      if (isAssistantStep(line)) steps += 1;
      noteUsage(line);
      // THE WINDOW RAN OUT (finding C, thread 023). Recognised where the stream is
      // already being read line by line, and LATCHED rather than acted on here: this
      // handler runs on an IO event, while every lease decision belongs to the poll
      // loop below, which is the one place that knows the lifecycle. The first signal
      // wins — a session that repeats the message is still the same closed window.
      noteQuota(line);
      for (const rendered of renderStreamLine(line)) {
        writeLog(rendered);
        out(p.streamPrefix === undefined ? rendered : `${p.streamPrefix} ${rendered}`);
      }
    }
  });
  // stderr keeps going into the readable log verbatim: a launcher's complaint ("the
  // binary is not found", a stack trace) is not stream format and must not be
  // rendered — it is the answer itself.
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim() === "") continue;
      writeLog(`stderr  ${line}`);
      noteQuota(line);
    }
  });

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

  // NOT `const`: an interactive turn (R19) moves it. The window belongs to the work,
  // and the time a run spends parked waiting for a human is added back on — the same
  // shift the journal fold computes from the two events, kept in step here because this
  // is the copy the live loop judges by.
  let deadlineMs = new Date(plan.deadline).getTime();
  let lifecycle: Lifecycle = "running";
  /** While parked: when the wait began and when it expires (R19). */
  let waitingSinceMs = 0;
  let waitUntilMs = 0;

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
      worktree: worktreeSignature(p.workdir),
      ...(cpuMs === undefined ? {} : { cpuMs }),
    };
  };
  let watch: IdleWatch = startWatch(sampleTrace(), Date.now());
  let quietMs = 0;
  // THE LANDING POINT, SAID ONCE (R20). The supervisor does nothing at it — there is no
  // gesture that makes a session commit — but a `timeout` half an hour later has to be
  // readable as "it was told, in this log, at this minute, and kept digging". Said once
  // per crossing rather than every poll, and re-armed when a park moves the deadline.
  let windDownAnnounced = false;

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
      releaseWorkspaceLock(p.workdir);
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
    // HAS THE SESSION DECLARED A WAIT FOR INPUT (R19)? A level signal, read every poll:
    // it both parks the run and, by going away, brings it back.
    const declared = ((): string | undefined => {
      try {
        return readFileSync(p.waitFlag, "utf8");
      } catch {
        // no declaration (or it disappeared between the two calls) — not a wait
        return undefined;
      }
    })();
    const declaration =
      declared === undefined ? undefined : waitAuthorised({ raw: declared, thread: p.thread });
    // A declaration that does not authorise THIS thread is not silently ignored: from
    // the session's side it looks like a wait, and a run closed as finished under it
    // would look like the flag did nothing.
    if (declaration?.ok === false && lifecycle === "running" && handedOff) {
      err(`agent-protocol: the declared wait is not honoured — ${declaration.why}`);
      writeLog(`supervisor  the declared wait is not honoured — ${declaration.why}`);
    }
    const awaitingInput = declaration?.ok === true;

    // The traces of activity: has the session produced ANYTHING since the last poll
    // (R6). Sampled every tick, judged against the ceiling — a session that has gone
    // quiet is `stalled`, not `timeout`.
    //
    // A PARKED RUN IS EXEMPT, and that is john's requirement (б) in one line: conscious
    // waiting is not a hang. The watch is RESTARTED rather than merely unjudged, so the
    // silence of an hour spent waiting does not carry over and declare the session
    // stalled in the first second after it gets back to work.
    const idle = idleStep({
      watch,
      trace: sampleTrace(),
      nowMs: Date.now(),
      idleMs: lifecycle === "waiting" ? 0 : p.idleMs,
    });
    watch = lifecycle === "waiting" ? startWatch(idle.watch.trace, Date.now()) : idle.watch;
    quietMs = idle.quietMs;

    // The landing point of THIS window (R20), recomputed every poll because a park
    // moves the deadline. Only a running session is told: a parked one is not spending
    // its window, and a draining one has already passed the turn.
    if (
      !windDownAnnounced &&
      lifecycle === "running" &&
      !exited &&
      Date.now() > deadlineMs - p.windDownMs &&
      Date.now() <= deadlineMs
    ) {
      windDownAnnounced = true;
      const line = `the wind-down point has passed — ${Math.round((deadlineMs - Date.now()) / 1000)}s of the window are left; the session was asked to land its work by ${eventTimestamp(new Date(deadlineMs))}`;
      out(`agent-protocol: ${p.roleId}/${p.thread}: ${line}`);
      writeLog(`supervisor  ${line}`);
    }

    const step = observeStep(lifecycle, {
      handedOff,
      processExited: exited,
      overdue: Date.now() > deadlineMs,
      // A process that has already exited is closed by its own branch: "it produced
      // nothing" is a statement about a LIVE session.
      idle: !exited && idle.stalled,
      awaitingInput,
      waitOverdue: lifecycle === "waiting" && Date.now() > waitUntilMs,
      quotaExhausted: quota !== undefined,
    });
    if (step === null) continue;

    const base = { ts: eventTimestamp(new Date()), role: p.roleId, thread: p.thread };
    if (step.record === "handoff-detected") {
      appendEvent(p.journalPath, stepEvent(step, base));
      lifecycle = "draining";
      p.onLeaseChange?.();
      out(`agent-protocol: the turn on ${p.thread} was passed — ${p.roleId} is draining`);
      continue;
    }

    // THE RUN IS PARKED (R19): the turn has passed, the session declared a wait and
    // stays alive. Nothing is killed, and the work deadline stops being the clock.
    if (step.record === "input-awaited") {
      waitingSinceMs = Date.now();
      waitUntilMs = waitingSinceMs + p.waitInputMs;
      const waitDeadline = eventTimestamp(new Date(waitUntilMs));
      appendEvent(p.journalPath, stepEvent(step, base, { waitDeadline }));
      lifecycle = "waiting";
      p.onLeaseChange?.();
      const line =
        declaration?.ok === true
          ? describeWait({ marker: declaration.marker, until: waitDeadline })
          : `awaiting input — the wait expires at ${waitDeadline}`;
      out(`agent-protocol: ${p.roleId}/${p.thread} is ${line}`);
      writeLog(`supervisor  ${line}`);
      continue;
    }

    // The wait is over — the declaration is gone. The work window gets back exactly the
    // time the wait took, so a run is not punished for a human's latency.
    if (step.record === "input-received") {
      const waitedMs = Math.max(0, Date.now() - waitingSinceMs);
      deadlineMs += waitedMs;
      // The window moved, so the landing point moved with it: a run that was announced
      // before its park is due a second announcement against the new deadline (R20).
      windDownAnnounced = false;
      appendEvent(p.journalPath, stepEvent(step, base));
      lifecycle = "running";
      p.onLeaseChange?.();
      waitingSinceMs = 0;
      waitUntilMs = 0;
      const line = `the wait ended after ${Math.round(waitedMs / 1000)}s — back to work, the deadline moves to ${eventTimestamp(new Date(deadlineMs))}`;
      out(`agent-protocol: ${p.roleId}/${p.thread}: ${line}`);
      writeLog(`supervisor  ${line}`);
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
    // WHAT THIS RUN LEAVES BEHIND ON DISK, ASKED BEFORE THE LEASE IS LET GO (thread 023,
    // requirement 5, second half). Read HERE and not at the next launch, because this is
    // the only moment at which the answer can still be attributed to the run that made
    // it: the first half of the requirement decides what to DO with such a tree, this
    // half makes sure the release itself says who left it.
    //
    // AFTER the group was put down, so the tree is the one the session finished with, and
    // only for a workspace the orchestrator handed out — the operator's own checkout is
    // never judged (see `workspace` on `RunParams`).
    const leftDirty =
      p.workspace !== undefined &&
      dirtLeftByFinish({ reason: step.reason, dirty: workspaceFacts(p.workspace).dirty === true });
    releaseWorkspaceLock(p.workdir);
    appendEvent(
      p.journalPath,
      stepEvent(step, base, {
        exitCode,
        output: p.sessionLog,
        session: sessionId,
        steps,
        ...(quota?.resetsAt === undefined ? {} : { until: quota.resetsAt }),
        // WHICH window closed rides through to the journal (D-3 part 2) — the backoff has
        // a shelf per window type, and this is the only place the type is known.
        ...(quota?.window === undefined ? {} : { window: quota.window }),
        ...(leftDirty ? { dirty: true as const } : {}),
        // WHAT THE RUN BURNED rides to the journal (thread 029) — the last moment the
        // numbers are in hand without re-parsing the transcript. Omitted entirely when the
        // run left no ledger AND no model: an empty object would claim a measurement
        // nobody made.
        ...(runUsage === undefined && runModel === undefined
          ? {}
          : { usage: { ...(runModel === undefined ? {} : { model: runModel }), ...runUsage } }),
      }),
    );
    // THE RELEASE IS ANNOUNCED HERE TOO, although the daemon publishes at the end of its
    // tick anyway: the hook is "every change of this lease", not "every change the caller
    // does not already cover". A hook with one hole in it is a hole somebody has to
    // remember, and the second publication costs nothing — `digestChanged` makes the
    // tick's own call a no-op against a state already on the branch.
    //
    // The ONE release that is deliberately NOT announced is `recordSupervisorGone`: it
    // runs from a process-exit handler, and a git push started there has no time to
    // finish. That box's digest stays at its last known state, which is exactly what a
    // reader's staleness judgement is for.
    p.onLeaseChange?.();
    if (spawnError !== undefined) {
      err(`agent-protocol: the spawn of '${p.exec}' failed: ${spawnError.message}`);
    }
    // A run that did not pass the turn MUST show where to look: five minutes of
    // silence must not look like work.
    //
    // THE TWO ENDINGS OF A PARK ARE REPORTED DIFFERENTLY (R19), because the turn DID
    // pass in both: the thread holds a question and waits on somebody else. Saying "the
    // turn was not passed" there would send whoever reads the line looking for a
    // message that is in fact already written.
    if (step.reason === "input-timeout" || step.reason === "exited-while-waiting") {
      const what =
        step.reason === "input-timeout"
          ? "nobody answered within the wait ceiling"
          : "the session died while it was parked";
      writeLog(`supervisor  the lease was released: ${step.reason} (${what})`);
      err(
        `agent-protocol: the run stopped in the middle of its task — ${what} (${step.reason}). Its question is in ${p.thread}; session output: ${p.sessionLog}`,
      );
    } else if (step.reason === "quota-exhausted") {
      // ITS OWN SENTENCE, not the generic "the turn was not passed" (finding C): that
      // line sends the reader looking for a session at fault, and there is none — the
      // window closed. What the reader needs instead is when it reopens and the fact
      // that the pair is not moving towards `exhausted`.
      const line = describeQuotaRelease(quota as QuotaSignal);
      writeLog(`supervisor  the lease was released: quota-exhausted — ${line}`);
      err(
        `agent-protocol: the run was cut off by the QUOTA, not by a fault of its own — ${line} Session output: ${p.sessionLog}`,
      );
    } else if (step.reason !== "completed") {
      const quiet = step.reason === "stalled" ? ` (${describeQuiet(quietMs)})` : "";
      // A TIMEOUT IS NO LONGER A ROUTINE ENDING (R20): the session was told its deadline
      // and given a margin to land in, so being cut off means it did not use them. The
      // line says which of the two happened, because they call for different reading —
      // one is a session to look at, the other a window to widen.
      const why =
        step.reason === "timeout"
          ? " — the session did NOT wind down: it was given its deadline and a landing margin and kept working past both"
          : "";
      writeLog(`supervisor  the lease was released: ${step.reason}${quiet}${why}`);
      err(
        `agent-protocol: the turn was not passed (${step.reason}${quiet})${why} — session output: ${p.sessionLog}`,
      );
    }
    // THE DIRT IS SAID OUT LOUD IN THE SAME BREATH AS THE RELEASE, whatever the reason
    // was — including `completed`, which is the case the requirement was written for: a
    // package that "finished" and left a tree behind used to be a success on every
    // channel, and the failure surfaced as the NEXT package silently skipping. On stderr
    // for whoever is watching, and in the session log for whoever reads it afterwards.
    if (leftDirty) {
      const line = describeFinishDirt({
        reason: step.reason,
        path: p.workspace as string,
      });
      writeLog(`supervisor  ${line}`);
      err(`agent-protocol: ${p.roleId}/${p.thread}: ${line}`);
    }
    closeSinks();
    return step.reason;
  }
};

/**
 * DETACHING A RUN (R12, john's requirement: attached by default, `-d` to send it to
 * the background).
 *
 * Attached is the default because that is what raising ONE agent by hand is for —
 * you watch it. The background mode is a flag rather than a shell trick for a
 * reason that is not convenience: `run … &` leaves the supervisor attached to the
 * terminal, so closing that terminal delivers SIGHUP, whose default action ends the
 * process WITHOUT running its exit handlers — the lease stays `running` forever and
 * the journal starts lying "it is working" about something long dead. That is the
 * exact failure S9 was written for, reachable through the one gesture an operator
 * would reach for on their own.
 *
 * So detaching is done properly: the child gets its OWN session (`detached`), no
 * controlling terminal to be hung up on, and its output goes to a file beside the
 * session log. `unref` is what lets us exit while it lives on.
 *
 * The parent runs PREFLIGHT FIRST and only then detaches: a refusal has to land on
 * the terminal of whoever typed the command. A backgrounded run that dies of a
 * stale mail checkout, printing into a file nobody has been told to read, is the
 * quiet defect this package exists against. The child repeats the preflight — it is
 * the one whose verdict binds, and the second fetch is a fast-forward of what the
 * first one already pulled.
 */
const detachRun = (
  argv: readonly string[],
  now: Date,
  supervisorLog: string,
  sessionLog: string,
): void => {
  // The command is re-executed AS IT WAS TYPED, minus the detach flag: rebuilding it
  // from parsed values would mean maintaining a second spelling of every flag, and
  // the first one to be forgotten would silently change what runs. `--now` is added
  // when the operator did not give one, so the child names its files off the same
  // moment the parent just announced.
  const passthrough = [
    ...process.argv.slice(2).filter((argument) => !DETACH_FLAGS.includes(argument)),
    ...(flag(argv, "--now") === undefined ? ["--now", eventTimestamp(now)] : []),
  ];
  mkdirSync(dirname(supervisorLog), { recursive: true });
  const sink = openSync(supervisorLog, "a");
  // `process.execPath` + `execArgv` rather than the bin name: the CLI runs under a
  // loader (tsx), and re-executing "agent-protocol" would require it to be installed
  // on the PATH of a package that is deliberately not published.
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1] as string, ...passthrough],
    {
      detached: true,
      stdio: ["ignore", sink, sink],
      cwd: process.cwd(),
      env: process.env,
    },
  );
  child.unref();
  closeSync(sink);
  out(
    `agent-protocol: the supervisor went to the background, pid ${child.pid} · its own output ${supervisorLog} · the session ${sessionLog}`,
  );
  out(
    "agent-protocol: it is a normal process — 'orchestrator status' shows the lease, 'orchestrator stop --mode force' ends it",
  );
};

/** `-d` is john's spelling; `--detach` is the one that reads in a script. */
const DETACH_FLAGS = ["--detach", "-d"];

/**
 * WHERE THIS RUN WILL WORK AND WHAT IT WILL CARRY (R17 + R18) — resolved in one
 * place, because the two answers decide each other.
 *
 * The order is the whole content of this function: the continuation policy is
 * consulted FIRST, and the workspace is then prepared according to it. A resume must
 * find the tree exactly as its session left it — half-finished edits and all — while
 * a fresh package must start from the base commit. Deciding the tree first and the
 * mode second would mean either wiping the state a resume exists to continue, or
 * starting a new package on top of a dead session's leftovers.
 *
 * A refusal here is returned rather than thrown: it costs different things to the two
 * callers (an exit code on the operator's terminal; one role standing still while the
 * daemon keeps raising the others), and choosing that is theirs.
 */
type RunSetup =
  | {
      readonly ok: true;
      readonly workdir: string;
      /**
       * The workdir, when it is a workspace this package handed out (R17) — absent in the
       * pre-R17 mode. It travels separately from `workdir` because the release judges the
       * tree it left behind (requirement 5, second half), and that judgement may only be
       * made about a tree the circuit owns.
       */
      readonly workspace?: string;
      readonly continuation: Continuation;
      readonly world?: World;
      /** How the previous run ended — the one thing a resumed session is told about itself. */
      readonly previousReason?: string;
      readonly lines: readonly string[];
    }
  | { readonly ok: false; readonly reason: string; readonly lines: readonly string[] };

const settleRun = (input: {
  readonly argv: readonly string[];
  readonly role: Role;
  readonly thread: string;
  readonly repo: string;
  readonly mailRoot: string;
  readonly events: readonly OrchestratorEvent[];
  /** The known role ids — the thread is parsed with them (legacy waiting-on). */
  readonly ids: readonly string[];
  /**
   * Whether the workspace may actually be created or moved. A dry run says what it
   * WOULD do with somebody's tree and touches nothing — the same rule as everywhere
   * else in this package, and here it also keeps `run` without `--write` free of side
   * effects on disk.
   */
  readonly write: boolean;
}): RunSetup => {
  const { argv, role, thread, repo, mailRoot, events } = input;
  const workdirSection = configFrom(argv, undefined).config.orchestrator?.workdir;
  const base = workdirSection === undefined ? undefined : baseCommitOf(repo, workdirSection.branch);
  // One read of the thread serves both halves of R18: the mark that goes ONTO this
  // run's launch event, and the list the decision about the PREVIOUS run is taken from.
  const own = ownMessagesOf({ mailRoot, thread, role: role.id, ids: input.ids });
  const world = worldOf({
    ...(own === undefined ? {} : { own }),
    ...(base === undefined ? {} : { base: base.commit }),
  });

  const previous = previousRun(events, role.id, thread);
  const continuation = planContinuation({
    ...(previous === undefined ? {} : { previous }),
    ...(world === undefined ? {} : { world }),
    ...(own === undefined ? {} : { own }),
    forceFresh: argv.includes("--fresh"),
  });
  const lines = [`continuation — ${describeContinuation(continuation)}`];
  const previousReason = previous?.reason ?? undefined;

  // No workspaces declared — the pre-R17 mode, kept whole: the session inherits the
  // tree the supervisor was started in, and the package invents no directory of its
  // own inside somebody else's repository.
  if (workdirSection?.worktrees === undefined || base === undefined) {
    return {
      ok: true,
      workdir: repo,
      continuation,
      ...(world === undefined ? {} : { world }),
      ...(previousReason === undefined ? {} : { previousReason }),
      lines,
    };
  }

  const path = workspacePath({ repo, worktrees: workdirSection.worktrees, role: role.id });
  // WHOSE DIRT IT IS, ANSWERED FROM WHAT WAS ALREADY READ (thread 023, requirement 5):
  // the release reason of the previous run is two lines above, on its way to the resume
  // prompt. No new event, no second read of the disk — the same move as the self-turn
  // delivery: judge by what is already in hand.
  const plan = planWorkspace({
    facts: workspaceFacts(path),
    base: base.commit,
    resuming: continuation.mode === "resume",
    thread,
    ...(previousReason === undefined ? {} : { previousReason }),
    ...(previous?.session === undefined ? {} : { previousSession: previous.session }),
  });
  lines.push(
    `workspace — ${describeWorkspacePlan({
      role: role.id,
      path,
      plan,
      base: base.commit,
      baseRef: base.ref,
    })}`,
  );
  if (plan.action === "refuse") return { ok: false, reason: plan.reason, lines };
  if (input.write) {
    // THE ORDER OF THESE TWO IS THE REQUIREMENT (john, 22:20): the lock is taken
    // BEFORE the tree is mutated, so that a second orchestrator cannot be moving the
    // same tree at the same moment. `create` is the one case where it cannot be —
    // there is nothing to lock until the worktree exists — and it is also the one case
    // where nobody else can be in the tree: it did not exist a moment ago.
    const reason = lockReason({
      role: role.id,
      thread,
      pid: process.pid,
      at: eventTimestamp(new Date()),
    });
    if (plan.action === "create") {
      applyWorkspacePlan({ repo, path, base: base.commit, plan });
      if (!workspaceLocks.take({ repo, path, reason })) {
        return { ok: false, reason: `the workspace '${path}' was locked as it was created`, lines };
      }
    } else {
      if (!workspaceLocks.take({ repo, path, reason })) {
        return {
          ok: false,
          reason: `the workspace '${path}' was locked by another run a moment ago — it is not this run's tree`,
          lines,
        };
      }
      applyWorkspacePlan({ repo, path, base: base.commit, plan });
    }
  }
  // AFTER the tree exists and before the session is spawned (027): a `create` has just
  // made the directory, and a `keep` finds a resumed session about to commit into it.
  lines.push(
    `identity — ${applyWorkspaceIdentity({ repo, path, role: role.id, write: input.write })}`,
  );
  return {
    ok: true,
    workdir: path,
    workspace: path,
    continuation,
    ...(world === undefined ? {} : { world }),
    ...(previousReason === undefined ? {} : { previousReason }),
    lines,
  };
};

/**
 * The prompt of a run, from the mode it was settled into. Built separately from
 * `settleRun` because a dry run must not read anything off a workspace it has just
 * decided not to create.
 */
const promptForRun = (input: {
  readonly role: Role;
  readonly thread: string;
  readonly setup: Extract<RunSetup, { ok: true }>;
  /** The landing margin of this run (R20); the deadline arrives per run, from the plan. */
  readonly windDownSeconds: number;
}): ((context: { readonly deadline: string }) => string) => {
  // THE CARDS ARE READ NOW, THE PROMPT IS ASSEMBLED LATER (R20). Only the deadline has
  // to wait for the plan; an unreadable role card must still refuse HERE, before a
  // lease is taken — a refusal that has moved past the `lease-acquired` write would
  // turn a typo in a path into a failed attempt against the pair's ceiling.
  const instructions =
    input.setup.continuation.mode === "resume"
      ? []
      : (input.role.instructions ?? []).map((entry) => ({
          path: entry.path,
          text: readFile(
            join(input.setup.workdir, entry.path),
            `instructions of role ${input.role.id}`,
          ),
        }));
  return ({ deadline }) =>
    input.setup.continuation.mode === "resume"
      ? buildResumePrompt({
          thread: input.thread,
          reason: input.setup.previousReason ?? "an external abort",
          deadline,
          windDownSeconds: input.windDownSeconds,
        })
      : buildLaunchPrompt({
          role: input.role.id,
          thread: input.thread,
          instructions,
          deadline,
          windDownSeconds: input.windDownSeconds,
        });
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
  const repo = flag(argv, "--repo") ?? homeOf(process.cwd());

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
  // WHOSE ROLE THIS IS (R13) — the same door as the daemon's, and deliberately the same
  // code. A hand-typed `run` is the one mutator the workspace lock cannot see: the lock
  // keeps a second session off a tree on THIS box, ownership is what keeps this box out
  // of a role another box holds the lease on. Refusing in the daemon only would leave the
  // manual launch as the way around the topology — and it is the launch a human types
  // exactly when something is already wrong.
  //
  // The machine config is read HERE, before anything else touches the world, because the
  // ownership answer is half of it (R14) — the same value serves the agent resolution
  // below.
  const local = localFrom(argv);
  // The scope is KEPT, not just consulted: besides the ownership door below it carries
  // the answer to "which box is this" (`scope.instance`), and the digest published by
  // this run needs it — resolved once, behind the same refusals (R13 + R14).
  const scope = launchScopeFrom(argv, local, launchableRoles(argv));
  const leftOut = scope.excluded.find((exclusion) => exclusion.role === roleId);
  if (leftOut !== undefined) {
    fail(describeExclusion(leftOut), 2);
    return;
  }
  const now = orchestratorNow(argv);
  // The flag, then the role's `launch.limits`, then the package default (R12) —
  // and the line below says which of the three each number came from.
  const ceilings = ceilingsFrom(argv, role);
  const wallClockMs = ceilings.wallClock.value * 1000;
  const idleMs = ceilings.idle.value * 1000;
  const waitInputMs = ceilings.waitInput.value * 1000;
  // The two launch gates, with their sources — the same resolution the daemon uses.
  const gates = gatesFrom(argv);
  const pollMs = positiveInt(argv, "--poll", 10) * 1000;
  // What is raised, where its binary lives and with which parameters (R14 + R15) —
  // one resolution, because all three key off the tool id; `local` was already read at
  // the ownership door above.
  // WHAT THE THREAD SAID ABOUT ITS RUNS (R21) — read before the parameters are merged,
  // because it is one of the layers they merge from.
  const directed = threadDirectiveFor({ mailRoot, thread, registry });
  const agent = agentFor(
    argv,
    local,
    role,
    ...(directed.effective === undefined ? [] : [directed.effective.directive]),
  );
  const exec = agent.exec.value;
  const maxTurns = String(ceilings.maxTurns.value);
  const forceFlag = flag(argv, "--force-flag"); // the force stop applies to a manual run too

  const detach = DETACH_FLAGS.some((name) => argv.includes(name));
  const write = argv.includes("--write");
  const events = existsSync(journalPath)
    ? parseJournal(readFile(journalPath, "orchestrator journal"))
    : [];

  // WHERE IT WILL WORK AND WHETHER IT CONTINUES (R17 + R18) — settled before the
  // launch is planned, because both answers end up ON the launch event.
  //
  // A BACKGROUND RUN SETTLES NOTHING HERE. The parent forks a child that repeats this
  // whole command, so the tree would be prepared twice and — since the lock is taken
  // where it is prepared — the child would meet its own parent's lock and refuse
  // itself. The parent plans in report-only mode: the lines still land on the terminal
  // of whoever typed the command, and the tree is touched exactly once, by the process
  // that will hold it.
  const setup = settleRun({
    argv,
    role,
    thread,
    repo,
    mailRoot,
    events,
    ids: registry.ids(),
    write: write && !detach,
  });
  for (const line of setup.lines) out(`agent-protocol: ${line}`);
  if (!setup.ok) {
    fail(`the workspace of '${roleId}' is not usable: ${setup.reason}`, 2);
    return;
  }

  if (!write) {
    // A dry run has nothing to background: it prints a plan and exits. Accepting the
    // flag silently would return a prompt and no process — indistinguishable, from
    // the terminal, from a run that started and died.
    if (detach) {
      fail(
        "--detach without --write: a dry run prints its plan here, there is nothing to background",
        2,
      );
      return;
    }
    const plan = planLaunch({
      events,
      role: roleId,
      thread,
      now,
      wallClockMs,
      maxConsecutive: gates.maxConsecutive.value,
      maxAttempts: gates.maxAttempts.value,
      // The dry run answers the same question the real one does, so it reads the
      // same mail (thread 023) — a plan that refuses where `--write` would go is
      // worse than no plan.
      deliveredSessions: sessionsThatWrote(
        loadThreads(mailRoot, registry.ids()).threads.map((loaded) => loaded.thread),
      ),
      continuation: setup.continuation,
      ...(setup.world === undefined ? {} : { world: setup.world }),
    });
    if (!plan.ok) {
      fail(`the launch was refused (${plan.reason}) — a ceiling fired, see the journal`, 2);
      return;
    }
    out(
      `agent-protocol: would run '${exec} -p' in ${setup.workdir} and watch for the turn to be passed on ${thread} (role ${roleId}, deadline ${plan.deadline}, poll ${pollMs / 1000}s); --write performs it. Pre-events:`,
    );
    out(`agent-protocol: ceilings — ${describeCeilings(ceilings)}`);
    out(`agent-protocol: gates — ${describeGates(gates)}`);
    out(`agent-protocol: agent — ${describeAgent(agent)}`);
    out(`agent-protocol: ${describeZones(role)}`);
    for (const line of directiveLines(directed, agent.ignored)) out(`agent-protocol: ${line}`);
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
  requirePreflight(argv, [{ worker: agent.worker.value, exec: agent.exec }], local, [role]);
  const sessionLog = sessionLogPath(
    join(dirname(journalPath), "sessions"),
    roleId,
    thread,
    eventTimestamp(now),
  );
  // The background mode forks HERE — after preflight (its refusals belong on the
  // terminal) and after the session path is known, so the parent can name the file
  // to watch. `--now` travels with the child precisely so that both halves derive
  // the same name from the same moment.
  if (detach) {
    detachRun(argv, now, sessionSupervisorPath(sessionLog), sessionLog);
    return;
  }
  out(`agent-protocol: ceilings — ${describeCeilings(ceilings)}`);
  out(`agent-protocol: gates — ${describeGates(gates)}`);
  out(`agent-protocol: agent — ${describeAgent(agent)}`);
  out(`agent-protocol: ${describeZones(role)}`);
  for (const line of directiveLines(directed, agent.ignored)) out(`agent-protocol: ${line}`);
  // R13, second half: A MANUAL RUN PUBLISHES ITS STATE TOO (thread
  // `025-stale-instance-digest`, second half). The publisher is created HERE — after the
  // dry run has returned and after the `--detach` fork, so it belongs to the process that
  // actually holds the lease: a plan publishes nothing, and the parent of a background
  // run has no lease to publish, its child does.
  //
  // "A human is watching this box anyway" is not an argument for leaving it out: that
  // human is the one reader who does not need the file. It exists for the reader who is
  // NOT here — another instance, or a `status` read from elsewhere — and to them a fresh
  // digest with no leases is indistinguishable from an idle box (curator, 2026-07-28).
  // `-d` removes even the local watcher, with the lease and the journal unchanged.
  const digest = digestPublisherFor({
    argv,
    mailRoot,
    journalPath,
    maxAttempts: gates.maxAttempts.value,
    instance: scope.instance,
    label: "run",
  });
  out(digest.announce);
  const reason = await runOne({
    journalPath,
    mailRoot,
    roleId,
    thread,
    prompt: promptForRun({ role, thread, setup, windDownSeconds: ceilings.windDown.value }),
    exec,
    maxTurns,
    launch: role.launch,
    denyRules: zoneDenyRules(role),
    sessionLog,
    sessionStream: sessionStreamPath(sessionLog),
    sessionIdFile: sessionIdPath(sessionLog),
    waitFlag: sessionWaitPath(sessionLog),
    worker: agent.worker.value,
    params: agent.params,
    env: childEnvFrom(argv),
    wallClockMs,
    pollMs,
    idleMs,
    waitInputMs,
    windDownMs: ceilings.windDown.value * 1000,
    workdir: setup.workdir,
    ...(setup.workspace === undefined ? {} : { workspace: setup.workspace }),
    continuation: setup.continuation,
    ...(setup.world === undefined ? {} : { world: setup.world }),
    ids: registry.ids(),
    now,
    maxConsecutive: gates.maxConsecutive.value,
    maxAttempts: gates.maxAttempts.value,
    onLeaseChange: digest.publish,
    ...(forceFlag === undefined ? {} : { forceFlag }),
  });
  // ONE LAST PUBLICATION, the counterpart of the daemon's end-of-tick call. The terminal
  // release is already hooked, so on a good day this is a no-op that `digestChanged`
  // costs nothing — it is here for the bad one: a publication from the hook can FAIL (the
  // mail checkout was busy, the push was rejected), and a failure leaves `published`
  // untouched precisely so the next call retries it. This is the last moment this process
  // has, and by now the contention that lost the first attempt is over.
  digest.publish();
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
/**
 * PUBLISHING THIS BOX'S STATE into the mail branch (R13, second half) — the write half
 * of the digest. It goes through the same delivery the mail uses, for the same reasons:
 * a rejected push must not leave a commit on one disk, and a DIRTY CHECKOUT IS A
 * REFUSAL, never a repair (delivery resets hard on a retry, and doing that over
 * somebody's half-written message destroys work to publish a status line).
 *
 * A FAILURE HERE NEVER STOPS THE DAEMON. The digest is a courtesy to the other boxes
 * and to a human; the work of this box does not depend on it. A daemon that died
 * because it could not announce itself would be the watch failing at exactly the moment
 * it is most needed — the same argument that keeps a failed mail probe from killing it.
 * So: the reason is said out loud on the stream, every time, and the loop goes on.
 *
 * Returns what was published, so the caller can tell the next state from this one and
 * not commit a heartbeat.
 */
/** How long the digest waits for the mail checkout before saying it skipped a beat (ms). */
const DIGEST_LOCK_WAIT_MS = 20_000;

const publishDigest = (input: {
  readonly argv: readonly string[];
  readonly mailRoot: string;
  readonly branch: string;
  readonly digest: InstanceDigest;
  /**
   * WHICH COMMAND IS SPEAKING — `daemon` or `run`. The lines below are read on a
   * terminal beside the rest of one command's output, and a `run` that announced itself
   * as the daemon would send a reader looking for a watch that is not there.
   */
  readonly label: string;
}): boolean => {
  const say = (line: string): void => err(`agent-protocol: ${input.label} — ${line}`);
  const checkout = repoOf(input.mailRoot);
  // THE DIGEST YIELDS TO THE MAIL. It is a courtesy line about this box, and a message
  // from a role is the work itself — so the status line waits a short while and gives up
  // loudly rather than holding the door on a busy tick. The same lock covers the cleanup
  // below: `git reset -- <path>` beside somebody else's commit is a second writer in the
  // index, which is what the lock exists to prevent.
  const lock = mailLockFor({
    checkout,
    holder: `digest of instance ${input.digest.instance}`,
    note: (line) => say(line),
    waitMs: DIGEST_LOCK_WAIT_MS,
  });
  try {
    deliverMessage({
      git: gitIn(checkout),
      write: writeOut,
      branch: input.branch,
      // Conventional Commits, because the mail checkout carries the commit-msg hook —
      // and `chore` because this is machine bookkeeping, not a turn in a conversation.
      subject: `chore(protocol): instance ${input.digest.instance} state`,
      // Bookkeeping of the machinery, so it is signed by the machinery (027) — a role
      // here would claim somebody made a turn when nobody did.
      identity: ORCHESTRATOR_IDENTITY,
      // The path does not depend on what else landed in the branch — one file per box —
      // so a replan after a concurrent push restages the very same file.
      stage: () => ({
        files: [
          {
            path: join(input.mailRoot, digestPath(input.digest.instance)),
            content: renderDigest(input.digest),
          },
        ],
        label: digestPath(input.digest.instance),
      }),
      note: (line) => say(line),
      lock,
    });
    return true;
  } catch (error) {
    say(
      `the instance digest was NOT published: ${(error as Error).message}; the box keeps working, the other instances see its last known state`,
    );
    // A FAILED DELIVERY MUST NOT LEAVE THE CHECKOUT DIRTY. `deliverMessage` writes and
    // stages before it commits, so a commit that fails (the runner's checkout has no
    // `user.email` — this is not hypothetical, it is how this path first went red) ends
    // with our file staged. Delivery REFUSES on a dirty checkout, so that leftover would
    // block the next digest AND every message any role tries to send from this box: one
    // failed status line would take the mail down for everybody.
    //
    // Only OUR OWN path is undone — never `reset --hard`. Whatever else is in the
    // checkout belongs to somebody's unfinished message, and cleaning up after ourselves
    // is not licence to destroy it.
    const own = relative(checkout, join(input.mailRoot, digestPath(input.digest.instance)));
    try {
      lock.hold(() => {
        execFileSync("git", ["-C", checkout, "reset", "--quiet", "--", own], { stdio: "ignore" });
        if (spawnSync("git", ["-C", checkout, "cat-file", "-e", `HEAD:${own}`]).status === 0) {
          execFileSync("git", ["-C", checkout, "checkout", "--quiet", "HEAD", "--", own], {
            stdio: "ignore",
          });
        } else if (existsSync(join(checkout, own))) {
          rmSync(join(checkout, own));
        }
      });
    } catch (cleanup) {
      say(
        `and the half-written digest could NOT be cleaned out of the mail checkout: ${(cleanup as Error).message}. Delivery refuses a dirty checkout, so mail from this box is blocked until '${own}' is dealt with by hand`,
      );
    }
    return false;
  }
};

/**
 * THE STATE OF THIS BOX, RE-READ AND PUBLISHED IF IT MOVED — ONE publisher, handed to
 * both commands that hold a lease (`daemon` and `run`; thread `025-stale-instance-digest`).
 *
 * It lived inside the daemon at first, and that was the second half of the same defect:
 * `orchestrator run` — the launch a human types, `-d` included — could not publish at
 * all, because the only publisher was closed over the daemon's state. A box busy with a
 * manual run therefore published a fresh `writtenAt` with `leases: []`. That is worse
 * than the original lie rather than a smaller version of it: the truthfulness of one
 * derived file came to depend on WHICH COMMAND raised the session, and a reader on
 * another machine cannot know that — they see current-looking bytes saying nobody is
 * working (curator, 2026-07-28).
 *
 * A SECOND COPY IN THE `run` PATH WAS THE WRONG ANSWER for the reason the first defect
 * teaches: two publishers of one file drift, and the drift is invisible until somebody
 * reads the file at the wrong moment. Hence a factory, called once per command, holding
 * the only piece of state a publisher needs — the last version it actually pushed.
 *
 * SEEDED FROM THE BRANCH, not from nothing: a process is restarted (a reboot, a `--once`
 * tick from cron, a `run` after a `run`), and a fresh one that remembered nothing would
 * re-commit a digest identical to the one already there. That is the heartbeat
 * `digestChanged` exists to prevent, arriving by the back door.
 *
 * The journal is re-read on every call rather than passed in: a run appends to it while
 * the caller is blocked, so the copy the caller loaded is stale exactly when it matters.
 *
 * A BOX WITH NO DECLARED INSTANCE PUBLISHES NOTHING, and says so once — the pre-R13
 * contour verbatim (one box, every role), with no id to publish under and nobody to
 * publish to.
 */
type DigestPublisher = {
  /** Publish if the state moved. Called wherever a lease of this box changes. */
  readonly publish: () => void;
  /** The one line the command prints about whether it publishes at all, and where. */
  readonly announce: string;
};

const digestPublisherFor = (input: {
  readonly argv: readonly string[];
  readonly mailRoot: string;
  readonly journalPath: string;
  readonly maxAttempts: number;
  /**
   * WHICH BOX THIS IS — taken from the scope both commands have already resolved
   * (`LaunchScope.instance`), never read again here: the join of the topology and the
   * machine config has a door that refuses a nameless box or an unknown name, and a
   * second reading of the same two files would be a second answer to a settled question.
   */
  readonly instance: string | undefined;
  /** Which command is publishing — it ends up in front of every line about the digest. */
  readonly label: string;
}): DigestPublisher => {
  const loaded = configFrom(input.argv, undefined).config;
  const branch = loaded.mail.branch;
  const instance = input.instance;
  if (instance === undefined) {
    return {
      publish: () => {},
      announce: `agent-protocol: ${input.label} — no instance declared, this box publishes no digest (${DIGEST_DIR}/ stays as it is)`,
    };
  }
  // THE ROLES OF THE BOX, NOT OF THIS LAUNCH (see `InstanceDigest.roles`): read from the
  // topology, so `daemon` and `run --role x` publish the same list and the operator's
  // flags reach `leases` only.
  const roles = rolesOfInstance({ instances: loaded.instances, instance });
  let published: InstanceDigest | undefined = loadDigests(input.mailRoot).digests.find(
    (digest) => digest.instance === instance,
  );
  return {
    publish: () => {
      const events = existsSync(input.journalPath)
        ? parseJournal(readFile(input.journalPath, "orchestrator journal"))
        : [];
      const at = new Date();
      const state = digestOf({
        instance,
        roles,
        leases: foldLeases(events, at, input.maxAttempts),
        // A box standing down on a closed window has NO live leases to publish, so without
        // this the neighbours would read its silence as "nothing to do" (D-3 part 2).
        quota: openQuotaShelves(events, at),
        now: at,
      });
      if (!digestChanged(published, state)) return;
      if (
        publishDigest({
          argv: input.argv,
          mailRoot: input.mailRoot,
          branch,
          digest: state,
          label: input.label,
        })
      ) {
        published = state;
      }
    },
    announce: `agent-protocol: ${input.label} — publishing state as instance '${instance}' to ${digestPath(instance)} on ${branch}`,
  };
};

const orchestratorDaemon = async (argv: readonly string[]): Promise<void> => {
  // S6: not a single path in the operational command — everything comes from the
  // config; the flags remain an override for checks on a copy of the mail.
  const paths = pathsFrom(argv);
  const journalPath = flag(argv, "--journal") ?? paths.journal;
  const mailRoot = flag(argv, "--root") ?? paths.mailRoot;
  const repo = flag(argv, "--repo") ?? homeOf(process.cwd());
  const enableFlag = flag(argv, "--enable-flag") ?? paths.enableFlag;
  const stopFlag = flag(argv, "--stop-flag") ?? paths.stopFlag;
  const forceFlag = flag(argv, "--force-flag") ?? paths.forceFlag;
  const holdsDir = flag(argv, "--holds") ?? paths.holds;

  const registry = registryFrom(argv, undefined);
  const childEnv = childEnvFrom(argv);
  const ids = registry.ids();
  const launchableList = launchableRoles(argv);
  // The machine config is read ONCE, at startup, like the rest of the launch mode: a
  // daemon whose binaries changed under it should be restarted, and re-reading a
  // home-directory file every tick would make "which binary this run used" depend on
  // the moment rather than on the mode.
  const local = localFrom(argv);
  // R13: THE SCOPE OF THIS RUN — the roles of THIS instance, narrowed by the operator's
  // flags. It is resolved once, at startup, for the same reason: the topology is read at
  // a ref and the flags belong to the launch, so neither can change under a running
  // daemon. What the scope removed is said out loud every tick, beside the queue.
  const scope = launchScopeFrom(argv, local, launchableList);
  const launchable = scope.roles;

  const tickMs = positiveInt(argv, "--tick", 30) * 1000;
  // The two gates of the loop, WITH THEIR SOURCES — printed in the banner below (R12).
  // Until the defect of 2026-07-26 the per-pair ceiling was a constant no flag could
  // reach, so `--max-runs 20` against an exhausted pair changed nothing and said
  // nothing about why.
  const gates = gatesFrom(argv);
  const pollMs = positiveInt(argv, "--poll", 10) * 1000;
  const once = argv.includes("--once"); // a single tick — for checks
  // THE CEILINGS AND THE AGENT ARE RESOLVED PER ROLE, in the launch branch below —
  // not once here (R12, R14, R15). A daemon raises different roles, and
  // `launch.limits`/`launch.agent` belong to the role it launches; hoisting the
  // resolution out of the loop would silently give every role the settings of
  // whichever one happened to be first.

  // Preflight BEFORE the loop: a daemon started without the agent binary or with
  // stale mail "works" — and does the wrong thing. The binaries of EVERY launchable
  // role are probed, not one of them.
  //
  // THE DAEMON JUDGES THE RESULT DIFFERENTLY FROM `run` (R6-достройка): a failed
  // mail probe leaves it alive and launching nobody, everything else still refuses
  // before the first lease. The reasoning is in `daemonPreflightVerdict`; the short
  // version is that a watch killed by a network hiccup is not there when the network
  // comes back, and that is the whole point of a watch.
  // Only the roles IN SCOPE are probed: a binary for a role this box does not raise is
  // neither our problem nor our refusal, and probing it would let another instance's
  // topology stop this daemon at the door.
  const inScope = launchableList.filter((role) => scope.roles.includes(role.id));
  const startupChecks = runPreflight(argv, execTargets(argv, local, inScope), local, inScope);
  err(renderPreflight(startupChecks));
  const startup = daemonPreflightVerdict(startupChecks);
  if (startup.kind === "refuse") fail("preflight failed — not starting", 2);
  /** Non-null while the mail probe is failing: the gate is shut and re-tried each tick. */
  let mailStale: PreflightCheck | null = startup.kind === "degraded" ? startup.mail : null;

  // The banner states the FACT rather than always "DISABLED": help text that lies
  // about the state cost a separate hypothesis about the cause of a failure during
  // an acceptance review.
  const enabledAtStart = existsSync(enableFlag);
  out(
    `agent-protocol: the daemon is up, launches are ${enabledAtStart ? "ENABLED" : `disabled (no '${enableFlag}')`}; stop '${stopFlag}', force '${forceFlag}'; roles ${launchable.join(", ") || "—"}`,
  );
  out(`agent-protocol: daemon — gates: ${describeGates(gates)}`);
  // R13: WHAT THIS RUN RAISES, and what it leaves to somebody else — in the banner,
  // because a role missing from the queue for an unspoken reason is indistinguishable
  // from a role with no mail.
  out(`agent-protocol: daemon — ${describeScope(scope)}`);
  for (const exclusion of scope.excluded)
    out(`agent-protocol: daemon — ${describeExclusion(exclusion)}`);

  // R13, second half: WHETHER THIS BOX PUBLISHES ITS STATE AT ALL. Without a declared
  // topology there is no id to publish under and nobody to publish to — that is the
  // pre-R13 contour verbatim (one box, every role), and it is said once rather than
  // left to be inferred from a directory that never appears.
  /**
   * R13, second half: WHETHER THIS BOX PUBLISHES ITS STATE AT ALL, and the publisher
   * itself — the SAME one `orchestrator run` uses (`digestPublisherFor`). It used to be
   * an inline closure here, which is what made the manual launch unable to publish at
   * all; the reasoning of the move is in the factory.
   */
  const digest = digestPublisherFor({
    argv,
    mailRoot,
    journalPath,
    maxAttempts: gates.maxAttempts.value,
    instance: scope.instance,
    label: "daemon",
  });
  out(digest.announce);
  const publishState = digest.publish;

  /**
   * THE COURIER IS DIALLED BY THE CIRCUIT, NOT BY A HAND (R4 + thread 024; john's
   * decision, message `2026-07-28T19-37-00Z-curator`, taking curator's recommendation
   * `2026-07-28T18-58-18Z-curator` item 2 unchanged). A message is named here by its
   * STABLE FILE NAME, not by an `msg-NNN` ordinal: the ordinal is a position in one
   * rendering — `--tail` renumbers from `msg-001` — so a long-lived text that cites
   * one points somewhere else the moment the reader changes a flag.
   *
   * `notify` has existed since R4 and has never once been called by anything: the
   * package could compose the message and deliver it, and the only way to make it
   * happen was for somebody to type the command. A courier that rings only when it
   * is dialled is not a courier — and it was measured, not assumed: the second class
   * of event (a turn that has not moved) shipped the day before and still told
   * nobody, because nothing was calling it.
   *
   * THE TICK, NOT THE END OF A RUN, and that is the load-bearing half of the
   * decision. The most likely producer of a stalled turn is a session that died on
   * its window — precisely the one that would never reach an end-of-run hook. The
   * tick is where the circuit already lives and where the state is already written.
   *
   * AT THE TOP OF THE TICK, before the mail is read: one tick blocks for the whole
   * length of the session it raises, so a courier at the bottom would fire only
   * between sessions — hours apart, which is the very interval it is meant to
   * measure. It also means the daemon now fetches the mail once a tick (the run does
   * the same fetch-and-fast-forward `notify` has always done), which is what
   * `mailCheckoutState` says the daemon is for; it is named here rather than left to
   * be discovered.
   *
   * A FAILURE HERE NEVER STOPS THE DAEMON — the rule the digest already lives by, for
   * the same reason: notifications are a superstructure, and a watch that died
   * because it could not reach Telegram is not there when Telegram comes back. So
   * every outcome is said out loud on the stream and the loop goes on.
   *
   * THE COMMENTARY IS KEPT FOR WHEN IT MATTERS. The routine tick is one line ("N
   * waits … nothing to announce"); the mail verdict, the secrets and the message
   * itself are printed only when something was actually announced or something
   * failed. Repeating all of it every thirty seconds is the same "trains its reader
   * to ignore it" the notifier refuses to do to a human.
   */
  const dialCourier = async (): Promise<void> => {
    let run: NotifyRun;
    try {
      run = await runNotify({ argv, write: true });
    } catch (error) {
      err(
        `agent-protocol: daemon — the courier THREW and told nobody: ${(error as Error).message}; the box keeps working, the turn stays where it is`,
      );
      return;
    }
    if (run.kind === "failed" || run.kind === "undelivered") {
      for (const line of run.lines) err(`agent-protocol: daemon — courier: ${line}`);
      err(
        `agent-protocol: daemon — the courier is NOT delivering: ${run.summary}; the box keeps working, nobody is being told that the turn has passed`,
      );
      return;
    }
    if (run.kind === "sent") {
      for (const line of run.lines) out(`agent-protocol: daemon — courier: ${line}`);
    }
    out(`agent-protocol: daemon — courier: ${run.summary}`);
  };

  /**
   * THE REGISTRY OF LIVE SUPERVISORS — the whole of D-2 in one Map (thread
   * `023-daemon-parallelism`).
   *
   * The tick used to `await runOne`, so the daemon was asleep for the entire length of
   * the session it raised: "dev-core writes 016 while the curator workspace idles on a
   * waiting 019" is that sleep, not a scheduling choice. Here the raise is started and
   * NOT awaited, and what is kept instead is the promise — because three things need it
   * and none of them can be derived from the journal:
   *
   *  - THE PLANNER needs the roles that are busy in THIS process (`running` above): the
   *    lease is written by the supervisor, and a tick landing before that write would
   *    plan a second session into a live workspace;
   *  - BOTH STOPS AND `--once` need to WAIT FOR ALL OF THEM, not for the first and not
   *    for the last. A lease closed by nothing is, from the outside, indistinguishable
   *    from work (the daemon already says so about orphans at startup) — and with N
   *    children the cost of getting that wrong is multiplied by N;
   *  - A HUMAN needs to know what the box is doing, so the count is said out loud.
   *
   * Keyed by the pair and not by the role: the role ceiling is the planner's job, and a
   * registry that could not hold two entries for one role would hide a planner defect
   * instead of surviving it.
   */
  const live = new Map<string, { readonly candidate: Candidate; readonly done: Promise<void> }>();
  const pairKey = (candidate: Candidate): string => `${candidate.role}×${candidate.thread}`;
  /** The roles this process is running right now — what the planner is told (D-2). */
  const runningRoles = (): readonly string[] => [
    ...new Set([...live.values()].map((s) => s.candidate.role)),
  ];

  /**
   * EVERY LINE OF A PARALLEL DAEMON CARRIES ITS PAIR (D-2, curator's point 3). With one
   * session at a time the reader could attribute a line by position; with N interleaved
   * they cannot, and an unattributed "the session exited, code 1" is worse than no line
   * — it invites the operator to blame the wrong role.
   */
  const pairOut = (candidate: Candidate, line: string): void =>
    out(`agent-protocol: daemon [${pairKey(candidate)}] ${line}`);
  const pairErr = (candidate: Candidate, line: string): void =>
    err(`agent-protocol: daemon [${pairKey(candidate)}] ${line}`);

  /**
   * Start one pair and return immediately. Everything that can throw is inside the
   * promise: an unhandled rejection would take down the daemon, which is the very class
   * of death the resilience half of D-2 has just removed from the config door.
   */
  const launch = (candidate: Candidate, events: readonly OrchestratorEvent[]): void => {
    const role = registry.get(candidate.role);
    // The permission profile exists by construction: `launchable` was computed
    // through `roleLaunchability`, which does not let a role without a profile
    // through.
    const profile = role?.launch;
    if (role === undefined || profile === undefined) return;
    const key = pairKey(candidate);
    if (live.has(key)) return;
    const startedAt = new Date();
    const sessionLog = sessionLogPath(
      join(dirname(journalPath), "sessions"),
      candidate.role,
      candidate.thread,
      eventTimestamp(startedAt),
    );
    const ceilings = ceilingsFrom(argv, role);
    // The directive is read PER LAUNCH, like the workspace below it and for the
    // same reason: it is a property of this thread at this moment, and a daemon
    // that read it once at start-up would keep raising yesterday's decision for
    // days (R21 — a change mid-thread takes effect from the NEXT run).
    const directed = threadDirectiveFor({ mailRoot, thread: candidate.thread, registry });
    const agent = agentFor(
      argv,
      local,
      role,
      ...(directed.effective === undefined ? [] : [directed.effective.directive]),
    );
    // The workspace and the continuation are settled PER LAUNCH: both are properties of
    // this (role, thread) pair at this moment, and the daemon lives for days. This half
    // is deliberately SYNCHRONOUS and happens before the registry entry exists — it is
    // the door (a dirty or locked tree is a refusal), and a refusal must not leave a
    // supervisor to wait for.
    const setup = settleRun({
      argv,
      role,
      thread: candidate.thread,
      repo,
      mailRoot,
      events,
      ids,
      write: true,
    });
    for (const line of setup.lines) pairOut(candidate, line);
    if (!setup.ok) {
      // A REFUSAL OF ONE ROLE, NOT OF THE CIRCUIT — and it is not written to the
      // journal, for the same reason a hold is not: it lasts until a human looks
      // at the tree, which is hours, and a record every tick would drown the
      // journal of the runs. Staying silent is not allowed either, hence a line on
      // every tick.
      pairErr(candidate, `skipped — its workspace is not usable: ${setup.reason}`);
      return;
    }
    pairOut(candidate, `ceilings: ${describeCeilings(ceilings)}`);
    pairOut(candidate, `agent: ${describeAgent(agent)}`);
    for (const line of directiveLines(directed, agent.ignored)) pairOut(candidate, line);
    const done = (async (): Promise<void> => {
      try {
        const reason = await runOne({
          journalPath,
          mailRoot,
          roleId: candidate.role,
          thread: candidate.thread,
          prompt: promptForRun({
            role,
            thread: candidate.thread,
            setup,
            windDownSeconds: ceilings.windDown.value,
          }),
          exec: agent.exec.value,
          maxTurns: String(ceilings.maxTurns.value),
          launch: profile,
          denyRules: zoneDenyRules(role),
          env: childEnv,
          sessionLog,
          sessionStream: sessionStreamPath(sessionLog),
          sessionIdFile: sessionIdPath(sessionLog),
          waitFlag: sessionWaitPath(sessionLog),
          worker: agent.worker.value,
          params: agent.params,
          wallClockMs: ceilings.wallClock.value * 1000,
          pollMs,
          idleMs: ceilings.idle.value * 1000,
          waitInputMs: ceilings.waitInput.value * 1000,
          windDownMs: ceilings.windDown.value * 1000,
          workdir: setup.workdir,
          ...(setup.workspace === undefined ? {} : { workspace: setup.workspace }),
          continuation: setup.continuation,
          // R13: the box says it is busy WHILE it is busy. The whole session happens
          // inside this await, so without the hook the digest can only ever describe
          // the gaps between sessions.
          onLeaseChange: publishState,
          ...(setup.world === undefined ? {} : { world: setup.world }),
          ids,
          now: startedAt,
          maxConsecutive: gates.maxConsecutive.value,
          maxAttempts: gates.maxAttempts.value,
          forceFlag,
          // THE PASS-THROUGH IS ATTRIBUTED (D-2, point 3): the session's own words go to
          // the daemon's stdout, and with two sessions talking at once an unlabelled line
          // belongs to nobody.
          streamPrefix: `[${key}]`,
        });
        pairOut(candidate, `the run finished: ${reason}`);
      } catch (error) {
        // A supervisor that threw must not take the daemon with it, and must not vanish
        // silently either: the lease it may have left is closed by the run's own guards,
        // and what a human needs from here is the pair and the reason.
        pairErr(candidate, `the supervisor FAILED: ${(error as Error).message}`);
      } finally {
        live.delete(key);
      }
    })();
    live.set(key, { candidate, done });
  };

  /**
   * WAIT FOR ALL THE CHILDREN — not the first and not the last (D-2, curator's point 2).
   *
   * Called on both stops and on `--once`. The loop re-reads the registry after each
   * settle because a supervisor may still be finishing its journal write while another
   * is being awaited, and `Promise.all` over one snapshot would return with the map
   * non-empty. Nothing is raised while draining: the callers have already left the
   * launch path.
   */
  const drain = async (what: string): Promise<void> => {
    if (live.size === 0) return;
    out(
      `agent-protocol: daemon — ${what}: waiting for ${live.size} live session(s) — ${[...live.values()].map((s) => pairKey(s.candidate)).join(", ")}`,
    );
    while (live.size > 0) await Promise.all([...live.values()].map((s) => s.done));
    out(`agent-protocol: daemon — ${what}: every session is finished, no lease was left open`);
  };

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
    // THE SHUT GATE, BEFORE ANYTHING ELSE (R6-достройка). While the mail probe is
    // failing the daemon reads no mail and raises nobody — but it is not deaf: the
    // stop and force flags are checked FIRST, because a network outage must never be
    // able to block the off switch. Then the probe that failed is re-run, and only
    // it: the tick IS the retry, with no back-off and no counter on top.
    if (mailStale !== null) {
      if (existsSync(stopFlag) || existsSync(forceFlag)) {
        const which = existsSync(forceFlag) ? "force" : "stop";
        await drain(`the ${which} flag`);
        out(`agent-protocol: the daemon stopped — the ${which} flag`);
        return;
      }
      const probe = probeMailCheckout(argv);
      if (probe.status === "fail") {
        mailStale = probe;
        err(
          `agent-protocol: daemon — LAUNCHING NOBODY, the mail is not readable: ${probe.detail}; the daemon stays up and re-probes, ${once ? "exiting (--once)" : `next try in ${tickMs / 1000}s`}`,
        );
        if (once) {
          await drain("--once");
          return;
        }
        await sleep(tickMs);
        continue;
      }
      mailStale = null;
      out(`agent-protocol: daemon — the mail is readable again (${probe.detail}), launches resume`);
    }

    // WHO IS TOLD THAT THE TURN HAS PASSED — before the queue is read, and by the
    // circuit itself (see `dialCourier`). It reads the same mail this tick is about
    // to work from, and it never decides anything the tick does.
    await dialCourier();

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
    // THE ORDER OF THE QUEUE IS A DECISION, not the order of the scan (R5). One tick
    // raises at most one pair, so whichever candidate comes first IS the scheduling
    // policy; before R5 it was the alphabet of the thread directories. The three tiers
    // and their argument live in `priority.ts`; here we only read the facts they need
    // out of the feed each tick — a priority written a minute ago must be in force on
    // the next tick, exactly like the launch directive (R21).
    // THE SAME RANKER THE OPERATOR FRAME USES (`rankCandidates`): the queue a human
    // reads in `status` and the queue this tick raises from are one computation, or
    // they drift and there is nothing to argue with.
    const { ranked, ignored } = rankCandidates({
      threads,
      roles: launchable,
      waitingOn: (roleId) => threadsWaitingOn(threads, roleId),
      authorized: (role) => registry.canSetThreadPriority(role),
    });
    // An unauthorized priority is dropped OUT LOUD, every tick it is read: a queue
    // ordered by a statement nobody honoured looks exactly like a queue that did.
    for (const line of ignored) err(`agent-protocol: ${line}`);
    const candidates = orderCandidates(ranked);
    // R27: the threads frozen behind a person, read from the SAME scan the queue is
    // built from. Every tick, like the priorities and for the same reason — the state
    // lifts with a message, so a park read once at startup would outlive its answer.
    // The QUEUE carries the mark too, not only the skip line below it: the two are read
    // apart (a queue line promises a launch, a skip explains one that did not happen),
    // and the operator's frame prints the queue without the stream around it (D-4).
    const parked = parkedThreads(threads);
    for (const line of describeOrder(candidates, parked)) err(`agent-protocol: ${line}`);
    // R23-1: A THREAD WAITING ON A RESIDENT ROLE, said beside the queue it is not in.
    // A resident is never a candidate — it is hosted, not raised — so without this line
    // the daemon's silence about it is indistinguishable from an empty mailbox, and a
    // dead resident process would look exactly like a quiet night.
    for (const wait of residentWaits({
      residents: registry.residents(),
      waitingThreads: (role) => threadsWaitingOn(threads, role),
    })) {
      err(`agent-protocol: daemon — ${describeResidentWait(wait)}`);
    }
    const events = existsSync(journalPath)
      ? parseJournal(readFile(journalPath, "orchestrator journal"))
      : [];
    // The holds are read EVERY tick, not once at startup: a manual session is taken
    // and released while the daemon is already spinning.
    const held = heldRoles(foldHolds(loadHolds(holdsDir), new Date()));
    const decision = planTick({
      enabled: existsSync(enableFlag),
      held,
      // D-2: the roles this daemon is running RIGHT NOW. Before the tick stopped
      // blocking there was nothing to tell it — a running role meant a sleeping daemon.
      running: runningRoles(),
      // The force flag stops the daemon as well (S4): its current session is put
      // down by the observer, and taking a new one is not allowed — otherwise the
      // next tick would raise a role right under the force.
      stopped: existsSync(stopFlag) || existsSync(forceFlag),
      events,
      candidates,
      now: new Date(),
      // The mail is already parsed for the queue above — the set of sessions that
      // wrote is what keeps a run that delivered into its own turn out of the
      // failed attempts (thread 023).
      deliveredSessions: sessionsThatWrote(threads),
      maxConsecutive: gates.maxConsecutive.value,
      maxAttempts: gates.maxAttempts.value,
      parked,
    });

    // EVERY CANDIDATE THAT WAS NOT RAISED IS NAMED, whatever the tick decided to do
    // (curator's requirement 1). Not written to the journal — a hold or an exhausted
    // pair lasts until a human looks at it, and a record every tick would drown the
    // journal of the runs; but the daemon's stream must never be silent about work it
    // is declining to do.
    for (const skip of decision.skipped) {
      err(`agent-protocol: ${describeSkip(skip, gates.maxAttempts)}`);
    }
    /** What happens after this tick — said in the same breath as what it decided. */
    const next = once ? "exiting (--once)" : `waiting ${tickMs / 1000}s for the next tick`;

    if (decision.kind === "halt") {
      // THE STOP WAITS FOR EVERY CHILD (D-2, point 2). A daemon that returned here with
      // supervisors still live would leave N leases with nobody to close them — the state
      // it warns about at startup, produced by its own orderly shutdown. The force flag
      // is not a contradiction: the observers read it and put their sessions down, so
      // draining under force is short, and it is what makes the releases get written.
      const which = existsSync(forceFlag) ? "force" : "stop";
      await drain(`the ${which} flag`);
      out(`agent-protocol: the daemon stopped — the ${which} flag`);
      return;
    }
    if (decision.kind === "held") {
      // NOT written into the journal: a hold lives for hours, and a record every
      // tick would drown the session journal in noise. But staying silent is not
      // allowed either — a forgotten hold has to be audible, hence a line into the
      // daemon stream on every tick. The pairs themselves were named above; this line
      // is the state of the circuit: there IS work, and a human is holding it.
      err(
        `agent-protocol: daemon — nothing launchable: taken by manual sessions of ${decision.roles.join(", ")}, ${next}`,
      );
    } else if (decision.kind === "quota") {
      // THE BOX IS STANDING DOWN, AND IT SAYS SO EVERY TICK. Not in the journal every
      // tick — the record below is written once per shelf — but on the stream, where the
      // operator's question is "is this thing alive". The pairs themselves were named
      // above with their own reason; these lines are the state of the circuit.
      for (const shelf of decision.shelves) {
        err(`agent-protocol: daemon — ${describeQuotaShelf(shelf)}, ${next}`);
      }
      if (decision.cut !== undefined) {
        appendEvent(journalPath, {
          kind: "launch-refused",
          ts: eventTimestamp(new Date()),
          role: decision.cut.recorded.role,
          thread: decision.cut.recorded.thread,
          reason: decision.cut.reason,
        });
        err(
          `agent-protocol: the launch of ${decision.cut.recorded.role}/${decision.cut.recorded.thread} was refused (quota) — one record per closed window, not one per tick`,
        );
      }
    } else if (decision.kind === "plan") {
      // WHAT THIS TICK DECIDED, BEFORE ANY OF IT IS ACTED ON: the plan and the cut are
      // said first, because the first launch below returns hours later and a line
      // printed after it would describe a decision the operator watched happen blind.
      for (const line of describePlan(decision)) err(`agent-protocol: ${line}`);
      if (decision.cut !== undefined) {
        // ONE record for the whole cut (D-1). The ceiling is global and it was read once,
        // so it produces one `launch-refused` — against the head of the tail — while the
        // line above names every pair it cut. N records of one ceiling would make the
        // journal of runs unreadable exactly when it is being used to explain a stall.
        appendEvent(journalPath, {
          kind: "launch-refused",
          ts: eventTimestamp(new Date()),
          role: decision.cut.recorded.role,
          thread: decision.cut.recorded.thread,
          reason: decision.cut.reason,
        });
        err(
          `agent-protocol: the launch of ${decision.cut.recorded.role}/${decision.cut.recorded.thread} was refused (${decision.cut.reason})`,
        );
      }
    }

    // THE WHOLE PLAN IS RAISED, IN THE TICK THAT COMPUTED IT (D-2). Until now only the
    // head went up and the tail waited for the next tick, because `runOne` returned when
    // the session ended — hours later — and spending the tail after it would have been
    // acting on a plan computed before the mail, the holds and the stop flag were last
    // read. That argument was about a BLOCKING tick and it dies with it: the supervisors
    // are non-blocking now, so the tail is raised beside the head against the same
    // reading, and nothing is deferred to a tick that may be half an hour away.
    const plan: readonly Candidate[] = decision.kind === "plan" ? decision.launches : [];
    for (const candidate of plan) launch(candidate, events);
    // "Nothing was launched" IS AN OUTCOME AND IS SPOKEN OUT LOUD. Before this, both
    // of these branches were a bare comment: the daemon printed its banner and either
    // exited (`--once`) or went quiet for hours, and "no mail" looked exactly like
    // "the only candidate is exhausted".
    if (decision.kind === "disabled") {
      out(`agent-protocol: daemon — launches are disabled (no '${enableFlag}'), ${next}`);
    } else if (decision.kind === "idle") {
      out(
        candidates.length === 0
          ? `agent-protocol: daemon — no candidates: no thread is waiting on ${launchable.join(", ") || "any launchable role"}, ${next}`
          : `agent-protocol: daemon — no candidate is launchable: all ${candidates.length} were skipped (see the lines above), ${next}`,
      );
    }

    // R13, second half: THE STATE OF THIS BOX AT THE END OF THE TICK. This call is no
    // longer the only one — the run above announces its own lease as it takes and
    // releases it (`onLeaseChange`) — but it stays, because a tick can change the state
    // without a run: a lease released by hand, an orphan folded away by the clock, a
    // ceiling that made a pair terminal. Only on a CHANGE, so an idle box does not turn
    // the mail branch into a heartbeat log.
    publishState();

    if (once) {
      // `--once` IS ONE TICK, AND A TICK NOW OUTLIVES ITSELF. It is the shape every check
      // and every cron entry uses, so "one tick" has to mean the work of one tick — not
      // "start N sessions and exit", which would orphan every one of them the moment the
      // process left.
      await drain("--once");
      return;
    }
    await sleep(tickMs);
    // The state is published once more after the sleep for the same reason the tick
    // publishes it at all: with non-blocking supervision a session both starts and
    // finishes between two ticks, and the digest is what the other boxes read.
    publishState();
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
 * draining), taking nothing new. `force` posts a TRACE IN THE THREAD (who/why) and
 * THEN creates the force flag with `by`/`note` (the observer reads it and puts the
 * session down at a safe point, leaving a journal trace), so that "who/when/why"
 * exists both in the journal and in the thread.
 *
 * THAT ORDER IS LOAD-BEARING, and it is the fix for the defect of 2026-07-27: with the
 * flag first, the force killed the processes before the trace was committed and pushed,
 * and the explanation stayed on one disk. Delivery first means the worst case is a stop
 * that arrives a couple of seconds later, instead of a stop nobody can account for.
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
  const loadedConfig = configFrom(argv, repoOf(root));
  const registry = loadedConfig.registry;
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
  // THE TEXT IS THE PROJECT'S (R4). This is the one message the package composes and
  // somebody else's role signs, and it lands in a CONVERSATION — R1 made the
  // package's prose English and deferred exactly this case, because the language of
  // a thread belongs to the team that writes it. The package's default stays
  // English; a project that says otherwise says it as data.
  const text = renderAnnouncement({
    kind: "force-stop",
    variables: { thread: threadId, by, reason: why },
    ...(loadedConfig.config.announcements === undefined
      ? {}
      : { templates: loadedConfig.config.announcements }),
  });

  if (!write) {
    out(
      `agent-protocol: would announce the stop in thread ${threadId} from ${by} and THEN create the force flag '${forceFlag}'; --write performs it`,
    );
    return;
  }

  // THE TRACE GOES FIRST, THE FLAG SECOND — the order IS the fix (curator, thread 019,
  // from john's live force stop of 2026-07-27 ~23:35Z). The message file was written
  // into the mail checkout and the commit+push never happened: the force put the
  // processes down before delivery got that far, so the one explanation of a forced
  // interruption did not travel — in the single case it exists for. It surfaced next
  // morning as `✗ mail: unsaved changes` in a preflight, and was delivered by hand.
  //
  // Delivery is the same one the mail uses, under the same checkout lock (D-0): a
  // forced stop writes beside a live session by construction, and that session may be
  // inside the checkout at this very moment.
  const checkout = repoOf(root);
  const trace = (): StagedMessage =>
    planThreadMessage(root, threadId, registry, { from: by, expects: "none", text });
  let delivered = false;
  try {
    const sent = deliverMessage({
      git: (args) => {
        try {
          return execFileSync("git", ["-C", checkout, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (error) {
          const failure = error as { stderr?: string; status?: number };
          const said = (failure.stderr ?? "").trim();
          throw new DeliveryRefusedError(
            `git ${args.join(" ")} failed (code ${failure.status ?? "?"})${said === "" ? "" : `:\n${said}`}`,
          );
        }
      },
      write: writeOut,
      branch: loadedConfig.config.mail.branch,
      subject: deliverySubject({ from: by, thread: threadId }),
      // The trace is a TURN in a thread, signed by whoever forced the stop (027) — the
      // same identity `new-message` commits a role's message with, not the machinery's:
      // a force stop is somebody's decision, and the commit says whose.
      identity: roleIdentity(by),
      stage: trace,
      note: out,
      lock: mailLockFor({ checkout, holder: `force stop by ${by} → ${threadId}`, note: out }),
    });
    delivered = true;
    out(
      `agent-protocol: the trace was announced in thread ${threadId} — ${sent.label}, committed and pushed to origin/${loadedConfig.config.mail.branch}`,
    );
  } catch (error) {
    if (!(error instanceof DeliveryRefusedError || error instanceof MailCheckoutBusyError))
      throw error;
    // A STOP THAT CANNOT BE ANNOUNCED STILL HAPPENS — the alternative is a circuit that
    // cannot be stopped whenever the network is out. What must not happen is a trace
    // that vanishes quietly: it is written into the checkout as it stands and said out
    // loud, twice — the delivery is broken AND the mail of this box is now dirty, which
    // blocks every other message until somebody deals with it.
    err(`agent-protocol: the trace was NOT delivered: ${(error as Error).message}`);
    try {
      const staged = trace();
      // A staged write is a LIST since a new thread is born as two files (thread 033):
      // the trace is one of them, but the undelivered fallback writes whatever was
      // planned, not the first element of it.
      for (const file of staged.files) writeOut(file.path, file.content);
      err(
        `agent-protocol: the trace was written locally and NOT delivered — '${staged.label}' sits in the mail checkout '${checkout}'. Deliver it by hand (commit + push on the mail branch); until then delivery from this box refuses on a dirty checkout`,
      );
    } catch (write) {
      err(
        `agent-protocol: and the trace could not even be written down: ${(write as Error).message} — the forced stop below has no explanation anywhere but this terminal`,
      );
    }
  }

  // Only now: the flag, and with it the sessions going down.
  mkdirSync(dirname(forceFlag), { recursive: true });
  writeFileSync(forceFlag, flagBody, "utf8");
  out(
    `agent-protocol: force stop — the flag '${forceFlag}' was created${delivered ? "" : " AFTER a failed announcement (see above)"}`,
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

/**
 * THE OPERATOR'S REF (thread 019). Every other command demands `--ref` because what
 * it reads must never be a silent choice. For `up`/`down`/`hold`/`resume` the answer
 * is not a choice at all: the project already declared it in `orchestrator.ref`, and
 * making the operator retype it on every command was ceremony without a decision
 * behind it.
 *
 * The bootstrap is the one thing to be honest about: the pointer is read FROM THE
 * WORKING TREE (the same exception `schema migrate` makes, for the same reason —
 * there is no ref yet to read a ref at), and everything after it is read at the ref
 * it names. So the working tree chooses WHICH history governs, never WHAT is in it —
 * and the choice is printed, because a bootstrap nobody sees is a default nobody
 * knows about.
 */
const withOperatorRef = (argv: readonly string[]): readonly string[] => {
  if (flag(argv, "--ref") !== undefined) return argv;
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());
  const path = join(repo, flag(argv, "--config-path") ?? DEFAULT_CONFIG_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(path, "protocol config"));
  } catch (error) {
    return fail(`'${path}' is not JSON: ${(error as Error).message}`, 2);
  }
  const ref = (parsed as { orchestrator?: { ref?: unknown } }).orchestrator?.ref;
  if (typeof ref !== "string" || ref === "") {
    return fail(
      `--ref was not given and '${path}' declares no 'orchestrator.ref' to fall back on — pass --ref <ref>`,
      2,
    );
  }
  out(`agent-protocol: --ref ${ref} (orchestrator.ref of '${path}', read from the working tree)`);
  return [...argv, "--ref", ref];
};

/** Is that pid a live process? `kill(pid, 0)` asks without sending anything. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pid the daemon was last started under, if the file is there and the process is. */
const runningDaemon = (pidFile: string): number | undefined => {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : undefined;
};

/**
 * `orchestrator up` — THE WHOLE CIRCUIT WITH ONE COMMAND (thread 019, john's target
 * scenario: arrive at the box once, type one thing, walk away).
 *
 * It is a composition of things that already existed and were never within reach of
 * one gesture: clear a stop flag left by the previous `down` (without this the fresh
 * daemon halts on its first tick, for a reason invisible from the terminal), switch
 * launches on, and send the daemon to the background the way `run -d` does it — its
 * own session, no controlling terminal, output to a file.
 *
 * Switching launches ON is part of `up` rather than a second command because typing
 * `up` IS the permission: the enable gate exists so that nobody is raised without
 * being asked for, and this is the asking. `down` does not switch it back off — that
 * is a policy statement (`disable`), while `down` is "stop the watch".
 *
 * An `up` on top of a living daemon is REFUSED, not obeyed: two daemons on one
 * journal would take the same pair twice, and the second one's banner would look
 * exactly like a healthy start.
 *
 * A FORCE FLAG ON THE FLOOR IS ALSO A REFUSAL — AT THE DOOR, and this one was paid for
 * live (john, 2026-07-27, twice in a row): `up` cleared the stop flag, reported "the
 * daemon is up, pid …", and the daemon read the force flag on its first tick and left
 * (`the daemon stopped — the force flag`). A successful banner over a process that is
 * already gone is the "silent ≠ idle" class in its purest form — the only way to find
 * out was reading `daemon.log`. Clearing it the way the stop flag is cleared would be
 * WRONG: `down` is this command's own counterpart, while a force was put down by a
 * human with a name and a reason, and taking that back has to be as deliberate as
 * putting it there. Hence: named, with who and why, and `--clear-force` to say it out
 * loud.
 */
const orchestratorUp = async (argv: readonly string[]): Promise<void> => {
  const args = withOperatorRef(argv);
  const paths = pathsFrom(args);
  const pidFile = flag(args, "--pid-file") ?? paths.daemonPid;
  const log = flag(args, "--daemon-log") ?? paths.daemonLog;
  // THE MODE A UNIT NEEDS (thread 019, systemd): the daemon runs as THIS process, so
  // systemd supervises the thing it started rather than a pid that forked away from it.
  // Everything before the spawn — the doors, the flags, the enable gate — is shared:
  // `up` is one command with one meaning, and the foreground is where its output goes.
  const foreground = args.includes("--foreground");

  const already = runningDaemon(pidFile);
  if (already !== undefined) {
    fail(
      `a daemon is already up, pid ${already} (${pidFile}) — 'orchestrator down' stops it; its output is ${log}`,
      2,
    );
    return;
  }

  const forceFlag = flag(args, "--force-flag") ?? paths.forceFlag;
  if (existsSync(forceFlag)) {
    const forced = readForceFlag(forceFlag);
    const signature = `${forced.by === undefined ? "somebody unnamed" : forced.by}: ${forced.note ?? "no reason was recorded"}`;
    if (!args.includes("--clear-force") && foreground) {
      // THE SAME REFUSAL, A CLEAN EXIT — the design risk the statement named, decided in
      // `orchestrator/systemd.ts`: under `Restart=on-failure` a refusal with code 2 would
      // be re-raised every RestartSec until the start limit, i.e. an off switch that does
      // not switch off. Nothing is raised either way; only the code differs.
      out(`agent-protocol: ${foregroundRefusal({ flagPath: forceFlag, signature })}`);
      return;
    }
    if (!args.includes("--clear-force")) {
      fail(
        `the force flag is down ('${forceFlag}') — ${signature}. A daemon started now would read it on its first tick and exit, reporting nothing to this terminal. Clear it deliberately: 'up --clear-force', or remove the file`,
        2,
      );
      return;
    }
    rmSync(forceFlag);
    out(
      `agent-protocol: the force flag was cleared on request ('${forceFlag}') — it said ${signature}`,
    );
  }

  const stopFlag = flag(args, "--stop-flag") ?? paths.stopFlag;
  if (existsSync(stopFlag)) {
    rmSync(stopFlag);
    out(`agent-protocol: the stop flag left by the last 'down' was cleared ('${stopFlag}')`);
  }
  mkdirSync(paths.state, { recursive: true });
  if (!existsSync(paths.enableFlag)) {
    writeFileSync(paths.enableFlag, "", "utf8");
    out(`agent-protocol: launches are ENABLED ('${paths.enableFlag}')`);
  }

  // The daemon is started as itself — the flags are passed through as typed, plus the
  // ref that was resolved above. `--pid-file`/`--daemon-log` are `up`'s own and are
  // dropped: the daemon knows nothing about them.
  const passthrough: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const token = args[at] as string;
    if (token === "--pid-file" || token === "--daemon-log" || token === "--log-max-bytes") {
      at += 1;
      continue;
    }
    // `--clear-force` is a decision about the DOOR, taken above; the daemon behind it
    // knows nothing of the flag and must not be told to clear anything.
    if (token === "--clear-force") continue;
    // `--foreground` is a decision about WHO RUNS the daemon, not a daemon flag.
    if (token === "--foreground") continue;
    passthrough.push(token);
  }
  mkdirSync(dirname(log), { recursive: true });
  // THE LOG DOES NOT GROW WITHOUT END, AND ITS EPOCHS ARE LEGIBLE (thread 019, addendum
  // of 10:50Z: 18 MB in a week, every daemon's lines in one undivided stream). The
  // decision — rotate at the start, keep one generation, banner every epoch — and why
  // it is not `daemon-<start>.log`: `orchestrator/logsize.ts`.
  const capTyped = flag(args, "--log-max-bytes");
  const cap = capTyped === undefined ? undefined : Number(capTyped);
  if (cap !== undefined && (!Number.isFinite(cap) || cap <= 0)) {
    fail(`--log-max-bytes '${capTyped}' — expected a positive number of bytes`, 2);
    return;
  }
  const rotated = rotateDaemonLog({ path: log, ...(cap === undefined ? {} : { cap }) });
  if (rotated !== undefined) out(`agent-protocol: ${rotated}`);
  if (foreground) {
    // The pid and the argv are written exactly as the backgrounded path writes them:
    // `status`, `down` and `restart` know a daemon as "the pid in `daemon.pid`", and a
    // daemon under a unit must be the same daemon to all three.
    writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    writeFileSync(daemonArgvPath(pidFile), renderDaemonArgv(passthrough), "utf8");
    writeEpochBanner({
      path: log,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      mode: "foreground",
    });
    // BOTH SINKS, ONE STREAM (the statement: journalctl AND the usual daemon.log).
    // systemd captures the standard streams, `orchestrator log` reads the file — a
    // mirror keeps them the same text instead of asking the operator which one is real.
    const mirror = openSync(log, "a");
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
        try {
          if (typeof chunk === "string") writeSync(mirror, chunk);
          else writeSync(mirror, Buffer.from(chunk));
        } catch {
          // A full or unwritable log must never take the daemon down: the stream systemd
          // reads is the one that matters, the file is the convenience.
        }
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
    }
    out(
      `agent-protocol: the daemon runs in the FOREGROUND, pid ${process.pid} · its output is this stream and ${log}`,
    );
    await orchestratorDaemon(passthrough);
    return;
  }
  const sink = openSync(log, "a");
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1] as string, "orchestrator", "daemon", ...passthrough],
    { detached: true, stdio: ["ignore", sink, sink], cwd: process.cwd(), env: process.env },
  );
  child.unref();
  closeSync(sink);
  writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  // The seam between this daemon's lines and the previous one's — the same banner the
  // foreground path writes, so the file reads the same whoever raised the daemon.
  writeEpochBanner({
    path: log,
    pid: child.pid as number,
    startedAt: new Date().toISOString(),
    mode: "background",
  });
  // WITH WHAT IT WAS RAISED, beside the pid — the answer `restart` needs and the only
  // one nobody has today: the flags of a backgrounded daemon live in the terminal that
  // typed them, i.e. in somebody's memory an hour later (see `restart.ts`).
  writeFileSync(daemonArgvPath(pidFile), renderDaemonArgv(passthrough), "utf8");
  out(`agent-protocol: the daemon is up in the background, pid ${child.pid} · its output ${log}`);
  out(
    "agent-protocol: 'orchestrator status' shows the circuit, 'orchestrator down' stops it after the current session",
  );
};

/**
 * `orchestrator down` — the graceful stop without the ritual (`stop --mode graceful
 * --write` with the ref resolved). The daemon finishes the session it is running and
 * exits at the next tick, so the answer an operator needs — "is it gone yet" — is
 * printed as the pid to watch rather than implied.
 */
const orchestratorDown = (argv: readonly string[]): void => {
  const args = withOperatorRef(argv);
  const paths = pathsFrom(args);
  const stopFlag = flag(args, "--stop-flag") ?? paths.stopFlag;
  mkdirSync(dirname(stopFlag), { recursive: true });
  writeFileSync(stopFlag, "", "utf8");
  const pid = runningDaemon(flag(args, "--pid-file") ?? paths.daemonPid);
  out(
    pid === undefined
      ? `agent-protocol: the stop flag is set ('${stopFlag}') — no backgrounded daemon of this box is running; an attached one exits at its next tick`
      : `agent-protocol: the stop flag is set ('${stopFlag}') — pid ${pid} finishes the current session and exits at its next tick`,
  );
  out("agent-protocol: launches stay enabled — 'orchestrator disable' is the policy switch");
};

/**
 * `orchestrator restart` — DOWN, WAIT, (PULL), UP AS ONE GESTURE (thread 019, statement
 * of 2026-07-31: picking up fresh code was a hand-run pipeline four times in two days,
 * twice with a stumble). Why the argv of the new daemon comes from state rather than
 * from the operator, and why this process does the waiting instead of a successor
 * daemon — `orchestrator/restart.ts`.
 *
 * IT IS A COMPOSITION AND NOTHING ELSE: `down` (or `stop --mode force`, trace first),
 * then the wait, then `up`. The three keep their semantics down to the letter — a
 * restart that reimplemented any of them would be a second place where "stop" means
 * something, and the first divergence would be found on a live circuit.
 *
 * A REFUSAL ANYWHERE LEAVES THE CIRCUIT DOWN, DELIBERATELY. If the wait runs out, or
 * the pull or the install fails, nothing is raised: the operator asked for the NEW code
 * to be running, and raising the old one instead would answer a question nobody asked
 * while looking exactly like success. The stop flag stays down, the reason is printed
 * and appended to the daemon log, and `up` by hand is one word away.
 */
const orchestratorRestart = async (argv: readonly string[]): Promise<void> => {
  const args = withOperatorRef(argv);
  const mode = flag(args, "--mode") ?? "graceful";
  if (mode !== "graceful" && mode !== "force") {
    fail(`--mode '${mode}' — allowed values are graceful | force`, 2);
    return;
  }
  const paths = pathsFrom(args);
  const pidFile = flag(args, "--pid-file") ?? paths.daemonPid;
  const logPath = flag(args, "--daemon-log") ?? paths.daemonLog;
  // The phases are said to the terminal AND written where a backgrounded daemon speaks:
  // a restart that refused at 04:00 has to be readable at 09:00, and the terminal it
  // spoke into is gone by then.
  const say = (text: string): void => {
    out(`agent-protocol: restart — ${text}`);
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `[restart ${new Date().toISOString().slice(0, 19)}Z] ${text}\n`);
    } catch {
      // The log is a courtesy here, not the channel: a restart must not fail because
      // the file it wanted to annotate is unwritable.
    }
  };

  const pid = runningDaemon(pidFile);
  const saved = existsSync(daemonArgvPath(pidFile))
    ? parseDaemonArgv(readFile(daemonArgvPath(pidFile), "the daemon's saved flags"))
    : undefined;

  // Phase 1 — the stop, in the form that was asked for.
  if (mode === "force") {
    const by = operatorSignature(args);
    if (by === undefined) return;
    say(`stopping by force, signed by ${by} — the trace goes to the thread before the flag`);
    orchestratorStop([...args, "--mode", "force", "--by", by, "--write"]);
  } else {
    say(
      pid === undefined
        ? "no backgrounded daemon of this box is running — setting the stop flag anyway (an attached one exits at its next tick)"
        : `stopping pid ${pid} gracefully — it finishes the sessions it is running`,
    );
    orchestratorDown(args);
  }

  // Phase 2 — the wait. This is the part john was doing by hand, with no idea how long.
  const waitSec = Number(flag(args, "--wait") ?? DEFAULT_RESTART_WAIT_SEC);
  if (!Number.isFinite(waitSec) || waitSec <= 0) {
    fail(`--wait '${flag(args, "--wait")}' — seconds to wait for the daemon to leave`, 2);
    return;
  }
  const outcome = await awaitDaemonExit({
    pid,
    alive,
    sleep,
    now: () => Math.round(Date.now() / 1000),
    waitSec,
    pollSec: DEFAULT_RESTART_POLL_SEC,
    note: (waited) => say(`still waiting for pid ${pid} to leave — ${waited}s so far`),
  });
  if (outcome.kind === "timeout") {
    say(
      `the daemon (pid ${pid}) is STILL up after ${outcome.waitedSec}s — nothing was raised, the stop flag stays down. Its sessions are visible in 'orchestrator status'; 'restart --mode force' puts them down with a trace`,
    );
    fail(`the daemon did not leave within ${waitSec}s — nothing was restarted`, 1);
    return;
  }
  say(
    outcome.kind === "absent"
      ? "no daemon had to be waited out"
      : `the daemon left after ${outcome.waitedSec}s`,
  );

  // Phase 3 — the fresh code, when it was asked for.
  if (args.includes("--pull")) {
    const repo = flag(args, "--repo") ?? homeOf(process.cwd());
    for (const step of [
      { what: "git pull --ff-only", run: ["git", ["-C", repo, "pull", "--ff-only"]] as const },
      { what: "pnpm install", run: ["pnpm", ["--dir", repo, "install"]] as const },
    ]) {
      say(`${step.what} in '${repo}'`);
      try {
        const said = execFileSync(step.run[0], [...step.run[1]], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        const tail = said.trim().split("\n").slice(-3).join(" · ");
        say(`${step.what} — ok${tail === "" ? "" : `: ${tail}`}`);
      } catch (error) {
        const failure = error as { stderr?: string; stdout?: string; status?: number };
        const why = (failure.stderr ?? failure.stdout ?? "").trim();
        say(
          `${step.what} FAILED (code ${failure.status ?? "?"})${why === "" ? "" : `: ${why}`} — nothing was raised, the circuit stays down until this is dealt with`,
        );
        fail(`${step.what} failed — the daemon was NOT raised`, 1);
        return;
      }
    }
  }

  // Phase 4 — up, with the flags of the daemon that was stopped.
  const chosen = daemonArgvFor({ saved, typed: args });
  say(
    chosen.source === "state"
      ? `raising the daemon with the flags it was stopped with (${daemonArgvPath(pidFile)}): ${chosen.argv.join(" ") || "none"}`
      : `the stopped daemon left no record of its flags (${daemonArgvPath(pidFile)}) — raising it with the flags typed here: ${chosen.argv.join(" ") || "none"}`,
  );
  const upFlags: string[] = [...chosen.argv];
  // The two paths belong to THIS command, not to the daemon, so `up` never saved them.
  for (const own of ["--pid-file", "--daemon-log"] as const) {
    const value = flag(args, own);
    if (value !== undefined && !upFlags.includes(own)) upFlags.push(own, value);
  }
  // A force stop put the force flag down a minute ago — clearing it here is not the
  // silent clearing `up` refuses, it is the same operator saying so in the same breath.
  if (mode === "force") upFlags.push("--clear-force");
  await orchestratorUp(upFlags);
};

/**
 * WHO IS OPERATING THIS BOX — the flag, then `operator` of the machine config (R14),
 * then `$USER`, checked against the config's roles. Shared by the short forms that sign
 * something in somebody's name (`hold <role>`, `restart --mode force`): a signature is
 * a role of the circuit, and free text in that place would be an identity nobody can
 * check.
 */
const operatorSignature = (args: readonly string[]): string | undefined => {
  const local = localFrom(args);
  const typed = flag(args, "--by");
  const account = process.env["USER"];
  const signature: readonly [string, string] | undefined =
    typed !== undefined
      ? [typed, "the flag"]
      : local.config.operator !== undefined
        ? [local.config.operator, `'operator' of ${local.path}`]
        : account !== undefined && account !== ""
          ? [account, "$USER"]
          : undefined;
  const registry = registryFrom(args, undefined);
  if (signature === undefined || !registry.isKnown(signature[0])) {
    fail(
      signature === undefined
        ? `--by was not given, '${local.path}' declares no 'operator' and $USER is not set — this action is signed by a role of the config`
        : `--by '${signature[0]}' (from ${signature[1]}) is not a role of the config — pass --by <role>, or set 'operator' in '${local.path}'`,
      2,
    );
    return undefined;
  }
  return signature[0];
};

/**
 * The SHORT PARKING FORMS: `hold <role>` / `resume <role>` (thread 019). The strict
 * forms stay exactly as they were — this is the same action with the two answers the
 * operator was retyping filled in: the ref from the config, `--by` from the machine
 * (`operator` of `local.json`, then `$USER`).
 *
 * They ACT rather than plan. `--write` on the strict form guards a change nobody can
 * see; a hold is visible in one command (`status`) and undone in one word, and a dry
 * run that then has to be repeated with a flag is the ceremony this package was asked
 * to take off the operator.
 */
const orchestratorHoldShort = (argv: readonly string[]): void => {
  const args = withOperatorRef(argv.slice(1));
  const role = argv[0] as string;
  // THREE ANSWERS, IN THIS ORDER: the flag (this one hold), `operator` of the machine
  // config (who sits at this box — R14), `$USER` (the box where the account name is a
  // role by luck) — `operatorSignature`, shared with `restart --mode force`.
  const by = operatorSignature(args);
  if (by === undefined) return;
  orchestratorHold([...args, "--mode", "take", "--role", role, "--by", by, "--write"]);
};

const orchestratorResumeShort = (argv: readonly string[]): void => {
  const args = withOperatorRef(argv.slice(1));
  orchestratorHold([...args, "--mode", "release", "--role", argv[0] as string, "--write"]);
};

/**
 * A TYPO IS REFUSED AT THE DOOR (thread 019, item 3) — see `orchestrator/argv.ts`
 * for why the table is the usage text itself.
 *
 * It is applied to the ORCHESTRATOR commands: that is where the defect was found
 * (`daemon -d` swallowed and started attached) and where an unknown flag costs a
 * whole session raised with the wrong settings. `up` accepts everything `daemon`
 * does, because it is the same daemon with its start-up done for the operator.
 */
const USAGE_FLAGS = parseUsage(USAGE);

const guardArguments = (key: string, argv: readonly string[]): void => {
  const spec = USAGE_FLAGS.get(key);
  // A command with no line in the usage block is a command the help text does not
  // document — the guard says so instead of waving it through.
  if (spec === undefined) {
    fail(`'${key}' is not described in the usage block — the check has nothing to go by`, 2);
    return;
  }
  const daemon = USAGE_FLAGS.get("orchestrator daemon");
  const merged =
    (key === "orchestrator up" || key === "orchestrator restart") && daemon !== undefined
      ? {
          value: [...spec.value, ...daemon.value],
          boolean: [...spec.boolean, ...daemon.boolean],
          positionals: spec.positionals,
        }
      : spec;
  const problems = strayArguments(argv, merged);
  if (problems.length === 0) return;
  err(`agent-protocol: '${key}' does not understand what it was given:`);
  for (const problem of problems) err(`- ${problem}`);
  fail(USAGE, 2);
};

/**
 * THE STAGED/CHANGED PATHS CHECKED AGAINST THE ROLE'S ZONES — doors 2 and 3 of thread
 * 020 in ONE command, because they ask the same question of the same data and only
 * differ in where the paths come from (`git diff --cached` in a pre-commit hook,
 * `git diff <base>...HEAD` in CI).
 *
 * WHICH CONFIG THE VERDICT IS PASSED WITH — `--ref`, and door 3 must point it at the
 * BASE of the pull request rather than at its head. A PR that widens its own zone in
 * `agent-protocol.json` and immediately writes into the widened part would otherwise be
 * green by its own permission: exactly the property door 2 protects by reading
 * `origin/main`. Widening a zone is a PR of its own, like a workflow change.
 *
 * AND THEREFORE THIS COMMAND ASKS A POLICY QUESTION, NOT A DATA ONE (`intent: policy`,
 * thread 037). Both doors point at a ref the change has not landed in yet, so on a PR
 * that touches the protocol's own shape the config they read is at ANOTHER SHAPE than
 * the binary reading it BY CONSTRUCTION — that is what such a PR is. Parsed strictly,
 * it refuses before it ever gets to the zones, and both doors go red on exactly the
 * class of change where a zone violation would matter most. The question asked here is
 * not "is this repository migrated" but "which paths does the BASE policy forbid this
 * role", and the answer depends on three fields that no version has ever moved
 * (`grep -l zones src/schema/v*.ts` is empty across v2…v14). So the shape is read
 * NARROWLY — only those fields, from whatever version the base is at — and the skew is
 * always PRINTED, never assumed. The predecessor of this, `tolerateOlder`, relaxed the
 * NUMBER alone and could not survive a bump of the FORM: see `config/policy.ts`.
 *
 * WHY THE ROLE MAY BE INFERRED FROM THE DIRECTORY (`--role-from-workspace`). A
 * pre-commit hook has no idea whose commit it is guarding, and asking the operator to
 * configure the role per checkout would put the answer in a place that drifts. R17
 * already made "whose tree is this" answerable by reading the path — one role, one
 * worktree named after it under `orchestrator.workdir.worktrees` — so the hook reads
 * it there. A checkout that is NOT a role workspace (the operator's own, a CI
 * checkout, the mail worktree) is passed with a note and never a refusal: the guard
 * belongs to the raised sessions, and a human committing in their own tree is not
 * what it is for.
 */
const zonesCheck = (argv: readonly string[]): void => {
  const repo = repoOf(flag(argv, "--repo") ?? process.cwd(), gitEnvOutsideHook());
  const loaded = policyFrom(argv);
  // SAID OUT LOUD, NEVER SILENT: the base is at another version because this very
  // change moves it. The guard still runs — the zones it enforces are the base's —
  // and the skew is printed so that "green" here never means "the shapes match".
  const skew = describePolicySkew(loaded);
  if (skew !== undefined) out(`agent-protocol: zones — ${skew}`);
  const explicit = flag(argv, "--role");
  const fromWorkspace = argv.includes("--role-from-workspace");
  if (explicit !== undefined && fromWorkspace) {
    fail("--role and --role-from-workspace say the same thing two ways — pass one", 2);
    return;
  }

  let roleId = explicit;
  if (fromWorkspace) {
    const worktrees = loaded.config.orchestrator?.workdir?.worktrees;
    if (worktrees === undefined) {
      out(
        "agent-protocol: zones — no workspaces declared (orchestrator.workdir.worktrees), nothing to infer a role from",
      );
      return;
    }
    const here = repo.replace(/\/+$/, "");
    const candidate = here.slice(here.lastIndexOf("/") + 1);
    const expected = workspacePath({
      repo: repoOf(`${here}/..`, gitEnvOutsideHook()),
      worktrees,
      role: candidate,
    });
    if (expected !== here || policyRole(loaded.config, candidate) === undefined) {
      out(`agent-protocol: zones — '${here}' is not a role workspace, the guard does not apply`);
      return;
    }
    roleId = candidate;
  }
  if (roleId === undefined) {
    fail("--role <id> (or --role-from-workspace) — the zones being enforced are a role's", 2);
    return;
  }
  const role = policyRole(loaded.config, roleId);
  if (role === undefined) {
    fail(
      `--role '${roleId}' — there is no such role in the config, there are no zones to enforce`,
      2,
    );
    return;
  }

  const base = flag(argv, "--base");
  const listed = flag(argv, "--paths");
  const staged = argv.includes("--staged");
  const sources = [base !== undefined, listed !== undefined, staged].filter(Boolean).length;
  if (sources !== 1) {
    fail("exactly one source of paths is required: --staged, --base <ref> or --paths <a,b>", 2);
    return;
  }
  const source: ChangedPathsSource | undefined = staged
    ? { kind: "staged" }
    : base === undefined
      ? undefined
      : { kind: "range", base };
  const paths =
    source === undefined
      ? (listed ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : parseChangedPaths(
          gitAsk(changedPathsGitArgs({ repo, source }), gitEnvOutsideHook()) ??
            fail(`the changed paths were not read from git (${staged ? "--cached" : base})`, 2),
        );

  const outside = pathsOutsideZones({ role, paths });
  if (outside.length === 0) {
    out(`agent-protocol: zones — ${paths.length} path(s) of '${roleId}' are inside its zone`);
    return;
  }
  err(`agent-protocol: '${roleId}' may not write these paths (${describeZones(role)}):`);
  for (const path of outside) err(`  ${path}`);
  fail(
    "the zones of the role are its statement of work — take these files out of the change, or have the zone widened in agent-protocol.json through a PR",
    1,
  );
};

/**
 * THE MERGE DOOR OF `curator` (thread 026): the three guards that are facts, checked
 * in one call instead of by eye over a `gh pr view` dump. Its answer is never "merge
 * it" — guards 3 and 5 are judgements and are printed as obligations (see
 * `merge/gate.ts` for why the tool refuses to speak for them).
 *
 * `gh` IS THE DEPENDENCY, deliberately and only here: it already is what a session
 * runs to look at a PR, its authentication is the operator's, and reaching for the
 * REST API instead would put a token in the package's hands for no gain.
 *
 * AND THAT TOKEN NEEDS SCOPES IT MAY NOT HAVE — the refusal is observed and not
 * hypothetical (the reviewer's finding on this very PR). Guard 2 reads
 * `statusCheckRollup`, which GraphQL serves only to a token holding `checks: read`, and
 * `gh` asks inside it for `checkSuite.workflowRun`, which is ACTIONS and wants
 * `actions: read`. A personal token has both; a GitHub App installation token (`ghs_…`,
 * what any `gh-action` executor of this protocol runs with) has ONLY what its job's
 * `permissions:` block lists — and, through `claude-code-action`, only what the token
 * exchange asked for in `additional_permissions`; unlisted is zeroed, not defaulted. The
 * whole call then fails — `Resource not accessible by integration` — instead of
 * degrading, so a gate run from such a job answers nothing at all rather than answering
 * wrongly. WHICH scope is missing the command does NOT declare: it prints the reason
 * `gh` returned and reads the path GitHub named (`merge/gh.ts` → `ghRefusalHint`, where
 * the cost of the declaring version is written down).
 *
 * AND `mergeable` IS COMPUTED LAZILY BY GITHUB: the first ask about a pull request
 * starts the job and answers `UNKNOWN`, the next one answers for real — on every open
 * PR of this repository, not now and then. Since the door refuses on anything that is
 * not `MERGEABLE` (D2), a single ask would make it refuse almost every first run with
 * "ask again" — so the command asks again ITSELF, once, and only then reports `UNKNOWN`
 * as the answer it is.
 *
 * `--power-docs` IS A FLAG AND NOT A CONFIG SECTION, and the reason it stayed one is
 * now HISTORY rather than a constraint: a new config field costs a protocol version by
 * R2, and a version bump used to be uncommittable — the zones door read the config of
 * the base with the package of the working tree and halted on the mismatch. That door
 * asks a policy question since thread 037 and no longer halts, so moving the list into
 * the config is a decision about shape, not a blocked one; until somebody takes it, the
 * extra documents of power are named on the command line by whoever runs the gate, and
 * the role card holds the invocation. The derived two — the role cards and the config —
 * need no list either way.
 *
 * AND THIS COMMAND READS ITS CONFIG AS POLICY (thread 037, the same PR): it is the
 * SECOND copy of the zones door — a foreign ref (the base of the PR) asked which
 * documents are documents of power. It stayed green until now only because the curator
 * runs it from a checkout of `main` with `--ref origin/main`, where the two sides
 * coincide; from a branch that moves the shape it would fail exactly like door 3 did.
 */
const mergeGate = (argv: readonly string[]): void => {
  const number = required(argv, "--pr");
  if (!/^\d+$/.test(number)) {
    fail(`--pr '${number}' — the number of a pull request`, 2);
    return;
  }
  const loaded = policyFrom(argv);
  const skew = describePolicySkew(loaded);
  if (skew !== undefined) out(`merge-gate: ${skew}`);
  const repo = flag(argv, "--repo") ?? process.cwd();

  const ask = (): string =>
    execFileSync(
      "gh",
      [
        "pr",
        "view",
        number,
        "--json",
        // `mergeable`/`mergeStateStatus`: what GitHub itself would refuse (D2).
        // `commits` beside `reviews`: the date of the head commit, the one fact a
        // substituted review anchor cannot fake (thread 043).
        "number,headRefOid,body,statusCheckRollup,reviews,commits,files,mergeable,mergeStateStatus",
      ],
      {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      },
    );

  let raw: string;
  try {
    raw = ask();
    // GitHub computes `mergeable` LAZILY: the first ask starts the job and answers
    // UNKNOWN, the next one answers for real (observed on every open PR of this repo).
    // Asking again is what the refusal would tell a human to do, so the command does it
    // once itself — and only then reports UNKNOWN as the answer it is.
    if (/"mergeable"\s*:\s*"UNKNOWN"/.test(raw)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      raw = ask();
    }
  } catch (error) {
    const message = (error as Error).message;
    // The reason `gh` returned is the fact and is printed whole; the hint is a reading
    // of it and says so (`ghRefusalHint` — why it stopped asserting a scope).
    fail(`PR #${number} was not read through gh: ${message}${ghRefusalHint(message)}`, 2);
    return;
  }

  const parsed = ghPullRequestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    fail(
      `the answer of gh about PR #${number} is not the shape this command reads: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
      2,
    );
    return;
  }

  const list = (name: string): readonly string[] =>
    (flag(argv, name) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const workingCards = list("--working-cards");
  const powerDocs = powerDocuments({
    roles: loaded.config.roles,
    configPath: loaded.path,
    declared: list("--power-docs"),
    workingCards,
  });
  // Never silent in either direction: what was subtracted, and what the subtraction
  // did not find — a flag that matches no role's instructions is doing nothing.
  if (workingCards.length > 0) {
    out(`merge-gate: working cards, not documents of power: ${workingCards.join(", ")}`);
    const stray = unmatchedWorkingCards({ roles: loaded.config.roles, workingCards });
    if (stray.length > 0) {
      out(`merge-gate: --working-cards matches no role's instructions: ${stray.join(", ")}`);
    }
  }
  const verdict = evaluateMergeGate({
    pr: {
      number: parsed.data.number,
      headSha: parsed.data.headRefOid,
      body: parsed.data.body,
      reviews: parsed.data.reviews.map((review) => ({
        state: review.state,
        commitSha: review.commit?.oid,
        author: review.author?.login,
        // The stamp guard 1 tells a second round of review by (D4).
        submittedAt: review.submittedAt ?? undefined,
      })),
      // When the head commit was made — a verdict older than it answered about code that
      // did not exist yet (thread 043). Only the head's own entry counts.
      headCommittedAt:
        parsed.data.commits.find((commit) => commit.oid === parsed.data.headRefOid)
          ?.committedDate ?? undefined,
      checks: parsed.data.statusCheckRollup.map((check) => ({
        // A flying run answers `conclusion: ""`, not null — the gate reads emptiness as
        // absence itself (D3), so the mapping stays a mapping.
        name: check.name ?? check.context ?? "?",
        status: check.status ?? undefined,
        conclusion: check.conclusion ?? undefined,
        state: check.state ?? undefined,
        completedAt: check.completedAt ?? undefined,
        startedAt: check.startedAt ?? undefined,
      })),
      changedPaths: parsed.data.files.map((file) => file.path),
      mergeable: parsed.data.mergeable,
      mergeStateStatus: parsed.data.mergeStateStatus ?? undefined,
    },
    powerDocs,
  });

  for (const line of describeMergeGate(verdict)) out(line);
  if (!verdict.curatorMayMerge) process.exit(1);
};

const main = async (argv: readonly string[]): Promise<void> => {
  const [command, subcommand] = argv;
  if (command === "orchestrator" && subcommand !== undefined) {
    // `systemd` is the one orchestrator command with a TWO-WORD name, so both the key of
    // the table and the argv the guard reads shift by a token: keyed on the first word
    // alone it would look up a usage line that does not exist and refuse everything.
    const two = subcommand === "systemd" && argv[2] !== undefined;
    guardArguments(
      two ? `orchestrator systemd ${argv[2]}` : `orchestrator ${subcommand}`,
      argv.slice(two ? 3 : 2),
    );
  }
  if (command === "config" && subcommand === "check") {
    configCheck(argv.slice(2));
  } else if (command === "config" && subcommand === "set") {
    guardArguments("config set", argv.slice(2));
    configSet(argv.slice(2));
  } else if (command === "doctor") {
    doctor(argv.slice(1));
  } else if (command === "init") {
    guardArguments("init", argv.slice(1));
    boxInit(argv.slice(1));
  } else if (command === "schema" && subcommand === "migrate") {
    schemaMigrate(argv.slice(2));
  } else if (command === "merge-gate") {
    mergeGate(argv.slice(1));
  } else if (command === "zones" && subcommand === "check") {
    zonesCheck(argv.slice(2));
  } else if (command === "roles" && subcommand === "list") {
    rolesList(argv.slice(2));
  } else if (command === "role" && subcommand === "exists") {
    roleExists(argv.slice(2));
  } else if (command === "index" && subcommand === "build") {
    indexBuild(argv.slice(2));
  } else if (command === "thread" && subcommand === "build") {
    threadBuild(argv.slice(2));
  } else if (command === "thread" && subcommand === "show") {
    threadShow(argv.slice(2));
  } else if (command === "check") {
    checkAll(argv.slice(1));
  } else if (command === "migrate") {
    migrate(argv.slice(1));
  } else if (command === "derive") {
    derive(argv.slice(1));
  } else if (command === "metrics") {
    metrics(argv.slice(1));
  } else if (command === "tasks") {
    if (argv[1] !== "list") fail(`unknown 'tasks' subcommand '${argv[1] ?? ""}'\n${USAGE}`, 2);
    tasksList(argv.slice(2));
  } else if (command === "new-message") {
    newMessage(argv.slice(1));
  } else if (command === "new-thread") {
    newThread(argv.slice(1));
  } else if (command === "mail") {
    mail(argv.slice(1));
  } else if (command === "await-input") {
    await awaitInput(argv.slice(1));
  } else if (command === "notify") {
    await notify(argv.slice(1));
  } else if (command === "orchestrator" && subcommand === "status") {
    orchestratorStatus(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "tui") {
    guardArguments("orchestrator tui", argv.slice(2));
    orchestratorTui(argv.slice(2));
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
  } else if (command === "orchestrator" && subcommand === "up") {
    await orchestratorUp(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "down") {
    orchestratorDown(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "restart") {
    await orchestratorRestart(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "resume") {
    orchestratorResumeShort(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "hold") {
    // `hold <role>` (a bare word first) is the operator's form; anything else is the
    // strict one, unchanged.
    const rest = argv.slice(2);
    const first = rest[0];
    if (first !== undefined && !first.startsWith("-")) orchestratorHoldShort(rest);
    else orchestratorHold(rest);
  } else if (command === "orchestrator" && subcommand === "preflight") {
    orchestratorPreflight(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "enable") {
    orchestratorEnable(argv.slice(2), true);
  } else if (command === "orchestrator" && subcommand === "disable") {
    orchestratorEnable(argv.slice(2), false);
  } else if (command === "orchestrator" && subcommand === "systemd-unit") {
    orchestratorSystemdUnit(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "systemd" && argv[2] === "install") {
    orchestratorSystemdInstall(argv.slice(3));
  } else {
    fail(USAGE, 2);
  }
};

main(process.argv.slice(2)).catch((error) => {
  err(`agent-protocol: uncaught error: ${(error as Error).message}`);
  process.exit(1);
});
