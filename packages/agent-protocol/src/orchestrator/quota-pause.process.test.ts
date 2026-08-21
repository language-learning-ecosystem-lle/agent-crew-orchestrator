/**
 * A QUOTA PAUSE IS NOT A SPENT ATTEMPT, AND IT SAYS SO OUT LOUD (thread 019, §4).
 *
 * WHY A PROCESS TEST, and why this one is not a duplicate of `quota.test.ts`. Two
 * properties meet here that no unit can see together:
 *
 *  - THE COUNTER SURVIVES THE PAUSE. `foldLeases` is unit-tested on "a quota death is not
 *    an attempt", but the number an operator acts on is the one the `status` frame prints,
 *    and between the fold and the frame stand the mail (which forgives some deaths), the
 *    ceiling resolution (`--max-attempts`, R12) and the closed-thread pass. A pair that
 *    stood at 2/3 before a window closed must stand at 2/3 after it reopens — REAL command,
 *    REAL journal, REAL mail, both sides of the vendor's `resetsAt`;
 *  - THE PAUSE IS VISIBLE WHERE A HUMAN LOOKS. `describeQuotaShelf`/`describeQuotaPause`
 *    are unit-tested as strings; that the FRAME and the COURIER each reach the same fold
 *    over the same journal is a joint, and the whole defect of §4 was a marker present in
 *    one surface and missing from another.
 *
 * THE FIXTURE IS THE FIELD SHAPE, not a minimal one: two rounds that failed on their own
 * (the pair is at 2/3, one attempt from the ceiling — the state where a wrongly counted
 * third death costs the most), then a death on the vendor's window carrying the `resetsAt`
 * #42 taught it to carry.
 *
 * THE CLOCK IS THE REAL ONE. The commands read `new Date()`, so the two worlds are built by
 * moving the JOURNAL around the present instead: `standing()` puts the reopening 43 minutes
 * ahead, `reopened()` puts it 5 minutes behind. Everything else about the two is identical
 * — which is what makes the pair of assertions a comparison rather than two checks.
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

const THREAD = "019-quota-aware-scheduler";

/** An ISO stamp `minutes` away from now, to the second — the journal's own precision. */
const away = (minutes: number): string =>
  `${new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19)}Z`;

/** A round the pair spent on itself: taken, and released without the turn passing on. */
const failed = (minutesAgo: number, session: string): readonly Record<string, unknown>[] => [
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
    reason: "exited-without-handoff",
    session,
    steps: 40,
  },
];

/**
 * The round the VENDOR ended: released as `quota-exhausted` with the boundary the stream
 * named. `until` is the whole variable of this file — everything above it is fixed.
 */
const onQuota = (minutesAgo: number, until: string): readonly Record<string, unknown>[] => [
  {
    kind: "lease-acquired",
    ts: away(-minutesAgo),
    role: "dev-core",
    thread: THREAD,
    deadline: away(-minutesAgo + 30),
  },
  {
    kind: "lease-released",
    ts: away(-minutesAgo + 3),
    role: "dev-core",
    thread: THREAD,
    reason: "quota-exhausted",
    session: "q-1",
    steps: 120,
    until,
    window: "five_hour",
  },
];

const contour = (until: string): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-quota-pause-"));
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
  // The turn stands on the pair and nobody's session signed anything: no death here is
  // forgiven by the mail, so the count the frame prints is the journal's own.
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
    `${[...failed(180, "a-1"), ...failed(120, "a-2"), ...onQuota(60, until)]
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`,
  );
  return repo;
};

/** The window still closed: the vendor's boundary is 43 minutes ahead of this moment. */
const standing = (): string => contour(away(43));
/** The window reopened five minutes ago — the shelf ends by the clock and by nothing else. */
const reopened = (): string => contour(away(-5));

const at = (repo: string, ...args: readonly string[]): string => {
  const result = spawnSync(TSX, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
    env: sandbox(configHome(repo)),
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const frame = (repo: string): string =>
  at(repo, "orchestrator", "status", "--repo", repo, "--ref", "HEAD", "--no-fetch");

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

/** The pair's line in the frame — the one row this file is about. */
const pairLine = (out: string): string =>
  out.split("\n").find((line) => line.includes(THREAD) && line.includes("attempt")) ?? "";

describe("the pair keeps its count across the vendor's window", () => {
  it("while the window is closed: 2/3, not exhausted, and the frame says why", () => {
    const out = frame(standing());
    expect(pairLine(out)).toContain("attempt 2/3");
    expect(pairLine(out)).not.toContain("EXHAUSTED");
    expect(out).toContain("quota-paused until ");
    expect(/quota-paused until \S+ \(\d+m left\)/.test(out)).toBe(true);
    expect(out).toContain("five_hour window of the box's own account");
  });

  it("after `resetsAt`: the same 2/3, and the pause is gone from the frame", () => {
    // THE POINT OF THE WHOLE THREAD IN ONE ASSERTION: the third death cost the pair
    // nothing, and the shelf lifted itself. Neither needs a hand.
    const out = frame(reopened());
    expect(pairLine(out)).toContain("attempt 2/3");
    expect(pairLine(out)).not.toContain("EXHAUSTED");
    expect(out).not.toContain("quota-paused");
    expect(out).toContain("no window is closed");
  });

  it("the courier carries the pause as its own category, with the clock and the time left", () => {
    const out = courierLine(standing());
    expect(/quota-paused, resumes \d\d:\d\dZ \(\d+m left\)/.test(out)).toBe(true);
    expect(out).toContain("five_hour window of the box's own account");
  });

  it("and drops it the moment the window reopens — no hand clears this line", () => {
    expect(courierLine(reopened())).not.toContain("quota-paused");
  });

  it("the frame and the courier never disagree about whether the box is paused", () => {
    // The joint itself, asserted as a comparison rather than as two constants: one fold
    // (`openQuotaShelves`) feeds both, and whoever splits them breaks this line.
    for (const build of [standing, reopened]) {
      const repo = build();
      expect(frame(repo).includes("quota-paused")).toBe(courierLine(repo).includes("quota-paused"));
    }
  });
});
