/**
 * Behaviour across a machine reboot (S4, john's decision on the fork — thread
 * 012, curator 16:25). The package supports BOTH modes, the project picks one at
 * installation time; the package does NOT register itself with the system —
 * `systemctl enable` is done by a human.
 *
 * The key part (curator's item 3, "the most important one"): autostart brings up
 * the DAEMON, but does not enable LAUNCHES. The launch state is the
 * `--enable-flag` (a file on disk), and it survives a reboot EXACTLY in the
 * position john left it in: systemd does not quietly turn into "after the reboot
 * everything started by itself". The guarantee holds by construction: the enable
 * state is the presence of a file, read on every tick; after a reboot the file is
 * the same one, provided it lies on PERSISTENT storage (not tmpfs). Hence the
 * unit and the docs point at a persistent path for the flags.
 */
export const REBOOT_MODES = ["systemd", "manual"] as const;
export type RebootMode = (typeof REBOOT_MODES)[number];

/**
 * A line for `status`: how the daemon is brought up and WHAT will happen after a
 * reboot — so that "a month later nobody remembered" never arrives.
 * `launchesEnabled` — whether the `--enable-flag` exists (the persistent launch
 * state).
 */
export const describeReboot = (mode: RebootMode, launchesEnabled: boolean): string => {
  const launches = launchesEnabled ? "enabled" : "disabled";
  if (mode === "manual") {
    return `daemon: manual start; launches: ${launches}; after a reboot the daemon has to be brought up by hand`;
  }
  const afterReboot = launchesEnabled
    ? "launches were enabled — they will stay enabled"
    : "launches were disabled — they will stay disabled";
  return `daemon: autostart (systemd); launches: ${launches}; after a reboot the daemon comes up by itself, ${afterReboot}`;
};

/**
 * The systemd unit file that starts the daemon. `systemctl enable` is a HUMAN
 * ACTION, not code behaviour: a daemon that makes itself permanent is exactly the
 * surprise that starting in `disabled` protects against. The flags must lie on
 * persistent storage — otherwise the enable state will not survive a reboot (see
 * the doc block).
 */
export const renderSystemdUnit = (params: {
  readonly execStart: string;
  readonly workingDir: string;
  readonly description?: string;
}): string =>
  `[Unit]
Description=${params.description ?? "agent-protocol orchestrator daemon"}
After=network.target

[Service]
Type=simple
WorkingDirectory=${params.workingDir}
ExecStart=${params.execStart}
Restart=on-failure

[Install]
WantedBy=default.target
`;
