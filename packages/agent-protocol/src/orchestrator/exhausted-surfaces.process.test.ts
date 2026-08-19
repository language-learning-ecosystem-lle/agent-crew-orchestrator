/**
 * THE COURIER AND THE FRAME JUDGE EXHAUSTION BY ONE FOLD (curator's finding, thread 013).
 *
 * WHY A PROCESS TEST, AND WHY IT IS THE ONLY SHAPE THAT SEES THIS. The defect was a MISSING
 * ARGUMENT at one call site: the courier's sixth category folded the journal without
 * `sessionsThatWrote(parsed)`, while the daemon, the single `run` and the `status` frame all
 * hand it over. Both sides of that seam are covered by green units — `foldLeases` is tested
 * with and without the set, `planNotifications` is tested on the pairs it is given — and
 * neither can see a caller that forgets to pass it. Only running the two REAL commands over
 * ONE journal and ONE mail can.
 *
 * AND THE ASSERTION COMPARES THE SURFACES TO EACH OTHER, not each to a constant of its own
 * (curator's "Проверяемость"): a test that pins two expected strings survives the next
 * divergence, because whoever moves one surface moves its own expectation with it.
 *
 * THE FIXTURE IS THE FIELD CASE OF THREAD 023, which is what makes the two folds differ at
 * all: a pair whose three releases are all `exited-without-handoff` — the shape a run takes
 * when it carries a question and keeps the turn on itself — and whose LAST session signed a
 * message in the mail. By the raw count that pair sits at 3/3; by the count the daemon takes,
 * the mail forgives the last attempt and the pair is at 0/3 and launchable. On 2026-08-19
 * six live pairs differed this way, `curator×010` standing at 2/3 for the courier and 0/3 for
 * the daemon — one broken run away from a `frozen` call about a pair the next tick raises.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, john\nstatus: open\n---\n";

/** A pair's failed round: taken, and released without the turn passing on. */
const round = (
  role: string,
  thread: string,
  at: string,
  session: string,
): readonly Record<string, unknown>[] => [
  { kind: "lease-acquired", ts: `${at}:00Z`, role, thread, deadline: `${at}:30Z` },
  {
    kind: "lease-released",
    ts: `${at}:10Z`,
    role,
    thread,
    reason: "exited-without-handoff",
    session,
    steps: 4,
  },
];

/**
 * A contour with one thread awaiting `dev-core` and one journal behind it. The thread's own
 * last message is signed `session: s-3` — the id of the session whose release closed the
 * third round, which is the whole of the retroactive correction (thread 023).
 */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-exhausted-surfaces-"));
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

  const dir = join(mail, "agent-comms", "019-carried-question");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(join(dir, "_meta.md"), META);
  // The turn STAYS on the role: scalar `waiting-on` leaves a question for a human no other
  // legal shape, and that is exactly the run whose release reads `exited-without-handoff`.
  writeFileSync(
    join(dir, "messages", "2026-08-19T05-20-10Z-dev-core.md"),
    [
      "---",
      "from: dev-core",
      "date: 2026-08-19T05:20:10Z",
      "expects: answer",
      "waiting-on: dev-core",
      "session: s-3",
      "---",
      "",
      "Which of the two, john?",
      "",
    ].join("\n"),
  );
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");

  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(
    join(repo, ".orchestrator", "journal.jsonl"),
    `${[
      ...round("dev-core", "019-carried-question", "2026-08-19T05:00", "s-1"),
      ...round("dev-core", "019-carried-question", "2026-08-19T05:10", "s-2"),
      ...round("dev-core", "019-carried-question", "2026-08-19T05:20", "s-3"),
      // THE CONTROL, and it is what makes the assertion a comparison rather than a check
      // that both surfaces are empty: a pair that died silently three times, whose sessions
      // signed nothing anywhere. Both folds agree it is frozen, so both surfaces must name
      // it — a fix that simply stopped the courier from counting would fail here.
      ...round("dev-core", "020-silent-death", "2026-08-19T05:00", "d-1"),
      ...round("dev-core", "020-silent-death", "2026-08-19T05:10", "d-2"),
      ...round("dev-core", "020-silent-death", "2026-08-19T05:20", "d-3"),
    ]
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`,
  );
  return repo;
};

const at = (repo: string, ...args: readonly string[]): string => {
  const result = spawnSync(TSX, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
    env: sandbox(configHome(repo)),
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

/**
 * The pairs a surface calls exhausted, read out of its OWN words — the courier's category
 * (`N exhausted, M of them new — role×thread (…)`) and the frame's per-pair mark, which are
 * two spellings of one fact and must never be two answers.
 */
const exhaustedIn = (out: string): string[] => {
  const pairs = new Set<string>();
  for (const line of out.split("\n")) {
    if (line.includes("EXHAUSTED")) {
      const [role, thread] = line.split("  ·  ");
      if (role !== undefined && thread !== undefined)
        pairs.add(`${role.replace(/^agent-protocol: /, "").trim()}×${thread.trim()}`);
    }
    const category = /\d+ exhausted, \d+ of them new — (.*)$/.exec(line);
    if (category !== null)
      for (const hit of (category[1] as string).matchAll(/([\w-]+)×([\w-]+) \(/g))
        pairs.add(`${hit[1]}×${hit[2]}`);
  }
  return [...pairs].sort();
};

const courierLine = (repo: string): string =>
  at(
    repo,
    "notify",
    "--repo",
    repo,
    "--root",
    join(repo, "mailco", "agent-comms"),
    "--state",
    join(repo, ".orchestrator", "notify.state"),
    "--ref",
    "HEAD",
    "--no-fetch",
  );

describe("the sixth category and the frame answer about the same pairs", () => {
  it("the courier does not call a pair exhausted that the daemon raises without blinking", () => {
    const repo = contour();

    const courier = courierLine(repo);

    // BEFORE the fix this named BOTH pairs — the carried question among them: three raw
    // failures, the ceiling, and a `frozen` call on john's phone about a pair the daemon
    // holds at 0/3 and raises on its next tick. This is the whole proof of the defect.
    expect(exhaustedIn(courier)).toEqual(["dev-core×020-silent-death"]);
    expect(courier).toContain("1 exhausted");
  });

  it("and the two surfaces agree by construction, not by coincidence", () => {
    const repo = contour();

    const courier = courierLine(repo);
    const frame = at(repo, "orchestrator", "status", "--repo", repo, "--ref", "HEAD", "--no-fetch");

    // The comparison is between the two READINGS and not against a string either one owns:
    // an expectation pinned per surface is one whoever moves a surface moves with it, and
    // the next divergence would then be born green.
    expect(exhaustedIn(courier)).toEqual(exhaustedIn(frame));
    // …and it is not the agreement of two empty sets.
    expect(exhaustedIn(frame)).toEqual(["dev-core×020-silent-death"]);
  });
});
