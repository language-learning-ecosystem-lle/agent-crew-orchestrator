/**
 * THE SEAM BETWEEN A FAILED DELIVERY AND THE CREDENTIAL DOOR (thread 140, 2026-09-06).
 *
 * The field case, and it cost three days. The role `devops` was raised four times
 * (03.09 02:06:15Z, 02:12:18Z, 02:18:56Z; 06.09 10:22:12Z), and every one of those runs died
 * on the first command of its tick with
 *
 *     git fetch --quiet origin comms failed (code 128): ssh: Could not resolve…
 *
 * and NOT ONE WORD about a login — while `platformEnvOf` had been assembled one line above the
 * refusal and already knew which secrets file the machine config named, whether it existed and
 * whether it carried a token. The exits read as "the network is down"; the fact was "the token
 * is not in the home of the user this role runs as". A door that refuses without naming what to
 * fix is a defect even when its logic is right.
 *
 * WHY A PROCESS TEST AND NOT A UNIT. `gitIn` is private to `cli.ts` and its `platform` is
 * assembled from the MACHINE config of the box — the two things a unit would have to fake are
 * exactly the two the defect lived between. The witness here is the real CLI, spawned as a real
 * process with a config home of the test's own, delivering into a mail checkout whose origin
 * cannot be reached.
 *
 * BOTH BRANCHES, because the enrichment must not become a gate and must not become noise:
 *
 *  1. no credential assembled → the refusal carries git's own words AND names the secrets file
 *     and the reason;
 *  2. a credential assembled → the same git words and NOT A SYLLABLE of credential diagnosis
 *     (`not.toContain`), because a fetch that failed for a reason of its own must not be
 *     dressed up as a login problem.
 *
 * WHAT IS DELIBERATELY NOT COVERED, and it is a boundary rather than an omission: that the
 * diagnosis is TRUE for the account `aco-devops` cannot be asserted here. It needs a second user
 * on the box, which CI does not have. That half is the first raise of `devops` after john's hand
 * lays out the secrets file (`docs/box-setup.md` §0.1b), and it is named as such in the thread.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

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

type Contour = { readonly repo: string; readonly root: string; readonly body: string };

/**
 * A circuit whose mail checkout POINTS AT A REMOTE THAT IS NOT THERE — the shape of the field
 * case without its network: `git fetch origin comms` exits 128 saying so in its own words, and
 * that is the refusal this file is about.
 */
const contour = (): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-140-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "140-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");

  // The remote leaves. Everything local still works — status, commit, the lock — and the one
  // call that reaches out is the one that dies, which is precisely the field case.
  git(mail, "remote", "set-url", "origin", join(base, "gone.git"));

  const body = join(base, "body.md");
  writeFileSync(body, "The answer.\n");
  return { repo, root: join(mail, "agent-comms"), body };
};

/** The machine config of the box, naming (or not naming) a secrets file. */
const machineConfig = (repo: string, extra: Record<string, unknown>): void => {
  const dir = join(configHome(repo), "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local.json"), `${JSON.stringify({ agents: {}, ...extra }, null, 2)}\n`);
};

/** A delivery that is going to fail on the fetch; everything it said, on either channel. */
const deliver = (contest: Contour, env: NodeJS.ProcessEnv = {}): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-message",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--thread",
        "140-x",
        "--from",
        "dev-core",
        "--expects",
        "answer",
        "--waiting-on",
        "curator",
        "--body-file",
        contest.body,
        "--worker",
        "claude-code",
        "--write",
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHome(contest.repo), env) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("a delivery that cannot reach the remote says whether it had a login (thread 140)", () => {
  it("no credential anywhere → the refusal names the secrets file and the reason", () => {
    const contest = contour();
    const missing = join(configHome(contest.repo), "not-here.env");
    mkdirSync(configHome(contest.repo), { recursive: true });
    machineConfig(contest.repo, { secrets: { envFile: missing } });

    const said = deliver(contest);

    // The fact git returned is still the fact, printed whole: the diagnosis JOINS the reason,
    // it does not replace it.
    expect(said.code).toBe(2);
    expect(said.out).toContain("git fetch --quiet origin comms failed (code 128)");
    // …and this is the sentence whose absence read as "the network is down" for three days.
    expect(said.out).toContain("no credential for GitHub");
    expect(said.out).toContain(missing);
    expect(said.out).toContain("does not exist");
  }, 60_000);

  it("the machine config names a file that carries no token → the refusal says which names it has", () => {
    const contest = contour();
    const path = join(configHome(contest.repo), "secrets.aco.env");
    mkdirSync(configHome(contest.repo), { recursive: true });
    // Never a value, and this one could not be a token by accident: what a human needs is
    // which VARIABLES the file carries, and the door answers exactly that.
    writeFileSync(path, "TELEGRAM_BOT_TOKEN=t-42\n");
    machineConfig(contest.repo, { secrets: { envFile: path } });

    const said = deliver(contest);

    expect(said.code).toBe(2);
    expect(said.out).toContain("git fetch --quiet origin comms failed (code 128)");
    expect(said.out).toContain("no credential for GitHub");
    expect(said.out).toContain(path);
    expect(said.out).toContain("TELEGRAM_BOT_TOKEN");
    expect(said.out).not.toContain("t-42");
  }, 60_000);

  it("a credential IS assembled → git's words alone, and not a syllable about a login", () => {
    // THE OTHER HALF, and the one that keeps this an enrichment instead of a new noise: a
    // fetch can fail for a hundred reasons that have nothing to do with a token, and a door
    // that appended "no credential for GitHub" to all of them would send the next reader
    // hunting a file that is exactly where it should be.
    const contest = contour();
    const path = join(configHome(contest.repo), "secrets.aco.env");
    mkdirSync(configHome(contest.repo), { recursive: true });
    writeFileSync(path, "GH_TOKEN=ghp_140_seam_do_not_print_me\n");
    machineConfig(contest.repo, { secrets: { envFile: path } });

    const said = deliver(contest);

    expect(said.code).toBe(2);
    expect(said.out).toContain("git fetch --quiet origin comms failed (code 128)");
    expect(said.out).not.toContain("no credential for GitHub");
    expect(said.out).not.toContain("ghp_140_seam_do_not_print_me");
  }, 60_000);
});
