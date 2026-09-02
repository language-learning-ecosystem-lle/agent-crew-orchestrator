/**
 * THE TURN THAT WAS TAKEN RATHER THAN PASSED — through a REAL run (thread 063).
 *
 * WHY A PROCESS TEST beside the units on `handoffDetected`. The unit is given `spoke`
 * ready-made; the whole defect of 2026-08-30 lived in HOW that fact is assembled, and
 * everything that assembles it stands outside the pure function: the raise records the
 * role's own last message (`world.mine`, R18), the supervisor re-reads the same mark
 * every poll off a mail checkout that a THIRD party keeps writing into, and only then
 * asks the question. A unit cannot fail if `world.mine` stops being written, if the
 * re-read looks at another thread, or if the announcement is lost — and each of those
 * would put the field case back exactly as it was.
 *
 * THE FIXTURE IS THE FIELD SHAPE, with the roles swapped for the ones this contour has:
 * the thread awaits `dev-core`, the session writes NOTHING, and while it is alive a
 * third party (`github`, the notifier) writes into the same thread with
 * `waiting-on: curator`. The mail stops naming the role — the exact input that used to
 * read as "the turn was passed".
 *
 * BOTH HALVES ARE HERE, and the second is what makes the first mean anything: the SAME
 * fixture, the same stub, one line different — the message is signed by the role itself
 * — reads as a passed turn and closes `completed`. The difference between the two runs
 * is who signed the message, and nothing else.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

const THREAD = "063-state-model-rewrite";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  // THE `workdir` SECTION IS LOAD-BEARING HERE, not decoration copied from the live
  // config: `world` (and with it the `mine` mark the whole reading stands on) is only
  // recorded when the contour declares workspaces — see `settleRun`. Without it the
  // supervisor reads `spoke === undefined` and, by design, keeps the OLD reading. So
  // this fixture is the live circuit's shape, and the guard's scope is exactly it.
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
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
  ],
};

const META = `---\ntitle: T\nparticipants: dev-core, curator, github\nstatus: open\n---\n`;
/** The raise: the thread awaits the role, and the role has never written into it. */
const WAITING = [
  "---",
  "from: curator",
  "date: 2026-09-02T10:00:00Z",
  "expects: answer",
  "waiting-on: dev-core",
  "---",
  "",
  "The statement of work.",
  "",
].join("\n");

/** The full circuit on disk — bare origin, work checkout on `main`, mail on `comms`. */
const contour = (): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-turn-taken-"));
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
  const thread = join(mail, "agent-comms", THREAD);
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-09-02T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, mail };
};

/**
 * A stub that drops ONE message into the thread and then keeps living for a moment, so
 * the supervisor gets at least one poll on the changed mail while the session is still
 * up: the announcement is about a LIVE run, not about a corpse.
 */
const stub = (repo: string, path: string, body: string): string => {
  const script = join(repo, "stub.sh");
  writeFileSync(script, `#!/bin/sh\nsleep 1\nprintf '%s' '${body}' > ${path}\nsleep 4\n`);
  chmodSync(script, 0o755);
  return script;
};

/** A message file, signed by `from` and moving the turn to `waiting`. */
const letter = (from: string, waiting: string): string =>
  `---\nfrom: ${from}\ndate: 2026-09-02T10:30:00Z\nexpects: answer\nwaiting-on: ${waiting}\n---\n\nThe body.\n`;

/**
 * BOTH STREAMS ARE COLLECTED, and that is not tidiness: the announcement of a taken turn
 * goes to STDERR (it is a complaint, like every other thing the supervisor says about a
 * run going wrong), while the ordinary progress of the run goes to stdout. A helper that
 * kept only stdout would pass this file's assertions on a build where the line was
 * deleted.
 */
const run = (repo: string, exec: string): { code: number; out: string } => {
  const result = spawnSync(
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
      THREAD,
      "--exec",
      exec,
      "--wall-clock",
      "30",
      "--poll",
      "1",
      "--write",
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const journal = (repo: string): ReturnType<typeof parseJournal> =>
  parseJournal(readFileSync(join(repo, ".orchestrator", "journal.jsonl"), "utf8"));

/** The session log of the run — the file an operator opens after the fact. */
const sessionLog = (repo: string): string => {
  const dir = join(repo, ".orchestrator", "sessions");
  const names = readdirSync(dir).filter((name) => name.endsWith(".log"));
  return readFileSync(join(dir, names[names.length - 1] as string), "utf8");
};

/** Where the one letter of the run lands — the same path in both halves. */
const messagePath = (mail: string): string =>
  join(mail, "agent-comms", THREAD, "messages", "2026-09-02T10-30-00Z-third.md");

describe("a third party moved 'waiting-on' under a live lease", () => {
  it("the turn was TAKEN, not passed — the run is not closed on somebody else's word", () => {
    const { repo, mail } = contour();
    const exec = stub(repo, messagePath(mail), letter("github", "curator"));

    const result = run(repo, exec);
    const events = journal(repo);
    const kinds = events.map((event) => event.kind);

    // THE FRAME SAYS IT BY NAME, on both surfaces an operator has: the stream of the run
    // and the session log the journal points at. A silent correct reading would be half
    // a fix — from the outside the run looks exactly like one ignoring its own thread.
    expect(result.out).toContain("the turn was TAKEN, not passed");
    expect(sessionLog(repo)).toContain("the turn was TAKEN, not passed");

    // AND THE READING ITSELF, not just the words: no `handoff-detected` was recorded, so
    // the lease never went `draining` and the release is the pair's own break rather than
    // a delivery. This is the forged acceptance the fix exists to prevent — the run would
    // otherwise have closed as `completed` without the role writing a line.
    expect(kinds).not.toContain("handoff-detected");
    expect(events.at(-1)).toMatchObject({ reason: "exited-without-handoff" });
  }, 90_000);

  it("the SAME message signed by the role itself is a passed turn — completed", () => {
    const { repo, mail } = contour();
    const exec = stub(repo, messagePath(mail), letter("dev-core", "curator"));

    const result = run(repo, exec);
    const events = journal(repo);

    // The contrast that makes the first half a statement about the SIGNATURE and not
    // about the fixture being unreadable, the poll being too slow or the mail never
    // reaching the supervisor: one field of one file differs between the two runs.
    expect(result.out).not.toContain("the turn was TAKEN");
    expect(events.map((event) => event.kind)).toContain("handoff-detected");
    expect(events.at(-1)).toMatchObject({ reason: "completed" });
  }, 90_000);
});
