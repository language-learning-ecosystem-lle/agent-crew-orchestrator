/**
 * A ROUND THE PAIR NEVER GOT IS NOT A SPENT ATTEMPT — through the real frame (thread 023).
 *
 * WHY A PROCESS TEST beside the eleven units on `SPENDS_ATTEMPT`. The units read the fold;
 * the number an operator acts on is the one `orchestrator status` prints, and between the
 * two stand the mail (which forgives some deaths of its own), the ceiling resolution
 * (`--max-attempts`, R12) and the closed-thread pass. #44 proved that joint for
 * `quota-exhausted` in `quota-pause.process.test.ts`; this file proves it for the class
 * that thread 023 moved and that a vendor's window has nothing to do with —
 * `supervisor-gone`, the box killing its own sessions on the way out.
 *
 * BOTH HALVES ARE HERE, and the second one is the point: the same fixture with the third
 * round released as the pair's OWN break reads `3/3 ⚠ EXHAUSTED`. The change is an UNDO of
 * rounds nobody gave the pair, not an amnesty for its own.
 *
 * THE FIXTURE IS THE FIELD SHAPE: two rounds failed on their own (2/3 — one attempt from
 * the ceiling, where a wrongly counted third costs the most), then the third round.
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
      summary: "the code",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const THREAD = "023-attempt-counter-semantics";

/** An ISO stamp `minutes` away from now, to the second — the journal's own precision. */
const away = (minutes: number): string =>
  `${new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19)}Z`;

/** One round of the pair, ended by `reason` — the whole variable of this file. */
const round = (
  minutesAgo: number,
  reason: string,
  session: string,
): readonly Record<string, unknown>[] => [
  {
    kind: "lease-acquired",
    ts: away(-minutesAgo),
    role: "dev-core",
    thread: THREAD,
    deadline: away(-minutesAgo + 30),
  },
  {
    kind: "lease-released",
    ts: away(-minutesAgo + 10),
    role: "dev-core",
    thread: THREAD,
    reason,
    session,
    steps: 40,
  },
];

const contour = (third: string): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-attempt-"));
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
  const dir = join(mail, "agent-comms", THREAD);
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(
    join(dir, "_meta.md"),
    `---\ntitle: T\nparticipants: dev-core, john\nstatus: open\n---\n`,
  );
  // The turn stands on the pair and no session of its own signed anything: no death here
  // is forgiven by the mail, so the count the frame prints is the journal's own.
  writeFileSync(
    join(dir, "messages", "2026-08-21T05-20-10Z-john.md"),
    [
      "---",
      "from: john",
      "date: 2026-08-21T05:20:10Z",
      "expects: none",
      "waiting-on: dev-core",
      "---",
      "",
      "Carry on.",
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
      ...round(180, "exited-without-handoff", "a-1"),
      ...round(120, "exited-without-handoff", "a-2"),
      ...round(60, third, "a-3"),
    ]
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`,
  );
  return repo;
};

/** The pair's line in the real frame — the one row this file is about. */
const pairLine = (repo: string): string => {
  const result = spawnSync(
    TSX,
    [CLI, "orchestrator", "status", "--repo", repo, "--ref", "HEAD", "--no-fetch"],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return out.split("\n").find((line) => line.includes(THREAD) && line.includes("attempt")) ?? out;
};

describe("the count an operator reads after a round the pair never got", () => {
  it("a supervisor that went away leaves the pair at 2/3, not at the ceiling", () => {
    const line = pairLine(contour("supervisor-gone"));
    expect(line).toContain("attempt 2/3");
    expect(line).not.toContain("EXHAUSTED");
  });

  it("the pair's OWN third break still exhausts it — an undo, not an amnesty", () => {
    const line = pairLine(contour("exited-without-handoff"));
    expect(line).toContain("attempt 3/3");
    expect(line).toContain("EXHAUSTED");
  });
});
