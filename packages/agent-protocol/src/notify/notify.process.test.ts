/**
 * The PROCESS test of `notify` — the notifier as a real command, with a real
 * transport plugin on the far side of the seam.
 *
 * What cannot be covered by the pure planner is exactly what this package's
 * expensive defects have always been made of: the ORDER of the three side effects
 * (resolve → write the state → send) and the resolution of everything the command is
 * given from outside. The transport here is a stub module named by an absolute path
 * in the config — which also proves the seam takes a module the core has never heard
 * of, since that is the whole claim of R4.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const ROLES = [
  { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  {
    id: "curator",
    kind: "claude.ai",
    status: "active",
    wake: { mode: "via-human", via: "john" },
    summary: "the keeper",
  },
  {
    id: "dev-core",
    kind: "claude-code",
    status: "active",
    wake: { mode: "watch", session: "s" },
    summary: "the stream",
  },
];

const meta = (participants: string): string =>
  `---\ntitle: T\nparticipants: ${participants}\nstatus: open\n---\n`;

const message = (from: string, waitingOn: string): string =>
  `---\nfrom: ${from}\nworker: human\ndate: 2026-07-25T20:00:00Z\nexpects: answer\nwaiting-on: ${waitingOn}\n---\n\nThe body.\n`;

/** A repository with a committed config, a mail root and a stub transport module. */
const contour = (options: { transport?: boolean; templates?: boolean }) => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-notify-"));
  const delivered = join(repo, "delivered.txt");
  const transportPath = join(repo, "stub-transport.mjs");
  writeFileSync(
    transportPath,
    [
      "import { writeFileSync } from 'node:fs';",
      "export const createTransport = ({ options, secrets }) => ({",
      "  send: async (text) => {",
      `    writeFileSync(${JSON.stringify(delivered)}, JSON.stringify({ text, options, token: secrets.TELEGRAM_BOT_TOKEN ?? null }));`,
      "    return { state: 'sent', detail: 'stub: delivered' };",
      "  },",
      "});",
      "",
    ].join("\n"),
  );

  const config = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    mail: { branch: "comms", dir: "agent-comms" },
    orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "origin/main" },
    ...(options.transport === false
      ? {}
      : {
          notifications: {
            transport: { module: transportPath, options: { kind: "stub" } },
            ...(options.templates === false
              ? {}
              : {
                  templates: {
                    turn: "⏳ твой ход: {thread}",
                    "turn-with-nudge": "⏳ твой ход: {thread} ({nudged} следом)",
                    nudge: "🔔 тред {thread} ждёт {role} — дёрни его",
                  },
                }),
          },
        }),
    roles: ROLES,
  };
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);

  const root = join(repo, "agent-comms");
  const thread = (id: string, waitingOn: string): void => {
    mkdirSync(join(root, id, "messages"), { recursive: true });
    writeFileSync(join(root, id, "_meta.md"), meta("dev-core, curator"));
    writeFileSync(
      join(root, id, "messages", "2026-07-25T20-00-00Z-dev-core.md"),
      message("dev-core", waitingOn),
    );
  };

  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  return {
    repo,
    root,
    delivered,
    state: join(repo, ".orchestrator", "notify.state"),
    thread,
    commit: (): void => {
      execFileSync("git", ["-C", repo, "add", "."]);
      execFileSync(
        "git",
        ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "init"],
        { encoding: "utf8" },
      );
    },
  };
};

const run = (
  contest: ReturnType<typeof contour>,
  extra: readonly string[] = [],
): { code: number; out: string } => {
  try {
    return {
      code: 0,
      out: execFileSync(
        TSX,
        [
          CLI,
          "notify",
          "--repo",
          contest.repo,
          "--root",
          contest.root,
          "--state",
          contest.state,
          "--ref",
          "HEAD",
          "--no-fetch",
          ...extra,
        ],
        { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo)) },
      ),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("notify as a command", () => {
  it("without --write it prints what it would send and leaves the state alone", () => {
    // This is what `NOTIFY_DRY_RUN=1` used to be, folded into the package-wide rule.
    const contest = contour({});
    contest.thread("016-x", "john");
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("⏳ твой ход: 016-x");
    expect(existsSync(contest.state)).toBe(false);
    expect(existsSync(contest.delivered)).toBe(false);
  });

  it("--write delivers through the module named in the config, with its options and secrets", () => {
    const contest = contour({});
    contest.thread("016-x", "john");
    contest.commit();
    const envFile = join(contest.repo, "telegram.env");
    writeFileSync(envFile, "TELEGRAM_BOT_TOKEN=123:AA\n");

    const result = run(contest, ["--write", "--env-file", envFile]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("stub: delivered");
    const payload = JSON.parse(readFileSync(contest.delivered, "utf8")) as {
      text: string;
      options: Record<string, string>;
      token: string | null;
    };
    expect(payload.text).toBe("⏳ твой ход: 016-x");
    expect(payload.options).toEqual({ kind: "stub" });
    // The secrets reach the plugin and NOTHING about them reaches the output.
    expect(payload.token).toBe("123:AA");
    expect(result.out).not.toContain("123:AA");
  });

  it("the second run says nothing: the trigger is a NEW pair, not the fact of waiting", () => {
    const contest = contour({});
    contest.thread("016-x", "john");
    contest.commit();

    run(contest, ["--write"]);
    const again = run(contest, ["--write"]);

    expect(again.out).toContain("nothing to announce");
  });

  it("a thread waiting on the assistant alone asks the human to poke them", () => {
    const contest = contour({});
    contest.thread("016-x", "curator");
    contest.commit();

    expect(run(contest).out).toContain("🔔 тред 016-x ждёт curator");
  });

  it("a thread waiting on an agent is not a notification at all", () => {
    const contest = contour({});
    contest.thread("016-x", "dev-core");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.out).toContain("0 waits");
    expect(existsSync(contest.delivered)).toBe(false);
  });

  it("with no transport configured the message is printed and the state still moves", () => {
    const contest = contour({ transport: false });
    contest.thread("016-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("no transport configured");
    expect(result.out).toContain("your turn: 016-x");
    expect(existsSync(contest.state)).toBe(true);
  });

  it("a transport that does not load REFUSES before the state is touched", () => {
    // Otherwise a setup defect would consume the trigger: the pair would be marked
    // as reported and never announced again.
    const contest = contour({});
    writeFileSync(
      join(contest.repo, "agent-protocol.json"),
      readFileSync(join(contest.repo, "agent-protocol.json"), "utf8").replace(
        /"module": "[^"]*"/,
        '"module": "no-such-transport-anywhere"',
      ),
    );
    contest.thread("016-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(2);
    expect(existsSync(contest.state)).toBe(false);
  });
});
