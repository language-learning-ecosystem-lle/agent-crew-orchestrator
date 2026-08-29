/**
 * THE ONE LINE THAT SAYS HOW THIS REPOSITORY STARTS ITS OWN CLI — `package.json`, the
 * `protocol` script. A claim about this repository's own root file, in the generic
 * package, for the reason `roles/workflow-signatures.test.ts` and `notify/transport.test.ts`
 * hold theirs: the repository serves itself, and nothing else in the tree reads that line.
 *
 * THE DEFECT IT PINS, MEASURED (thread `026-codex-agent-kind`, 2026-08-28…29). A role
 * confined by a vendor sandbox (`codex exec --sandbox read-only`, codex-cli `0.150.1`,
 * node `24.18.0`) cannot use the `tsx` BINARY at all: the shim raises an IPC listener and
 * the sandbox refuses it, so the command dies BEFORE the first line of our code —
 *
 *     node:net:1987 … Error: listen EPERM: operation not permitted /tmp/tsx-1000/16.pipe
 *
 * The reader of such a report sees a node stack and blames the command the role typed,
 * though the command never ran. The loader form (`node --import tsx <entry>`) starts and
 * reaches the CLI door: same measurement, one run, `exit 0` with a live feed. Until this
 * line was fixed, the ONLY invocation derivable from the repository was the dead one:
 * `agent-protocol` publishes no `bin`, so `node_modules/.bin/agent-protocol` does not
 * exist (`exit 127` in both live pilot runs), and `pnpm protocol` — the guess the pilot
 * actually made — called the `tsx` binary.
 *
 * WHY A SENTRY AND NOT JUST THE FIX (asked for by name, john 2026-08-29 ~01:36Z): the
 * form is one word inside a JSON string that every reformat, every dependency bump and
 * every "simplify the scripts" pass can drop back, and NOTHING else in the tree would go
 * red. The cost of the silent rollback is not a red test — it is a role raised at
 * 275–444k input tokens rediscovering the same wall.
 *
 * WHAT THIS FILE CANNOT DO, said out loud: it does not reproduce the sandbox and does not
 * claim the loader form works — there is no codex, no apparmor profile and no vendor
 * account on a CI runner (the same border `docs/install-notes.md` §9/§10 draws). It reads
 * the TEXT of the script. That the loader form actually starts and answers is covered by
 * `read-under-sandbox.process.test.ts` (which runs it) and, for the sandbox itself, by a
 * live run of a role — by nothing here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../../", import.meta.url);
const PACKAGE_JSON = fileURLToPath(new URL("package.json", REPO_ROOT));

/** The entry the script must hand to node — the CLI door of this package. */
const CLI_ENTRY = "packages/agent-protocol/src/cli.ts";

/** Where a reader of the failure goes for the measurement instead of re-deriving it. */
const WHY = [
  "under a vendor sandbox (measured: codex exec --sandbox read-only, codex-cli 0.150.1)",
  "the `tsx` BINARY dies before the first line of our code — `listen EPERM` in `node:net`,",
  "the shim's own IPC pipe. Any role on any sandboxed tool hits it, and the report reads",
  "like a broken command. See docs/install-notes.md §10.",
].join(" ");

/**
 * The complaints against one script line, as sentences. An empty list is the pass — the
 * idiom of `workflow-signatures.test.ts`, chosen so a failure PRINTS the reason instead
 * of printing `false !== true`.
 */
const judgeLauncherForm = (script: string | undefined): readonly string[] => {
  if (script === undefined) {
    return [`package.json has no "protocol" script — the entry point of the CLI is gone. ${WHY}`];
  }
  const words = script.trim().split(/\s+/);
  const complaints: string[] = [];
  const executable = words[0] ?? "";
  if (executable !== "node") {
    complaints.push(
      `"protocol" starts \`${executable}\`, not \`node\`: the FIRST thing executed must be node itself. ${WHY}`,
    );
  }
  // `--import tsx` is what teaches node the TypeScript entry without the shim in front.
  // The substring "tsx" alone proves nothing: it is present in both forms, the dead one
  // included — that is exactly how the rollback would pass unnoticed.
  if (words[1] !== "--import" || words[2] !== "tsx") {
    complaints.push(
      `"protocol" does not load tsx as a node loader (\`node --import tsx …\`), it reads: ${script}. ${WHY}`,
    );
  }
  if (words[3] !== CLI_ENTRY) {
    complaints.push(
      `"protocol" hands node \`${words[3] ?? "nothing"}\` instead of ${CLI_ENTRY} — the CLI door of this package.`,
    );
  }
  return complaints;
};

describe("the launcher form of this repository's own CLI (thread 026)", () => {
  const scripts = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).scripts as
    | Record<string, string>
    | undefined;

  it("is the LOADER, not the `tsx` binary — a sandboxed role cannot start the shim", () => {
    expect(judgeLauncherForm(scripts?.protocol)).toEqual([]);
  });

  // The judge must be able to REFUSE, or the test above is a green line that reads a file
  // and asserts nothing. The form that was in the tree until 2026-08-29 is the case.
  it("refuses the form that was there before — and the refusal names the cause", () => {
    const complaints = judgeLauncherForm(`tsx ${CLI_ENTRY}`);

    expect(complaints.length).toBeGreaterThan(0);
    expect(complaints.join("\n")).toContain("listen EPERM");
    expect(complaints.join("\n")).toContain("docs/install-notes.md §10");
  });
});
