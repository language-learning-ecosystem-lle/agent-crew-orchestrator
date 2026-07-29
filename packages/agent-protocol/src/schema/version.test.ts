import { describe, expect, it } from "vitest";

import {
  compareProtocolVersion,
  declaredProtocolVersion,
  legacyVersionHint,
  ProtocolVersionError,
  renderVersionVerdict,
  requireCurrentProtocolVersion,
} from "./version.js";

describe("compareProtocolVersion", () => {
  it("calls the three states by their own names", () => {
    expect(compareProtocolVersion(1, 1).state).toBe("current");
    expect(compareProtocolVersion(1, 2).state).toBe("behind");
    expect(compareProtocolVersion(3, 2).state).toBe("ahead");
  });
});

describe("renderVersionVerdict", () => {
  it("points a repository that is behind at the migration", () => {
    const text = renderVersionVerdict(compareProtocolVersion(1, 2));

    expect(text).toContain("schema migrate");
    expect(text).toContain("1");
    expect(text).toContain("2");
  });

  it("points a repository that is ahead at the package and refuses a downgrade", () => {
    // The directions are NOT symmetric, and the text has to say so: a downgrade
    // would mean re-deriving data written by a shape this build has never seen.
    const text = renderVersionVerdict(compareProtocolVersion(3, 2));

    // The REPAIR comes first, because in practice this verdict is met by a long-lived
    // process running code older than the data it reads (thread `023-daemon-parallelism`).
    expect(text).toContain("restart required");
    expect(text).toContain("pull and restart what is running on it");
    expect(text).toContain("a downgrade is not performed");
    expect(text).not.toContain("schema migrate");
  });
});

describe("requireCurrentProtocolVersion", () => {
  it("lets a matching version through", () => {
    expect(() => requireCurrentProtocolVersion(2, { path: "p.json" }, 2)).not.toThrow();
  });

  it("throws on a mismatch, naming the file and the ref it was read at", () => {
    // The gate stands on the reading path, so the message is the only thing the
    // operator sees — it must say WHICH config, at WHICH point in history.
    expect(() =>
      requireCurrentProtocolVersion(1, { path: "agent-protocol.json", ref: "origin/main" }, 2),
    ).toThrow(/agent-protocol\.json' at origin\/main/);

    try {
      requireCurrentProtocolVersion(1, { path: "agent-protocol.json" }, 2);
      expect.unreachable("the gate did not fire");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolVersionError);
      expect((error as ProtocolVersionError).verdict).toEqual({
        state: "behind",
        declared: 1,
        supported: 2,
      });
    }
  });
});

describe("declaredProtocolVersion", () => {
  it("reads the number out of raw JSON, before any schema validation", () => {
    // A migration runs on a config whose SHAPE the current schema may reject —
    // that is the whole point of reading the version without it.
    expect(declaredProtocolVersion({ protocolVersion: 2, whatever: [] })).toBe(2);
  });

  it("does not guess when the field is absent or is not a positive integer", () => {
    expect(declaredProtocolVersion({})).toBeUndefined();
    expect(declaredProtocolVersion({ protocolVersion: "2" })).toBeUndefined();
    expect(declaredProtocolVersion({ protocolVersion: 1.5 })).toBeUndefined();
    expect(declaredProtocolVersion({ protocolVersion: 0 })).toBeUndefined();
    expect(declaredProtocolVersion(null)).toBeUndefined();
  });
});

describe("legacyVersionHint", () => {
  it("meets a pre-versioning config with the exact repair", () => {
    const hint = legacyVersionHint({ version: 1, mail: {} });

    expect(hint).toContain("'version'");
    expect(hint).toContain("'protocolVersion'");
  });

  it("stays silent once the new field is there", () => {
    expect(legacyVersionHint({ protocolVersion: 1 })).toBeUndefined();
    // Both fields at once: the new one wins, the hint would only be noise.
    expect(legacyVersionHint({ version: 1, protocolVersion: 1 })).toBeUndefined();
  });
});
