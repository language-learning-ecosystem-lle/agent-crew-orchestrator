/**
 * The PROCESS test of `journal write` — the whole point of the command is the SEAM, so
 * the pure planner beside it (`write.test.ts`) cannot carry the promise on its own.
 *
 * What is checked here and nowhere else: that `--write` with no `--no-push` ends with the
 * entry IN THE BRANCH — committed and pushed to a real remote, under the role's own
 * signature — because "the entry lands without a single PR" is exactly the acceptance john
 * named (thread 206, msg-002 §3), and a command that wrote to the disk and stopped would
 * satisfy every unit test and none of it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
    },
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

/**
 * A contour with a REAL REMOTE: the checkout sits on the mail branch and tracks a bare
 * repository, which is what makes "committed and pushed" a measurable fact rather than a
 * line of output.
 */
const contour = (): {
  repo: string;
  root: string;
  remote: string;
  body: (text: string) => string;
} => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-journal-"));
  const remote = join(base, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "comms", remote]);

  const repo = join(base, "checkout");
  execFileSync("git", ["init", "-q", "-b", "comms", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const thread = join(repo, "agent-comms", "206-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "comms");

  const outside = mkdtempSync(join(tmpdir(), "agent-protocol-journal-body-"));
  let n = 0;
  const body = (text: string): string => {
    n += 1;
    const path = join(outside, `entry-${n}.md`);
    writeFileSync(path, text);
    return path;
  };
  return { repo, root: join(repo, "agent-comms"), remote, body };
};

const run = (
  place: ReturnType<typeof contour>,
  extra: readonly string[],
): { code: number; out: string } => {
  try {
    return {
      code: 0,
      out: execFileSync(
        TSX,
        [
          CLI,
          "journal",
          "write",
          "--repo",
          place.repo,
          "--root",
          place.root,
          "--ref",
          "HEAD",
          "--no-fetch",
          "--from",
          "dev-core",
          ...extra,
        ],
        { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(place.repo), {}) },
      ),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** What the REMOTE carries at that path — the only reading that proves a delivery. */
const inBranch = (place: ReturnType<typeof contour>, path: string): string =>
  execFileSync("git", ["-C", place.remote, "show", `comms:${path}`], { encoding: "utf8" });

describe("journal write delivers into the mail branch", () => {
  it("--write ends with the entry IN THE BRANCH — no branch of its own, no PR, no run", () => {
    const place = contour();

    const result = run(place, [
      "--thread",
      "206-x",
      "--body-file",
      place.body("## Что было\n\nЗамер.\n"),
      "--write",
    ]);

    expect(result.code).toBe(0);
    const entry = inBranch(place, "agent-comms/journal/dev-core/206-x.md");
    expect(entry).toBe("# Журнал роли dev-core — тред `206-x`\n\n## Что было\n\nЗамер.\n");
    // The commit is BY THE ROLE (027) — the mail checkout is shared by every role here.
    expect(
      execFileSync("git", ["-C", place.remote, "log", "-1", "--format=%an%n%s", "comms"], {
        encoding: "utf8",
      }),
    ).toContain("dev-core");
  });

  it("a second entry on the same thread APPENDS — the branch keeps both paragraphs", () => {
    const place = contour();
    run(place, ["--thread", "206-x", "--body-file", place.body("Первое."), "--write"]);

    const result = run(place, [
      "--thread",
      "206-x",
      "--body-file",
      place.body("Второе."),
      "--write",
    ]);

    expect(result.code).toBe(0);
    const entry = inBranch(place, "agent-comms/journal/dev-core/206-x.md");
    expect(entry).toContain("Первое.");
    expect(entry).toContain("Второе.");
  });

  it("the same text twice is refused BY NAME and the branch is not touched again", () => {
    const place = contour();
    run(place, ["--thread", "206-x", "--body-file", place.body("Первое."), "--write"]);
    const head = execFileSync("git", ["-C", place.remote, "rev-parse", "comms"], {
      encoding: "utf8",
    });

    const result = run(place, [
      "--thread",
      "206-x",
      "--body-file",
      place.body("Первое."),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("already carries this text");
    expect(
      execFileSync("git", ["-C", place.remote, "rev-parse", "comms"], { encoding: "utf8" }),
    ).toBe(head);
  });

  it("without --write nothing is written anywhere — the entry is printed as it would land", () => {
    const place = contour();

    const result = run(place, ["--thread", "206-x", "--body-file", place.body("Замер.")]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("agent-comms/journal/dev-core/206-x.md");
    expect(() => inBranch(place, "agent-comms/journal/dev-core/206-x.md")).toThrow();
  });

  /**
   * The id is what the path is BUILT from (#408), so a typo in it does not fail loudly by
   * itself — it quietly makes a file no reader of that thread will ever open.
   */
  it("a thread that does not exist is refused, and the refusal says why the name matters", () => {
    const place = contour();

    const result = run(place, [
      "--thread",
      "999-nope",
      "--body-file",
      place.body("Замер."),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("999-nope");
    expect(result.out).toContain("NAMED BY THE THREAD");
  });

  /** The same door as `new-message`'s (thread 170): dirt in a checkout freezes the mail. */
  it("a body file left inside the checkout is refused before anything is written", () => {
    const place = contour();
    const inside = join(place.repo, "entry.md");
    writeFileSync(inside, "Замер.\n");

    const result = run(place, ["--thread", "206-x", "--body-file", inside, "--write"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("journal write —");
  });

  it("a typo in a flag is refused at the door rather than swallowed into the branch", () => {
    const place = contour();

    const result = run(place, ["--thread", "206-x", "--body-file", place.body("Замер."), "--wrte"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("--wrte");
  });
});
