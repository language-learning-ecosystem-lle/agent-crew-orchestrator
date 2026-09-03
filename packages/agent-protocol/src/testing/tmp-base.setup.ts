/**
 * The `setupFiles` entry that applies the choice made in `tmp-base.ts`: it runs before a
 * test module is loaded, so a fixture built at module scope is already answered from the
 * chosen base, and a CLI this suite spawns inherits the variable with the rest of the
 * environment.
 *
 * `TMP` and `TEMP` go with it: `os.tmpdir()` consults all three, and leaving one behind
 * would move the base for node and not for a child that reads the other name.
 */
import { tmpdir } from "node:os";

import { enclosingRepository, neutralTmpBase, PLATFORM_SHARED_TMP } from "./tmp-base.js";

const chosen = neutralTmpBase({
  current: tmpdir(),
  fallback: PLATFORM_SHARED_TMP,
  probe: enclosingRepository,
});

if (chosen.movedFrom !== undefined) {
  process.env.TMPDIR = chosen.base;
  delete process.env.TMP;
  delete process.env.TEMP;
}
