/**
 * THE PROCESS TEST OF THE QUEUE (R5) — which of two waiting threads the daemon
 * actually raises, and whether it says why.
 *
 * It is a process test and not a unit one because the ordering lives in exactly the
 * seam a unit test does not cross: `orderCandidates` is pure and provable on its own
 * (`priority.test.ts`), but the facts it orders by — the priority in force and the age
 * of the handoff — are read out of the mail checkout at tick time, through the role
 * registry's permissions. Before R5 the order came out of the directory alphabet, and
 * an alphabet is exactly what a pure test of the sort would never notice going back.
 *
 * The synthetic feed is deliberate (curator's boundary): a second live thread with
 * mail does not exist yet, so the rule is calibrated on threads built here rather than
 * on invented complexity nobody has needed.
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
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
      permissions: ["thread-priority"],
    },
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
    },
  ],
};

const meta = (participants: string): string =>
  `---\ntitle: T\nparticipants: ${participants}\nstatus: open\n---\n`;

/** A handoff to `dev-core` at a given stamp, optionally carrying a priority. */
const handoff = (options: {
  readonly from: string;
  readonly date: string;
  readonly priority?: string;
}): string =>
  `---\nfrom: ${options.from}\ndate: ${options.date}\nexpects: answer\nwaiting-on: dev-core\n${
    options.priority === undefined ? "" : `priority: ${options.priority}\n`
  }---\n\nThe body.\n`;

type ThreadSpec = { readonly id: string; readonly message: string };

/** The full circuit on disk, carrying exactly the threads it is given. */
const contour = (threads: readonly ThreadSpec[]): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-queue-"));
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
  for (const spec of threads) {
    const dir = join(mail, "agent-comms", spec.id);
    mkdirSync(join(dir, "messages"), { recursive: true });
    writeFileSync(join(dir, "_meta.md"), meta("dev-core, curator"));
    writeFileSync(join(dir, "messages", "2026-07-25T10-00-00Z-curator.md"), spec.message);
  }
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

const enable = (repo: string): void => {
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(join(repo, ".orchestrator", "enabled"), "", "utf8");
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
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

/** Which pair the journal says was actually raised. */
const launched = (repo: string): string | undefined => {
  const path = join(repo, ".orchestrator", "journal.jsonl");
  if (!existsSync(path)) return undefined;
  const event = parseJournal(readFileSync(path, "utf8")).find((e) => e.kind === "launch");
  return event === undefined ? undefined : `${event.role}×${event.thread}`;
};

describe("the daemon raises the thread the queue puts first (R5)", () => {
  it("an explicit 'high' beats an older wait — and the whole queue is printed with its reasons", () => {
    const repo = contour([
      { id: "003-old", message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z" }) },
      {
        id: "016-urgent",
        message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z", priority: "high" }),
      },
    ]);
    enable(repo);

    const result = daemon(repo);

    expect(launched(repo)).toBe("dev-core×016-urgent");
    expect(result.out).toContain("queue 1/2: dev-core×016-urgent — priority high");
    expect(result.out).toContain("queue 2/2: dev-core×003-old — priority normal");
    // The one NOT raised is accounted for as well — the tick names every candidate it
    // passed over, so an unexpected order is answerable from the log alone.
    expect(result.out).toContain("waiting since 2026-07-01T10:00:00Z");
  });

  it("with nothing said, the OLDEST wait goes first — not the first directory in the alphabet", () => {
    // The alphabet would answer `003-recent`; the age of the handoff answers `016-old`,
    // and the two disagree on purpose here. That disagreement is the whole regression
    // this file exists to catch.
    const repo = contour([
      { id: "003-recent", message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z" }) },
      { id: "016-old", message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z" }) },
    ]);
    enable(repo);

    const result = daemon(repo);

    expect(launched(repo)).toBe("dev-core×016-old");
    expect(result.out).toContain("queue 1/2: dev-core×016-old");
  });

  it("a priority from a role without the permission is dropped OUT LOUD, and the order ignores it", () => {
    // `dev-core` does not hold `thread-priority`. A message of its own that claims
    // `high` must neither move the thread nor vanish quietly: a queue ordered by a
    // statement nobody honoured looks exactly like one that honoured it.
    const repo = contour([
      { id: "003-old", message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z" }) },
      {
        id: "016-claims",
        message: handoff({ from: "dev-core", date: "2026-07-25T10:00:00Z", priority: "high" }),
      },
    ]);
    enable(repo);

    const result = daemon(repo);

    expect(result.out).toContain("016-claims — the priority 'high' of 'dev-core'");
    expect(result.out).toContain("thread-priority");
    expect(launched(repo)).toBe("dev-core×003-old");
  });

  it("'low' parks a thread behind the default without taking it out of the queue", () => {
    const repo = contour([
      {
        id: "003-parked",
        message: handoff({ from: "curator", date: "2026-07-01T10:00:00Z", priority: "low" }),
      },
      { id: "016-ordinary", message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z" }) },
    ]);
    enable(repo);

    const result = daemon(repo);

    expect(launched(repo)).toBe("dev-core×016-ordinary");
    expect(result.out).toContain("queue 2/2: dev-core×003-parked — priority low");
  });
});
