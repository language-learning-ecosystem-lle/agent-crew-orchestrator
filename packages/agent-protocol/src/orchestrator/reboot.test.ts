import { describe, expect, it } from "vitest";

import { describeReboot, renderSystemdUnit } from "./reboot.js";

describe("describeReboot", () => {
  it("manual → after a reboot a manual start is needed", () => {
    const s = describeReboot("manual", false);
    expect(s).toContain("manual start");
    expect(s).toContain("by hand");
    expect(s).toContain("disabled");
  });

  it("systemd + launches disabled → comes up by itself, but they stay disabled", () => {
    const s = describeReboot("systemd", false);
    expect(s).toContain("autostart");
    expect(s).toContain("stay disabled");
  });

  it("systemd + launches enabled → they stay enabled (a reboot does not cancel autonomy)", () => {
    const s = describeReboot("systemd", true);
    expect(s).toContain("stay enabled");
    expect(s).toContain("enabled");
  });
});

describe("renderSystemdUnit", () => {
  const unit = renderSystemdUnit({
    execStart: "node cli.js orchestrator daemon --enable-flag /var/lib/orch/enable",
    workingDir: "/srv/repo",
  });

  it("carries ExecStart and WorkingDirectory", () => {
    expect(unit).toContain("ExecStart=node cli.js orchestrator daemon");
    expect(unit).toContain("WorkingDirectory=/srv/repo");
  });

  it("it is an [Install] unit (a human enables it via systemctl enable)", () => {
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=default.target");
  });
});
