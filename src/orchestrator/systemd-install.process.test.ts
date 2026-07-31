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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
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
    expect(done.stdout).toContain(`would write ${join(dir, "lle-orchestrator.service")}`);
    expect(done.stdout).toContain("ExecStart=");
    // The disk is the assertion: a dry run that quietly wrote the file would print the
    // very same text.
    expect(existsSync(join(dir, "lle-orchestrator.service"))).toBe(false);
  });

  it("--write puts the unit there, and says 'replaced' the second time", () => {
    const repo = box();
    const dir = join(repo, "units");
    const unit = join(dir, "lle-orchestrator.service");

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
    expect(first.stdout).toContain("systemctl --user enable --now lle-orchestrator.service");
    expect(first.stdout).toContain("loginctl enable-linger");

    const again = run(repo, "orchestrator", "systemd", "install", "--unit-dir", dir, "--write");

    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`replaced ${unit}`);
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
});
