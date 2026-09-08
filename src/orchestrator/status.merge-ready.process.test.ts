/**
 * TIER 2 IN THE OPERATOR'S FRAME (thread `019-operator-ux`, the addendum of 2026-08-01
 * to point 5) — `orchestrator status` and the tick order the queue by the SAME facts.
 *
 * WHY A PROCESS TEST. The tier itself is unit-tested (`merge-ready.test.ts`) and the
 * ordering is pure (`priority.test.ts`); what neither can see is the seam this file
 * exists for — the frame passed no `mergeReady` to `rankCandidates` at all, while a
 * comment over each of the two call sites claimed the human's queue and the tick's
 * queue were one computation. One function, two sets of inputs: invisible until the day
 * a merge-ready PR exists, and on that day the operator reads an order the daemon is not
 * going to raise from. Only a run of the real command through the real wiring catches it.
 *
 * THE NETWORK IS A SHIM ON `PATH`. A fake `gh` answers both halves of the read and
 * APPENDS ITS ARGV to a log, so "how many network reads did this frame make" is a
 * counted fact rather than a claim — the same instrument the price of the tick was
 * measured with on 2026-08-01, and the only way the once-per-collect requirement can be
 * asserted at all.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const HEAD = "d2942fb0adf2e3036b9fa99fc7a1e727945a834d";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  // THE ROUND OF REVIEW, NAMED BY THIS FIXTURE'S PROJECT (v26, thread 063). The other cases
  // of this file carry no labels at all, so declaring it here changes nothing for them —
  // what it buys is that the seam is exercised END TO END: the frame reads the name out of
  // the config on disk, and a package that had guessed `review` would pass the test without
  // the config ever being read.
  review: { label: "review", workflow: "Claude PR Review" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
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
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
      permissions: ["thread-priority"],
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

const handoff = (options: { readonly date: string; readonly priority?: string }): string =>
  `---\nfrom: curator\ndate: ${options.date}\nexpects: answer\nwaiting-on: dev-core\n${
    options.priority === undefined ? "" : `priority: ${options.priority}\n`
  }---\n\nThe body.\n`;

type ThreadSpec = { readonly id: string; readonly message: string };

const contour = (threads: readonly ThreadSpec[]): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-frame-ready-"));
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
  for (const spec of threads) {
    const dir = join(mail, "agent-comms", spec.id);
    mkdirSync(join(dir, "messages"), { recursive: true });
    writeFileSync(
      join(dir, "_meta.md"),
      "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n",
    );
    writeFileSync(join(dir, "messages", "2026-07-25T10-00-00Z-curator.md"), spec.message);
  }
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/** The payload `gh pr view` answers for a pull request whose guards 1-2 hold. */
const readyPayload = (thread: string): string =>
  JSON.stringify({
    number: 154,
    headRefOid: HEAD,
    body: `thread: ${thread}\nrole: dev-core\n`,
    reviews: [
      {
        state: "APPROVED",
        commit: { oid: HEAD },
        author: { login: "github-actions" },
        submittedAt: "2026-08-01T06:50:59Z",
      },
    ],
    commits: [{ oid: HEAD, committedDate: "2026-08-01T06:40:00Z" }],
    statusCheckRollup: [
      {
        name: "checks",
        context: null,
        status: "COMPLETED",
        conclusion: "SUCCESS",
        state: null,
        completedAt: "2026-08-01T06:49:00Z",
        startedAt: "2026-08-01T06:41:00Z",
      },
    ],
    files: [{ path: "packages/agent-protocol/src/cli.ts" }],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
  });

/**
 * The payload of a pull request whose ROUND IS OPEN: the label is on (see the cheap half),
 * the checks are green, and NOTHING has been submitted against this head — `reviews: []`.
 * Guards 1-2 do not hold on it, so the older tier stays silent about it, which is exactly
 * the pair that used to read as `released (completed)`, "finished".
 */
const inReviewPayload = (thread: string): string =>
  JSON.stringify({
    ...JSON.parse(readyPayload(thread)),
    reviews: [],
  });

/**
 * THE PAYLOAD MINUS THE ONE NODE A FINE-GRAINED TOKEN IS REFUSED (thread 166, the class
 * measured by john on a private repository in thread 160): everything above except
 * `statusCheckRollup`, which is precisely what `gh pr view` answers on the SECOND ask.
 */
const withoutRollupPayload = (thread: string): string => {
  const payload = JSON.parse(readyPayload(thread));
  delete payload.statusCheckRollup;
  return JSON.stringify(payload);
};

/** The runs of Actions on the head — the substitute source, answering green. */
const RUNS = JSON.stringify({
  workflow_runs: [
    {
      id: 1,
      name: "checks",
      head_sha: HEAD,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      created_at: "2026-08-01T06:41:00Z",
      updated_at: "2026-08-01T06:49:00Z",
    },
  ],
});

/**
 * THE REFUSAL GITHUB ANSWERS FOR THE ONE FORBIDDEN NODE, in its own words — the path is
 * what is read, never the word (`forbiddenChecksRollup`), so the shim has to name it.
 *
 * AND IN THE ACTOR'S OWN WORDS TOO (thread 172): GitHub names WHO it refused, and the two
 * seams that read this refusal now cover one actor each — the door's process test is
 * refused `by integration`, what a GitHub App inside Actions is told, and the tier here is
 * refused `by personal access token`, what the consumer's roles are actually told on their
 * private repository. Only the first wording was recognised for six weeks, and the tick
 * that cost is written up in `docs/protocol-reference.md`.
 */
const ROLLUP_REFUSAL =
  "GraphQL: Resource not accessible by personal access token (repository.pullRequest.statusCheckRollup.contexts.nodes.0)";

/**
 * A `gh` on `PATH` that answers both halves and logs every call. `mode` is what the
 * expensive half does: answer, or refuse the way a box with no token refuses.
 *
 * DISPATCH IS ON THE WHOLE ARGV, not on `$2`: `gh api repos/…` puts a URL where `pr view`
 * puts a subcommand, and a shim reading one position sends the substitute read of thread
 * 166 down the default branch instead of answering it.
 */
const ghShim = (
  repo: string,
  options: {
    readonly thread: string;
    readonly mode?: "ready" | "refuse" | "in-review" | "refuse-rollup" | "refuse-rollup-and-runs";
  },
): { readonly bin: string; readonly calls: () => string[] } => {
  const dir = join(repo, "ghbin");
  mkdirSync(dir, { recursive: true });
  const log = join(repo, "gh-calls.log");
  const open = JSON.stringify([
    {
      number: 154,
      headRefOid: HEAD,
      body: `thread: ${options.thread}\nrole: dev-core\n`,
      // The label rides on the cheap half, which is the whole point of reading it there.
      labels: options.mode === "in-review" ? [{ name: "review" }] : [],
    },
  ]);
  const refusesRollup =
    options.mode === "refuse-rollup" || options.mode === "refuse-rollup-and-runs";
  const expensive =
    options.mode === "refuse"
      ? 'echo "gh: no token" >&2; exit 1'
      : options.mode === "in-review"
        ? `cat <<'JSON'\n${inReviewPayload(options.thread)}\nJSON`
        : `cat <<'JSON'\n${readyPayload(options.thread)}\nJSON`;
  // The rollup-refusing box answers the SECOND ask — the same fields without that node.
  const withRollup = refusesRollup
    ? `echo ${JSON.stringify(ROLLUP_REFUSAL)} >&2; exit 1`
    : expensive;
  const withoutRollup = refusesRollup
    ? `cat <<'JSON'\n${withoutRollupPayload(options.thread)}\nJSON`
    : expensive;
  const api =
    options.mode === "refuse-rollup"
      ? `cat <<'JSON'\n${RUNS}\nJSON`
      : 'echo "gh: no token for Actions either" >&2; exit 1';
  const script = [
    "#!/bin/sh",
    `echo "$@" >> ${JSON.stringify(log)}`,
    'case "$*" in',
    `  "pr list"*) cat <<'JSON'\n${open}\nJSON\n    ;;`,
    `  "pr view"*statusCheckRollup*) ${withRollup}`,
    "    ;;",
    `  "pr view"*) ${withoutRollup}`,
    "    ;;",
    `  "api"*) ${api}`,
    "    ;;",
    "  *) exit 1 ;;",
    "esac",
  ].join("\n");
  const bin = join(dir, "gh");
  writeFileSync(bin, `${script}\n`);
  chmodSync(bin, 0o755);
  return {
    bin: dir,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [],
  };
};

const status = (
  repo: string,
  options: { readonly path?: string; readonly extra?: readonly string[] } = {},
): { code: number; out: string; err: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "orchestrator",
      "status",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      repo,
      ...(options.extra ?? []),
    ],
    {
      cwd: repo,
      encoding: "utf8",
      stdio: "pipe",
      env: sandbox(configHome(repo), {
        ...(options.path === undefined
          ? {}
          : { PATH: `${options.path}:${process.env.PATH ?? ""}` }),
      }),
    },
  );
  // THE FRAME AND THE COMPLAINT ARE READ APART, deliberately: the picture is stdout, and
  // a note about a quiet GitHub must never be inside it.
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

describe("`orchestrator status` orders by the merge a thread holds — the tick's facts, not its own", () => {
  it("a thread holding a merge-ready PR goes ABOVE an older wait, in the words of what was measured", () => {
    const repo = contour([
      { id: "003-old", message: handoff({ date: "2026-07-01T10:00:00Z" }) },
      { id: "019-operator-ux", message: handoff({ date: "2026-07-25T10:00:00Z" }) },
    ]);
    const gh = ghShim(repo, { thread: "019-operator-ux" });

    const result = status(repo, { path: gh.bin });

    // The younger wait first, and BECAUSE of the measured fact — the line says which PR
    // and which guards, never "merge-ready" (guards 3 and 5 are not computed here).
    expect(result.out).toContain(
      "queue 1/2: dev-core×019-operator-ux — priority normal, waiting since 2026-07-25T10:00:00Z · guards 1-2 hold on PR #154",
    );
    expect(result.out).toContain("queue 2/2: dev-core×003-old");
    // The note about the measurement is beside the picture, not in it.
    expect(result.out).not.toContain("merge-ready: 019");
    expect(result.err).toContain("merge-ready: 019-operator-ux — guards 1-2 hold on PR #154");
    // AND IT SAYS WHAT THE RAISE IS FOR (thread 024): the frame is the surface the sentence
    // was misread on — "raised ahead of the queue" full stop, on a pull request only john
    // may merge. The unit owns the words; this asserts they reach the reader's screen.
    expect(result.err).toContain("Guards 3-5 stay with a human");
    expect(result.err).toContain("document of power is john's button, not the pair's");
    expect(result.err).toContain("otherwise park behind it or report");
  });

  it("an explicit priority stays ABOVE a held merge — the frame's tiers are the tick's tiers", () => {
    const repo = contour([
      {
        id: "003-urgent",
        message: handoff({ date: "2026-07-01T10:00:00Z", priority: "high" }),
      },
      { id: "019-operator-ux", message: handoff({ date: "2026-07-25T10:00:00Z" }) },
    ]);
    const gh = ghShim(repo, { thread: "019-operator-ux" });

    const result = status(repo, { path: gh.bin });

    expect(result.out).toContain("queue 1/2: dev-core×003-urgent — priority high");
    expect(result.out).toContain("queue 2/2: dev-core×019-operator-ux");
    // The tier was still measured and still said — it just does not outrank a person.
    expect(result.out).toContain("guards 1-2 hold on PR #154");
  });

  it("a GitHub that refuses leaves the frame IDENTICAL to one with no tier at all", () => {
    const threads: readonly ThreadSpec[] = [
      { id: "003-old", message: handoff({ date: "2026-07-01T10:00:00Z" }) },
      { id: "019-operator-ux", message: handoff({ date: "2026-07-25T10:00:00Z" }) },
    ];
    const refusing = contour(threads);
    ghShim(refusing, { thread: "019-operator-ux", mode: "refuse" });
    const silent = contour(threads);

    // No `gh` on PATH at all is the other shape of the same outage.
    const withRefusal = status(refusing, { path: join(refusing, "ghbin") });
    const withoutGh = status(silent, { path: join(silent, "empty-bin") });

    const queue = (out: string): string[] =>
      out
        .split("\n")
        .filter((line) => line.trimStart().startsWith("queue "))
        .map((line) => line.replace(/[^ ]*agent-protocol-frame-ready-[^ ]*/g, "<repo>"));
    expect(queue(withRefusal.out)).toEqual(queue(withoutGh.out));
    expect(queue(withRefusal.out)[0]).toContain("dev-core×003-old");
    expect(withRefusal.code).toBe(0);
    // The complaint is said, and said OUTSIDE the picture: a frame that grew an error
    // line because GitHub was quiet would be worse than no tier at all.
    expect(withRefusal.err).toContain("PR #154 (019-operator-ux) not read");
    expect(withRefusal.out).not.toContain("merge-ready:");
    expect(withRefusal.out).not.toContain("queue 1/2: dev-core×019-operator-ux");
  });

  /**
   * THE SEAM OF THREAD 166 — the tier's half of the repair thread 160 gave the door. The
   * class is measured, not supposed: on a private repository a fine-grained token is
   * refused `statusCheckRollup.contexts.nodes` and `gh pr view` then answers NOTHING, so
   * the expensive half threw for every pull request there was. Neither the unit of the
   * reader nor the unit of the gate can see it: the ask, the refusal and the second ask
   * all live in the CLI's `gh` source, and only a run through the real wiring reaches it.
   */
  it("a rollup GitHub refuses is re-asked without that node, and the tier still fires", () => {
    const repo = contour([
      { id: "003-old", message: handoff({ date: "2026-07-01T10:00:00Z" }) },
      { id: "019-operator-ux", message: handoff({ date: "2026-07-25T10:00:00Z" }) },
    ]);
    const gh = ghShim(repo, { thread: "019-operator-ux", mode: "refuse-rollup" });

    const result = status(repo, { path: gh.bin });

    // The pair is raised — the same sentence as with a rollup that was never refused.
    expect(result.out).toContain("queue 1/2: dev-core×019-operator-ux");
    expect(result.out).toContain("guards 1-2 hold on PR #154");
    // And it was earned the hard way: the first ask carried the node, the second dropped
    // it, and the checks came from the runs of Actions on the head.
    const calls = gh.calls();
    expect(calls.filter((line) => line.startsWith("pr view")).length).toBe(2);
    expect(calls.filter((line) => line.includes("statusCheckRollup")).length).toBe(1);
    expect(calls.filter((line) => line.startsWith("api"))).toHaveLength(1);
    expect(calls.some((line) => line.includes(`actions/runs?head_sha=${HEAD}`))).toBe(true);
  });

  it("both sources refused is NOT READ, said out loud — never the silence of 'not ready'", () => {
    const repo = contour([
      { id: "003-old", message: handoff({ date: "2026-07-01T10:00:00Z" }) },
      { id: "019-operator-ux", message: handoff({ date: "2026-07-25T10:00:00Z" }) },
    ]);
    const gh = ghShim(repo, { thread: "019-operator-ux", mode: "refuse-rollup-and-runs" });

    const result = status(repo, { path: gh.bin });

    // The order is the order of a circuit without the tier — the degradation is unchanged.
    expect(result.out).toContain("queue 1/2: dev-core×003-old");
    expect(result.out).not.toContain("guards 1-2 hold");
    // But it is NOT silent, and it does not say "not ready": that is the whole defect.
    expect(result.err).toContain("PR #154 (019-operator-ux) — the checks were NOT READ");
    expect(result.err).toContain("repository.pullRequest.statusCheckRollup.contexts.nodes.0");
    expect(result.err).toContain("This is 'no access', NOT 'not ready'");
    // Beside the picture, never inside it (the rule the whole file is written by).
    expect(result.out).not.toContain("NOT READ");
  });

  it("`--watch` asks the network ONCE, not once per frame — a reader is not a poll", () => {
    const repo = contour([
      { id: "003-old", message: handoff({ date: "2026-07-01T10:00:00Z" }) },
      { id: "019-operator-ux", message: handoff({ date: "2026-07-25T10:00:00Z" }) },
    ]);
    const gh = ghShim(repo, { thread: "019-operator-ux" });

    const result = status(repo, {
      path: gh.bin,
      extra: ["--watch", "--frames", "3", "--interval", "1"],
    });

    // Three frames, and the cheap half of the read happened once: the tier is refreshed
    // on a floor of its own, not on the redraw interval.
    expect(result.out.split("queue 1/2").length - 1).toBe(3);
    expect(gh.calls().filter((line) => line.startsWith("pr list"))).toHaveLength(1);
    // The expensive half was asked for one head, once — a head that has not moved is
    // never asked about twice, in the frame as in the tick.
    expect(gh.calls().filter((line) => line.startsWith("pr view"))).toHaveLength(1);
    // And every frame still carries the tier: the reading is reused, not dropped.
    expect(result.out.split("guards 1-2 hold on PR #154").length - 1).toBe(3);
  });
});

/**
 * §5 STATE 2 — the pair that hung the label and passed the turn (thread 063). The seam this
 * case exists for is not the reader (that is unit-tested) but the CHAIN: the config on disk
 * names the label, the cheap half of the `gh` read carries it, the reader turns it into a
 * state and the frame prints the sentence a human reads. §11 of `docs/state-model.md` is why
 * the line is asserted WHOLE — two different states there printed one phrase, and only
 * reading the row entire could see it.
 */
describe("`orchestrator status` says WAITING FOR A ROUND OF REVIEW where it used to say nothing", () => {
  it("prints the row whole, caveat included, and never beside the merge tier", () => {
    const repo = contour([
      { id: "063-state-model-rewrite", message: handoff({ date: "2026-09-03T10:00:00Z" }) },
    ]);
    const gh = ghShim(repo, { thread: "063-state-model-rewrite", mode: "in-review" });

    const result = status(repo, { path: gh.bin });

    expect(result.out).toContain(
      "queue 1/1: dev-core×063-state-model-rewrite — priority normal, waiting since 2026-09-03T10:00:00Z · ⏳ WAITING FOR A ROUND OF REVIEW — the label is on PR #154 and no verdict stands against the head it has now. Whether the round is still running or the label was left on a head that has since moved is NOT asked (that is an Actions call per pull request per tick) — if nothing has answered for long, look at the head before waiting further",
    );
    // The older tier is silent about it, and no Actions call was made for the caveat.
    expect(result.out).not.toContain("guards 1-2 hold");
    expect(gh.calls().filter((line) => line.startsWith("api"))).toHaveLength(0);
  });

  it("the same pull request with an approve on the head is the OTHER state, not this one", () => {
    const repo = contour([
      { id: "063-state-model-rewrite", message: handoff({ date: "2026-09-03T10:00:00Z" }) },
    ]);
    // Same label, same head — only the verdict differs, and that is the whole distinction.
    const gh = ghShim(repo, { thread: "063-state-model-rewrite", mode: "ready" });

    const result = status(repo, { path: gh.bin });

    expect(result.out).toContain("guards 1-2 hold on PR #154");
    expect(result.out).not.toContain("WAITING FOR A ROUND OF REVIEW");
  });
});
