/**
 * THE PROCESS TEST OF `pr open` — the seam that matters is that `gh` IS NOT CALLED.
 *
 * `pr-open.test.ts` proves the verdict; nothing there proves the wiring, and the wiring is
 * the whole of john's decision of 2026-09-02 (thread `052-pr-template`): a refusal that
 * created the pull request anyway and merely complained would be worse than no door at all
 * — the description is append-only in practice, and a PR opened without `role:` is exactly
 * the silent unhanded turn being repaired.
 *
 * So the stub `gh` first on `PATH` writes down every call it receives, and the assertions
 * read that file: on a refusal it must not exist; on a pass it must carry `pr create` with
 * the title and the body file; and without `--write` nothing is called either.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: "CLAUDE.md" }],
    },
  ],
};

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });

/** A repository with the config committed — `--ref HEAD` reads it from there. */
const repoWithConfig = (): string => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-pr-open-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  return repo;
};

/** A `gh` that records every call it receives — the file's ABSENCE is the assertion. */
const recordingGh = (repo: string): { bin: string; calls: () => readonly string[] } => {
  const bin = join(repo, "stub-bin");
  mkdirSync(bin, { recursive: true });
  const log = join(bin, "calls.txt");
  const path = join(bin, "gh");
  writeFileSync(
    path,
    `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\necho https://example.invalid/pr/7\n`,
    "utf8",
  );
  chmodSync(path, 0o755);
  return {
    bin,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []),
  };
};

const run = (
  repo: string,
  bin: string,
  extra: readonly string[],
): { code: number; out: string } => {
  try {
    const out = execFileSync(TSX, [CLI, "pr", "open", "--ref", "HEAD", "--repo", repo, ...extra], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repo,
      env: sandbox(configHomeInside(repo), {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      }),
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/**
 * A BODY FILE WHERE A BODY FILE BELONGS — outside every checkout (thread 157).
 *
 * It used to be written into the fixture repository itself, which is exactly the fault the
 * second door now refuses: these tests were, quietly, the shape of the mistake. The base is
 * the suite's own neutral temp (`testing/tmp-base.ts` guarantees it is inside no repository),
 * so this is also the live proof of the passing path — every green case below now runs the
 * door for real.
 */
const withBody = (_repo: string, body: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "agent-protocol-pr-body-")), "body.md");
  writeFileSync(path, body, "utf8");
  return path;
};

/** The same body, written INSIDE the checkout — the artefact `.pr278-body.md` was. */
const bodyInside = (repo: string, body: string): string => {
  const path = join(repo, ".pr-body.md");
  writeFileSync(path, body, "utf8");
  return path;
};

const GOOD = "thread: 052-pr-template\nrole: dev-core\n\nWhat this PR is and what it stands on.\n";

describe("pr open — the door in front of `gh pr create`", () => {
  it("refuses a body without `role:` and DOES NOT call gh", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      withBody(repo, "thread: 052-pr-template\n\nprose\n"),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("names no role");
    // The whole point: nothing was created, so there is nothing to close afterwards.
    expect(gh.calls()).toEqual([]);
  });

  it("refuses the template's placeholder, naming both fields, and calls nothing", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      withBody(repo, "thread: NNN-slug ← заполнить\nrole: <id> ← заполнить\n\nprose\n"),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("thread: <slug>");
    expect(result.out).toContain("role: <id>");
    expect(gh.calls()).toEqual([]);
  });

  it("refuses a role the config does not declare — by name", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      withBody(repo, "thread: 052-pr-template\nrole: dev-cores\n\nprose\n"),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("'dev-cores' is not listed in the protocol config");
    expect(gh.calls()).toEqual([]);
  });

  it("opens the pull request when both fields stand first, and passes gh's answer through", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const body = withBody(repo, GOOD);
    const result = run(repo, gh.bin, [
      "--title",
      "feat(pr): a title",
      "--body-file",
      body,
      "--base",
      "main",
      "--write",
    ]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("thread '052-pr-template', role 'dev-core'");
    expect(result.out).toContain("https://example.invalid/pr/7");
    const calls = gh.calls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("pr create");
    expect(calls[0]).toContain("feat(pr): a title");
    expect(calls[0]).toContain(body);
    expect(calls[0]).toContain("--base main");
  });

  it("without --write judges the body, prints the call and creates nothing", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "feat(pr): a title",
      "--body-file",
      withBody(repo, GOOD),
    ]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing created (no --write)");
    expect(result.out).toContain("gh pr create");
    expect(gh.calls()).toEqual([]);
  });

  it("refuses a flag it does not know, like every other guarded command (thread 042)", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "t",
      "--body-file",
      withBody(repo, GOOD),
      "--reviewer",
      "curator",
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("--reviewer");
    expect(gh.calls()).toEqual([]);
  });
});

/**
 * THE SECOND DOOR, WIRED (thread `157-pr-open-body-inside-checkout`). The unit test proves
 * the verdict against an injected reader; what is proved here is that the real command asks
 * REAL git, refuses before `gh`, and that the ORDER of the two doors is the declared one.
 */
describe("pr open — the body file that lies inside a checkout", () => {
  it("refuses a body written into the checkout and DOES NOT call gh", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const path = bodyInside(repo, GOOD);
    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      path,
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain(path);
    expect(result.out).toContain("lies inside the git checkout");
    // Executable, not a riddle: the refusal says where to put it instead.
    expect(result.out).toContain("mktemp -d -p /tmp");
    expect(gh.calls()).toEqual([]);
  });

  it("refuses even without --write — the file is already dirt by the time it is asked", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      bodyInside(repo, GOOD),
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("lies inside the git checkout");
    expect(result.out).not.toContain("nothing created (no --write)");
  });

  it("puts WHERE before WHAT: a bad description inside a checkout is refused for the place", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      // No `role:` line — the content door would have plenty to say about this body.
      bodyInside(repo, "thread: 157-pr-open-body-inside-checkout\n\nprose\n"),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("lies inside the git checkout");
    // And the content door is silent: the file has to be moved whatever it says, so the
    // caller is told one thing to do and not two (the order is a decision, thread 157).
    expect(result.out).not.toContain("names no role");
    expect(gh.calls()).toEqual([]);
  });

  it("refuses by the INNERMOST checkout when one is nested inside another", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const inner = join(repo, "vendor", "inner");
    mkdirSync(inner, { recursive: true });
    git(inner, "init", "-q", "-b", "main");
    const path = join(inner, "body.md");
    writeFileSync(path, GOOD, "utf8");

    const result = run(repo, gh.bin, ["--title", "t", "--body-file", path, "--write"]);

    expect(result.code).toBe(2);
    // What git answers for that directory, asked of git and not restated: the innermost.
    expect(result.out).toContain(git(inner, "rev-parse", "--show-toplevel").trim());
    expect(gh.calls()).toEqual([]);
  });

  it("follows a symlink that reaches INTO a checkout — git resolves the cwd itself", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const inside = join(repo, "bodies");
    mkdirSync(inside, { recursive: true });
    writeFileSync(join(inside, "body.md"), GOOD, "utf8");
    // The path as typed is outside every checkout; the bytes land inside one.
    const outside = mkdtempSync(join(tmpdir(), "agent-protocol-pr-link-"));
    const link = join(outside, "bodies");
    symlinkSync(inside, link);

    const result = run(repo, gh.bin, [
      "--title",
      "t",
      "--body-file",
      join(link, "body.md"),
      "--write",
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("lies inside the git checkout");
    expect(gh.calls()).toEqual([]);
  });

  it("names an unreadable path as unreadable — this door is never reached for one", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    const missing = join(repo, "no-such-body.md");
    const result = run(repo, gh.bin, ["--title", "t", "--body-file", missing, "--write"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("could not read the body of the pull request");
    expect(result.out).not.toContain("lies inside the git checkout");
    expect(gh.calls()).toEqual([]);
  });
  it("passes a body in a directory the checkout IGNORES — the session's own temp", () => {
    const repo = repoWithConfig();
    const gh = recordingGh(repo);
    writeFileSync(join(repo, ".gitignore"), ".orchestrator/\n", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "ignore the machine state");
    const dir = join(repo, ".orchestrator", "sessions", "run.tmp");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "body.md");
    writeFileSync(path, GOOD, "utf8");

    const result = run(repo, gh.bin, [
      "--title",
      "feat: something",
      "--body-file",
      path,
      "--write",
    ]);

    // `git pull --ff-only` writes over an ignored file without a word, so this is not the
    // fault the door is about — and it is where a raised session's `mktemp -d` lands.
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("lies inside the git checkout");
    expect(gh.calls().length).toBe(1);
  });
});
