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
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  answer: { json?: unknown; nextAsk?: unknown; failWith?: string },
): string => {
  const bin = join(repo, "stub-bin");
  mkdirSync(bin, { recursive: true });
  const once = `cat <<'PAYLOAD'\n${JSON.stringify(answer.json)}\nPAYLOAD\n`;
  const script =
    answer.failWith !== undefined
      ? `#!/bin/sh\necho ${JSON.stringify(answer.failWith)} >&2\nexit 1\n`
      : answer.nextAsk === undefined
        ? `#!/bin/sh\n${once}`
        : `#!/bin/sh\nif [ -f "$0.asked" ]; then\ncat <<'AGAIN'\n${JSON.stringify(answer.nextAsk)}\nAGAIN\nelse\ntouch "$0.asked"\n${once}fi\n`;
  const path = join(bin, "gh");
  writeFileSync(path, script, "utf8");
  chmodSync(path, 0o755);
  return bin;
};

/** A repository with the config committed — `--ref HEAD` reads it from there. */
const repoWithConfig = (): string => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-merge-gate-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
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

describe("merge-gate — the command, with a real gh on the other side of the seam", () => {
  it("maps a gh answer onto the verdict and exits 0 when nothing in the facts forbids the merge", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGh(repo, { json: mergeable() }));

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
      }),
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
 * 023.3 — THE SECOND READ. The base's date is not in `gh pr view` at all: the command
 * asks `gh api …/commits/<baseRefOid>` for it, and NOTHING is computed from the answer.
 * So what the wiring has to prove is the pair: the note appears when the date arrives,
 * and a refusal of that second ask leaves the exit code exactly where it was.
 */
const stubGhWithBase = (repo: string, payload: unknown, baseDate: string | undefined): string => {
  const bin = join(repo, "stub-bin-base");
  mkdirSync(bin, { recursive: true });
  // `$1` tells the two asks apart: `pr view …` and `api repos/…/commits/<sha>`.
  const date =
    baseDate === undefined
      ? 'echo "gh: HTTP 404" >&2\n  exit 1'
      : `echo ${JSON.stringify(baseDate)}`;
  const script = `#!/bin/sh
if [ "$1" = "api" ]; then
  ${date}
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

describe("merge-gate — the base under a credited check (023.3)", () => {
  const BASE = "9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f";
  const withBase = (over: Record<string, unknown> = {}): unknown =>
    mergeable({
      baseRefOid: BASE,
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
    const result = run(repo, stubGhWithBase(repo, withBase(), "2026-07-30T00:03:00Z"));

    expect(result.code).toBe(0);
    expect(result.out).toContain("note · base:");
    expect(result.out).toContain("moved AFTER");
    expect(result.out).toContain("guards 3 and 5 are yours to answer");
  });

  it("stays silent — and exits 0 identically — when the base is older than the check", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase(), "2026-07-30T00:01:00Z"));

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

  it("a payload with no baseRefOid at all is read, not refused — no guard is computed from it", () => {
    const repo = repoWithConfig();
    const result = run(repo, stubGhWithBase(repo, withBase({ baseRefOid: null }), undefined));

    expect(result.code).toBe(0);
    expect(result.out).toContain("no base commit");
  });

  it("the drift changes no refusal either — a document of power still exits 1", () => {
    const repo = repoWithConfig();
    const result = run(
      repo,
      stubGhWithBase(
        repo,
        withBase({ files: [{ path: "docs/roles/curator.md" }] }),
        "2026-07-30T00:03:00Z",
      ),
    );

    expect(result.code).toBe(1);
    expect(result.out).toContain("note · base:");
    expect(result.out).toContain("REFUSED");
  });
});
