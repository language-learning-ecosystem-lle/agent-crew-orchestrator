/**
 * THE SEAM OF THE SELF-RESTART LETTER (thread 141, package 3) — the facts
 * `self-restart-letter.test.ts` cannot hold, and the reason the discipline of this role
 * names a seam test separately from units at all.
 *
 * The units beside `planSelfRestartLetter` prove WHICH letter a set of facts produces: the
 * addressee, the body, the argv, and the signature the lock is keyed by. Every one of them
 * builds its own expectation of the door and NONE of them ever calls it — so all of them
 * stay green on a daemon that never reaches the branch, on an argv `new-message` refuses,
 * on a delivery whose exit code nobody reads, and on a ledger that locks a letter that
 * never arrived. That is the same gap `tidy-letter.process.test.ts` was written for one
 * module over, and this file is its counterpart for the second place the daemon writes into
 * the mail.
 *
 * So every case here runs the REAL path: a real contour, a real mail checkout, a REAL
 * daemon tick (`orchestrator daemon --once`) raised from the sources copied INTO that
 * contour, and the letter read back out of the feed with `thread show` — not off the disk,
 * because "a file was written" and "a reader of the thread sees it" are two different
 * statements, and only the second one is what the package promises.
 *
 *  1. the successor RECOGNISES ITSELF and the letter goes — into a receiver the delivery
 *     itself opens, carrying the four facts john asked for, with the turn on CURATOR both
 *     in the prose and in the queue `mail --role` answers with;
 *  2. the SECOND tick over the same memory posts NOTHING and says so — one restart is one
 *     letter, not one per minute, and the ledger is read off the disk by a process that
 *     shares nothing with the one that wrote it;
 *  3. a SECOND restart onto the same sha is news again — the lock is on the event and not
 *     on the address, and a lock that swallowed this would be a worse defect than the flood;
 *  4. the DELIVERY refused — the restart still stands, the journal names the cause AND the
 *     facts of the event, nothing anywhere claims the letter went, and NO LEDGER IS LEFT
 *     BEHIND: the next tick tries again. A silence here is the defect of this thread
 *     reproduced one step later — the box restarted itself and nobody was told.
 *
 * The contour is `self-restart.process.test.ts`'s `homeContour({ current: true })` — the box
 * standing exactly ON its ref, which is the only shape in which the tick reads `match` and
 * so the only one from which the successor can recognise itself — with one thing added: the
 * three roles the letter names have to EXIST in the config, because the door checks them,
 * and that check is also what makes case 4 cheap to provoke.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { HANG_CEILING_MS } from "../testing/wait-for.js";
import { renderSelfRestartMemory, type SelfRestartMemory } from "./self-restart.js";
import { SELF_RESTART_SLUG } from "./self-restart-letter.js";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const NODE_MODULES = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
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

/** The sender of the letter — the role the circuit's machine writes under. */
const GITHUB = {
  id: "github",
  kind: "github-actions",
  status: "active",
  wake: { mode: "event" },
  summary: "the circuit's machine notifier",
};

/** The addressee of the turn — and, when left out, the cause of case 4. */
const CURATOR = {
  id: "curator",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "c" },
  summary: "the coordinator",
};

/** Named as a participant because the account is his; never as the turn. */
const JOHN = {
  id: "john",
  kind: "human",
  status: "active",
  wake: { mode: "self" },
  summary: "the owner",
};

const configWith = (roles: readonly unknown[]): unknown => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "origin/main" },
  roles,
});

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/**
 * The mail of the contour, seeded with a thread whose turn is on `dev-core` AND NOT on
 * curator: every assertion about curator's queue below is then a statement about the letter
 * and about nothing else that was already lying in the feed.
 */
const seedMail = (origin: string, repo: string): void => {
  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "141-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
};

/**
 * A BOX THAT IS BOTH the circuit home the daemon serves AND the checkout node loaded its
 * code from, standing exactly ON its ref — `homeContour({ current: true })` of
 * `self-restart.process.test.ts`, parameterised by the roles in the config.
 *
 * The premise is BUILT AND NEVER BORROWED (thread 056): the sources are copied into the
 * contour and the CLI is raised from that copy, so "the loaded code equals the ref" is a
 * fact of the fixture and holds identically on a branch, on a PR run and on the push run
 * after a squash-merge — the shape that reddened this file's neighbour on `main` alone.
 *
 * `.gitignore` is not tidiness: a running circuit puts the mail checkout, the state
 * directory and the linked modules inside its own home, and for the code-age reading an
 * untracked file is dirt about the fixture's own scaffolding.
 */
const contour = (roles: readonly unknown[]): { readonly repo: string; readonly cli: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-self-restart-letter-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configWith(roles), null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules\nmailco/\n.orchestrator/\n");
  cpSync(SRC, join(repo, "src"), { recursive: true });
  // NO `package.json` IS WRITTEN BESIDE THE SOURCES, and that is a fact the tests below
  // stand on rather than an omission (thread 161). The narrowing asks which directory of the
  // checkout the daemon executes, and the answer is the nearest `package.json` above its
  // entry — here there is none above `src/cli.ts` inside the contour, so the box runs in the
  // "boundary unknown" shape: every path of the checkout counts as executable. That is the
  // SAFE side of the narrowing, and it is the one worth having at the seam — what a process
  // test can prove that a unit cannot is that the tick reads the diff out of git at all.
  // (One was written here and taken back out: a `package.json` beside the copied sources
  // moves the module boundary and `zod` stops resolving from `src/config/config.ts`.)
  symlinkSync(NODE_MODULES, join(repo, "node_modules"), "dir");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "the loaded code");
  git(repo, "push", "-q", "origin", "main");
  seedMail(origin, repo);
  // ON the ref, on the branch: `codeAge` reads `match`, the tick decides no repair, and the
  // only thing that can tell it a restart happened is the memory on disk.
  git(repo, "checkout", "-q", "main");
  return { repo, cli: join(repo, "src", "cli.ts") };
};

/** One tick of a REAL daemon over `repo`, raised from `cli` — both streams into one string. */
const tick = (cli: string, repo: string): string => {
  const ran = spawnSync(
    TSX,
    [
      cli,
      "orchestrator",
      "daemon",
      "--ref",
      "origin/main",
      "--repo",
      repo,
      "--exec",
      "/bin/true",
      "--once",
      "--tick",
      "1",
      "--poll",
      "1",
    ],
    {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: sandbox(configHome(repo)),
      timeout: HANG_CEILING_MS,
    },
  );
  return `${ran.stdout ?? ""}${ran.stderr ?? ""}`;
};

/**
 * THE MEMORY THE OLD PROCESS LEFT BEHIND (#309) — the only thing that crosses the exit of
 * the process that decided the restart, and therefore the only input this half has.
 *
 * `target` is the sha the box was TRYING TO REACH, and the successor recognises itself by
 * that sha being the one it now runs: the fixture takes it from git rather than inventing
 * it, because an invented one is precisely the case where nothing happens.
 */
const rememberRestart = (repo: string, memory: Partial<SelfRestartMemory> = {}): string => {
  const target = git(repo, "rev-parse", "HEAD").trim();
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  const full: SelfRestartMemory = {
    target,
    attempts: 1,
    at: "2026-09-06T12:34:56Z",
    drainSince: "2026-09-06T12:04:56Z",
    from: "a".repeat(40),
    behind: 3,
    ...memory,
  };
  writeFileSync(join(repo, ".orchestrator", "self-restart.json"), renderSelfRestartMemory(full));
  return target;
};

/** The receiver of the standing address, as it stands in the feed — or nothing. */
const receiverOf = (repo: string): string | undefined =>
  readdirSync(join(repo, "mailco", "agent-comms")).find((entry) =>
    entry.endsWith(`-${SELF_RESTART_SLUG}`),
  );

/**
 * HOW MANY LETTERS STAND IN THE ADDRESS — counted as FILES across EVERY receiver of it, the
 * measure of thread 133: a lock that let the second letter open a SECOND receiver would
 * leave the first at exactly one message and pass a test that looked at one folder.
 */
const lettersIn = (repo: string): number =>
  readdirSync(join(repo, "mailco", "agent-comms"))
    .filter((entry) => entry.endsWith(`-${SELF_RESTART_SLUG}`))
    .reduce(
      (total, entry) =>
        total +
        readdirSync(join(repo, "mailco", "agent-comms", entry, "messages")).filter((name) =>
          name.endsWith(".md"),
        ).length,
      0,
    );

/**
 * THE LETTER AS A READER OF THE THREAD SEES IT. Not `readFileSync` on the message: the claim
 * under test is that the letter ARRIVED, and a file in a directory the loader rejects — a
 * bad header, a sender the registry does not know, a thread that never got its `_meta.md` —
 * is a file and not an arrival.
 */
const readBack = (repo: string, thread: string): string =>
  execFileSync(
    TSX,
    [
      join(repo, "src", "cli.ts"),
      "thread",
      "show",
      "--root",
      join(repo, "mailco", "agent-comms"),
      "--repo",
      repo,
      "--ref",
      "origin/main",
      "--thread",
      thread,
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );

/**
 * WHOSE TURN THE FEED SAYS IT IS, read by the queue's own reader rather than off the prose:
 * `mail --role <id>` is literally what a tick consults to decide whom to raise, so a letter
 * this does not surface raises nobody — which is the failure this seam exists to close.
 */
const turnsOf = (repo: string, role: string): string =>
  execFileSync(
    TSX,
    [
      join(repo, "src", "cli.ts"),
      "mail",
      "--root",
      join(repo, "mailco", "agent-comms"),
      "--repo",
      repo,
      "--ref",
      "origin/main",
      "--role",
      role,
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );

/** The ledger of what the standing address has already been told, as the tick keeps it. */
const ledgerOf = (repo: string): string | undefined => {
  const path = join(repo, ".orchestrator", "self-restart-letters.json");
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};

describe("the successor tells the standing address what the restart cost — through the real door", () => {
  it(
    "the tick RECOGNISES the restart: the receiver is opened, the four facts are in it, the turn is curator's",
    () => {
      const { repo, cli } = contour([DEV_CORE, GITHUB, CURATOR, JOHN]);
      // Nothing of this address exists before the tick: the receiver below is opened BY THE
      // DELIVERY, which is the half of `--ensure-thread` no unit over the argv can reach.
      expect(receiverOf(repo)).toBeUndefined();
      const target = rememberRestart(repo);

      const said = tick(cli, repo);

      // THE PREMISE, ASSERTED RATHER THAN ASSUMED: this tick found no drift. A fixture that
      // quietly drifted would never reach the branch, and every assertion below would then
      // be measuring a letter that came from somewhere else.
      expect(said).not.toContain("the LOADED CODE is not the ref");
      expect(said).not.toContain("DRAINING TO RESTART");

      // THE JOURNAL SAYS IT WENT — and says nothing that could be read as a failure.
      expect(said).toContain(
        `letter — the self-restart is posted to the standing address '${SELF_RESTART_SLUG}', turn for 'curator'`,
      );
      expect(said).not.toContain("NOT DELIVERED");
      expect(said).not.toContain("SUPPRESSED");

      // …AND THE FEED AGREES.
      const receiver = receiverOf(repo);
      expect(receiver, `no receiver of '${SELF_RESTART_SLUG}' in the feed`).toBeDefined();
      const shown = readBack(repo, receiver as string);

      // THE FOUR FACTS JOHN ASKED FOR, each one read out of the thread a human opens. The
      // sha of "what it became" is matched against GIT's rather than against a literal: the
      // letter carries the abbreviated form, and asserting the abbreviation itself would be
      // a test of `slice` instead of a test that the letter points at the code now running.
      expect(shown).toContain("a".repeat(12));
      expect(shown).toContain(target.slice(0, 12));
      expect(shown).toContain("3 коммит(ов)");
      expect(shown).toContain("30 мин (1800 с)");
      expect(shown).toContain("2026-09-06T12:34:56Z");
      // …and never the words that stand in when a fact is missing from the memory.
      expect(shown).not.toContain("не записано");
      expect(shown).toContain("from: github");

      // WHOSE TURN IT IS, taken from the QUEUE and not from the prose — this is how curator
      // is raised on an address it has never written into. And NOT john's: a turn on a human
      // stands in a receiver no tick wakes anybody for.
      expect(turnsOf(repo, "curator")).toContain(receiver as string);
      expect(turnsOf(repo, "dev-core")).not.toContain(receiver as string);
      expect(turnsOf(repo, "john")).not.toContain(receiver as string);

      // THE LEDGER IS WRITTEN — and written only now, after an exit code of 0.
      expect(ledgerOf(repo)).toContain("2026-09-06T12:34:56Z");
      expect(lettersIn(repo)).toBe(1);
    },
    3 * HANG_CEILING_MS,
  );

  /**
   * THE NARROWING, AT THE SEAM (thread 161). The unit knows what `executableChange` answers
   * over a list of paths; only the real door says whether the tick reads that list out of
   * git at all, over the right pair of shas, in the right checkout — and the field case it
   * answers is exactly a restart whose diff a unit would never have been handed.
   *
   * The memory is made to name a REAL earlier commit: the fixture's default `from` is forty
   * `a`s, a sha no repository holds, and a diff against it cannot be read — which is the
   * `unmeasured` branch and posts. Every assertion about withholding has to move off it.
   */
  const restartAcross = (repo: string, path: string | undefined, body: string): void => {
    const before = git(repo, "rev-parse", "HEAD").trim();
    if (path === undefined) git(repo, "commit", "-q", "--allow-empty", "-m", "nothing moved");
    else {
      writeFileSync(join(repo, path), body);
      git(repo, "add", ".");
      git(repo, "commit", "-qm", `moving ${path}`);
    }
    git(repo, "push", "-q", "origin", "main");
    rememberRestart(repo, { from: before });
  };

  it(
    "a restart that moved NOTHING this box executes writes no letter, and says so by name",
    () => {
      const { repo, cli } = contour([DEV_CORE, GITHUB, CURATOR, JOHN]);
      // The whole checkout is executable in this fixture (see `contour`), so the only diff
      // that moves nothing of it is an empty one. What is under test is the READING: the tick
      // asks git for `from..to` in the code checkout and believes the answer. Which paths of
      // a non-empty diff count is the unit's question, and it is asked there.
      restartAcross(repo, undefined, "");

      const said = tick(cli, repo);

      expect(said).not.toContain("the LOADED CODE is not the ref");
      expect(said).toContain("letter — WITHHELD");
      expect(said).toContain("NOTHING THIS DAEMON EXECUTES");
      // The line lets a reader check the narrowing instead of trusting it: what was measured.
      expect(said).toContain("every path of that checkout is treated as executable");
      // NOTHING WAS TOLD AND NOTHING WAS REMEMBERED: no receiver, no letter, no ledger — a
      // withheld letter reached nobody, so a lock over it would silence the next real one.
      expect(receiverOf(repo)).toBeUndefined();
      expect(lettersIn(repo)).toBe(0);
      expect(ledgerOf(repo)).toBeUndefined();
      expect(turnsOf(repo, "curator")).not.toContain(SELF_RESTART_SLUG);
    },
    3 * HANG_CEILING_MS,
  );

  it(
    "a restart that moved the PACKAGE still writes the letter, and it names what moved",
    () => {
      const { repo, cli } = contour([DEV_CORE, GITHUB, CURATOR, JOHN]);
      restartAcross(repo, join("src", "moved.ts"), "export const moved = true;\n");

      expect(tick(cli, repo)).toContain("the self-restart is posted to the standing address");
      const receiver = receiverOf(repo);
      expect(receiver, `no receiver of '${SELF_RESTART_SLUG}' in the feed`).toBeDefined();
      const shown = readBack(repo, receiver as string);
      expect(shown).toContain("что сменилось в исполняемом");
      expect(shown).toContain("src/moved.ts");
      expect(lettersIn(repo)).toBe(1);
    },
    3 * HANG_CEILING_MS,
  );

  it(
    "the SECOND tick over the same memory posts nothing and says why — 1 letter, not one per minute",
    () => {
      const { repo, cli } = contour([DEV_CORE, GITHUB, CURATOR, JOHN]);
      rememberRestart(repo);

      expect(tick(cli, repo)).toContain("the self-restart is posted to the standing address");
      expect(lettersIn(repo)).toBe(1);

      // THE MEMORY IS NOT CONSUMED by the tick that reads it — asserted, because that is the
      // whole reason a lock is needed at all: without it this second tick, and every tick a
      // minute apart after it, would post the same letter again.
      expect(existsSync(join(repo, ".orchestrator", "self-restart.json"))).toBe(true);

      // A SECOND PROCESS, SHARING NOTHING WITH THE FIRST but the disk — which is also the
      // answer to "does the lock survive a restart of the daemon".
      const second = tick(cli, repo);

      // R1 — THE COUNT, which is the requirement itself.
      expect(lettersIn(repo)).toBe(1);
      // R2 — AND THE TICK IS NOT SILENT ABOUT IT: a quiet suppression is indistinguishable
      // from "no restart happened", and telling those two apart in a log is the entire
      // reason this package exists.
      expect(second).toContain("letter — SUPPRESSED, nothing new to say");
      expect(second).toContain(SELF_RESTART_SLUG);
      expect(second).toContain("turn for 'curator'");
      // R3 — AND IT SAYS WHERE THE LETTER IS. The stamp in that line is WHEN THE LETTER
      // WENT and not when the restart was decided — those are two different instants, and
      // the one a reader needs to find the message in the receiver is the first. It is
      // taken from the ledger the previous tick wrote rather than from a literal: a literal
      // could only be the event's own stamp, which is exactly the confusion being guarded.
      const wrote = JSON.parse(ledgerOf(repo) as string) as { at: string };
      expect(wrote.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(second).toContain(wrote.at);
      expect(second).not.toContain("the self-restart is posted to the standing address");
    },
    4 * HANG_CEILING_MS,
  );

  it(
    "a SECOND restart onto the SAME sha is news again — two events, two letters",
    () => {
      const { repo, cli } = contour([DEV_CORE, GITHUB, CURATOR, JOHN]);
      rememberRestart(repo);
      expect(tick(cli, repo)).toContain("the self-restart is posted to the standing address");
      expect(lettersIn(repo)).toBe(1);

      // The same box, the same target, a DIFFERENT decision — the shape of a box that
      // drifted, repaired itself, drifted onto the same sha and repaired itself again. If
      // the count stayed at 1 here the lock would have swallowed a happening nobody was told
      // about, which is a worse defect than the flood it replaces.
      rememberRestart(repo, { at: "2026-09-06T18:00:00Z", drainSince: "2026-09-06T17:59:00Z" });
      const second = tick(cli, repo);

      expect(second).toContain("the self-restart is posted to the standing address");
      expect(second).not.toContain("SUPPRESSED");
      expect(lettersIn(repo)).toBe(2);
      expect(readBack(repo, receiverOf(repo) as string)).toContain("2026-09-06T18:00:00Z");
      // The second letter went into the SAME receiver, which is what a standing address is:
      // one incident class, one folder a human keeps open.
      expect(
        readdirSync(join(repo, "mailco", "agent-comms")).filter((entry) =>
          entry.endsWith(`-${SELF_RESTART_SLUG}`),
        ).length,
      ).toBe(1);
    },
    4 * HANG_CEILING_MS,
  );

  it(
    "the DELIVERY refused: the restart stands, the journal carries the event, and NO ledger is left behind",
    () => {
      // `curator` and `john` are NOT in this config, and the letter names them as
      // participants of the receiver — so `new-message` refuses at the door. The failure is
      // provoked in the DELIVERY and nowhere else: the tick itself touches no role.
      const { repo, cli } = contour([DEV_CORE, GITHUB]);
      const target = rememberRestart(repo);

      const said = tick(cli, repo);

      // THE FAILURE IS A FACT OF ITS OWN, said out loud — a silent `catch` here is this
      // thread's original defect one step later: the box restarted and nobody was told.
      expect(said).toContain(
        `letter — NOT DELIVERED to the standing address '${SELF_RESTART_SLUG}'`,
      );
      expect(said).toContain("turn for 'curator'");
      // WHAT EXACTLY REFUSED — the door's own sentence, carried out through the exit code, so
      // a reader can fix the config without re-running anything.
      expect(said).toContain("'new-message' exited");
      expect(said).toContain("curator");
      // THE FACTS OF THE EVENT. With the letter lost this line is the only trace of it, and a
      // failure line naming only the failure would leave the restart to archaeology.
      expect(said).toContain("The restart itself STANDS");
      expect(said).toContain(target.slice(0, 12));
      expect(said).toContain("2026-09-06T12:34:56Z");

      // IT DOES NOT PASS FOR A SUCCESS, in the journal or in the feed.
      expect(said).not.toContain("the self-restart is posted to the standing address");
      expect(receiverOf(repo), "a receiver was opened by a delivery that refused").toBeUndefined();

      // AND NO LEDGER IS LEFT BEHIND — the fact the lock and the failure meet at. A letter
      // that never arrived has told nobody, and a lock over it would silence the very event
      // this package exists to announce. So the NEXT tick tries again rather than suppressing.
      expect(ledgerOf(repo)).toBeUndefined();
      const second = tick(cli, repo);
      expect(second).toContain("NOT DELIVERED");
      expect(second).not.toContain("SUPPRESSED");

      // …and the tick is not coloured by the letter it could not send: the daemon did its
      // work and left the way it does on any other tick.
      expect(second).not.toContain("Error:");
    },
    4 * HANG_CEILING_MS,
  );
});
