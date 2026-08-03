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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const contour = (options: {
  transport?: boolean;
  templates?: boolean;
  stalledAfter?: number;
  outcome?: "sent" | "failed" | "unconfigured";
}) => {
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
      `    return { state: '${options.outcome ?? "sent"}', detail: 'stub: ${options.outcome ?? "sent"}' };`,
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
            ...(options.stalledAfter === undefined
              ? {}
              : { stalledAfterMinutes: options.stalledAfter }),
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
  /** A thread FROZEN BEHIND JOHN, declared by a message that either asks or does not. */
  const park = (id: string, options: { asks: boolean; date?: string; body?: string }): void => {
    mkdirSync(join(root, id, "messages"), { recursive: true });
    writeFileSync(join(root, id, "_meta.md"), meta("dev-core, curator"));
    const date = options.date ?? "2026-07-25T20:00:00Z";
    writeFileSync(
      join(root, id, "messages", `${date.replace(/:/g, "-")}-curator.md`),
      `---\nfrom: curator\nworker: human\ndate: ${date}\nexpects: ${
        options.asks ? "answer" : "none"
      }\nwaiting-on: curator\nparked-on: john\n---\n\n${options.body ?? "Чинить ли гард 2?"}\n`,
    );
  };
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
    park,
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
    expect(result.out).toContain("stub: sent");
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

  it("a thread waiting on an agent is not a notification at all — while it is moving", () => {
    // The horizon is put out of reach on purpose: the property being tested here is
    // the ORIGINAL one (a wait on an agent is the watch's business, not the phone's),
    // and the fixture is dated, so without this it would be caught by the second
    // question below rather than by the first.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.thread("016-x", "dev-core");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.out).toContain("0 waits");
    expect(existsSync(contest.delivered)).toBe(false);
  });

  it("...but the same thread standing still IS an event, with no human in waiting-on", () => {
    // The v13 case end to end: nobody is awaited who could be phoned, and the ring
    // happens anyway because the turn has not moved.
    const contest = contour({});
    contest.thread("016-x", "dev-core");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.out).toContain("0 waits");
    expect(result.out).toContain("stalled");
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain("has not moved for");
    expect(readFileSync(contest.state, "utf8")).toContain("stalled\tdev-core\t016-x\t");
  });

  it("a stall already announced is not announced again", () => {
    const contest = contour({});
    contest.thread("016-x", "dev-core");
    contest.commit();
    run(contest, ["--write"]);
    rmSync(contest.delivered);

    const again = run(contest, ["--write"]);

    expect(again.out).toContain("nothing to announce");
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

  it("a FAILED delivery is non-zero and leaves the state alone (thread 029)", () => {
    // The defect this closes, in the words of the run that produced it: notify said
    // "2 of them new", the transport said "fetch failed", the state was already on
    // disk — and the next call said "nothing to announce". john was never told.
    const contest = contour({ outcome: "failed" });
    contest.thread("029-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(1);
    expect(result.out).toContain("the state is unchanged");
    expect(existsSync(contest.state)).toBe(false);

    // And the proof that the trigger was not consumed: the next call announces it.
    const again = run(contest, ["--write"]);
    expect(again.out).toContain("1 of them new");
  });

  it("an UNCONFIGURED transport is silence, not a fault — zero, and the state stays put", () => {
    // No credentials on this box is a legitimate state (the rule inherited from
    // bin/notify.sh) — but it is not a delivery either, so nothing is marked
    // announced and credentials appearing later make it ring.
    const contest = contour({ outcome: "unconfigured" });
    contest.thread("029-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    expect(existsSync(contest.state)).toBe(false);
  });

  it("a pair that stops waiting is forgotten even though nothing was announced", () => {
    // "Nothing to announce" IS a confirmed outcome: the state moves, so a thread that
    // comes back to waiting later rings again instead of being remembered for ever.
    // The stalled horizon is put out of reach: the fixture is dated, and the second
    // question ("what has not moved") would otherwise turn the quiet run into an event.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.thread("016-x", "john");
    contest.commit();

    run(contest, ["--write"]);
    expect(readFileSync(contest.state, "utf8")).toContain("016-x");

    contest.thread("016-x", "dev-core"); // the turn moved on: nobody human is waiting
    const again = run(contest, ["--write"]);

    expect(again.out).toContain("nothing to announce");
    expect(readFileSync(contest.state, "utf8")).not.toContain("016-x");
  });

  it("A PARK RINGS ONCE — the next digest does not repeat the question (thread 051)", () => {
    // john's pain of 2026-08-03, end to end: the ❓ line used to be rendered from the
    // composition, so every digest with anything else in it carried the same question again.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("023-x", { asks: true });
    contest.commit();

    run(contest, ["--write"]);
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain(
      "your decision: 023-x — Чинить ли гард 2?",
    );
    rmSync(contest.delivered);

    // A NEW event on another thread — the digest goes out, and it is not about the park.
    contest.thread("016-x", "john");
    const second = run(contest, ["--write"]);

    expect(second.code).toBe(0);
    const text = JSON.parse(readFileSync(contest.delivered, "utf8")).text as string;
    expect(text).toContain("⏳ твой ход: 016-x");
    expect(text).not.toContain("023-x");
    // The park is still IN FORCE: it stays in the state, and the thread is not called stalled.
    expect(readFileSync(contest.state, "utf8")).toContain("parked\tjohn\t023-x\t");
    expect(second.out).toContain("1 parked, 0 of them asking");
  });

  it("a park declared by an informational message never rings, and no blank is sent", () => {
    // `expects: none` says the message asks nobody for anything. The park still freezes the
    // thread — so the wait line is suppressed too, and the whole digest renders to nothing.
    // A blank buzz on somebody's phone is not a delivery, and the state still moves.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("016-x", { asks: false, body: "фиксация мыслей, НЕ в работу" });
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing to announce");
    expect(existsSync(contest.delivered)).toBe(false);
    expect(readFileSync(contest.state, "utf8")).toContain("parked\tjohn\t016-x\t");
  });

  it("re-parked with a NEW question it rings again — the key is the message that asked", () => {
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("023-x", { asks: true });
    contest.commit();
    run(contest, ["--write"]);
    rmSync(contest.delivered);

    contest.park("023-x", { asks: true, date: "2026-07-26T09:00:00Z", body: "А теперь чинить?" });
    const again = run(contest, ["--write"]);

    expect(again.out).toContain("1 of them asking");
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain(
      "your decision: 023-x — А теперь чинить?",
    );
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
