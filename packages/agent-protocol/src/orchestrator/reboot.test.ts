import { describe, expect, it } from "vitest";

import { describeReboot, renderSystemdUnit } from "./reboot.js";

describe("describeReboot", () => {
  it("manual → после ребута нужен ручной старт", () => {
    const s = describeReboot("manual", false);
    expect(s).toContain("ручной старт");
    expect(s).toContain("руками");
    expect(s).toContain("выключены");
  });

  it("systemd + запуски выключены → сам поднимется, но останутся выключенными", () => {
    const s = describeReboot("systemd", false);
    expect(s).toContain("автостарт");
    expect(s).toContain("останутся выключенными");
  });

  it("systemd + запуски включены → останутся включёнными (автономность не отменяется ребутом)", () => {
    const s = describeReboot("systemd", true);
    expect(s).toContain("останутся включёнными");
    expect(s).toContain("включены");
  });
});

describe("renderSystemdUnit", () => {
  const unit = renderSystemdUnit({
    execStart: "node cli.js orchestrator daemon --enable-flag /var/lib/orch/enable",
    workingDir: "/srv/repo",
  });

  it("несёт ExecStart и WorkingDirectory", () => {
    expect(unit).toContain("ExecStart=node cli.js orchestrator daemon");
    expect(unit).toContain("WorkingDirectory=/srv/repo");
  });

  it("это [Install]-юнит (его включает человек через systemctl enable)", () => {
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=default.target");
  });
});
