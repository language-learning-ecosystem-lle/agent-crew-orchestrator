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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

/** A journal with `devops×079-stuck` standing at the ceiling, and one healthy neighbour. */
const journal = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-thaw-"));
  const path = join(base, "journal.jsonl");
  writeFileSync(
    path,
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
      .join("\n")}\n`,
  );
  return path;
};

const NOW = "2026-09-06T07:00:00Z";

const cli = (
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): { status: number; out: string } => {
  // THE VARIABLE IS SCRUBBED BY DEFAULT, and the first run of this file is why: the suite
  // itself was started by a raised session, so `AGENT_PROTOCOL_WORKER` was inherited and
  // EVERY case got the session refusal. The door works; the harness had to stop being a
  // session for the other cases to be about anything.
  const { AGENT_PROTOCOL_WORKER: _worker, ...clean } = process.env;
  const result = spawnSync(TSX, [CLI, "orchestrator", "thaw", ...args], {
    encoding: "utf8",
    env: { ...clean, ...env },
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
});
