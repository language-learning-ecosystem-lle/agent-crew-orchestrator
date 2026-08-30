/**
 * THE LIVE REHEARSAL OF THE EIGHTH CLASS — the untaken turn, driven through a REAL TICK
 * of the daemon (thread 042, john's decision of 2026-08-30 ~13:10Z).
 *
 * The acceptance of this class used to be a field criterion ("a day in which no handed-off
 * turn stayed untaken past the threshold"), and it was withdrawn as unprovable on this box:
 * with the roles busy 87–93 % of the window, the free part of ANY waiting pair is small by
 * construction, so zero candidates says the queue was saturated, not that the class works
 * (`docs/protocol-reference.md`, §6.4). What replaced it is units plus a REHEARSAL: an
 * artificially built condition — a free role, a handed-off turn, a tick — must produce the
 * line with its AGE and its REASON.
 *
 * IT IS A PROCESS TEST AT THE DAEMON'S SEAM, and that is the whole of why it exists next to
 * `notify.process.test.ts`, which already drives the same class through the `notify` command.
 * The witness this class is judged by in the field is a line in `daemon.log` — the courier
 * dialled by the TICK, at the top of it, before any raise — and nothing crossed that seam:
 * every assertion about the untaken turn stopped at the command a hand types. The rehearsal
 * therefore runs the daemon binary itself and reads what the box says out loud.
 *
 * THE CLOCK IS THE REAL ONE. The age this class prints is measured from the MESSAGE, so the
 * handoff is stamped minutes before now rather than at a fixture date: a rehearsal calibrated
 * on 2026-07-25 would pass for a box whose arithmetic broke on every scale below a month.
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

/**
 * The box of the rehearsal: one raisable role, and JOHN — a `direct` target, without whom the
 * class is silent by construction (`canSpeak`, `notify.ts`): its call is "go and look at the
 * daemon", and on a box with nobody at the machine the precedence would remove the stall line
 * and put none in its place.
 */
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
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const THREAD = "012-untaken";

/** A UTC stamp `minutes` ago, in the form the mail's `date` field takes. */
const minutesAgo = (minutes: number): string =>
  `${new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19)}Z`;

/** The full circuit on disk — a bare origin, a code checkout and a mail checkout. */
const contour = (handedMinutesAgo: number): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-untaken-"));
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
    "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n",
  );
  const date = minutesAgo(handedMinutesAgo);
  writeFileSync(
    join(dir, "messages", `${date.replaceAll(":", "-")}-curator.md`),
    `---\nfrom: curator\ndate: ${date}\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe turn is yours.\n`,
  );
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

const stateDir = (repo: string): string => join(repo, ".orchestrator");
const journalPath = (repo: string): string => join(stateDir(repo), "journal.jsonl");

/**
 * The box switched ON, with a journal that says nothing about the pair: the role is free, and
 * no box-wide reason (disabled launches, an empty journal read as an outage) answers for it.
 * The one lease in it belongs to ANOTHER role on ANOTHER thread — the legitimate queue that
 * the class subtracts, present so the rehearsal is not passing on an empty file.
 */
const idleBox = (repo: string): void => {
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(join(stateDir(repo), "enabled"), "", "utf8");
  const lines = [
    {
      kind: "lease-acquired",
      ts: minutesAgo(300),
      role: "curator",
      thread: "016-other",
      deadline: minutesAgo(240),
    },
    {
      kind: "lease-released",
      ts: minutesAgo(280),
      role: "curator",
      thread: "016-other",
      reason: "completed",
    },
  ];
  writeFileSync(journalPath(repo), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
};

/** A hold as `orchestrator hold` writes it: `<state>/holds/<role>`, one JSON line. */
const heldBy = (repo: string, who: string, expires: string): void => {
  const dir = join(stateDir(repo), "holds");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "dev-core"),
    `${JSON.stringify({ role: "dev-core", by: who, taken: minutesAgo(60), expires })}\n`,
    "utf8",
  );
};

const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

/** BOTH STREAMS ARE THE OUTPUT — in the field they are one file, `daemon.log`. */
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

const journalKinds = (repo: string): readonly string[] =>
  existsSync(journalPath(repo))
    ? parseJournal(readFileSync(journalPath(repo), "utf8")).map((event) => event.kind)
    : [];

describe("the live rehearsal of the untaken turn (thread 042, §6.4)", () => {
  it("a free role and a turn handed 40m ago: the TICK prints the pair, its age and 'no reason known'", () => {
    const repo = contour(40);
    idleBox(repo);

    const result = daemon(repo);

    expect(result.code).toBe(0);
    // The class, in the daemon's own voice — the line the field judges it by.
    expect(result.out).toContain("unaccepted over 10m");
    expect(result.out).toMatch(/dev-core×012-untaken \(\d+m, no reason known\)/);
    // The age is the FREE part and it is measured from the message: 40 minutes ago, and the
    // only lease in the journal belongs to another role on another thread, so nothing is
    // subtracted. A rehearsal that asserted only "over 10m" would pass on an age of 34 days.
    expect(result.out).toMatch(/dev-core×012-untaken \((3[5-9]|4[0-5])m,/);
    // And the instruction, which is the half a bare count cannot carry.
    expect(result.out).toContain("this box has not raised it");
    // The rehearsal's control: the pair was genuinely raisable this whole time — the very
    // tick that spoke went on to raise it. The line is about the 40 minutes BEFORE the tick,
    // not about a pair the box had some quiet objection to.
    expect(journalKinds(repo)).toContain("launch");
  });

  it("a TICK WITHOUT A RAISE: the pair is still named, with the reason instead of the call", () => {
    // The other half of the rehearsal, and the one that matches the shape john named: the
    // tick raises nobody at all. A live manual hold (S5) is the box working exactly as a hand
    // told it to — so the pair keeps its age and its name in the line, and the call does not
    // go out. A ring here would send john to look at a daemon for a hold john took.
    const repo = contour(40);
    idleBox(repo);
    heldBy(repo, "john", minutesAgo(-600));

    const result = daemon(repo);

    expect(result.code).toBe(0);
    // The daemon's own skip, and the courier's line about the same pair — one box, one story.
    // They name the hold differently on purpose-by-accident: the daemon's skip names the ROLE
    // it is refusing to raise, the courier names the HOLDER and the expiry, because its reader
    // is the person deciding whether to go and look at the machine.
    expect(result.out).toContain(
      "candidate dev-core×012-untaken skipped: held by a manual session",
    );
    expect(result.out).toMatch(
      /dev-core×012-untaken \(\d+m, the role is held by a manual session of john until \d{4}-\d{2}-\d{2}T/,
    );
    expect(result.out).not.toContain("no reason known");
    expect(result.out).not.toContain("this box has not raised it");
    // A tick without a raise, said by the journal rather than by the absence of a line.
    expect(journalKinds(repo)).not.toContain("launch");
  });

  it("an EXPIRED hold is no reason at all — the same tick rings", () => {
    // The half that keeps the first honest: the daemon raises over an expired hold the moment
    // it lapses (`foldHolds`), so a pair still standing behind a dead one is the standstill
    // nobody was told about.
    const repo = contour(40);
    idleBox(repo);
    heldBy(repo, "john", minutesAgo(30));

    const result = daemon(repo);

    expect(result.out).toContain("unaccepted over 10m");
    expect(result.out).toMatch(/dev-core×012-untaken \(\d+m, no reason known\)/);
  });
});
