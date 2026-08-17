/**
 * `--instance` IS REACHABLE FROM THE CLI — the process test of the door (thread 055).
 *
 * THE DEFECT THIS FILE PINS, found in review of #196: the resolution of the instance was
 * built, unit-tested and correct (`config/local.test.ts`), and every `orchestrator`
 * command REFUSED the flag that reaches it. `guardArguments` reads its list of flags from
 * the usage text (`orchestrator/argv.ts` — the help IS the specification), and no usage
 * line had gained `[--instance <name>]`. Nothing caught it, because every new test called
 * `resolveLocalConfig` as a function and none of them typed the flag at a CLI.
 *
 * Its worst shape was self-refuting: `systemd install` GENERATED a unit whose `ExecStart`
 * carries `--instance <name>`, and `orchestrator up` — the command that `ExecStart` runs —
 * refused that very argv at the door. So the unit the package writes died on every start
 * with a usage error, before it read a config at all.
 *
 * Hence the shape of the test: the argv is not retyped here, it is TAKEN OUT of the unit
 * the CLI writes and run. A door that stops understanding what the generator writes fails
 * this file whatever the two sides are edited into.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { USAGE } from "../usage.js";
import { parseUsage } from "./argv.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const INSTANCE = "testinst";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  instances: [{ id: INSTANCE, roles: ["dev-core"] }],
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
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
    },
  ],
};

type Bench = { readonly repo: string; readonly home: string };

/**
 * A checkout with a named instance config beside it — the box of the statement: several
 * projects, one named machine config each, and no `local.json` at all.
 */
const bench = (): Bench => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-instance-flag-"));
  const repo = join(base, "work");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");

  const home = configHome(repo);
  const instances = join(home, "agent-protocol", "instances");
  mkdirSync(instances, { recursive: true });
  writeFileSync(
    join(instances, `${INSTANCE}.json`),
    `${JSON.stringify({ instance: INSTANCE, repo }, null, 2)}\n`,
  );
  return { repo, home };
};

const cli = (at: Bench, args: readonly string[]): { code: number; out: string } => {
  const result = spawnSync(TSX, [CLI, ...args], {
    cwd: at.repo,
    encoding: "utf8",
    stdio: "pipe",
    env: sandbox(at.home),
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

/** What the refusal at the door looks like — the string this whole file exists to keep out. */
const REFUSAL = "'--instance' — unknown flag";

describe("the flag that names the instance passes the CLI door (thread 055)", () => {
  // The third element is the GUARD of a case that would otherwise raise a daemon (see the
  // two comments below); typed so a case without one is still the ordinary pair.
  it.each<[string, readonly string[], "live-pid" | "collect" | undefined]>([
    ["orchestrator preflight", ["orchestrator", "preflight"], undefined],
    ["orchestrator status", ["orchestrator", "status"], undefined],
    [
      "orchestrator run",
      ["orchestrator", "run", "--role", "dev-core", "--thread", "016-x"],
      undefined,
    ],
    ["orchestrator daemon", ["orchestrator", "daemon", "--once"], undefined],
    // `up` BACKGROUNDS A DAEMON, and this case only ever wanted to knock on the door: run
    // bare it left a live daemon per run behind it, ticking against a temporary bench in
    // /tmp forever (46 of them were found alive on the developer's box on 2026-08-05,
    // hours old, from this line). It is given a pid file holding a pid that IS alive —
    // this process — so the already-up check, which is the FIRST thing `up` does, refuses
    // before anything is spawned or written. The same trick, for the same reason, is used
    // by the systemd case at the bottom of this file.
    ["orchestrator up", ["orchestrator", "up"], "live-pid"],
    // `restart` ends in phase 4, which is `up` — so it raises one too, and the live-pid
    // trick cannot be used on it: phase 1 is `down`, and a pid file naming THIS process
    // would have the command signal the test runner. So this one is COLLECTED instead —
    // the pid file is the bench's, and whatever was raised under it is stopped when the
    // case ends. (Measured with the line above: this was the second of the two leaks.)
    ["orchestrator restart", ["orchestrator", "restart"], "collect"],
    ["orchestrator systemd install", ["orchestrator", "systemd", "install"], undefined],
    ["orchestrator hold", ["orchestrator", "hold", "dev-core"], undefined],
    // NOT `orchestrator` commands, and that is the whole of the second review round: the
    // sentence "every command that resolves the machine config" was written while looking
    // at the `orchestrator` family, and these two read the same loader from outside it.
    ["config set", ["config", "set", "operator", "john"], undefined],
    ["init github", ["init", "github", "--no-probe"], undefined],
  ])("'%s' understands --instance", (_name, args, guard) => {
    // The commands do different work and some of them refuse for their own reasons here
    // (no daemon to restart, no mail on disk). What is pinned is the ONE answer none of
    // them may give: that the flag itself is not a word this command knows.
    const at = bench();
    // The one case that would otherwise RAISE something rather than answer: see above.
    const pidFile = join(at.repo, "live.pid");
    if (guard === "live-pid") writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    const held = guard === undefined ? [] : ["--pid-file", pidFile];
    const result = cli(at, [
      ...args,
      ...held,
      "--instance",
      INSTANCE,
      "--ref",
      "HEAD",
      "--no-fetch",
    ]);
    try {
      expect(result.out).not.toContain(REFUSAL);
      expect(result.out).not.toContain("does not understand what it was given");
      // And the guard is not decoration: the refusal it produces is the proof that the
      // command got past parsing WITHOUT raising a daemon this test would never collect.
      if (guard === "live-pid") expect(result.out).toContain("a daemon is already up");
    } finally {
      // In `finally` because a failed assertion must not turn one red case into a leak
      // that outlives the run — the way to notice this class is a box, hours later.
      if (guard === "collect" && existsSync(pidFile)) {
        const raised = Number(readFileSync(pidFile, "utf8").trim());
        if (Number.isInteger(raised) && raised > 0) {
          try {
            process.kill(raised, "SIGKILL");
          } catch {
            // Already gone: the command may have refused for a reason of its own, which
            // is fine — this case pins the door, not the raising.
          }
        }
      }
    }
  });

  it("`preflight` names the instance and the layer that answered", () => {
    const at = bench();
    const result = cli(at, ["orchestrator", "preflight", "--ref", "HEAD", "--no-fetch"]);
    // No flag, no env: the checkout claimed itself, and the line says so.
    expect(result.out).toContain(`instance '${INSTANCE}'`);
    expect(result.out).toContain("[checkout]");
  });

  it("`doctor` prints the layer too, as its README says it does", () => {
    // The second finding of the review: `doctor` showed WHICH FILE and not WHICH LAYER,
    // while the README promised the layer in both commands. On a box hosting two projects
    // the paths differ in one segment, so the layer is the half that answers the question.
    const at = bench();
    const result = cli(at, ["doctor", "--offline", "--ref", "HEAD", "--no-fetch"]);
    expect(result.out).toContain("config: machine");
    expect(result.out).toContain("[checkout]");
    const flagged = cli(at, [
      "doctor",
      "--offline",
      "--instance",
      INSTANCE,
      "--ref",
      "HEAD",
      "--no-fetch",
    ]);
    expect(flagged.out).toContain("[flag]");
  });
});

/**
 * WHERE THE LIST COMES FROM (the second review round of #196).
 *
 * The first round was fixed by typing eight commands onto eight usage lines by hand, and
 * the round after it found two more the hand had not visited — `config set` and `init
 * github`, which read the same loader from outside the `orchestrator` family. A list kept
 * by hand drifts once per author, so this test stops keeping one: it walks the CALL SITES
 * of `localFrom` in `cli.ts` — the single function that resolves the machine config from
 * argv — and asks the usage text about each handler's command.
 *
 * The map below is the only hand-written part, and it is checked from both ends: a new
 * call site in a handler nobody listed fails here by name, so the sentence in the README
 * cannot outlive the code that made it true.
 */
const HANDLER_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  runNotify: ["notify"],
  boxInit: ["init"],
  initGithub: ["init github"],
  configSet: ["config set"],
  doctor: ["doctor"],
  orchestratorPreflight: ["orchestrator preflight"],
  operatorFrame: ["orchestrator status", "orchestrator tui"],
  orchestratorStatus: ["orchestrator status"],
  orchestratorSystemdInstall: ["orchestrator systemd install"],
  orchestratorRun: ["orchestrator run"],
  orchestratorDaemon: ["orchestrator daemon"],
  // Called from two handlers, not one: `orchestratorRestart` (`--mode force`) and
  // `orchestratorHold`. The structural check compares handler NAMES, so an
  // under-declared entry does not redden it — the map still claims to state
  // "handler → its commands", and for this one it was incomplete.
  operatorSignature: ["orchestrator hold", "orchestrator restart"],
};

/** Every top-level handler in `cli.ts` that resolves the machine config out of argv. */
const handlersReadingTheMachineConfig = (): readonly string[] => {
  const source = readFileSync(CLI, "utf8").split("\n");
  const found = new Set<string>();
  let handler: string | undefined;
  for (const line of source) {
    const declared = line.match(/^const (\w+) =/);
    if (declared?.[1] !== undefined) handler = declared[1];
    if (line.includes("localFrom(") && !line.startsWith("const localFrom") && handler !== undefined)
      found.add(handler);
  }
  return [...found].sort();
};

describe("the list of commands that take --instance is read off the code (thread 055)", () => {
  it("every handler that resolves the machine config is accounted for", () => {
    expect(handlersReadingTheMachineConfig()).toEqual(Object.keys(HANDLER_COMMANDS).sort());
  });

  it("and every command of those handlers spells the flag on its usage line", () => {
    const flags = parseUsage(USAGE);
    const missing = [...new Set(Object.values(HANDLER_COMMANDS).flat())].filter(
      (command) => !(flags.get(command)?.value ?? []).includes("--instance"),
    );
    expect(missing).toEqual([]);
  });
});

describe("the unit the package writes is a command the package understands", () => {
  it("the generated `ExecStart` runs — it is not refused at the door it was written for", () => {
    const at = bench();
    const install = cli(at, [
      "orchestrator",
      "systemd",
      "install",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--unit-dir",
      join(at.repo, "units"),
      "--write",
    ]);
    expect(install.code).toBe(0);

    const unitPath = join(at.repo, "units", `agent-protocol@${INSTANCE}.service`);
    const unit = readFileSync(unitPath, "utf8");
    const execStart = (unit.match(/^ExecStart=(.*)$/m) ?? [])[1];
    expect(execStart).toBeDefined();
    expect(execStart).toContain(`--instance ${INSTANCE}`);

    // THE ARGV IS THE UNIT'S OWN, not a retyped copy of it. It is run against a pid file
    // holding a pid that IS alive (this test's), so `up` refuses for the one reason that
    // proves it got past parsing — and nothing of the box is touched: the already-up check
    // is the first thing `up` does, before any flag file is written.
    const pidFile = join(at.repo, "live.pid");
    writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    const raised = spawnSync(
      "/bin/sh",
      ["-c", `${execStart as string} --no-fetch --pid-file ${pidFile}`],
      { cwd: at.repo, encoding: "utf8", stdio: "pipe", env: sandbox(at.home) },
    );
    const said = `${raised.stdout ?? ""}${raised.stderr ?? ""}`;
    expect(said).not.toContain(REFUSAL);
    expect(said).toContain("a daemon is already up");
  });
});
