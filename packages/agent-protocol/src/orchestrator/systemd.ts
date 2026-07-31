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
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** A token of `ExecStart`: systemd splits on whitespace, so a path with a space is quoted. */
const quoted = (token: string): string =>
  /[\s"']/.test(token) ? `"${token.replace(/(["\\])/g, "\\$1")}"` : token;

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
  /** `$HOME` of the user the unit belongs to. */
  readonly home?: string;
  readonly unitName?: string;
  readonly unitDir?: string;
  readonly daemonArgs?: readonly string[];
  readonly description?: string;
  /** Who the linger instruction names — `$USER` of this box. */
  readonly user?: string;
}): SystemdUnitPlan => {
  const name = input.unitName ?? DEFAULT_UNIT_NAME;
  const home = input.home ?? homedir();
  const dir = input.unitDir ?? join(home, ".config", "systemd", "user");
  const path = join(dir, name);
  const execStart = [
    input.node,
    input.cli,
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
      ...(input.description === undefined ? {} : { description: input.description }),
    }),
    steps: [
      `systemctl --user daemon-reload`,
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
}): string =>
  `[Unit]
Description=${params.description ?? "agent-protocol orchestrator daemon"}
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${params.workingDir}
ExecStart=${params.execStart}
# THE FLAGS WIN OVER THE RESTART POLICY: the daemon exits 0 when the stop or force flag
# is down, and 'on-failure' does not fire on a clean exit — so a flag put down by a
# human keeps the circuit down until that human lifts it.
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
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
