/**
 * The secrets source. Two properties are worth a test and neither is about parsing:
 * a file the operator NAMED and cannot be read is an error (R14's rule, applied to
 * the third file), and nothing that leaves this module ever carries a value.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeSecrets, loadSecrets, parseEnvFile, SecretsError } from "./secrets.js";

const file = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "agent-protocol-secrets-")), "telegram.env");
  writeFileSync(path, content, "utf8");
  return path;
};

describe("the env file", () => {
  it("reads the shape the existing file already has", () => {
    // The file this replaces was written by hand once, following PROTOCOL.md;
    // adopting its form beats asking a human to convert it.
    expect(
      parseEnvFile('# a comment\nexport TELEGRAM_BOT_TOKEN=123:AA\nTELEGRAM_CHAT_ID="42"\n\n'),
    ).toEqual({ TELEGRAM_BOT_TOKEN: "123:AA", TELEGRAM_CHAT_ID: "42" });
  });

  it("skips a line that is not a pair instead of guessing at it", () => {
    expect(parseEnvFile("nonsense\n=value\nA=1")).toEqual({ A: "1" });
  });

  it("wins over the inherited environment — the file is the more specific statement", () => {
    const loaded = loadSecrets({ path: file("A=fromfile"), env: { A: "fromenv", B: "kept" } });

    expect(loaded.values.A).toBe("fromfile");
    expect(loaded.values.B).toBe("kept");
  });

  it("no file named is legitimate: the environment is passed through as it is", () => {
    const loaded = loadSecrets({ env: { A: "1" } });

    expect(loaded.path).toBeNull();
    expect(loaded.values.A).toBe("1");
  });

  it("a NAMED file that cannot be read is an error, not a silent fallback", () => {
    expect(() => loadSecrets({ path: "/nowhere/telegram.env" })).toThrow(SecretsError);
  });

  it("the operator's line names the variables and NEVER their values", () => {
    const path = file("TELEGRAM_BOT_TOKEN=123:AAsecret\n");
    const line = describeSecrets(loadSecrets({ path, env: {} }));

    expect(line).toContain("TELEGRAM_BOT_TOKEN");
    expect(line).not.toContain("123:AAsecret");
  });
});
