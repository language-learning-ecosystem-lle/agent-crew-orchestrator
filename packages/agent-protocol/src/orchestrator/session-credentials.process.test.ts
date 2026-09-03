/**
 * THE SEAM, NOT THE MAPPING (thread `065`, the last mile).
 *
 * The unit beside this file says what the composition returns. What no unit can be asked is
 * whether the CHILD PROCESS receives it — and that is exactly the shape of the defect this
 * change answers: since #164 the package's own calls take the circuit's credential, every
 * unit about them is green, and a role's `gh pr list` inside a raised session still died
 * with `gh auth login` twenty-seven times in one afternoon, because the session is a
 * different process on a different layer.
 *
 * So the witness is the session itself. It is a stub standing where the agent binary would
 * be, and it reports three things about the environment it was actually handed:
 *
 *  1. the token — proving `gh` would authenticate;
 *  2. what `git credential fill` answers for `github.com` — proving the OTHER half, the one
 *     `GH_TOKEN` alone does not fix: `git push` failed with `could not read Username` while
 *     a token was already in the environment of the same box;
 *  3. …asked of git itself rather than of the variable, because the helper is a shell
 *     snippet git has to accept, and a string that merely looks right is what a unit here
 *     would have measured.
 *
 * AND THE FOURTH FACT IS AN ABSENCE: the value must not be in the stream the supervisor
 * relays into the journal every role of the circuit reads. `not.toContain` over the run's
 * whole output is the assertion, and it is the reason the fake token below is a string that
 * could not appear by accident.
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

/** Unmistakable on purpose: every assertion of absence below is a search for this string. */
const SECRET = "ghp_065_last_mile_do_not_print_me";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const CONFIG = {
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
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

/** The contour of a circuit: an origin, a checkout, a mail branch with a thread waiting. */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-065-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "065-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/**
 * THE WITNESS. It writes down what it was given and what git makes of it — into files of
 * the test's own, never onto its stdout: the stream a session prints on is relayed into the
 * journal, and a witness that printed the secret would make the absence assertion below
 * unfalsifiable by construction.
 */
const witness = (repo: string): { exec: string; token: string; credential: string } => {
  const token = join(repo, "seen-token.txt");
  const credential = join(repo, "seen-credential.txt");
  const path = join(repo, "stub.sh");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `printf '%s' "$GH_TOKEN" > ${token}`,
      // Asked of git, with the helper the launcher composed: this is the call `git push`
      // makes before it talks to the remote, and the one that answered `could not read
      // Username` from a role's session on 2026-09-03.
      `printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill > ${credential} 2>&1`,
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return { exec: path, token, credential };
};

const machineConfig = (repo: string, extra: Record<string, unknown>): void => {
  const dir = join(configHome(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local.json"), `${JSON.stringify({ agents: {}, ...extra }, null, 2)}\n`);
};

/** The secrets file of the circuit, as the machine config names it. */
const secretsFile = (repo: string, body: string): string => {
  const path = join(configHome(repo), "secrets.aco.env");
  mkdirSync(configHome(repo), { recursive: true });
  writeFileSync(path, body);
  return path;
};

const run = (repo: string, exec: string, extra: NodeJS.ProcessEnv = {}): string => {
  try {
    return execFileSync(
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
        "065-x",
        "--exec",
        exec,
        "--wall-clock",
        "20",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo), extra) },
    );
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
};

/** Everything the run wrote where a human or another role can read it. */
const journal = (repo: string, out: string): string => {
  const sessions = join(repo, ".orchestrator", "sessions");
  const files = existsSync(sessions)
    ? execFileSync("sh", ["-c", `cat ${JSON.stringify(sessions)}/* 2>/dev/null || true`], {
        encoding: "utf8",
      })
    : "";
  return `${out}\n${files}`;
};

describe("a session raised by the orchestrator gets the circuit's login (thread 065)", () => {
  it("the token of the instance's secrets file reaches the child process", () => {
    const repo = contour();
    const w = witness(repo);
    machineConfig(repo, { secrets: { envFile: secretsFile(repo, `GH_TOKEN=${SECRET}\n`) } });

    run(repo, w.exec);

    // Asked of the child, not of the code that started it: this is the fact 27 refusals
    // in one afternoon were the absence of.
    expect(readFileSync(w.token, "utf8")).toBe(SECRET);
  }, 60_000);

  it("…and git itself answers with it — the half a bare variable does not buy", () => {
    const repo = contour();
    const w = witness(repo);
    machineConfig(repo, { secrets: { envFile: secretsFile(repo, `GH_TOKEN=${SECRET}\n`) } });

    run(repo, w.exec);

    const filled = readFileSync(w.credential, "utf8");
    expect(filled).toContain("username=x-access-token");
    expect(filled).toContain(`password=${SECRET}`);
  }, 60_000);

  it("…and the value is in NO line the supervisor writes, on either channel", () => {
    // The journal of the daemon is read by every role of the circuit and by whoever
    // operates the box. The names are there, the path is there, the value is not.
    const repo = contour();
    const w = witness(repo);
    const path = secretsFile(repo, `GH_TOKEN=${SECRET}\nTELEGRAM_BOT_TOKEN=t-42\n`);
    machineConfig(repo, { secrets: { envFile: path } });

    const said = journal(repo, run(repo, w.exec));

    expect(said).not.toContain(SECRET);
    expect(said).not.toContain("t-42");
    expect(said).toContain("session credentials");
    expect(said).toContain(path);
    expect(said).toContain("GH_TOKEN");
  }, 60_000);

  it("a token the caller exported wins over the file, and the log says whose it is", () => {
    const repo = contour();
    const w = witness(repo);
    machineConfig(repo, { secrets: { envFile: secretsFile(repo, `GH_TOKEN=${SECRET}\n`) } });

    const said = journal(repo, run(repo, w.exec, { GH_TOKEN: "exported-by-the-operator" }));

    expect(readFileSync(w.token, "utf8")).toBe("exported-by-the-operator");
    expect(said).toContain("not overwritten");
  }, 60_000);

  it("no secrets file on this box → the session is still raised, and the log names the file", () => {
    // The credential is an enrichment, never a gate: a circuit that names no file (or names
    // one that is not there) went on raising sessions before this change and goes on after
    // it. What it gains is the reason, in the log, before the first command dies of it.
    const repo = contour();
    const w = witness(repo);
    const missing = join(configHome(repo), "not-here.env");
    mkdirSync(configHome(repo), { recursive: true });
    machineConfig(repo, { secrets: { envFile: missing } });

    const said = journal(repo, run(repo, w.exec));

    expect(existsSync(w.token)).toBe(true);
    expect(readFileSync(w.token, "utf8")).toBe("");
    expect(said).toContain(missing);
    expect(said).toContain("does not exist");
  }, 60_000);
});
