/**
 * THE OTHER TWO SURFACES THAT WERE SWITCHED TO THE DISK — `preflight` and `doctor`, thread 177
 * §3.2, and process tests for the same reason `status.workspaces.process.test.ts` is one: what
 * is being measured is not a mapping but a READ OF A REAL DIRECTORY. `workspaceInventoryOf` is
 * pure and every unit of it hands itself the names; the block under test is the one that asks
 * the disk, and only a real `.worktrees` can say whether it asked.
 *
 * AND `doctor` IS THE ONE OF THE THREE THAT IS A DOOR RATHER THAN A DISPLAY: `probeSigningPlaces`
 * walks past a path that is not there without a word, so above a ceiling of one — where the run
 * is seated in `<role>@<thread>` — it probed NOTHING and stayed green about it. A test that only
 * checks the naming would not see that; the case below puts a signature no role answers to in a
 * PAIR tree and demands that `doctor` fail on it by name.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const configOf = (pairsPerRole: number) => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { worktrees: ".worktrees", branch: "main" },
  },
  ...(pairsPerRole === 1 ? {} : { parallelism: { pairsPerRole, pairsPerInstance: pairsPerRole } }),
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
    {
      id: "curator",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "keeper" },
      summary: "the keeper",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
});

/** A contour whose repository is the only thing under test. */
const contour = (pairsPerRole: number): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-doors-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configOf(pairsPerRole), null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  mkdirSync(join(mail, "agent-comms"), { recursive: true });
  writeFileSync(join(mail, "agent-comms", "README.md"), "the mail\n");
  git(mail, "add", ".");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/** A worktree made the way the orchestrator makes one — detached at the base. */
const workspace = (repo: string, name: string): void => {
  git(repo, "worktree", "add", "-q", "--detach", join(repo, ".worktrees", name), "HEAD");
};

/**
 * `.worktrees` REPLACED BY A FILE — the unreadable case, and a file rather than a chmod
 * because a suite that runs as root reads a 0o000 directory happily and the case would
 * quietly stop being one (`ENOTDIR` is a read that failed for every user there is).
 */
const unreadableWorkspaces = (repo: string): void => {
  rmSync(join(repo, ".worktrees"), { recursive: true, force: true });
  writeFileSync(join(repo, ".worktrees"), "not a directory\n");
};

const preflight = (repo: string): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [CLI, "orchestrator", "preflight", "--ref", "HEAD", "--no-fetch", "--repo", repo],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const doctor = (repo: string): { code: number; out: string } => {
  const result = spawnSync(TSX, [CLI, "doctor", "--ref", "HEAD", "--offline"], {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
    env: sandbox(configHome(repo)),
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

describe("`orchestrator preflight` — the workspaces this box actually has (thread 177)", () => {
  it("above the ceiling of one it judges the PAIR trees, not a path predicted from the role", () => {
    const repo = contour(2);
    workspace(repo, "dev-core@177-workspace-per-pair");
    workspace(repo, "dev-core@178-zones-door-silent-pass");

    const said = preflight(repo).out;

    // The two places are the two trees on the disk, named by their own paths — the block
    // that predicted `.worktrees/dev-core` named a directory that is not there and said
    // nothing whatever about these two.
    expect(said).toContain(join(".worktrees", "dev-core@177-workspace-per-pair"));
    expect(said).toContain(join(".worktrees", "dev-core@178-zones-door-silent-pass"));
    // And the role nobody has raised is still named — silence about it is the same defect
    // with the sign flipped.
    expect(said).toContain("workspace: curator");
  });

  it("a tree the ceiling left behind is judged AND told it will never be sat in again", () => {
    const repo = contour(2);
    workspace(repo, "dev-core");
    workspace(repo, "dev-core@177-workspace-per-pair");

    const said = preflight(repo).out;

    expect(said).toContain(join(".worktrees", "dev-core@177-workspace-per-pair"));
    expect(said).toContain("'parallelism.pairsPerRole' is 2");
    expect(said).toContain("no run will be seated in it again");
    expect(said).toContain("174-workspace-tidy-up");
  });

  it("an unreadable '.worktrees' is a NAMED failure, not an empty list judged green", () => {
    const repo = contour(2);
    unreadableWorkspaces(repo);

    const result = preflight(repo);

    expect(result.out).toContain("working tree");
    expect(result.out).toContain("where every role works is declared and unreadable");
    expect(result.out).toContain("no workspace below could be judged at all");
    // A failing check is what preflight refuses on; a silent empty list was exit 0.
    expect(result.code).not.toBe(0);
  });
});

describe("`doctor` asks the trees that EXIST what they sign with (thread 177)", () => {
  it("above the ceiling of one it probes the PAIR tree and names it by role×thread", () => {
    const repo = contour(2);
    workspace(repo, "dev-core@177-workspace-per-pair");
    // A signature inside the roles' domain that no declared role answers to: the one thing
    // `boxIdentityCheck` calls a failure by name. Before the switch to the disk this tree
    // was never asked — `probeSigningPlaces` walked past `.worktrees/dev-core`, which does
    // not exist here, and the row came back "not asked".
    git(
      join(repo, ".worktrees", "dev-core@177-workspace-per-pair"),
      "config",
      "user.email",
      "nobody@agents.invalid",
    );

    const said = doctor(repo).out;

    expect(said).toContain("dev-core×177-workspace-per-pair");
    expect(said).not.toContain("there is no place on this box to ask of");
  });

  it("an unreadable '.worktrees' is named — a box identity that asked of nothing is not green", () => {
    const repo = contour(2);
    unreadableWorkspaces(repo);

    const said = doctor(repo).out;

    expect(said).toContain("git: commit identity (this box)");
    expect(said).toContain("the workspaces are declared and unlistable");
    expect(said).toContain("no role's tree was asked what it signs with");
  });
});
