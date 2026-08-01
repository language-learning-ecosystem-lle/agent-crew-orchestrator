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
 * A `gh` on `PATH` that answers both halves and logs every call. `mode` is what the
 * expensive half does: answer, or refuse the way a box with no token refuses.
 */
const ghShim = (
  repo: string,
  options: { readonly thread: string; readonly mode?: "ready" | "refuse" },
): { readonly bin: string; readonly calls: () => string[] } => {
  const dir = join(repo, "ghbin");
  mkdirSync(dir, { recursive: true });
  const log = join(repo, "gh-calls.log");
  const open = JSON.stringify([
    { number: 154, headRefOid: HEAD, body: `thread: ${options.thread}\nrole: dev-core\n` },
  ]);
  const expensive =
    options.mode === "refuse"
      ? 'echo "gh: no token" >&2; exit 1'
      : `cat <<'JSON'\n${readyPayload(options.thread)}\nJSON`;
  const script = [
    "#!/bin/sh",
    `echo "$@" >> ${JSON.stringify(log)}`,
    'case "$2" in',
    `  list) cat <<'JSON'\n${open}\nJSON\n    ;;`,
    `  view) ${expensive}`,
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
