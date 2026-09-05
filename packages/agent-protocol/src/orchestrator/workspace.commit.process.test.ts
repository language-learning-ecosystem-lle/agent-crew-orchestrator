/**
 * THE PROCESS HALF OF THE RIGHT TO TIDY UP (thread `099-dirty-tree-locks-the-role`,
 * §4 of curator's statement) — the seam `workspace.test.ts` cannot hold.
 *
 * The unit tests beside `planWorkspace` prove WHICH plan a state of the head produces.
 * They cannot prove any of the four facts this file is about, because every one of them
 * is about a real repository: that the commit lands on the branch the plan named, that
 * the tree is CLEAN afterwards and the next launch therefore plans a move rather than a
 * refusal, that the work is in the commit WHOLE, that the author is the role and not the
 * owner of the process, and that a commit git refuses comes back as a refusal with a
 * cause over a tree that is still dirty. #261 paid for exactly this gap once already —
 * a `CARD.md` that only a real tree had.
 *
 * The circuit here is the one `run.process.test.ts` builds: a bare origin, a working
 * checkout with the config on `main`, a separate mail checkout on `comms`. The dirt is
 * not written by the test either — it is left by a REAL session (a stub that writes a
 * file and exits without passing the turn), so `previousReason` is a journal fact and
 * not a fixture.
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

import { roleIdentity } from "../roles/identity.js";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    // THE WORKSPACES ARE DECLARED and that is load-bearing for every case here: without
    // them the session inherits the operator's checkout and `planWorkspace` is never
    // consulted at all.
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
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

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const contour = (): { repo: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-tidy-"));
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
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo };
};

/** A "session" stub: it does what it is asked and exits. */
const stub = (repo: string, body: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

const runWith = (
  repo: string,
  extra: readonly string[],
  env: Record<string, string> = {},
): { code: number; out: string } => {
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
        "012-x",
        "--poll",
        "1",
        "--wall-clock",
        "60",
        "--write",
        ...extra,
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo), env) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/**
 * THE DIRT IS LEFT BY A RUN, NOT BY THE TEST. The stub writes one tracked change and one
 * brand-new file into the workspace and exits without passing the turn — the release
 * reason is then `exited-without-handoff`, which is precisely the class john opened the
 * right for: a turn that ENDED and left work behind.
 *
 * The second launch is `--fresh` on purpose: an unfinished session is otherwise a
 * candidate for a RESUME, and a resume keeps the tree exactly as it is (`keep`) — the
 * tidy-up would never be reached, and the test would prove nothing about it.
 */
const leaveDirtBehind = (repo: string, workspace: string): void => {
  const exec = stub(
    repo,
    `printf 'the role card, edited by the session\\n' > ${workspace}/CARD.md\nprintf 'a new file\\n' > ${workspace}/NOTE.md`,
  );
  runWith(repo, ["--exec", exec]);
};

const dirty = (workspace: string): boolean => git(workspace, "status", "--porcelain").trim() !== "";

describe("the circuit commits what a finished run left behind — on a real tree", () => {
  it("dirt on the ROLE'S OWN branch is committed onto it, and the next launch plans a move", () => {
    const { repo } = contour();
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    // The head the role owns by NAME — the first of the two facts `classifyWorkspaceHead`
    // accepts, and the one a role's own package branch has.
    git(workspace, "checkout", "-q", "-b", "dev-core/012-x");
    expect(dirty(workspace), "the session's leftovers are not in the tree").toBe(true);

    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);

    expect(second.out).toContain("committing what the 'exited-without-handoff' run left");
    expect(second.out).toContain("onto its own branch 'dev-core/012-x'");
    // THE TREE IS CLEAN — the whole point of the right: the role starts on the next tick.
    expect(dirty(workspace), "the tree is still dirty after the tidy-up").toBe(false);
    // …and the work is on that branch, both halves of it: the edit and the new file.
    const show = git(workspace, "show", "--stat", "--name-only", "dev-core/012-x");
    expect(show).toContain("CARD.md");
    expect(show).toContain("NOTE.md");
    expect(git(workspace, "show", "dev-core/012-x:NOTE.md")).toBe("a new file\n");

    // AND THE NEXT LAUNCH PLANS A MOVE, not a refusal (§4): the head is detached at the
    // base again, so a third run has nothing to tidy and says so.
    const third = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);
    expect(third.out).toMatch(/dev-core: .* — (already at|moving to) /);
    expect(third.out).not.toContain("uncommitted changes");
  }, 180_000);

  it("dirt on a DETACHED head goes to a service branch, whole, and the branch is pushed", () => {
    const { repo } = contour();
    const workspace = join(repo, ".worktrees", "dev-core");

    // No `checkout -b` here: a workspace is created detached at the base commit, so this
    // is the ORDINARY state of a role's tree, not an exotic one.
    leaveDirtBehind(repo, workspace);
    // WHAT IS IN THE TREE, MEASURED BEFORE — the paths as git names them and the bytes of
    // each. `git diff HEAD` alone would not do: it does not see an untracked file, and an
    // untracked file is the most common leftover of a session there is.
    const before = git(workspace, "status", "--porcelain")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(before.sort()).toEqual(["?? NOTE.md", "M CARD.md"]);
    const bytes = {
      "CARD.md": readFileSync(join(workspace, "CARD.md"), "utf8"),
      "NOTE.md": readFileSync(join(workspace, "NOTE.md"), "utf8"),
    };

    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);

    expect(second.out).toContain("onto a new service branch 'wip/dev-core/012-x-");
    expect(dirty(workspace)).toBe(false);

    const branch = git(workspace, "branch", "--list", "wip/*")
      .trim()
      .replace(/^\*?\s*/, "");
    expect(branch).toMatch(/^wip\/dev-core\/012-x-\d{8}T\d{4}Z$/);
    // THE WORK IS IN THERE WHOLE, AND NOTHING ELSE IS: the paths the branch adds over the
    // base are exactly the ones that were dirty, and every one of them carries the bytes
    // that were on the disk. `--name-only` against the head the tree is back on is the
    // same comparison the statement asks for, taken where the untracked file counts too.
    expect(git(workspace, "diff", "--name-only", "HEAD", branch).trim().split("\n").sort()).toEqual(
      ["CARD.md", "NOTE.md"],
    );
    for (const [path, content] of Object.entries(bytes)) {
      expect(git(workspace, "show", `${branch}:${path}`), `${path} did not survive whole`).toBe(
        content,
      );
    }
    // …and it is visible off this box: `origin` is a real repository here, so a push
    // that silently did nothing would show up as a missing ref.
    expect(git(join(repo), "ls-remote", "--heads", "origin", branch)).toContain(branch);
  }, 180_000);

  it("the commit is authored by the ROLE, never by the owner of the process", () => {
    const { repo } = contour();
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);

    const branch = git(workspace, "branch", "--list", "wip/*")
      .trim()
      .replace(/^\*?\s*/, "");
    const who = roleIdentity("dev-core");
    // Author AND committer: the identity goes in through `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
    // exactly because the per-worktree signature is written AFTER the plan is applied —
    // at this moment the tree's own config cannot be relied on.
    expect(git(workspace, "log", "-1", "--format=%an <%ae>", branch)).toBe(
      `${who.name} <${who.email}>\n`,
    );
    expect(git(workspace, "log", "-1", "--format=%cn <%ce>", branch)).toBe(
      `${who.name} <${who.email}>\n`,
    );
    expect(git(workspace, "log", "-1", "--format=%s", branch)).toContain(
      "wip(012-x): what the 'exited-without-handoff' run of 'dev-core' left uncommitted",
    );
  }, 180_000);

  it("a commit git refuses is a REFUSAL WITH A CAUSE over a tree that is still dirty", () => {
    const { repo } = contour();
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);

    // The failure is INSTALLED rather than waited for: a `git` ahead of the real one on
    // the run's PATH that refuses exactly the commit and delegates everything else. Any
    // other way of making the commit fail (a broken index, a hook) would be testing that
    // fixture instead of the branch under test.
    const shimDir = join(repo, "gitshim");
    mkdirSync(shimDir, { recursive: true });
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const shim = join(shimDir, "git");
    writeFileSync(
      shim,
      `#!/bin/sh\ncase " $* " in *" commit "*) echo "fatal: the index is broken" >&2 ; exit 128 ;; esac\nexec ${realGit} "$@"\n`,
    );
    chmodSync(shim, 0o755);

    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], {
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    });

    // WHAT WAS TRIED AND HOW GIT ANSWERED — the line that tells "the circuit may not
    // touch this" apart from "the circuit tried and failed".
    expect(second.out).toContain("the commit FAILED");
    expect(second.out).toContain("fatal: the index is broken");
    // …over everything the refusal of #261 already carried: composition, scope, repairs.
    expect(second.out).toContain("CARD.md");
    expect(second.out).toContain("skipped on EVERY thread it holds a turn on");
    expect(second.out).toContain(`git -C ${workspace} stash push -u`);
    // AND THE TREE IS UNTOUCHED: a failed tidy-up leaves the work exactly where the
    // session left it, which is the reason this stop exists at all.
    expect(dirty(workspace)).toBe(true);
    expect(readFileSync(join(workspace, "NOTE.md"), "utf8")).toBe("a new file\n");
    expect(existsSync(join(workspace, "NOTE.md"))).toBe(true);
  }, 180_000);
});
