/**
 * A DAEMON DOES NOT REPAIR A TREE IT DOES NOT SERVE (055.2, condition 3).
 *
 * The case is measured rather than imagined, and this file is where it was measured:
 * every process test of this package raises a REAL daemon over a temporary repository
 * while node loads the modules from a checkout that is not that repository. `--ref` is
 * resolved in the checkout the CODE came from (that is the whole question 023.2 asks —
 * "is what this process is running behind the ref it judges by"), the box is idle and
 * clean, and the memory of attempts lives in the temporary repository, which is to say
 * it is always empty. Without this condition the first self-restart of this package's
 * history would have fired inside its own test suite: `restart --pull` against the
 * ROLE'S OWN WORKTREE — the tree R17 resets, locks and removes under the circuit, the
 * last tree on this box anything may pull unattended.
 *
 * THE DRIFT IS BUILT, NOT BORROWED (056), and that is the whole of what this file
 * learned on 2026-08-05. The daemon only reaches the self-restart verdict ON A DRIFT, so
 * this test needs one; the first version took it from the ambient checkout, whose HEAD
 * "is not `origin/main` on any developer branch". True on a branch and true on a PR run
 * (its HEAD is the merge commit `refs/pull/N/merge`) — and FALSE, by construction, on the
 * push run that follows a squash-merge: the runner's checkout stands exactly on
 * `origin/main`, there is no drift, the daemon is rightly silent and the assertion has
 * nothing to find. So the test was green on its own PR (#203) and red on `main` the
 * minute it landed, every time rather than sometimes — run `31022692529`, the single red
 * of 1842. The premise now belongs to the test: the code is raised from a SMALL CHECKOUT
 * THIS FILE BUILDS (a copy of these sources, its own git repository, its `origin/main`
 * one commit ahead of the HEAD it is loaded from), so the drift is a fact of the fixture
 * and holds identically on a branch, on a PR run and on `main`.
 *
 * So the assertion is in two halves, and the second is the one that matters: the refusal
 * is SAID (a box that is behind and standing must never be silent about why, that is the
 * whole of variant (1)), and nothing was done — no attempt recorded, no handover
 * announced. A test that only read the stream would pass on a daemon that spawned the
 * repair and described it wrongly.
 *
 * One tick is enough (`--once`): the verdict is taken every tick from the same facts, and
 * a second round would only add ways to be slow.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { HANG_CEILING_MS } from "../testing/wait-for.js";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const NODE_MODULES = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "origin/main" },
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

/** A box of its own: its own origin, its own mail, its own state — and NOT this code's tree. */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-selfrestart-"));
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
  const thread = join(mail, "agent-comms", "055-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/**
 * THE CHECKOUT THE CODE COMES FROM — a copy of these sources with a git history of its
 * own, so the one fact this test needs (loaded code behind the ref it judges by) is put
 * there by the test instead of being read off whatever branch the box happens to be on.
 *
 * `zod` is the only thing these modules want from outside themselves, and the hoisted
 * linker keeps it at the root of the repo: one symlink is cheaper than a copy and is
 * stored by git as a symlink, so `add .` does not walk into it.
 *
 * The ref is ONE COMMIT AHEAD of the HEAD the code is loaded from — the shape of the
 * real state: a process up since before a merge, on a disk where the ref has moved.
 */
const codeCheckout = (): { readonly cli: string; readonly toplevel: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-selfrestart-code-"));
  cpSync(SRC, join(base, "src"), { recursive: true });
  symlinkSync(NODE_MODULES, join(base, "node_modules"), "dir");
  execFileSync("git", ["init", "-q", "-b", "main", base]);
  git(base, "add", ".");
  git(base, "commit", "-qm", "the loaded code");
  const loaded = git(base, "rev-parse", "HEAD").trim();
  git(base, "commit", "-qm", "the ref", "--allow-empty");
  git(base, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(base, "checkout", "-q", loaded);
  return {
    cli: join(base, "src", "cli.ts"),
    // The toplevel AS GIT REPORTS IT: the daemon names the same string, and on a box
    // where the temp directory is itself a symlink the two spellings differ.
    toplevel: git(base, "rev-parse", "--show-toplevel").trim(),
  };
};

describe("the self-restart of a daemon serving somebody else's checkout", () => {
  it(
    "says why it is standing and touches nothing — the repair would pull the code's own tree",
    () => {
      const repo = contour();
      const code = codeCheckout();
      const ran = spawnSync(
        TSX,
        [
          code.cli,
          "orchestrator",
          "daemon",
          "--ref",
          "origin/main",
          "--repo",
          repo,
          "--exec",
          "/bin/true",
          "--once",
          "--tick",
          "1",
          "--poll",
          "1",
        ],
        {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: sandbox(configHome(repo)),
          timeout: HANG_CEILING_MS,
        },
      );
      // Both streams: the daemon says its verdicts on stderr and its queue on stdout,
      // and the two halves of this assertion live one on each.
      const said = `${ran.stdout ?? ""}${ran.stderr ?? ""}`;

      // The drift is REAL here — the state 023.2 measures, and it is real BY
      // CONSTRUCTION: the code was loaded from a checkout this test built one commit
      // behind its own `origin/main`.
      expect(said).toContain("the LOADED CODE is not the ref");
      // Half one: it is not silent about standing (variant (1) is the floor). Both trees
      // are named, and they are the two the daemon was actually given.
      expect(said).toContain("no self-restart — this daemon runs code loaded from");
      expect(said).toContain(code.toplevel);
      expect(said).toContain(repo);
      // Half two, the one that matters: NOTHING was done. Neither of the two impure
      // things a repair does — recording the attempt, handing over — happened.
      expect(said).not.toContain("SELF-RESTART: the loaded code is behind");
      expect(said).not.toContain("handed over to the restart process");
      expect(existsSync(join(repo, ".orchestrator", "self-restart.json"))).toBe(false);
    },
    2 * HANG_CEILING_MS,
  );
});
