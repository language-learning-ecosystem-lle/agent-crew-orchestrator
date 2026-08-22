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
  readonly parkedOn?: string;
}): string =>
  `---\nfrom: ${options.from}\ndate: ${options.date}\nexpects: answer\nwaiting-on: dev-core\n${
    options.priority === undefined ? "" : `priority: ${options.priority}\n`
  }${options.parkedOn === undefined ? "" : `parked-on: ${options.parkedOn}\n`}---\n\nThe body.\n`;

/**
 * THE WORD OF THE PERSON arriving on a parked thread — the one lift of that park since
 * 2026-08-22 (thread 030, `delivers`). Written by another author on purpose: the field says
 * WHOSE word it is, not who wrote it down, and a curator relaying john's decision is the shape
 * the live circuit actually produces. Handing the turn on at the same time is ordinary — a
 * delivery is an ordinary message in every other respect.
 */
const answer = (options: {
  readonly from: string;
  readonly date: string;
  readonly delivers: string;
}): string =>
  `---\nfrom: ${options.from}\ndate: ${options.date}\nexpects: answer\nwaiting-on: dev-core\ndelivers: ${options.delivers}\n---\n\nThe decision.\n`;

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

/** Every pair the journal says was raised, in order — a park is about ticks that add NOTHING. */
const allLaunched = (repo: string): readonly string[] => {
  const path = join(repo, ".orchestrator", "journal.jsonl");
  if (!existsSync(path)) return [];
  return parseJournal(readFileSync(path, "utf8"))
    .filter((e) => e.kind === "launch")
    .map((e) => `${e.role}×${e.thread}`);
};

/**
 * A journal carrying `attempts` FAILED runs of a pair — the state a park has to preserve.
 *
 * Written as the daemon writes it (acquire, then a release with a losing reason) rather than
 * as a count, because the count is not a field: it is folded out of these two events by
 * `foldLeases`, and a test that seeded a number would prove nothing about the fold the tick
 * actually reads.
 */
const failedRuns = (
  repo: string,
  pair: { readonly role: string; readonly thread: string },
  attempts: number,
): void => {
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  const lines: string[] = [];
  for (let at = 0; at < attempts; at += 1) {
    const hour = String(at + 1).padStart(2, "0");
    lines.push(
      JSON.stringify({
        kind: "lease-acquired",
        ts: `2026-07-25T${hour}:00:00Z`,
        deadline: `2026-07-25T${hour}:30:00Z`,
        ...pair,
      }),
      JSON.stringify({
        kind: "lease-released",
        ts: `2026-07-25T${hour}:20:00Z`,
        reason: "exited-without-handoff",
        exitCode: 0,
        ...pair,
      }),
    );
  }
  writeFileSync(join(repo, ".orchestrator", "journal.jsonl"), `${lines.join("\n")}\n`, "utf8");
};

/** The answer landing in the mail the daemon reads — a new message, committed on the mail branch. */
const deliver = (repo: string, thread: string, message: string): void => {
  const mail = join(repo, "mailco");
  writeFileSync(
    join(mail, "agent-comms", thread, "messages", "2026-07-25T12-00-00Z-curator.md"),
    message,
  );
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "the answer");
  git(mail, "push", "-q", "origin", "comms");
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

/**
 * THREAD 020 — A PARKED TURN IS NOT A FAILED ONE, ACROSS THE SEAM.
 *
 * `planTick` is proved on this by unit (`tick.test.ts`), and the unit cannot prove the thing
 * that actually broke a live circuit: the park is a fact of the MAIL and the attempt count is a
 * fact of the JOURNAL, and nothing but the daemon puts the two in the same tick. A pair one
 * attempt from its ceiling, sitting on a thread frozen behind a person, has to survive any
 * number of ticks with that count unmoved — and the only honest way to observe "unmoved" from
 * outside is to lift the park afterwards and watch the pair still be raisable. Had the frozen
 * ticks each spent an attempt, the ceiling would have closed over it and the raise below would
 * never happen.
 */
describe("a thread frozen behind a person costs the pair nothing (thread 020)", () => {
  const pair = { role: "dev-core", thread: "030-consult" };

  it("ticks pass, nothing is raised, and the attempts the pair had left are still there", () => {
    const repo = contour([
      {
        id: pair.thread,
        message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z", parkedOn: "john" }),
      },
    ]);
    enable(repo);
    // Two of the three attempts are gone. One tick that miscounted the freeze as a failure
    // would take the third, and the pair would be `exhausted` before john ever answered —
    // which is the shape the live circuit produced three times over on 2026-08-21.
    failedRuns(repo, pair, 2);

    const first = daemon(repo);
    const second = daemon(repo);

    expect(allLaunched(repo)).toEqual([]);
    for (const tick of [first, second]) {
      expect(tick.out).toContain("candidate dev-core×030-consult skipped: the turn is parked");
      expect(tick.out).toContain("a decision of john");
      // NOT the other silence: an exhausted pair reads as damage done and sends the operator
      // to the journal, a parked one asks a person for an answer.
      expect(tick.out).not.toContain("candidate dev-core×030-consult skipped: exhausted");
    }

    // THE ANSWER LANDS — and the pair is raised by the ordinary queue, which is only possible
    // if the two frozen ticks above left the count where they found it.
    deliver(
      repo,
      pair.thread,
      answer({ from: "curator", date: "2026-07-25T12:00:00Z", delivers: "john" }),
    );
    const third = daemon(repo);

    expect(allLaunched(repo)).toEqual(["dev-core×030-consult"]);
    expect(third.out).toContain("queue 1/1: dev-core×030-consult");
  });

  it("the net is NARROW: the same pair without a park is raised, and the attempt is spent", () => {
    // The control of the pair above, differing in one header field. Without it the freeze
    // could be swallowing the honest no-handoff — a session that died having written nothing
    // keeps its ceiling, and that ceiling is the only thing standing between a broken pair
    // and an endless loop of raising it.
    const repo = contour([
      { id: pair.thread, message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z" }) },
    ]);
    enable(repo);
    failedRuns(repo, pair, 2);

    const result = daemon(repo);

    expect(allLaunched(repo)).toEqual(["dev-core×030-consult"]);
    expect(result.out).not.toContain("skipped: the turn is parked");
  });
});

/**
 * D-4 (thread 023) — THE OPERATOR'S FRAME, through the command rather than the renderer.
 *
 * The unit tests own the words; what only a process can show is the WIRING in `cli.ts`:
 * that the capacity is counted off the roles THIS box raises, that the live set is the
 * folded journal and not the whole of it, and that the freeze behind a person is read
 * from the same mail the queue is. Every one of those three is a line that would render
 * perfectly while reporting about the wrong thing.
 */
describe("`status` — the live count and the freeze, where an operator reads them (D-4)", () => {
  const status = (repo: string): { code: number; out: string } => {
    const result = spawnSync(
      TSX,
      [CLI, "orchestrator", "status", "--ref", "HEAD", "--no-fetch", "--repo", repo],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
    );
    return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };

  it("an idle box says so with a number — 'nobody is live' out of the config, not out of silence", () => {
    const repo = contour([
      { id: "016-ordinary", message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z" }) },
    ]);

    const result = status(repo);

    // One launchable role in this contour: `curator` is `claude.ai`, `john` is a human.
    expect(result.out).toContain(
      "parallelism: nobody is live — 1 role(s) this box raises, all free",
    );
  });

  it("a thread frozen behind a person is marked IN THE QUEUE, not only on the daemon's stream", () => {
    const repo = contour([
      {
        id: "030-consult",
        message: handoff({ from: "curator", date: "2026-07-25T10:00:00Z", parkedOn: "john" }),
      },
    ]);

    const result = status(repo);

    // The pair keeps its place — it IS a candidate, and it lifts by itself with the next
    // substantive message. What changes is that the line no longer promises a launch.
    expect(result.out).toContain("queue 1/1: dev-core×030-consult");
    expect(result.out).toContain("PARKED behind a decision of john");
  });
});
