/**
 * THE LIVE REHEARSAL OF THE TENTH CLASS — the closed window of an account, driven through
 * REAL TICKS of the daemon and read off the far side of the TRANSPORT (thread 036).
 *
 * WHY IT IS NOT ENOUGH TO ASK THE PLANNER. `notify.test.ts` already proves that a plan
 * carrying an `account` alarm renders a line; what it cannot prove is that anything ever
 * carries one. The class shipped in #146 with nobody to fill the field — it was correct and
 * silent, which from a digest's side is indistinguishable from a box on which no window ever
 * closed. This test is the joint: a journal with a shelved account, a real daemon, and the
 * question asked of the STUB TRANSPORT — what did you actually receive.
 *
 * THE CONTROL IS HALF THE TEST. An open window must produce no such line: without it the
 * first assertion passes on code that says "quota-paused" on every tick it takes.
 *
 * IT RUNS TWO TICKS, AND THAT IS THE SUBJECT, NOT AN ACCIDENT. The courier is dialled at the
 * TOP of a tick, before the queue is read, so the alarms measured by tick N are handed to the
 * dial of tick N+1 — `--once` therefore never delivers them, and a rehearsal built on `--once`
 * would be asserting the absence of a defect that a live box does not have. The daemon here is
 * a real one, ticking, stopped by its flag.
 */
import { execFileSync, spawn } from "node:child_process";
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

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const THREAD = "036-accounts";

/** A UTC stamp `minutes` from now (negative = in the past), in the journal's form. */
const at = (minutes: number): string =>
  `${new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19)}Z`;

/**
 * The full circuit on disk — a bare origin, a code checkout, a mail checkout and a stub
 * transport that writes down every message it is handed.
 *
 * The role spends a NAMED account (`launch.account`), because that is the whole of what a
 * shelf is asked about: a box-wide window would stand every role down and say nothing about
 * whose subscription ran out.
 */
const contour = (): { repo: string; delivered: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-account-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);

  const delivered = join(repo, "delivered.jsonl");
  const transport = join(repo, "stub-transport.mjs");
  writeFileSync(
    transport,
    [
      "import { appendFileSync } from 'node:fs';",
      "export const createTransport = () => ({",
      "  send: async (text) => {",
      `    appendFileSync(${JSON.stringify(delivered)}, JSON.stringify({ text }) + '\\n');`,
      "    return { state: 'sent', detail: 'stub' };",
      "  },",
      "});",
      "",
    ].join("\n"),
  );

  const config = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    mail: { branch: "comms", dir: "agent-comms" },
    orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
    notifications: { transport: { module: transport, options: { kind: "stub" } } },
    roles: [
      {
        id: "dev-core",
        kind: "claude-code",
        status: "active",
        wake: { mode: "watch", session: "s" },
        summary: "the stream",
        instructions: [{ kind: "in-repo", path: "CARD.md" }],
        launch: { allowedTools: ["Bash"], account: "main" },
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
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);
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
  const date = at(-40);
  writeFileSync(
    join(dir, "messages", `${date.replaceAll(":", "-")}-curator.md`),
    `---\nfrom: curator\ndate: ${date}\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe turn is yours.\n`,
  );
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, delivered };
};

const stateDir = (repo: string): string => join(repo, ".orchestrator");

/**
 * WHAT THIS MACHINE DECLARES ABOUT ITS ACCOUNTS — `local.json`, never the repository. A
 * named account the box knows nothing about is refused at the launch door by name, so
 * without this the rehearsal would measure that refusal instead of the closed window.
 */
const machineConfig = (repo: string): void => {
  const dir = join(configHome(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "local.json"),
    `${JSON.stringify(
      {
        agents: {},
        accounts: { main: { configDir: join(repo, "home-main"), kind: "claude-code" } },
      },
      null,
      2,
    )}\n`,
  );
};

/**
 * The box switched on, with a journal that either shelves the role's account or does not.
 * `until` is stated by the event, exactly as a vendor's `resetsAt` states it in the field —
 * the line the digest carries has a clock on it, and an invented one would be untestable.
 */
const box = (repo: string, shelved: boolean): void => {
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(join(stateDir(repo), "enabled"), "", "utf8");
  const events = shelved
    ? [
        {
          kind: "lease-released",
          ts: at(-30),
          role: "dev-core",
          thread: "016-other",
          reason: "quota-exhausted",
          account: "main",
          window: "5h",
          until: at(180),
        },
      ]
    : [
        {
          kind: "lease-released",
          ts: at(-30),
          role: "dev-core",
          thread: "016-other",
          reason: "completed",
        },
      ];
  writeFileSync(
    join(stateDir(repo), "journal.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
};

const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

/**
 * A REAL DAEMON, TICKING, stopped by its flag after it has had time for more than one tick.
 * Not `--once`: see the head of this file — one tick dials the courier before it measures
 * anything, so the class under test would be silent for a reason that is not a defect.
 */
const run = async (repo: string): Promise<string> => {
  const stopFlag = join(repo, "stop");
  const child = spawn(
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
      "--tick",
      "1",
      "--exec",
      stub(repo),
      "--poll",
      "1",
      "--stop-flag",
      stopFlag,
    ],
    { cwd: repo, stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  let said = "";
  child.stdout.on("data", (chunk) => {
    said += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    said += String(chunk);
  });
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  // Long enough for three dials of the courier; the stop is graceful, so the daemon finishes
  // the tick it is in and goes down by itself.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  writeFileSync(stopFlag, "", "utf8");
  const killed = setTimeout(() => child.kill("SIGKILL"), 20_000);
  await exited;
  clearTimeout(killed);
  return said;
};

/** Everything the transport was actually handed, in one string. */
const received = (delivered: string): string =>
  existsSync(delivered)
    ? readFileSync(delivered, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => (JSON.parse(line) as { text: string }).text)
        .join("\n")
    : "";

describe("the live rehearsal of the account class (thread 036, the remainder of §4)", () => {
  it("a shelved account: the digest john receives says the launches are held, and until when", {
    timeout: 120_000,
  }, async () => {
    const { repo, delivered } = contour();
    machineConfig(repo);
    box(repo, true);

    const said = await run(repo);

    // The operator's stream first — the daemon says it to itself every tick the fact holds.
    expect(said).toContain("account-failover: launches of dev-core are held until");
    // …and this is the joint, asked of the far side of the transport and not of a plan:
    // the sentence really left the box, in a message a human receives.
    expect(received(delivered)).toContain("launches of dev-core are held until");
    // The clock is on it — a line without one sends john to look for a defect that is a
    // window closing in three hours. The form is the describer's (`resumesAt`): a window
    // reopening today is an hour, and the digest is read by somebody who wants the hour.
    expect(received(delivered)).toMatch(/held until \d{2}:\d{2}Z/);
    // And the account that holds the chain, because "held" without it is a box-wide
    // standstill and this one is a subscription's.
    expect(received(delivered)).toContain("the first to reopen is account 'main'");
    // And the log of the daemon names the class it just sent (`announcedOf`, #146): the
    // reader of `daemon.log` and the reader of the digest are told the same thing happened.
    expect(said).toContain("dev-core (account: held)");
  });

  it("THE CONTROL — an open window says nothing about accounts at all", {
    timeout: 120_000,
  }, async () => {
    // Without this the test above passes on a box that announces a standstill every tick,
    // which is the noise the whole class was written to avoid.
    const { repo, delivered } = contour();
    machineConfig(repo);
    box(repo, false);

    const said = await run(repo);

    expect(said).not.toContain("account-failover:");
    expect(received(delivered)).not.toContain("account-failover");
    expect(received(delivered)).not.toContain("held until");
    // The control is only worth something if the box was otherwise alive and dialling: a
    // silence produced by a daemon that never reached its courier would prove nothing.
    expect(said).toContain("daemon — courier:");
  });
});
