/**
 * THE LAUNCH DOOR OF PROPERTY 7, AT A REAL CLI (thread 026, step 3, point 4).
 *
 * WHY A PROCESS TEST AND NOT ONLY A UNIT. `kindLeverRefusal` is pure and unit-tested
 * (`kind.test.ts`), and a pure function nobody calls refuses nothing: the defect this
 * file exists against is exactly that shape — a list of levers a kind declares it has no
 * way to honour, sitting in the package with no consumer, while a role with
 * `allowedTools`, `zones` and a step ceiling comes up on codex with all three silently
 * dropped. That run looks, in the journal and in every surface afterwards, like a run
 * that obeyed.
 *
 * So what is checked here is the WORDS AND THE EXIT CODE OF THE REAL COMMAND: the
 * refusal names the role, the kind, each lever and the field that asks for it. A test
 * that asserted only `code === 2` would keep passing on a refusal nobody can act on.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

/** A role that asks for all three argv levers of the table: tools, zones, a ceiling. */
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
      zones: { writes: [], forbidden: ["docs/roles/**"] },
      launch: { allowedTools: ["Bash", "Edit"], limits: { maxTurns: 40 } },
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-kind-lever-"));
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
  // One thread, so the mail the frame reads exists at all: the door under test stands
  // before any of it, but `status` refuses to run on a checkout with no mail directory.
  const thread = join(mail, "agent-comms", "026-codex-agent-kind");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(
    join(thread, "_meta.md"),
    "---\ntitle: T\nparticipants: dev-core, john\nstatus: open\n---\n",
  );
  writeFileSync(
    join(thread, "messages", "2026-08-23T10-00-00Z-john.md"),
    "---\nfrom: john\ndate: 2026-08-23T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n",
  );
  git(mail, "add", ".");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

const status = (repo: string, ...extra: string[]): { code: number; out: string; err: string } => {
  const result = spawnSync(
    TSX,
    [CLI, "orchestrator", "status", "--ref", "HEAD", "--no-fetch", "--repo", repo, ...extra],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

describe("a role asking for a lever its kind has no way to honour", () => {
  it("is refused BY NAME, with the field that asks for each lever", () => {
    const result = status(contour(), "--worker", "codex");

    const said = `${result.out}${result.err}`;
    expect(said).toContain("role 'dev-core' would be raised as 'codex'");
    // Each lever, and beside it the line of the config to change — a refusal naming only
    // the lever sends its reader looking for the ask.
    expect(said).toContain("allowed-tools ('launch.allowedTools' names 2 tool(s): Bash, Edit)");
    expect(said).toContain("zone-deny ('zones' of the role turns into");
    expect(said).toContain("max-turns (a ceiling of 40 step(s) is set (role))");
    // And the two fields that end the standstill, without choosing between them for the
    // project (R14).
    expect(said).toContain("'launch.agent.kind'");
    expect(said).toContain("--worker");
    expect(result.code).toBe(2);
  });

  it("is raised without a word when the kind has every lever it asks for", () => {
    // The same config on `claude-code`: `cannot` is empty there, so this door has nothing
    // to say and the command runs to its end. The negative half matters as much as the
    // refusal — a door that refuses everybody is a door nobody keeps.
    const result = status(contour());

    expect(`${result.out}${result.err}`).not.toContain("has no lever for");
    expect(result.code).toBe(0);
  });
});
