/**
 * THE DOOR OF THE VALVE, ASKED AS A PROCESS (thread `177-workspace-per-pair`, §3.4).
 *
 * `valve.test.ts` proves the verdict; this file proves that `orchestrator run` actually asks
 * for it. The two are not the same claim and this repository has paid for the difference more
 * than once: a gate whose function is correct and whose CLI never calls it is a gate that reads
 * as working in every unit and passes everything in the field. Nothing here mocks git or the
 * journal — a real contour on disk, the real CLI as a child process, and the refusal read off
 * its exit code and its words.
 *
 * WHAT IS NAILED DOWN, in the language of the statement of work:
 *
 *  - the two ceilings of `parallelism` are asked BY THE HAND-TYPED LAUNCH, and the number they
 *    are counted to comes from the config (the same pair of live sessions passes at 2 and is
 *    refused at 1);
 *  - the refusal names the occupants WITH THEIR TIMES — the half that tells "the rule is
 *    working" from "a dead session is sitting in the place";
 *  - the refusal happens BEFORE the world is touched: no lease is taken, and the workspace of
 *    the pair is not created;
 *  - the journal mark of a manual raise (`by: "hand"`) is on the event the launch would write.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/** The contour on disk: a bare origin, the code checkout and a separate mail checkout. */
const contour = (extra: Record<string, unknown> = {}): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-valve-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify({ ...CONFIG, ...extra }, null, 2)}\n`,
  );
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
  return { repo, mail };
};

const journalPath = (repo: string): string => join(repo, ".orchestrator", "journal.jsonl");

/**
 * A journal with LIVE leases in it — one line per pair, acquired before `--now` and with a
 * deadline after it, which is a running session as every fold in this package reads one.
 */
const liveJournal = (repo: string, pairs: readonly { role: string; thread: string }[]): void => {
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(
    journalPath(repo),
    `${pairs
      .map((pair) =>
        JSON.stringify({
          kind: "lease-acquired",
          ts: "2026-07-25T10:05:00Z",
          role: pair.role,
          thread: pair.thread,
          deadline: "2026-07-25T12:00:00Z",
        }),
      )
      .join("\n")}\n`,
  );
};

/** `orchestrator run` as a child process; `--write` only when asked for. */
const run = (repo: string, options: { write: boolean }): { code: number; out: string } => {
  const said = spawnSync(
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
      "--exec",
      "/bin/true",
      "--now",
      "2026-07-25T10:30:00Z",
      "--wall-clock",
      "20",
      "--poll",
      "1",
      ...(options.write ? ["--write"] : []),
    ],
    { cwd: repo, encoding: "utf8", env: sandbox(configHome(repo)) },
  );
  return { code: said.status ?? 1, out: `${said.stdout ?? ""}${said.stderr ?? ""}` };
};

describe("orchestrator run — the hand asks the planner's gate (§3.4)", () => {
  it("the ceiling of the role refuses the hand, names the occupant and its time, and touches nothing", () => {
    // No `parallelism` in the config at all: the default is one pair per role, which is the
    // rule the workspace lock used to enforce by collision. One live pair of dev-core fills it.
    const { repo } = contour();
    liveJournal(repo, [{ role: "dev-core", thread: "013-y" }]);
    const before = readFileSync(journalPath(repo), "utf8");

    const result = run(repo, { write: true });

    expect(result.code).toBe(2);
    expect(result.out).toContain("the manual launch of 'dev-core×012-x' is refused ('role-busy')");
    expect(result.out).toContain("does not go around it");
    expect(result.out).toContain("dev-core×013-y since 2026-07-25T10:05:00Z");
    expect(result.out).toContain("'parallelism.pairsPerRole'");
    // NOTHING WAS TOUCHED: no lease was taken and the tree of the pair was never prepared. A
    // refusal that had already locked a workspace would leave an operator hunting for the lock.
    expect(readFileSync(journalPath(repo), "utf8")).toBe(before);
    expect(existsSync(join(repo, ".worktrees"))).toBe(false);
  }, 60_000);

  it("the number is the CONFIG's: the same live pair is room at 2 and a refusal at 1", () => {
    const { repo } = contour({ parallelism: { pairsPerRole: 2, pairsPerInstance: 3 } });
    liveJournal(repo, [{ role: "dev-core", thread: "013-y" }]);

    // A dry run: the gate answers the same question it answers under `--write` (a plan that
    // refused where the real launch passes is worse than no plan), so a pass shows the plan.
    const result = run(repo, { write: false });

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("is refused");
    expect(result.out).toContain("would run");
  }, 60_000);

  it("the ceiling of the BOX refuses a role that is idle, by the box's own name", () => {
    const { repo } = contour({ parallelism: { pairsPerRole: 1, pairsPerInstance: 1 } });
    // The live pair belongs to ANOTHER role — dev-core itself is running nothing at all.
    liveJournal(repo, [{ role: "curator", thread: "014-z" }]);

    const result = run(repo, { write: true });

    expect(result.code).toBe(2);
    expect(result.out).toContain("the manual launch of 'dev-core×012-x' is refused ('box-busy')");
    expect(result.out).toContain("'parallelism.pairsPerInstance'");
    expect(result.out).toContain("curator×014-z since 2026-07-25T10:05:00Z");
  }, 60_000);

  it("the launch the hand would write is MARKED as the hand's in the journal event", () => {
    const { repo } = contour({ parallelism: { pairsPerRole: 2, pairsPerInstance: 3 } });

    const result = run(repo, { write: false });

    expect(result.code).toBe(0);
    // The dry run prints the very events the launch would append (`renderEventLine` is the
    // journal's own JSON), so the mark is read off the line that would land on disk.
    expect(result.out).toContain('"kind":"launch"');
    expect(result.out).toContain('"by":"hand"');
  }, 60_000);
});
