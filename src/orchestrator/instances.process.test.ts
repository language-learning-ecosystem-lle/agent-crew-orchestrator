/**
 * TWO BOXES, ONE MAIL BRANCH — the process test of the instance digest (R13, S18).
 *
 * A unit test proves the digest's shape and the rules around it (`instances.test.ts`);
 * what it cannot reach is the seam this file exists for: the digest is WRITTEN by a
 * daemon into a git checkout it shares with another machine and READ back by `status`
 * out of that same branch. Everything that can actually go wrong lives in that seam —
 * whether the file is committed at all, whether an unchanged tick commits again, and
 * whether one box's state survives the other box writing beside it.
 *
 * THE SECOND INSTANCE IS SYNTHETIC, and deliberately so: there is one machine in this
 * project today. Its digest is planted by hand in the mail branch, which is exactly
 * what the other box would have left behind — the reader has no way to tell a file
 * written by a daemon from the same bytes written by a test, and that is the point of
 * publishing through git rather than asking over a socket.
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
import { parseDigest } from "./instances.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  // The topology of the test: one role each, on two boxes. `box-b` never runs here —
  // it exists so that `box-a` has somebody to leave a role to, and somebody to read.
  instances: [
    { id: "box-a", roles: ["dev-core"] },
    { id: "box-b", roles: ["dev-speech"] },
  ],
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
      id: "dev-speech",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s2" },
      summary: "the voice",
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
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
    },
  ],
};

const meta = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const handoff =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/** A digest exactly as the other machine's daemon would have left it. */
const foreignDigest = (writtenAt: string): string =>
  `${JSON.stringify(
    {
      instance: "box-b",
      writtenAt,
      roles: ["dev-speech"],
      leases: [
        {
          role: "dev-speech",
          thread: "004-speech",
          state: "running",
          deadline: "2026-07-25T12:00:00.000Z",
        },
      ],
    },
    null,
    2,
  )}\n`;

type Contour = { readonly repo: string; readonly mail: string; readonly local: string };

const contour = (
  options: {
    readonly instance?: string;
    readonly foreign?: string;
    /** Make `git commit` in the mail checkout fail — the runner's failure, deterministically. */
    readonly commitFails?: boolean;
    /**
     * A topology in place of the default two-boxes-one-role-each. Used where the point is
     * a box that answers for MORE THAN ONE role — the case in which the operator's flags
     * used to shrink the published `roles` (thread 025, second half).
     */
    readonly topology?: readonly { readonly id: string; readonly roles: readonly string[] }[];
  } = {},
): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-digest-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(
      options.topology === undefined ? CONFIG : { ...CONFIG, instances: options.topology },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  // The identity is CONFIGURED IN THE CHECKOUT, not passed per call: the daemon's
  // delivery runs plain `git commit`, exactly as it does in production. The runner is
  // where this matters — a checkout with no `user.email` there is how the first version
  // of this file went red while it was green on a developer machine.
  git(mail, "config", "user.name", "t");
  git(mail, "config", "user.email", "t@e");
  git(mail, "checkout", "-q", "--orphan", "comms");
  const dir = join(mail, "agent-comms", "016-protocol-roadmap");
  mkdirSync(join(dir, "messages"), { recursive: true });
  writeFileSync(join(dir, "_meta.md"), meta);
  writeFileSync(join(dir, "messages", "2026-07-25T10-00-00Z-curator.md"), handoff);
  if (options.foreign !== undefined) {
    mkdirSync(join(mail, "agent-comms", "_instances"), { recursive: true });
    writeFileSync(join(mail, "agent-comms", "_instances", "box-b.json"), options.foreign);
  }
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");

  const local = join(base, "local.json");
  writeFileSync(
    local,
    `${JSON.stringify({ ...(options.instance === undefined ? {} : { instance: options.instance }) }, null, 2)}\n`,
  );
  if (options.commitFails === true) {
    // A pre-commit hook that refuses. The runner's own version of this was a checkout
    // with no `user.email`, but that one is not reproducible on a developer machine —
    // the global config supplies the identity and the commit succeeds. What the test
    // needs is only that `git commit` fails AFTER delivery has staged the file.
    // OUTSIDE the checkout: an untracked directory inside it is a dirty mail checkout,
    // and the daemon refuses to read mail at all before it gets anywhere near publishing.
    const hooks = join(base, "githooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(hooks, "pre-commit"), 0o755);
    git(mail, "config", "core.hooksPath", hooks);
  }
  return { repo, mail, local };
};

const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

const enable = (repo: string): void => {
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(join(repo, ".orchestrator", "enabled"), "", "utf8");
};

const cli = (contour: Contour, args: readonly string[]): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      ...args,
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      contour.repo,
      "--local-config",
      contour.local,
    ],
    {
      cwd: contour.repo,
      encoding: "utf8",
      stdio: "pipe",
      env: sandbox(configHome(contour.repo)),
    },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const daemon = (contour: Contour): { code: number; out: string } =>
  cli(contour, ["orchestrator", "daemon", "--once", "--exec", stub(contour.repo), "--poll", "1"]);

/** THE MANUAL LAUNCH — the other holder of a lease on this box (thread 025, second half). */
const run = (
  contour: Contour,
  extra: readonly string[] = ["--write"],
): { code: number; out: string } =>
  cli(contour, [
    "orchestrator",
    "run",
    "--role",
    "dev-core",
    "--thread",
    "016-protocol-roadmap",
    "--exec",
    stub(contour.repo),
    "--wall-clock",
    "20",
    "--poll",
    "1",
    ...extra,
  ]);

const digestOnDisk = (contour: Contour, id: string): string | undefined => {
  const path = join(contour.mail, "agent-comms", "_instances", `${id}.json`);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};

const commitsOnComms = (contour: Contour): number =>
  Number(git(contour.mail, "rev-list", "--count", "origin/comms").trim());

/**
 * EVERY VERSION OF ONE BOX'S DIGEST THAT EVER LANDED, oldest first — because the state
 * this file is about is one the last version cannot show. A lease exists only while the
 * session runs, and the session is over by the time the tick ends; the only place its
 * publication can be seen is the history of the file.
 */
const digestHistory = (contour: Contour, id: string): readonly string[] => {
  const path = `agent-comms/_instances/${id}.json`;
  return git(contour.mail, "log", "--reverse", "--format=%H", "origin/comms", "--", path)
    .split("\n")
    .filter((line) => line !== "")
    .map((sha) => git(contour.mail, "show", `${sha}:${path}`));
};

describe("a box publishes its own state into the mail branch (R13)", () => {
  it("the tick leaves a committed and pushed digest naming what this box was doing", () => {
    const bench = contour({ instance: "box-a" });
    enable(bench.repo);

    const result = daemon(bench);
    expect(result.out).toContain("publishing state as instance 'box-a'");

    const raw = digestOnDisk(bench, "box-a");
    expect(raw).toBeDefined();
    const read = parseDigest(raw ?? "");
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.digest.instance).toBe("box-a");
      // The roles of THIS box, not of the circuit: `dev-speech` belongs to box-b.
      expect(read.digest.roles).toEqual(["dev-core"]);
    }
    // Committed and PUSHED, not merely written: a digest on one disk is exactly the
    // failure the delivery path exists to prevent.
    expect(git(bench.mail, "status", "--porcelain")).toBe("");
    expect(git(bench.mail, "show", "origin/comms:agent-comms/_instances/box-a.json")).toBe(raw);
  });

  it("the lease of a live session reaches the branch — a busy box never publishes itself as idle", () => {
    // THE DEFECT OF THREAD 025, PINNED. The digest used to be published at ONE point,
    // the end of the tick — after the run inside it had already released its lease. So
    // every tick computed `leases: []`, the change check said "same as last time", and
    // nothing was written at all: four hours and six sessions with a digest that read as
    // current and said the box was idle. What the fix moves is not the content but the
    // MOMENT, so what this test reads is the history of the file, not its last version.
    const bench = contour({ instance: "box-a" });
    enable(bench.repo);

    daemon(bench);

    const published = digestHistory(bench, "box-a").map((raw) => parseDigest(raw));
    expect(published.every((read) => read.ok)).toBe(true);
    const everSeen = published.flatMap((read) =>
      read.ok
        ? read.digest.leases.map((lease) => `${lease.role}/${lease.thread} ${lease.state}`)
        : [],
    );
    expect(everSeen).toContain("dev-core/016-protocol-roadmap running");

    // AND THE LAST WORD IS STILL THE TRUTH: the session ended inside the same tick, so
    // the state left on the branch is an idle box. A digest that got stuck naming a lease
    // nobody holds would be the same lie the other way round.
    const last = parseDigest(digestOnDisk(bench, "box-a") ?? "");
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.digest.leases).toEqual([]);
  });

  it("a second tick that changed nothing does NOT commit again — the branch is not a heartbeat log", () => {
    const bench = contour({ instance: "box-a" });
    // Launches stay DISABLED: the state of the box is then identical between the two
    // ticks, which is precisely the case a timestamp-only write would commit twice.
    daemon(bench);
    const after = commitsOnComms(bench);
    daemon(bench);
    expect(commitsOnComms(bench)).toBe(after);
  });

  it("without a declared instance the box publishes nothing, and says so", () => {
    // The topology IS declared here while the machine stays nameless — which the scope
    // door refuses outright (S17). The digest writer is downstream of that refusal, so
    // what this pins is that the refusal happens first and nothing is published.
    const bench = contour();
    const result = daemon(bench);
    expect(result.code).toBe(2);
    expect(result.out).toContain("does not know which instance it is");
    expect(digestOnDisk(bench, "box-a")).toBeUndefined();
  });

  it("the other box's digest is left alone — one file per box, no shared path", () => {
    const bench = contour({
      instance: "box-a",
      foreign: foreignDigest("2026-07-25T11:00:00.000Z"),
    });
    enable(bench.repo);

    daemon(bench);

    expect(digestOnDisk(bench, "box-b")).toBe(foreignDigest("2026-07-25T11:00:00.000Z"));
    expect(digestOnDisk(bench, "box-a")).toBeDefined();
  });
});

describe("a MANUAL run publishes the state of its box too (R13, thread 025 part two)", () => {
  it("the lease of a hand-typed run reaches the branch — not only the daemon's", () => {
    // The second half of the defect: the only publisher lived inside the daemon, so a box
    // busy with `orchestrator run` published a fresh `writtenAt` and `leases: []`. The
    // reader who needs the file is the one who is NOT at this terminal, and to them that
    // is indistinguishable from an idle box.
    const bench = contour({ instance: "box-a" });

    const result = run(bench);
    expect(result.out).toContain("run — publishing state as instance 'box-a'");

    const everSeen = digestHistory(bench, "box-a")
      .map((raw) => parseDigest(raw))
      .flatMap((read) =>
        read.ok
          ? read.digest.leases.map((lease) => `${lease.role}/${lease.thread} ${lease.state}`)
          : [],
      );
    expect(everSeen).toContain("dev-core/016-protocol-roadmap running");

    // And the last word is an idle box: the session is over by the time the run returns.
    const last = parseDigest(digestOnDisk(bench, "box-a") ?? "");
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.digest.leases).toEqual([]);
  });

  it("the operator's flags do not shrink the roles of the box — `roles` is the topology", () => {
    // THE CONTRACT CHANGE, PINNED. `roles` used to mean "what THIS RUN raises", so a
    // single-role launch on a two-role box overwrote the daemon's list and the box read as
    // having shrunk. It now means "the roles this box answers for", identical for both
    // writers; what this launch raises is carried by `leases`, as a fact.
    const bench = contour({
      instance: "box-a",
      topology: [{ id: "box-a", roles: ["dev-core", "dev-speech"] }],
    });

    run(bench, ["--write", "--roles", "dev-core"]);

    const published = digestHistory(bench, "box-a").map((raw) => parseDigest(raw));
    expect(published.length).toBeGreaterThan(0);
    for (const read of published) {
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.digest.roles).toEqual(["dev-core", "dev-speech"]);
    }
  });

  it("a dry run publishes nothing — it plans, it holds no lease", () => {
    const bench = contour({ instance: "box-a" });
    const result = run(bench, []);
    expect(result.code).toBe(0);
    expect(digestOnDisk(bench, "box-a")).toBeUndefined();
  });
});

describe("`status` reads the other boxes out of the branch (R13)", () => {
  it("both instances are shown, this one is marked, and a stale digest is called out", () => {
    const bench = contour({
      instance: "box-a",
      foreign: foreignDigest("2026-07-25T11:00:00.000Z"),
    });
    enable(bench.repo);
    daemon(bench);

    const result = cli(bench, ["orchestrator", "status"]);

    expect(result.out).toContain("box-a (this box)");
    expect(result.out).toContain("box-b");
    // What box-b was doing — read from a file, never asked for over a wire.
    expect(result.out).toContain("dev-speech/004-speech");
    // Planted in the past, so the reader's tolerance has long since run out.
    expect(result.out).toContain("STALE");
  });

  it("a box the topology declares with NO roles is a bench — its ancient digest raises no ⚠ (055)", () => {
    const bench = contour({
      instance: "box-a",
      // The digest is as old as the one called STALE above, and says so itself.
      foreign: foreignDigest("2026-07-25T11:00:00.000Z"),
      // …but `box-b` answers for nobody now: no daemon of its own will ever rewrite it.
      // The id is kept declared on purpose — that is what a bench is for.
      topology: [
        { id: "box-a", roles: ["dev-core", "dev-speech"] },
        { id: "box-b", roles: [] },
      ],
    });
    enable(bench.repo);
    daemon(bench);

    const result = cli(bench, ["orchestrator", "status"]);

    expect(result.out).toContain("bench — the repository declares it with no roles");
    // The wiring is the point: the CLI must read the TOPOLOGY, not `box-b`'s own file,
    // which still claims `roles: ["dev-speech"]` and would have kept the ⚠ alight.
    expect(result.out).not.toContain("⚠ STALE");
    // The file's age is still on screen — explained, not hidden.
    expect(result.out).toContain("2026-07-25T11:00:00.000Z");
  });

  it("a digest that does not parse is named beside the ones that do", () => {
    const bench = contour({ instance: "box-a", foreign: "{ not json\n" });

    const result = cli(bench, ["orchestrator", "status"]);

    expect(result.out).toContain("box-b.json was not read");
  });
});

describe("`check` knows `_instances/` as a class (R13)", () => {
  const check = (bench: Contour): { code: number; out: string } =>
    cli(bench, ["check", "--root", join(bench.mail, "agent-comms")]);

  it("a well-formed digest of a declared box is not a finding", () => {
    const bench = contour({
      instance: "box-a",
      foreign: foreignDigest("2026-07-25T11:00:00.000Z"),
    });
    const result = check(bench);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("_instances");
  });

  it("a digest of a box the repository does not declare is a finding", () => {
    const bench = contour({
      instance: "box-a",
      foreign: foreignDigest("2026-07-25T11:00:00.000Z").replace("box-b", "box-z"),
    });
    const result = check(bench);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("the file name is the identity");
  });

  it("something that is not a digest in the class directory is a finding", () => {
    const bench = contour({ instance: "box-a" });
    mkdirSync(join(bench.mail, "agent-comms", "_instances"), { recursive: true });
    writeFileSync(join(bench.mail, "agent-comms", "_instances", "notes.md"), "hi\n");
    const result = check(bench);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("is not a digest");
  });
});

describe("a delivery that fails leaves the mail checkout clean (R13)", () => {
  it("the half-written digest is undone — one failed status line must not block everybody's mail", () => {
    // `git commit` in the mail checkout fails after delivery has staged the file — the
    // shape of the runner failure. What is pinned is the state AFTERWARDS:
    // delivery refuses a dirty checkout, so a leftover here would block the next digest
    // and every message any role sends from this box.
    const bench = contour({ instance: "box-a", commitFails: true });
    enable(bench.repo);

    const result = daemon(bench);

    expect(result.out).toContain("the instance digest was NOT published");
    expect(git(bench.mail, "status", "--porcelain")).toBe("");
    expect(digestOnDisk(bench, "box-a")).toBeUndefined();
    // The box itself kept working: the tick still raised its pair.
    expect(existsSync(join(bench.repo, ".orchestrator", "journal.jsonl"))).toBe(true);
  });
});
