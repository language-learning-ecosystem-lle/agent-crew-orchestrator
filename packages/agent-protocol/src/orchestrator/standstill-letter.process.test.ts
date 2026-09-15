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

const config = (devCore: Record<string, unknown>): Record<string, unknown> => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
  roles: [devCore, GITHUB, CURATOR],
});

/**
 * THE DOOR П-1 DOES NOT COVER, declared in the card itself (curator's §2.2 of 2026-09-15):
 * a system identity this process cannot become. `spawnIdentityFor` refuses BEFORE the
 * workspace is ever settled, so `workspaceRefusals` stays empty and П-1 is silent by
 * construction — which is the whole point of putting the П-2 fixture here and not on the
 * workspace door, where П-1 fires on tick one and carries the turn off before the counter
 * can reach its threshold.
 *
 * A user no box has: the probe answers `unknown user` where `sudo` exists and `ENOENT`
 * where it does not, and BOTH are the same refusal to this door — so the fixture does not
 * depend on the sudoers of whatever box runs the suite.
 */
const NOBODY = "aco-nobody-of-this-box";

/** What the box runs, and what the tree was left on — the divergence the door reads. */
const CIRCUIT = "0.2.15";
const BEHIND = "0.2.14";

const META = "---\ntitle: T\nparticipants: dev-core, curator, github\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const contour = (devCore: Record<string, unknown> = DEV_CORE): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-standstill-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config(devCore), null, 2)}\n`);
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
 * WHY П-2 IS NOT MEASURED ON THE DOOR ABOVE, and it is a finding rather than a gap: three
 * ticks over the stuck tree leave `stall.json` at `ticks: 1` and the second bell never comes
 * due. THE CAUSE IS П-1 ITSELF — its letter carries `waiting-on: curator`, so the moment it
 * lands the thread stops waiting on the refused role, the pair leaves the queue, the next
 * tick has no candidate at all, and `foldStall` HOLDS the run rather than extending it (an
 * empty queue is an idle circuit, which is the right answer to the question it was asked).
 * The 209 silent ticks of the field case are therefore NOT reproducible on the workspace
 * door once П-1 is in the build: the first tick converts them into a turn.
 *
 * That is why the crossing below stands on a DIFFERENT door. Of the three that feed the
 * standstill run in `launch()` — the declared system identity, the reach of the account's
 * directory, and the workspace — only the third fills `workspaceRefusals`; on the first two
 * П-1 is silent by construction, the thread goes on waiting on its own role, the queue stays
 * full and the counter runs free to its threshold (curator's §2.2, thread 180, 2026-09-15).
 *
 * THE IDENTITY DOOR IS CHOSEN over the account one because it is declared entirely in the
 * card — one optional key — while the account door needs a directory whose BITS deny a
 * named uid, which is a fixture that behaves differently for root and would have to be
 * skipped on half the boxes that run this suite.
 *
 * AND THE THIRD BRANCH, `silent` — a tick with no refusals at all and nothing in flight — is
 * NOT asserted here, said in prose rather than left to be noticed: this fixture cannot reach
 * it, because a tick with a candidate always produces either a raise or a refusal, and a
 * tick without one returns before the fold. Whether the live cycle can reach it at all is
 * unmeasured; it stays covered by `standstill-letter.test.ts` as a unit.
 */
describe("the bell of a STANDING circuit reaches the MAIL (П-2, thread 180)", () => {
  /** The pair standing on the identity door: refused every tick, and never written about by П-1. */
  const standing = (): string => contour({ ...DEV_CORE, systemUser: NOBODY });

  it("rings into the feed on the THIRD tick and not before, with П-1 silent throughout", () => {
    const repo = standing();
    enable(repo);

    const first = daemon(repo);
    // The door that refused, named — and it is the identity one, two doors above П-1's.
    expect(first.out).toContain(`declares systemUser '${NOBODY}'`);
    expect(feed(repo)).not.toContain("Контур СТОИ́Т");
    daemon(repo);
    // Two ticks are bad luck, not a standstill: `STALL_TICKS` is 3 and the letter obeys it.
    expect(feed(repo)).not.toContain("Контур СТОИ́Т");

    daemon(repo);
    const text = feed(repo);
    // THE EVIDENCE IS THE FEED, exactly as in П-1 above, and never the daemon's stdout: the
    // line in the log is what was already there for 209 ticks and reached nobody.
    expect(text).toContain("Контур СТОИ́Т");
    expect(text).toContain("за 3 тик(ов) подряд");
    expect(text).toContain("dev-core×012-x");
    // The refusal the letter quotes is the IDENTITY door's, in the collapsed form
    // `stallReasons` keeps — the quoted parts, the user among them, are what `classOf`
    // replaces with '…' so that two roles standing on one fault are one fault.
    expect(text).toContain("declares systemUser '…'");
    expect(text).toContain("a sudoers rule");
    expect(text).toContain("curator");
    // П-1 IS SILENT ON THIS DOOR — the half of the claim that makes the fixture a crossing
    // of П-2 and not a second reading of П-1. A letter about the workspace here would mean
    // the two bells had been wired to the same refusal.
    expect(text).not.toContain("Рабочее место роли");
  });

  it("says it ONCE per standstill run, not once per tick past the threshold", () => {
    const repo = standing();
    enable(repo);
    daemon(repo);
    daemon(repo);
    daemon(repo);
    daemon(repo);
    daemon(repo);

    // Two mechanisms hold this down and the assertion does not tell them apart: the ledger
    // keyed by the run's `since`, and — from the fourth tick on — the turn this very letter
    // handed to `curator`, which takes the pair out of the queue exactly as it does on the
    // workspace door above. The claim under test is only that the feed is not flooded.
    expect(times(feed(repo), "Контур СТОИ́Т")).toBe(1);
  });
});
