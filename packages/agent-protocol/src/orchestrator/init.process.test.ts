/**
 * INIT ON A BOX THAT HAS NOTHING YET — the wiring of the occupancy warning, not the
 * sentence it renders.
 *
 * The sentence is a pure function and is tested as one (`init.test.ts`, `instanceStep`
 * with an occupant handed to it). What a pure function cannot be asked is WHERE the
 * occupant came from, and that is the whole defect this file exists for: the digest was
 * read as a FILE inside the mail worktree, while `init` creates that worktree further
 * down its own body. On the box the warning is written for — one being commissioned from
 * nothing, the acceptance scenario of the statement — the file could not exist yet, so
 * the lookup answered "free" for every id and the WARNING never printed once.
 *
 * Hence a process test over a real origin with a real mail branch: the id is taken by a
 * neighbour ON THE BRANCH and by nobody on this disk, which is the exact state of a
 * fresh box and the one state the pure test cannot express.
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

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "HEAD" },
  instances: [
    { id: "acme-agents", roles: ["dev-core"] },
    { id: "spare", roles: ["curator"] },
  ],
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the one" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
    {
      id: "curator",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "c" },
      summary: "the other",
    },
  ],
};

const DIGEST = {
  instance: "acme-agents",
  writtenAt: "2026-07-30T11:00:00Z",
  roles: ["dev-core"],
  leases: [],
};

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

/**
 * A checkout with an ORIGIN whose `comms` branch already carries a neighbour's digest —
 * and no mail worktree on disk, because that is what `init` is for. The origin is a
 * second repository rather than a stub remote: the command fetches, and a fetch is the
 * half of the lookup that a fake would quietly skip.
 */
const box = (): { readonly repo: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-init-"));
  const origin = join(base, "origin");
  execFileSync("git", ["init", "-q", "-b", "comms", origin]);
  mkdirSync(join(origin, "agent-comms", "_instances"), { recursive: true });
  writeFileSync(
    join(origin, "agent-comms", "_instances", "acme-agents.json"),
    `${JSON.stringify(DIGEST, null, 2)}\n`,
  );
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "the neighbour publishes");

  const repo = join(base, "work");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "the config");
  git(repo, "remote", "add", "origin", origin);
  return { repo };
};

/**
 * The steps, whatever the code. `init` without `--write` decides and prints and DOES
 * none of it — which is exactly the reading this file needs, and it keeps the test from
 * creating worktrees on the box that runs the suite. The one effect a plan does have is
 * the occupancy read itself (a fetch of the mail branch), and it is asserted below
 * rather than assumed away.
 */
const initIn = (repo: string, ...extra: readonly string[]): string => {
  const done = spawnSync(
    TSX,
    [CLI, "init", "--ref", "HEAD", "--repo", repo, "--instance", "acme-agents", ...extra],
    { cwd: repo, encoding: "utf8", env: sandbox(configHome(repo)) },
  );
  return `${done.stdout ?? ""}${done.stderr ?? ""}`;
};

describe("init reads occupancy of an instance id from the branch (R13)", () => {
  it("warns with the neighbour's digest though no mail checkout exists yet", () => {
    const { repo } = box();
    const said = initIn(repo);
    expect(said).toContain("already publishes a digest");
    // The digest itself, not just the fact of one: the operator's decision is made out of
    // WHEN it was written and WHICH roles it claims, and a warning without them is noise.
    expect(said).toContain("written 2026-07-30T11:00:00Z");
    expect(said).toContain("roles dev-core");
  });

  it("says the occupancy is unchecked when it is not allowed to look (--offline)", () => {
    const { repo } = box();
    const said = initIn(repo, "--offline");
    // "No data" and "nobody is there" are different facts, and silence renders as the
    // second one. The id is taken on the branch here — the run just may not read it.
    expect(said).toContain("occupancy of 'acme-agents' NOT checked");
    expect(said).not.toContain("already publishes a digest");
  });

  /**
   * THE PLAN'S OWN WORD MEASURED AGAINST '.git' (round 7 of thread 019). Reading the
   * occupancy of an id on a box with no mail checkout means fetching the mail branch —
   * `refs/remotes/origin/comms` comes into being — while the summary line and USAGE both
   * promised a plan that "touched nothing". The effect is kept (a warning that arrives
   * with the write is a warning after the decision) and the sentence now names it, so
   * this test pins BOTH halves: the ref that appeared, and the words about it.
   */
  it("names the fetch its plan made, and the ref is really there afterwards", () => {
    const { repo } = box();
    expect(git(repo, "show-ref")).not.toContain("refs/remotes/origin/comms");
    // --exec keeps the run off the 'no binary on PATH' blocker, whose summary is a
    // refusal rather than a plan: this test is about the sentence a plan prints.
    const said = initIn(repo, "--exec", process.execPath);
    expect(said).not.toContain("nothing was touched");
    expect(said).toContain("'comms' was fetched");
    expect(git(repo, "show-ref")).toContain("refs/remotes/origin/comms");
  });

  it("touches nothing at all — and says the plain sentence — when told --offline", () => {
    const { repo } = box();
    const said = initIn(repo, "--offline", "--exec", process.execPath);
    expect(said).toContain("nothing was touched");
    // The claim is checked, not trusted: no branch was read, so no ref moved.
    expect(git(repo, "show-ref")).not.toContain("refs/remotes/origin/comms");
  });

  it("says nothing about occupancy when the branch is read and the id is free", () => {
    const { repo } = box();
    const said = spawnSync(
      TSX,
      [CLI, "init", "--ref", "HEAD", "--repo", repo, "--instance", "spare"],
      { cwd: repo, encoding: "utf8", env: sandbox(configHome(repo)) },
    );
    const out = `${said.stdout ?? ""}${said.stderr ?? ""}`;
    expect(out).not.toContain("already publishes a digest");
    expect(out).not.toContain("NOT checked");
  });
});
