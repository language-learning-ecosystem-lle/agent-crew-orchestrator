/**
 * THE DAEMON AS A UNIT — a circuit that outlives the terminal that started it (thread
 * `019-operator-ux`, statement of 2026-07-31 09:43Z; the last-but-one precondition of a
 * VPS instance, wave 016).
 *
 * `up` today backgrounds the daemon by hand: its own session, no controlling terminal,
 * output into `daemon.log`. That is enough for a laptop somebody sits at and not enough
 * for a resident box, where the daemon has to survive a reboot, its own crash and the
 * operator's SSH session going away. systemd already does all three; what was missing
 * was a way to hand it a process it can actually see, and a unit file nobody has to
 * write by hand on every box.
 *
 * THREE DECISIONS ARE WRITTEN DOWN HERE, because each of them is a place the obvious
 * choice is wrong.
 *
 * 1. USER-LEVEL, NOT SYSTEM-LEVEL. The daemon raises agent sessions as the operator:
 * they read that user's `~/.config/agent-protocol/local.json` (R14), that user's agent
 * credentials and that user's git identity. A system unit would run them as root or
 * force a `User=` line plus an environment reconstructed by hand — the whole R14 line
 * ("the machine says WHERE") would move into the unit file, in a second copy that
 * drifts. The price of user-level is that a user's units die with their last session,
 * and that is exactly what `loginctl enable-linger` exists for — so linger is not an
 * afterthought in the instructions, it is the thing that makes this mode equal to a
 * system unit for our purpose.
 *
 * 2. `Restart=on-failure` MUST NOT FIGHT THE FLAGS — the design risk the statement
 * named, and the reason `foregroundRefusal` exists. The stop and force flags are files:
 * the daemon reads them at the top of every tick and LEAVES. Under a unit that restart
 * policy would then re-raise it, and the flag would be re-read, and the box would spin
 * — an off switch that does not switch anything off. The answer is that the exit code
 * carries the meaning: EXIT BY FLAG IS `success` (code 0), so `on-failure` does not
 * fire. The daemon loop already returns normally on both flags, so the guarantee is by
 * construction on that side; the side that had to change is `up`'s DOOR, which refuses
 * a start over a lying force flag with code 2. That refusal is right in a terminal (a
 * human typed `up` and must be told why nothing happened) and wrong under a unit, where
 * it is not a failure at all — it is the flag doing its job. Hence: in the foreground
 * mode the same refusal is spoken and exits 0. Nothing else about the flags changes;
 * `up`/`down`/`stop` keep their semantics down to the letter, the unit only wraps them.
 *
 * 3. THE UNIT IS GENERATED FROM THE CONFIG, NOT TYPED. `WorkingDirectory` is the repo
 * this command was run in, the interpreter is the one running it, and the daemon flags
 * are the ones the operator hands `systemd install` once. A unit typed per box is a
 * fourth place the paths live, and the first to go stale — the same reason `restart`
 * reads the daemon's argv from beside its pid instead of from memory.
 *
 * 4. "THE INTERPRETER IS THE ONE RUNNING IT" IS NOT `process.execPath` — the defect the
 * first live unit died of (`lle-agents`, 2026-08-02 ~19:23Z, thread 019 msg 4). This CLI
 * is TypeScript and is started everywhere else through tsx (`pnpm … cli`); `execPath` is
 * the bare node UNDER tsx, and a unit built out of it fails on the first import
 * (`ERR_MODULE_NOT_FOUND: …/config/config.js imported from …/cli.ts` — the `.js` suffixes
 * of an ESM source tree resolve only with the loader on). So the interpreter of the unit
 * is node PLUS the loader (`--import <…>/tsx/dist/loader.mjs`), by ABSOLUTE path: a bare
 * `tsx` specifier would be resolved against `WorkingDirectory` at start time, and a
 * `.bin/tsx` shim would put a second process between systemd and the daemon. A `.js`
 * entry point (a built one) takes no loader — the suffix decides, not a flag.
 *
 * The same live repro named the other half: `StartLimitIntervalSec`/`StartLimitBurst`
 * belong to `[Unit]`, not `[Service]`. systemd does not fail on them in the wrong
 * section, it prints "Unknown key name" into the journal and runs on WITHOUT the ceiling
 * — a crash loop guard that silently is not one. `systemd-analyze --user verify` catches
 * exactly this class, which is why the install now prints it as the first human step.
 *
 * 5. THE UNIT CARRIES A `PATH`, BECAUSE ITS CHILDREN NEED ONE (the third fix of the same
 * repro, statement of 2026-08-02 19:42:30Z). Decision 4 makes the DAEMON start under a
 * minimal environment — node and the loader are absolute files and need no `PATH` at all.
 * The processes the daemon then spawns are a different question: the agent binary is
 * resolved through the child's `PATH` (`preflight.ts`, "not found in the child process
 * PATH — the spawn would fail with the lease already taken"), and so are `git` and `sh`,
 * which the circuit shells out to on every tick. A unit without `Environment=PATH=` starts,
 * verifies green and raises nobody — the same "looks installed, half the guarantees are
 * missing" class as the start limit, one step further along. So the unit states the `PATH`
 * it needs and states it from the facts of this box: the directory of the interpreter that
 * wrote it, the directory of every agent binary the machine config declares (R14), and the
 * system directories underneath. A login shell's `PATH` is not inherited by a user unit and
 * must not be — that would be a fourth place the paths live (decision 3).
 *
 * 6. `RestartPreventExitStatus=2` — EXIT 2 IS "THE ARGUMENTS DO NOT RESOLVE", and no
 * amount of restarting resolves them. It is this package's refusal code throughout (a bad
 * ref, an unknown instance, an unreadable config), i.e. exactly the failure a human has to
 * go and fix. Without this line systemd re-raises it every `RestartSec` until the start
 * limit, and the operator's first sentence from `status` is "start request repeated too
 * quickly" — the ceiling talking, not the fault. That is how the first live diagnosis on
 * `lle-agents` lost its opening minute. With it, the unit stops on the first refusal and
 * `status` shows the real exit; a genuine crash (any other code) still restarts.
 */

import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/** A token of `ExecStart`: systemd splits on whitespace, so a path with a space is quoted. */
const quoted = (token: string): string =>
  /[\s"']/.test(token) ? `"${token.replace(/(["\\])/g, "\\$1")}"` : token;

/**
 * THE HEAD OF `ExecStart` — the tokens that turn "this file" into "a running process"
 * (decision 4). A TypeScript entry point gets the loader; a built `.js`/`.mjs` one does
 * not, and neither of them gets a shim from `PATH`: the unit names absolute files.
 */
export const interpreterTokens = (input: {
  /** `process.execPath` — node itself, always the first token. */
  readonly node: string;
  /** The CLI entry point, absolute; its SUFFIX decides whether a loader is needed. */
  readonly cli: string;
  /**
   * The tsx ESM loader, absolute (`require.resolve('tsx')`). Absent, the specifier `tsx`
   * is used and node resolves it against `WorkingDirectory` — a working fallback on a box
   * whose repo carries its own `node_modules`, and the reason `systemd install` says out
   * loud which of the two it wrote.
   */
  readonly loader?: string;
}): readonly string[] =>
  /\.[cm]?ts$/.test(input.cli)
    ? [input.node, "--import", input.loader ?? "tsx", input.cli]
    : [input.node, input.cli];

/**
 * THE FLOOR OF THE UNIT'S `PATH` — where `git` and `sh` live on an ordinary Linux box.
 * Kept short and absolute on purpose: this is a floor, not a copy of somebody's shell.
 */
export const DEFAULT_UNIT_PATH_DIRS: readonly string[] = ["/usr/local/bin", "/usr/bin", "/bin"];

/**
 * The `PATH` the unit hands its children (decision 5), from the facts of this box and in
 * the order they are trusted: the interpreter's own directory first (a box with a node
 * version manager has node nowhere else), then the directory of every agent binary the
 * machine config declares, then the system floor.
 *
 * A binary that is NOT an absolute path contributes no directory — a bare `claude` in the
 * machine config says which tool, not where it is, and inventing a directory for it would
 * put a guess in a file that is supposed to hold only facts. The caller resolves it first
 * or says out loud that it could not (`systemd install` does the latter).
 */
export const unitPathDirs = (input: {
  /** The interpreter that will run the daemon — `process.execPath`. */
  readonly node: string;
  /** Agent binaries as the machine config names them; only absolute ones contribute. */
  readonly agents?: readonly string[];
  /** The floor, overridable for tests. */
  readonly base?: readonly string[];
}): readonly string[] => {
  const dirs = [
    dirname(input.node),
    ...(input.agents ?? []).filter(isAbsolute).map((exec) => dirname(exec)),
    ...(input.base ?? DEFAULT_UNIT_PATH_DIRS),
  ];
  return dirs.filter((dir, index) => dirs.indexOf(dir) === index);
};

/** What `systemd install` would write, and what a human still has to do afterwards. */
export type SystemdUnitPlan = {
  /** `lle-orchestrator.service` — the name `systemctl --user` is given. */
  readonly name: string;
  /** Where the file goes: the user unit directory. */
  readonly path: string;
  /** The unit file itself. */
  readonly unit: string;
  /** The human actions, in order — none of them is performed by this package. */
  readonly steps: readonly string[];
};

export const DEFAULT_UNIT_NAME = "lle-orchestrator.service";

/**
 * The unit, from the facts of this box. `daemonArgs` are the daemon's own flags (the
 * ones `up` passes through), NOT `up`'s — `--pid-file`/`--daemon-log` belong to the
 * command and the unit has no business carrying them.
 */
export const planSystemdUnit = (input: {
  /** `WorkingDirectory` — the repo the daemon runs in. */
  readonly repo: string;
  /** The interpreter, i.e. `process.execPath`. */
  readonly node: string;
  /** The CLI entry point, absolute. */
  readonly cli: string;
  /** The tsx ESM loader, absolute — see `interpreterTokens`. */
  readonly loader?: string;
  /** `$HOME` of the user the unit belongs to. */
  readonly home?: string;
  readonly unitName?: string;
  readonly unitDir?: string;
  readonly daemonArgs?: readonly string[];
  readonly description?: string;
  /** Who the linger instruction names — `$USER` of this box. */
  readonly user?: string;
  /** The agent binaries of the machine config — see `unitPathDirs` (decision 5). */
  readonly agents?: readonly string[];
  /** The floor of the unit's `PATH`, overridable for tests. */
  readonly pathBase?: readonly string[];
}): SystemdUnitPlan => {
  const name = input.unitName ?? DEFAULT_UNIT_NAME;
  const home = input.home ?? homedir();
  const dir = input.unitDir ?? join(home, ".config", "systemd", "user");
  const path = join(dir, name);
  const execStart = [
    ...interpreterTokens({
      node: input.node,
      cli: input.cli,
      ...(input.loader === undefined ? {} : { loader: input.loader }),
    }),
    "orchestrator",
    "up",
    "--foreground",
    ...(input.daemonArgs ?? []),
  ]
    .map(quoted)
    .join(" ");
  const user = input.user ?? "$USER";
  return {
    name,
    path,
    unit: renderDaemonUnit({
      execStart,
      workingDir: input.repo,
      identifier: name.replace(/\.service$/, ""),
      path: unitPathDirs({
        node: input.node,
        ...(input.agents === undefined ? {} : { agents: input.agents }),
        ...(input.pathBase === undefined ? {} : { base: input.pathBase }),
      }),
      ...(input.description === undefined ? {} : { description: input.description }),
    }),
    steps: [
      // THE SELF-CHECK COMES FIRST, and it is not ceremony: a key in the wrong section is
      // ignored with a line in the journal nobody reads, so the unit looks installed and
      // is quietly missing a guarantee. `verify` is the only step that costs nothing and
      // fails loudly before the thing is enabled.
      `systemd-analyze --user verify ${path}`,
      `systemctl --user daemon-reload`,
      // AFTER A FAILED UNIT, `enable --now` DOES NOTHING AND SAYS SO OBSCURELY: a unit
      // that hit the start limit stays in `failed` with its counter full, and the next
      // start is refused with "start request repeated too quickly" — about the previous
      // install, not about this one. `reset-failed` is what clears that counter, it is a
      // no-op on a unit that never failed, and it belongs in front of every re-install
      // precisely because the operator re-installing is usually the one who just failed.
      `systemctl --user reset-failed ${name}    # clears a previous failure and its start-limit counter`,
      `systemctl --user enable --now ${name}`,
      // WITHOUT LINGER THE UNIT DIES WITH THE SSH SESSION — see decision 1 above; on a
      // resident box this line is the difference between a unit and a background job.
      `loginctl enable-linger ${user}`,
      `journalctl --user -u ${name} -f    # the same stream the daemon log holds`,
    ],
  };
};

/**
 * The unit text. `Restart=on-failure` with a clean exit on the flags (decision 2);
 * `RestartSec` keeps a crash-loop from spinning the box, and the start limit lets
 * systemd give up loudly instead of hammering a genuinely broken install.
 *
 * `After`/`Wants=network-online.target` because the first thing the daemon does is
 * fetch the mail — a daemon raised before the network is up survives it (the mail probe
 * degrades rather than refuses) but spends its first ticks saying so.
 */
export const renderDaemonUnit = (params: {
  readonly execStart: string;
  readonly workingDir: string;
  readonly description?: string;
  readonly identifier?: string;
  /** The directories of `Environment=PATH=` (decision 5); empty writes no line at all. */
  readonly path?: readonly string[];
}): string =>
  `[Unit]
Description=${params.description ?? "agent-protocol orchestrator daemon"}
Wants=network-online.target
After=network-online.target
# THE START LIMIT LIVES IN [Unit], NOT IN [Service]: systemd owns it per unit, and in
# the service section it is an "Unknown key name" in the journal and NO ceiling at all.
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${params.workingDir}
${
  params.path === undefined || params.path.length === 0
    ? ""
    : `# THE CHILDREN NEED A PATH, THE DAEMON ITSELF DOES NOT: node and the loader are named
# by absolute path above, but the agent binary is resolved through the CHILD process PATH
# (see preflight), and so are git and sh. A user unit inherits no login shell, so without
# this line the daemon starts, verifies green and fails on the first spawn — with the
# lease already taken. The directories are this box's: interpreter, agent binaries of the
# machine config (R14), system floor.
Environment=PATH=${params.path.join(":")}
`
}ExecStart=${params.execStart}
# THE FLAGS WIN OVER THE RESTART POLICY: the daemon exits 0 when the stop or force flag
# is down, and 'on-failure' does not fire on a clean exit — so a flag put down by a
# human keeps the circuit down until that human lifts it.
Restart=on-failure
RestartSec=10
# EXIT 2 IS 'THE ARGUMENTS DO NOT RESOLVE' — this package's refusal code (a bad ref, an
# unknown instance, an unreadable config). Restarting cannot fix any of them, and without
# this line the unit hammers itself into the start limit and reports 'start request
# repeated too quickly', which names the ceiling instead of the fault. Any other non-zero
# code is a genuine crash and still restarts.
RestartPreventExitStatus=2
${params.identifier === undefined ? "" : `SyslogIdentifier=${params.identifier}\n`}
[Install]
WantedBy=default.target
`;

/**
 * What `up --foreground` says when a force flag is on the floor. THE SAME REFUSAL,
 * A DIFFERENT EXIT CODE (decision 2): under a unit this is not a failure of the
 * install, so it must not be reported as one.
 */
export const foregroundRefusal = (input: {
  readonly flagPath: string;
  readonly signature: string;
}): string =>
  `the force flag is down ('${input.flagPath}') — ${input.signature}. Nothing was raised, and this is NOT a failure of the unit: the flag is doing its job, so the exit is clean and 'Restart=on-failure' will not fight it. Lift it deliberately ('orchestrator up --clear-force', or remove the file) and start the unit again`;
