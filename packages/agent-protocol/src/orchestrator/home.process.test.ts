/**
 * THE PROCESS TEST OF THE MACHINE'S HOME (R26).
 *
 * The defect lives in what GIT ANSWERS INSIDE A LINKED WORKTREE: `--show-toplevel`
 * returns the worktree, so the state directory of the circuit was resolved beside the
 * work instead of in the checkout that hosts it. A unit test over a stubbed resolver
 * could not have caught that — the stub is exactly the thing that was wrong — so the
 * circuit here is a REAL repository with a REAL `git worktree add`, and the CLI is
 * started as a real process from each of the two directories.
 *
 * What is asserted is the pair of senses that had to be split: the STATE is the same
 * from both places (that is the fix), and the CONFIG is still read from the tree the
 * command was called in (that is the boundary the fix must not sweep away — it is what
 * a reviewer measures a feature branch with).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { CircuitHomeError, circuitHome } from "./home.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const DEV_CORE = {
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "s" },
  summary: "the stream",
  launch: { allowedTools: ["Bash"] },
};

const CURATOR = {
  id: "curator",
  kind: "resident",
  status: "active",
  wake: { mode: "resident" },
  summary: "the one that is already reading",
};

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  instances: [{ id: "main", roles: ["dev-core"] }],
  roles: [DEV_CORE, CURATOR],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

type Contour = {
  /** The main checkout: the machine's home, where the state belongs. */
  readonly repo: string;
  /** A linked worktree of the same repository — where a raised session lives (R17). */
  readonly workdir: string;
};

/** A bare origin, a main checkout, a mail checkout and one linked worktree. */
const contour = (): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-home-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");

  // The workspace of a role, made the way R17 makes it: a linked worktree inside the
  // checkout, on its own branch — so its HEAD can legitimately differ from main's.
  const workdir = join(repo, ".worktrees", "dev-core");
  git(repo, "worktree", "add", "-q", "-b", "feat/x", workdir);
  return { repo, workdir };
};

const cli = (cwd: string, home: string, ...args: string[]): string =>
  execFileSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", env: sandbox(home) });

/** The lines of `renderPaths` — everything the circuit addresses on this machine. */
const addressed = (output: string): readonly string[] =>
  output
    .split("\n")
    .filter((line) => /^(state|journal|flags|holds|session logs|notify state|mail):/.test(line));

describe("the state of the circuit is addressed from the machine (R26)", () => {
  it("a command called from a linked worktree addresses the same state as one called from the main checkout", () => {
    const { repo, workdir } = contour();
    const home = configHome(repo);

    const fromRepo = cli(repo, home, "orchestrator", "status", "--ref", "HEAD");
    const fromWorkdir = cli(workdir, home, "orchestrator", "status", "--ref", "HEAD");

    expect(addressed(fromWorkdir)).toEqual(addressed(fromRepo));
    // And it is the MAIN checkout the paths point into — equality alone would also be
    // satisfied by both pointing at the same wrong place.
    expect(fromWorkdir).toContain(`state:    ${join(repo, ".orchestrator")}`);
    expect(fromWorkdir).toContain(`mail:     ${join(repo, "mailco", "agent-comms")}`);
  });

  it("a hold taken from a workspace is the hold the circuit sees — the expensive half of the defect", () => {
    const { repo, workdir } = contour();
    const home = configHome(repo);

    cli(workdir, home, "orchestrator", "hold", "dev-core", "--by", "curator", "--ref", "HEAD");

    // The hold landed in the machine's home...
    expect(readdirSync(join(repo, ".orchestrator", "holds"))).toContain("dev-core");
    // ...and nothing was created beside the work: a phantom state directory is what
    // made the daemon raise a second session on top of a live conversation.
    expect(existsSync(join(workdir, ".orchestrator"))).toBe(false);
    // ...and the reader of the state, called from the main checkout, sees it.
    expect(cli(repo, home, "orchestrator", "status", "--ref", "HEAD")).toContain("dev-core");
  });

  it("`mail` from a workspace finds the real mail without --root", () => {
    const { repo, workdir } = contour();
    const out = cli(workdir, configHome(repo), "mail", "--role", "dev-core", "--ref", "HEAD");
    expect(out).toContain("012-x");
  });

  it("the config is still read from the tree the command was called in", () => {
    const { repo, workdir } = contour();
    const home = configHome(repo);
    // A third role exists at the worktree's HEAD and nowhere else — exactly the shape of
    // a feature branch under review.
    const branched = {
      ...CONFIG,
      roles: [
        ...CONFIG.roles,
        {
          ...DEV_CORE,
          id: "dev-speech",
          wake: { mode: "watch", session: "s2" },
          summary: "the other stream",
        },
      ],
      instances: [{ id: "main", roles: ["dev-core", "dev-speech"] }],
    };
    writeFileSync(join(workdir, "agent-protocol.json"), `${JSON.stringify(branched, null, 2)}\n`);
    git(workdir, "commit", "-qam", "a role on the branch");

    expect(cli(workdir, home, "roles", "list", "--ref", "HEAD")).toContain("dev-speech");
    expect(cli(repo, home, "roles", "list", "--ref", "HEAD")).not.toContain("dev-speech");
    // ...while the state both of them address is still the one of this machine.
    expect(cli(workdir, home, "orchestrator", "status", "--ref", "HEAD")).toContain(
      `state:    ${join(repo, ".orchestrator")}`,
    );
  });

  it("refuses with a reason where the anchor gives no checkout, instead of inventing an empty state", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-protocol-home-detached-"));
    // A checkout whose git directory is kept OUTSIDE it: `--show-toplevel` answers
    // normally, so nothing upstream refuses, and the anchor lands on a directory that
    // is not a `.git` inside a checkout. Guessing here would mean hanging the state off
    // whatever that directory's parent happens to be.
    const repo = join(base, "work");
    mkdirSync(repo, { recursive: true });
    execFileSync("git", [
      "init",
      "-q",
      "-b",
      "main",
      `--separate-git-dir=${join(base, "elsewhere.git")}`,
      repo,
    ]);

    expect(() => circuitHome(repo)).toThrow(CircuitHomeError);
    expect(() => circuitHome(repo)).toThrow(/is not a '\.git' inside a checkout/);

    // A bare repository is refused by its own sentence: it has no working tree at all,
    // so there is nowhere for the state to live even in principle.
    const bare = join(base, "bare.git");
    execFileSync("git", ["init", "--bare", "-q", "-b", "main", bare]);
    expect(() => circuitHome(bare)).toThrow(/bare repository/);
  });
});
