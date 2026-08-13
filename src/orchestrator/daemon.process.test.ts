/**
 * The PROCESS test of the daemon's TICK — what it says when it raises nobody.
 *
 * curator's defect report of 2026-07-26: `daemon --once` printed its banner and
 * exited without a single line about the candidate, the tick or the outcome, while
 * `status` showed the only pair as `EXHAUSTED`. From a terminal that is
 * indistinguishable from an empty mailbox, and `--max-runs 20` changed nothing
 * because it was never the gate that dropped the pair.
 *
 * The invariant nailed down here: **the daemon never declines work silently.** Every
 * candidate it refuses to raise is named with its reason, and "nothing to launch" is
 * a line, not an absence of lines. It is a process test rather than a unit one
 * because the defect lived in exactly the seam the unit tests do not cross: the tick
 * returned a truthful decision, and the CLI printed nothing about it.
 */
import { execFileSync, spawnSync } from "node:child_process";
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
const ANSWERED =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: none\nwaiting-on: curator\n---\n\nThe body.\n";

/** A role hosted by a live process (R23-1): never raised, and still waited on. */
const RESIDENT_ROLE = {
  id: "curator",
  kind: "resident",
  status: "active",
  wake: { mode: "resident" },
  summary: "the one that is already reading",
};
const WAITING_ON_RESIDENT =
  "---\nfrom: dev-core\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nThe body.\n";

/** The full circuit on disk — a bare origin, a code checkout and a mail checkout. */
const contour = (options?: { readonly waiting?: boolean; readonly resident?: boolean }): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-daemon-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  const config =
    options?.resident === true ? { ...CONFIG, roles: [...CONFIG.roles, RESIDENT_ROLE] } : CONFIG;
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);
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
  writeFileSync(
    join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"),
    options?.resident === true
      ? WAITING_ON_RESIDENT
      : options?.waiting === false
        ? ANSWERED
        : WAITING,
  );
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/** A "session" stub that does nothing and exits — enough to prove a launch happened. */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

const stateDir = (repo: string): string => join(repo, ".orchestrator");
const journalPath = (repo: string): string => join(stateDir(repo), "journal.jsonl");

const enable = (repo: string): void => {
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(join(stateDir(repo), "enabled"), "", "utf8");
};

/** A journal in which the pair failed `times` times in a row without ever delivering. */
const seedFailures = (repo: string, times: number): void => {
  const lines: string[] = [];
  for (let i = 0; i < times; i += 1) {
    const hour = String(10 + i).padStart(2, "0");
    lines.push(
      JSON.stringify({
        kind: "lease-acquired",
        ts: `2026-07-25T${hour}:00:00Z`,
        role: "dev-core",
        thread: "012-x",
        deadline: `2026-07-25T${hour}:30:00Z`,
      }),
      JSON.stringify({
        kind: "lease-released",
        ts: `2026-07-25T${hour}:31:00Z`,
        role: "dev-core",
        thread: "012-x",
        reason: "timeout",
      }),
    );
  }
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(journalPath(repo), `${lines.join("\n")}\n`, "utf8");
};

/** Append a delivery — the event that puts the attempt count back to zero. */
const seedCompletion = (repo: string): void => {
  const line = JSON.stringify({
    kind: "lease-released",
    ts: "2026-07-25T20:00:00Z",
    role: "dev-core",
    thread: "012-x",
    reason: "completed",
  });
  writeFileSync(journalPath(repo), `${readFileSync(journalPath(repo), "utf8")}${line}\n`, "utf8");
};

/**
 * BOTH STREAMS ARE THE OUTPUT. The skips are diagnostics and go to stderr, like every
 * other refusal the daemon prints; a helper that read stdout alone would call the
 * defect fixed while the lines were going nowhere a test could see.
 */
const daemon = (repo: string, extra: readonly string[] = []): { code: number; out: string } => {
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
      ...extra,
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const journalKinds = (repo: string): string[] =>
  existsSync(journalPath(repo))
    ? parseJournal(readFileSync(journalPath(repo), "utf8")).map((event) => event.kind)
    : [];

describe("the daemon says why it raised nobody (the defect of 2026-07-26)", () => {
  it("an exhausted candidate is NAMED, with its count and its ceiling — not dropped in silence", () => {
    const repo = contour();
    enable(repo);
    seedFailures(repo, 3);

    const result = daemon(repo);

    expect(result.out).toContain("candidate dev-core×012-x skipped: exhausted");
    expect(result.out).toContain("3 failed attempts");
    expect(result.out).toContain("ceiling 3 (default)");
    // And "nothing was launched" is itself a line: the outcome of the tick, not a gap.
    expect(result.out).toContain("no candidate is launchable");
    expect(result.out).toContain("exiting (--once)");
    // Nothing was raised — the skip is a real refusal, not just talk.
    expect(journalKinds(repo)).not.toContain("launch");
  });

  it("the gates are printed at start-up — an operator can see which numbers are in force", () => {
    const repo = contour();
    enable(repo);
    const result = daemon(repo, ["--max-runs", "20"]);

    expect(result.out).toContain("attempts-per-pair ≤ 3 (default)");
    expect(result.out).toContain("runs-without-delivery ≤ 20 (flag)");
  });

  it("--max-attempts REACHES the gate that drops the pair: the same journal, a launch", () => {
    // The heart of requirement 3. `--max-runs` moves the global budget and never
    // touched this gate, so raising it looked like a flag being ignored.
    const repo = contour();
    enable(repo);
    seedFailures(repo, 3);

    const result = daemon(repo, ["--max-attempts", "5"]);

    expect(result.out).toContain("attempts-per-pair ≤ 5 (flag)");
    expect(result.out).not.toContain("skipped: exhausted");
    expect(journalKinds(repo)).toContain("launch");
  });

  it("a delivery in between un-exhausts the pair — a long-lived thread is not a bomb", () => {
    // Requirement 2 end to end: the same three failures, plus one completed run, and
    // the pair is a candidate again instead of being retired for good.
    const repo = contour();
    enable(repo);
    seedFailures(repo, 3);
    seedCompletion(repo);

    const result = daemon(repo);

    expect(result.out).not.toContain("skipped: exhausted");
    expect(journalKinds(repo)).toContain("launch");
  });

  it("no mail at all → an honest line about it, still not silence", () => {
    const repo = contour({ waiting: false });
    enable(repo);

    const result = daemon(repo);

    expect(result.out).toContain("no candidates: no thread is waiting on dev-core");
    expect(journalKinds(repo)).toEqual([]);
  });

  it("a thread waiting on a RESIDENT role is spoken, though it is nobody's candidate (R23-1)", () => {
    // The class of failure this closes is the same one as the exhausted candidate's,
    // one step earlier: a resident role never enters the candidate list at all, so
    // without a line of its own the daemon's silence about a thread waiting on it is
    // indistinguishable from an empty mailbox — and a resident process that died looks
    // exactly like a quiet night.
    const repo = contour({ resident: true });
    enable(repo);

    const result = daemon(repo);

    expect(result.out).toContain("thread 012-x waits on curator");
    expect(result.out).toContain("RESIDENT");
    // And it is genuinely not raised: the circuit says where to look, it does not act.
    expect(journalKinds(repo)).not.toContain("launch");
  });

  it("the tick DIALS THE COURIER: a stalled turn is announced and the state file appears (thread 024)", () => {
    // The whole point of the package's second class of event was that nothing called
    // it: `notify` could compose the message and deliver it, and only a human hand
    // ever made that happen. Here the daemon's own tick does — the thread has been
    // waiting on dev-core since 2026-07-25, which is well past the 180m default, so
    // one `--once` tick must both say it and write the state that keeps it from
    // being said twice.
    const repo = contour();
    enable(repo);

    const result = daemon(repo);

    expect(result.out).toContain("courier:");
    expect(result.out).toContain("012-x (stalled");
    // Delivered as a message, not merely counted: no transport is configured in this
    // contour, and the honest form of that is to print what would have been sent.
    expect(result.out).toContain("has not moved for");
    expect(readFileSync(join(stateDir(repo), "notify.state"), "utf8")).toContain(
      "stalled\tdev-core\t012-x\t",
    );
  });

  it("the second tick says nothing new — the courier does not ring twice about one stall", () => {
    const repo = contour();
    enable(repo);

    daemon(repo);
    const again = daemon(repo);

    expect(again.out).toContain("nothing to announce");
    expect(again.out).not.toContain("012-x (stalled");
  });

  it("a courier that cannot deliver leaves the daemon ALIVE and says so", () => {
    // A notification is a superstructure, never a dependency: a transport module that
    // does not load must cost a loud line, not the watch. Before the automatic dial
    // this path ended in `process.exit(2)` — inside the loop that would have been the
    // daemon dying of a broken plugin.
    const repo = contour();
    enable(repo);
    const config = JSON.parse(readFileSync(join(repo, "agent-protocol.json"), "utf8"));
    config.notifications = { transport: { module: join(repo, "no-such-transport.js") } };
    writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "transport");

    const result = daemon(repo);

    expect(result.out).toContain("the courier is NOT delivering");
    // The tick went on to do its work, and the state file was NOT touched: a trigger
    // must not be consumed by a run that could never have delivered anything.
    expect(result.code).toBe(0);
    expect(journalKinds(repo)).toContain("launch");
    expect(existsSync(join(stateDir(repo), "notify.state"))).toBe(false);
  });

  it("launches disabled → the tick says so, rather than exiting without a word", () => {
    const repo = contour();

    const result = daemon(repo);

    expect(result.out).toContain("launches are disabled");
    expect(result.out).toContain("exiting (--once)");
    expect(journalKinds(repo)).toEqual([]);
  });

  // 065.4: the statement of work names TWO printers of the unread — `mail` and this tick.
  // The per-thread line here is older than the count and was never what went missing: a
  // night of ticks named a broken thread once per tick and never said that the queue it
  // raised from was narrowed by it.
  it("a thread it could not read is COUNTED, not just named — and the tick goes on working", () => {
    const repo = contour();
    enable(repo);
    // Half-migrated by hand: `messages/` present, the head of the thread missing — the
    // exact shape thread 066 was in on 2026-08-13, hidden from the queue all afternoon.
    const broken = join(repo, "mailco", "agent-comms", "066-broken");
    mkdirSync(join(broken, "messages"), { recursive: true });
    writeFileSync(join(broken, "messages", "2026-08-13T17-28-50Z-curator.md"), WAITING);
    git(join(repo, "mailco"), "add", "agent-comms");
    git(join(repo, "mailco"), "commit", "-qm", "a thread written by hand");
    git(join(repo, "mailco"), "push", "-q", "origin", "comms");

    const result = daemon(repo);

    expect(result.out).toContain(
      "1 thread(s) were NOT READ — the queue this tick raises from is narrowed by that much:",
    );
    expect(result.out).toContain(
      "thread '066-broken' could not be read: half-migrated thread: 'messages/' is present but '_meta.md' is missing",
    );
    // The isolation is intact: the readable pair is still raised, the tick is not a casualty.
    expect(journalKinds(repo)).toContain("launch");
  });
});
