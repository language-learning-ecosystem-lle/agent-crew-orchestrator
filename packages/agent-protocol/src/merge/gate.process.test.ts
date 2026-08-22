/**
 * THE PROCESS TEST OF `merge-gate` — the command as a real process, with a real `gh`
 * on the far side of the seam (a stub one, first on `PATH`).
 *
 * `gate.test.ts` proves the VERDICT; nothing proved the WIRING, and the reviewer's
 * finding on this PR was made of exactly that gap: the mapping of `gh pr view --json`
 * onto `PullRequestFacts` had never been run against a `gh` answer at all, and the one
 * call the command makes turned out to fail outright on an installation token (the
 * `checks` scope). A verdict that is right about a payload nobody ever handed it is
 * not a checked verdict.
 *
 * So this file exercises the three things only the process has: the JSON mapping
 * (a check RUN and a status CONTEXT arrive in the same array with different fields),
 * the exit code (0 / 1 / 2 are the command's whole contract with a caller), and the
 * refusal path when `gh` itself does not answer — including the scope hint, which the
 * message GitHub sends does not contain.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

const HEAD = "7ba1d22aa1b2c3d4e5f60718293a4b5c6d7e8f90";

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
      instructions: [{ kind: "in-repo", path: "docs/roles/curator.md" }],
    },
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

/**
 * A `gh` that answers with the given payload, or fails with the given message. `then`
 * is the answer to every ask AFTER the first — how the lazy `mergeable` of GitHub is
 * reproduced (UNKNOWN first, the real value on the next ask).
 */
const stubGh = (
  repo: string,
  answer: {
    json?: unknown;
    nextAsk?: unknown;
    failWith?: string;
    /** The answer to `gh api …/actions/runs?…` (thread 027) — the third read of the door. */
    runs?: unknown;
    /** …or its refusal, which is the state the whole repair turns on. */
    runsFailWith?: string;
  },
): string => {
  const bin = join(repo, "stub-bin");
  mkdirSync(bin, { recursive: true });
  const once = `cat <<'PAYLOAD'\n${JSON.stringify(answer.json)}\nPAYLOAD\n`;
  // The runs ask is answered BEFORE anything else, by matching the argument GitHub's path
  // carries — the door makes three different calls through one binary, and a stub that
  // answered them all alike would prove nothing about the wiring of any of them.
  const runsBranch =
    answer.runsFailWith !== undefined
      ? `case "$*" in *actions/runs*) echo ${JSON.stringify(answer.runsFailWith)} >&2; exit 1;; esac\n`
      : answer.runs !== undefined
        ? `case "$*" in *actions/runs*) cat <<'RUNS'\n${JSON.stringify(answer.runs)}\nRUNS\nexit 0;; esac\n`
        : "";
  const script =
    answer.failWith !== undefined
      ? `#!/bin/sh\n${runsBranch}echo ${JSON.stringify(answer.failWith)} >&2\nexit 1\n`
      : answer.nextAsk === undefined
        ? `#!/bin/sh\n${runsBranch}${once}`
        : `#!/bin/sh\n${runsBranch}if [ -f "$0.asked" ]; then\ncat <<'AGAIN'\n${JSON.stringify(answer.nextAsk)}\nAGAIN\nelse\ntouch "$0.asked"\n${once}fi\n`;
  const path = join(bin, "gh");
  writeFileSync(path, script, "utf8");
  chmodSync(path, 0o755);
  return bin;
};

/** A repository with the config committed — `--ref HEAD` reads it from there. */
const repoWithConfig = (over: Record<string, unknown> = {}): string => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-merge-gate-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify({ ...CONFIG, ...over }, null, 2)}\n`,
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  return repo;
};

const run = (
  repo: string,
  bin: string,
  extra: readonly string[] = [],
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [CLI, "merge-gate", "--ref", "HEAD", "--repo", repo, "--pr", "61", ...extra],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: sandbox(configHomeInside(repo), {
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        }),
      },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** The payload of a PR that passes every guard that is a fact. */
const mergeable = (over: Record<string, unknown> = {}): unknown => ({
  number: 61,
  headRefOid: HEAD,
  body: "Some words.\n\nthread: 026-curator-merge-right\nrole: dev-core\n",
  reviews: [
    {
      state: "APPROVED",
      commit: { oid: HEAD },
      author: { login: "reviewer-pr" },
      submittedAt: "2026-07-30T00:10:00Z",
    },
  ],
  // The head commit, made BEFORE the verdict above — so the verdict is an answer about
  // it and not one merely shown against it (thread 043).
  commits: [{ oid: HEAD, committedDate: "2026-07-30T00:00:00Z" }],
  statusCheckRollup: [
    // A check RUN and a status CONTEXT in one array — two node types, different fields.
    {
      name: "checks",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-07-30T00:04:05Z",
    },
    { context: "pronunciation", state: "SUCCESS" },
  ],
  files: [{ path: "packages/agent-protocol/src/merge/gate.ts" }],
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  ...over,
});

/**
 * A CLOSED ROUND OF THE REVIEWER'S WORKFLOW ON THE HEAD (thread 027), open across the whole
 * era these fixtures are stamped in — so a test that is not about the anchor states one in
 * two words and still exercises the same wiring the door uses.
 */
const ROUND_ON_HEAD: unknown = {
  total_count: 1,
  workflow_runs: [
    {
      id: 32535411165,
      name: "Claude PR Review",
      head_sha: HEAD,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    },
  ],
};

/** The flag that names the reviewer's workflow — without it guard 1 is an obligation (027). */
const REVIEWED = ["--review-workflow", "Claude PR Review"];

describe("merge-gate — the command, with a real gh on the other side of the seam", () => {
  it("maps a gh answer onto the verdict and exits 0 when nothing in the facts forbids the merge", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGh(repo, { json: mergeable(), runs: ROUND_ON_HEAD }), REVIEWED);

    expect(result.code).toBe(0);
    expect(result.out).toContain("ok   guard 1");
    // The status CONTEXT half of the rollup arrives as a name, not as "?".
    expect(result.out).toContain("pronunciation=SUCCESS");
    expect(result.out).toContain("guards 3 and 5 are yours to answer");
  });

  it("exits 1 when a guard does not hold — a document of power in the diff", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, { json: mergeable({ files: [{ path: "docs/roles/curator.md" }] }) }),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP guard 4");
    expect(result.out).toContain("docs/roles/curator.md");
    expect(result.out).toContain("REFUSED");
  });

  it("a WORKING card is not a document of power once it is named (john 2026-07-28)", () => {
    const repo = repoWithConfig();
    const gh = stubGh(repo, { json: mergeable({ files: [{ path: "CLAUDE.md" }] }) });

    // Derived from `instructions` alone, CLAUDE.md stops the merge...
    expect(run(repo, gh).code).toBe(1);

    // ...and named as a working card, it does not — and the subtraction is printed.
    const named = run(repo, gh, ["--working-cards", "CLAUDE.md"]);
    expect(named.code).toBe(0);
    expect(named.out).toContain("working cards, not documents of power: CLAUDE.md");
  });

  /**
   * 068 — class Д-1 through the real process, because the exit code is the whole contract
   * of this command with whoever calls it: 0 with the class declared on a document of
   * power, 1 without it on the very same diff, 2 on a reference nobody could follow.
   */
  it("--d1 turns the STOP on a document of power into an obligation — exit 0, and the trace is asked for", () => {
    const repo = repoWithConfig();
    const gh = stubGh(repo, {
      json: mergeable({ files: [{ path: "docs/roles/curator.md" }] }),
      runs: ROUND_ON_HEAD,
    });

    // The same diff, without the class declared, is the STOP it always was.
    const stopped = run(repo, gh, REVIEWED);
    expect(stopped.code).toBe(1);
    expect(stopped.out).toContain("STOP guard 4");

    const declared = run(repo, gh, [
      ...REVIEWED,
      "--d1",
      "068-d1-vs-guard4/2026-08-14T09-56-40Z-curator.md",
    ]);
    expect(declared.code).toBe(0);
    expect(declared.out).toContain("you  guard 4");
    expect(declared.out).toContain("2026-08-14T09-56-40Z-curator.md");
    expect(declared.out).toContain("guards 3, 4 and 5 are yours to answer");
  });

  it("a --d1 nobody could follow is exit 2, refused by name and before gh is asked", () => {
    const repo = repoWithConfig();
    const gh = stubGh(repo, { json: mergeable({ files: [{ path: "docs/roles/curator.md" }] }) });

    const bare = run(repo, gh, ["--d1", "066-test-gaps"]);
    expect(bare.code).toBe(2);
    expect(bare.out).toContain("names no message file");
    expect(bare.out).not.toContain("guard 1");

    const ordinal = run(repo, gh, ["--d1", "066-test-gaps/msg-003"]);
    expect(ordinal.code).toBe(2);
    expect(ordinal.out).toContain("ordinals travel");

    const notAMessage = run(repo, gh, ["--d1", "066-test-gaps/decision"]);
    expect(notAMessage.code).toBe(2);
  });

  it("a --working-cards entry no role points at is named, not silently ignored", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGh(repo, { json: mergeable() }), [
      "--working-cards",
      "docs/notes.md",
    ]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("matches no role's instructions: docs/notes.md");
  });

  it("a path declared a document of power stays one even if it is also called a working card", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, { json: mergeable({ files: [{ path: "CLAUDE.md" }] }) }),
      ["--power-docs", "CLAUDE.md", "--working-cards", "CLAUDE.md"],
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP guard 4");
  });

  /**
   * THE WIRING OF THE DECLARED HALF (thread 025), not its verdict (that is `gate.test.ts`):
   * between the JSON on disk and the printed trace there is a layer only the process runs —
   * the schema the door reads the BASE config by. A `powerDocuments` known to the strict
   * schema alone would pass every unit here and still be invisible to the door, so this
   * case starts where the field really starts: committed in the config, with nothing on
   * the command line.
   */
  it("a path the config declares stops the merge with no flag in the call, and the trace names the config as the source", () => {
    const declaring = repoWithConfig({ powerDocuments: ["PROTOCOL.md"] });
    const gh = stubGh(declaring, { json: mergeable({ files: [{ path: "PROTOCOL.md" }] }) });
    const result = run(declaring, gh);

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP guard 4");
    expect(result.out).toContain("PROTOCOL.md — declared by 'powerDocuments' of the config");
    // The list is declared, so it is not called an underived one.
    expect(result.out).not.toContain("the config declares no 'powerDocuments'");

    // The same diff against a config WITHOUT the field: today's behaviour, bit for bit —
    // no stop, and the trace says out loud that nothing was declared.
    const silent = repoWithConfig();
    const before = run(
      silent,
      stubGh(silent, { json: mergeable({ files: [{ path: "PROTOCOL.md" }] }) }),
    );
    expect(before.code).toBe(0);
    expect(before.out).toContain("the config declares no 'powerDocuments'");
  });

  it("gh refusing the call is exit 2 with no verdict — and a scope is offered for it", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        failWith:
          "GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup)",
      }),
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("checks: read");
    expect(result.out).not.toContain("guard 1");
  });

  /**
   * THE WIRING OF THE HINT, not its reading (that is `gh.test.ts`): what the command
   * hands `ghRefusalHint` is the message of `execFileSync`, which CARRIES THE ECHOED
   * COMMAND LINE — and the command line contains the word `statusCheckRollup`. That is
   * how the old test matched a refusal that had no scope in it at all, which is only
   * visible with the real process on both ends.
   */
  it("a refusal that is not about a scope gets no scope hint — the reason gh gave is the answer", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        failWith: "GraphQL: Could not resolve to a Repository with the name 'lle/lle'.",
      }),
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("Could not resolve to a Repository");
    expect(result.out).not.toContain("scope");
  });

  it("a gh answer missing a field the verdict is computed from is refused by name", () => {
    const repo = repoWithConfig();
    const payload = mergeable() as Record<string, unknown>;
    delete payload.statusCheckRollup;
    const result = run(repo, stubGh(repo, { json: payload }));

    expect(result.code).toBe(2);
    expect(result.out).toContain("statusCheckRollup");
    expect(result.out).not.toContain("guard 2");
  });

  it("commits is pinned too — losing it would put the substituted anchor back (043)", () => {
    const repo = repoWithConfig();
    const payload = mergeable() as Record<string, unknown>;
    delete payload.commits;
    const result = run(repo, stubGh(repo, { json: payload }));

    expect(result.code).toBe(2);
    expect(result.out).toContain("commits");
    expect(result.out).not.toContain("guard 1");
  });

  it("mergeable is pinned too — its absence is refused at the door, not read as a go-ahead", () => {
    const repo = repoWithConfig();
    const payload = mergeable() as Record<string, unknown>;
    delete payload.mergeable;
    const result = run(repo, stubGh(repo, { json: payload }));

    expect(result.code).toBe(2);
    expect(result.out).toContain("mergeable");
    expect(result.out).not.toContain("guard 1");
  });

  /**
   * THE RECORDED ANSWER of `gh pr view 89 --json ...` at head `f7171a5` (curator's
   * measurement of 2026-07-31T02:24Z). The live PR has since been rebased and no longer
   * reproduces the defect — the payload is kept here instead, because the acceptance of
   * D1 must not hang on a moving object.
   */
  it("judges the LAST attempt of a check name — the recorded #89 with a rerun on one head", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({
          number: 89,
          statusCheckRollup: [
            {
              name: "review",
              status: "COMPLETED",
              conclusion: "FAILURE",
              completedAt: "2026-07-30T00:05:30Z",
            },
            {
              name: "checks",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              completedAt: "2026-07-30T00:04:05Z",
            },
            {
              name: "review",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              completedAt: "2026-07-30T00:20:41Z",
            },
            {
              name: "pronunciation",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              completedAt: "2026-07-29T23:58:09Z",
            },
          ],
        }),
      }),
    );

    expect(result.code).toBe(0);
    expect(result.out).toContain("ok   guard 2");
    expect(result.out).toContain("3 check(s) green");
    expect(result.out).not.toContain("review=FAILURE");
  });

  /**
   * THE RECORDED ANSWER of `gh pr view 74 --json reviews,statusCheckRollup` at head
   * `042a116` (measured 2026-07-31T06:05Z): a second round of review on ONE head, ending
   * in `approve`, beside the rerun of the `review` check that D1 is about. The live PR is
   * the object curator asked D4 to be shown on; the payload is recorded so the acceptance
   * does not hang on it moving.
   */
  it("judges the LAST verdict of a reviewer — the recorded #74 with two rounds on one head", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({
          number: 74,
          reviews: [
            {
              state: "CHANGES_REQUESTED",
              commit: { oid: HEAD },
              author: { login: "github-actions" },
              submittedAt: "2026-07-31T03:11:30Z",
            },
            {
              state: "APPROVED",
              commit: { oid: HEAD },
              author: { login: "github-actions" },
              submittedAt: "2026-07-31T03:33:07Z",
            },
          ],

          statusCheckRollup: [
            {
              name: "review",
              status: "COMPLETED",
              conclusion: "FAILURE",
              completedAt: "2026-07-31T02:52:13Z",
            },
            {
              name: "checks",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              completedAt: "2026-07-31T02:53:02Z",
            },
            {
              name: "review",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              completedAt: "2026-07-31T03:33:11Z",
            },
            {
              name: "pronunciation",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              completedAt: "2026-07-31T02:46:03Z",
            },
          ],
        }),
        runs: ROUND_ON_HEAD,
      }),
      REVIEWED,
    );

    expect(result.code).toBe(0);
    expect(result.out).toContain("ok   guard 1");
    expect(result.out).toContain("ok   guard 2");
    expect(result.out).not.toContain("a new round, not a merge");
  });

  /** The same head read the other way round: D4 must not open the door it was closing. */
  it("refuses the recorded #74 shape when the later verdict is the changes-requested", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({
          number: 74,
          reviews: [
            {
              state: "APPROVED",
              commit: { oid: HEAD },
              author: { login: "github-actions" },
              submittedAt: "2026-07-31T03:11:30Z",
            },
            {
              state: "CHANGES_REQUESTED",
              commit: { oid: HEAD },
              author: { login: "github-actions" },
              submittedAt: "2026-07-31T03:33:07Z",
            },
          ],
        }),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP guard 1");
    expect(result.out).toContain("a new round, not a merge");
  });

  /**
   * THE RECORDED ANSWER of `gh pr view 64 --json headRefOid,reviews,commits` at head
   * `ea8572a` (curator's measurement of 2026-07-31T07:00Z, the commit dates read back on
   * the same PR), cut down to the verdicts that matter. The defect is in the payload
   * itself and needs no live PR: the approve of 03:46:02Z is shown against the CURRENT
   * head — a commit `gh pr update-branch` made at 06:55:57Z, three hours after the verdict
   * — which is why the door read it as an approve of every head in turn.
   */
  it("refuses the recorded #64 — the approve predates the head gh pr update-branch made", () => {
    const repo = repoWithConfig();
    const OLDER = "c1dc1a385e0c9ab232cf66f5f21eca112ed20f44";
    const dispatched = {
      state: "APPROVED",
      author: { login: "github-actions" },
      submittedAt: "2026-07-31T03:46:02Z",
    };
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({
          number: 64,
          reviews: [
            {
              state: "CHANGES_REQUESTED",
              commit: { oid: OLDER },
              author: { login: "github-actions" },
              submittedAt: "2026-07-31T01:52:47Z",
            },
            // gh fills this one in with whatever head the PR carries right now.
            { ...dispatched, commit: { oid: HEAD } },
          ],
          // And here is what it cannot fake: the head is younger than the verdict.
          commits: [
            { oid: OLDER, committedDate: "2026-07-31T01:40:00Z" },
            { oid: HEAD, committedDate: "2026-07-31T06:55:57Z" },
          ],
        }),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP guard 1");
    expect(result.out).toContain("older than the head commit");
    expect(result.out).toContain("pull_request");
  });

  /** The same recorded head, with the tree GitHub actually refused to merge (D2). */
  it("refuses a conflicting tree with every guard holding, and says whose refusal it is", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, { json: mergeable({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }) }),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP mergeability");
    expect(result.out).toContain("CONFLICTING");
    expect(result.out).toContain("GitHub itself would refuse");
    expect(result.out).not.toContain("STOP guard");
  });

  /**
   * GitHub computes `mergeable` lazily — the FIRST ask starts the job and answers
   * UNKNOWN (observed on every open PR of this repository). A door that refused on that
   * would refuse almost every first run, so the command asks again itself before it
   * reports UNKNOWN as an answer.
   */
  it("asks again when GitHub has not computed mergeable yet, instead of refusing the first ask", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
        nextAsk: mergeable(),
      }),
    );

    expect(result.code).toBe(0);
    expect(result.out).toContain("mergeable=MERGEABLE");
  });

  it("but reports UNKNOWN as the answer when asking again does not change it", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
        nextAsk: mergeable({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("has not finished computing");
  });

  /** D3: a flying run answers `conclusion: ""`, and the refusal used to print nothing. */
  it("names a flying check by what gh returned instead of leaving it blank", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable({
          statusCheckRollup: [
            {
              name: "review",
              status: "IN_PROGRESS",
              conclusion: "",
              startedAt: "2026-07-31T02:26:00Z",
            },
          ],
        }),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("review=IN_PROGRESS");
    expect(result.out).not.toContain("not green: review=\n");
  });
});

/**
 * 023.3 — THE SECOND READ, with the input 023.4 repaired. Where the base branch is now is
 * not in `gh pr view` at all: the command asks `gh api …/commits/<baseRefName>` for it —
 * THE BRANCH BY NAME — and NOTHING is computed from the answer. So what the wiring has to
 * prove is three things: the note appears when the answer arrives, a refusal of that
 * second ask leaves the exit code exactly where it was, and the ask names the BRANCH. The
 * third is the one that was missing: #191 asked about `baseRefOid`, a SHA that stands
 * still while the base moves, and every test of the pair still passed.
 */
const stubGhWithBase = (
  repo: string,
  payload: unknown,
  base: { sha: string; date: string } | undefined,
): string => {
  const bin = join(repo, "stub-bin-base");
  mkdirSync(bin, { recursive: true });
  // `$1` tells the two asks apart: `pr view …` and `api repos/…/commits/<ref>`. The ref of
  // the second ask is recorded on disk so a test can read WHAT WAS ASKED ABOUT.
  const answer =
    base === undefined
      ? 'echo "gh: HTTP 404" >&2\n  exit 1'
      : `printf '%s\\t%s\\n' ${JSON.stringify(base.sha)} ${JSON.stringify(base.date)}`;
  const script = `#!/bin/sh
if [ "$1" = "api" ]; then
  echo "$2" > ${JSON.stringify(join(repo, "second-ask.txt"))}
  ${answer}
else
  cat <<'PAYLOAD'
${JSON.stringify(payload)}
PAYLOAD
fi
`;
  const path = join(bin, "gh");
  writeFileSync(path, script, "utf8");
  chmodSync(path, 0o755);
  return bin;
};

/**
 * THE THIRD READ OF THE DOOR (thread 027) — `gh api actions/runs?head_sha=…`, end to end.
 * `gate.test.ts` proves the anchor; only the process proves that the command asks for it,
 * maps the REST payload (`head_sha`, `created_at` — snake case, unlike everything `gh pr
 * view` answers) and survives the refusal that the whole third state exists for.
 */
describe("merge-gate — the round of review behind the approve (thread 027)", () => {
  const runs = (over: Record<string, unknown> = {}): unknown => ({
    total_count: 1,
    workflow_runs: [
      {
        id: 32535411165,
        name: "Claude PR Review",
        head_sha: HEAD,
        event: "pull_request",
        status: "completed",
        conclusion: "success",
        created_at: "2026-07-30T00:05:00Z",
        updated_at: "2026-07-30T00:11:00Z",
        ...over,
      },
    ],
  });

  it("credits the approve when the round on this head produced it — and says which round", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGh(repo, { json: mergeable(), runs: runs() }), [
      "--review-workflow",
      "Claude PR Review",
    ]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("ok   guard 1");
    expect(result.out).toContain("inside the round 32535411165");
  });

  it("STOPS the orphan — a round that read another head, the verdict shown against this one", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable(),
        runs: runs({ head_sha: `34716450${"0".repeat(32)}`, id: 32534201968 }),
      }),
      ["--review-workflow", "Claude PR Review"],
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("STOP guard 1");
    expect(result.out).toContain("32534201968");
    expect(result.out).toContain("REFUSED");
  });

  it("a refused Actions resource is by-hand, quoted — not an ok, and not a refusal", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGh(repo, {
        json: mergeable(),
        runsFailWith: "Resource not accessible by integration (actions/runs)",
      }),
      ["--review-workflow", "Claude PR Review"],
    );

    expect(result.code).toBe(0);
    expect(result.out).toContain("you  guard 1");
    expect(result.out).toContain("Resource not accessible by integration");
    expect(result.out).toContain("guards 1, 3 and 5 are yours to answer");
  });

  it("without the flag nothing is asked of Actions, and guard 1 says so instead of passing", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGh(repo, { json: mergeable() }));

    expect(result.code).toBe(0);
    expect(result.out).toContain("you  guard 1");
    expect(result.out).toContain("--review-workflow");
  });
});

describe("merge-gate — the base under a credited check (023.3)", () => {
  const BASE = "9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f";
  const at = (date: string): { sha: string; date: string } => ({ sha: BASE, date });
  const withBase = (over: Record<string, unknown> = {}): unknown =>
    mergeable({
      baseRefName: "main",
      statusCheckRollup: [
        {
          name: "checks",
          status: "COMPLETED",
          conclusion: "SUCCESS",
          startedAt: "2026-07-30T00:02:00Z",
          completedAt: "2026-07-30T00:04:05Z",
        },
      ],
      ...over,
    });

  it("names the drift end to end — and still exits 0", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase(), at("2026-07-30T00:03:00Z")));

    expect(result.code).toBe(0);
    expect(result.out).toContain("note · base:");
    expect(result.out).toContain("moved AFTER");
    // Guard 1 joins the obligations because this call names no reviewer's workflow (027) —
    // the drift note is what this test is about, and it is unchanged by that.
    expect(result.out).toContain("guards 1, 3 and 5 are yours to answer");
  });

  /**
   * THE REGRESSION OF 023.4, AND THE ONLY TEST THAT COULD HAVE SEEN IT: the second ask
   * must name the BRANCH. `baseRefOid` is the head of the base as it was when this branch
   * was cut — it does not move when the base does, so dating it answered a question about
   * a commit nobody asked about and the note fell silent for good. A fact of the right
   * type in the wrong meaning: every other assertion here passed while it was wrong.
   */
  it("asks about the BRANCH, not the base SHA the payload reports", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGhWithBase(
        repo,
        // Both fields present: the payload OFFERS the stale SHA, and it must be ignored.
        withBase({ baseRefName: "main", baseRefOid: BASE }),
        at("2026-07-30T00:03:00Z"),
      ),
    );

    const asked = readFileSync(join(repo, "second-ask.txt"), "utf8").trim();
    expect(asked).toBe("repos/{owner}/{repo}/commits/main");
    expect(asked).not.toContain(BASE);
    expect(result.out).toContain("note · base:");
  });

  it("stays silent — and exits 0 identically — when the base is older than the check", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase(), at("2026-07-30T00:01:00Z")));

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("note · base:");
  });

  it("a refused second ask is NAMED and fatal to nothing", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase(), undefined));

    expect(result.code).toBe(0);
    expect(result.out).toContain("note · base:");
    expect(result.out).toContain("UNKNOWN");
  });

  it("a payload with no baseRefName at all is read, not refused — and nothing is asked twice", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase({ baseRefName: null }), undefined));

    expect(result.code).toBe(0);
    expect(result.out).toContain("the head of the base branch was not read");
    // With no branch to name there is no second ask at all — the stub never recorded one.
    expect(existsSync(join(repo, "second-ask.txt"))).toBe(false);
  });

  /**
   * HALF AN ANSWER IS NO ANSWER: a SHA with no date read as a measurement that happened
   * would date the base as `undefined` and print `current` — silence again, earned by
   * nothing.
   */
  it("a second ask that answers a SHA without a date says UNKNOWN, not silence", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase(), { sha: BASE, date: "" }));

    expect(result.code).toBe(0);
    expect(result.out).toContain("note · base:");
    expect(result.out).toContain("UNKNOWN");
  });

  it("the drift changes no refusal either — a document of power still exits 1", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGhWithBase(
        repo,
        withBase({ files: [{ path: "docs/roles/curator.md" }] }),
        at("2026-07-30T00:03:00Z"),
      ),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("note · base:");
    expect(result.out).toContain("REFUSED");
  });
});
