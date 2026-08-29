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
import { parseDriftStandoff, renderDriftStandoff } from "./code-age.js";
import { parseSelfRestartMemory, SELF_RESTART_EXIT_CODE } from "./self-restart.js";

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
const homeContour = (options?: {
  /** Leave the HEAD ON ITS BRANCH one commit behind, so `pull --ff-only` can succeed. */
  readonly pullable?: boolean;
  /**
   * PUT THE BUMP ON THE REF (thread 040): the commit the loaded code is behind is the one
   * that moves `protocolVersion` past what this build supports — the shape of every one of
   * the three outages, and the only fixture in which the version gate fires against a
   * daemon rather than against a one-shot command.
   */
  readonly bumpVersionOnRef?: boolean;
  /**
   * NO DRIFT AT ALL — the box standing exactly on its ref (thread 044). The one shape this
   * fixture could not make until the standoff file existed: everything else here is built
   * to provoke a verdict, and the removal of the standoff is the branch that fires when
   * there is nothing to decide.
   */
  readonly current?: boolean;
}): { readonly repo: string; readonly cli: string } => {
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
  if (options?.bumpVersionOnRef === true) {
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify({ ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION + 1 }, null, 2)}\n`,
    );
    git(repo, "commit", "-qam", "the ref bumps the schema");
  } else git(repo, "commit", "-qm", "the ref", "--allow-empty");
  git(repo, "push", "-q", "origin", "main");
  // THE TWO SHAPES OF THE SAME DRIFT, and which one a case needs is the whole difference
  // between "the decision was taken" and "the repair went through". Detached is the
  // cheaper fixture (its `pull --ff-only` refuses, so the repair dies harmlessly and the
  // test can only assert the DECISION); on the branch the pull fast-forwards, which is
  // what a case about the repair COMPLETING has to have.
  // The third shape: the HEAD is left ON the ref commit, so `codeAge` reads `match` and the
  // tick decides nothing — which is precisely the tick that has to clear a standoff.
  if (options?.current === true) git(repo, "checkout", "-q", "main");
  else if (options?.pullable === true) git(repo, "reset", "--hard", "-q", loaded);
  else git(repo, "checkout", "-q", loaded);
  return { repo, cli: join(repo, "src", "cli.ts") };
};

/** One tick of a real daemon over `repo`, raised from `cli` — both streams AND the code. */
const tickRun = (
  cli: string,
  repo: string,
  env?: Readonly<Record<string, string>>,
): { readonly said: string; readonly status: number | null } => {
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
      env: { ...sandbox(configHome(repo)), ...(env ?? {}) },
      timeout: HANG_CEILING_MS,
    },
  );
  // Both streams: the daemon says its verdicts on stderr and its queue on stdout, and the
  // assertions live one on each.
  return { said: `${ran.stdout ?? ""}${ran.stderr ?? ""}`, status: ran.status };
};

const tick = (cli: string, repo: string): string => tickRun(cli, repo).said;

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

      // THE STANDOFF IS PUBLISHED, AND IT IS A FILE ON THIS DISK (thread 044). The line
      // above proves the daemon SAID it; only this proves the courier can READ it, and the
      // two are different failures — a wrong path, a swallowed write, a field renamed on one
      // side of the bridge all leave the log intact and the digest empty, which is
      // indistinguishable from "there is no drift" — the very defect this file's PR repairs.
      const standoff = parseDriftStandoff(
        readFileSync(join(home.repo, ".orchestrator", "daemon-drift.json"), "utf8"),
      );
      // The two SHAs are the ones this fixture built, not "some sha": a standoff about
      // another pair of commits is a digest line about somebody else's box.
      expect(standoff?.refSha).toBe(git(home.repo, "rev-parse", "origin/main").trim());
      expect(standoff?.sha).toBe(git(home.repo, "rev-parse", "HEAD").trim());
      expect(standoff?.ref).toBe("origin/main");
      expect(standoff?.behind).toBe(1);
      // The reason VERBATIM — the courier composes and never re-derives this verdict, so
      // the sentence the digest will carry has to be the sentence the daemon printed.
      expect(standoff?.why).toBe(
        "no self-restart while sessions are live (dev-core/055-x) — a graceful restart would wait for them, and that wait needs a human",
      );
      expect(said).toContain(standoff?.why ?? "<unread>");
      // And the clock the band is judged on: the drift has a beginning, so a reader two
      // hours later is told about it rather than left with an undated fact.
      expect(standoff?.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    },
    2 * HANG_CEILING_MS,
  );

  it(
    "clears the standoff when the drift is over — a state file that outlives its subject lies",
    () => {
      // The box is ON its ref, and a standoff from the drift it has since caught up on is
      // lying on the floor. Nothing else clears it: this is the branch, and until this test
      // existed no process case executed it at all.
      const home = homeContour({ current: true });
      mkdirSync(join(home.repo, ".orchestrator"), { recursive: true });
      const standoff = join(home.repo, ".orchestrator", "daemon-drift.json");
      writeFileSync(
        standoff,
        renderDriftStandoff({
          refSha: "f".repeat(40),
          sha: "e".repeat(40),
          ref: "origin/main",
          behind: 3,
          since: "2026-08-29T03:24:02Z",
          why: "no self-restart while sessions are live (dev-core/044-x)",
          at: "2026-08-29T05:24:02Z",
        }),
      );

      const said = tick(home.cli, home.repo);

      // The premise, asserted rather than assumed: this tick found no drift. Without it a
      // fixture that quietly drifted would clear the file down the standing branch's path
      // — or not clear it at all — and the case would be measuring nothing.
      expect(said).not.toContain("the LOADED CODE is not the ref");
      expect(said).not.toContain("no self-restart");
      expect(existsSync(standoff)).toBe(false);
    },
    2 * HANG_CEILING_MS,
  );
});

/**
 * THE SEAM THE UNITS CANNOT REACH (thread 003, 2026-08-18): "it went away and it came
 * back". A daemon under a supervisor is raised, its code is behind its ref, and what has
 * to be true afterwards is a fact about PROCESSES — the first one left in a way its
 * supervisor answers, the tree it left behind carries the new code, nothing it set is
 * still on the floor to kill the next start, and the process the supervisor then raises
 * ticks with no drift left to complain about.
 *
 * WHY THERE IS NO systemd HERE, and what stands in for it. The defect being fixed is a
 * property of the CONTRACT between the daemon and any supervisor (leave non-zero, leave
 * nothing behind), and that contract is exactly what a test can drive: the supervisor is
 * two lines of this file — see the exit code, raise it again — which is `Restart=on-failure`
 * with the systemd removed. What genuinely cannot be reproduced here is the OTHER half,
 * that this box's own unit answers a code 75 with a fresh process: a CI runner has neither
 * this systemd nor this unit. That half is the live acceptance on `hetzner`, and it is
 * named as such in the thread rather than quietly assumed.
 *
 * `INVOCATION_ID` is what the daemon reads to know it is supervised (`selfRestartForm`),
 * and systemd is what sets it in the field.
 */
describe("a supervised daemon that finds itself behind its ref", () => {
  it(
    "repairs the tree in place, leaves with a code a supervisor answers, and leaves no flag behind",
    () => {
      const home = homeContour({ pullable: true });
      const behind = git(home.repo, "rev-parse", "HEAD").trim();
      const target = git(home.repo, "rev-parse", "origin/main").trim();
      expect(behind).not.toBe(target);

      const first = tickRun(home.cli, home.repo, { INVOCATION_ID: "test-invocation" });

      // It chose the form that can work here, and said so — the log of 17.08 showed a
      // daemon leaving with no word about the mechanism it was counting on.
      expect(first.said).toContain("this process is supervised");
      expect(first.said).toContain("nothing is spawned and no stop flag is set");
      // And it did NOT do the thing that dies under a cgroup: no child, no `restart`.
      expect(first.said).not.toContain("handed over to the restart process");

      // The repair itself: the pull ran and the tree is ON the target now. This is the
      // half that makes the exit worth anything — a process replaced over the same code
      // would drift again at its first tick.
      expect(first.said).toContain("git pull --ff-only");
      expect(git(home.repo, "rev-parse", "HEAD").trim()).toBe(target);
      // The merge moved no manifest, so the installer had nothing to reconcile and said so.
      expect(first.said).toContain("pnpm install skipped");

      // THE EXIT IS DISTINGUISHABLE FROM A SHUTDOWN. This one assertion is the whole
      // defect: with a 0 here `Restart=on-failure` never fires and the box stands dark.
      expect(first.status).toBe(SELF_RESTART_EXIT_CODE);
      expect(first.status).not.toBe(0);
      expect(first.said).toContain(`leaving with code ${SELF_RESTART_EXIT_CODE}`);

      // NOTHING IS LEFT ON THE FLOOR. A stop flag that outlives a repair turns one failure
      // into a box that stays dark through every attempt to revive it — the second half of
      // the statement, and the reason the field failure cost eleven hours instead of one.
      expect(existsSync(join(home.repo, ".orchestrator", "stop"))).toBe(false);
      expect(existsSync(join(home.repo, ".orchestrator", "force-stop"))).toBe(false);

      // THE SUPERVISOR, WITH THE systemd TAKEN OUT: a non-zero code means raise it again.
      const second = tickRun(home.cli, home.repo, { INVOCATION_ID: "test-invocation-2" });
      // The successor is on the ref, so it repairs nothing and says nothing about drift —
      // and it TICKED, which is the difference between "came back" and "came back to the
      // same problem". A second code 75 here would be the loop this design must not have.
      expect(second.status).toBe(0);
      expect(second.said).not.toContain("the LOADED CODE is not the ref");
      expect(second.said).not.toContain("SELF-RESTART");
      expect(second.said).toContain("agent-protocol: daemon —");
    },
    3 * HANG_CEILING_MS,
  );

  it(
    "does NOT leave when the repair failed — a replacement over the same code would loop",
    () => {
      // The one difference: the HEAD is detached (the default fixture), so `pull --ff-only`
      // refuses. The drift is identical, the verdict is identical, and the exit must not
      // happen — an exit here would hand the supervisor a process that comes straight back
      // to this same tick, at restart speed.
      const home = homeContour();
      const ran = tickRun(home.cli, home.repo, { INVOCATION_ID: "test-invocation" });

      expect(ran.said).toContain("this process is supervised");
      expect(ran.said).toContain("git pull --ff-only FAILED");
      expect(ran.said).toContain("NOT leaving");
      expect(ran.status).not.toBe(SELF_RESTART_EXIT_CODE);
      // The attempt was still counted before the repair ran: the ceiling is what stops a
      // box whose pull can never succeed from trying at tick speed forever.
      const memory = parseSelfRestartMemory(
        readFileSync(join(home.repo, ".orchestrator", "self-restart.json"), "utf8"),
      );
      expect(memory?.attempts).toBe(1);
    },
    2 * HANG_CEILING_MS,
  );
});

/**
 * THE LIVE REHEARSAL OF THE CLASS (thread 040, curator's acceptance): the config on the
 * ref is AHEAD of the build the daemon is running, which is the state every schema bump
 * puts this circuit in for as long as the box has not pulled.
 *
 * What the field trace of 2026-08-28 19:45Z looked like, and what this reproduces: the
 * daemon met `restart required: the repository declares protocol version 21, the package
 * supports only 20` inside an ordinary tick and left with code 2 — the argument door,
 * which the unit of that box is explicitly told never to raise again
 * (`RestartPreventExitStatus=2`, measured by john at 20:05Z). One exit, no replacement,
 * the tree still on the old commit, the circuit dead until a human typed `git pull`.
 *
 * So the assertion is in three parts, and each is a separate way the old behaviour failed:
 * the process does NOT leave by the argument door; it leaves with the code a supervisor
 * answers; and the tree ACTUALLY MOVED to the ref, because a handback over code that did
 * not move is the crash loop this thread exists to end.
 */
describe("a daemon meeting a config newer than its build", () => {
  it(
    "pulls and hands back instead of taking the exit its unit refuses to restart",
    () => {
      const { repo, cli } = homeContour({ pullable: true, bumpVersionOnRef: true });
      const wanted = git(repo, "rev-parse", "origin/main").trim();
      const ran = tickRun(cli, repo);

      expect(ran.status).not.toBe(2);
      expect(ran.status).toBe(SELF_RESTART_EXIT_CODE);
      expect(ran.said).toContain("VERSION VERDICT");
      expect(ran.said).toContain("git pull --ff-only");
      expect(git(repo, "rev-parse", "HEAD").trim()).toBe(wanted);
    },
    2 * HANG_CEILING_MS,
  );

  /**
   * AND THE ENDING THAT CANNOT BE REPAIRED IS ONE FALL, NOT FIVE. `contour()` is a box
   * whose code came from somewhere else entirely, so there is nothing here to pull that
   * would change this process — the honest answer is the argument door, taken ONCE and
   * with the command a hand must type printed beside it. That is what keeps
   * `StartLimitBurst` intact: a supervisor told "2" stops instead of raising four more
   * processes into the same wall.
   */
  it(
    "falls over once, loudly, when no pull of this tree could fix it",
    () => {
      const repo = contour();
      writeFileSync(
        join(repo, "agent-protocol.json"),
        `${JSON.stringify({ ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION + 1 }, null, 2)}\n`,
      );
      git(repo, "commit", "-qam", "the schema bump");
      git(repo, "push", "-q", "origin", "main");
      const ran = tickRun(codeCheckout().cli, repo);

      expect(ran.status).toBe(2);
      expect(ran.said).toContain("VERSION VERDICT");
      expect(ran.said).toContain("A hand is needed");
      expect(ran.said).toContain("start limit stays intact");
    },
    2 * HANG_CEILING_MS,
  );
});
