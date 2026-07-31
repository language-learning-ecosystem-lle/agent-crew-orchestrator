import { describe, expect, it } from "vitest";

import { CONFIG_SHAPES, configShapeKeys, SHAPE_REPAIR } from "./shape.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

describe("the shape of the config is frozen per version (R2, curator 2026-07-31)", () => {
  it("the schema accepts EXACTLY what the current version froze", () => {
    const frozen = CONFIG_SHAPES[CURRENT_PROTOCOL_VERSION];
    expect(
      frozen,
      `no shape recorded for version ${CURRENT_PROTOCOL_VERSION}. ${SHAPE_REPAIR}`,
    ).toBeDefined();
    // The diff of a red run is the list of fields that went in without a version: this is the
    // door curator asked for, and it stands here rather than in a workflow file on purpose —
    // it runs in `checks` like everything else, and editing a workflow costs a PR of its own.
    expect(configShapeKeys(), SHAPE_REPAIR).toEqual(frozen);
  });

  it("every recorded version is a version this package could have written", () => {
    for (const version of Object.keys(CONFIG_SHAPES).map(Number)) {
      expect(version).toBeLessThanOrEqual(CURRENT_PROTOCOL_VERSION);
    }
  });

  it("the key that cost an incident is in the shape, so the next one cannot slip in the same way", () => {
    // `notifications.templates.parked` went in with #127 at an unchanged version; the daemon
    // that met it read 'Unrecognized key' and died. It is recorded now — not to re-version the
    // past, but so that the FIRST field after it moves the number.
    expect(configShapeKeys()).toContain("notifications.templates.parked");
  });

  it("the walker names nested fields by their path, and array members with '[]'", () => {
    const keys = configShapeKeys();
    expect(keys).toContain("orchestrator.workdir.worktrees");
    expect(keys).toContain("roles[].zones.writes");
    expect(keys).not.toContain("roles.zones.writes");
  });
});
