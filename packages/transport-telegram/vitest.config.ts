import { defineConfig } from "vitest/config";

// A local config, as in `agent-protocol`: the package is a separate project of the
// root vitest (`packages/*`), and without this a run started from inside the package
// would pick up the root list of projects.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
