import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildLaunchArgv } from "./launch.js";
import {
  MEMORY_INDEX,
  MEMORY_INDEX_LIMIT_BYTES,
  memoryIndexAlarm,
  memoryIndexAlarmFor,
  roleMemoryDirectory,
  sessionSettings,
} from "./memory.js";
import { orchestratorPaths } from "./paths.js";

const launch = { allowedTools: ["Bash", "Read"] };

const settingsOf = (argv: readonly string[]): unknown => {
  const at = argv.indexOf("--settings");
  return at === -1 ? undefined : JSON.parse(argv[at + 1] as string);
};

describe("roleMemoryDirectory", () => {
  /**
   * The one claim of the module, and the defect it answers: the vendor keys memory by
   * PROJECT DIRECTORY, so two roles on one box share one pile. Two roles, two paths.
   */
  it("keys the directory by the role and not by the project", () => {
    const memory = "/srv/circuit/.orchestrator/memory";
    expect(roleMemoryDirectory({ memory, role: "dev-core" })).toBe(
      "/srv/circuit/.orchestrator/memory/dev-core",
    );
    expect(roleMemoryDirectory({ memory, role: "dev-speech" })).not.toBe(
      roleMemoryDirectory({ memory, role: "dev-core" }),
    );
  });

  /** It hangs off the state directory — outside every checkout (constraint К-1). */
  it("lives in the state directory and not in the mail checkout", () => {
    const paths = orchestratorPaths({
      repo: "/srv/circuit",
      orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms" },
      mail: { dir: "agent-comms" },
    });
    expect(paths.memory).toBe("/srv/circuit/.orchestrator/memory");
    expect(roleMemoryDirectory({ memory: paths.memory, role: "curator" })).not.toContain(
      ".worktrees/comms",
    );
  });
});

describe("sessionSettings", () => {
  it("carries both decisions in one source", () => {
    expect(sessionSettings({ deny: ["Edit(apps/**)"], memoryDirectory: "/m/dev-core" })).toEqual({
      permissions: { deny: ["Edit(apps/**)"] },
      autoMemoryDirectory: "/m/dev-core",
    });
  });

  /**
   * К-2 in a test: before memory, a role with no zones got no settings source at all.
   * Memory is not a zone, so the source now travels for that role too.
   */
  it("is present for a role with no zones once memory is known", () => {
    expect(sessionSettings({ deny: [], memoryDirectory: "/m/curator" })).toEqual({
      autoMemoryDirectory: "/m/curator",
    });
  });

  /** And it is still honestly silent when we have decided nothing at all. */
  it("says nothing when there is nothing to say", () => {
    expect(sessionSettings({ deny: [] })).toBeUndefined();
    expect(sessionSettings({})).toBeUndefined();
  });
});

describe("buildLaunchArgv with memory", () => {
  it("hands the vendor the role's own directory", () => {
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "40",
      launch,
      denyRules: ["Edit(apps/**)"],
      memoryDirectory: "/srv/circuit/.orchestrator/memory/dev-core",
    });
    expect(settingsOf(argv)).toEqual({
      permissions: { deny: ["Edit(apps/**)"] },
      autoMemoryDirectory: "/srv/circuit/.orchestrator/memory/dev-core",
    });
  });

  it("passes --settings even when the role has no zones", () => {
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "40",
      launch,
      denyRules: [],
      memoryDirectory: "/m/curator",
    });
    expect(argv).toContain("--settings");
    expect(settingsOf(argv)).toEqual({ autoMemoryDirectory: "/m/curator" });
  });

  /** The regression contract: a caller that knows nothing of memory is unchanged. */
  it("omits the flag for a caller that names neither zones nor memory", () => {
    const argv = buildLaunchArgv({ prompt: "p", maxTurns: "40", launch });
    expect(argv).not.toContain("--settings");
  });
});

describe("the ceiling on the index", () => {
  /**
   * The sentence is in the test rather than in somebody's head (curator's
   * «Проверяемость»): both numbers, and the word that says what it costs.
   */
  it("fires loudly, by name, with both numbers", () => {
    const said = memoryIndexAlarmFor({ role: "dev-core", bytes: 30_000, limit: 24_576 });
    expect(said).toContain("dev-core");
    expect(said).toContain("30000");
    expect(said).toContain("24576");
    expect(said).toContain("EVERY session");
  });

  /** A ceiling that fires on the day it lands is a ceiling everyone learns to ignore. */
  it("does not fire on any pile measured on 2026-08-30", () => {
    for (const bytes of [267, 19_294]) {
      expect(memoryIndexAlarmFor({ role: "curator", bytes })).toBeUndefined();
    }
    expect(MEMORY_INDEX_LIMIT_BYTES).toBeGreaterThan(19_294);
  });

  it("reads the size off the disk, and a role with no notes is not an alarm", () => {
    const base = mkdtempSync(join(tmpdir(), "memory-ceiling-"));
    const directory = roleMemoryDirectory({ memory: base, role: "dev-core" });
    expect(memoryIndexAlarm({ directory, role: "dev-core" })).toBeUndefined();

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, MEMORY_INDEX), "x".repeat(MEMORY_INDEX_LIMIT_BYTES + 1));
    expect(memoryIndexAlarm({ directory, role: "dev-core" })).toContain("dev-core");
  });
});
