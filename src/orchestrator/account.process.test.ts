/**
 * THE PROCESS TEST OF THE ACCOUNT (thread 055, B.2) — the door, not the resolver.
 *
 * The resolver is a pure function and is tested as one (`launch.test.ts`). This file
 * exists because of what the two review rounds of PR #196 found twice in a row: a
 * resolution can be complete, unit-tested and unreachable, and nothing about the unit
 * tests says so. The integration point here is the SPAWN — whether the session the
 * package actually starts is pointed at the account's directory — so it is checked by
 * starting one and asking IT what it received, rather than by reading `cli.ts`.
 *
 * The stub is the witness: it writes its own `CLAUDE_CONFIG_DIR` into a file. What the
 * package intended is not evidence; what arrived in the child's environment is.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const configOf = (account?: string): Record<string, unknown> => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"], ...(account === undefined ? {} : { account }) },
    },
  ],
});

/** The same contour every process test of a run needs: origin, checkout, mail branch. */
const contour = (account?: string): { repo: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-account-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configOf(account), null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "055-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo };
};

/**
 * The witness. It reports the environment it was given — the empty string when the
 * variable is unset, which is a DIFFERENT answer from "the default path" and the test
 * below depends on telling the two apart.
 */
const witness = (repo: string): { exec: string; seen: string } => {
  const seen = join(repo, "seen.txt");
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' "$CLAUDE_CONFIG_DIR" > ${seen}\n`);
  chmodSync(path, 0o755);
  return { exec: path, seen };
};

const machineConfig = (repo: string, extra: Record<string, unknown>): void => {
  const dir = join(configHome(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local.json"), `${JSON.stringify({ agents: {}, ...extra }, null, 2)}\n`);
};

const run = (repo: string, exec: string): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "055-x",
        "--exec",
        exec,
        "--wall-clock",
        "20",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("the account of a run reaches the session it raises (thread 055)", () => {
  it("the role names an account → the session is spawned pointed at its directory", () => {
    const { repo } = contour("second");
    const { exec, seen } = witness(repo);
    machineConfig(repo, { accounts: { second: { configDir: "/home/j/.claude-second" } } });

    run(repo, exec);

    // Asked of the child, not of the code that started it.
    expect(readFileSync(seen, "utf8")).toBe("/home/j/.claude-second");
  }, 60_000);

  it("the role names none → the variable is not set at all, not set to a default", () => {
    // The difference matters to one real operator: whoever exported CLAUDE_CONFIG_DIR
    // before starting the daemon. Writing a default over it would be the package
    // deciding something nobody asked it to decide.
    const { repo } = contour();
    const { exec, seen } = witness(repo);
    machineConfig(repo, {});

    run(repo, exec);

    expect(readFileSync(seen, "utf8")).toBe("");
  }, 60_000);

  it("…and an inherited value survives that silence", () => {
    const { repo } = contour();
    const { exec, seen } = witness(repo);
    machineConfig(repo, {});

    try {
      execFileSync(
        TSX,
        [
          CLI,
          "orchestrator",
          "run",
          "--ref",
          "HEAD",
          "--no-fetch",
          "--repo",
          repo,
          "--role",
          "dev-core",
          "--thread",
          "055-x",
          "--exec",
          exec,
          "--wall-clock",
          "20",
          "--poll",
          "1",
          "--write",
        ],
        {
          cwd: repo,
          encoding: "utf8",
          stdio: "pipe",
          env: sandbox(configHome(repo), { CLAUDE_CONFIG_DIR: "/home/j/.claude-exported" }),
        },
      );
    } catch {
      // The outcome of the run is the other file's subject; this one asks the child.
    }

    expect(readFileSync(seen, "utf8")).toBe("/home/j/.claude-exported");
  }, 60_000);

  it("the role names an account this box does not declare → refused BY NAME, nothing spawned", () => {
    // The failure this whole layer exists against: a quiet fall-back would raise the
    // role on a subscription nobody assigned it and look exactly like a run that
    // obeyed. So the refusal has to happen BEFORE the spawn — the witness file not
    // existing is the load-bearing half of this assertion.
    const { repo } = contour("second");
    const { exec, seen } = witness(repo);
    machineConfig(repo, {});

    const result = run(repo, exec);

    expect(result.code).not.toBe(0);
    expect(result.out).toContain("accounts.second.configDir");
    expect(existsSync(seen)).toBe(false);
  }, 60_000);
});
