/**
 * THE SEAM OF THE CIRCUIT WATCHDOG — secrets file → daemon tick → an outgoing request
 * (thread `017-circuit-watchdog`).
 *
 * `watchdog.test.ts` proves the policy and the shapes; what a unit cannot reach is the
 * only thing that actually failed on 2026-08-18 — whether a REAL daemon process, reading
 * a REAL machine config, sends a REAL request out of itself, and whether it still does its
 * work when the monitor answers badly or not at all. Every one of those is a join between
 * layers that do not know about each other, and a unit test of a mapping proves none of it.
 *
 * THE MONITOR IS ON LOOPBACK AND NOTHING LEAVES THIS BOX. The statement of work rules out
 * reaching a live external service from the tests — it costs money and answers differently
 * on different days — but that argument is about the SERVICE, not about HTTP: a server on
 * 127.0.0.1 is deterministic, free, and is the only way to prove that a request was made at
 * all rather than that a function was called.
 *
 * WHAT IS ASSERTED IS THE OUTCOME OF THE TICK, never the daemon's log lines: the tick is
 * judged by whether it raised the pair it was supposed to raise (a `lease-taken` in the
 * journal), because that is the property the watchdog is forbidden from touching.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { parseJournal } from "./journal.js";
import { SELF_RESTART_EXIT_CODE } from "./self-restart.js";
import { BOX_URL_KEY, CIRCUIT_URL_KEY } from "./watchdog.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const SRC = fileURLToPath(new URL("..", import.meta.url));
const NODE_MODULES = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
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
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const meta = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const handoff =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/** What the monitor did with the beat — the whole of what the test needs from it. */
type Monitor = {
  readonly url: string;
  readonly paths: string[];
  readonly close: () => Promise<void>;
};

/**
 * A monitor on loopback. `answer` decides what happens to a request: a status to send, or
 * `"hang"` — the case the daemon must survive on its own timeout with nobody answering.
 *
 * `delayMs` holds the ANSWER back without holding the request back, which is what makes a
 * case about waiting-out measurable: the path is recorded the moment the request arrives,
 * so "it was sent" and "it was settled" stop being the same observation.
 */
const monitor = async (answer: number | "hang" = 200, delayMs = 0): Promise<Monitor> => {
  const paths: string[] = [];
  const server: Server = createServer((req, res) => {
    paths.push(req.url ?? "");
    if (answer === "hang") return;
    const reply = (): void => {
      res.writeHead(answer);
      res.end("ok");
    };
    if (delayMs === 0) reply();
    else setTimeout(reply, delayMs).unref();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}/ping/circuit`,
    paths,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

type Contour = {
  readonly repo: string;
  readonly local: string;
  readonly cli: string;
  readonly exec: string;
};

/** The agent binary a launch would use. Never inside the repo: an untracked file there is
 * a dirty tree, and a dirty tree is a condition of the self-restart cases below. */
const execStub = (base: string): string => {
  const stub = join(base, "stub.sh");
  writeFileSync(stub, "#!/bin/sh\nexit 0\n");
  chmodSync(stub, 0o755);
  return stub;
};

/** The mail of a contour — its own branch in the same origin, with one pair waiting. */
const seedMail = (origin: string, repo: string): void => {
  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "config", "user.name", "t");
  git(mail, "config", "user.email", "t@e");
  git(mail, "checkout", "-q", "--orphan", "comms");
  const dir = join(mail, "agent-comms", "016-protocol-roadmap");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(join(dir, "_meta.md"), meta);
  writeFileSync(join(dir, "messages", "2026-07-25T10-00-00Z-curator.md"), handoff);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
};

/**
 * THE PATH TO THE SECRETS IS THE MACHINE CONFIG'S ANSWER AND NOBODY ELSE'S (R14) — the
 * same join production uses, which is exactly the half a unit test cannot exercise.
 */
const machineConfig = (
  base: string,
  secrets: Readonly<Record<string, string>> | undefined,
): string => {
  const local = join(base, "local.json");
  const envFile = join(base, "secrets.env");
  if (secrets !== undefined) {
    writeFileSync(
      envFile,
      `${Object.entries(secrets)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
    );
  }
  writeFileSync(
    local,
    `${JSON.stringify(secrets === undefined ? {} : { secrets: { envFile } }, null, 2)}\n`,
  );
  return local;
};

const contour = (secrets: Readonly<Record<string, string>> | undefined): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-watchdog-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  seedMail(origin, repo);

  const local = machineConfig(base, secrets);

  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(join(repo, ".orchestrator", "enabled"), "", "utf8");
  return { repo, local, cli: CLI, exec: execStub(base) };
};

/**
 * THE SAME BOX, BUILT SO THAT ITS TICK ENDS IN A HANDBACK (055.2 + thread 017). Two facts
 * have to hold at once and neither can be borrowed from the ambient checkout: the daemon
 * must be raised from THIS repository's own copy of the sources (a repair only ever touches
 * the tree the code came from — condition 3), and that copy must sit one commit behind its
 * own `origin/main` ON ITS BRANCH, so `git pull --ff-only` succeeds and the verdict is
 * `handback` rather than a stand. `INVOCATION_ID` — what systemd sets and what the daemon
 * reads to know it is supervised — is passed at the tick, not here.
 */
const driftHome = (secrets: Readonly<Record<string, string>>): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-watchdog-handback-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify({ ...CONFIG, orchestrator: { ...CONFIG.orchestrator, ref: "origin/main" } }, null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  // A running circuit puts three things inside its own home that no commit owns, and for
  // the tree-state read that guards the repair, untracked IS dirty.
  writeFileSync(join(repo, ".gitignore"), "node_modules\nmailco/\n.orchestrator/\n");
  cpSync(SRC, join(repo, "src"), { recursive: true });
  symlinkSync(NODE_MODULES, join(repo, "node_modules"), "dir");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "the loaded code");
  const loaded = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "push", "-q", "origin", "main");
  seedMail(origin, repo);
  git(repo, "commit", "-qm", "the ref", "--allow-empty");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "--hard", "-q", loaded);

  return {
    repo,
    local: machineConfig(base, secrets),
    cli: join(repo, "src", "cli.ts"),
    exec: execStub(base),
  };
};

/**
 * ONE TICK, SPAWNED ASYNCHRONOUSLY AND NOT `spawnSync`. The monitor above lives in THIS
 * process's event loop, and `spawnSync` blocks it: the daemon's request would arrive at a
 * socket nobody is listening on until the daemon has already given up — a test that
 * measures its own blocking rather than the code under it. The first version of this file
 * did exactly that and reported "no answer in 5s" against a healthy server.
 */
const tick = (
  place: Contour,
  extra?: { readonly ref?: string; readonly env?: Readonly<Record<string, string>> },
): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(
      TSX,
      [
        place.cli,
        "orchestrator",
        "daemon",
        "--once",
        "--exec",
        place.exec,
        "--poll",
        "1",
        "--ref",
        extra?.ref ?? "HEAD",
        "--no-fetch",
        "--repo",
        place.repo,
        "--local-config",
        place.local,
      ],
      {
        cwd: place.repo,
        stdio: "pipe",
        env: { ...sandbox(configHome(place.repo)), ...(extra?.env ?? {}) },
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });

/** THE OUTCOME OF THE TICK: did it raise the pair it was there to raise. */
const raised = (place: Contour): boolean => {
  const path = join(place.repo, ".orchestrator", "journal.jsonl");
  if (!existsSync(path)) return false;
  return parseJournal(readFileSync(path, "utf8")).some(
    (event) => event.kind === "lease-acquired" && event.role === "dev-core",
  );
};

let open: Monitor | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe("the daemon's dead-man ping", () => {
  it("beats EXACTLY ONCE in a tick when the secrets file names a monitor", async () => {
    open = await monitor(200);
    const place = contour({ [CIRCUIT_URL_KEY]: open.url });
    const run = await tick(place);
    expect(run.code).toBe(0);
    expect(open.paths).toEqual(["/ping/circuit"]);
    expect(raised(place)).toBe(true);
  }, 120_000);

  it("beats not at all when the key is absent, and says so ONCE without failing the tick", async () => {
    open = await monitor(200);
    const place = contour({ [BOX_URL_KEY]: open.url });
    const run = await tick(place);
    expect(run.code).toBe(0);
    // The box's own key is not the circuit's, and is never borrowed for it.
    expect(open.paths).toEqual([]);
    expect(run.out).toContain("circuit watchdog OFF");
    expect(run.out.match(/circuit watchdog OFF/g)).toHaveLength(1);
    expect(raised(place)).toBe(true);
  }, 120_000);

  it("REFUSES the box's own url and beats nothing rather than beating it twice", async () => {
    open = await monitor(200);
    const place = contour({ [CIRCUIT_URL_KEY]: open.url, [BOX_URL_KEY]: open.url });
    const run = await tick(place);
    expect(run.code).toBe(0);
    expect(open.paths).toEqual([]);
    expect(run.out).toContain(BOX_URL_KEY);
    expect(raised(place)).toBe(true);
  }, 120_000);

  it("a monitor answering 503 does not cost the tick anything", async () => {
    open = await monitor(503);
    const place = contour({ [CIRCUIT_URL_KEY]: open.url });
    const run = await tick(place);
    expect(run.code).toBe(0);
    expect(open.paths).toEqual(["/ping/circuit"]);
    expect(raised(place)).toBe(true);
  }, 120_000);

  it("a monitor that never answers does not cost the tick anything either", async () => {
    open = await monitor("hang");
    const place = contour({ [CIRCUIT_URL_KEY]: open.url });
    const run = await tick(place);
    expect(run.code).toBe(0);
    expect(open.paths).toEqual(["/ping/circuit"]);
    expect(raised(place)).toBe(true);
  }, 120_000);

  it("an unreachable monitor does not cost the tick anything", async () => {
    // A port nothing is listening on: the connection is REFUSED, which is the shape of a
    // dead network from inside a box that still has one.
    const place = contour({ [CIRCUIT_URL_KEY]: "http://127.0.0.1:1/ping/circuit" });
    const run = await tick(place);
    expect(run.code).toBe(0);
    expect(raised(place)).toBe(true);
  }, 120_000);
});

/**
 * THE EXIT THAT WOULD HAVE TAKEN THE BEAT WITH IT (the reviewer's finding on #36).
 *
 * Four of the five ways out of a tick end in `return` and settle the beat where the tick
 * was going to sleep anyway. The fifth is `process.exit(75)` — the handback of a supervised
 * daemon that repaired its own tree — and it is the only one where "settled at the bottom"
 * is a claim about a bottom the process never reaches. The argument is the `--once` one word
 * for word: a request that nobody waits for leaves the box only by luck, and the last tick
 * before a repair is exactly the tick whose beat carries information — it is what tells the
 * monitor the process reached its own handover rather than died on the way to it.
 *
 * THE MONITOR ANSWERS LATE AND BADLY, and both halves are load-bearing. Late, because the
 * path is recorded when the request ARRIVES: a fast answer would make "sent" and "waited
 * out" one observation and the case would pass over the defect. Badly (503), because a
 * settled beat that succeeded says nothing — `describeBeat` speaks on a change of state —
 * so a refusal is the only outcome of `settle()` that is visible from outside the process
 * at all. The two together make the assertion exact: the line exists only if this exit
 * waited, and it can only have waited longer than the answer took to come back.
 */
describe("the dead-man ping and the exit that is a repair", () => {
  it("settles the beat before handing back to the supervisor", async () => {
    open = await monitor(503, 750);
    const place = driftHome({ [CIRCUIT_URL_KEY]: open.url });
    const run = await tick(place, {
      ref: "origin/main",
      env: { INVOCATION_ID: "test-invocation" },
    });

    // The premise of the case, asserted rather than assumed: this tick really did end in
    // the handback exit. Without these two lines the assertion below could be satisfied by
    // an ordinary tick that never went near `process.exit`.
    expect(run.out).toContain("this process is supervised");
    expect(run.code).toBe(SELF_RESTART_EXIT_CODE);

    // The beat left the box...
    expect(open.paths).toEqual(["/ping/circuit"]);
    // ...and this exit waited for what came back, which is the whole of the finding: the
    // 503 was answered 750ms after the request, long after an unsettled tick would have gone.
    expect(run.out).toContain("the dead-man ping was NOT delivered: the monitor answered 503");
  }, 120_000);
});
