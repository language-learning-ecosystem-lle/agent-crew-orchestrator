/**
 * THE DOOR THAT LETS A FROZEN PAIR GO (thread `150-no-way-to-thaw-an-exhausted-pair`).
 *
 * WHY A PROCESS TEST. What was missing on 2026-09-06 was not a fold — the fold was right and
 * is unit-tested — but a COMMAND: `orchestrator --help` had no word about a reset, and the
 * hand-typed `run` was refused by the very ceiling it was typed against. A defect of that
 * shape lives entirely in the argv door: the flags, the refusals and the line printed back.
 * Units of `foldLeases` cannot see any of it.
 *
 * THE FIXTURE IS A JOURNAL AND NOTHING ELSE, deliberately. The command takes `--journal`, so
 * it never reads the config, the mail or the box — which is itself part of what is being
 * asserted: the way out of a freeze must not depend on the machinery that is already stuck.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { USAGE } from "../usage.js";
import { parseUsage } from "./argv.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

/** A pair's failed round: taken, and released without the turn passing on. */
const round = (at: string): readonly Record<string, unknown>[] => [
  {
    kind: "lease-acquired",
    ts: `${at}:00Z`,
    role: "devops",
    thread: "079-stuck",
    deadline: `${at}:30Z`,
  },
  {
    kind: "lease-released",
    ts: `${at}:10Z`,
    role: "devops",
    thread: "079-stuck",
    reason: "exited-without-handoff",
  },
];

/** The events of the fixture: `devops×079-stuck` at the ceiling, and one healthy neighbour. */
const events = (): string =>
  `${[
    ...round("2026-09-06T05:00"),
    ...round("2026-09-06T05:10"),
    ...round("2026-09-06T05:20"),
    // The neighbour that is NOT frozen — what the negative case below is typed against.
    {
      kind: "lease-acquired",
      ts: "2026-09-06T06:00:00Z",
      role: "curator",
      thread: "150-thaw",
      deadline: "2026-09-06T06:30:00Z",
    },
    {
      kind: "handoff-detected",
      ts: "2026-09-06T06:10:00Z",
      role: "curator",
      thread: "150-thaw",
    },
    {
      kind: "lease-released",
      ts: "2026-09-06T06:10:01Z",
      role: "curator",
      thread: "150-thaw",
      reason: "completed",
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")}\n`;

/** A bare journal on disk, with nothing around it — the stand of the cases that name `--journal`. */
const journal = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-thaw-"));
  const path = join(base, "journal.jsonl");
  writeFileSync(path, events());
  return path;
};

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  roles: [
    {
      id: "devops",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

/**
 * A CONTOUR WHOSE CONFIG SAYS WHERE THIS BOX KEEPS ITS STATE — the stand of the cases
 * that type the ANNOUNCED form, with no path in it (thread 150).
 *
 * The journal is written where the config declares it and NOWHERE ELSE, which is the whole
 * point: a case that also passed the path would prove that a string reached the command,
 * not that the command found the file the daemon writes.
 *
 * `orchestrator.ref` is `HEAD`, so the read touches no remote (`fetchRef` refreshes only
 * `origin/…`) — the same shape `daemon.process.test.ts` runs its whole contour at.
 */
const contour = (): { readonly repo: string; readonly journal: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-thaw-contour-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "config",
  ]);
  const path = join(repo, ".orchestrator", "journal.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events());
  return { repo, journal: path };
};

const NOW = "2026-09-06T07:00:00Z";

const cli = (
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
  cwd?: string,
): { status: number; out: string } => {
  // THE VARIABLE IS SCRUBBED BY DEFAULT, and the first run of this file is why: the suite
  // itself was started by a raised session, so `AGENT_PROTOCOL_WORKER` was inherited and
  // EVERY case got the session refusal. The door works; the harness had to stop being a
  // session for the other cases to be about anything.
  const { AGENT_PROTOCOL_WORKER: _worker, ...clean } = process.env;
  const result = spawnSync(TSX, [CLI, "orchestrator", "thaw", ...args], {
    encoding: "utf8",
    env: { ...clean, ...env },
    ...(cwd === undefined ? {} : { cwd }),
  });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
};

/** Whether a thaw has been written into this journal at all. */
const thawed = (path: string): boolean => readFileSync(path, "utf8").includes('"kind":"thaw"');

describe("orchestrator thaw — the way out of the attempt ceiling", () => {
  it("thaws a frozen pair, and the event names the hand and the reason", () => {
    const path = journal();
    expect(thawed(path)).toBe(false);
    const dry = cli([
      "--role",
      "devops",
      "--thread",
      "079-stuck",
      "--by",
      "john",
      "--journal",
      path,
      "--now",
      NOW,
    ]);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain("would thaw devops×079-stuck");
    expect(dry.out).toContain("--write performs it");
    // A DRY RUN WROTE NOTHING — the flag means the same here as everywhere else.
    expect(thawed(path)).toBe(false);

    const done = cli([
      "--role",
      "devops",
      "--thread",
      "079-stuck",
      "--by",
      "john",
      "--note",
      "the credential is fixed",
      "--journal",
      path,
      "--now",
      NOW,
      "--write",
    ]);
    expect(done.status).toBe(0);
    expect(done.out).toContain("was thawed by john");
    expect(done.out).toContain("0/3");
    // AND IT SAYS IT RAISED NOTHING, because that is the difference from `run --max-attempts`
    // and the one thing an operator would otherwise have to guess at.
    expect(done.out).toContain("nothing was launched here");

    const written = readFileSync(path, "utf8").trim().split("\n").at(-1) as string;
    expect(JSON.parse(written)).toMatchObject({
      kind: "thaw",
      role: "devops",
      thread: "079-stuck",
      by: "john",
      note: "the credential is fixed",
      ts: "2026-09-06T07:00:00Z",
    });
    // The history reads the event back — who let the pair go is answerable afterwards.
    const log = execFileSync(TSX, [CLI, "orchestrator", "log", "--journal", path], {
      encoding: "utf8",
    });
    expect(log).toContain("devops/079-stuck  thaw (by john: the credential is fixed)");
  });

  it("a pair that is NOT frozen is refused by name, with its count and its state", () => {
    const path = journal();
    const refused = cli([
      "--role",
      "curator",
      "--thread",
      "150-thaw",
      "--by",
      "john",
      "--journal",
      path,
      "--now",
      NOW,
      "--write",
    ]);
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("curator×150-thaw is not frozen");
    expect(refused.out).toContain("0/3 attempts");
    expect(refused.out).toContain("state 'released'");
    expect(readFileSync(path, "utf8")).not.toContain('"thaw"');
  });

  it("an unknown pair is refused by name rather than thawed into existence", () => {
    const path = journal();
    const refused = cli([
      "--role",
      "devops",
      "--thread",
      "079",
      "--by",
      "john",
      "--journal",
      path,
      "--now",
      NOW,
      "--write",
    ]);
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("devops×079 — this journal has no such pair");
    expect(refused.out).toContain("<NNN>-<slug>");
  });

  it("a raised session may not thaw: the refusal names the variable and says whose move it is", () => {
    const path = journal();
    const refused = cli(
      [
        "--role",
        "devops",
        "--thread",
        "079-stuck",
        "--by",
        "devops",
        "--journal",
        path,
        "--now",
        NOW,
        "--write",
      ],
      { AGENT_PROTOCOL_WORKER: "claude-code" },
    );
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("a raised session may not thaw a pair");
    expect(refused.out).toContain("AGENT_PROTOCOL_WORKER");
    expect(refused.out).toContain("the thaw is a person's move");
    expect(readFileSync(path, "utf8")).not.toContain('"thaw"');
  });

  it("the hand is required: `--by` missing is a refusal by name, not an anonymous thaw", () => {
    const path = journal();
    const refused = cli([
      "--role",
      "devops",
      "--thread",
      "079-stuck",
      "--journal",
      path,
      "--now",
      NOW,
      "--write",
    ]);
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("--by is not set");
    expect(refused.out).toContain("usage: orchestrator thaw");
  });

  /**
   * THE ANNOUNCED FORM, TYPED AS PRINTED (thread 150, the finding of msg-014 and the
   * statement of msg-019).
   *
   * Three places print this call and none of them prints a path: the tick's skip line, the
   * notifier's freeze letter and the stall line of `status`. As shipped in #306 that form
   * refused — `--journal` fell back to `pathsFrom`, which reads the config, which demands
   * `--ref`, which was in no line of this command's usage. The operator typing what they
   * were shown got `--ref is not set` and, on adding it, `'--ref' — unknown flag`: a closed
   * circle at the command whose whole reason is to be the way out of one.
   *
   * WHAT MAKES THIS THE STRONG SHAPE rather than the one the test PR had to settle for: no
   * path is handed in, so a pass means the command RESOLVED the file the daemon of this
   * contour writes — the same reading, out of the same config, at the same ref.
   */
  it("without `--journal` the path comes out of the config, at the operator's ref (150)", () => {
    const box = contour();
    expect(thawed(box.journal)).toBe(false);
    const done = cli(
      ["--role", "devops", "--thread", "079-stuck", "--by", "john", "--now", NOW, "--write"],
      sandbox(configHome(box.repo)),
      box.repo,
    );
    expect(done.status).toBe(0);
    expect(done.out).toContain("devops×079-stuck was thawed by john");
    // The bootstrap is PRINTED, as it is for `up`/`down`/`hold`: a default nobody sees is
    // a default nobody knows about.
    expect(done.out).toContain("--ref HEAD");
    expect(done.out).toContain("orchestrator.ref");
    // AND THE EVENT IS IN THE FILE THE CONFIG DECLARES — `.orchestrator/journal.jsonl` of
    // this contour, which nothing in the argv named.
    expect(thawed(box.journal)).toBe(true);
  });

  it("`--ref` is a flag this command accepts, and it decides which config is read (150)", () => {
    const box = contour();
    const done = cli(
      [
        "--role",
        "devops",
        "--thread",
        "079-stuck",
        "--by",
        "john",
        "--ref",
        "HEAD",
        "--now",
        NOW,
        "--write",
      ],
      sandbox(configHome(box.repo)),
      box.repo,
    );
    expect(done.out).not.toContain("unknown flag");
    expect(done.status).toBe(0);
    expect(thawed(box.journal)).toBe(true);
  });

  /**
   * THE DEFECT ITSELF, ASSERTED AS A PROPERTY RATHER THAN AS A SENTENCE (criterion 2 of the
   * statement): a refusal that names a flag the door then rejects sends the reader in a
   * circle, and no wording fixes that — only the two texts agreeing does.
   *
   * The refusals are collected from the LIVE command: the one that sent the operator in the
   * circle (a contour whose config declares no `orchestrator.ref`, so the fall-back has
   * nothing to fall back on and asks for the flag) and the one that names a missing hand.
   */
  it("no refusal of this command names a flag outside its own argv spec (150)", () => {
    const refless = mkdtempSync(join(tmpdir(), "agent-protocol-thaw-refless-"));
    execFileSync("git", ["init", "-q", "-b", "main", refless]);
    // A config with no `orchestrator.ref` — the working-tree read of the operator's ref
    // happens before any schema, so this is the shape that reaches the refusal.
    writeFileSync(join(refless, "agent-protocol.json"), "{}\n");
    const box = contour();
    const spec = parseUsage(USAGE).get("orchestrator thaw");
    if (spec === undefined) throw new Error("'orchestrator thaw' has no line in the shipped USAGE");
    const accepted = new Set([...spec.value, ...spec.boolean, ...spec.list]);
    const refusals = [
      cli(
        ["--role", "devops", "--thread", "079-stuck", "--by", "john", "--write"],
        sandbox(configHome(refless)),
        refless,
      ),
      cli(
        ["--role", "devops", "--thread", "079-stuck", "--write"],
        sandbox(configHome(box.repo)),
        box.repo,
      ),
    ];
    expect(refusals[0]?.out).toContain("--ref");
    expect(refusals[1]?.out).toContain("--by is not set");
    for (const refusal of refusals) {
      expect(refusal.status).toBe(2);
      const named = [...refusal.out.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((hit) => hit[0]);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((name) => !accepted.has(name))).toEqual([]);
    }
    // AND NOTHING WAS WRITTEN over a refusal about the line.
    expect(thawed(box.journal)).toBe(false);
  });
});
