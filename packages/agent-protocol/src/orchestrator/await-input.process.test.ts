/**
 * The PROCESS test of `await-input` — the blocking half of the interactive turn (R19).
 *
 * It has to be a process test and it has to be a real git circuit, because the two
 * things this command exists to get right are both outside any pure function: it must
 * SEE an answer that arrives in the remote while it waits (the fetch loop), and it must
 * refuse the one setup where a wait can never end — a question that was never pushed.
 * The second is the deadlock this mechanism is most likely to hit in practice, and it
 * would cost a whole ceiling to discover in production.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "self" },
      summary: "the keeper",
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const message = (from: string, stamp: string, waitingOn: string): string =>
  `---\nfrom: ${from}\ndate: ${stamp}\nexpects: answer\nwaiting-on: ${waitingOn}\n---\n\nThe text.\n`;

type Contour = { repo: string; mail: string; root: string; origin: string; session: string };

/** Origin + a code checkout with the config + a mail checkout on `comms`, as in life. */
const contour = (): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-await-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "016-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(
    join(thread, "messages", "2026-07-26T10-00-00Z-curator.md"),
    message("curator", "2026-07-26T10:00:00Z", "dev-core"),
  );
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "the statement of work");
  git(mail, "push", "-q", "-u", "origin", "comms");

  return {
    repo,
    mail,
    root: join(mail, "agent-comms"),
    origin,
    session: join(repo, "run.session"),
  };
};

/** The session asks its question: the message, and the declaration beside it. */
const ask = (contour: Contour, options: { push: boolean }): void => {
  writeFileSync(
    join(contour.root, "016-x", "messages", "2026-07-26T10-30-00Z-dev-core.md"),
    message("dev-core", "2026-07-26T10:30:00Z", "curator"),
  );
  git(contour.mail, "add", "agent-comms");
  git(contour.mail, "commit", "-qm", "the question");
  if (options.push) git(contour.mail, "push", "-q", "origin", "comms");
  writeFileSync(
    `${contour.session.replace(/\.session$/, ".waiting")}`,
    `${JSON.stringify({ thread: "016-x", at: "2026-07-26T10:30:00Z" })}\n`,
  );
};

/** Somebody answers IN THE REMOTE — the way a real answer arrives. */
const answer = (contour: Contour): void => {
  const clone = mkdtempSync(join(tmpdir(), "agent-protocol-curator-"));
  execFileSync("git", ["clone", "-q", "-b", "comms", contour.origin, clone]);
  writeFileSync(
    join(clone, "agent-comms", "016-x", "messages", "2026-07-26T11-00-00Z-curator.md"),
    message("curator", "2026-07-26T11:00:00Z", "dev-core"),
  );
  git(clone, "add", "agent-comms");
  git(clone, "commit", "-qm", "the answer");
  git(clone, "push", "-q", "origin", "comms");
};

const argv = (contour: Contour, extra: readonly string[]): string[] => [
  CLI,
  "await-input",
  "--repo",
  contour.repo,
  "--root",
  contour.root,
  "--ref",
  "HEAD",
  "--no-fetch",
  "--role",
  "dev-core",
  "--thread",
  "016-x",
  ...extra,
];

const env = (contour: Contour): NodeJS.ProcessEnv => ({
  ...process.env,
  AGENT_PROTOCOL_WORKER: "claude-code",
  AGENT_PROTOCOL_SESSION_FILE: contour.session,
});

const wait = (contour: Contour, extra: readonly string[]): { code: number; out: string } => {
  const result = spawnSync(TSX, argv(contour, extra), {
    cwd: contour.repo,
    encoding: "utf8",
    env: env(contour),
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const markerPath = (contour: Contour): string => contour.session.replace(/\.session$/, ".waiting");

describe("await-input — the blocking half of the interactive turn (R19)", () => {
  it("the answer is already in the thread → returns at once, and the declaration is dropped", () => {
    // The declaration is a LEVEL: while it exists the supervisor keeps the run parked,
    // so the command must drop it on the way out or a working session stays recorded as
    // waiting.
    const contour_ = contour();
    writeFileSync(markerPath(contour_), `${JSON.stringify({ thread: "016-x", at: "x" })}\n`);

    const result = wait(contour_, ["--timeout", "5", "--poll", "1"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("the answer arrived");
    expect(existsSync(markerPath(contour_))).toBe(false);
  }, 60_000);

  it("REFUSES without a declaration — waiting undeclared is what the marker prevents", () => {
    // Undeclared, the supervisor reads the passed turn as the end of the run and closes
    // it while the session sits here. The command insists on a declaration made where it
    // had to be made: beside the question.
    const contour_ = contour();
    ask(contour_, { push: true });
    execFileSync("rm", ["-f", markerPath(contour_)]);

    const result = wait(contour_, ["--timeout", "5", "--poll", "1"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("no wait was declared");
  }, 60_000);

  it("REFUSES an unpushed question — nobody could ever answer it", () => {
    const contour_ = contour();
    ask(contour_, { push: false });

    const result = wait(contour_, ["--timeout", "5", "--poll", "1"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("unpushed commits");
    // The declaration is LEFT ALONE: the session may still push and wait again, and
    // removing somebody's declaration on the way out of a refusal is not a repair this
    // package makes.
    expect(existsSync(markerPath(contour_))).toBe(true);
  }, 60_000);

  it("nobody answers → code 3 and a sentence that says what to do next", () => {
    // Code 3 and not 2: the arguments were fine, the WAIT ran out, and the session is
    // expected to act on that rather than to fix its command.
    const contour_ = contour();
    ask(contour_, { push: true });

    const result = wait(contour_, ["--timeout", "2", "--poll", "1"]);

    expect(result.code).toBe(3);
    expect(result.out).toContain("wrap up");
    expect(existsSync(markerPath(contour_))).toBe(false);
  }, 60_000);

  it("SEES AN ANSWER THAT ARRIVES IN THE REMOTE WHILE IT WAITS", async () => {
    // The heart of the mechanism: the answer is pushed by somebody else, into a
    // repository this checkout only learns about by fetching. A loop that read the disk
    // alone would wait out its whole ceiling next to an answer that had already been
    // given.
    const contour_ = contour();
    ask(contour_, { push: true });

    const child = spawn(TSX, argv(contour_, ["--timeout", "30", "--poll", "1"]), {
      cwd: contour_.repo,
      env: env(contour_),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    answer(contour_);

    const code = await new Promise<number>((resolve) => {
      child.on("exit", (status) => resolve(status ?? 1));
    });

    expect(code).toBe(0);
    expect(out).toContain("the answer arrived");
    expect(existsSync(markerPath(contour_))).toBe(false);
  }, 60_000);
});
