import { defineConfig } from "vitest/config";

// A local config: the package is a separate project of the root vitest
// (packages/*); without it a run started from inside the package picks up the
// root list of projects.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
