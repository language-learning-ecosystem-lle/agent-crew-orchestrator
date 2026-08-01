import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseUsage, strayArguments } from "./orchestrator/argv.js";
import { argvOf, type TuiAction } from "./orchestrator/tui.js";
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
  // `config set` takes TWO bare words (the key and its value) — the shape `agent <kind>`
  // needs, and the one thing about this line the guard could get wrong silently.
  [
    "config set",
    [
      "instance",
      "lle-agents",
      "--ref",
      "origin/main",
      "--local-config",
      "/tmp/local.json",
      "--write",
    ],
  ],
  ["config set", ["agent", "claude-code", "--exec", "/usr/local/bin/claude"]],
  // `init github` is the one TWO-WORD form of `init`, and the guard is keyed on both
  // words: keyed on the first alone it would look up `init`'s line and refuse --key.
  [
    "init github",
    [
      "--ref",
      "origin/main",
      "--local-config",
      "/tmp/local.json",
      "--key",
      "/home/a/.ssh/github",
      "--host",
      "github.com",
      "--comment",
      "lle-agents",
      "--no-probe",
      "--write",
    ],
  ],
];

/**
 * USAGE cut into the passages a reader actually reads: one per command block of the
 * table (the line plus its `#` continuation), one per bullet of the `--write` list.
 *
 * A claim about a command is repeated in as many passages as name it, and a fix
 * applied to one of them is exactly how the other goes stale — which is what happened
 * to `init` (rounds 7 and 8 of thread 019). Holding the passages instead of grepping
 * the whole text lets a guard say WHICH place lies, and makes a fourth mention inherit
 * the check instead of escaping it.
 */
const passagesOf = (
  usage: string,
): readonly { readonly where: string; readonly text: string }[] => {
  const passages: { where: string; text: string }[] = [];
  let current: { where: string; text: string } | undefined;
  for (const line of usage.split("\n")) {
    const command = /^ {2}agent-protocol (\S+(?: [a-z-]+)?)/.exec(line);
    const bullet = /^ {2}· '([^']+)'/.exec(line);
    if (command?.[1] !== undefined) {
      current = { where: `command '${command[1]}'`, text: line };
      passages.push(current);
    } else if (bullet?.[1] !== undefined) {
      current = { where: `--write list: '${bullet[1]}'`, text: line };
      passages.push(current);
    } else if (line.trim() === "") current = undefined;
    else if (current !== undefined) current.text += `\n${line}`;
  }
  return passages;
};

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

  it("names every handler that reads `--write` in the list of what `--write` does", () => {
    // THE LIST IS A FACT, NOT AN IMPRESSION (thread 033, the second verdict of
    // reviewer-pr): the list shipped in `USAGE` missed `orchestrator run`, and its
    // own wording — "everything else writes and stops" — reads as exhaustive. A
    // reader who trusts it types `--write` on the one command where the word means
    // "raise a session", not "write a file".
    //
    // Derived from the SOURCE, unlike the corpus above, because here it can be: the
    // handlers are top-level `const <name> = (argv` declarations and `--write` is
    // read by its literal name. An unknown handler fails the map, which is the point
    // — a new `--write` cannot be added without a line saying what it costs.
    const source = readFileSync(new URL("./cli.ts", import.meta.url), "utf8").split("\n");
    let declaration = "";
    const reading = new Set<string>();
    for (const line of source) {
      const declared = /^const ([a-zA-Z]+) = /.exec(line);
      if (declared?.[1] !== undefined) declaration = declared[1];
      if (line.includes('"--write"') && declaration !== "") reading.add(declaration);
    }
    // handler → what the list must say its name in. `enable`/`disable` and the two
    // modes of `hold`/`stop` share a handler and a line, so the token is the shared
    // half of the name.
    const named: Readonly<Record<string, string>> = {
      schemaMigrate: "'schema migrate'",
      indexBuild: "'index build'",
      threadBuild: "'thread build'",
      migrate: "'migrate'",
      derive: "'derive'",
      newMessage: "'new-message'",
      newThread: "'new-thread'",
      notify: "'notify'",
      orchestratorEnable: "enable/disable",
      orchestratorRecord: "record",
      orchestratorRun: "'orchestrator run'",
      orchestratorStop: "stop",
      orchestratorHold: "hold",
      // The operator's short forms do not READ the word, they supply it: typing
      // `hold <role>` IS the decision (thread 019). Same command, same line.
      orchestratorHoldShort: "hold",
      orchestratorResumeShort: "hold",
      // `restart --mode force` supplies the word to the force stop it performs
      // (thread 019, #113) — the same relationship the short forms have, and the
      // same line: what it costs is what 'stop' costs.
      orchestratorRestart: "stop",
      // `systemd install --write` writes the unit FILE of this box and stops — the
      // enabling is printed for a human. Its own line in the list, because its reason
      // is its own: not "nothing to deliver yet" but "the delivery is somebody else's".
      orchestratorSystemdInstall: "'orchestrator systemd install'",
      // `init --write` commissions THIS BOX: the machine config and the mail worktree,
      // both machine-local — the word means "do it", as it does for 'orchestrator run'.
      boxInit: "'init'",
      // `config set --write` writes ONE key of the same machine-local file `init`
      // writes; without it the change is decided, judged and printed and the file is
      // not opened for writing at all.
      configSet: "'config set'",
      // `init github --write` makes the box's identity on disk — outside git and
      // outside both configs, which is why it is machine-local; the grant it does NOT
      // make is the reason the bullet exists rather than sharing `init`'s.
      initGithub: "'init github'",
    };
    expect([...reading].filter((name) => named[name] === undefined)).toEqual([]);
    // Bounded at the next section: past it, tokens like "record" or "hold" match the
    // command lines themselves and the check would pass on any text at all.
    const from = USAGE.indexOf("WHICH '--write' DELIVERS");
    const list = USAGE.slice(from, USAGE.indexOf("\nORCHESTRATOR:", from));
    expect([...reading].filter((name) => !list.includes(named[name] as string))).toEqual([]);
  });

  it("says the fetch, and never 'touches nothing', in EVERY passage about `init`", () => {
    // THE SAME SENTENCE IN A THIRD PLACE (thread 019, the verdicts of rounds 7 and 8).
    // `init` without --write does one real thing on a box with no mail checkout yet: it
    // fetches the mail branch to read whether the instance id is already taken, moving
    // `origin/<branch>` on disk. Round 7 corrected the summary line and the command's
    // own block; the bullet of the `--write` list — same file, same constant, same
    // printed help — kept promising a plan that "touches nothing", and it took another
    // round of review to see it. A claim living in three passages drifts in the two
    // nobody is looking at; here the machine holds all of them at once.
    //
    // Both halves are asserted, because the negative one alone is satisfied by silence:
    // a passage that says nothing about the read is not honest, it is merely quiet.
    const naming = passagesOf(USAGE).filter((passage) => passage.where.includes("'init'"));
    // The passages themselves are pinned: a renamed block must fail here loudly rather
    // than shrink the guard to nothing while staying green.
    expect(naming.map((passage) => passage.where).sort()).toEqual([
      "--write list: 'init'",
      "command 'init'",
    ]);
    for (const passage of naming) {
      expect([
        passage.where,
        /touch(es|ed) nothing|nothing was touched/.test(passage.text),
      ]).toEqual([passage.where, false]);
      expect([passage.where, /FETCHES|fetch/.test(passage.text)]).toEqual([passage.where, true]);
    }
  });

  it("names in the header every top-level command whose --ref is optional", () => {
    // THE SENTENCE IS A CLAIM ABOUT THE TABLE UNDER IT, and it went false twice by the
    // same move: a command was given the operator's ref resolution and the sentence that
    // enumerates such commands was left alone ('init', round 6 of thread 019). The list
    // is derived from the table — a bracketed `[--ref <ref>]` IS the optionality.
    //
    // TOP-LEVEL ONLY. The `orchestrator …` lines are covered by the prose paragraph
    // ("the operator's five"), which already understates its own table (`restart`, `tui`
    // and `systemd install` resolve the ref too) — that is a pre-existing inaccuracy of
    // the prose and not this guard's business; widening the guard would turn it into a
    // red test about text nobody is editing.
    const optional = [...USAGE.matchAll(/^ {2}agent-protocol (\S+) +\[--ref <ref>\]/gm)]
      .map((one) => one[1] as string)
      .filter((name) => name !== "orchestrator");
    expect(optional.length).toBeGreaterThan(1);
    const header = USAGE.slice(0, USAGE.indexOf("\n"));
    expect(optional.filter((name) => !header.includes(`'${name}'`))).toEqual([]);
  });

  it("accepts every command the TUI's mutating keys can produce (T-2)", () => {
    // The keys run their command as a CHILD of this CLI, so the child meets the same
    // door as a typed call — and a flag the observer inherits but the target's usage
    // line does not declare would be refused in a window the operator is watching, with
    // the refusal blamed on the key. This is the corpus above, computed rather than
    // listed: the inheritance lists live in `tui.ts` and drift from here otherwise.
    const observing = [
      "--ref",
      "origin/main",
      "--now",
      "2026-07-31T09:00:00Z",
      "--holds",
      "/tmp/holds",
      "--local-config",
      "/tmp/local.json",
      "--stop-flag",
      "/tmp/stop",
      "--pid-file",
      "/tmp/daemon.pid",
      "--interval",
      "2",
    ];
    const actions: readonly TuiAction[] = [
      { kind: "hold", role: "curator" },
      { kind: "resume", role: "curator" },
      { kind: "down" },
      { kind: "up" },
    ];
    for (const action of actions) {
      const words = argvOf(action, observing);
      const key = `${words[0]} ${words[1]}`;
      expect([key, strayArguments(words.slice(2), specFor(key))]).toEqual([key, []]);
    }
  });

  it("lets `up` pass its own flags through to the daemon it starts", () => {
    // `up` re-executes itself as `orchestrator daemon <everything typed, minus its
    // own two flags>`. If the daemon refused a flag `up` accepts, the refusal would
    // land in the background log where nobody reads it.
    const up = parseUsage(USAGE).get("orchestrator up");
    const daemon = parseUsage(USAGE).get("orchestrator daemon");
    if (up === undefined || daemon === undefined) throw new Error("no line for up/daemon");
    // `--clear-force` is `up`'s own in the same sense: it is a decision taken at the
    // door, and the daemon behind it knows nothing of the flag (see the passthrough
    // filter in `orchestratorUp`).
    // `--log-max-bytes` is `up`'s own for the same reason as `--daemon-log`: the bound
    // belongs to the file the command opens, and the daemon knows nothing about it.
    const own = ["--daemon-log", "--log-max-bytes", "--pid-file", "--clear-force", "--foreground"];
    const passed = up.value.filter((name) => !own.includes(name));
    expect(passed.filter((name) => !daemon.value.includes(name))).toEqual([]);
  });
});
