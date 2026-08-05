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
 *
 * 7. THE UNIT IS NOT GENERATED FROM A ROLE'S WORKSPACE (found while the fixes above were
 * on the wire, thread 019). `WorkingDirectory` is the machine's HOME checkout — since R26
 * it is resolved through `--git-common-dir` and answers the same from every worktree — but
 * `ExecStart` names the entry point and the loader BY ABSOLUTE PATH, and those come from
 * the checkout the command was typed in. Typed inside a role's workspace the two disagree:
 * the resident would be raised out of `…/.worktrees/<role>`, a tree the circuit itself puts
 * back on base and locks before every package (R17) and removes when it cleans up. The unit
 * would look perfectly well-formed and would break on the day the workspace moved — the
 * same class as decisions 4–6, which is why it refuses rather than warns, and refuses
 * rather than silently rewriting the path: the checkout that was typed in is the one whose
 * `node_modules` produced this loader, and pointing the unit at another tree would name
 * files this command never saw.
 *
 * WHAT IS A ROLE'S WORKSPACE is read from `orchestrator.workdir.worktrees` through
 * `workspaceRoleOf` — the same mechanism as `zones check --role-from-workspace`, and the
 * same for the same reason: two guards answering "whose tree is this" differently in the
 * same directory would be worse than either being wrong. Any OTHER linked worktree (the
 * mail checkout, the operator's own) is passed with a note, because R17 does not govern it
 * and a refusal there would state a reason that is false.
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
 * THE UNIT OF ONE INSTANCE (thread 055). A box hosting several projects runs several
 * daemons, and `DEFAULT_UNIT_NAME` is one name on the whole user: the second
 * `systemctl --user enable` would fight the first over that file, which is precisely
 * the collision the multi-instance work exists to remove.
 *
 * WHY A NAME PER INSTANCE AND NOT A REAL SYSTEMD TEMPLATE (`foo@.service` + `%i`):
 * a template has ONE `ExecStart` shared by every instance, and ours is GENERATED per
 * box — the repository path, this interpreter, this CLI entry point, the PATH of the
 * agent binaries THIS instance declares. None of that is common between two projects
 * on one box, so a template would have to reduce to `%i` lookups of the very facts the
 * generator exists to write down. The `@<instance>` shape is kept because it is what an
 * operator reads (`systemctl --user status lle-orchestrator@crew`) and because it gives
 * the property the statement asked for: N daemons that do not interfere.
 *
 * A box that names no instance keeps the name it has today, to the byte.
 */
export const unitNameFor = (instance?: string): string =>
  instance === undefined
    ? DEFAULT_UNIT_NAME
    : `${DEFAULT_UNIT_NAME.replace(/\.service$/, "")}@${instance}.service`;

/** What `systemd install` may do from the checkout it was typed in — see below. */
export type WorktreeInstallVerdict =
  /** Nothing to say: the home checkout, an installed package, another repository. */
  | { readonly kind: "ok" }
  /** A linked worktree that is NOT a role's — passed, and the fact is said out loud. */
  | { readonly kind: "note"; readonly message: string }
  /** A role's workspace: the unit would name a tree the circuit owns. Exit 2. */
  | { readonly kind: "refusal"; readonly message: string };

/**
 * WHY THIS INSTALL MUST NOT HAPPEN HERE (decision 7) — and why the answer has THREE
 * values rather than two.
 *
 * Two facts can each put the unit's `ExecStart` in a tree that is not the home checkout,
 * and they are asked separately because the cure differs:
 *
 * - the command was TYPED in a linked worktree (`cwdCheckout`) — the entry point that
 *   goes into `ExecStart` is that tree's;
 * - the ENTRY POINT itself came from a linked worktree of this same repository, whatever
 *   the operator's directory was.
 *
 * WHAT MAKES IT A REFUSAL IS NOT "a linked worktree" BUT "a role's workspace", and that
 * is the statement of the thread (curator, 2026-08-02 §4): the sign is the same mechanism
 * `zones check --role-from-workspace` already uses — `orchestrator.workdir.worktrees`,
 * resolved by `workspaceRoleOf`. Only such a tree is put back on base, locked and removed
 * under the daemon before every package (R17), and only about such a tree may the message
 * say so. A linked worktree that is nobody's workspace (the mail checkout, the operator's
 * own, a tree made by hand) is passed with a NOTE: it is not what R17 governs, and a
 * refusal there would tell the operator a reason that is not true (the review of #172).
 *
 * `cwdCheckout` is `undefined` when the home was not derived from the working directory
 * (`--repo` was typed): then the two disagreeing is what the operator asked for. The entry
 * pair is `undefined` when the entry is not in a git repository at all — an installed
 * package is a legitimate way to run this and is nothing like a worktree.
 */
export const worktreeInstallVerdict = (input: {
  /** `WorkingDirectory` of the unit: the machine's home checkout (R26). */
  readonly home: string;
  /** Top level of the checkout the command was typed in, when the home came from it. */
  readonly cwdCheckout?: string;
  /** Whose workspace that checkout is (`workspaceRoleOf`), when it is one at all. */
  readonly cwdRole?: string;
  /** Top level of the checkout the CLI entry point lives in, when it is in one. */
  readonly entryCheckout?: string;
  /** The home checkout of THAT tree — equal to `home` when it is a worktree of this repo. */
  readonly entryHome?: string;
  /** Whose workspace the entry's checkout is, when it is one at all. */
  readonly entryRole?: string;
  /** The entry point itself, named in the message. */
  readonly entry: string;
  /** Whether the project declares `orchestrator.workdir.worktrees` at all — said in the note. */
  readonly workspacesDeclared?: boolean;
}): WorktreeInstallVerdict => {
  // The three things the refusal owes the operator (statement §4): whose workspace this
  // is, why a RESIDENT unit may not come out of it, and the path to type it in instead.
  const cure = `run it in ${input.home} — the checkout the unit's WorkingDirectory names`;
  const why = `the circuit puts a role's workspace back on base, locks it and removes it before every package (R17), so the resident unit would be started out of a tree that is rewritten under it`;
  const notWorkspace =
    input.workspacesDeclared === false
      ? "this project declares no role workspaces (orchestrator.workdir.worktrees)"
      : "it is not the workspace of any role (orchestrator.workdir.worktrees)";
  const notes: string[] = [];

  if (input.cwdCheckout !== undefined && input.cwdCheckout !== input.home) {
    if (input.cwdRole !== undefined) {
      return {
        kind: "refusal",
        message: `this is '${input.cwdCheckout}', the workspace of role '${input.cwdRole}' — a unit generated here would name '${input.entry}' in its ExecStart, and ${why}; ${cure}`,
      };
    }
    notes.push(
      `agent-protocol: '${input.cwdCheckout}' is a linked worktree of ${input.home} and ${notWorkspace} — the R17 guard does not apply, and the unit will name '${input.entry}' in its ExecStart; check that this tree is one that stays`,
    );
  }

  if (input.entryHome === input.home && input.entryCheckout !== input.home) {
    if (input.entryRole !== undefined) {
      return {
        kind: "refusal",
        message: `the entry point of this command, '${input.entry}', lives in '${input.entryCheckout}', the workspace of role '${input.entryRole}' — ${why}; ${cure}`,
      };
    }
    notes.push(
      `agent-protocol: the entry point of this command, '${input.entry}', lives in the linked worktree '${input.entryCheckout}' of ${input.home}, and ${notWorkspace} — the R17 guard does not apply, and the unit's ExecStart will name it`,
    );
  }

  return notes.length === 0 ? { kind: "ok" } : { kind: "note", message: notes.join("\n") };
};

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
