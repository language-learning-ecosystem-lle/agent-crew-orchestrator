/**
 * A CLOSED THREAD IS NOT A FROZEN PAIR (curator's finding, thread 016).
 *
 * WHY A PROCESS TEST. The defect is the same shape as the one thread 023 left behind and
 * `exhausted-surfaces.process.test.ts` closed: a fact of the MAIL missing from a set folded
 * out of the JOURNAL, at one call site. `foldLeases` is right about the pairs it is asked
 * about, `planNotifications` is right about the pairs it is handed, `exhaustedPairsOf` is
 * unit-tested on both sides of the closure — and none of them can see a command that reads
 * the mail for one fact and not the other. Only the two REAL commands over ONE mail and ONE
 * journal can.
 *
 * AND THE ASSERTION COMPARES THE SURFACES TO EACH OTHER (curator's "Проверяемость"), never
 * each to a constant of its own: whoever moves a surface moves its own expectation with it,
 * and the next divergence would be born green.
 *
 * THE SURFACES DIVERGE ON PURPOSE ABOUT THE ROW AND AGREE ABOUT THE CALL. The courier drops
 * a closed pair outright — it exists to tell somebody to act. The frame keeps the row and
 * drops the MARK: it prints the history of the journal, and that history happened. So the
 * comparison is over what each surface CALLS FOR, which is what `⚠ EXHAUSTED` and the sixth
 * category both are.
 *
 * THE FIXTURE IS THE FIELD CASE OF 2026-08-19: `curator×001-mail-born` and
 * `curator×004-init-github-host` stood in the courier's line as `2 exhausted` and in the
 * frame as `⚠ EXHAUSTED (substantive — … a hand does (--max-attempts above the ceiling))`
 * for threads curator had closed by acceptance ~09:22Z. Forever, at that: only a delivery OF
 * THAT PAIR zeroes the count, and a closed thread is raised by nobody.
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
      id: "curator",
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

const meta = (status: "open" | "closed"): string =>
  `---\ntitle: T\nparticipants: curator, john\nstatus: ${status}\n---\n`;

/** A pair's failed round: taken, and released without the turn passing on. */
const round = (thread: string, at: string, session: string): readonly Record<string, unknown>[] => [
  { kind: "lease-acquired", ts: `${at}:00Z`, role: "curator", thread, deadline: `${at}:30Z` },
  {
    kind: "lease-released",
    ts: `${at}:10Z`,
    role: "curator",
    thread,
    reason: "exited-without-handoff",
    session,
    steps: 4,
  },
];

/**
 * Two threads, identical in the journal and different in ONE field of the mail: three silent
 * rounds each (no session signed anything, so both folds agree the pair is at 3/3), one
 * thread accepted and closed, one still open. The open one is the control that makes the
 * assertion a comparison rather than a check that both surfaces went quiet.
 */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-exhausted-closed-"));
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

  for (const [thread, status] of [
    ["001-accepted", "closed"],
    ["013-still-open", "open"],
  ] as const) {
    const dir = join(mail, "agent-comms", thread);
    mkdirSync(join(dir, "messages"), { recursive: true });
    writeFileSync(join(dir, "_meta.md"), meta(status));
    writeFileSync(
      join(dir, "messages", "2026-08-19T05-20-10Z-john.md"),
      [
        "---",
        "from: john",
        "date: 2026-08-19T05:20:10Z",
        "expects: none",
        "waiting-on: curator",
        "---",
        "",
        "Carry on.",
        "",
      ].join("\n"),
    );
  }
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");

  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(
    join(repo, ".orchestrator", "journal.jsonl"),
    `${[
      ...round("001-accepted", "2026-08-19T05:00", "a-1"),
      ...round("001-accepted", "2026-08-19T05:10", "a-2"),
      ...round("001-accepted", "2026-08-19T05:20", "a-3"),
      ...round("013-still-open", "2026-08-19T05:00", "o-1"),
      ...round("013-still-open", "2026-08-19T05:10", "o-2"),
      ...round("013-still-open", "2026-08-19T05:20", "o-3"),
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
 * The pairs a surface CALLS A HAND TO, read out of its own words — the courier's category
 * (`N exhausted, M of them new — role×thread (…)`) and the frame's `⚠ EXHAUSTED` mark. The
 * frame's history rows are deliberately not in this set: they ask for nothing.
 */
const calledFor = (out: string): string[] => {
  const pairs = new Set<string>();
  for (const line of out.split("\n")) {
    if (line.includes("⚠ EXHAUSTED")) {
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

const frame = (repo: string): string =>
  at(repo, "orchestrator", "status", "--repo", repo, "--ref", "HEAD", "--no-fetch");

describe("a closed thread is not a frozen pair", () => {
  it("the courier counts and names only the pair whose thread is still open", () => {
    const repo = contour();

    const courier = courierLine(repo);

    // BEFORE the fix this said `2 exhausted` and named both — one of them a thread that had
    // been accepted, with advice to raise `--max-attempts` on it. This is the defect.
    expect(courier).toContain("1 exhausted");
    expect(calledFor(courier)).toEqual(["curator×013-still-open"]);
    expect(courier).not.toContain("001-accepted");
  });

  it("and the frame calls a hand to the same one pair — by construction, not by coincidence", () => {
    const repo = contour();

    const courier = courierLine(repo);
    const seen = frame(repo);

    expect(calledFor(seen)).toEqual(calledFor(courier));
    // …and it is not the agreement of two empty sets.
    expect(calledFor(seen)).toEqual(["curator×013-still-open"]);
  });

  it("the frame still PRINTS the closed pair — the row is history, the mark was the call", () => {
    const seen = frame(contour());

    const row = seen.split("\n").find((line) => line.includes("001-accepted")) as string;
    expect(row).toBeDefined();
    expect(row).toContain("attempt 3/3");
    expect(row).toContain("THREAD IS CLOSED");
    expect(row).not.toContain("--max-attempts");
  });
});
