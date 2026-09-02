/**
 * THE SEVENTH DELIVERY — the trace of a FORCE STOP, as a real process pushing into a real
 * remote through a real `git`.
 *
 * Thread `065` gave every child call the credentials of its own circuit by putting them
 * into `gitIn`, the one git of a delivery. Six of the seven `deliverMessage` call sites in
 * the CLI use it; the seventh, inside `orchestrator stop --mode force`, carried an INLINE
 * COPY of the old form — same shape, no `env` — and so kept pushing with whatever
 * environment the process happened to start in. Found by review of #164; nothing tested
 * this path before, which is why a copy could go stale in silence.
 *
 * The copy dropped TWO environments, not one, because `GitRun` carries both:
 *
 *  · the credential of the circuit, so a force stop announced from a clean environment
 *    (john's console — case 3 of the statement of work) met `Username for
 *    'https://github.com'` on a push nobody was watching;
 *  · the SECOND ARGUMENT — the identity of the commit. `deliverMessage` signs the trace
 *    with the role that forced the stop (thread 027: a force is somebody's decision and
 *    the commit says whose); the inline callback took `(args)` and threw the identity
 *    away, so the one commit that must name a person was signed by whatever `user.email`
 *    the box happened to carry — and on a runner that carries none, not at all.
 *
 * So this file tests the wiring, not the verdict: a stub `git` first on `PATH` that
 * refuses to push without the token of THIS circuit and otherwise hands the call to the
 * real git. What it records is what a credential-carrying environment looks like from the
 * far side of the seam — NAMES ONLY, never a value.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

/** The token of THIS circuit, as the secrets file of THIS circuit carries it. */
const SECRET = "ghp_force_stop_test_only_0987654321";

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
  ],
};

const META = "---\ntitle: T\nparticipants: john, dev-core\nstatus: open\n---\n";

/** The real git, resolved BEFORE the stub shadows the name — otherwise the stub execs itself. */
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

type Contour = {
  readonly repo: string;
  readonly root: string;
  readonly remote: string;
  readonly bin: string;
  readonly witness: string;
  readonly forceFlag: string;
};

/**
 * A bare remote, a mail checkout with one thread, a machine config naming a secrets file
 * — and a `git` on `PATH` that stands between the command and the real one.
 *
 * THE STUB REFUSES ONLY `push`, and that is the shape of the truth: reading and committing
 * need no credential, reaching the remote does. `secrets: { write: false }` builds the same
 * circuit with the file the config names ABSENT.
 */
const contour = (secrets: { write: boolean }): Contour => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-force-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-force-mail-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const thread = join(repo, "agent-comms", "065-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  // ONE MESSAGE ALREADY IN THE FEED, so `messages/` is a TRACKED directory: git keeps no
  // empty ones, and the undo of a rejected push (`reset --hard`) would leave the thread
  // looking like the legacy form to the replan of the next attempt.
  writeFileSync(
    join(thread, "messages", "2026-08-30T00-00-00Z-dev-core.md"),
    "---\nfrom: dev-core\ndate: 2026-08-30T00:00:00Z\nexpects: answer\nwaiting-on: john\n---\n\nfirst\n",
  );
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  git(repo, "push", "-q", "origin", "comms");

  const home = join(configHome(repo), "agent-protocol");
  mkdirSync(home, { recursive: true });
  // OUTSIDE THE CHECKOUT, deliberately: a file inside it is untracked dirt, and delivery
  // refuses to touch a dirty mail checkout at all.
  const envFile = join(mkdtempSync(join(tmpdir(), "agent-protocol-force-secrets-")), "secrets.env");
  writeFileSync(
    join(home, "local.json"),
    `${JSON.stringify({ agents: {}, secrets: { envFile } }, null, 2)}\n`,
    "utf8",
  );
  if (secrets.write) writeFileSync(envFile, `GH_TOKEN=${SECRET}\n`, "utf8");

  // The stub writes down WHICH NAMES the push was given, never their values, and then
  // does the push for real so the rest of the delivery is not simulated away.
  const bin = mkdtempSync(join(tmpdir(), "agent-protocol-force-bin-"));
  const witness = join(bin, "push-env.txt");
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'for a in "$@"; do',
      '  if [ "$a" = push ]; then',
      `    if [ "$GH_TOKEN" != ${JSON.stringify(SECRET)} ]; then`,
      "      echo \"git: could not read Username for 'https://github.com': terminal prompts disabled\" >&2",
      "      exit 128",
      "    fi",
      `    { echo "helper=$GIT_CONFIG_KEY_0"; echo "prompt=$GIT_TERMINAL_PROMPT"; } >> ${JSON.stringify(witness)}`,
      "  fi",
      "done",
      `exec ${JSON.stringify(REAL_GIT)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(join(bin, "git"), 0o755);

  return {
    repo,
    root: join(repo, "agent-comms"),
    remote,
    bin,
    witness,
    forceFlag: join(mkdtempSync(join(tmpdir(), "agent-protocol-force-flag-")), "force"),
  };
};

/** The force stop, run from a CLEAN environment: no `GH_TOKEN`, no login of `gh`. */
const forceStop = (contest: Contour): { code: number; out: string } => {
  const {
    GH_TOKEN: _mine,
    GITHUB_TOKEN: _theirs,
    ...clean
  } = sandbox(configHome(contest.repo), {
    PATH: `${contest.bin}${delimiter}${process.env.PATH ?? ""}`,
  });
  const argv = [
    CLI,
    "orchestrator",
    "stop",
    "--mode",
    "force",
    "--ref",
    "HEAD",
    "--no-fetch",
    "--root",
    contest.root,
    "--thread",
    "065-x",
    "--by",
    "john",
    "--reason",
    "the box is on fire",
    "--force-flag",
    contest.forceFlag,
    "--write",
  ];
  // BOTH STREAMS, always: the one line this command is judged by — a delivery that broke
  // — is written to stderr, and a capture of stdout alone would read a broken force stop
  // as a silent one.
  const done = spawnSync(TSX, argv, { encoding: "utf8", env: clean });
  return { code: done.status ?? -1, out: `${done.stdout ?? ""}${done.stderr ?? ""}` };
};

describe("the trace of a force stop is pushed with the credentials of its own circuit", () => {
  it("the config names the file → the token reaches the child `git`, from a clean environment", () => {
    const contest = contour({ write: true });
    const result = forceStop(contest);

    expect(result.out).toContain("committed and pushed to origin/comms");
    expect(result.code).toBe(0);

    // The far side of the seam saw a credential-carrying environment: the helper for
    // github.com, and prompts off — which is what turns a hang into a failure.
    const seen = readFileSync(contest.witness, "utf8");
    expect(seen).toContain("helper=credential.https://github.com.helper");
    expect(seen).toContain("prompt=0");
    // NAMES TRAVEL, VALUES DO NOT — not into the output of the command, not into anything
    // the child could print.
    expect(result.out).not.toContain(SECRET);
    expect(seen).not.toContain(SECRET);

    // And the message really is in the feed of the remote, not merely announced.
    const landed = execFileSync(
      "git",
      ["-C", contest.remote, "log", "-1", "--format=%an <%ae>%n%s"],
      {
        encoding: "utf8",
      },
    );
    // THE SECOND ENVIRONMENT THE INLINE COPY DROPPED: `deliverMessage` hands the identity
    // of the forcing role to the commit through the same `GitRun`, so a callback that
    // ignores its second argument signs the one commit that must name a person with the
    // box's own `user.email` — or, on a runner that has none, fails outright.
    expect(landed).toContain("john <john@agents.invalid>");
  });

  it("the file the config names is not there → the refusal names the push, not a prompt", () => {
    const contest = contour({ write: false });
    const result = forceStop(contest);

    // A STOP THAT CANNOT BE ANNOUNCED STILL HAPPENS (thread 019): the flag is created and
    // the broken delivery is said out loud rather than swallowed.
    expect(result.out).toContain("the trace was NOT delivered");
    expect(result.out).toContain("git push");
    expect(result.out).not.toContain(SECRET);
  });
});
