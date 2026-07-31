import { describe, expect, it } from "vitest";

import { DEFAULT_UNIT_NAME, foregroundRefusal, planSystemdUnit } from "./systemd.js";

const plan = (over: Partial<Parameters<typeof planSystemdUnit>[0]> = {}) =>
  planSystemdUnit({
    repo: "/srv/lle",
    node: "/usr/bin/node",
    cli: "/srv/lle/packages/agent-protocol/src/cli.ts",
    home: "/home/op",
    user: "op",
    daemonArgs: ["--ref", "origin/main"],
    ...over,
  });

describe("the unit is generated from this box", () => {
  it("runs the daemon in the foreground — systemd supervises what it started", () => {
    const unit = plan().unit;
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /srv/lle/packages/agent-protocol/src/cli.ts orchestrator up --foreground --ref origin/main",
    );
    expect(unit).toContain("Type=simple");
    expect(unit).toContain("WorkingDirectory=/srv/lle");
  });

  it("goes into the USER unit directory, not a system one", () => {
    expect(plan().path).toBe(`/home/op/.config/systemd/user/${DEFAULT_UNIT_NAME}`);
    expect(plan().unit).toContain("WantedBy=default.target");
  });

  it("restarts on failure, with a ceiling on the crash loop", () => {
    const unit = plan().unit;
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=10");
    expect(unit).toContain("StartLimitBurst=5");
  });

  it("says in the file itself why a flag beats the restart policy", () => {
    // The line exists so that the next person reading the unit does not "fix" the
    // restart policy into 'always' — which would make the off switch stop working.
    expect(plan().unit).toContain("THE FLAGS WIN OVER THE RESTART POLICY");
  });

  it("waits for the network the mail is fetched over", () => {
    expect(plan().unit).toContain("After=network-online.target");
    expect(plan().unit).toContain("Wants=network-online.target");
  });

  it("quotes a path with a space instead of handing systemd two tokens", () => {
    const unit = plan({ node: "/opt/my node/bin/node" }).unit;
    expect(unit).toContain('ExecStart="/opt/my node/bin/node" /srv/lle/');
  });

  it("names the human actions, and enabling is one of them", () => {
    const steps = plan().steps;
    expect(steps[0]).toBe("systemctl --user daemon-reload");
    expect(steps[1]).toBe(`systemctl --user enable --now ${DEFAULT_UNIT_NAME}`);
    // Linger is what makes a user unit survive the operator logging out — without it
    // the "resident box" property is quietly missing (see the doc block, decision 1).
    expect(steps[2]).toBe("loginctl enable-linger op");
    expect(steps.join("\n")).toContain("journalctl --user -u");
  });

  it("takes a name of its own — one box may host more than one contour", () => {
    const named = plan({ unitName: "lle-staging.service", unitDir: "/tmp/units" });
    expect(named.path).toBe("/tmp/units/lle-staging.service");
    expect(named.unit).toContain("SyslogIdentifier=lle-staging");
  });
});

describe("the refusal a unit gets", () => {
  it("names the flag, its signature, and that this is not a failure", () => {
    const said = foregroundRefusal({ flagPath: "/s/force", signature: "john: acceptance" });
    expect(said).toContain("/s/force");
    expect(said).toContain("john: acceptance");
    expect(said).toContain("NOT a failure");
    expect(said).toContain("Restart=on-failure");
  });
});
