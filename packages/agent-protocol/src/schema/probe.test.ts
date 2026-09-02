/**
 * THE TWO NUMBERS OF THE PIN, ON THE NUMBERS THAT PAID FOR THEM (thread 028).
 *
 * The fixtures are 17 and 18 on purpose — the pair of the 2026-08-22 accident at a consumer
 * (`v0.2.1` writes 17, `v0.2.2` writes 18, the consumer's config declared 17) — and
 * the source text is the real declaration, not a mock: what this module promises is
 * that a number can be read out of a build NOBODY INSTALLED, and a mock of the
 * source would prove nothing about that.
 */
import { describe, expect, it } from "vitest";

import { parseSupportedVersion, renderSchemaVersion } from "./probe.js";

/** The file as it really is at a tag — the comment block above the constant included. */
const sourceAt = (version: number): string =>
  `/**\n * The shape this build of the package reads and writes.\n */\nexport const CURRENT_PROTOCOL_VERSION = ${version};\n\nexport const PROTOCOL_VERSION_FIELD = "protocolVersion";\n`;

describe("parseSupportedVersion", () => {
  it("reads the number out of the source of a build that is not installed", () => {
    expect(parseSupportedVersion(sourceAt(17))).toBe(17);
    expect(parseSupportedVersion(sourceAt(18))).toBe(18);
  });

  it("does not confuse a mention of the constant with its declaration", () => {
    const mention = `// CURRENT_PROTOCOL_VERSION = 99 in the comment\nexport const CURRENT_PROTOCOL_VERSION = 18;\n`;
    expect(parseSupportedVersion(mention)).toBe(18);
  });

  it("reports a source with no declaration as unreadable rather than guessing", () => {
    expect(
      parseSupportedVersion("export const CURRENT_PROTOCOL_VERSION = later;\n"),
    ).toBeUndefined();
    expect(parseSupportedVersion("")).toBeUndefined();
  });
});

describe("renderSchemaVersion", () => {
  it("says both numbers and stays silent about a repair when they match", () => {
    const report = renderSchemaVersion({
      writes: { version: 18, at: "agent-protocol-v0.2.3:src/schema/version.ts" },
      declares: { version: 18, at: "'/lle/agent-protocol.json' at main" },
    });

    expect(report.verdict?.state).toBe("current");
    const said = report.lines.join("\n");
    expect(said).toContain("agent-protocol-v0.2.3:src/schema/version.ts");
    expect(said).toContain("writes protocol version 18");
    expect(said).toContain("declares protocol version 18");
    expect(said).toContain("matches the package");
    expect(said).not.toContain("schema migrate");
  });

  it("names BOTH numbers and one repair when the consumer is behind — the accident of 2026-08-22", () => {
    const report = renderSchemaVersion({
      writes: { version: 18, at: "agent-protocol-v0.2.3:src/schema/version.ts" },
      declares: { version: 17, at: "'/lle/agent-protocol.json' at main" },
    });

    expect(report.verdict).toEqual({ state: "behind", declared: 17, supported: 18 });
    const said = report.lines.join("\n");
    expect(said).toContain("writes protocol version 18");
    expect(said).toContain("declares protocol version 17");
    expect(said).toContain("schema migrate");
    expect(said).not.toContain("a downgrade is not performed");
  });

  it("gives the OTHER repair when the consumer is ahead — the candidate tag is the stale one", () => {
    const report = renderSchemaVersion({
      writes: { version: 17, at: "agent-protocol-v0.2.1:src/schema/version.ts" },
      declares: { version: 18, at: "'/lle/agent-protocol.json' at main" },
    });

    expect(report.verdict).toEqual({ state: "ahead", declared: 18, supported: 17 });
    const said = report.lines.join("\n");
    expect(said).toContain("writes protocol version 17");
    expect(said).toContain("declares protocol version 18");
    expect(said).toContain("a downgrade is not performed");
    expect(said).not.toContain("run 'agent-protocol schema migrate'");
  });

  it("asked with one number only, says so and names the flag that gets the second", () => {
    const report = renderSchemaVersion({ writes: { version: 18, at: "this build" } });

    expect(report.verdict).toBeUndefined();
    expect(report.lines.join("\n")).toContain("--repo");
  });
});
