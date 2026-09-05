/**
 * THE SEAM OF THE TIDY-UP LETTER (thread `099-dirty-tree-locks-the-role`, item C —
 * curator's acceptance, msg-030 §4) — the three facts `tidy-letter.test.ts` cannot hold.
 *
 * The units beside `planTidyUpLetter` prove WHICH letter a set of tidy-up facts produces:
 * the addressee, the body, the argv. They prove nothing about whether that argv is one
 * `new-message` accepts, whether the letter reaches a feed, or what happens when the
 * delivery refuses — every one of them builds its own expectation of the door and none of
 * them ever calls it. That is exactly the gap the same thread already paid for on the
 * `wip/*` branch names, and the reason `workspace.commit.process.test.ts` exists.
 *
 * So the three cases here are the three curator listed, and each one runs the REAL path:
 * a real contour, a real mail checkout, `settleRun` reached through `orchestrator run`,
 * and the letter read back out of the feed with `thread show` — not off the disk, because
 * "a file was written" and "a reader of the thread sees it" are two different statements.
 *
 *  1. the tidy-up WENT — the turn goes to the ROLE, and the letter names branch and sha;
 *  2. the tidy-up did NOT go — the turn goes to CURATOR, and the run still refuses;
 *  3. the DELIVERY refused — the tidy-up stands, the journal names what failed AND where
 *     the work is, and nothing anywhere claims the letter went. A silence in this third
 *     branch is the original defect of the thread reproduced one step later: work
 *     committed to a branch nobody was told about.
 *
 * The contour is the one `workspace.commit.process.test.ts` builds, with one thing added:
 * the roles the letter names have to EXIST in the config, because the door checks them —
 * and that check is also what makes case 3 cheap to provoke.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { TIDY_UP_SLUG } from "./tidy-letter.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const DEV_CORE = {
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "s" },
  summary: "the stream",
  instructions: [{ kind: "in-repo", path: "CARD.md" }],
  launch: { allowedTools: ["Bash"] },
};

/** The sender of the letter. `github-actions` is what the real config calls this role. */
const GITHUB = {
  id: "github",
  kind: "github-actions",
  status: "active",
  wake: { mode: "event" },
  summary: "the circuit's machine notifier",
};

/** The addressee of BOTH failing outcomes — and, when left out, the cause of case 3. */
const CURATOR = {
  id: "curator",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "c" },
  summary: "the coordinator",
};

const configWith = (roles: readonly unknown[]): unknown => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
  roles,
});

const META = (participants: string) =>
  `---\ntitle: T\nparticipants: ${participants}\nstatus: open\n---\n`;
const WAITING =
  "---\nfrom: github\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/**
 * The contour of `workspace.commit.process.test.ts`, parameterised by the roles in the
 * config — because whether `curator` is declared is the whole difference between a letter
 * that is delivered and one the door refuses.
 *
 * The seed message is from `github` in every case for the same reason: it is the only
 * sender that exists in all three configs, so the fixture does not change between them.
 */
const contour = (roles: readonly unknown[]): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-tidy-letter-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configWith(roles), null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META("dev-core, github"));
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-github.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, mail };
};

const stub = (repo: string, body: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

const runWith = (
  repo: string,
  extra: readonly string[],
  env: Record<string, string> = {},
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--poll",
        "1",
        "--wall-clock",
        "60",
        "--write",
        ...extra,
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo), env) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** The dirt is left by a REAL run that ended its own turn, exactly as in item A's test. */
const leaveDirtBehind = (repo: string, workspace: string): void => {
  runWith(repo, [
    "--exec",
    stub(
      repo,
      `printf 'edited by the session\\n' > ${workspace}/CARD.md\nprintf 'a new file\\n' > ${workspace}/NOTE.md`,
    ),
  ]);
};

/** The receiver of the standing address, as it stands in the feed — or nothing. */
const receiverOf = (mail: string): string | undefined =>
  readdirSync(join(mail, "agent-comms")).find((entry) => entry.endsWith(`-${TIDY_UP_SLUG}`));

/**
 * HOW MANY LETTERS STAND IN THE ADDRESS — counted as FILES, which is the measure of thread
 * 133: the defect being closed is a receiver a human reads filling up with one letter per
 * minute about one incident, and that is a count of files and nothing else.
 *
 * Every receiver of the address is counted, not only the newest: a lock that let the
 * second letter open a SECOND receiver would leave the first one at exactly one message
 * and pass a test that looked at one folder.
 */
const lettersIn = (mail: string): number =>
  readdirSync(join(mail, "agent-comms"))
    .filter((entry) => entry.endsWith(`-${TIDY_UP_SLUG}`))
    .reduce(
      (total, entry) =>
        total +
        readdirSync(join(mail, "agent-comms", entry, "messages")).filter((name) =>
          name.endsWith(".md"),
        ).length,
      0,
    );

/**
 * THE LETTER AS A READER OF THE THREAD SEES IT. Not `readFileSync` on the message: the
 * claim under test is that the letter ARRIVED, and a file in a directory the loader
 * rejects — a bad header, a sender the registry does not know, a thread that never got
 * its `_meta.md` — is a file, not an arrival.
 */
const readBack = (repo: string, mail: string, thread: string): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "thread",
      "show",
      "--root",
      join(mail, "agent-comms"),
      "--repo",
      repo,
      "--ref",
      "HEAD",
      "--thread",
      thread,
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );

/**
 * WHOSE TURN THE FEED SAYS IT IS, read by the queue's own reader rather than off the
 * message: `mail --role <id>` is literally what the tick consults to decide whom to
 * raise, so a letter this does not surface raises nobody — which is the failure mode the
 * whole item exists to close.
 */
const turnsOf = (repo: string, mail: string, role: string): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "mail",
      "--root",
      join(mail, "agent-comms"),
      "--repo",
      repo,
      "--ref",
      "HEAD",
      "--role",
      role,
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );

const dirty = (workspace: string): boolean => git(workspace, "status", "--porcelain").trim() !== "";

/** The one service branch the tidy-up made, as git names it. */
const serviceBranch = (workspace: string): string =>
  git(workspace, "branch", "--list", "wip/*")
    .trim()
    .replace(/^\*?\s*/, "");

/** A `git` ahead of the real one that refuses exactly the commands matching `pattern`. */
const refusingGit = (repo: string, dir: string, pattern: string, message: string): string => {
  const shimDir = join(repo, dir);
  mkdirSync(shimDir, { recursive: true });
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const shim = join(shimDir, "git");
  writeFileSync(
    shim,
    `#!/bin/sh\ncase " $* " in *"${pattern}"*) echo "${message}" >&2 ; exit 128 ;; esac\nexec ${realGit} "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return shimDir;
};

describe("the outcome of a tidy-up leaves as a letter — through the real door, into a real feed", () => {
  it("the tidy-up WENT: the letter opens the standing address, names branch and sha, and hands the turn to the ROLE", () => {
    const { repo, mail } = contour([DEV_CORE, GITHUB, CURATOR]);
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);

    // THE JOURNAL SAYS IT WENT — and says nothing that could be read as a failure.
    expect(second.out).toContain(
      `letter — the outcome is posted to the standing address '${TIDY_UP_SLUG}', turn for 'dev-core'`,
    );
    expect(second.out).not.toContain("NOT DELIVERED");

    // …AND THE FEED AGREES. The receiver was OPENED by the delivery itself: there was no
    // thread of this address in the mail before the run, which is the half of
    // `--ensure-thread` a unit over the argv cannot reach.
    const receiver = receiverOf(mail);
    expect(receiver, `no receiver of '${TIDY_UP_SLUG}' in the feed`).toBeDefined();
    const shown = readBack(repo, mail, receiver as string);

    const branch = serviceBranch(workspace);
    expect(branch).toMatch(/^wip\/dev-core\/012-x-/);
    const head = git(workspace, "rev-parse", branch).trim();

    // THE ADDRESS OF THE WORK, which is the whole reason the letter exists — both halves.
    // The sha is matched against the one GIT wrote rather than compared to a literal: the
    // letter carries the abbreviated form, and asserting the abbreviation itself would
    // test git's `core.abbrev` instead of testing that the letter points at a real commit.
    expect(shown).toContain(branch);
    const said = /коммит `([0-9a-f]{7,40})`/.exec(shown);
    expect(said, "the letter names no commit at all").not.toBeNull();
    expect(head.startsWith((said as RegExpExecArray)[1] as string)).toBe(true);
    // …and never the placeholder that stands in when the tidy-up reported no head.
    expect(shown).not.toContain("`?`");
    expect(shown).toContain("from: github");
    expect(shown).not.toContain("Ход curator");

    // WHOSE TURN IT IS, taken from the QUEUE and not from the prose: the receiver is what
    // `mail --role dev-core` now lists, which is precisely how the role gets raised on an
    // address it has never written into.
    expect(turnsOf(repo, mail, "dev-core")).toContain(receiver as string);
    expect(turnsOf(repo, mail, "curator")).not.toContain(receiver as string);
    // …and the tidy-up itself is what the letter is about: the tree is clean and the role
    // is raisable, which is the state the letter claims.
    expect(dirty(workspace)).toBe(false);
  }, 180_000);

  it("the tidy-up did NOT go: the turn goes to CURATOR, the cause is in the letter, and the run still refuses", () => {
    const { repo, mail } = contour([DEV_CORE, GITHUB, CURATOR]);
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    // The shim refuses THE TIDY-UP'S commit and only it — matched on the `wip(` subject
    // the tidy-up writes. A blanket refusal of `commit` would also refuse the mail
    // checkout's own commit, and the test would then be measuring a broken delivery
    // instead of the failing-tidy-up branch of the letter (case 3 below does that on
    // purpose, and it has to stay a different case).
    const shimDir = refusingGit(repo, "gitshim", " -m wip(", "fatal: the index is broken");
    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], {
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    });

    expect(second.out).toContain(
      `letter — the outcome is posted to the standing address '${TIDY_UP_SLUG}', turn for 'curator'`,
    );
    // The refusal of the launch is NOT swallowed by the letter: the tree is still dirty
    // and the role still stands, exactly as it did before this right existed.
    expect(second.out).toContain("the commit FAILED");
    expect(dirty(workspace)).toBe(true);

    const receiver = receiverOf(mail);
    expect(receiver, `no receiver of '${TIDY_UP_SLUG}' in the feed`).toBeDefined();
    const shown = readBack(repo, mail, receiver as string);

    // WHAT THE FAILING HALF HAS TO CARRY: the cause git gave, and the turn on curator —
    // a turn addressed to the role here is one nobody could ever take, because the next
    // tick refuses the launch again.
    expect(shown).toContain("fatal: the index is broken");
    expect(shown).toContain("Ход curator");
    expect(shown).toContain(workspace);
    // …and it must not claim an address for work that was never committed.
    expect(shown).not.toContain("куда положено");

    // THE TURN IS CURATOR'S IN THE QUEUE TOO — and NOT the role's: a turn addressed to
    // `dev-core` here is one nobody could take, because its launch is refused every tick.
    expect(turnsOf(repo, mail, "curator")).toContain(receiver as string);
    expect(turnsOf(repo, mail, "dev-core")).not.toContain(receiver as string);
  }, 180_000);

  it("the DELIVERY refused: the tidy-up stands, the journal names the cause AND the work's address, and nothing claims it went", () => {
    // `curator` is NOT in this config, and the letter names it as a participant of the
    // receiver whichever outcome it carries — so `new-message` refuses at the door with
    // exit 2. The failure is provoked in the delivery and nowhere else: the tidy-up
    // itself touches no role but `dev-core`.
    const { repo, mail } = contour([DEV_CORE, GITHUB]);
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);

    const branch = serviceBranch(workspace);
    expect(branch).toMatch(/^wip\/dev-core\/012-x-/);
    const head = git(workspace, "rev-parse", branch).trim();

    // THE FAILURE IS A FACT OF ITS OWN, said out loud — a silent `catch` here is this
    // thread's original defect one step later.
    expect(second.out).toContain(
      `letter — NOT DELIVERED to the standing address '${TIDY_UP_SLUG}'`,
    );
    expect(second.out).toContain("turn for 'dev-core'");
    // WHAT EXACTLY REFUSED — the door's own sentence, carried through the exit code, so a
    // reader can fix the config without re-running anything.
    expect(second.out).toContain("'new-message' exited 2");
    expect(second.out).toContain("participant 'curator' is not listed in the config");
    // WHERE THE WORK IS. With the letter lost this line is the only trace of it, and a
    // failure line that named only the failure would leave the branch to git archaeology.
    // The sha is checked against git's, the same way the letter's is above.
    expect(second.out).toContain("The tidy-up itself STANDS");
    const trace = /committed as ([0-9a-f]{7,40}) on '(wip\/[^']+)'/.exec(second.out);
    expect(trace, "the failure line does not say where the work went").not.toBeNull();
    expect(head.startsWith((trace as RegExpExecArray)[1] as string)).toBe(true);
    expect((trace as RegExpExecArray)[2]).toBe(branch);

    // IT DOES NOT PASS FOR A SUCCESS, in the journal or in the feed.
    expect(second.out).not.toContain("the outcome is posted to the standing address");
    expect(receiverOf(mail), "a receiver was opened by a delivery that refused").toBeUndefined();

    // AND THE UNDELIVERED LETTER DOES NOT UNDO THE TIDY-UP: the tree is clean, back on
    // the base, and the work is whole inside the commit the line names.
    expect(dirty(workspace)).toBe(false);
    expect(git(workspace, "show", `${branch}:NOTE.md`)).toBe("a new file\n");
    // …so the role is raisable on the next tick — the point of item A, unharmed by the
    // failure of item C.
    const third = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"]);
    expect(third.out).not.toContain("uncommitted changes");
  }, 180_000);
});

/**
 * THE REPEAT, OVER TWO TICKS (thread `133-tidy-letter-repeats-every-tick`) — the fact one
 * tick cannot hold, and the reason the tests above missed the defect entirely: they each
 * measured a single run, and "one letter" and "one letter PER TICK" look the same there.
 *
 * The two classes are the two the probe on the live contour separated, and they must stay
 * two: they fail at DIFFERENT steps of the tidy-up and the state they leave the tree in is
 * different, so a single case would prove the lock for one of them and assume it for the
 * other.
 *
 * EVERY TICK IS ITS OWN PROCESS here, exactly as it is under the daemon. That is also the
 * answer to "does the lock survive a restart of the daemon": nothing of it is held in
 * memory, so the second run below reads the ledger of the first off the disk — which is
 * the same thing a daemon started a minute ago does.
 */
describe("a standing tidy-up failure gets ONE letter, not one per tick", () => {
  it("class 'nothing moved': the second tick posts NOTHING and says why — 1 letter, not 2", () => {
    const { repo, mail } = contour([DEV_CORE, GITHUB, CURATOR]);
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    // The FIRST step of the tidy-up refuses: the branch is never created, so nothing about
    // the tree changes between ticks and every tick plans exactly the same commit again.
    // This is the class the probe measured at 1 → 2.
    const shimDir = refusingGit(repo, "gitshim", " -b wip/", "fatal: cannot create branch");
    const env = { PATH: `${shimDir}:${process.env.PATH ?? ""}` };

    const first = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], env);
    expect(first.out).toContain(
      `letter — the outcome is posted to the standing address '${TIDY_UP_SLUG}', turn for 'curator'`,
    );
    expect(lettersIn(mail)).toBe(1);

    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], env);

    // R1 — THE COUNT, which is the whole requirement: the standing address holds one
    // letter about one incident after two ticks over the same standing dirt.
    expect(lettersIn(mail)).toBe(1);
    // R2 — AND THE TICK IS NOT SILENT ABOUT IT. A quiet suppression is indistinguishable
    // from a tidy-up that worked, which is the reason the second half of the requirement
    // exists at all: it says the incident was already told, and where the letter is.
    expect(second.out).toContain("letter — SUPPRESSED");
    expect(second.out).toContain(TIDY_UP_SLUG);
    expect(second.out).toContain("turn for 'curator'");
    expect(second.out).not.toContain("the outcome is posted to the standing address");
    // …and the incident itself is unchanged: the tree is still dirty and the launch is
    // still refused with its cause, exactly as on the first tick. The lock is on the
    // LETTER and on nothing else.
    expect(second.out).toContain("the commit FAILED");
    expect(dirty(workspace)).toBe(true);
  }, 240_000);

  it("A NEW incident over the same tree breaks the lock — a different cause is news (R3)", () => {
    const { repo, mail } = contour([DEV_CORE, GITHUB, CURATOR]);
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    const first = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], {
      PATH: `${refusingGit(repo, "gitshim", " -b wip/", "fatal: cannot create branch")}:${process.env.PATH ?? ""}`,
    });
    expect(first.out).toContain("the outcome is posted to the standing address");
    expect(lettersIn(mail)).toBe(1);

    // The SAME tree, the SAME step, a DIFFERENT answer from git. Nothing else moved — so
    // if the count stays at 1 here, the lock has swallowed a happening nobody was told
    // about, which is a worse defect than the flood it replaces.
    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], {
      PATH: `${refusingGit(repo, "gitshim2", " -b wip/", "fatal: index.lock exists")}:${process.env.PATH ?? ""}`,
    });
    expect(second.out).toContain("the outcome is posted to the standing address");
    expect(second.out).not.toContain("SUPPRESSED");
    expect(lettersIn(mail)).toBe(2);
    expect(readBack(repo, mail, receiverOf(mail) as string)).toContain("fatal: index.lock exists");
    expect(dirty(workspace)).toBe(true);
  }, 240_000);

  it("class 'branch made, commit refused': one letter over two ticks, and the second tick's own refusal is named", () => {
    const { repo, mail } = contour([DEV_CORE, GITHUB, CURATOR]);
    const workspace = join(repo, ".worktrees", "dev-core");

    leaveDirtBehind(repo, workspace);
    const env = {
      PATH: `${refusingGit(repo, "gitshim", " -m wip(", "fatal: the index is broken")}:${process.env.PATH ?? ""}`,
    };
    const first = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], env);
    expect(first.out).toContain("the outcome is posted to the standing address");
    expect(lettersIn(mail)).toBe(1);

    // THE SECOND TICK NEVER REACHES THE TIDY-UP in this class: the first one left the head
    // on the service branch, and a head that is not the role's to write to is refused
    // BEFORE any commit is planned. So the count holding at 1 here is not the lock's doing
    // — and this test says which of the two it is, because a count alone would credit the
    // lock with a silence the tree's own state produced.
    const second = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], env);
    expect(lettersIn(mail)).toBe(1);
    expect(second.out).toContain("wip/dev-core/012-x-");
    expect(second.out).toContain("is not 'dev-core's to write to");
    expect(second.out).not.toContain("the outcome is posted to the standing address");
    expect(dirty(workspace)).toBe(true);

    // R5 — AND THE REFUSAL NAMES THE INCIDENT BEHIND THE HEAD. Three halves, each its own
    // assert: (a) that the circuit's tidy-up failed and this head is its doing, (b) where
    // that was told — the standing address and whose turn waits on it, (c) that the cause
    // the tree has right now is still there, whole: the sentence is ADDED, never swapped
    // in. Without (c) this fix would trade one misleading refusal for another.
    expect(second.out).toContain(
      "this head is where the circuit's own tidy-up of 'dev-core' left it",
    );
    expect(second.out).toContain("that tidy-up FAILED");
    expect(second.out).toContain(TIDY_UP_SLUG);
    expect(second.out).toContain("turn for 'curator'");
    expect(second.out).toContain("read the incident there");

    // THE THIRD TICK, ASKED FOR BY NAME (curator, §4 of the statement — a measurement the
    // stand gives for free): it says the same thing as the second, and it too says nothing
    // about the tidy-up that failed. So the class is stable rather than converging on the
    // original incident, and whether that silence is worth an item of its own is a
    // decision that now stands on a measurement instead of on a shared guess.
    const third = runWith(repo, ["--exec", stub(repo, "true"), "--fresh"], env);
    expect(lettersIn(mail)).toBe(1);
    expect(third.out).toContain("is not 'dev-core's to write to");
    expect(third.out).not.toContain("the index is broken");
    // …and the tick after the tick still carries the account: the class is stable, so the
    // pointer to the incident has to be as stable as the refusal it stands beside.
    expect(third.out).toContain("that tidy-up FAILED");
    expect(third.out).toContain(TIDY_UP_SLUG);
  }, 240_000);
});
