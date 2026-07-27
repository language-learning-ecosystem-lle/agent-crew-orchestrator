import { describe, expect, it } from "vitest";

import { parseUsage, strayArguments } from "./orchestrator/argv.js";
import { USAGE } from "./usage.js";

/**
 * THE CORPUS OF CALLS THAT MUST KEEP WORKING (thread 019, the second verdict of
 * reviewer-pr).
 *
 * `argv.test.ts` proves the PARSER on a usage text written inside the test. That
 * says nothing about the text the CLI actually ships — and the guard turned that
 * text into a gate: `orchestrator status` and `orchestrator preflight` had been
 * reading flags their usage lines never mentioned, so switching the guard on made
 * calls that worked yesterday refuse today. Nothing failed, because nothing looked.
 *
 * So this file looks, and it looks at the REAL `USAGE`. What it cannot do is derive
 * the truth: `flag(argv, "--x")` is scattered through 4600 lines of `cli.ts` and no
 * static reading of it is trustworthy. What it can do is fix the ANSWER — a corpus
 * of invocations, each of which a human has checked against the handler once, and
 * which the suite then re-checks forever. When a usage line loses a flag the code
 * still reads, a line of this corpus goes red.
 *
 * The corpus is therefore a REGRESSION, not a specification: adding a flag to a
 * handler and to its usage line together is invisible here, and that is fine — the
 * class this closes is drift in the direction that refuses working calls.
 */
const MUST_BE_ACCEPTED: readonly (readonly [string, readonly string[]])[] = [
  // `status` reads the same answers the daemon reads, because it SHOWS what the
  // daemon would do: ceilings (`gatesFrom`), scope (`launchScopeFrom`), the mail
  // root (the instance digests) and the agent resolution (`agentFor`).
  [
    "orchestrator status",
    [
      "--ref",
      "origin/main",
      "--now",
      "2026-07-27T12:00:00Z",
      "--mode-file",
      "/tmp/mode",
      "--journal",
      "/tmp/journal.jsonl",
      "--holds",
      "/tmp/holds",
      "--enable-flag",
      "/tmp/enabled",
      "--local-config",
      "/tmp/local.json",
      "--max-attempts",
      "3",
      "--max-runs",
      "5",
      "--root",
      "/tmp/mail",
      "--roles",
      "dev-core",
      "--worker",
      "claude-code",
      "--exec",
      "claude",
      "--model",
      "opus",
      "--effort",
      "high",
      "--repo",
      "/tmp/repo",
    ],
  ],
  ["orchestrator status", ["--ref", "origin/main", "--exclude-roles", "dev-core"]],
  // T-0: the live frame reads the two flags, the pid file and the mail root, and
  // `--watch` redraws it — every one of them a flag `status` did not take before.
  [
    "orchestrator status",
    [
      "--ref",
      "origin/main",
      "--stop-flag",
      "/tmp/stop",
      "--force-flag",
      "/tmp/force",
      "--pid-file",
      "/tmp/daemon.pid",
      "--watch",
      "--interval",
      "2",
      "--frames",
      "1",
    ],
  ],
  // `preflight` resolves the agent per role, and that resolution spans model and
  // effort as much as it spans the binary.
  [
    "orchestrator preflight",
    [
      "--ref",
      "origin/main",
      "--repo",
      "/tmp/repo",
      "--exec",
      "claude",
      "--worker",
      "claude-code",
      "--model",
      "opus",
      "--effort",
      "high",
      "--local-config",
      "/tmp/local.json",
    ],
  ],
  [
    "orchestrator record",
    [
      "--ref",
      "origin/main",
      "--kind",
      "lease-released",
      "--role",
      "dev-core",
      "--thread",
      "019-operator-ux",
      "--deadline",
      "2026-07-27T17:00:00Z",
      "--reason",
      "supervisor-gone",
      "--mode",
      "watch",
      "--now",
      "2026-07-27T12:00:00Z",
      "--journal",
      "/tmp/journal.jsonl",
      "--write",
    ],
  ],
  [
    "orchestrator run",
    [
      "--ref",
      "origin/main",
      "--role",
      "dev-core",
      "--thread",
      "019-operator-ux",
      "--repo",
      "/tmp/repo",
      "--wall-clock",
      "3600",
      "--idle",
      "600",
      "--wait-input",
      "3600",
      "--wind-down",
      "720",
      "--poll",
      "10",
      "--max-turns",
      "200",
      "--max-runs",
      "5",
      "--max-attempts",
      "3",
      "--exec",
      "claude",
      "--worker",
      "claude-code",
      "--model",
      "opus",
      "--effort",
      "high",
      "--local-config",
      "/tmp/local.json",
      "--journal",
      "/tmp/journal.jsonl",
      "--root",
      "/tmp/mail",
      "--force-flag",
      "/tmp/force",
      "--now",
      "2026-07-27T12:00:00Z",
      "--roles",
      "dev-core",
      "--fresh",
      "--write",
      "-d",
    ],
  ],
  ["orchestrator run", ["--ref", "origin/main", "--exclude-roles", "curator", "--detach"]],
  [
    "orchestrator daemon",
    [
      "--ref",
      "origin/main",
      "--repo",
      "/tmp/repo",
      "--tick",
      "30",
      "--wall-clock",
      "3600",
      "--idle",
      "600",
      "--wait-input",
      "3600",
      "--wind-down",
      "720",
      "--poll",
      "10",
      "--max-turns",
      "200",
      "--max-runs",
      "5",
      "--max-attempts",
      "3",
      "--exec",
      "claude",
      "--worker",
      "claude-code",
      "--model",
      "opus",
      "--effort",
      "high",
      "--local-config",
      "/tmp/local.json",
      "--fresh",
      "--once",
      "--journal",
      "/tmp/journal.jsonl",
      "--root",
      "/tmp/mail",
      "--enable-flag",
      "/tmp/enabled",
      "--stop-flag",
      "/tmp/stop",
      "--force-flag",
      "/tmp/force",
      "--holds",
      "/tmp/holds",
      "--roles",
      "dev-core",
    ],
  ],
  ["orchestrator log", ["--ref", "origin/main", "--journal", "/tmp/journal.jsonl"]],
  ["orchestrator enable", ["--ref", "origin/main", "--repo", "/tmp/repo", "--write"]],
  ["orchestrator disable", ["--ref", "origin/main", "--repo", "/tmp/repo", "--write"]],
  [
    "orchestrator hold",
    [
      "--mode",
      "take",
      "--ref",
      "origin/main",
      "--role",
      "curator",
      "--by",
      "john",
      "--ttl",
      "3600",
      "--note",
      "acceptance",
      "--now",
      "2026-07-27T12:00:00Z",
      "--holds",
      "/tmp/holds",
      "--write",
    ],
  ],
  ["orchestrator hold", ["--mode", "release", "--ref", "origin/main", "--role", "curator"]],
  [
    "orchestrator stop",
    ["--mode", "graceful", "--ref", "origin/main", "--stop-flag", "/tmp/stop", "--write"],
  ],
  [
    "orchestrator stop",
    [
      "--mode",
      "force",
      "--ref",
      "origin/main",
      "--by",
      "john",
      "--reason",
      "wrong thread",
      "--thread",
      "019-operator-ux",
      "--repo",
      "/tmp/repo",
      "--force-flag",
      "/tmp/force",
      "--root",
      "/tmp/mail",
      "--write",
    ],
  ],
  [
    "orchestrator systemd-unit",
    [
      "--exec-start",
      "agent-protocol orchestrator daemon",
      "--working-dir",
      "/tmp/repo",
      "--description",
      "the circuit",
    ],
  ],
  // The operator's four. `hold`/`resume` take the role as a bare argument.
  ["orchestrator up", ["--daemon-log", "/tmp/daemon.log", "--pid-file", "/tmp/daemon.pid"]],
  ["orchestrator down", ["--stop-flag", "/tmp/stop", "--pid-file", "/tmp/daemon.pid"]],
  ["orchestrator hold", ["curator", "--by", "john", "--ttl", "3600", "--note", "acceptance"]],
  ["orchestrator resume", ["curator", "--holds", "/tmp/holds"]],
];

/** The same merge `guardArguments` performs: `up` is the daemon with its start-up done. */
const specFor = (key: string) => {
  const table = parseUsage(USAGE);
  const spec = table.get(key);
  if (spec === undefined) throw new Error(`'${key}' has no line in the shipped USAGE`);
  const daemon = table.get("orchestrator daemon");
  if (key !== "orchestrator up" || daemon === undefined) return spec;
  return {
    value: [...spec.value, ...daemon.value],
    boolean: [...spec.boolean, ...daemon.boolean],
    positionals: spec.positionals,
  };
};

describe("the shipped USAGE, read as the table of legal flags", () => {
  it.each(MUST_BE_ACCEPTED.map((entry, at) => [at, ...entry] as const))(
    "accepts corpus call %i: %s",
    (_at, key, argv) => {
      expect(strayArguments(argv, specFor(key))).toEqual([]);
    },
  );

  it("documents every orchestrator subcommand the CLI routes", () => {
    // Read off `main()` rather than listed here: a subcommand added without a usage
    // line is refused at the door by `guardArguments` — for its OWN name, which is
    // the least helpful refusal the package can produce.
    const routed = [
      "preflight",
      "enable",
      "disable",
      "status",
      "record",
      "run",
      "daemon",
      "hold",
      "resume",
      "log",
      "stop",
      "systemd-unit",
      "up",
      "down",
    ];
    const table = parseUsage(USAGE);
    expect(routed.filter((name) => !table.has(`orchestrator ${name}`))).toEqual([]);
  });

  it("lets `up` pass its own flags through to the daemon it starts", () => {
    // `up` re-executes itself as `orchestrator daemon <everything typed, minus its
    // own two flags>`. If the daemon refused a flag `up` accepts, the refusal would
    // land in the background log where nobody reads it.
    const up = parseUsage(USAGE).get("orchestrator up");
    const daemon = parseUsage(USAGE).get("orchestrator daemon");
    if (up === undefined || daemon === undefined) throw new Error("no line for up/daemon");
    const own = ["--daemon-log", "--pid-file"];
    const passed = up.value.filter((name) => !own.includes(name));
    expect(passed.filter((name) => !daemon.value.includes(name))).toEqual([]);
  });
});
