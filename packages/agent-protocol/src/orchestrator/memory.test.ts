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
  memoryIndexSplit,
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
    expect(roleMemoryDirectory({ memory, role: "dev-acme" })).not.toBe(
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

/**
 * THE DEFINITION OF THE THREE BUCKETS IS PINNED ON A SAMPLE LINE, counted by hand in the
 * comments, because a number computed "roughly" is exactly as useless to the human who
 * reads the alarm as the advice it replaced (curator's §3).
 */
describe("the byte split of the index", () => {
  it("counts a plain line by hand: heading, address, prose", () => {
    // `- ` 2 · `[Heading one]` 13 · `(note-one.md)` 13 · ` - a hook; ` 11 · `[Two]` 5 ·
    // `(note-two.md)` 13 · `\n` 1  =  58
    const line = "- [Heading one](note-one.md) - a hook; [Two](note-two.md)\n";
    expect(memoryIndexSplit(line)).toEqual({
      bytes: 58,
      headings: 14, // "Heading one" 11 + "Two" 3
      addresses: 33, // marker 2 + (11+4) + (11+4) + newline 1
      prose: 11, // " - a hook; "
    });
  });

  /** A separator carries no letter and no digit, so it is markup and not prose. */
  it("puts the residue between two links of a bush line into markup", () => {
    const split = memoryIndexSplit("- [A](a.md); [B](b.md)\n");
    expect(split).toEqual({ bytes: 23, headings: 2, addresses: 21, prose: 0 });
  });

  /**
   * The invariant, and the one thing the alarm would be worthless without: the three
   * numbers ARE the file. Asserted on Cyrillic and on an em dash, where a character and
   * a byte are not the same thing.
   */
  it("sums to the byte length of its input, multi-byte text included", () => {
    for (const index of [
      "",
      "\n\n",
      "нет ссылок вовсе, одна проза\n",
      "- [Заголовок](файл.md) — хук с `кодом`\n- [Второй](два.md) · [Третий](три.md)\n",
      "# Не список\n\nабзац [со ссылкой](x.md) посередине\n",
    ]) {
      const split = memoryIndexSplit(index);
      expect(split.headings + split.addresses + split.prose).toBe(Buffer.byteLength(index, "utf8"));
      expect(split.bytes).toBe(Buffer.byteLength(index, "utf8"));
    }
  });
});

describe("the ceiling on the index", () => {
  /**
   * The sentence is in the test rather than in somebody's head (curator's
   * «Проверяемость»): the size, the ceiling, the three numbers of the split — and NOT the
   * advice to delete, which aimed at the smallest bucket and at an action the circuit has
   * forbidden (thread `217`).
   */
  it("fires loudly, by name, with the size, the ceiling and the split", () => {
    const line = "- [Заголовок длиной побольше](какая-то-заметка.md) — хук этой заметки\n";
    const index = line.repeat(500);
    const split = memoryIndexSplit(index);
    const said = memoryIndexAlarmFor({ role: "dev-core", index, limit: 24_576 });

    expect(said).toContain("dev-core");
    expect(said).toContain(String(split.bytes));
    expect(said).toContain("24576");
    expect(said).toContain("EVERY session");
    expect(said).toContain(`headings ${split.headings} bytes`);
    expect(said).toContain(`addresses and markup ${split.addresses} bytes`);
    expect(said).toContain(`prose ${split.prose} bytes`);
    // The three numbers are the whole file, and the file is the number already printed.
    expect(split.headings + split.addresses + split.prose).toBe(split.bytes);
    expect(split.bytes).toBe(Buffer.byteLength(index, "utf8"));
    // The advice that used to stand here is gone and is not replaced by another one.
    expect(said).not.toMatch(/delet|prune|shorten|role card/i);
    // One line, still: a warning that became a paragraph is paid by every raise.
    expect(said?.includes("\n")).toBe(false);
  });

  /** A ceiling that fires on the day it lands is a ceiling everyone learns to ignore. */
  it("does not fire on any pile measured on 2026-08-30", () => {
    for (const bytes of [267, 19_294]) {
      const index = "x".repeat(bytes);
      expect(memoryIndexSplit(index).bytes).toBe(bytes);
      expect(memoryIndexAlarmFor({ role: "curator", index })).toBeUndefined();
    }
    expect(MEMORY_INDEX_LIMIT_BYTES).toBeGreaterThan(19_294);
  });

  it("reads the index off the disk, and a role with no notes is not an alarm", () => {
    const base = mkdtempSync(join(tmpdir(), "memory-ceiling-"));
    const directory = roleMemoryDirectory({ memory: base, role: "dev-core" });
    expect(memoryIndexAlarm({ directory, role: "dev-core" })).toBeUndefined();

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, MEMORY_INDEX), "x".repeat(MEMORY_INDEX_LIMIT_BYTES + 1));
    expect(memoryIndexAlarm({ directory, role: "dev-core" })).toContain("dev-core");
  });

  /** A directory instead of a file, an unreadable one — the raise still happens. */
  it("stays silent instead of throwing when the index cannot be read", () => {
    const base = mkdtempSync(join(tmpdir(), "memory-ceiling-"));
    const directory = roleMemoryDirectory({ memory: base, role: "dev-core" });
    mkdirSync(join(directory, MEMORY_INDEX), { recursive: true });
    expect(memoryIndexAlarm({ directory, role: "dev-core" })).toBeUndefined();
  });
});
