/**
 * THE SEAM: A TICK THAT RAISED NOBODY → A LETTER A HUMAN CAN READ (thread
 * `180-selfheal-leaves-the-workspaces-behind`, john's П-1 and П-2 of 2026-09-15).
 *
 * The planners beside this file are pure and are tested as such. What NEITHER of them can
 * say is the thing the whole subject is about: that the daemon's own tick, in its own
 * process, with a real mail checkout under a real lock, turns those plans into messages a
 * reader of the feed actually receives. The defect being closed is precisely a fact that
 * WAS computed correctly and printed correctly and reached nobody — 209 ticks of it — so
 * the evidence has to be the feed as `thread show` renders it, and never the daemon's own
 * stdout: a line in the log is exactly what was already there.
 *
 * WHY THE DIRT AND NOT A STALE PIN. The measured fault was a worktree left on an old pin,
 * which is one of several refusals of the SAME door; reproducing it here would mean a real
 * `pnpm install` of two different versions inside a temp directory, which is a minute of
 * network per case and proves nothing extra. Uncommitted work in the tree is the same door
 * saying the same class of thing (`its workspace is not usable: …`), costs one `writeFile`,
 * and is itself a refusal a human has to come and clear by hand.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

const DEV_CORE = {
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "s" },
  summary: "the stream",
  instructions: [{ kind: "in-repo", path: "CARD.md" }],
  launch: { allowedTools: ["Bash"] },
};

/** The sender of both letters — the same one the freeze letter beside them is signed with. */
const GITHUB = {
  id: "github",
  kind: "github-actions",
  status: "active",
  wake: { mode: "event" },
  summary: "the circuit's machine notifier",
};

/** The turn of both letters: never the pair the circuit cannot raise. */
const CURATOR = {
  id: "curator",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "c" },
  summary: "the coordinator",
};

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
  roles: [DEV_CORE, GITHUB, CURATOR],
};

/** What the box runs, and what the tree was left on — the divergence the door reads. */
const CIRCUIT = "0.2.15";
const BEHIND = "0.2.14";

const META = "---\ntitle: T\nparticipants: dev-core, curator, github\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-standstill-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  writeFileSync(join(repo, ".gitignore"), ".worktrees/\n.orchestrator/\nmailco/\nnode_modules/\n");
  writeFileSync(
    join(repo, "package.json"),
    `${JSON.stringify({ name: "consumer", dependencies: { "agent-protocol": "github:x#v0.2.15" } }, null, 2)}\n`,
  );
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

  installed(repo, CIRCUIT);
  return repo;
};

/** The manifest of the package as a tree has it installed — the whole of what is compared. */
function installed(tree: string, version: string): void {
  const dir = join(tree, "node_modules", "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "agent-protocol", version })}\n`,
  );
}

/**
 * THE MEASURED FAULT ITSELF, and it is the one shape the circuit is FORBIDDEN to repair:
 * a worktree behind the box's build AND standing on a branch of its own. john's border of
 * 2026-09-12 keeps the levelling out of such a tree (there may be unlanded work in it), so
 * the door refuses the launch tick after tick — which is exactly the 209 ticks of 15.09.
 */
const stuckWorkspace = (repo: string): string => {
  const tree = join(repo, ".worktrees", "dev-core");
  git(repo, "worktree", "add", "-q", "--detach", tree, "HEAD");
  git(tree, "checkout", "-q", "-b", "dev-core/180-x");
  // THE SIGNATURE THE LAUNCH WOULD HAVE SET. Without it the door refuses this tree for TWO
  // reasons on alternate readings, and two reasons are two fingerprints: the standstill run
  // would reset on every tick and the second bell could never come due. A fixture that made
  // the counter behave differently from the field is worse than no fixture.
  git(tree, "config", "user.name", "dev-core");
  git(tree, "config", "user.email", "dev-core@agents.invalid");
  installed(tree, BEHIND);
  return tree;
};

const enable = (repo: string): void => {
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(join(repo, ".orchestrator", "enabled"), "");
};

/** A session that does nothing: enough for the first tick to build the workspace. */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

const daemon = (repo: string): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "orchestrator",
      "daemon",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      repo,
      "--once",
      "--exec",
      stub(repo),
      "--poll",
      "1",
      // THE ATTEMPT CEILING IS LIFTED OUT OF THE WAY on purpose: a stub session that ends
      // without a handoff is a failed attempt, and at the default ceiling of three the pair
      // FREEZES — which is a different bell (`freeze-letter.ts`) about a different fact, and
      // it would take the candidate out of the queue before the door could refuse it.
      "--max-attempts",
      "99",
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

/**
 * THE FEED AS ITS READER SEES IT, and never the file on disk: the claim under test is that
 * a letter ARRIVED, and a message the loader rejects — a sender the registry does not know,
 * a header it cannot parse — is a file and not an arrival.
 */
const feed = (repo: string): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "thread",
      "show",
      "--root",
      join(repo, "mailco", "agent-comms"),
      "--repo",
      repo,
      "--ref",
      "HEAD",
      "--thread",
      "012-x",
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );

/** How many times a phrase stands in the feed — one letter per fact is the whole claim. */
const times = (text: string, phrase: string): number => text.split(phrase).length - 1;

describe("the bell of an unraisable pair reaches the MAIL (П-1, thread 180)", () => {
  it("writes into the pair's own feed on the first refused tick, and names the cure", () => {
    const repo = contour();
    enable(repo);
    stuckWorkspace(repo);

    const refused = daemon(repo);
    expect(refused.out).toContain("its workspace is not usable");

    const text = feed(repo);
    expect(text).toContain("Рабочее место роли `dev-core` непригодно");
    expect(text).toContain("dev-core×012-x");
    // The cure by name, and the trap named with it: installing is NOT the cure.
    expect(text).toContain("git merge --no-edit origin/main");
    expect(text).toContain("НЕ `pnpm install`");
    // The turn never goes to the pair the circuit will not raise.
    expect(text).toContain("curator");
  });

  it("says it ONCE, not once per tick — which is the 209-tick defect itself", () => {
    const repo = contour();
    enable(repo);
    stuckWorkspace(repo);
    daemon(repo);
    daemon(repo);
    daemon(repo);

    expect(times(feed(repo), "Рабочее место роли `dev-core` непригодно")).toBe(1);
  });
});

/**
 * WHY П-2 IS NOT ASSERTED IN THIS FIXTURE, and it is a FINDING rather than a gap left by
 * the clock — measured here on 2026-09-15, three ticks over the stuck tree above:
 * `stall.json` stayed at `ticks: 1` and the second bell never came due.
 *
 * THE CAUSE IS П-1 ITSELF. The letter it writes carries `waiting-on: curator`, so the
 * moment it lands the thread stops waiting on the refused role — the pair leaves the queue,
 * the next tick has NO candidate at all, and `foldStall` HOLDS the run as it stands rather
 * than extending it (an empty queue is an idle circuit, which is the right answer to the
 * question it was asked). The 209 silent ticks of the field case are therefore not
 * reproducible in a contour that has П-1 in it: the first tick converts them into a turn.
 *
 * That is arguably the outcome john asked for and it is NOT asserted to be, because
 * whether П-2 can still ring at all — and on what shape of standstill — is the question
 * this file cannot answer without a second cause of standing that keeps the queue full.
 * The planner of that letter is covered by `standstill-letter.test.ts`; what is open is the
 * crossing, and it is reported in thread 180 rather than left to be rediscovered.
 */
