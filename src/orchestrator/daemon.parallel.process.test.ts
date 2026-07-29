/**
 * THE PROCESS TEST OF NON-BLOCKING SUPERVISION (D-2 part 1, thread
 * `023-daemon-parallelism`).
 *
 * The defect this closes is a shape, not a crash: the tick did `await runOne`, so the
 * daemon slept for the whole length of the session it raised. john named the picture —
 * "dev-core writes 016 while the curator workspace idles on a waiting 019" — and D-1 could
 * only compute the right plan, not act on it: everything past the head was printed as
 * `deferred to the next tick`.
 *
 * IT IS A PROCESS TEST BECAUSE THE CLAIM IS ABOUT TIME, and time is the one thing a unit
 * test of `planTick` cannot see: the planner returned a plan of two long before this
 * change, and the daemon raised one of them. So the sessions here are real child
 * processes that record when they started and when they finished, and the assertion is
 * that THE SECOND STARTED BEFORE THE FIRST ENDED. Under the blocking tick that overlap is
 * unreachable by construction — which is what makes it the control, in the same sense the
 * `[2,0]` against `[0,0]` was in D-0: the test is red on the previous behaviour for the
 * reason it exists, not for an incidental one.
 *
 * The other three points of curator's statement of work ride on the same run, because
 * they are properties of the same tick:
 *  - `--once` and both stops WAIT FOR ALL THE CHILDREN: a lease closed by nothing is,
 *    from the outside, indistinguishable from work, and with N children the cost of
 *    getting that wrong is multiplied by N. Here: every acquisition has a release;
 *  - EVERY LINE CARRIES `role×thread`, in the daemon's own stream and in the relay of the
 *    session's, checked on the live interleaving of two sessions rather than on one.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
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

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { parseJournal } from "./journal.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

/** Two launchable roles — the degree of parallelism is the number of free roles (D-1). */
const role = (id: string) => ({
  id,
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: `s-${id}` },
  summary: "the stream",
  instructions: [{ kind: "in-repo", path: "CARD.md" }],
  launch: { allowedTools: ["Bash"] },
});

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  roles: [role("dev-core"), role("curator")],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const waitingOn = (who: string): string =>
  `---\nfrom: john\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: ${who}\n---\n\nThe body.\n`;

/** The full circuit: a bare origin, a code checkout, a mail checkout with TWO threads. */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-parallel-"));
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
  for (const [id, who] of [
    ["012-x", "dev-core"],
    ["019-y", "curator"],
  ]) {
    const thread = join(mail, "agent-comms", id as string);
    mkdirSync(join(thread, "messages"), { recursive: true });
    writeFileSync(join(thread, "_meta.md"), META);
    writeFileSync(
      join(thread, "messages", "2026-07-25T10-00-00Z-john.md"),
      waitingOn(who as string),
    );
  }
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

const stateDir = (repo: string): string => join(repo, ".orchestrator");
const journalPath = (repo: string): string => join(stateDir(repo), "journal.jsonl");
const markerPath = (repo: string): string => join(stateDir(repo), "marks");

const enable = (repo: string): void => {
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(join(stateDir(repo), "enabled"), "", "utf8");
};

/**
 * A "session" that LASTS: it stamps its own start and end into a shared file and says a
 * word on its stdout in between. The stamps are what makes the overlap observable, and
 * the word is what the relay has to attribute to a pair.
 *
 * The pair is read out of the one thing the launch contract gives every session and gives
 * it differently — the path it finds its own id at (R7), which is named after the pair.
 * The working directory would have been the natural choice (R17), but only a config that
 * declares `workdir.worktrees` has one per role, and this contour deliberately does not:
 * the claim under test is about the tick, not about worktrees.
 */
const stub = (repo: string, seconds: number): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(
    path,
    `#!/bin/sh
who=$(basename "$AGENT_PROTOCOL_SESSION_FILE")
echo "start $who $(date +%s)" >> "$AGENT_PROTOCOL_MARKS"
echo "hello from $who"
sleep ${seconds}
echo "end $who $(date +%s)" >> "$AGENT_PROTOCOL_MARKS"
exit 0
`,
  );
  chmodSync(path, 0o755);
  return path;
};

const env = (repo: string): NodeJS.ProcessEnv => ({
  ...sandbox(configHome(repo)),
  AGENT_PROTOCOL_MARKS: markerPath(repo),
});

const marks = (
  repo: string,
): { readonly kind: string; readonly who: string; readonly at: number }[] =>
  existsSync(markerPath(repo))
    ? readFileSync(markerPath(repo), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const [kind, who, at] = line.split(" ");
          return { kind: kind ?? "", who: who ?? "", at: Number(at ?? 0) };
        })
    : [];

const argv = (repo: string, seconds: number, extra: readonly string[]): string[] => [
  CLI,
  "orchestrator",
  "daemon",
  "--ref",
  "HEAD",
  "--no-fetch",
  "--repo",
  repo,
  "--exec",
  stub(repo, seconds),
  "--poll",
  "1",
  ...extra,
];

/** Both streams are the output: the plan and the skips are diagnostics, on stderr. */
const daemonOnce = (repo: string, seconds: number): { code: number; out: string } => {
  const result = spawnSync(TSX, argv(repo, seconds, ["--once"]), {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
    env: env(repo),
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const events = (repo: string) =>
  existsSync(journalPath(repo)) ? parseJournal(readFileSync(journalPath(repo), "utf8")) : [];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("the daemon raises the WHOLE plan and does not wait for it (D-2)", () => {
  it("two roles run AT THE SAME TIME, out of one tick", async () => {
    const repo = contour();
    enable(repo);
    const { out } = daemonOnce(repo, 4);

    // The plan itself is unchanged — D-1 already computed it. What changed is that all
    // of it is acted on, so the temporary line is gone.
    expect(out).toContain("the plan of this tick: 2 launches");
    expect(out).not.toContain("deferred to the next tick");

    // THE OVERLAP — the whole claim, measured rather than inferred. Under the blocking
    // tick the second `start` could not appear before the first `end`, because the
    // second launch did not exist until the first session had returned.
    const stamps = marks(repo);
    const starts = stamps.filter((m) => m.kind === "start");
    const ends = stamps.filter((m) => m.kind === "end");
    expect(starts.filter((m) => m.who.includes("dev-core"))).toHaveLength(1);
    expect(starts.filter((m) => m.who.includes("curator"))).toHaveLength(1);
    expect(ends).toHaveLength(2);
    const firstEnd = Math.min(...ends.map((m) => m.at));
    const lastStart = Math.max(...starts.map((m) => m.at));
    expect(lastStart).toBeLessThan(firstEnd);
  }, 30_000);

  it("`--once` waits for EVERY child — no lease is left closed by nothing", async () => {
    const repo = contour();
    enable(repo);
    const { out } = daemonOnce(repo, 3);

    // The tick outlives itself now, so "one tick" has to mean the work of one tick:
    // exiting with the children still alive would orphan every one of them.
    expect(out).toContain("--once: waiting for 2 live session(s)");
    expect(out).toContain("every session is finished, no lease was left open");
    const kinds = events(repo).map((e) => e.kind);
    expect(kinds.filter((k) => k === "lease-acquired")).toHaveLength(2);
    expect(kinds.filter((k) => k === "lease-released")).toHaveLength(2);
    // Both pairs, and each one closed: this is the check the daemon itself performs at
    // startup about orphans, applied to its own orderly exit.
    const open = new Set(
      events(repo)
        .filter((e) => e.kind === "lease-acquired")
        .map((e) => `${e.role}×${e.thread}`),
    );
    for (const e of events(repo).filter((e) => e.kind === "lease-released"))
      open.delete(`${e.role}×${e.thread}`);
    expect([...open]).toEqual([]);
  }, 30_000);

  it("every line is attributed — the daemon's own AND the relay of the session's", async () => {
    const repo = contour();
    enable(repo);
    const { out } = daemonOnce(repo, 3);

    // The daemon's own bookkeeping about a pair.
    expect(out).toContain("[dev-core×012-x] ceilings:");
    expect(out).toContain("[curator×019-y] ceilings:");
    // THE RELAY — the session's own words, which is where an unattributed line does the
    // real damage: with two sessions talking at once, "the session exited, code 1"
    // invites the operator to blame whichever role they were reading a moment earlier.
    expect(out).toMatch(/\[dev-core×012-x\] hello from \S*dev-core-012-x/);
    expect(out).toMatch(/\[curator×019-y\] hello from \S*curator-019-y/);
    // ...and it is a live interleaving, not two blocks one after the other: the two
    // sessions were provably running at the same time in the test above.
    expect(out).toContain("[dev-core×012-x] the run finished:");
    expect(out).toContain("[curator×019-y] the run finished:");
  }, 30_000);

  it("a role already running is not raised again — the registry, across ticks", async () => {
    // The planner's `running` input, seen from outside: the daemon ticks WHILE its
    // children live, so without the registry the second tick would read a journal whose
    // lease it had not yet written and put a second session into a live workspace.
    const repo = contour();
    enable(repo);
    const child = spawn(TSX, argv(repo, 6, ["--tick", "1"]), {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
      env: env(repo),
    });
    let out = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    // Long enough for several ticks to pass under two live sessions.
    await sleep(4000);
    // THE STOP WAITS FOR THE CHILDREN TOO (curator's point 2), and this is where it is
    // measured: the flag lands while both sessions are alive.
    writeFileSync(join(stateDir(repo), "stop"), "", "utf8");
    const code = await new Promise<number>((resolve) => {
      child.on("exit", (c) => resolve(c ?? 1));
    });
    expect(code).toBe(0);

    // Not one extra launch: two sessions, however many ticks went past them.
    expect(marks(repo).filter((m) => m.kind === "start")).toHaveLength(2);
    const kinds = events(repo).map((e) => e.kind);
    expect(kinds.filter((k) => k === "lease-acquired")).toHaveLength(2);
    expect(kinds.filter((k) => k === "lease-released")).toHaveLength(2);
    expect(out).toContain("the stop flag: waiting for 2 live session(s)");
    expect(out).toContain("the daemon stopped — the stop flag");
    // The skipped pairs are NAMED on every one of those ticks — silence about work
    // declined is the failure class this daemon has been fixing since 2026-07-26. The
    // reason here is `active` (the lease is on disk by then); the registry answers for the
    // window BEFORE that write, and what it buys is measured above: two starts, not three.
    expect(out).toContain("candidate dev-core×012-x skipped: the pair is running right now");
    expect(out).toContain("candidate curator×019-y skipped: the pair is running right now");
  }, 60_000);
});
