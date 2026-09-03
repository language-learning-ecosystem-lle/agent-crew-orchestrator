import { defineConfig } from "vitest/config";

// A local config: the package is a separate project of the root vitest
// (packages/*); without it a run started from inside the package picks up the
// root list of projects.
// WHY THE TIMEOUT IS RAISED FOR THE WHOLE PACKAGE (thread 023). A third of this
// suite is `*.process.test.ts`: they spawn a real `tsx` + CLI child against a real
// git circuit, and several of them spawn it TWICE in one test (`workspace.process`
// launches, unsets the identity and launches again; `daemon.process` runs two ticks).
// One such launch is ~1-2s on an idle box, so vitest's 5s default is not a statement
// about the code at all — it is a measurement of how busy the machine is. Measured:
// two concurrent runs of `process.test` on this box fail 2 files out of 29 with
// "Test timed out in 5000ms", and a full suite run beside another one failed 12 out
// of 104 — while each file alone is green (workspace.process: 20/20, 31s). That is
// the flake reported twice in thread 023 as an unexplained failure of
// `workspace.process.test.ts`, and it is a redness the CI runner is one busy moment
// away from. The cost of the raise is a hung test reporting late instead of at 5s,
// which in a suite that already takes three minutes buys nothing worth the noise.
const PROCESS_CHILD_TIMEOUT_MS = 60_000;

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // WHERE THE FIXTURES LIVE (thread 098). Every temp directory this suite makes is a
    // `mkdtemp` under `os.tmpdir()`, and 84 files of it rely on that base NOT being inside
    // a git repository — an unstated premise that holds on a runner and fails on the box
    // that runs the circuit, where a raised session's `TMPDIR` points into the checkout by
    // design. Chosen once here rather than at 135 call sites: see `testing/tmp-base.ts`.
    setupFiles: ["./src/testing/tmp-base.setup.ts"],
    testTimeout: PROCESS_CHILD_TIMEOUT_MS,
    hookTimeout: PROCESS_CHILD_TIMEOUT_MS,
  },
});
