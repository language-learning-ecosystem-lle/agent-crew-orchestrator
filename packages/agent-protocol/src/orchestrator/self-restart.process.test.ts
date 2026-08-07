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
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { HANG_CEILING_MS } from "../testing/wait-for.js";
import { parseSelfRestartMemory } from "./self-restart.js";

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

/** The mail of a contour — its own branch in the same origin, where the config expects it. */
const seedMail = (origin: string, repo: string): void => {
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
};

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
  seedMail(origin, repo);
  return repo;
};

/**
 * ONE TREE THAT IS BOTH (055.2 in the harness) — the circuit home the daemon serves AND
 * the checkout node loaded its code from. Condition 3 is what the file above measures;
 * everything BEYOND it needs a box where that condition holds, and on this disk only one
 * such box can be built without touching a real one: a contour that carries a copy of
 * these sources inside itself and is raised from that copy.
 *
 * WHAT THE `.gitignore` IS DOING HERE, and it is not tidiness. A running circuit puts
 * three things inside its own home that no commit owns — the mail checkout, the state
 * directory and the linked modules — and for `workingTreeState` untracked IS dirty (a
 * `pull --ff-only` refuses over an untracked file it would overwrite). Without the file
 * the positive case could not exist at all: every run of it would be a `dirty` stand
 * about the fixture's own scaffolding rather than about anything the rule decides.
 *
 * THE HEAD IS LEFT DETACHED ONE COMMIT BEHIND `origin/main`, which is the drift (as in
 * `codeCheckout`, and built for the same reason — 056: a premise borrowed from the
 * ambient checkout is false on the push run after a squash-merge). It is also the reason
 * the repair this test provokes is a repair OF A FIXTURE and dies harmlessly: the child
 * runs `git pull --ff-only` in this tree, which refuses on a detached head, so its phase
 * 3 fails, nothing is raised and the process leaves. What the test asserts is the
 * DECISION and the HANDOVER — the two things the old daemon does and can be held to;
 * what the successor makes of it belongs to `restart`, which has its own tests.
 */
const homeContour = (): { readonly repo: string; readonly cli: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-selfrestart-home-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules\nmailco/\n.orchestrator/\n");
  cpSync(SRC, join(repo, "src"), { recursive: true });
  symlinkSync(NODE_MODULES, join(repo, "node_modules"), "dir");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "the loaded code");
  const loaded = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "push", "-q", "origin", "main");
  seedMail(origin, repo);
  git(repo, "commit", "-qm", "the ref", "--allow-empty");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-q", loaded);
  return { repo, cli: join(repo, "src", "cli.ts") };
};

/** One tick of a real daemon over `repo`, raised from `cli`, with both its streams. */
const tick = (cli: string, repo: string): string => {
  const ran = spawnSync(
    TSX,
    [
      cli,
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
  // Both streams: the daemon says its verdicts on stderr and its queue on stdout, and the
  // assertions live one on each.
  return `${ran.stdout ?? ""}${ran.stderr ?? ""}`;
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
      const said = tick(code.cli, repo);

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

/**
 * THE OTHER TWO CASES, ON A BOX WHERE CONDITION 3 HOLDS (055.2, the acceptance in the
 * harness — curator's decision of 2026-08-07 replacing a live run on the box).
 *
 * The live form was self-contradictory in a way no care could remove: the case says
 * "leases 0", and the session that would run it is itself raised by the daemon and holds
 * one. In the contour that premise is a fact the TEST writes — the journal of this box
 * is a file it owns, and the process measuring it appears in that journal nowhere at all.
 *
 * One positive and one negative, and the negative is the half that matters: the same
 * drift, one condition removed, and the box must go back to standing and saying so —
 * variant (1) is the floor under all of this, and a rule whose "go" is tested while its
 * "stand" is assumed is a rule tested only in the direction it is supposed to work.
 */
describe("the self-restart of a daemon serving the checkout its own code came from", () => {
  it(
    "decides, records the attempt and hands over — the drift is real and the box is clean",
    () => {
      const home = homeContour();
      const said = tick(home.cli, home.repo);

      expect(said).toContain("the LOADED CODE is not the ref");
      // The decision, with the three facts that made it — the line an operator reads
      // instead of watching a process disappear.
      expect(said).toContain("SELF-RESTART: the loaded code is behind");
      expect(said).toContain("leases 0, state clean");
      expect(said).toContain("(attempt 1/2)");
      // The handover: named, with the pid of the process that now owns the sequence and
      // the file its phases go to. This is the last thing the old daemon says.
      expect(said).toMatch(/handed over to the restart process \(pid \d+\)/);
      // And it did not ALSO stand: no branch of the rule fired twice.
      expect(said).not.toContain("no self-restart");

      // THE TRACE THAT OUTLIVES THE PROCESS — the memory keyed by the target, which is
      // what stops a failing repair from being typed every tick. Its target is the SHA
      // the ref resolves to on this disk, not "some sha": a memory of another target is
      // no memory at all (`attemptsFor`).
      const memory = parseSelfRestartMemory(
        readFileSync(join(home.repo, ".orchestrator", "self-restart.json"), "utf8"),
      );
      expect(memory?.attempts).toBe(1);
      expect(memory?.target).toBe(git(home.repo, "rev-parse", "origin/main").trim());
    },
    2 * HANG_CEILING_MS,
  );

  it(
    "launches nobody in the tick it hands over — the repair's short wait stands on zero leases",
    () => {
      // THE LIVE FAILURE OF 2026-08-07, IN THE HARNESS. The fixture already carried it and
      // nobody looked: `seedMail` seeds a thread waiting on `dev-core`, so the tick that
      // hands over is a tick WITH A PLAN — which is exactly the box that morning. The old
      // daemon handed over, launched a nineteen-minute session three lines later, and the
      // repair's 150s wait expired against a daemon that was now draining; the repair left,
      // the predecessor died on the flag it had set, and nothing succeeded it.
      const home = homeContour();
      // Launches are enabled here and nowhere else in this file: the enable gate is the
      // OTHER reason a tick raises nobody, and a case about withholding must not be able
      // to pass because there was nothing to withhold in the first place.
      mkdirSync(join(home.repo, ".orchestrator"), { recursive: true });
      writeFileSync(join(home.repo, ".orchestrator", "enabled"), "");
      const said = tick(home.cli, home.repo);

      // The premise of the case, asserted rather than assumed: there WAS something to
      // launch. Without this line a plan that silently became empty would make the test
      // pass by measuring nothing — the failure mode of every "it did not happen" test.
      expect(said).toContain("the plan of this tick");
      expect(said).toContain("dev-core×055-x");
      expect(said).toMatch(/handed over to the restart process \(pid \d+\)/);

      // The invariant, in the daemon's own words and with the withheld pair named.
      expect(said).toContain("SELF-RESTART: this tick launches NOTHING");
      expect(said).toContain("dev-core×055-x stay in the queue for the successor");

      // And the fact behind the words: no session was taken. The launch writes its own
      // trace before the child is spawned (the workspace it moves, the identity it commits
      // as, the ceilings it gets) — none of that may appear, and no lease may be recorded.
      expect(said).not.toContain("workspace — dev-core:");
      expect(said).not.toContain("ceilings:");
      const journal = join(home.repo, ".orchestrator", "journal.jsonl");
      expect(existsSync(journal) ? readFileSync(journal, "utf8") : "").not.toContain(
        "lease-acquired",
      );
    },
    2 * HANG_CEILING_MS,
  );

  it(
    "stands and says why while a lease is live — a wait of unknown length needs a human",
    () => {
      const home = homeContour();
      // The one difference from the case above: somebody is working under this box. The
      // deadline is far away so that the lease is alive by the rule rather than by the
      // clock of the day the test runs.
      mkdirSync(join(home.repo, ".orchestrator"), { recursive: true });
      writeFileSync(
        join(home.repo, ".orchestrator", "journal.jsonl"),
        `${JSON.stringify({
          kind: "lease-acquired",
          ts: "2026-07-25T10:00:00Z",
          role: "dev-core",
          thread: "055-x",
          deadline: "2099-01-01T00:00:00Z",
        })}\n`,
      );

      const said = tick(home.cli, home.repo);

      expect(said).toContain("the LOADED CODE is not the ref");
      // Variant (1), naming the pair it is waiting for: silence about standing is the
      // whole failure this family of lines was written against.
      expect(said).toContain("no self-restart while sessions are live (dev-core/055-x)");
      // And nothing was done — neither of the two impure halves of a repair.
      expect(said).not.toContain("SELF-RESTART: the loaded code is behind");
      expect(said).not.toContain("handed over to the restart process");
      expect(existsSync(join(home.repo, ".orchestrator", "self-restart.json"))).toBe(false);
    },
    2 * HANG_CEILING_MS,
  );
});
