/**
 * THE DAEMON SURVIVES A CONFIG IT CANNOT RE-READ (thread `023-daemon-parallelism`).
 *
 * The sibling test (`daemon.network.process.test.ts`) nails the MAIL probe against a
 * dead remote. This one nails the door underneath it — the config read, which every
 * tick makes (the courier alone calls `configFrom` once a tick) and which used to end
 * in `process.exit(2)`.
 *
 * The night it cost: 2026-07-28 ~23:03Z, `TLS handshake timeout` → `ssh: connect to
 * host github.com port 22: Connection timed out` → `git fetch --quiet origin main`
 * → "the protocol config at 'origin/main' was not read" → the process was gone, and
 * the box stood 8.3 hours with eleven waiting pairs. The already-written degradation
 * of the mail probe could not help: the probe itself begins by reading the config.
 *
 * The remote is unreachable FOR REAL here (the bare repository is moved away), and
 * the ref is `origin/main` on purpose — that is the ref that fetches, and a config
 * read at `HEAD` would prove nothing about the failure being reproduced.
 *
 * Launches stay DISABLED: the invariant under test is the loop staying alive across
 * an outage, and a child session in the middle of it would only add ways to be flaky.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { HANG_CEILING_MS, waitFor } from "../testing/wait-for.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "origin/main" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

const contour = (): { repo: string; origin: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-cfgoutage-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, origin };
};

const cutTheWire = (origin: string): void => renameSync(origin, `${origin}.away`);
const restoreTheWire = (origin: string): void => renameSync(`${origin}.away`, origin);

describe("a config that cannot be re-read does not kill a running daemon", () => {
  it(
    "the wire dies mid-flight: the daemon stands on the last config, says so every tick, and resumes",
    async () => {
      const { repo, origin } = contour();

      const child = spawn(
        TSX,
        [
          CLI,
          "orchestrator",
          "daemon",
          "--ref",
          "origin/main",
          "--repo",
          repo,
          "--exec",
          "/bin/true",
          "--tick",
          "1",
          "--poll",
          "1",
        ],
        { cwd: repo, stdio: ["ignore", "pipe", "pipe"], env: sandbox(configHome(repo)) },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      let exit: number | null = null;
      child.on("exit", (code) => {
        exit = code;
      });
      const until = async (state: () => boolean, what: string): Promise<void> => {
        if (await waitFor(state)) return;
        child.kill("SIGKILL");
        throw new Error(
          `waited ${HANG_CEILING_MS / 1000}s for ${what} and it never came; the output so far:\n${output}`,
        );
      };
      const warnings = (): number =>
        output.split("the config at 'origin/main' was NOT re-read").length - 1;

      try {
        // The daemon must have read the config ONCE for real first — that read is
        // what it will later stand on, and without it the failure is rightly fatal.
        await until(() => output.includes("the daemon is up"), "the daemon to come up");

        cutTheWire(origin);

        // TWO warnings, not one: the second is what proves the LOOP survived, rather
        // than the process merely not having died yet. This is the assertion that goes
        // red on the previous behaviour — there the first failing read was `exit(2)`.
        await until(() => warnings() >= 2, "two ticks standing on the last config");
        expect(exit).toBe(null);
        // git's own words about the remote, not a paraphrase: an outage that does not
        // name its cause is read as a bug in the daemon.
        expect(output).toMatch(/does not appear to be a git repository|Could not read from remote/);
        // And the fallback is never silent — that would be the stale-config defect the
        // whole loader was built against.
        expect(output).toContain("stays in force (nothing new was read)");

        restoreTheWire(origin);

        // BACK TO READING, by itself: no restart, no human. Measured as "the warnings
        // stop coming" against a tick counter that keeps moving — the daemon prints a
        // queue line every tick, so a frozen process cannot fake this.
        const settled = warnings();
        const ticks = output.split("agent-protocol: daemon").length;
        await until(
          () => output.split("agent-protocol: daemon").length > ticks + 4,
          "the daemon to keep ticking after the remote came back",
        );
        expect(warnings()).toBe(settled);
      } finally {
        child.kill("SIGKILL");
      }
    },
    5 * HANG_CEILING_MS,
  );
});
