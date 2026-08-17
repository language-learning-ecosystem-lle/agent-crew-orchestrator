/**
 * `orchestrator systemd install` AS A COMMAND (thread `019-operator-ux`, the finding of
 * the reviewer on PR #116: the pure plan was covered, the command around it was not).
 *
 * What only a real process can answer here: does `--write` actually put the file where
 * the plan says, does the run WITHOUT it leave the disk alone, and does the two-word
 * name survive the argument guard — `orchestrator systemd install` is the one command
 * whose key and whose argv shift by a token, so a guard keyed on the first word alone
 * would refuse every valid flag while still looking like a working command.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  // The ref of the operator's five comes from HERE, not from a hand-typed flag: the unit
  // is written once and must not carry somebody's terminal in its ExecStart.
  // `workdir.worktrees` is what makes a directory a ROLE'S workspace — the sign the
  // install guard reads (systemd.ts, decision 7), the same one `zones check
  // --role-from-workspace` reads. Without it declared no tree is anybody's.
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
  instances: [{ id: "main", roles: ["dev-core"] }],
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
  ],
};

/** A repository is all this command needs — it writes a unit, it does not read the mail. */
const box = (): string => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-systemd-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "config",
  ]);
  return repo;
};

/**
 * A PATH holding exactly one binary: `git`. Built as a directory of symlinks rather than
 * by trimming the ambient PATH — a box with a globally installed `tsx` would otherwise
 * keep handing the test the very crutch it is checking the absence of.
 */
const gitOnly = (): string => {
  const bin = mkdtempSync(join(tmpdir(), "agent-protocol-path-"));
  const found = (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "git"))
    .find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error("git is not on PATH — this suite needs it");
  symlinkSync(found, join(bin, "git"));
  return bin;
};

/**
 * A MACHINE CONFIG FOR THIS BOX (R14) — written into the sandbox's config home, which is
 * where the spawned CLI reads it from. It is the only place that says where the agent
 * binary is, and therefore the only source the unit's `PATH` can have.
 */
const machineConfig = (repo: string, config: unknown): void => {
  const dir = join(configHome(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

const run = (repo: string, ...args: string[]) => {
  const done = spawnSync(TSX, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 60_000,
    env: sandbox(configHome(repo), {}),
  });
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
};

describe("orchestrator systemd install", () => {
  it("without --write it writes NOTHING and shows the unit it would write", () => {
    const repo = box();
    const dir = join(repo, "units");

    const done = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir);

    expect(done.status).toBe(0);
    expect(done.stdout).toContain(`would write ${join(dir, "agent-protocol.service")}`);
    expect(done.stdout).toContain("ExecStart=");
    // The disk is the assertion: a dry run that quietly wrote the file would print the
    // very same text.
    expect(existsSync(join(dir, "agent-protocol.service"))).toBe(false);
  });

  it("--write puts the unit there, and says 'replaced' the second time", () => {
    const repo = box();
    const dir = join(repo, "units");
    const unit = join(dir, "agent-protocol.service");

    const first = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`wrote ${unit}`);
    const text = readFileSync(unit, "utf8");
    // The unit is generated FROM THIS BOX: the repo it was run in, the interpreter that
    // ran it, and the ref of the working tree's config — none of them typed by hand.
    expect(text).toContain(`WorkingDirectory=${repo}`);
    expect(text).toContain("orchestrator up --foreground --ref HEAD");
    expect(text).toContain("Restart=on-failure");
    // The human steps are printed and NOT performed — the enable gate has a human's name
    // on it (the old `reboot.ts` line).
    expect(first.stdout).toContain("systemctl --user enable --now agent-protocol.service");
    expect(first.stdout).toContain("loginctl enable-linger");

    const again = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`replaced ${unit}`);
  });

  it("the ExecStart it wrote actually STARTS — no global tsx, no build, nothing on PATH", () => {
    // THE REGRESSION OF 2026-08-02 (thread 019 msg 4): the first live unit on `lle-agents`
    // died with `ERR_MODULE_NOT_FOUND … config/config.js imported from … cli.ts`, because
    // the generator wrote bare node in front of a TypeScript entry point. Reading the unit
    // could not catch it — only running its own ExecStart can, and this is that run: the
    // tokens come OUT OF THE FILE, and the environment has no PATH to fall back to.
    const repo = box();
    const dir = join(repo, "units");
    run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    const unit = readFileSync(join(dir, "agent-protocol.service"), "utf8");
    const exec = /^ExecStart=(.*)$/m.exec(unit)?.[1] as string;
    const tokens = exec.split(" ");
    // Everything up to the entry point is the INTERPRETER; the daemon's own subcommand is
    // replaced by a dry `systemd install`, which loads the whole module graph, exits 0 and
    // writes nothing — the failure being guarded is an import, and starting a real daemon
    // inside a test is not a test.
    const entry = tokens.findIndex((token) => token === "orchestrator");
    const [bin, ...rest] = tokens.slice(0, entry);
    const started = spawnSync(bin as string, [...rest, "orchestrator", "systemd", "install"], {
      cwd: repo,
      encoding: "utf8",
      timeout: 60_000,
      // A PATH WITH GIT ON IT AND NOTHING ELSE: a unit that only works because the
      // operator's shell had tsx in it is the same defect one layer down, and a unit under
      // systemd gets no login shell. Git stays because the CLI shells out to it for the
      // ref of the working tree — that is the command's own business, not the loader's.
      env: { ...sandbox(configHome(repo), {}), PATH: gitOnly() },
    });

    expect(`${started.stdout}${started.stderr}`).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(started.status).toBe(0);
    expect(started.stdout).toContain("would write");
  });

  it("writes a PATH holding the AGENT BINARY of the machine config, resolved to a directory", () => {
    // THE THIRD DEFECT OF THE SAME LIVE REPRO (statement of 2026-08-02 19:42:30Z): the
    // unit started, `verify` was green, and the first session the daemon tried to raise
    // would have died on resolving its binary through the child's PATH. The assertion is
    // on the FILE, not on the constructor — the file is what systemd reads.
    const repo = box();
    const dir = join(repo, "units");
    // A real binary in a directory of its own, declared the way R14 declares it.
    const agentDir = mkdtempSync(join(tmpdir(), "agent-protocol-agent-"));
    writeFileSync(join(agentDir, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    machineConfig(repo, { agents: { "claude-code": { exec: join(agentDir, "claude") } } });

    const done = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    expect(done.status).toBe(0);
    const text = readFileSync(join(dir, "agent-protocol.service"), "utf8");
    const path = /^Environment=PATH=(.*)$/m.exec(text)?.[1] as string;
    expect(path).toBeDefined();
    const dirs = path.split(":");
    // The directory of the agent binary and the directory of the interpreter that wrote
    // the unit — the two the spawn actually needs.
    expect(dirs).toContain(agentDir);
    expect(dirs).toContain(dirname(process.execPath));
    expect(dirs).toContain("/usr/bin");
    // And the operator is told which binary went in, by name: a unit whose PATH silently
    // misses one looks exactly like a unit whose PATH does not.
    expect(done.stdout).toContain(`claude-code → ${join(agentDir, "claude")}`);
  });

  it("refuses to invent a directory for a binary it cannot find, and says so", () => {
    const repo = box();
    const dir = join(repo, "units");
    machineConfig(repo, { agents: { "claude-code": { exec: "no-such-binary-anywhere" } } });

    const done = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    // NOT a refusal of the install: the unit is still the right thing to write, and the
    // operator is the one who fixes the machine config. But the sentence names the
    // consequence — a spawn that fails with the lease already taken.
    expect(done.status).toBe(0);
    const text = readFileSync(join(dir, "agent-protocol.service"), "utf8");
    expect(text).not.toContain("no-such-binary-anywhere");
    expect(`${done.stdout}${done.stderr}`).toContain("could not be resolved from this shell");
  });

  it("tells the operator to clear a previous failure before enabling the unit", () => {
    // `enable --now` on a unit that hit the start limit answers about the PREVIOUS
    // install ("start request repeated too quickly") — the sentence that cost the live
    // diagnosis its first minute.
    const repo = box();
    const dir = join(repo, "units");

    const done = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    const reset = done.stdout.indexOf("systemctl --user reset-failed agent-protocol.service");
    const enable = done.stdout.indexOf("systemctl --user enable --now");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(enable);
    // And the unit itself stops on the refusal code instead of hammering the ceiling.
    expect(readFileSync(join(dir, "agent-protocol.service"), "utf8")).toContain(
      "RestartPreventExitStatus=2",
    );
  });

  it("prints the self-check FIRST, before the step that enables the thing", () => {
    const repo = box();
    const dir = join(repo, "units");

    const done = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    const verify = done.stdout.indexOf("systemd-analyze --user verify");
    const enable = done.stdout.indexOf("systemctl --user enable --now");
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(enable);
    // `verify` is what catches a key in the wrong section — the other half of the same
    // live repro, where the ceiling was silently absent.
    expect(done.stdout).toContain(join(dir, "agent-protocol.service"));
    expect(done.stdout).toContain("tsx loader");
  });

  it("the two-word name passes its own flags through the guard, and still refuses a stray one", () => {
    const repo = box();
    const dir = join(repo, "units");

    const named = run(
      repo,
      "orchestrator",
      "systemd",
      "install",
      "--unit-dir",
      dir,
      "--unit-name",
      "box.service",
      "--daemon-args",
      "--ref HEAD --tick 30",
      "--description",
      "the box",
      "--write",
    );

    expect(named.status).toBe(0);
    const text = readFileSync(join(dir, "box.service"), "utf8");
    expect(text).toContain("Description=the box");
    expect(text).toContain("orchestrator up --foreground --ref HEAD --tick 30");

    const stray = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--nonsense");

    expect(stray.status).toBe(2);
    expect(`${stray.stdout}${stray.stderr}`).toContain("--nonsense");
  });

  it("REFUSES inside a ROLE'S workspace — the tree the circuit resets and locks (R17)", () => {
    // THE FINDING THAT DID NOT FIT THE PREVIOUS CIRCLE (thread 019, msg 2026-08-02, §4):
    // `WorkingDirectory` resolves to the home checkout from anywhere (R26), but ExecStart
    // names the entry point of the tree the command was typed in. In a role's workspace
    // that unit is well-formed and doomed — the circuit puts that tree back on base,
    // locks it and removes it. The assertion is the disk: a refusal that still wrote the
    // file would be no refusal at all.
    const repo = box();
    const workspace = join(repo, ".worktrees", "dev-core");
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", "--detach", workspace]);
    const dir = join(repo, "units");

    const done = spawnSync(TSX, [CLI, "orchestrator", "systemd", "install", "--unit-dir", dir], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 60_000,
      env: sandbox(configHome(repo), {}),
    });

    expect(done.status).toBe(2);
    const said = `${done.stdout}${done.stderr}`;
    // The three things the statement asks the refusal to name.
    expect(said).toContain(workspace);
    expect(said).toContain("role 'dev-core'");
    expect(said).toContain(repo);
    expect(existsSync(join(dir, "agent-protocol.service"))).toBe(false);

    // ...and the same install from the home checkout is untouched by the guard.
    const home = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    expect(home.status).toBe(0);
    expect(existsSync(join(dir, "agent-protocol.service"))).toBe(true);
  });

  it("a linked worktree that is NOBODY'S workspace is NOTED and written, not refused", () => {
    // The review of #172: the mail checkout is a linked worktree and is NOT put back on
    // base, locked or removed by anything — a refusal there would hand the operator a
    // reason that is false. The guard is the declared workspaces, so this tree passes,
    // and the fact that ExecStart names it is said out loud instead of being silent.
    const repo = box();
    const mail = join(repo, ".worktrees", "comms");
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", "--detach", mail]);
    const dir = join(repo, "units");

    const done = spawnSync(
      TSX,
      [CLI, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write"],
      { cwd: mail, encoding: "utf8", timeout: 60_000, env: sandbox(configHome(repo), {}) },
    );

    expect(done.status).toBe(0);
    expect(existsSync(join(dir, "agent-protocol.service"))).toBe(true);
    const said = `${done.stdout}${done.stderr}`;
    expect(said).toContain(mail);
    expect(said).toContain("not the workspace of any role");
    // ...and it does NOT claim R17 governs this tree — that is the sentence being fixed.
    expect(said).not.toContain("removes it before every package (R17)");
  });

  it("judges the same and prints the same with and without --write (the dry run is real)", () => {
    // The statement §4: "without --write — the same judgement and the same print". A dry
    // run that passes where the real one refuses is worse than no dry run.
    const repo = box();
    const workspace = join(repo, ".worktrees", "dev-core");
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", "--detach", workspace]);
    const dir = join(repo, "units");
    const args = ["orchestrator", "systemd", "install", "--unit-dir", dir];
    const at = (extra: string[]) =>
      spawnSync(TSX, [CLI, ...args, ...extra], {
        cwd: workspace,
        encoding: "utf8",
        timeout: 60_000,
        env: sandbox(configHome(repo), {}),
      });

    const dry = at([]);
    const wet = at(["--write"]);

    expect(dry.status).toBe(2);
    expect(wet.status).toBe(2);
    expect(`${dry.stdout}${dry.stderr}`).toBe(`${wet.stdout}${wet.stderr}`);
    expect(existsSync(join(dir, "agent-protocol.service"))).toBe(false);
  });

  it("a closed pipe ends the command quietly — `install | head -1` is not a crash", () => {
    // The operator's tail of thread 019: `status | head` printed a stack trace over the
    // lines it had just produced. EPIPE is the reader leaving, and a shell ends on it
    // silently; the command must do the same, with no trace and a zero status.
    const repo = box();

    const piped = spawnSync(
      "/bin/sh",
      ["-c", `"$TSX" "$CLI" orchestrator systemd install --unit-dir "$DIR" | head -1`],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...sandbox(configHome(repo), {}),
          TSX,
          CLI,
          DIR: join(repo, "units"),
        },
      },
    );

    // `head` took its one line and left; the command that kept printing into the closed
    // pipe ends with the same status as one nobody interrupted.
    expect(piped.status).toBe(0);
    expect(piped.stdout.split("\n").filter((line) => line !== "")).toHaveLength(1);
    expect(piped.stderr).not.toContain("EPIPE");
    // A stack trace is the whole symptom — a frame line is what the operator saw.
    expect(piped.stderr).not.toMatch(/^\s+at /m);
  });
});
