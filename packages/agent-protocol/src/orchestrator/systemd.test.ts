import { describe, expect, it } from "vitest";

import {
  DEFAULT_UNIT_NAME,
  foregroundRefusal,
  interpreterTokens,
  planSystemdUnit,
  unitPathDirs,
  worktreeInstallVerdict,
} from "./systemd.js";

const LOADER = "/srv/lle/node_modules/tsx/dist/loader.mjs";

const plan = (over: Partial<Parameters<typeof planSystemdUnit>[0]> = {}) =>
  planSystemdUnit({
    repo: "/srv/lle",
    node: "/usr/bin/node",
    cli: "/srv/lle/packages/agent-protocol/src/cli.ts",
    loader: LOADER,
    home: "/home/op",
    user: "op",
    daemonArgs: ["--ref", "origin/main"],
    ...over,
  });

describe("the unit is generated from this box", () => {
  it("runs the daemon in the foreground — systemd supervises what it started", () => {
    const unit = plan().unit;
    expect(unit).toContain(
      `ExecStart=/usr/bin/node --import ${LOADER} /srv/lle/packages/agent-protocol/src/cli.ts orchestrator up --foreground --ref origin/main`,
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

  it("puts the start limit in [Unit] — in [Service] systemd ignores it and says so only in the journal", () => {
    // The live repro on `lle-agents` (2026-08-02): "Unknown key name StartLimitIntervalSec
    // in section 'Service'". The unit came up, the ceiling did not exist, and nothing in
    // the operator's hands said so.
    const [, service = ""] = plan().unit.split("\n[Service]");
    expect(service).not.toContain("StartLimit");
    const [unitSection = ""] = plan().unit.split("\n[Service]");
    expect(unitSection).toContain("StartLimitIntervalSec=300");
    expect(unitSection).toContain("StartLimitBurst=5");
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
    expect(unit).toContain('ExecStart="/opt/my node/bin/node" --import /srv/lle/');
  });

  it("names the human actions, and the self-check is the first of them", () => {
    const steps = plan().steps;
    // `verify` before `enable`: a key in the wrong section costs nothing to catch here
    // and is invisible once the thing is running (the live repro of 2026-08-02).
    expect(steps[0]).toBe(
      `systemd-analyze --user verify /home/op/.config/systemd/user/${DEFAULT_UNIT_NAME}`,
    );
    expect(steps[1]).toBe("systemctl --user daemon-reload");
    // `reset-failed` BEFORE `enable --now`, and that order is the whole point: a unit
    // left in `failed` by the previous install refuses the next start with "repeated too
    // quickly" — an answer about the run before this one (the live repro of 2026-08-02,
    // where it cost the first minute of the diagnosis).
    expect(steps[2]).toContain(`systemctl --user reset-failed ${DEFAULT_UNIT_NAME}`);
    expect(steps[3]).toBe(`systemctl --user enable --now ${DEFAULT_UNIT_NAME}`);
    // Linger is what makes a user unit survive the operator logging out — without it
    // the "resident box" property is quietly missing (see the doc block, decision 1).
    expect(steps[4]).toBe("loginctl enable-linger op");
    expect(steps.join("\n")).toContain("journalctl --user -u");
  });

  it("hands its children a PATH — the daemon needs none, the sessions it spawns do", () => {
    // The third defect of the same live repro (statement of 2026-08-02 19:42:30Z): the
    // interpreter is absolute and starts fine, and then the first spawn resolves the
    // agent binary through the CHILD's PATH and finds nothing — with the lease taken.
    const unit = plan({
      node: "/home/op/.nvm/versions/node/v24/bin/node",
      agents: ["/opt/claude/bin/claude"],
    }).unit;
    expect(unit).toContain(
      "Environment=PATH=/home/op/.nvm/versions/node/v24/bin:/opt/claude/bin:/usr/local/bin:/usr/bin:/bin",
    );
    // In [Service], where systemd reads it — the mistake this whole PR is about.
    const [, service = ""] = unit.split("\n[Service]");
    expect(service).toContain("Environment=PATH=");
  });

  it("does not restart on exit 2 — 'the arguments do not resolve' is not fixed by trying again", () => {
    // Without this the unit spends its start limit on a refusal and then reports the
    // ceiling ("start request repeated too quickly") instead of the fault.
    const [, service = ""] = plan().unit.split("\n[Service]");
    expect(service).toContain("RestartPreventExitStatus=2");
    // It is a [Service] key: in [Unit] it would be an "Unknown key name" and no guard at
    // all — the very failure mode of the start limit, mirrored.
    const [unitSection = ""] = plan().unit.split("\n[Service]");
    expect(unitSection).not.toContain("RestartPreventExitStatus");
  });

  it("takes a name of its own — one box may host more than one contour", () => {
    const named = plan({ unitName: "lle-staging.service", unitDir: "/tmp/units" });
    expect(named.path).toBe("/tmp/units/lle-staging.service");
    expect(named.unit).toContain("SyslogIdentifier=lle-staging");
  });
});

describe("the PATH of the unit", () => {
  it("is the interpreter, the agent binaries and the system floor, in that order", () => {
    expect(
      unitPathDirs({ node: "/opt/node/bin/node", agents: ["/opt/claude/bin/claude"] }),
    ).toEqual(["/opt/node/bin", "/opt/claude/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
  });

  it("says each directory once — node and the agent often live in the same one", () => {
    expect(unitPathDirs({ node: "/usr/bin/node", agents: ["/usr/bin/claude"] })).toEqual([
      "/usr/bin",
      "/usr/local/bin",
      "/bin",
    ]);
  });

  it("takes no directory from a bare binary name — a guess is not a fact", () => {
    // `claude` in the machine config says WHICH tool, not where it is. Inventing a
    // directory for it would put a lie in a file that is read by systemd and by nobody
    // else; the command resolves it first, or says out loud that it could not.
    expect(unitPathDirs({ node: "/opt/node/bin/node", agents: ["claude"] })).toEqual([
      "/opt/node/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]);
  });
});

describe("the interpreter of the unit", () => {
  it("gives a TypeScript entry point the loader — bare node dies on its first import", () => {
    expect(
      interpreterTokens({ node: "/usr/bin/node", cli: "/srv/cli.ts", loader: LOADER }),
    ).toEqual(["/usr/bin/node", "--import", LOADER, "/srv/cli.ts"]);
  });

  it("names the loader by ABSOLUTE path, and falls back to the specifier when there is none", () => {
    // The fallback is resolved by node against WorkingDirectory — it works on a box whose
    // repo carries its own node_modules and is worth saying out loud, which the command does.
    expect(interpreterTokens({ node: "/usr/bin/node", cli: "/srv/cli.ts" })).toEqual([
      "/usr/bin/node",
      "--import",
      "tsx",
      "/srv/cli.ts",
    ]);
  });

  it("gives a built entry point NOTHING — the suffix decides, not a flag", () => {
    expect(
      interpreterTokens({ node: "/usr/bin/node", cli: "/srv/dist/cli.js", loader: LOADER }),
    ).toEqual(["/usr/bin/node", "/srv/dist/cli.js"]);
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

describe("the install refuses a ROLE'S WORKSPACE, and only that (decision 7)", () => {
  const HOME = "/srv/lle";
  const WORKSPACE = "/srv/lle/.worktrees/dev-core";
  const MAIL = "/srv/lle/.worktrees/comms";
  const ENTRY = `${WORKSPACE}/packages/agent-protocol/src/cli.ts`;

  it("refuses when the command was typed in a role's workspace", () => {
    const said = worktreeInstallVerdict({
      home: HOME,
      cwdCheckout: WORKSPACE,
      cwdRole: "dev-core",
      entryCheckout: WORKSPACE,
      entryHome: HOME,
      entryRole: "dev-core",
      entry: ENTRY,
      workspacesDeclared: true,
    });

    expect(said.kind).toBe("refusal");
    // The THREE things the statement (§4) says the refusal owes the operator: whose
    // workspace this is, why a resident unit may not come out of it, and where to type it.
    expect(said.kind === "refusal" && said.message).toContain(WORKSPACE);
    expect(said.kind === "refusal" && said.message).toContain("role 'dev-core'");
    expect(said.kind === "refusal" && said.message).toContain("R17");
    expect(said.kind === "refusal" && said.message).toContain(`run it in ${HOME}`);
  });

  it("refuses on the ENTRY POINT alone — the directory typed in is not the whole story", () => {
    const said = worktreeInstallVerdict({
      home: HOME,
      cwdCheckout: HOME,
      entryCheckout: WORKSPACE,
      entryHome: HOME,
      entryRole: "dev-core",
      entry: ENTRY,
      workspacesDeclared: true,
    });

    expect(said.kind).toBe("refusal");
    expect(said.kind === "refusal" && said.message).toContain(ENTRY);
    expect(said.kind === "refusal" && said.message).toContain("role 'dev-core'");
  });

  it("NOTES a linked worktree that is nobody's workspace instead of refusing it", () => {
    // The mail checkout is a linked worktree and is NOT put back on base, locked or
    // removed by the circuit — refusing it would state a reason that is false (review
    // of #172). The fact is said out loud, and the command goes on.
    const said = worktreeInstallVerdict({
      home: HOME,
      cwdCheckout: MAIL,
      entryCheckout: MAIL,
      entryHome: HOME,
      entry: `${MAIL}/packages/agent-protocol/src/cli.ts`,
      workspacesDeclared: true,
    });

    expect(said.kind).toBe("note");
    expect(said.kind === "note" && said.message).toContain(MAIL);
    expect(said.kind === "note" && said.message).toContain("not the workspace of any role");
    expect(said.kind === "note" && said.message).not.toContain("R17 guard applies");
  });

  it("says in the note when the project declares no workspaces at all", () => {
    const said = worktreeInstallVerdict({
      home: HOME,
      cwdCheckout: MAIL,
      entry: `${MAIL}/packages/agent-protocol/src/cli.ts`,
      workspacesDeclared: false,
    });

    expect(said.kind === "note" && said.message).toContain(
      "declares no role workspaces (orchestrator.workdir.worktrees)",
    );
  });

  it("lets the home checkout through", () => {
    expect(
      worktreeInstallVerdict({
        home: HOME,
        cwdCheckout: HOME,
        entryCheckout: HOME,
        entryHome: HOME,
        entry: `${HOME}/packages/agent-protocol/src/cli.ts`,
        workspacesDeclared: true,
      }).kind,
    ).toBe("ok");
  });

  it("lets an INSTALLED cli through — an entry outside any repository is not a worktree", () => {
    expect(
      worktreeInstallVerdict({
        home: HOME,
        cwdCheckout: HOME,
        entry: "/usr/lib/node_modules/agent-protocol/dist/cli.js",
        workspacesDeclared: true,
      }).kind,
    ).toBe("ok");
  });

  it("lets an entry from ANOTHER repository through — only this repo's worktrees are ours", () => {
    expect(
      worktreeInstallVerdict({
        home: HOME,
        cwdCheckout: HOME,
        entryCheckout: "/home/op/agent-protocol",
        entryHome: "/home/op/agent-protocol",
        entry: "/home/op/agent-protocol/src/cli.ts",
        workspacesDeclared: true,
      }).kind,
    ).toBe("ok");
  });

  it("says nothing about the working directory when --repo was typed", () => {
    // `--repo` IS the operator saying which checkout they mean; the two disagreeing is
    // then the request, not the defect.
    expect(
      worktreeInstallVerdict({
        home: HOME,
        entryCheckout: HOME,
        entryHome: HOME,
        entry: `${HOME}/packages/agent-protocol/src/cli.ts`,
        workspacesDeclared: true,
      }).kind,
    ).toBe("ok");
  });
});
